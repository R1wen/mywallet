import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "./server";

export type CurrentUser = { id: string; name: string; email: string };

/**
 * Lit et valide la session côté serveur (une fois par requête).
 * Avec cacheComponents, à appeler uniquement sous un <Suspense>.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const result = await auth.api.getSession({ headers: await headers() });
  if (!result) return null;
  const { id, name, email } = result.user;
  return { id, name, email };
});

/**
 * Point d'entrée obligatoire de tout accès aux données : renvoie l'utilisateur
 * de la session serveur, ou redirige vers la connexion. Le userId ne vient
 * jamais du client.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");
  return user;
}
