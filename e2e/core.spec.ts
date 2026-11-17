import { expect, test, type Browser, type Page } from "@playwright/test";

// One account per project (sign-up is rate limited), shared by the tests below, in order.
test.describe.configure({ mode: "serial" });

let page: Page;
/** E-mail of the account shared by these tests (signed in again after deletion). */
let accountEmail = "";

/** New account: provisioned with categories, the merchant catalogue and a checking account. */
async function signUp(browser: Browser, project: string, use: object): Promise<Page> {
  const p = await (await browser.newContext(use)).newPage();
  const email = `e2e-core-${project}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@mywallet.test`;
  accountEmail = email;
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
    await expect(p.getByLabel("Montant", { exact: true })).toBeVisible({ timeout: 5_000 });
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
    await expect(page.getByLabel("Montant", { exact: true })).toBeHidden();

    const start = Date.now();
    await page.getByRole("button", { name: "Nouvelle transaction" }).first().click();
    await page.getByLabel("Montant", { exact: true }).fill("42,50");
    await page.getByLabel("Magasin ou site").fill("Carrefour Market");
    await page.getByLabel("Montant", { exact: true }).press("Enter");
    await expect(page.getByText("Transaction ajoutée.")).toBeVisible();
    const row = rowWith(page, "Carrefour Market");
    await expect(row).toContainText("-42,50");
    expect(Date.now() - start).toBeLessThan(10_000);
    // Magasin reconnu par son alias : catégorie par défaut appliquée.
    await expect(row).toContainText("Courses");

    await row.getByRole("button").first().click();
    await expect(page.getByRole("heading", { name: "Modifier la transaction" })).toBeVisible();
    await expect(page.getByLabel("Montant", { exact: true })).toHaveValue("42,50");
    await page.getByLabel("Montant", { exact: true }).fill("40");
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
    await page.getByLabel("Montant", { exact: true }).fill("12");
    await page.getByLabel("Magasin ou site").fill("Lidl");
    await page.getByLabel("Montant", { exact: true }).press("Enter");
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
      await expect(page.getByLabel("Montant", { exact: true })).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000 });
    // Par défaut : charge mensuelle, le jour d'aujourd'hui, à partir d'aujourd'hui.
    await page.getByLabel("Montant", { exact: true }).fill("9,99");
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
    await dialog.getByLabel("Catégorie").selectOption({ label: "Restaurants" });
    await dialog.getByLabel("Montant", { exact: true }).fill("10");
    await dialog.getByRole("button", { name: "Créer" }).click();
    await expect(page.getByText("Budget créé.")).toBeVisible();
    await expect(page.getByRole("meter", { name: "Budget Restaurants" })).toBeVisible();

    await page.goto("/transactions");
    await openNewTransaction(page);
    await page.getByLabel("Montant", { exact: true }).fill("9");
    await page.getByLabel("Magasin ou site").fill("Crêperie du port");
    await page.getByRole("dialog").getByLabel("Catégorie").selectOption({ label: "Restaurants" });
    await page.getByLabel("Montant", { exact: true }).press("Enter");
    await expect(page.getByText(/Budget Restaurants : \d+ %/)).toBeVisible();
    // A category chosen by hand for a new merchant: the app offers to remember it.
    await page.getByRole("button", { name: "Toujours" }).click();
    await expect(page.getByText("Règle enregistrée.")).toBeVisible();

    await page.goto("/budgets");
    await expect(page.getByText(/Seuil atteint|Dépassé/).first()).toBeVisible();
    await page.goto("/reglages");
    await expect(page.getByText("Magasin Crêperie du port")).toBeVisible();
  });
});

