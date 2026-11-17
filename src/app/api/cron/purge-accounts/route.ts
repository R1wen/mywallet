import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";
import { purgeDueAccounts } from "@/lib/server/account";

/**
 * Daily purge of the accounts whose deletion delay is over (ADR-043). Called by Vercel
 * Cron with `Authorization: Bearer <CRON_SECRET>`; disabled when no secret is set.
 */
function authorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(req: Request) {
  const secret = serverEnv().CRON_SECRET;
  if (!secret) return new Response(null, { status: 503 });
  if (!authorized(req.headers.get("authorization"), secret)) {
    return new Response(null, { status: 401 });
  }
  const erased = await purgeDueAccounts();
  // Only a count is logged: no identifier of the erased accounts.
  console.warn(`[purge-accounts] ${erased} compte(s) effacé(s)`);
  return Response.json({ erased }, { headers: { "cache-control": "no-store" } });
}
