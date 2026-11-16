import { describe, expect, it } from "vitest";
import { parseFrenchAmount, parseReceiptDate, parseReceiptText } from "./parse";

describe("parseFrenchAmount", () => {
  it.each([
    ["12,50", 1250],
    ["12.50", 1250],
    ["1 234,56", 123456],
    ["1.234,56", 123456],
    ["-3,20", -320],
    ["3,20-", -320],
    ["0,99 €", 99],
    ["EUR 4,00", 400],
    ["12,5", null],
    ["abc", null],
  ])("%j -> %j", (input, expected) => {
    expect(parseFrenchAmount(input)).toBe(expected);
  });
});

describe("parseReceiptDate", () => {
  it.each([
    ["14/11/2026", "2026-11-14"],
    ["14/11/26", "2026-11-14"],
    ["14.11.2026", "2026-11-14"],
    ["14-11-2026", "2026-11-14"],
    ["2026-11-14", "2026-11-14"],
    ["14 novembre 2026", "2026-11-14"],
    ["14 nov. 2026", "2026-11-14"],
    ["31/02/2026", null],
    ["14/13/2026", null],
  ])("%j -> %j", (input, expected) => {
    expect(parseReceiptDate(input)).toBe(expected);
  });
});

const SUPERMARKET = `
CARREFOUR MARKET 0123
12 RUE DES LILAS
75011 PARIS
TEL 01 23 45 67 89
SIRET 123 456 789 00012

LAIT DEMI ECR 1L
   2 x 1,25                 2,50
PAIN DE MIE               1,89
POMMES GOLDEN
  0,856 kg x 2,99 €/kg      2,56
CAFE MOULU 250G           3,45
REMISE IMMEDIATE         -0,50
SOUS-TOTAL                9,90

TOTAL TTC                 9,90 €
CB SANS CONTACT           9,90

TVA   TAUX    HT     TVA    TTC
A     5,50%   9,38   0,52   9,90

14/11/2026  18:42   CAISSE 04
MERCI DE VOTRE VISITE
`;

describe("parseReceiptText — supermarket", () => {
  const r = parseReceiptText(SUPERMARKET);

  it("reads the header, date, time and total", () => {
    expect(r.merchantRaw).toBe("CARREFOUR MARKET 0123");
    expect(r.date).toBe("2026-11-14");
    expect(r.time).toBe("18:42");
    expect(r.totalCents).toBe(990);
    expect(r.currency).toBe("EUR");
    expect(r.paymentMethod).toBe("card");
  });

  it("reads items with quantities on the next line", () => {
    expect(r.items).toEqual([
      { label: "LAIT DEMI ECR 1L", quantity: 2, unitPriceCents: 125, totalCents: 250 },
      { label: "PAIN DE MIE", quantity: 1, unitPriceCents: 189, totalCents: 189 },
      { label: "POMMES GOLDEN", quantity: 0.856, unitPriceCents: 299, totalCents: 256 },
      { label: "CAFE MOULU 250G", quantity: 1, unitPriceCents: 345, totalCents: 345 },
    ]);
    expect(r.discountsCents).toBe(-50);
  });

  it("reads the VAT table", () => {
    expect(r.vat).toEqual([{ rateBp: 550, baseCents: 938, vatCents: 52 }]);
  });
});

const RESTAURANT = `
LE PETIT ZINC
Brasserie
8 place du Marché 69002 Lyon

Table 12        Couverts 2
2 Plat du jour        29,00
1 Café gourmand        7,50
1 Carafe de vin       12,00

NET A PAYER           48,50 EUR
Dont TVA 10% : 4,41
ESPECES               50,00
RENDU                  1,50

Le 03.10.2026 à 13h05
`;

describe("parseReceiptText — restaurant", () => {
  const r = parseReceiptText(RESTAURANT);

  it("reads leading quantities, NET A PAYER and cash", () => {
    expect(r.merchantRaw).toBe("LE PETIT ZINC");
    expect(r.date).toBe("2026-10-03");
    expect(r.time).toBe("13:05");
    expect(r.totalCents).toBe(4850);
    expect(r.paymentMethod).toBe("cash");
    expect(r.items).toEqual([
      { label: "Plat du jour", quantity: 2, unitPriceCents: 1450, totalCents: 2900 },
      { label: "Café gourmand", quantity: 1, unitPriceCents: 750, totalCents: 750 },
      { label: "Carafe de vin", quantity: 1, unitPriceCents: 1200, totalCents: 1200 },
    ]);
  });

  it("derives the VAT base from a 'dont TVA' line", () => {
    expect(r.vat).toEqual([{ rateBp: 1000, baseCents: 4409, vatCents: 441 }]);
  });
});

