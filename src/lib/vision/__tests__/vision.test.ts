import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseTranscription, sniffImage, transcribeReferences, VISION_LIMITS } from "../index";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const PDF = new TextEncoder().encode("%PDF-1.7\n");

function completion(args: unknown, finish = "tool_calls") {
  return {
    choices: [{ index: 0, finish_reason: finish, message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "submit_references", arguments: JSON.stringify(args) } }] } }],
    usage: { total_tokens: 1314 },
  };
}

beforeEach(() => {
  vi.stubEnv("DEEPSEEK_API_KEY", "fixture-key-never-real");
  vi.stubEnv("DEEPSEEK_MODEL", "");
  vi.stubEnv("DEEPSEEK_BASE_URL", "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("image sniffing", () => {
  it.each([[PNG, "png"], [JPEG, "jpeg"], [WEBP, "webp"], [GIF, "gif"]] as const)("recognises %#", (bytes, format) => {
    expect(sniffImage(bytes)).toBe(format);
  });

  it("rejects non-image content whatever the file name says", () => {
    expect(sniffImage(PDF)).toBeUndefined();
    expect(sniffImage(new Uint8Array())).toBeUndefined();
  });
});

describe("transcription validation", () => {
  it("keeps verbatim entries, drops blank ones and reports tokens", () => {
    expect(parseTranscription(completion({ entries: ["[1] Walters, W. H. (2023). Title.", "  ", "[2] 周志华. 机器学习[M]. 2016."] })))
      .toEqual({ entries: ["[1] Walters, W. H. (2023). Title.", "[2] 周志华. 机器学习[M]. 2016."], tokens: 1314 });
  });

  it("unwraps the known {arguments: ...} envelope", () => {
    expect(parseTranscription(completion({ arguments: { entries: ["[1] A reference."] } })).entries).toEqual(["[1] A reference."]);
  });

  it.each([
    { entries: ["[1] ok"], verdict: "verified" },
    { entries: "[1] not an array" },
    { entries: [42] },
    { entries: Array.from({ length: VISION_LIMITS.entries + 1 }, (_, i) => `[${i}] entry`) },
    { entries: ["x".repeat(VISION_LIMITS.entryChars + 1)] },
  ])("rejects malformed or oversized arguments (case %#)", (args) => {
    expect(() => parseTranscription(completion(args))).toThrow(/格式不正确/);
  });

  it("rejects a reply without the forced tool call", () => {
    expect(() => parseTranscription(completion({ entries: [] }, "stop"))).toThrow(/格式不正确/);
  });
});

describe("transcribeReferences", () => {
  it("sends the images inline to DeepSeek with a forced tool call and returns text for review", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(completion({ entries: ["[1] Walters, W. H., & Wilder, E. I. (2023). Fabrication and errors. Scientific Reports, 13, 14045.", "[2] 周志华. 机器[?]学习[M]. 2016."] })));
    vi.stubGlobal("fetch", fetch);
    const result = await transcribeReferences([{ bytes: PNG, format: "png" }, { bytes: JPEG, format: "jpeg" }]);
    expect(result.entries).toHaveLength(2);
    expect(result.text).toBe(result.entries.join("\n"));
    expect(result.warnings.join("")).toContain("对照");
    expect(result.warnings.join("")).toContain("[?]");
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({ tool_choice: "required", thinking: { type: "disabled" }, temperature: 0 });
    const parts = body.messages[1].content;
    expect(parts.filter((p: { type: string }) => p.type === "image_url").map((p: { image_url: { url: string } }) => p.image_url.url.slice(0, 22)))
      .toEqual(["data:image/png;base64,", "data:image/jpeg;base64"]);
    expect(body.messages[0].content).toContain("untrusted DATA");
  });

  it("says no references were found instead of returning an empty list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(completion({ entries: [] }))));
    await expect(transcribeReferences([{ bytes: PNG, format: "png" }])).rejects.toMatchObject({ code: "NO_REFERENCES" });
  });

  it("reports model outages and missing configuration clearly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })));
    await expect(transcribeReferences([{ bytes: PNG, format: "png" }])).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    await expect(transcribeReferences([{ bytes: PNG, format: "png" }])).rejects.toMatchObject({ code: "CONFIGURATION", status: 503 });
  });

  it("refuses too many or too large images before calling the model", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const five = Array.from({ length: 5 }, () => ({ bytes: PNG, format: "png" as const }));
    await expect(transcribeReferences(five)).rejects.toMatchObject({ code: "INVALID_IMAGE" });
    await expect(transcribeReferences([{ bytes: new Uint8Array(VISION_LIMITS.totalBytes + 1), format: "png" }])).rejects.toMatchObject({ code: "TOO_LARGE" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
