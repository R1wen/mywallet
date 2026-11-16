/**
 * Receipt upload checks (pure). The real type comes from the magic bytes, never from
 * the file name or the browser-provided MIME type.
 */

export const UPLOAD_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
] as const;
export type UploadType = (typeof UPLOAD_TYPES)[number];

const MB = 1024 * 1024;

/**
 * Photos are normally resized and re-encoded in the browser before upload (ADR-027),
 * so these limits only bound what reaches the server when that step is skipped.
 */
export const MAX_UPLOAD_BYTES: Record<UploadType, number> = {
  "image/jpeg": 8 * MB,
  "image/png": 8 * MB,
  "image/webp": 8 * MB,
  "image/heic": 12 * MB,
  "application/pdf": 8 * MB,
};

export const UPLOAD_EXTENSIONS: Record<UploadType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

const matches = (b: Uint8Array, sig: readonly number[], offset = 0) =>
  b.length >= offset + sig.length && sig.every((v, i) => b[offset + i] === v);

const ascii = (b: Uint8Array, from: number, to: number) =>
  b.length >= to ? String.fromCharCode(...b.subarray(from, to)) : "";

/** Detects an accepted receipt file from its first bytes (at least 16 are needed). */
export function detectUploadType(bytes: Uint8Array): UploadType | null {
  if (matches(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (matches(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  if (ascii(bytes, 0, 5) === "%PDF-") return "application/pdf";
  if (ascii(bytes, 4, 8) === "ftyp" && HEIF_BRANDS.has(ascii(bytes, 8, 12))) return "image/heic";
  return null;
}

/** Returns a French error message, or null when the upload is acceptable. */
export function checkUpload(input: { type: UploadType | null; size: number }): string | null {
  if (!input.type) return "Format non pris en charge (JPG, PNG, WebP, HEIC ou PDF).";
  if (input.size <= 0) return "Fichier vide.";
  const max = MAX_UPLOAD_BYTES[input.type];
  if (input.size > max) return `Fichier trop volumineux (${max / MB} Mo maximum).`;
  return null;
}

const MAX_NAME = 120;

/**
 * Display-only file name: last path segment, no control/bidi characters, no markup
 * characters, at most 120 characters with the extension kept. Never used as a path.
 */
export function sanitizeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";

  let name = base.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, "");
  name = name.replace(/[<>:"|?*]/g, "").trim();
  if (!name.replace(/\./g, "")) return "fichier";
  if (name.length <= MAX_NAME) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 6 ? name.slice(dot) : "";
  return name.slice(0, MAX_NAME - ext.length) + ext;
}
