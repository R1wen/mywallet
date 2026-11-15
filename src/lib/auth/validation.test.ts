import { describe, expect, it } from "vitest";
import { authErrorMessage, signInSchema, signUpSchema } from "./validation";

describe("signUpSchema", () => {
  it("normalizes the e-mail and accepts a valid payload", () => {
    const r = signUpSchema.parse({
      name: " Léa ",
      email: " Lea@Example.FR ",
      password: "correct-horse-1",
    });
    expect(r).toEqual({ name: "Léa", email: "lea@example.fr", password: "correct-horse-1" });
  });

  it("rejects short passwords with a French message", () => {
    const r = signUpSchema.safeParse({ name: "Léa", email: "lea@example.fr", password: "court" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe("10 caractères minimum.");
  });

  it("rejects invalid e-mails", () => {
    const r = signUpSchema.safeParse({ name: "Léa", email: "lea@", password: "correct-horse-1" });
    expect(r.success).toBe(false);
  });
});

describe("signInSchema", () => {
  it("requires both fields", () => {
    const r = signInSchema.safeParse({ email: "", password: "" });
    expect(r.success).toBe(false);
    const firstByField = new Map<string, string>();
    for (const issue of r.error?.issues ?? []) {
      const key = String(issue.path[0]);
      if (!firstByField.has(key)) firstByField.set(key, issue.message);
    }
    expect(Object.fromEntries(firstByField)).toEqual({
      email: "Saisissez votre e-mail.",
      password: "Saisissez votre mot de passe.",
    });
  });
});

describe("authErrorMessage", () => {
  it.each([
    [{ status: 429 }, "Trop de tentatives. Réessayez dans une minute."],
    [{ code: "INVALID_EMAIL_OR_PASSWORD" }, "E-mail ou mot de passe incorrect."],
    [{ code: "USER_ALREADY_EXISTS" }, "Un compte existe déjà avec cet e-mail."],
    [{ code: "SOMETHING_ELSE" }, "Une erreur est survenue. Réessayez."],
  ])("%j", (err, expected) => {
    expect(authErrorMessage(err)).toBe(expected);
  });
});
