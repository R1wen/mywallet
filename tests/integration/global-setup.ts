/**
 * Prépare la base de test une fois pour toute la suite : schéma vidé puis migrations appliquées.
 * Refuse de tourner sur une base dont le nom ne contient pas "test" (protection des données).
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

export const DEFAULT_TEST_URL = "postgres://mywallet:mywallet@localhost:5433/mywallet_test";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_URL;
  const dbName = new URL(url).pathname.slice(1);
  if (!/test/i.test(dbName)) {
    throw new Error(
      `Refus d'exécuter les tests d'intégration sur la base "${dbName}" (doit contenir "test").`,
    );
  }
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await pool.query(
      "drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;",
    );
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  } finally {
    await pool.end();
  }
}
