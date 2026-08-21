import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const pdfWorkerSource = require.resolve("pdfjs-dist/build/pdf.worker.min.mjs");
const pdfWorkerTarget = resolve(appRoot, "public/vendor/pdf.worker.min.mjs");

await mkdir(dirname(pdfWorkerTarget), { recursive: true });
await copyFile(pdfWorkerSource, pdfWorkerTarget);
