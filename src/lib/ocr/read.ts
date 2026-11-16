/**
 * Reads an uploaded receipt in the browser and sends only the raw text to the server,
 * which parses and checks it itself. A failed read never loses the file: the receipt
 * goes to "à saisir" (manual entry). Client only.
 */
import { startReading, submitOcr } from "@/lib/actions/imports";
import { recognize, type OcrProgress } from "./engine";
import type { OcrSource } from "./prepare";

const MAX_TEXT = 50_000;

export async function readReceipt(
  receiptId: string,
  source: OcrSource,
  onProgress?: OcrProgress,
): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  await startReading(receiptId);
  let payload: {
    ocrText: string;
    ocrEngine: "tesseract" | "paddle" | "pdf-text" | null;
    failure: "ocr_failed" | "unsupported" | "empty" | null;
  };
  if (source.kind === "text") {
    payload = { ocrText: source.text.slice(0, MAX_TEXT), ocrEngine: "pdf-text", failure: null };
  } else if (source.kind === "none") {
    payload = { ocrText: "", ocrEngine: null, failure: source.failure };
  } else {
    const result = await recognize(source.image, onProgress).catch(() => null);
    payload = result
      ? { ocrText: result.text.slice(0, MAX_TEXT), ocrEngine: result.engine, failure: null }
      : { ocrText: "", ocrEngine: null, failure: "ocr_failed" };
  }
  const r = await submitOcr({ receiptId, ...payload });
  return r.ok ? { ok: true, status: r.data.status } : { ok: false, error: r.error };
}
