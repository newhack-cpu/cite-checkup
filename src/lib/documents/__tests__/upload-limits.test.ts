import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MIB = 1024 * 1024;
const MULTIPART_HEADROOM = 64 * 1024;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe.each([
  { target: undefined, mib: 8, label: "default hosting" },
  { target: "netlify", mib: 4, label: "Netlify" },
])("upload limits on $label", ({ target, mib }) => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_DEPLOY_TARGET", target);
    vi.stubEnv("DEEPSEEK_API_KEY", "fixture-key-never-real");
    vi.stubEnv("DEEPSEEK_BASE_URL", "");
    vi.stubEnv("DEEPSEEK_MODEL", "");
  });

  it("shares the document and image byte limit while preserving parser resource limits", async () => {
    const { DOCUMENT_LIMITS } = await import("../types");
    const { VISION_LIMITS, getVisionStatus } = await import("../../vision");
    expect(DOCUMENT_LIMITS.fileBytes).toBe(mib * MIB);
    expect(DOCUMENT_LIMITS.requestBytes).toBe(mib * MIB + MULTIPART_HEADROOM);
    expect(VISION_LIMITS.totalBytes).toBe(mib * MIB);
    expect(getVisionStatus().limits.totalBytes).toBe(mib * MIB);
    expect(DOCUMENT_LIMITS.pdfDecodedStreamBytes).toBe(8 * MIB);
    expect(DOCUMENT_LIMITS.zipEntryBytes).toBe(8 * MIB);
  });

  it("passes a file at the byte limit to format validation and rejects the next byte", async () => {
    const { importDocument } = await import("../import");
    // An invalid PDF header exercises the size gate without starting an expensive PDF worker.
    const file = new File([new Uint8Array(mib * MIB)], "paper.pdf");
    await expect(importDocument(file)).rejects.toMatchObject({ code: "INVALID_DOCUMENT" });
    await expect(importDocument(new File([file, " "], "paper.pdf"))).rejects.toMatchObject({
      code: "FILE_TOO_LARGE", status: 413, message: `文件超过 ${mib} MiB，请压缩或拆分后导入。`,
    });
  });

  it("fits a maximum-size document and four images into the bounded multipart body", async () => {
    const { readDocumentUpload, readBoundedForm } = await import("../request");
    const { DOCUMENT_LIMITS } = await import("../types");
    const document = new FormData();
    document.append("file", new File([new Uint8Array(mib * MIB)], "paper.pdf"));
    const documentRequest = new Request("https://example.test/api/import", { method: "POST", body: document });
    expect((await readDocumentUpload(documentRequest.clone())).size).toBe(mib * MIB);

    const images = new FormData();
    for (let i = 0; i < 4; i++) images.append("image", new File([new Uint8Array(mib * MIB / 4)], `image-${i + 1}.png`));
    const imageRequest = new Request("https://example.test/api/vision", { method: "POST", body: images });
    expect((await readBoundedForm(imageRequest.clone(), "Expected images")).getAll("image")).toHaveLength(4);

    for (const request of [documentRequest, imageRequest]) {
      const byteLength = (await request.arrayBuffer()).byteLength;
      expect(byteLength).toBeGreaterThan(mib * MIB);
      expect(byteLength).toBeLessThan(DOCUMENT_LIMITS.requestBytes);
      if (target === "netlify") expect(4 * Math.ceil(byteLength / 3)).toBeLessThan(6_000_000);
    }
    // The upper bound must fit too, including multipart data and leaving envelope headroom.
    if (target === "netlify") expect(4 * Math.ceil(DOCUMENT_LIMITS.requestBytes / 3)).toBeLessThan(6_000_000 - 300_000);
  });

  it.each([true, false])("rejects an oversized wire body (honest Content-Length: %s)", async (honestLength) => {
    const { readBoundedForm } = await import("../request");
    const size = mib * MIB + MULTIPART_HEADROOM + 1;
    const request = new Request("https://example.test/api/import", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=fixture", "Content-Length": String(honestLength ? size : 1) },
      body: new Uint8Array(size),
    });
    await expect(readBoundedForm(request, "Expected a file")).rejects.toMatchObject({
      code: "FILE_TOO_LARGE", status: 413, message: expect.stringContaining(`${mib} MiB`),
    });
  });

  it("applies the image limit to the combined bytes before any model call", async () => {
    const { transcribeReferences } = await import("../../vision");
    const fetch = vi.fn().mockImplementation(async () => Response.json({
      choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ type: "function", function: { name: "submit_references", arguments: JSON.stringify({ entries: ["[1] A reference."] }) } }] } }],
    }));
    vi.stubGlobal("fetch", fetch);
    const image = { bytes: new Uint8Array(mib * MIB / 2), format: "png" as const };
    expect((await transcribeReferences([image, image])).entries).toEqual(["[1] A reference."]);
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockClear();
    await expect(transcribeReferences([image, { bytes: new Uint8Array(image.bytes.byteLength + 1), format: "png" }])).rejects.toMatchObject({
      code: "TOO_LARGE", status: 413, message: `图片合计超过 ${mib} MiB，请压缩或分批上传`,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
