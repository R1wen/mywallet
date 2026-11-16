/** Typed outcome of a mutation. Error messages are French and safe to show to the user. */
export type Result<T = void> = { ok: true; data: T } | { ok: false; error: string };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export const NOT_FOUND = "Élément introuvable.";

/** Postgres SQLSTATE of a driver error, possibly wrapped by Drizzle (`cause`). */
function pgCode(error: unknown): string | undefined {
  let e: unknown = error;
  for (let depth = 0; e && depth < 3; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

export const isForeignKeyViolation = (e: unknown) => pgCode(e) === "23503";
export const isUniqueViolation = (e: unknown) => pgCode(e) === "23505";
export const isCheckViolation = (e: unknown) => pgCode(e) === "23514";
