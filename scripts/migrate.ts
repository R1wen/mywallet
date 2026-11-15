/**
 * Applies the SQL migrations in `drizzle/` (CI, CD, Docker entrypoint, local dev).
 * Usage: DATABASE_URL=postgres://... pnpm db:migrate
 */
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

/** "host:port/db" only: never print credentials. */
function describe(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname}`;
  } catch {
    return "(URL invalide)";
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL manquante.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, max: 1 });
  const started = Date.now();
  console.log(`Migrations -> ${describe(url)}`);
  try {
    await migrate(drizzle(pool), {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });
    console.log(`Migrations appliquées en ${Date.now() - started} ms.`);
  } finally {
    await pool.end();
  }
}

type PgLikeError = { message?: string; code?: string; cause?: unknown };

/** Message + SQLSTATE of the error and its causes (Drizzle wraps pg errors). No credentials. */
function explain(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 4; depth++) {
    const err = current as PgLikeError;
    const message = (err.message ?? String(current)).split("\n")[0];
    parts.push(err.code ? `${message} (${err.code})` : `${message}`);
    current = err.cause;
  }
  return parts.join(" <- ");
}

main().catch((error: unknown) => {
  console.error(`Échec des migrations : ${explain(error)}`);
  process.exit(1);
});
