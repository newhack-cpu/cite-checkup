import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { it, expect } from "vitest";
import { parsePdf } from "../../../src/lib/documents/pdf";

function pdfWithDecodedWhitespace(megabytes: number, filter = "FlateDecode"): Uint8Array {
  const plain = Buffer.alloc(megabytes * 1024 * 1024, 32);
  const prefix = Buffer.from("BT /F1 12 Tf 10 10 Td (Resource probe text.) Tj ET");
  prefix.copy(plain, 0);
  let stream: Buffer;
  if (filter === "RunLengthDecode") {
    const encoded = [prefix.length - 1, ...prefix];
    for (let remaining = plain.length - prefix.length; remaining > 0;) {
      const count = Math.min(128, remaining);
      encoded.push(count === 1 ? 0 : 257 - count, 32);
      remaining -= count;
    }
    encoded.push(128);
    stream = Buffer.from(encoded);
  } else stream = deflateSync(plain);
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>"),
    Buffer.concat([Buffer.from(`<< /Length ${stream.length} /Filter /${filter} >>\nstream\n`), stream, Buffer.from("\nendstream")]),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
  ];
  const pieces = [Buffer.from("%PDF-1.4\n")];
  const offsets = [0];
  let offset = pieces[0].length;
  objects.forEach((object, index) => {
    offsets.push(offset);
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from("\nendobj\n")]);
    pieces.push(chunk);
    offset += chunk.length;
  });
  pieces.push(Buffer.from(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(value => `${String(value).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`));
  return new Uint8Array(Buffer.concat(pieces));
}

it("independently rejects the original 32 MiB Flate expansion probe", async () => {
  const bytes = pdfWithDecodedWhitespace(32);
  const before = process.memoryUsage().rss;
  let peak = before;
  const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 10);
  try {
    let rejected: unknown;
    try { await parsePdf(bytes); } catch (error) { rejected = error; }
    const observation = { wireBytes: bytes.length, decodedStreamBytes: 32 * 1024 * 1024, rssBefore: before, rssPeak: peak, rssIncrease: peak - before, code: (rejected as { code?: string })?.code };
    writeFileSync(new URL("./pdf-resource-verification.json", import.meta.url), JSON.stringify(observation, null, 2));
    expect(rejected).toMatchObject({ code: "PDF_RESOURCE_LIMIT", status: 413 });
  } finally { clearInterval(timer); }
}, 30_000);

it("independently rejects RunLength expansion outside the Flate decoder", async () => {
  await expect(parsePdf(pdfWithDecodedWhitespace(16, "RunLengthDecode"))).rejects.toMatchObject({ code: "PDF_RESOURCE_LIMIT", status: 413 });
}, 30_000);
