import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/lib/db/client";
import { authAccount, rateLimit, session, user, verification } from "@/lib/db/schema/auth";
import { serverEnv } from "@/lib/env";
import { provisionUser } from "@/lib/server/provisioning";
import { PASSWORD_MAX, PASSWORD_MIN, signInSchema, signUpSchema } from "./validation";

const env = serverEnv();

/** Mêmes schémas Zod côté serveur que dans le formulaire (règle : toute entrée validée). */
const validateAuthInput = createAuthMiddleware(async (ctx) => {
  const schema =
    ctx.path === "/sign-up/email"
      ? signUpSchema
      : ctx.path === "/sign-in/email"
        ? signInSchema
        : null;
  if (!schema) return;
  const parsed = schema.safeParse(ctx.body);
  if (!parsed.success) {
    throw new APIError("BAD_REQUEST", {
      message: parsed.error.issues[0]?.message ?? "Entrée invalide.",
    });
  }
});

export const auth = betterAuth({
  hooks: { before: validateAuthInput },
  appName: "myWallet",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.BETTER_AUTH_URL],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account: authAccount, verification, rateLimit },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: PASSWORD_MIN,
    maxPasswordLength: PASSWORD_MAX,
    autoSignIn: true,
  },
  databaseHooks: {
    // Catégories, catalogue d'enseignes et compte courant pour démarrer (ADR-023).
    user: { create: { after: (created) => provisionUser(created.id) } },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 14, // 14 jours
    updateAge: 60 * 60 * 24, // prolongée au plus une fois par jour
  },
  rateLimit: {
    // Activé aussi en développement pour que les tests couvrent le comportement réel.
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60 * 10, max: 5 },
    },
  },
  advanced: {
    useSecureCookies: env.NODE_ENV === "production",
    cookiePrefix: "mw",
  },
  // nextCookies doit rester le dernier plugin (cookies posés depuis les server actions).
  plugins: [nextCookies()],
});

export type Auth = typeof auth;
