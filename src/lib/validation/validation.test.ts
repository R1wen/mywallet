import { describe, expect, it } from "vitest";
import { merchantInputSchema } from "./merchant";
import { occurrenceConfirmSchema, recurringRuleInputSchema } from "./recurring";
import { accountInputSchema } from "./settings";
import { parseTransactionFilters, transactionInputSchema } from "./transaction";

const A = "0b7c5f0e-5b8e-4c1a-9a57-6b1f0b3e2a11";
const B = "6f1d2c3b-4a5e-4f60-8a71-92b3c4d5e6f7";

const base = {
  kind: "expense" as const,
  amount: "12,50",
  occurredOn: "2026-11-16",
  label: "",
  merchantName: "Carrefour",
  accountId: A,
  toAccountId: "",
  categoryId: "",
  notes: "",
};

const firstMessage = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.error?.issues[0]?.message;

describe("transactionInputSchema", () => {
  it("parses the amount to positive cents and uses the merchant as label", () => {
    expect(transactionInputSchema.parse(base)).toEqual({
      kind: "expense",
      amountCents: 1250,
      occurredOn: "2026-11-16",
      label: "Carrefour",
      merchantName: "Carrefour",
      accountId: A,
      toAccountId: null,
      categoryId: null,
      notes: null,
    });
  });

  it.each([
    [{ amount: "" }, "Saisissez un montant."],
    [{ amount: "abc" }, "Montant invalide."],
    [{ amount: "0" }, "Montant invalide."],
    [{ amount: "-5" }, "Montant invalide."],
    [{ amount: "200000000" }, "Montant trop élevé."],
    [{ label: "", merchantName: "" }, "Saisissez un libellé ou un magasin."],
    [{ occurredOn: "16/11/2026" }, "Date invalide."],
    [{ occurredOn: "2026-02-30" }, "Date invalide."],
    [{ accountId: "x" }, "Choisissez un compte."],
    [{ kind: "transfer", toAccountId: "" }, "Choisissez le compte crédité."],
    [{ kind: "transfer", toAccountId: A }, "Choisissez deux comptes différents."],
  ])("%j -> %s", (patch, message) => {
    expect(firstMessage(transactionInputSchema.safeParse({ ...base, ...patch }))).toBe(message);
  });

  it("keeps the destination account and drops the merchant for a transfer", () => {
    const r = transactionInputSchema.parse({
      ...base,
      kind: "transfer",
      label: "Épargne",
      toAccountId: B,
    });
    expect(r).toMatchObject({
      kind: "transfer",
      toAccountId: B,
      merchantName: "",
      label: "Épargne",
    });
  });
});

describe("parseTransactionFilters", () => {
  it("applies defaults and ignores invalid values instead of failing", () => {
    expect(
      parseTransactionFilters({
        compte: "nope",
        tri: "x",
        ordre: "up",
        page: "-3",
        du: "2026-11-01",
        q: "  pain ",
      }),
    ).toEqual({
      q: "pain",
      compte: undefined,
      categorie: undefined,
      marchand: undefined,
      type: undefined,
      du: "2026-11-01",
      au: undefined,
      tri: "date",
      ordre: "desc",
      page: 1,
    });
  });

  it("takes the first value of repeated params", () => {
    expect(parseTransactionFilters({ page: ["3", "9"], type: ["refund"] })).toMatchObject({
      page: 3,
      type: "refund",
    });
  });
});

describe("accountInputSchema", () => {
  it.each([
    ["", 0],
    ["1 234,56", 123456],
    ["-120,50", -12050],
    ["− 5", -500],
  ])("opening balance %j -> %d", (openingBalance, cents) => {
    expect(
      accountInputSchema.parse({
        name: "Livret",
        type: "savings",
        institution: "",
        openingBalance,
      }),
    ).toMatchObject({ openingBalanceCents: cents, institution: null });
  });
});

it("rejects a doubled sign instead of flipping it", () => {
  const r = accountInputSchema.safeParse({
    name: "x",
    type: "cash",
    institution: "",
    openingBalance: "--120,50",
  });
  expect(r.success).toBe(false);
});

describe("recurringRuleInputSchema", () => {
  const rule = {
    kind: "expense" as const,
    label: "",
    amount: "890",
    merchantName: "Foncia",
    accountId: A,
    toAccountId: "",
    categoryId: "",
    frequency: "monthly" as const,
    interval: "1",
    dayOfMonth: "5",
    startOn: "2026-11-05",
    endOn: "",
  };

  it("signs the amount by kind and keeps the day only for monthly and yearly rules", () => {
    expect(recurringRuleInputSchema.parse(rule)).toMatchObject({
      amountCents: -89_000,
      label: "Foncia",
      dayOfMonth: 5,
      interval: 1,
      endOn: null,
      toAccountId: null,
    });
    expect(recurringRuleInputSchema.parse({ ...rule, kind: "income" }).amountCents).toBe(89_000);
    expect(recurringRuleInputSchema.parse({ ...rule, frequency: "weekly" }).dayOfMonth).toBeNull();
    expect(
      recurringRuleInputSchema.parse({
        ...rule,
        kind: "transfer",
        label: "Épargne",
        toAccountId: B,
      }),
    ).toMatchObject({ amountCents: -89_000, toAccountId: B, merchantName: "" });
  });

  it.each([
    [{ amount: "0" }, "Montant invalide."],
    [{ dayOfMonth: "32" }, "Jour entre 1 et 31."],
    [{ interval: "0" }, "Intervalle invalide."],
    [{ label: "", merchantName: "" }, "Saisissez un libellé."],
    [{ kind: "transfer", toAccountId: B, label: "" }, "Saisissez un libellé."],
    [{ kind: "transfer", label: "Épargne", toAccountId: "" }, "Choisissez le compte d'épargne."],
    [{ kind: "transfer", label: "Épargne", toAccountId: A }, "Choisissez deux comptes différents."],
    [{ endOn: "2026-11-01" }, "La fin précède le début."],
    [{ startOn: "2026-02-30" }, "Date invalide."],
  ])("%j -> %s", (patch, message) => {
    expect(firstMessage(recurringRuleInputSchema.safeParse({ ...rule, ...patch }))).toBe(message);
  });
});

describe("occurrenceConfirmSchema", () => {
  it("parses the real amount as a positive magnitude", () => {
    expect(
      occurrenceConfirmSchema.parse({ amount: "78,40", occurredOn: "2026-11-08", accountId: A }),
    ).toEqual({ magnitudeCents: 7840, occurredOn: "2026-11-08", accountId: A });
    expect(
      firstMessage(
        occurrenceConfirmSchema.safeParse({ amount: "-3", occurredOn: "2026-11-08", accountId: A }),
      ),
    ).toBe("Montant invalide.");
  });
});

describe("merchantInputSchema", () => {
  it("normalizes the name, domain and aliases", () => {
    expect(
      merchantInputSchema.parse({
        name: "Fnac",
        domain: "https://www.fnac.com/",
        defaultCategoryId: "",
        aliases: "FNAC.COM\nfnac\n\nFnac Darty 0123",
      }),
    ).toEqual({
      name: "Fnac",
      normalizedName: "fnac",
      domain: "fnac.com",
      defaultCategoryId: null,
      aliases: ["fnac com", "fnac darty"],
    });
  });

  it("rejects an invalid domain", () => {
    const r = merchantInputSchema.safeParse({ name: "X", domain: "127.0.0.1", aliases: "" });
    expect(firstMessage(r)).toBe("Domaine invalide (ex. fnac.com).");
  });
});
