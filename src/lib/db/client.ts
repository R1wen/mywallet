import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { serverEnv } from "@/lib/env";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { __mwPool?: Pool };

/** One pool per server instance (reused across hot reloads in dev). */
const pool =
  globalForDb.__mwPool ??
  new Pool({
    connectionString: serverEnv().DATABASE_URL,
    max: process.env.VERCEL ? 3 : 10,
    idleTimeoutMillis: 10_000,
  });
if (process.env.NODE_ENV !== "production") globalForDb.__mwPool = pool;

export const db = drizzle(pool, { schema, casing: "snake_case" });
export type Db = typeof db;
/** The pool or an open transaction: repository helpers accept either. */
export type Conn = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];
