/**
 * Chemin de retour après connexion. N'accepte qu'un chemin interne ("/x") :
 * jamais "//domaine", "/\domaine", une URL absolue ou un schéma javascript:.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  if (/[\u0000-\u001f]/.test(raw)) return "/";
  return raw;
}
