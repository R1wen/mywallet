/**
 * Shared column builders for user-owned tables (not exported from the schema index).
 * Rules: uuid PKs, `user_id` cascading from `user`, money as bigint cents + currency,
 * timestamptz audit columns. Column names come from `casing: "snake_case"`.
 */
import { sql } from "drizzle-orm";
import { bigint, char, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const id = () => uuid("id").primaryKey().defaultRandom();

/** Owner of the row. Deleting the user deletes everything they own. */
export const ownerId = () =>
  text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" });

/** Integer cents (never floats). `name` must end with `_cents`. */
export const cents = (name: `${string}_cents`) => bigint(name, { mode: "number" });

export const currency = () => char("currency", { length: 3 }).notNull().default("EUR");

/** SQL list of string literals for `col in (...)` CHECKs. Only for compile-time constants. */
export const inList = (values: readonly string[]) =>
  sql.raw(values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", "));

export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};
