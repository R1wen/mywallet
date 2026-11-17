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

test.describe("récurrent : règles, échéances, reste à vivre", () => {
  test("crée une charge due aujourd'hui puis la valide depuis le tableau de bord", async () => {
    await page.goto("/recurrent");
    await expect(page.getByText("Aucune règle récurrente.")).toBeVisible({ timeout: 60_000 });
    await expect(async () => {
      if (!(await page.getByRole("dialog").isVisible())) {
        await page
          .getByRole("button", { name: "Nouvelle règle" })
          .first()
          .click({ timeout: 2_000 });
      }
      await expect(page.getByLabel("Montant")).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000 });
    // Par défaut : charge mensuelle, le jour d'aujourd'hui, à partir d'aujourd'hui.
    await page.getByLabel("Montant").fill("9,99");
    await page.getByLabel("Magasin ou organisme").fill("Netflix");
    await page.getByRole("dialog").getByRole("button", { name: "Ajouter" }).click();
    await expect(page.getByText("Règle ajoutée.")).toBeVisible();

    await page.goto("/recurrent?vue=regles");
    await expect(rowWith(page, "Netflix")).toContainText("-9,99");

    await page.goto("/");
    const card = page.locator("section").filter({ hasText: "Reste à vivre" });
    const due = card.getByRole("button", { name: /Netflix/ });
    await expect(due).toContainText("Aujourd'hui", { timeout: 60_000 });
    await expect(async () => {
      if (!(await page.getByRole("dialog").isVisible())) await due.click({ timeout: 2_000 });
      await expect(page.getByLabel("Montant réel")).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000 });
    await page.getByLabel("Montant réel").fill("10,49");
    await page.getByRole("button", { name: "Valider" }).click();
    await expect(page.getByText("Échéance validée : le mouvement est enregistré.")).toBeVisible();
    await expect(card.getByText("Aucune échéance à valider cette semaine.")).toBeVisible();

    await page.goto("/transactions");
    await expect(rowWith(page, "Netflix")).toContainText("-10,49", { timeout: 60_000 });
  });
});

const RECEIPT_HTML = `<html><body style="margin:0;background:#fff">
<pre style="font:16px/1.35 'Courier New',monospace;color:#111;padding:24px;width:380px">
   BOULANGERIE MARIE

BAGUETTE TRADITION       1,30
   2 x 1,10              2,20
CROISSANT

TOTAL TTC                3,50 EUR
CB SANS CONTACT          3,50

10/11/2026  08:12
</pre></body></html>`;

test.describe("import : tickets et relevé", () => {
  test("lit un ticket dans le navigateur puis le valide en dépense", async () => {
    const render = await page.context().newPage();
    await render.setContent(RECEIPT_HTML);
    const buffer = await render.locator("pre").screenshot();
    await render.close();

    await page.goto("/tickets");
    await expect(page.getByText("Aucun ticket pour l'instant.")).toBeVisible({ timeout: 60_000 });
    // The input only reacts once hydrated: retry until the file shows up in the list.
    await expect(async () => {
      await page
        .getByLabel("Choisir des tickets")
        .setInputFiles({ name: "boulangerie.png", mimeType: "image/png", buffer });
      await expect(page.locator("ul[aria-live] li").first()).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 60_000 });
    const open = page.getByRole("link", { name: "Ouvrir" }).first();
    await expect(open).toBeVisible({ timeout: 120_000 });
    await open.click();

    await expect(page.getByLabel("Total payé")).toHaveValue("3,50", { timeout: 30_000 });
    await expect(page.getByLabel("Date d'achat")).toHaveValue("2026-11-10");
    await expect(page.getByLabel("Libellé de la ligne 1")).toHaveValue("BAGUETTE TRADITION");
    await page.getByLabel("Magasin").fill("Boulangerie Marie");
    await page.getByRole("button", { name: "Valider la dépense" }).click();
    await expect(page.getByText("Dépense enregistrée.")).toBeVisible();
    await page.waitForURL("**/tickets");
    await expect(page.getByText("Traités récemment")).toBeVisible();

    await page.goto("/transactions");
    await expect(rowWith(page, "Boulangerie Marie")).toContainText("-3,50");
  });

  test("importe un relevé CSV : pointe la dépense du ticket, crée le reste", async () => {
    const csv = [
      "Date opération;Libellé;Débit;Crédit",
      "11/11/2026;CB BOULANGERIE MARIE 10/11;3,50;",
      "12/11/2026;VIR SALAIRE ACME;;2 100,00",
    ].join("\r\n");
    await page.goto("/transactions/import");
    await expect(async () => {
      await page.getByLabel("Fichier CSV du relevé").setInputFiles({
        name: "releve.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(csv, "utf8"),
      });
      await expect(page.getByText("releve.csv")).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000 });
    await expect(rowWith(page, "CB BOULANGERIE MARIE")).toContainText("Déjà saisi");
    await expect(rowWith(page, "VIR SALAIRE ACME")).toContainText("Nouveau");
    await page.getByRole("button", { name: "Importer" }).click();
    await expect(page.getByText("1 créé, 1 pointé, 0 ignoré.")).toBeVisible();
    await page.waitForURL("**/transactions");
    await expect(rowWith(page, "SALAIRE ACME")).toContainText("+2 100,00");
  });
});

