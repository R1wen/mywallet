import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/lib/db/client";
import { authAccount, rateLimit, session, user, verification } from "@/lib/db/schema/auth";
import { serverEnv } from "@/lib/env";
import { PASSWORD_MAX, PASSWORD_MIN } from "./validation";

const env = serverEnv();

export const auth = betterAuth({
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
