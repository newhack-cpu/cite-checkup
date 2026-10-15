import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDoiEvidence, reconstructAbstract, stripAbstractMarkup } from "../sources";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const json = (data: unknown) => Response.json(data);

describe("allowlisted academic abstract sources", () => {
  it("turns JATS markup into plain text and reconstructs OpenAlex positions", () => {
    expect(stripAbstractMarkup("<jats:p>A &amp; B scored &lt; 5.</jats:p>")).toBe("A & B scored < 5.");
    expect(reconstructAbstract({ Results: [0], improved: [2], sleep: [1] })).toBe("Results sleep improved");
    expect(() => reconstructAbstract({ A: [0], B: [0] })).toThrow();
    expect(() => reconstructAbstract({ A: [999_999_999] })).toThrow();
  });

  it("uses only the exact DOI record and labels the Crossref result as an abstract", async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ status: "ok", message: { DOI: "10.1234/trial", title: ["A randomized trial"], abstract: "<jats:p>Exercise improved fatigue after twelve weeks.</jats:p>" } }));
    vi.stubGlobal("fetch", fetcher);
    const result = await fetchDoiEvidence("10.1234/trial");
    expect(result.source).toMatchObject({ doi: "10.1234/trial", kind: "crossref_abstract", scope: "abstract" });
    expect(result.text).toBe("Exercise improved fatigue after twelve weeks.");
    const [url, init] = fetcher.mock.calls[0];
    expect(new URL(url).hostname).toBe("api.crossref.org");
    expect(init.redirect).toBe("error");
  });

  it("falls back to OpenAlex only when a Crossref abstract is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(json({ message: { DOI: "10.1234/trial", title: ["Trial"] } }))
      .mockResolvedValueOnce(json({ doi: "https://doi.org/10.1234/trial", title: "Trial", abstract_inverted_index: { No: [0], benefit: [1], observed: [2] } })));
    const result = await fetchDoiEvidence("10.1234/trial");
    expect(result.source.kind).toBe("openalex_abstract");
    expect(result.text).toBe("No benefit observed");
    expect(result.warnings.join(" ")).toMatch(/Crossref/);
  });

  it("rejects a DOI mismatch rather than assigning another paper's text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ message: { DOI: "10.1234/wrong", abstract: "Forged abstract" }, doi: "https://doi.org/10.1234/wrong", abstract_inverted_index: { Forged: [0] } })));
    await expect(fetchDoiEvidence("10.1234/trial")).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
  });

  it("does not treat missing abstracts as a fabricated conclusion", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(json({ message: { DOI: "10.1234/trial" } }))
      .mockResolvedValueOnce(json({ doi: "https://doi.org/10.1234/trial", abstract_inverted_index: null })));
    await expect(fetchDoiEvidence("10.1234/trial")).rejects.toMatchObject({ code: "NO_EVIDENCE" });
  });

  it("retries a recognized connection failure once and still validates the fetched record", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError("native unsafe detail", { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } }))
      .mockResolvedValueOnce(json({ message: { DOI: "10.1234/trial", abstract: "The randomized trial found no significant improvement." } }));
    vi.stubGlobal("fetch", fetcher);
    const result = await fetchDoiEvidence("10.1234/trial");
    expect(result.text).toContain("no significant improvement");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("sanitizes arbitrary upstream errors, including credential-bearing messages", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("secret-token https://private.invalid")));
    let message = "";
    try { await fetchDoiEvidence("10.1234/trial"); } catch (error) { message = String(error); }
    expect(message).not.toContain("secret-token");
    expect(message).not.toContain("private.invalid");
  });

  it("cancels without making the fallback request", async () => {
    const control = new AbortController();
    const fetcher = vi.fn().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }));
    vi.stubGlobal("fetch", fetcher);
    const task = fetchDoiEvidence("10.1234/trial", control.signal);
    control.abort();
    await expect(task).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
