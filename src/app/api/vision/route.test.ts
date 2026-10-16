import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const vision = vi.hoisted(() => ({ transcribe: vi.fn(), status: vi.fn() }));
vi.mock("@/lib/vision", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/vision")>()),
  transcribeReferences: vision.transcribe,
  getVisionStatus: vision.status,
}));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
let nextIp = 0;

function upload(files: { name: string; bytes: Uint8Array<ArrayBuffer>; field?: string }[], ip = `192.0.2.${++nextIp}`) {
  const form = new FormData();
  for (const file of files) form.append(file.field ?? "image", new File([file.bytes], file.name));
  return new Request("http://localhost/api/vision", { method: "POST", body: form, headers: { "x-forwarded-for": ip } });
}
async function routes() {
  return import("./route");
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vision.status.mockReturnValue({ available: true, provider: "DeepSeek", model: "fixture-model", limits: { images: 4, totalBytes: 8 * 1024 * 1024 } });
  vision.transcribe.mockResolvedValue({ entries: ["[1] A reference."], text: "[1] A reference.", warnings: ["请对照原图核对"], model: "fixture-model" });
});
afterEach(() => vi.restoreAllMocks());

describe("/api/vision", () => {
  it("returns the transcription for review and passes the sniffed formats on", async () => {
    const response = await (await routes()).POST(upload([{ name: "shot.png", bytes: PNG }]));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ text: "[1] A reference.", images: 1 });
    expect(vision.transcribe.mock.calls[0][0]).toEqual([{ bytes: expect.any(Uint8Array), format: "png" }]);
  });

  it("rejects files that are not images even if they are named like one", async () => {
    const response = await (await routes()).POST(upload([{ name: "paper.png", bytes: new TextEncoder().encode("%PDF-1.7") }]));
    expect(response.status).toBe(415);
    expect(vision.transcribe).not.toHaveBeenCalled();
  });

  it.each([
    [[{ name: "a.png", bytes: PNG, field: "file" }]],
    [Array.from({ length: 5 }, (_, i) => ({ name: `${i}.png`, bytes: PNG }))],
  ])("rejects unexpected fields or more than four images (case %#)", async (files) => {
    const response = await (await routes()).POST(upload(files));
    expect(response.status).toBe(400);
    expect(vision.transcribe).not.toHaveBeenCalled();
  });

  it("refuses when DeepSeek is not configured", async () => {
    vision.status.mockReturnValue({ available: false, provider: "DeepSeek", model: "m", limits: { images: 4, totalBytes: 1 } });
    const response = await (await routes()).POST(upload([{ name: "shot.png", bytes: PNG }]));
    expect(response.status).toBe(503);
  });

  it("limits each client to four recognitions per minute", async () => {
    const { POST } = await routes();
    for (let i = 0; i < 4; i++) expect((await POST(upload([{ name: "s.png", bytes: PNG }], "203.0.113.20"))).status).toBe(200);
    const blocked = await POST(upload([{ name: "s.png", bytes: PNG }], "203.0.113.20"));
    expect(blocked.status).toBe(429);
  });
});
