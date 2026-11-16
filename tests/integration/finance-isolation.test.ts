/**
 * DB-level isolation (ADR-010): composite FKs (user_id, x_id) make it impossible for a row
 * of user B to reference a row of user A, whatever the data access layer does.
 * Also covers the claim payment / reimbursement invariants enforced by the schema.
 */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const A = `iso-a-${randomUUID()}`;
const B = `iso-b-${randomUUID()}`;

/** Ids of user A's rows that user B will try to reference. */
const a = {
  account: randomUUID(),
  category: randomUUID(),
  merchant: randomUUID(),
  person: randomUUID(),
  expense: randomUUID(),
  item: randomUUID(),
  claim: randomUUID(),
  reimbursement: randomUUID(),
};
const bAccount = randomUUID();
const bExpense = randomUUID();

async function q(text: string, values: unknown[] = []) {
  return pool.query(text, values);
}

beforeAll(async () => {
  for (const [id, email] of [
    [A, `${A}@test.local`],
    [B, `${B}@test.local`],
  ]) {
    await q(`insert into "user" (id, name, email) values ($1, 'Test', $2)`, [id, email]);
  }
  await q(`insert into accounts (id, user_id, name) values ($1, $2, 'A'), ($3, $4, 'B')`, [
    a.account,
    A,
    bAccount,
    B,
  ]);
  await q(
    `insert into categories (id, user_id, name, kind) values ($1, $2, 'Courses', 'expense')`,
    [a.category, A],
  );
  await q(
    `insert into merchants (id, user_id, name, normalized_name) values ($1, $2, 'Lidl', 'lidl')`,
    [a.merchant, A],
  );
  await q(`insert into people (id, user_id, name) values ($1, $2, 'Léa')`, [a.person, A]);
  await q(
    `insert into transactions (id, user_id, account_id, kind, amount_cents, occurred_on, label)
     values ($1, $2, $3, 'expense', -8000, '2026-11-01', 'Courses'),
            ($4, $2, $3, 'reimbursement', 1000, '2026-11-03', 'Remboursement Léa')`,
    [a.expense, A, a.account, a.reimbursement],
  );
  await q(
    `insert into transactions (id, user_id, account_id, kind, amount_cents, occurred_on, label)
     values ($1, $2, $3, 'expense', -500, '2026-11-01', 'B')`,
    [bExpense, B, bAccount],
  );
  await q(
    `insert into transaction_items (id, user_id, transaction_id, label, total_cents)
     values ($1, $2, $3, 'Saumon', 3000)`,
    [a.item, A, a.expense],
  );
  await q(
    `insert into claims (id, user_id, person_id, transaction_id, amount_cents)
     values ($1, $2, $3, $4, 3000)`,
    [a.claim, A, a.person, a.expense],
  );
});

afterAll(async () => {
  await q(`delete from "user" where id = any($1)`, [[A, B]]);
  await pool.end();
});

const FK_VIOLATION = { code: "23503" };
const CHECK_VIOLATION = { code: "23514" };

describe("user B cannot reference user A's rows", () => {
  const cases: [string, () => Promise<unknown>][] = [
    [
      "transaction on A's account",
      () =>
        q(
          `insert into transactions (user_id, account_id, kind, amount_cents, occurred_on, label)
           values ($1, $2, 'expense', -100, '2026-11-01', 'x')`,
          [B, a.account],
        ),
    ],
    [
      "transaction with A's category and merchant",
      () =>
        q(
          `insert into transactions (user_id, account_id, kind, amount_cents, occurred_on, label, category_id, merchant_id)
           values ($1, $2, 'expense', -100, '2026-11-01', 'x', $3, $4)`,
          [B, bAccount, a.category, a.merchant],
        ),
    ],
    [
      "item on A's transaction",
      () =>
        q(
          `insert into transaction_items (user_id, transaction_id, label, total_cents) values ($1, $2, 'x', 1)`,
          [B, a.expense],
        ),
    ],
    [
      "claim for A's person",
      () =>
        q(
          `insert into claims (user_id, person_id, transaction_id, amount_cents) values ($1, $2, $3, 100)`,
          [B, a.person, bExpense],
        ),
    ],
    [
      "claim payment on A's claim",
      () =>
        q(
          `insert into claim_payments (user_id, claim_id, transaction_id, amount_cents) values ($1, $2, $3, 100)`,
          [B, a.claim, a.reimbursement],
        ),
    ],
    [
      "receipt linked to A's transaction",
      () =>
        q(
          `insert into receipts (user_id, transaction_id, file_key, mime_type, size_bytes, sha256)
           values ($1, $2, 'k', 'image/jpeg', 10, repeat('a', 64))`,
          [B, a.expense],
        ),
    ],
    [
      "budget on A's category",
      () =>
        q(
          `insert into budgets (user_id, category_id, amount_cents, starts_on) values ($1, $2, 100, '2026-11-01')`,
          [B, a.category],
        ),
    ],
    [
      "sub-category under A's category",
      () =>
        q(
          `insert into categories (user_id, parent_id, name, kind) values ($1, $2, 'x', 'expense')`,
          [B, a.category],
        ),
    ],
  ];

  it.each(cases)("%s is rejected", async (_label, run) => {
    await expect(run()).rejects.toMatchObject(FK_VIOLATION);
  });
});

describe("financial invariants", () => {
  it("rejects an expense with a positive amount", async () => {
    await expect(
      q(
        `insert into transactions (user_id, account_id, kind, amount_cents, occurred_on, label)
         values ($1, $2, 'expense', 100, '2026-11-01', 'x')`,
        [A, a.account],
      ),
    ).rejects.toMatchObject(CHECK_VIOLATION);
  });

  it("only links a claim payment to a reimbursement transaction", async () => {
    await expect(
      q(
        `insert into claim_payments (user_id, claim_id, transaction_id, amount_cents) values ($1, $2, $3, 100)`,
        [A, a.claim, a.expense],
      ),
    ).rejects.toMatchObject(FK_VIOLATION);
  });

  it("cancels the payment when its reimbursement transaction is deleted", async () => {
    await q(
      `insert into claim_payments (user_id, claim_id, transaction_id, amount_cents) values ($1, $2, $3, 1000)`,
      [A, a.claim, a.reimbursement],
    );
    // The expense cannot disappear while a payment still references its claim.
    await expect(q(`delete from transactions where id = $1`, [a.expense])).rejects.toMatchObject(
      FK_VIOLATION,
    );
    await q(`delete from transactions where id = $1`, [a.reimbursement]);
    const { rows } = await q(`select count(*)::int as n from claim_payments where claim_id = $1`, [
      a.claim,
    ]);
    expect(rows[0].n).toBe(0);
  });
});
