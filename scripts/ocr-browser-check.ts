/**
 * Vérifie que l'OCR exécuté dans le navigateur (ppu-paddle-ocr/web + onnxruntime-web WASM,
 * tesseract.js navigateur) donne le même texte que le banc Node (`pnpm ocr:bench`).
 * Usage : pnpm ocr:bench:browser   (après pnpm ocr:bench, fixtures publiques uniquement)
 *
 * Mêmes images normalisées (avec redressement) que le banc Node, même modèle (PP-OCRv6 small), envoyées à Chromium (Playwright, headless,
 * WASM seul, page isolée cross-origin pour le multithread). Compare au fichier
 * ocr.tesseract.txt / ocr.paddle.txt écrit par le banc Node : distance d'édition relative.
 */
import { readdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { normalise } from "./ocr/normalise";

const ROOT = process.cwd();
const DIR = path.join(ROOT, "fixtures", "receipts");
const ORT_DIST = path.join(ROOT, "node_modules", "onnxruntime-web", "dist");

const ENTRY = `
import * as ort from "onnxruntime-web";
import { PaddleOcrService, V6_SMALL_MODEL } from "ppu-paddle-ocr/web";
import { createWorker } from "tesseract.js";
ort.env.wasm.wasmPaths = "/ort/";
let paddle = null;
let tess = null;
window.ocrInit = async () => {
  const t0 = performance.now();
  paddle = new PaddleOcrService({
    model: V6_SMALL_MODEL,
    session: { executionProviders: ["wasm"] },
    recognition: { mainThreadYieldMs: 0 },
  });
  await paddle.initialize();
  const t1 = performance.now();
  tess = await createWorker(["fra", "eng"], 1);
  return { paddleInit: t1 - t0, tessInit: performance.now() - t1, isolated: crossOriginIsolated, threads: ort.env.wasm.numThreads ?? null };
};
window.ocrRun = async (engine, url) => {
  const buf = await (await fetch(url)).arrayBuffer();
  const t = performance.now();
  let text;
  if (engine === "paddle") text = (await paddle.recognize(buf, { noCache: true })).text;
  else text = (await tess.recognize(new Blob([buf], { type: "image/png" }))).data.text;
  return { text, ms: performance.now() - t };
};
`;

function norm(s: string): string {
  return s
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function lev(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[y.length]!;
}

async function main() {
  const bundle = await build({
    stdin: { contents: ENTRY, resolveDir: ROOT, loader: "js" },
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
    logLevel: "error",
  });
  const js = bundle.outputFiles[0]!.text;

  const ids: string[] = [];
  const images = new Map<string, Buffer>();
  for (const d of (await readdir(DIR, { withFileTypes: true })).filter((x) => x.isDirectory())) {
    const files = await readdir(path.join(DIR, d.name));
    const src = files.find((f) => /^source\.(png|jpe?g|webp)$/i.test(f));
    if (!src) continue;
    ids.push(d.name);
    images.set(d.name, (await normalise(path.join(DIR, d.name, src), true)).png);
  }

  const server = createServer(async (req, res) => {
    const url = req.url ?? "/";
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
    try {
      if (url === "/") {
        res.setHeader("Content-Type", "text/html");
        return res.end(
          `<!doctype html><meta charset="utf-8"><script type="module" src="/app.js"></script>`,
        );
      }
      if (url === "/app.js") {
        res.setHeader("Content-Type", "text/javascript");
        return res.end(js);
      }
      if (url.startsWith("/ort/")) {
        const name = path.basename(url);
        res.setHeader(
          "Content-Type",
          name.endsWith(".wasm") ? "application/wasm" : "text/javascript",
        );
        return res.end(await readFile(path.join(ORT_DIST, name)));
      }
      if (url.startsWith("/img/")) {
        const img = images.get(decodeURIComponent(url.slice(5)));
        if (img) {
          res.setHeader("Content-Type", "image/png");
          return res.end(img);
        }
      }
      res.statusCode = 404;
      res.end();
    } catch {
      res.statusCode = 500;
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => console.error("pageerror", e.message));
    await page.goto(base);
    await page.waitForFunction(() => "ocrInit" in window);
    const init = await page.evaluate(() =>
      (window as unknown as { ocrInit: () => Promise<unknown> }).ocrInit(),
    );
    console.log("init navigateur", JSON.stringify(init));
    for (const engine of ["paddle", "tesseract"] as const) {
      const node = engine === "paddle" ? "ocr.paddle.txt" : "ocr.tesseract.txt";
      const times: number[] = [];
      let identical = 0;
      let dist = 0;
      let chars = 0;
      // Échauffement non compté, comme dans le banc Node.
      const runs = [ids[0]!, ...ids];
      for (let k = 0; k < runs.length; k++) {
        const id = runs[k]!;
        const r = await page.evaluate(
          ([e, u]) =>
            (
              window as unknown as {
                ocrRun: (e: string, u: string) => Promise<{ text: string; ms: number }>;
              }
            ).ocrRun(e, u),
          [engine, `${base}/img/${encodeURIComponent(id)}`] as const,
        );
        if (k === 0) continue;
        times.push(r.ms);
        const ref = norm(await readFile(path.join(DIR, id, node), "utf8"));
        const got = norm(r.text);
        if (ref === got) identical++;
        dist += lev(ref, got);
        chars += [...ref].length;
      }
      const sorted = [...times].sort((a, b) => a - b);
      const mean = times.reduce((s, x) => s + x, 0) / times.length;
      const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1]!;
      console.log(
        `${engine}: ${identical}/${ids.length} textes identiques au banc Node, écart ${((100 * dist) / Math.max(1, chars)).toFixed(2)} % des caractères, ` +
          `temps navigateur moyen ${Math.round(mean)} ms, p95 ${Math.round(p95)} ms`,
      );
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
