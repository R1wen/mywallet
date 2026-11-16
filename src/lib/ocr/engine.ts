/**
 * In-browser OCR (ADR-008). Engines sit behind `OcrEngine` and are tried in order until
 * one returns text; all assets are served from this origin (public/vendor, ADR-031).
 * Client only.
 */
import type * as Tesseract from "tesseract.js";
import type { OcrEngineName } from "@/lib/validation/imports";

export type OcrImage = ImageBitmap | HTMLCanvasElement;
export type OcrProgress = (ratio: number) => void;

export interface OcrEngine {
  name: OcrEngineName;
  recognize(image: OcrImage, onProgress?: OcrProgress): Promise<string>;
}

type TesseractWorker = Tesseract.Worker;
let tesseractWorker: Promise<TesseractWorker> | null = null;
let progressListener: OcrProgress | undefined;

function getTesseract(): Promise<TesseractWorker> {
  tesseractWorker ??= import("tesseract.js").then(({ createWorker, OEM }) =>
    createWorker(["fra", "eng"], OEM.LSTM_ONLY, {
      workerPath: "/vendor/tesseract/worker.min.js",
      corePath: "/vendor/tesseract/core",
      langPath: "/vendor/tesseract/lang",
      gzip: true,
      logger: (m: { status: string; progress: number }) => {
        if (m.status === "recognizing text") progressListener?.(m.progress);
      },
    }),
  );
  return tesseractWorker;
}

export const tesseractEngine: OcrEngine = {
  name: "tesseract",
  async recognize(image, onProgress) {
    const worker = await getTesseract();
    progressListener = onProgress;
    try {
      const { data } = await worker.recognize(image as HTMLCanvasElement);
      return data.text;
    } finally {
      progressListener = undefined;
    }
  },
};

/** Default first, fallbacks after (set from docs/OCR-BENCHMARK.md). */
export const OCR_ENGINES: OcrEngine[] = [tesseractEngine];

export async function recognize(
  image: OcrImage,
  onProgress?: OcrProgress,
): Promise<{ text: string; engine: OcrEngineName } | null> {
  for (const engine of OCR_ENGINES) {
    try {
      const text = await engine.recognize(image, onProgress);
      if (text.trim()) return { text, engine: engine.name };
    } catch {
      // Next engine.
    }
  }
  return null;
}
