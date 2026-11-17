import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { EXPORT_TABLES, exportProfile, exportTablePage } from "@/lib/server/export";

/**
 * Full export of my data (ADR-042), one table page at a time so each response stays
 * small; the browser assembles the archive. `?part=profil` returns the profile.
 */
const querySchema = z.object({
  part: z.enum(["profil", ...(Object.keys(EXPORT_TABLES) as [keyof typeof EXPORT_TABLES])]),
  page: z.coerce.number().int().min(0).max(10_000).catch(0),
});

const NO_STORE = { "cache-control": "private, no-store", "content-type": "application/json" };

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 401 });
  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return new Response(null, { status: 400 });
  const { part, page } = parsed.data;
  const body =
    part === "profil"
      ? { rows: [await exportProfile(user.id)], hasMore: false }
      : await exportTablePage(user.id, part, page);
  return new Response(JSON.stringify(body), { headers: NO_STORE });
}
