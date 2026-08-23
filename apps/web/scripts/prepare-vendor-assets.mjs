import { copyFile, cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const pdfWorkerSource = require.resolve("pdfjs-dist/build/pdf.worker.min.mjs");
const pdfWorkerTarget = resolve(appRoot, "public/vendor/pdf.worker.min.mjs");
const excalidrawProductionRoot = dirname(
  require.resolve("@excalidraw/excalidraw"),
);
const excalidrawAssetTarget = resolve(appRoot, "public/vendor/excalidraw");

await Promise.all([
  mkdir(dirname(pdfWorkerTarget), { recursive: true }),
  mkdir(excalidrawAssetTarget, { recursive: true }),
]);
await Promise.all([
  copyFile(pdfWorkerSource, pdfWorkerTarget),
  copyFile(
    resolve(excalidrawProductionRoot, "index.css"),
    resolve(excalidrawAssetTarget, "index.css"),
  ),
  cp(
    resolve(excalidrawProductionRoot, "fonts"),
    resolve(excalidrawAssetTarget, "fonts"),
    { recursive: true, force: true },
  ),
]);
