import { expect, test } from "@playwright/test";

function uniqueEmail(project: string) {
  return `e2e-${project}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@mywallet.test`;
}

test.describe("authentification", () => {
  test("redirige un visiteur non connecté vers la connexion", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/connexion$/);
    await expect(page.getByRole("heading", { name: "Connexion" })).toBeVisible();
  });

  test("inscription, déconnexion puis reconnexion", async ({ page }, testInfo) => {
    const email = uniqueEmail(testInfo.project.name);
    const password = "mot-de-passe-e2e-2026";

    await page.goto("/inscription");
    await page.getByLabel("Prénom").fill("Camille");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Mot de passe").fill(password);
    await page.getByRole("button", { name: "Créer mon compte" }).click();

    // Première navigation vers l'espace connecté : en dev, compilation à la demande (lente).
    await expect(page).toHaveURL(/\/$/, { timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Tableau de bord" })).toBeVisible();

    // Déconnexion via la palette de commandes (fonctionne sur desktop et mobile).
    // Le raccourci n'agit qu'une fois la page hydratée : on réessaie jusqu'à l'ouverture.
    const signOutOption = page.getByRole("option", { name: "Se déconnecter" });
    await expect(async () => {
      if (!(await signOutOption.isVisible())) await page.keyboard.press("Control+k");
      await expect(signOutOption).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 30_000 });
    await page.getByRole("option", { name: "Se déconnecter" }).click();
    await expect(page).toHaveURL(/\/connexion$/);

    // La session est invalidée : la page protégée renvoie vers la connexion.
    await page.goto("/");
    await expect(page).toHaveURL(/\/connexion$/);

    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Mot de passe").fill(password);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page.getByRole("heading", { name: "Tableau de bord" })).toBeVisible();
  });

  test("refuse un mauvais mot de passe avec un message clair", async ({ page }) => {
    await page.goto("/connexion");
    await page.getByLabel("E-mail").fill("inconnu@mywallet.test");
    await page.getByLabel("Mot de passe").fill("mauvais-mot-de-passe");
    await page.getByRole("button", { name: "Se connecter" }).click();
    // Next ajoute aussi un annonceur de route avec role="alert" : on cible le message.
    await expect(
      page.getByRole("alert").filter({ hasText: "E-mail ou mot de passe incorrect." }),
    ).toBeVisible();
  });

  test("valide les champs côté client", async ({ page }) => {
    await page.goto("/inscription");
    await page.getByRole("button", { name: "Créer mon compte" }).click();
    await expect(page.getByText("Saisissez votre prénom.")).toBeVisible();
    await expect(page.getByText("Saisissez votre e-mail.")).toBeVisible();
  });
});
