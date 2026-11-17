import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildXlsx } from "./xlsx";

describe("buildXlsx", () => {
  const file = buildXlsx(
    "Transactions",
    [{ label: "Date", type: "date" }, { label: "Libellé" }, { label: "Montant", type: "money" }],
    [
      ["2026-11-17", "Carrefour & Co <promo>", -12.5],
      ["2026-11-18", '=HYPERLINK("http://x")', 2100],
    ],
  );
  const parts = unzipSync(file);
  const sheet = strFromU8(parts["xl/worksheets/sheet1.xml"]!);

  it("is a valid package with the expected parts", () => {
    expect(Object.keys(parts).sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
    ]);
  });

  it("escapes text and never writes formulas", () => {
    expect(sheet).toContain("Carrefour &amp; Co &lt;promo&gt;");
    expect(sheet).not.toContain("<f>");
    expect(sheet).toContain(
      't="inlineStr"><is><t xml:space="preserve">=HYPERLINK(&quot;http://x&quot;)',
    );
  });

  it("writes dates and amounts as numbers with their format", () => {
    // 2026-11-17 is Excel serial 46343.
    expect(sheet).toContain('<c r="A2" s="3"><v>46343</v></c>');
    expect(sheet).toContain('<c r="C2" s="2"><v>-12.5</v></c>');
  });
});
