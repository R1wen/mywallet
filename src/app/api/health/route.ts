import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { db } from "@/lib/db/client";

/** Sonde de santé (CD, Docker) : vérifie que l'app répond et que la base est joignable. */
export async function GET() {
  await connection();
  const started = Date.now();
  try {
    await db.execute(sql`select 1`);
    return Response.json(
      { status: "ok", db: "ok", latencyMs: Date.now() - started },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    // Aucun détail d'erreur exposé (pas de fuite de configuration).
    return Response.json(
      { status: "error", db: "unreachable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