test.describe("analyses : tendances, simulation, rapport", () => {
  test("affiche le mois, simule une économie et ouvre le rapport", async () => {
    await page.goto("/analyses");
    await expect(page.getByRole("heading", { name: "Ma dépense, 12 derniers mois" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("Fin de mois prévue")).toBeVisible();
    // Questions stay off without a configured model.
    await expect(page.getByText(/Choisissez Ollama ou Gemini dans Réglages/)).toBeVisible();

    const slider = page.getByRole("slider").first();
    if (await slider.isVisible()) {
      await slider.fill("50");
      await expect(page.getByText("-50 %").first()).toBeVisible();
    }

    await page.getByRole("link", { name: "Rapport du mois" }).click();
    await expect(page.getByRole("heading", { name: /^Rapport de / })).toBeVisible();
    await expect(page.getByText("En bref")).toBeVisible();
  });
});

test.describe("finitions : confidentialité, exports, palette, accessibilité", () => {
  test("masque les montants et s'en souvient", async () => {
    await page.goto("/");
    await page.getByRole("button", { name: "Masquer les montants" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-private", "");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-private", "");
    await page.getByRole("button", { name: "Afficher les montants" }).click();
    await expect(page.locator("html")).not.toHaveAttribute("data-private", "");
  });

  test("exporte les transactions en CSV et en Excel, le rapport en PDF", async () => {
    const csv = await page.request.get("/api/export/transactions?format=csv");
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    expect(await csv.text()).toContain("Date;Type;Libellé");
    const xlsx = await page.request.get("/api/export/transactions?format=xlsx");
    expect(xlsx.headers()["content-type"]).toContain("spreadsheetml");
    const pdf = await page.request.get("/api/export/rapport");
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
    const data = await page.request.get("/api/export/data?part=profil");
    expect((await data.json()).rows[0]).not.toHaveProperty("password");
  });

  test("cherche un magasin dans la palette", async () => {
    await page.goto("/");
    await page.getByRole("button", { name: /Rechercher/ }).click();
    await page.getByPlaceholder(/Rechercher une page/).fill("Boulangerie");
    await expect(page.getByRole("option", { name: /Boulangerie Marie/ }).first()).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("sert le manifeste de l'application installable", async () => {
    const res = await page.request.get("/manifest.webmanifest");
    expect(res.status()).toBe(200);
    expect((await res.json()).display).toBe("standalone");
  });

  test("n'a pas de problème d'accessibilité grave sur les écrans principaux", async () => {
    const { default: AxeBuilder } = await import("@axe-core/playwright");
    for (const path of ["/", "/transactions", "/budgets", "/analyses", "/personnes", "/reglages"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const { violations } = await new AxeBuilder({ page }).analyze();
      const serious = violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map(
          (v) =>
            `${path} ${v.id}: ${v.nodes
              .map((n) => n.target.join(" "))
              .slice(0, 3)
              .join(", ")}`,
        );
      expect(serious).toEqual([]);
    }
  });

  test("supprime le compte dans 7 jours, puis l'annule en se reconnectant", async () => {
    await page.goto("/reglages");
    await page.getByRole("button", { name: "Supprimer mon compte" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Mot de passe").fill("mot-de-passe-e2e-2026");
    await dialog.getByLabel("Tapez SUPPRIMER pour confirmer").fill("SUPPRIMER");
    await dialog.getByRole("button", { name: "Supprimer dans 7 jours" }).click();
    await page.waitForURL(/\/connexion\?suppression=/);
    await expect(page.getByText(/Votre compte sera supprimé le/)).toBeVisible();
    // Signing in again within the 7 days cancels the deletion.
    await page.getByLabel("E-mail").fill(accountEmail);
    await page.getByLabel("Mot de passe", { exact: true }).fill("mot-de-passe-e2e-2026");
    // Both e2e projects sign in from the same IP: wait out the 5-per-minute limit if hit.
    test.setTimeout(180_000);
    await expect(async () => {
      await page.getByRole("button", { name: "Se connecter" }).click();
      await expect(page.getByRole("heading", { name: "Tableau de bord" })).toBeVisible({
        timeout: 10_000,
      });
    }).toPass({ timeout: 150_000, intervals: [20_000] });
  });
});
