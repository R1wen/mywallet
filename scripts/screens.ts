/**
 * Captures d'écran 1440 px et 390 px pour la revue visuelle (ui-reviewer).
 * Usage : pnpm screens <sprint> <chemin> [<chemin>...]   (serveur sur BASE_URL, défaut http://localhost:3000)
 * Exemple : pnpm screens 0 /design /connexion
 * Variables optionnelles : SCREENS_EMAIL / SCREENS_PASSWORD pour se connecter avant la capture.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
] as const;

function slug(route: string): string {
  return route === "/" ? "accueil" : route.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-");
}

async function login(page: Page) {
  const email = process.env.SCREENS_EMAIL;
  const password = process.env.SCREENS_PASSWORD;
  if (!email || !password) return;
  await page.goto(`${BASE_URL}/connexion`);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/connexion"));
}

async function main() {
  const [sprint, ...routes] = process.argv.slice(2);
  if (!sprint || routes.length === 0) {
    console.error("Usage: pnpm screens <sprint> <route> [...routes]");
    process.exit(1);
  }
  const outDir = path.join("docs", "screens", `sprint-${sprint}`);
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({ args: ["--lang=fr-FR"] });
  const errors: string[] = [];
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
      locale: "fr-FR",
      timezoneId: "Europe/Paris",
      colorScheme: "dark",
      reducedMotion: "reduce",
      hasTouch: vp.width < 768,
      isMobile: vp.width < 768,
    });
    const page = await context.newPage();
    page.on("console", (m) => m.type() === "error" && errors.push(`[${vp.name}] ${m.text()}`));
    page.on("pageerror", (e) => errors.push(`[${vp.name}] ${e.message}`));
    await login(page);
    for (const route of routes) {
      await page.goto(`${BASE_URL}${route}`, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      const file = path.join(outDir, `${slug(route)}-${vp.name}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log("saved", file);
    }
    await context.close();
  }
  await browser.close();
  if (errors.length) {
    console.log("\nConsole errors:");
    for (const e of errors) console.log(" -", e);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
