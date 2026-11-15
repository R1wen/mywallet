/**
 * Authentification sur une vraie base : inscription, hachage du mot de passe,
 * session valide, refus d'un mauvais mot de passe, déconnexion qui invalide la session.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { auth } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import { authAccount, session, user } from "@/lib/db/schema";

const email = `auth-${randomUUID()}@test.local`;
const password = "mot-de-passe-tres-sur-42";

function cookieHeaderFrom(res: Response): Headers {
  const setCookie = res.headers.getSetCookie();
  const cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  return new Headers({ cookie });
}

afterAll(async () => {
  await db.delete(user).where(eq(user.email, email));
});

describe("auth (Better Auth + Drizzle)", () => {
  let cookies = new Headers();

  it("signs up, stores a hashed password and returns a session cookie", async () => {
    const res = await auth.api.signUpEmail({
      body: { name: "Camille", email, password },
      asResponse: true,
    });
    expect(res.status).toBe(200);
    cookies = cookieHeaderFrom(res);
    expect(cookies.get("cookie")).toContain("mw.session_token=");

    const [u] = await db.select().from(user).where(eq(user.email, email));
    const [acc] = await db.select().from(authAccount).where(eq(authAccount.userId, u!.id));
    expect(acc?.providerId).toBe("credential");
    expect(acc?.password).toBeTruthy();
    expect(acc?.password).not.toContain(password);
  });

  it("resolves the session from the cookie", async () => {
    const s = await auth.api.getSession({ headers: cookies });
    expect(s?.user.email).toBe(email);
  });

  it("rejects a wrong password", async () => {
    const res = await auth.api.signInEmail({
      body: { email, password: "mauvais-mot-de-passe" },
      asResponse: true,
    });
    expect(res.status).toBe(401);
  });

  it("rejects a password shorter than 10 characters", async () => {
    const res = await auth.api.signUpEmail({
      body: { name: "X", email: `short-${email}`, password: "court" },
      asResponse: true,
    });
    expect(res.status).toBe(400);
  });

  it("sign-out deletes the session server-side", async () => {
    const [u] = await db.select().from(user).where(eq(user.email, email));
    await auth.api.signOut({ headers: cookies });
    expect(await auth.api.getSession({ headers: cookies })).toBeNull();
    expect(await db.select().from(session).where(eq(session.userId, u!.id))).toEqual([]);
  });
});
