import "server-only";
import { and, eq } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db/client";
import { LOGO_CACHE_MAX_BYTES, logoCache, merchants } from "@/lib/db/schema";
import { detectImageType, isLogoCacheFresh, type RasterImageType } from "@/lib/domain/logo";
import { normalizeDomain } from "@/lib/domain/merchant";

/**
 * Favicon resolution with a durable database cache (ADR-022). The server only ever talks
 * to these fixed providers; the merchant domain is a URL parameter, never a host.
 */
const PROVIDERS = [
  (domain: string) =>
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`,
  (domain: string) => `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`,
];
/** Hosts a provider may redirect to (Google serves favicons from gstatic). */
const ALLOWED_HOSTS = /(^|\.)(google\.com|gstatic\.com|duckduckgo\.com)$/;
const TIMEOUT_MS = 4000;

export type LogoImage = { contentType: RasterImageType; data: Buffer };

/**
 * "missing" only when a provider answered without a usable image (404, not an image, too
 * big). Timeouts, network errors and 5xx are "unavailable": nothing is cached, so a short
 * provider outage does not hide a logo for days.
 */
async function fetchFavicon(domain: string): Promise<LogoImage | "missing" | "unavailable"> {
  let answered = false;
  for (const url of PROVIDERS.map((p) => p(domain))) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "user-agent": "myWallet-logo-fetcher" },
      });
      if (res.status >= 500) continue;
      answered = true;
      if (!res.ok || !ALLOWED_HOSTS.test(new URL(res.url || url).hostname)) continue;
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > LOGO_CACHE_MAX_BYTES) continue;
      const data = Buffer.from(await res.arrayBuffer());
      if (data.length === 0 || data.length > LOGO_CACHE_MAX_BYTES) continue;
      const contentType = detectImageType(data);
      if (contentType) return { contentType, data };
    } catch {
      // Provider down or slow: try the next one.
    }
  }
  return answered ? "missing" : "unavailable";
}

/** Favicon for a domain, from the cache when fresh, otherwise fetched and cached. */
export async function getFavicon(
  rawDomain: string,
  db: Db = defaultDb,
  now: Date = new Date(),
): Promise<LogoImage | null> {
  const domain = normalizeDomain(rawDomain);
  if (!domain) return null;
  const [cached] = await db.select().from(logoCache).where(eq(logoCache.domain, domain));
  if (cached && isLogoCacheFresh(cached, now)) {
    return cached.status === "ok" && cached.data && cached.contentType
      ? { contentType: cached.contentType as RasterImageType, data: cached.data }
      : null;
  }
  const result = await fetchFavicon(domain);
  if (result === "unavailable") return null;
  const image = result === "missing" ? null : result;
  const row = image
    ? { status: "ok" as const, contentType: image.contentType, data: image.data }
    : { status: "missing" as const, contentType: null, data: null };
  await db
    .insert(logoCache)
    .values({ domain, ...row, fetchedAt: now })
    .onConflictDoUpdate({ target: logoCache.domain, set: { ...row, fetchedAt: now } });
  return image;
}

/**
 * Image behind `/api/merchants/[id]/logo` for the owner of the merchant: the uploaded
 * logo, otherwise the domain favicon. Null when there is nothing to show (monogram).
 */
export async function getMerchantLogoImage(
  userId: string,
  merchantId: string,
  db: Db = defaultDb,
): Promise<LogoImage | null> {
  const [m] = await db
    .select({
      domain: merchants.domain,
      logoSource: merchants.logoSource,
      logoContentType: merchants.logoContentType,
      logoData: merchants.logoData,
    })
    .from(merchants)
    .where(and(eq(merchants.userId, userId), eq(merchants.id, merchantId)));
  if (!m || m.logoSource === "none") return null;
  if (m.logoSource === "upload" && m.logoData && m.logoContentType) {
    return { contentType: m.logoContentType as RasterImageType, data: m.logoData };
  }
  return m.domain ? getFavicon(m.domain, db) : null;
}
