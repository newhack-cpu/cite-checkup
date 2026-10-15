import { deflateSync } from "node:zlib";

/** Valid, synthetic PDF streams: padding expands heavily while visible text stays short. */
export function resourcePdf({ megabytes = 9, layers = 1, pages = 1, reuse = false, objectStream = false }: { megabytes?: number; layers?: number; pages?: number; reuse?: boolean; objectStream?: boolean } = {}): Uint8Array {
  const plain = Buffer.alloc(megabytes * 1024 * 1024, 32);
  Buffer.from("BT /F1 12 Tf 10 10 Td (Resource probe text.) Tj ET").copy(plain);
  let encoded = plain;
  for (let index = 0; index < layers; index++) encoded = deflateSync(encoded);
  const filter = layers === 1 ? "/FlateDecode" : `[${Array(layers).fill("/FlateDecode").join(" ")}]`;
  const stream = (data: Buffer, dictionary: string) => Buffer.concat([Buffer.from(`<< /Length ${data.length} ${dictionary} >>\nstream\n`), data, Buffer.from("\nendstream")]);
  if (objectStream) {
    const object = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>";
    const payload = Buffer.alloc(megabytes * 1024 * 1024, 32);
    Buffer.from("3 0 " + object).copy(payload);
    return serialize(new Map([
      [1, Buffer.from("<< /Type /Catalog /Pages 2 0 R >>")],
      [2, Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>")],
      [4, stream(Buffer.from("BT /F1 12 Tf 10 10 Td (Object stream probe.) Tj ET"), "")],
      [5, Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")],
      [6, stream(deflateSync(payload), "/Type /ObjStm /N 1 /First 4 /Filter /FlateDecode")],
    ]), true);
  }
  const objects = new Map<number, Buffer>();
  objects.set(1, Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"));
  objects.set(2, Buffer.from(`<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, index) => `${4 + index * 2} 0 R`).join(" ")}] /Count ${pages} >>`));
  objects.set(3, Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"));
  for (let index = 0; index < pages; index++) {
    objects.set(4 + index * 2, Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${reuse ? 5 : 5 + index * 2} 0 R >>`));
    objects.set(5 + index * 2, stream(encoded, `/Filter ${filter}`));
  }
  return serialize(objects);
}

function serialize(objects: Map<number, Buffer>, compressedPage = false): Uint8Array {
  const pieces = [Buffer.from("%PDF-1.7\n")];
  const offsets = new Map<number, number>();
  let offset = pieces[0].length;
  for (const [id, body] of objects) {
    offsets.set(id, offset);
    const part = Buffer.concat([Buffer.from(`${id} 0 obj\n`), body, Buffer.from("\nendobj\n")]);
    pieces.push(part); offset += part.length;
  }
  if (compressedPage) {
    const xref = Buffer.alloc(8 * 7);
    for (let id = 0; id < 8; id++) {
      xref[id * 7] = id === 0 ? 0 : id === 3 ? 2 : 1;
      xref.writeUInt32BE(id === 3 ? 6 : id === 7 ? offset : offsets.get(id) ?? 0, id * 7 + 1);
      xref.writeUInt16BE(id === 0 ? 65535 : 0, id * 7 + 5);
    }
    pieces.push(Buffer.from(`7 0 obj\n<< /Type /XRef /Size 8 /Root 1 0 R /W [1 4 2] /Length ${xref.length} >>\nstream\n`), xref, Buffer.from(`\nendstream\nendobj\nstartxref\n${offset}\n%%EOF\n`));
  } else {
    const count = Math.max(...objects.keys()) + 1;
    pieces.push(Buffer.from(`xref\n0 ${count}\n0000000000 65535 f \n${Array.from({ length: count - 1 }, (_, index) => `${String(offsets.get(index + 1)).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`));
  }
  return new Uint8Array(Buffer.concat(pieces));
}
