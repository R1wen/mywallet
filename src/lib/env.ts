import { z } from "zod";

const serverSchema = z
  .object({
    DATABASE_URL: z.string().url(),
    BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET doit faire au moins 32 caractères"),
    BETTER_AUTH_URL: z.string().url().optional(),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),
    VERCEL_URL: z.string().min(1).optional(),
    // Optional receipt structurers (ADR-029). Unset = option unavailable.
    OLLAMA_URL: z.string().url().optional(),
    OLLAMA_MODEL: z.string().min(1).default("qwen2.5vl:7b"),
    GEMINI_API_KEY: z.string().min(20).optional(),
    GEMINI_MODEL: z.string().min(1).default("gemini-flash-latest"),
    // Daily purge of deleted accounts (ADR-043): Vercel Cron sends it as a bearer token.
    CRON_SECRET: z.string().min(16).optional(),
  })
  .superRefine((env, ctx) => {
    // En production Vercel, l'URL publique doit être fournie explicitement et en HTTPS :
    // elle sert d'origine de confiance (CSRF) et de base des cookies.
    if (env.VERCEL_ENV === "production" && !env.BETTER_AUTH_URL?.startsWith("https://")) {
      ctx.addIssue({
        code: "custom",
        path: ["BETTER_AUTH_URL"],
        message: "obligatoire et en https:// en production",
      });
    }
  })
  .transform((env) => ({
    ...env,
    // Prévisualisations Vercel : URL du déploiement si rien n'est fourni,
    // sinon l'origine du navigateur serait refusée par la vérification CSRF.
    BETTER_AUTH_URL:
      env.BETTER_AUTH_URL ??
      (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : "http://localhost:3000"),
  }));

export type ServerEnv = z.infer<typeof serverSchema>;

/** Valide un environnement donné (exporté pour les tests). */
export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  // Une variable vide vaut une variable absente (`vercel pull` écrit par ex. VERCEL_URL="").
  const defined = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ""));
  const parsed = serverSchema.safeParse(defined);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(
      `Variables d'environnement invalides :\n${issues.join("\n")}\nVoir .env.example.`,
    );
  }
  return parsed.data;
}

let cached: ServerEnv | undefined;

/** Environnement serveur validé (mis en cache). Erreur lisible listant les variables fautives. */
export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
