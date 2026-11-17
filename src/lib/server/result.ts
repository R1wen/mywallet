/** Typed outcome of a mutation. Error messages are French and safe to show to the user. */
export type Result<T = void> = { ok: true; data: T } | { ok: false; error: string };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export const NOT_FOUND = "Élément introuvable.";

/**
 * Thrown inside `db.transaction` to roll back writes already made and return a failure
 * (returning `fail()` from the callback would commit them). Catch with `abortedResult`.
 */
export class Abort extends Error {
  constructor(readonly result: { ok: false; error: string }) {
    super(result.error);
  }
}

export const abortedResult = (e: unknown) => (e instanceof Abort ? e.result : null);

/** The node-postgres error behind a driver error, possibly wrapped by Drizzle (`cause`). */
function pgError(error: unknown): { code: string; constraint?: string } | undefined {
  let e: unknown = error;
  for (let depth = 0; e && depth < 3; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) {
      return e as { code: string; constraint?: string };
    }
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

const pgCode = (e: unknown) => pgError(e)?.code;

/** Name of the violated constraint, when Postgres reports one. */
export const constraintOf = (e: unknown) => pgError(e)?.constraint;

export const isForeignKeyViolation = (e: unknown) => pgCode(e) === "23503";
export const isUniqueViolation = (e: unknown) => pgCode(e) === "23505";
export const isCheckViolation = (e: unknown) => pgCode(e) === "23514";