test.describe("partage : créances et remboursement", () => {
  test("partage la ligne d'un ticket avec un ami puis enregistre son remboursement", async () => {
    await page.goto("/transactions");
    await rowWith(page, "Boulangerie Marie").getByRole("button").first().click();
    await page.getByRole("button", { name: "Partager" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Tout est à moi ?")).toBeVisible({ timeout: 30_000 });
    await dialog.getByText("Non, je partage").click();
    await dialog.getByLabel("Nom d'une nouvelle personne").fill("Paul");
    await dialog.getByRole("button", { name: "Ajouter" }).click();
    await dialog.getByRole("button", { name: "À Paul" }).click();
    await expect(dialog.getByText("Paul me doit")).toBeVisible();
    await dialog.getByRole("button", { name: "Enregistrer le partage" }).click();
    await expect(page.getByText(/Partage enregistré/)).toBeVisible();
    // The balance keeps the full movement; the expense is now marked as shared.
    await expect(rowWith(page, "Boulangerie Marie")).toContainText("Partagé");

    await page.goto("/personnes");
    await page.getByRole("link", { name: /Paul/ }).click();
    await expect(page.getByRole("heading", { name: "Paul" })).toBeVisible();
    await page.getByRole("button", { name: "Enregistrer un remboursement" }).click();
    await expect(page.getByLabel("Montant reçu")).toHaveValue("3,50");
    await page.getByRole("button", { name: "Enregistrer le remboursement" }).click();
    await expect(page.getByText("Remboursement de Paul enregistré.")).toBeVisible();
    await expect(page.getByText(/\+3,50/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Enregistrer un remboursement" })).toHaveCount(0);
  });
});

test.describe("budgets : enveloppes, alertes et règles", () => {
  test("crée une enveloppe, est prévenu au seuil, puis mémorise une règle de classement", async () => {
    await page.goto("/budgets");
    await page.getByRole("button", { name: "Nouveau budget" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Catégorie").selectOption({ label: "Courses" });
    await dialog.getByLabel("Montant").fill("10");
    await dialog.getByRole("button", { name: "Créer" }).click();
    await expect(page.getByText("Budget créé.")).toBeVisible();
    await expect(page.getByRole("meter", { name: "Budget Courses" })).toBeVisible();

    await page.goto("/transactions");
    await openNewTransaction(page);
    await page.getByLabel("Montant").fill("9");
    await page.getByLabel("Magasin ou site").fill("Marché du samedi");
    await page.getByRole("dialog").getByLabel("Catégorie").selectOption({ label: "Courses" });
    await page.getByLabel("Montant").press("Enter");
    await expect(page.getByText(/Budget Courses : \d+ %/)).toBeVisible();
    // A category chosen by hand for a new merchant: the app offers to remember it.
    await page.getByRole("button", { name: "Toujours" }).click();
    await expect(page.getByText("Règle enregistrée.")).toBeVisible();

    await page.goto("/budgets");
    await expect(page.getByText(/Seuil atteint|Dépassé/).first()).toBeVisible();
    await page.goto("/reglages");
    await expect(page.getByText("Magasin Marché du samedi")).toBeVisible();
  });
});
