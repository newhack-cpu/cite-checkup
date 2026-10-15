import { describe, expect, it } from "vitest";
import { parsePdf } from "../pdf";
import { resourcePdf } from "./fixtures/resource-pdf";
import { guardPdfWorkerSource } from "../pdf-decoder-guard";

describe("PDF decompression resource boundaries", () => {
  it("fails closed if worker source differs from the audited version", () => {
    expect(() => guardPdfWorkerSource("export const WorkerMessageHandler = {};" )).toThrowError(expect.objectContaining({ code: "PARSER_UNAVAILABLE" }));
  });
  it.each([
    ["single Flate stream", { megabytes: 32 }],
    ["nested Flate filters", { megabytes: 9, layers: 2 }],
    ["compressed object stream", { megabytes: 9, objectStream: true }],
    ["cumulative streams across pages", { megabytes: 2, pages: 10 }],
  ])("rejects %s before unbounded expansion", async (_label, options) => {
    await expect(parsePdf(resourcePdf(options))).rejects.toMatchObject({ code: "PDF_RESOURCE_LIMIT" });
  }, 30_000);

  it("accepts bounded compressed content", async () => {
    expect((await parsePdf(resourcePdf({ megabytes: 1 }))).text).toContain("Resource probe text.");
  });

  it("accepts repeated short content without counting source references as decoded bytes", async () => {
    expect((await parsePdf(resourcePdf({ megabytes: 1, pages: 5, reuse: true }))).pageCount).toBe(5);
  }, 20_000);
});
