import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/connexion", "/inscription"];

/**
 * Vérification optimiste : présence du cookie de session uniquement.
 * La validation réelle de la session se fait côté serveur (requireUser).
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = Boolean(getSessionCookie(request, { cookiePrefix: "mw" }));
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!hasSession && !isPublic) {
    const url = new URL("/connexion", request.url);
    if (pathname !== "/") url.searchParams.set("suite", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }
  // Pas de redirection /connexion -> / sur simple présence du cookie : un cookie expiré
  // ou révoqué provoquerait une boucle avec requireUser() (qui renvoie vers /connexion).
  return NextResponse.next();
}

export const config = {
  // Tout sauf l'API d'auth, la santé, la vitrine /design, les fichiers statiques.
  matcher: [
    "/((?!api/auth|api/health|api/cron|manifest.webmanifest|sw.js|offline.html|private-mode.js|icons/|design|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt|xml)$).*)",
  ],
};
