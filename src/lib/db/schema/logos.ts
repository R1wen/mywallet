/**
 * Favicon cache shared by all users (ADR-022). Keyed by domain only: it holds no user data,
 * so it is the one table without `user_id`. Rows are written by the server after fetching
 * from fixed providers; nothing here is ever derived from a request body.
 */
import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { bytea, inList } from "./columns";

export const LOGO_CACHE_STATUSES = ["ok", "missing"] as const;
export type LogoCacheStatus = (typeof LOGO_CACHE_STATUSES)[number];

/** 64 KiB is plenty for a 64 px favicon. */
export const LOGO_CACHE_MAX_BYTES = 65_536;

export const logoCache = pgTable(
  "logo_cache",
  {
    domain: text().primaryKey(),
    status: text().$type<LogoCacheStatus>().notNull(),
    contentType: text(),
    data: bytea("data"),
    fetchedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("logo_cache_status_check", sql`${t.status} in (${inList(LOGO_CACHE_STATUSES)})`),
    check(
      "logo_cache_payload_check",
      sql`(${t.status} = 'ok' and ${t.data} is not null and ${t.contentType} is not null
            and octet_length(${t.data}) <= ${sql.raw(String(LOGO_CACHE_MAX_BYTES))})
        or (${t.status} = 'missing' and ${t.data} is null)`,
    ),
  ],
);
