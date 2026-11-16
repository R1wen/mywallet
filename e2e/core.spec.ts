import { expect, test, type Browser, type Page } from "@playwright/test";

// One account per project (sign-up is rate limited), shared by the tests below, in order.
test.describe.configure({ mode: "serial" });

let page: Page;

/** New account: provisioned with categories, the merchant catalogue and a checking account. */
async function signUp(browser: Browser, project: string, use: object): Promise<Page> {
  const p = await (await browser.newContext(use)).newPage();
  const email = `e2e-core-${project}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@mywallet.test`;
  await p.goto("/inscription");
  await p.getByLabel("Prénom").fill("Alex");
  await p.getByLabel("E-mail").fill(email);
  await p.getByLabel("Mot de passe").fill("mot-de-passe-e2e-2026");
  await p.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(p.getByRole("heading", { name: "Tableau de bord" })).toBeVisible({
    timeout: 60_000,
  });
  return p;
}

/** Opens the quick-add dialog; retried because the button only works once hydrated. */
async function openNewTransaction(p: Page) {
  await expect(async () => {
    if (!(await p.getByRole("dialog").isVisible())) {
      await p
        .getByRole("button", { name: "Nouvelle transaction" })
        .first()
        .click({ timeout: 2_000 });
    }
    await expect(p.getByLabel("Montant")).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
}

/** The visible row (table on desktop, list on mobile) containing `text`. */
const rowWith = (p: Page, text: string) =>
  p.locator("tr, li").filter({ hasText: text }).filter({ visible: true }).first();

test.beforeAll(
  async (
    {
      browser,
      contextOptions,
      baseURL,
      viewport,
      userAgent,
      isMobile,
      hasTouch,
      locale,
      timezoneId,
      colorScheme,
    },
    testInfo,
  ) => {
    page = await signUp(browser, testInfo.project.name, {
      ...contextOptions,
      baseURL,
      viewport,
      userAgent,
      isMobile,
      hasTouch,
      locale,
      timezoneId,
      colorScheme,
    });
  },
);

test.afterAll(async () => {
  await page?.context().close();
});

test.describe("cœur : transactions, magasins, réglages", () => {
  test("ajoute une dépense en moins de 10 secondes, la modifie puis la supprime", async () => {
    await page.goto("/transactions");
    await expect(page.getByText("Aucun mouvement pour l'instant.")).toBeVisible({
      timeout: 60_000,
    });
    // Préchauffe la fenêtre (compilation à la demande en dev), hors chronométrage.
    await openNewTransaction(page);
    await page.keyboard.press("Escape");
    await expect(page.getByLabel("Montant")).toBeHidden();

    const start = Date.now();
    await page.getByRole("button", { name: "Nouvelle transaction" }).first().click();
    await page.getByLabel("Montant").fill("42,50");
    await page.getByLabel("Magasin ou site").fill("Carrefour Market");
    await page.getByLabel("Montant").press("Enter");
    await expect(page.getByText("Transaction ajoutée.")).toBeVisible();
    const row = rowWith(page, "Carrefour Market");
    await expect(row).toContainText("-42,50");
    expect(Date.now() - start).toBeLessThan(10_000);
    // Magasin reconnu par son alias : catégorie par défaut appliquée.
    await expect(row).toContainText("Courses");

    await row.getByRole("button").first().click();
    await expect(page.getByRole("heading", { name: "Modifier la transaction" })).toBeVisible();
    await expect(page.getByLabel("Montant")).toHaveValue("42,50");
    await page.getByLabel("Montant").fill("40");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("Transaction modifiée.")).toBeVisible();
    await expect(rowWith(page, "Carrefour Market")).toContainText("-40,00");

    await rowWith(page, "Carrefour Market").getByRole("button").first().click();
    await page.getByRole("button", { name: "Supprimer" }).click();
    await page.getByRole("button", { name: "Confirmer la suppression" }).click();
    await expect(page.getByText("Transaction supprimée.")).toBeVisible();
    await expect(page.getByText("Aucun mouvement pour l'instant.")).toBeVisible();
  });

  test("l'annuaire des magasins affiche logos et statistiques", async () => {
    await page.goto("/");
    await openNewTransaction(page);
    await page.getByLabel("Montant").fill("12");
    await page.getByLabel("Magasin ou site").fill("Lidl");
    await page.getByLabel("Montant").press("Enter");
    await expect(page.getByText("Transaction ajoutée.")).toBeVisible();

    await page.goto("/magasins");
    const lidl = page.getByRole("link", { name: /Lidl/ });
    await expect(lidl).toBeVisible({ timeout: 60_000 });
    await expect(lidl.getByRole("img", { name: "Lidl" })).toBeVisible();

    await page.goto("/magasins?vue=tous&q=decathlon");
    await expect(page.getByRole("link", { name: /Decathlon/ })).toBeVisible();

    await page.goto("/magasins");
    await page.getByRole("link", { name: /Lidl/ }).click();
    await expect(page.getByRole("heading", { name: "Lidl" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Total dépensé")).toBeVisible();
  });

  test("ajoute un compte depuis les réglages", async () => {
    await page.goto("/reglages");
    await expect(async () => {
      if (!(await page.getByRole("dialog").isVisible())) {
        await page
          .getByRole("button", { name: "Ajouter", exact: true })
          .first()
          .click({ timeout: 2_000 });
      }
      await expect(page.getByLabel("Nom")).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000 });
    await page.getByLabel("Nom").fill("Livret A");
    await page.getByLabel("Type").selectOption("savings");
    await page.getByLabel("Solde initial").fill("1 500");
    await page.getByRole("dialog").getByRole("button", { name: "Ajouter" }).click();
    await expect(page.getByText("Compte ajouté.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Livret A/ })).toContainText(/1\s500,00/);
  });
});
