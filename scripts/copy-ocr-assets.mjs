// Copies the browser OCR / PDF assets from node_modules to public/vendor so they are
// served from the app origin (CSP 'self', ADR-031): no third-party CDN at runtime.
// Runs on postinstall; public/vendor is git-ignored.
import { copyFileSync, existsSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const modules = join(root, "node_modules");
// Package folders on disk (pnpm symlinks); tesseract.js-core sits next to tesseract.js.
const packageDir = (name) => {
  if (name === "tesseract.js-core") {
    return join(dirname(realpathSync(join(modules, "tesseract.js"))), "tesseract.js-core");
  }
  return join(modules, ...name.split("/"));
};
const resolve = (spec) => {
  const parts = spec.split("/");
  const name = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  const rest = parts.slice(name.split("/").length);
  return join(packageDir(name), ...rest);
};
const out = join(root, "public", "vendor");
mkdirSync(out, { recursive: true });

/** [package-relative source, destination name] */
const CORE = "tesseract.js-core";
const ASSETS = [
  ["pdfjs-dist/build/pdf.worker.min.mjs", "pdf.worker.min.mjs"],
  ["tesseract.js/dist/worker.min.js", "tesseract/worker.min.js"],
  // LSTM-only cores (the engine always runs OEM 1); the worker picks the SIMD variant.
  [`${CORE}/tesseract-core-lstm.wasm.js`, "tesseract/core/tesseract-core-lstm.wasm.js"],
  [`${CORE}/tesseract-core-simd-lstm.wasm.js`, "tesseract/core/tesseract-core-simd-lstm.wasm.js"],
  [
    `${CORE}/tesseract-core-relaxedsimd-lstm.wasm.js`,
    "tesseract/core/tesseract-core-relaxedsimd-lstm.wasm.js",
  ],
  ["@tesseract.js-data/fra/4.0.0_best_int/fra.traineddata.gz", "tesseract/lang/fra.traineddata.gz"],
  ["@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", "tesseract/lang/eng.traineddata.gz"],
];

let copied = 0;
for (const [source, name] of ASSETS) {
  const from = resolve(source);
  if (!existsSync(from)) {
    console.warn(`[copy-ocr-assets] introuvable : ${source}`);
    continue;
  }
  mkdirSync(dirname(join(out, name)), { recursive: true });
  copyFileSync(from, join(out, name));
  copied++;
}
console.warn(`[copy-ocr-assets] ${copied}/${ASSETS.length} fichiers copiés dans public/vendor`);
