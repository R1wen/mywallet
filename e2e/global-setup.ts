import { Pool } from "pg";

/**
 * The e2e suite signs up several accounts from the same IP: reset Better Auth's rate-limit
 * counters first, so a rerun within 10 minutes is not throttled. Local or CI databases only.
 */
export default async function globalSetup(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) return;
  const { hostname } = new URL(url);
  if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
    throw new Error(`e2e: refusing to reset rate limits on a non-local database (${hostname}).`);
  }
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await pool.query("delete from rate_limit");
  } finally {
    await pool.end();
  }
}
