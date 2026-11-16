---
name: mywallet-add-feature
description: Standard procedure for adding or changing a myWallet feature end to end - schema and migration, Zod validation, pure domain logic written test-first, server actions with user isolation, UI, tests and docs. Use it whenever you implement a new screen, entity, server action, financial rule or import step in myWallet, even small ones, so nothing (isolation test, migration, doc) is forgotten.
---

# Adding a feature to myWallet

The order below exists for a reason: money rules are the part where a bug costs the user real trust, so they are pinned down by tests before any UI depends on them, and multi-user isolation is proven by a test rather than assumed.

Read `CLAUDE.md` and the relevant Next.js doc in `node_modules/next/dist/docs/` first. Write code files with Write/Edit, not shell heredocs.

## 1. Frame it

- Restate the behaviour in one paragraph, list the edge cases (amount 0, negative, rounding, dates 29-31 / leap years / DST, empty lists, another user's id).
- If a financial rule or data model choice is ambiguous or irreversible, ask the user before coding. Record structural decisions in `docs/DECISIONS.md`.

## 2. Domain first (TDD) — `src/lib/domain/`

- Write `x.test.ts` first with `it.each` tables, run it red (`pnpm test`), then implement `x.ts`.
- Pure functions only: no DB, no Next, no `Date.now()` hidden inside (pass `now` in). Amounts are integer cents; split money with `allocateProportionally` / `splitEvenly`.
- Keep coverage ≥ 80 % (`pnpm test:coverage`).

## 3. Data — `src/lib/db/schema/`

- Delegate to the `db-architect` agent for non-trivial changes.
- `user_id` on every user-owned table, `*_cents bigint` + `currency`, composite FK `(user_id, parent_id)` so rows cannot point to another user's data, indexes starting with `user_id`.
- `pnpm db:generate`, review the SQL, never edit a committed migration.

## 4. Validation — Zod

- One schema per input in `src/lib/validation/` (or next to the action), shared by the form (React Hook Form + `zodResolver`) and the server action. Parse amounts with `parseAmountToCents`; error messages in French.

## 5. Server — `src/lib/server/`

- Every action/route starts with `const user = await requireUser()`; `userId` never comes from the client.
- Queries go through repository functions that take `userId` as first argument and filter on it. Mutations check ownership in the `where` clause (update/delete `… where id = ? and user_id = ?`) and treat 0 affected rows as "not found".
- Return typed results (`{ ok: true, data } | { ok: false, error }`), revalidate with `updateTag`/`revalidatePath` as documented for Next 16.

## 6. UI

- Load the `mywallet-design-system` skill. Server components by default; session/data reads under `<Suspense>` (cacheComponents).
- Use existing primitives; amounts via `<Amount>`; empty, loading and error states.
- Run the visual loop: `pnpm dev`, `pnpm screens <sprint> <route>`, call the `ui-reviewer` agent, fix, max 3 iterations, keep final captures in `docs/screens/sprint-N/`.

## 7. Tests

- Integration test in `tests/integration/` including an isolation case: user B cannot read, update or delete user A's row.
- Component test for critical forms/tables (Testing Library). E2E in `e2e/` for key journeys.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm test:int` green before committing.

## 8. Docs and commit

- Update `docs/ROADMAP.md` checkboxes, `CLAUDE.md` if a convention changed, `.env.example` if a variable was added.
- Conventional, atomic commits (`feat(scope): …`), on the sprint branch.