const FUEL = `
TOTAL ENERGIES
RELAIS DES ALPES
Pompe 3  SP95-E10
42,17 L x 1,859 EUR/L
MONTANT              78,39
A PAYER              78,39 EUR
TVA 20,00%  HT 65,33  TVA 13,06
CARTE BANCAIRE
02/11/26 08:15
`;

describe("parseReceiptText — fuel", () => {
  const r = parseReceiptText(FUEL);

  it("reads the litres line as one item", () => {
    expect(r.merchantRaw).toBe("TOTAL ENERGIES");
    expect(r.date).toBe("2026-11-02");
    expect(r.totalCents).toBe(7839);
    expect(r.items).toEqual([
      { label: "SP95-E10", quantity: 42.17, unitPriceCents: 186, totalCents: 7839 },
    ]);
    expect(r.vat).toEqual([{ rateBp: 2000, baseCents: 6533, vatCents: 1306 }]);
    expect(r.paymentMethod).toBe("card");
  });
});

describe("parseReceiptText — deadlines", () => {
  it("computes return and warranty dates from durations", () => {
    const r = parseReceiptText(`
BRICO DEPOT
PERCEUSE 18V     89,90
TOTAL            89,90
CB               89,90
Le 05/11/2026
Echange ou remboursement sous 30 jours
Garantie 2 ans
`);
    expect(r.returnDeadline).toBe("2026-12-05");
    expect(r.warrantyUntil).toBe("2028-11-05");
  });

  it("reads explicit deadline dates", () => {
    const r = parseReceiptText(`
ZARA
JEAN SLIM 39,95
TOTAL 39,95
14/11/2026
Retour possible jusqu'au 14/12/2026
`);
    expect(r.returnDeadline).toBe("2026-12-14");
    expect(r.warrantyUntil).toBeNull();
  });
});

describe("parseReceiptText — robustness", () => {
  it("returns empty fields for noise", () => {
    const r = parseReceiptText("~~~ \n ### \n");
    expect(r).toMatchObject({
      merchantRaw: null,
      date: null,
      totalCents: null,
      items: [],
      vat: [],
      discountsCents: 0,
    });
  });

  it("ignores card expiry and total lines that are not the paid amount", () => {
    const r = parseReceiptText(`
MONOPRIX
BANANES 1,99
TOTAL HT 1,89
TOTAL TVA 0,10
TOTAL 1,99
CARTE XXXX XXXX XXXX 1234 EXP 12/28
16/11/2026 10:01
`);
    expect(r.totalCents).toBe(199);
    expect(r.date).toBe("2026-11-16");
    expect(r.items).toEqual([
      { label: "BANANES", quantity: 1, unitPriceCents: 199, totalCents: 199 },
    ]);
  });

  it("falls back to the payment amount when no total line is readable", () => {
    const r = parseReceiptText(`
BOULANGERIE MARIE
BAGUETTE 1,20
CROISSANT 1,10
CB 2,30
`);
    expect(r.totalCents).toBe(230);
  });

  it("attaches a quantity line printed before its label", () => {
    const r = parseReceiptText(`
BOULANGERIE MARIE
BAGUETTE TRADITION 1,30
   2 x 1,10   2,20
CROISSANT
TOTAL TTC 3,50
`);
    expect(r.items).toEqual([
      { label: "BAGUETTE TRADITION", quantity: 1, unitPriceCents: 130, totalCents: 130 },
      { label: "CROISSANT", quantity: 2, unitPriceCents: 110, totalCents: 220 },
    ]);
  });

  it("splits a time glued to the date", () => {
    const r = parseReceiptText(`KIABI
PULL 22,00
TOTAL 22,00
25/10/202614:52`);
    expect([r.date, r.time]).toEqual(["2026-10-25", "14:52"]);
  });

  it("keeps items whose label contains a percentage", () => {
    const r = parseReceiptText(`LIDL
STEAK HACHE 5% X2 3,59 A
TOTAL 3,59`);
    expect(r.items.map((i) => i.totalCents)).toEqual([359]);
  });

  it("treats a negative line without keyword as a discount", () => {
    const r = parseReceiptText(`FNAC
CASQUE 49,99
Livraison offerte -3,99
TOTAL 46,00`);
    expect(r.discountsCents).toBe(-399);
    expect(r.items).toHaveLength(1);
  });

  it("fixes common OCR letter/digit swaps inside amounts", () => {
    const r = parseReceiptText(`
PICARD
GLACES 5,O9
TOTAL 5,O9
`);
    expect(r.totalCents).toBe(509);
  });
});
