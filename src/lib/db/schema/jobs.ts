/**
 * Postgres job queue (ADR-009). Claimed in short batches with
 *   select ... from jobs where status = 'queued' and run_at <= now()
 *   order by run_at limit n for update skip locked
 * then set status = 'running', locked_at, locked_by, attempts + 1.
 * `user_id` is nullable: system jobs (cleanup, catalogue refresh) have no owner;
 * user jobs are deleted with the user.
 */
import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { inList, timestamps } from "./columns";

export const JOB_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const jobs = pgTable(
  "jobs",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text().references(() => user.id, { onDelete: "cascade" }),
    type: text().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    status: text().$type<JobStatus>().notNull().default("queued"),
    runAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    attempts: integer().notNull().default(0),
    maxAttempts: integer().notNull().default(5),
    lockedAt: timestamp({ withTimezone: true }),
    lockedBy: text(),
    lastError: text(),
    ...timestamps,
  },
  (t) => [
    // Dequeue: status = 'queued' and run_at <= now() order by run_at ... skip locked.
    index("jobs_status_run_at_idx").on(t.status, t.runAt),
    // Reclaim stale locks of crashed batches.
    index("jobs_running_locked_at_idx")
      .on(t.lockedAt)
      .where(sql`${t.status} = 'running'`),
    index("jobs_user_id_idx").on(t.userId, t.createdAt.desc()),
    check("jobs_status_check", sql`${t.status} in (${inList(JOB_STATUSES)})`),
    check("jobs_type_check", sql`btrim(${t.type}) <> ''`),
    check(
      "jobs_attempts_check",
      sql`${t.maxAttempts} >= 1 and ${t.attempts} >= 0 and ${t.attempts} <= ${t.maxAttempts}`,
    ),
    check(
      "jobs_lock_check",
      sql`${t.status} <> 'running' or (${t.lockedAt} is not null and ${t.lockedBy} is not null)`,
    ),
  ],
);
