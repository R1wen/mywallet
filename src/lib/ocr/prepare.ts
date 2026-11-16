/**
 * Browser-side preparation of a receipt file before upload and OCR (ADR-008, ADR-027):
 * HEIC converted to JPEG, EXIF orientation applied, photo resized and re-encoded,
 * thumbnail generated, PDF text layer read directly (no OCR when it exists).
 * Client only: uses canvas, createImageBitmap and dynamic imports.
 */
import type * as PdfJsModule from "pdfjs-dist";
import { detectUploadType, type UploadType } from "@/lib/domain/files";

export const MAX_SIDE = 2000;
const THUMB_SIDE = 320;

export type OcrSource =
  | { kind: "image"; image: ImageBitmap | HTMLCanvasElement }
  | { kind: "text"; text: string }
  | { kind: "none"; failure: "unsupported" | "ocr_failed" };

export type PreparedReceipt = {
  /** What is uploaded: the re-encoded JPEG, or the original PDF. */
  upload: Blob;
  filename: string;
  thumbnail: Blob | null;
  ocr: OcrSource;
};

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(width));
  c.height = Math.max(1, Math.round(height));
  return c;
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", quality),
  );
}

function draw(source: CanvasImageSource, w: number, h: number, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = canvasOf(w * scale, h * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Grayscale + contrast copy used for OCR only (the stored image keeps its colours). */
export function forOcr(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = canvasOf(source.width, source.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return source;
  ctx.filter = "grayscale(1) contrast(1.35)";
  ctx.drawImage(source, 0, 0);
  return canvas;
}

const renamed = (name: string, ext: string) => `${name.replace(/\.[^.]+$/, "") || "ticket"}.${ext}`;

async function prepareImage(blob: Blob, filename: string): Promise<PreparedReceipt> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  try {
    const full = draw(bitmap, bitmap.width, bitmap.height, MAX_SIDE);
    const thumb = draw(bitmap, bitmap.width, bitmap.height, THUMB_SIDE);
    const [upload, thumbnail] = await Promise.all([toBlob(full, 0.85), toBlob(thumb, 0.7)]);
    return {
      upload,
      filename: renamed(filename, "jpg"),
      thumbnail,
      ocr: { kind: "image", image: forOcr(full) },
    };
  } finally {
    bitmap.close();
  }
}

type PdfJs = typeof PdfJsModule;
let pdfjs: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  pdfjs ??= import("pdfjs-dist").then((m) => {
    // Worker served from this origin (copied by scripts/copy-ocr-assets.mjs): CSP 'self'.
    m.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.mjs";
    return m;
  });
  return pdfjs;
}

const MIN_PDF_TEXT = 40;
const MAX_PDF_PAGES = 3;

async function preparePdf(file: Blob, filename: string): Promise<PreparedReceipt> {
  const { getDocument } = await loadPdfJs();
  const task = getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    disableFontFace: true,
    enableXfa: false,
  });
  const doc = await task.promise;
  try {
    const pages = Math.min(doc.numPages, MAX_PDF_PAGES);
    const texts: string[] = [];
    let thumbnail: Blob | null = null;
    let firstCanvas: HTMLCanvasElement | null = null;
    for (let n = 1; n <= pages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      // Rebuild lines from the text items' vertical positions.
      const lines = new Map<number, { x: number; s: string }[]>();
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const y = Math.round(item.transform[5] / 2);
        const list = lines.get(y) ?? [];
        list.push({ x: item.transform[4], s: item.str });
        lines.set(y, list);
      }
      texts.push(
        [...lines.entries()]
          .sort((a, b) => b[0] - a[0])
          .map(([, parts]) =>
            parts
              .sort((a, b) => a.x - b.x)
              .map((p) => p.s)
              .join("  "),
          )
          .join("\n"),
      );
      if (n === 1) {
        const viewport = page.getViewport({ scale: 2 });
        const canvas = canvasOf(viewport.width, viewport.height);
        await page.render({ canvas, viewport }).promise;
        firstCanvas = canvas;
        thumbnail = await toBlob(draw(canvas, canvas.width, canvas.height, THUMB_SIDE), 0.7);
      }
    }
    const text = texts.join("\n").trim();
    const ocr: OcrSource =
      text.length >= MIN_PDF_TEXT
        ? { kind: "text", text }
        : firstCanvas
          ? { kind: "image", image: forOcr(firstCanvas) }
          : { kind: "none", failure: "ocr_failed" };
    return { upload: file, filename, thumbnail, ocr };
  } finally {
    await task.destroy();
  }
}

/** Reads the first bytes to know the real type, whatever the extension says. */
export async function sniff(file: Blob): Promise<UploadType | null> {
  return detectUploadType(new Uint8Array(await file.slice(0, 32).arrayBuffer()));
}

export async function prepareReceipt(file: File): Promise<PreparedReceipt> {
  const type = await sniff(file);
  if (type === "application/pdf") return preparePdf(file, file.name);
  if (type === "image/heic") {
    try {
      const { default: heic2any } = await import("heic2any");
      const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
      return await prepareImage(Array.isArray(converted) ? converted[0]! : converted, file.name);
    } catch {
      // Conversion impossible: the original is kept and entered by hand.
      return {
        upload: file,
        filename: file.name,
        thumbnail: null,
        ocr: { kind: "none", failure: "unsupported" },
      };
    }
  }
  if (type) {
    try {
      return await prepareImage(file, file.name);
    } catch {
      return {
        upload: file,
        filename: file.name,
        thumbnail: null,
        ocr: { kind: "none", failure: "ocr_failed" },
      };
    }
  }
  // Unknown type: sent as is, the server refuses it with a clear message.
  return {
    upload: file,
    filename: file.name,
    thumbnail: null,
    ocr: { kind: "none", failure: "unsupported" },
  };
}

/** Image of an already uploaded receipt, for reading it again from the review screen. */
export async function loadStoredImage(id: string, mimeType: string): Promise<OcrSource> {
  const res = await fetch(`/api/receipts/${id}/original`);
  if (!res.ok) return { kind: "none", failure: "ocr_failed" };
  const blob = await res.blob();
  if (mimeType === "application/pdf") return (await preparePdf(blob, "ticket.pdf")).ocr;
  if (mimeType === "image/heic") return { kind: "none", failure: "unsupported" };
  return (await prepareImage(blob, "ticket.jpg")).ocr;
}
