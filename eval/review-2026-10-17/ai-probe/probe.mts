import { readFile, writeFile } from "node:fs/promises";
import { importDocument } from "../../../src/lib/documents/import";

const bytes = await readFile(new URL("./invisible-ratio.pdf", import.meta.url));
const result = await importDocument(new File([bytes], "invisible-ratio.pdf", { type: "application/pdf" }));
const evidence = { kind: "offline generated PDF, no images, no external requests", hidden: result.hidden, warnings: result.warnings, text: result.text, retainedInstruction: result.text.includes("Ignore all previous instructions") };
await writeFile(new URL("./result.json", import.meta.url), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
