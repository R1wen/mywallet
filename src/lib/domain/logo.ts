/** Merchant logo resolution (pure, ADR-022): upload > brand icon > favicon > monogram. */

export type LogoChoice = "upload" | "none" | null;

export type ResolvedLogo =
  { kind: "upload" } | { kind: "brand"; slug: string } | { kind: "favicon" } | { kind: "monogram" };

export function resolveLogo(input: {
  /** User choice: "upload" (own file), "none" (force monogram), null (automatic). */
  logoSource: LogoChoice | string;
  hasUpload: boolean;
  brandSlug: string | null;
  domain: string | null;
}): ResolvedLogo {
  if (input.logoSource === "none") return { kind: "monogram" };
  if (input.logoSource === "upload" && input.hasUpload) return { kind: "upload" };
  if (input.brandSlug) return { kind: "brand", slug: input.brandSlug };
  if (input.domain) return { kind: "favicon" };
  return { kind: "monogram" };
}

const DAY_MS = 86_400_000;
export const LOGO_CACHE_TTL_DAYS = { ok: 30, missing: 7 } as const;

/** A found favicon is kept 30 days, a miss 7 days, then fetched again. */
export function isLogoCacheFresh(
  entry: { status: "ok" | "missing"; fetchedAt: Date },
  now: Date,
): boolean {
  return now.getTime() - entry.fetchedAt.getTime() < LOGO_CACHE_TTL_DAYS[entry.status] * DAY_MS;
}

export type RasterImageType =
  "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/x-icon";

const startsWith = (b: Uint8Array, sig: readonly number[], offset = 0) =>
  b.length >= offset + sig.length && sig.every((v, i) => b[offset + i] === v);

/**
 * Detects a raster image from its magic bytes. SVG and anything else return null:
 * remote or uploaded SVG can carry scripts, so it is never stored nor served.
 */
export function detectImageType(bytes: Uint8Array): RasterImageType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image/webp";
  }
  if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00])) return "image/x-icon";
  return null;
}
