import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildReportPdf, pdfText } from "./pdf";

describe("pdfText", () => {
  it("keeps French text, euro and quotes; replaces what Helvetica cannot draw", () => {
    expect(pdfText("1 234,56 € – « été » → œuvre")).toBe("1 234,56 € – « été » -> œuvre");
    expect(pdfText("café ☕")).toBe("café ?");
  });
});

describe("buildReportPdf", () => {
  it("produces a PDF document, several pages when long", async () => {
    const bytes = await buildReportPdf({
      title: "Rapport d'octobre 2026",
      subtitle: "Calculé à partir de vos mouvements.",
      sections: Array.from({ length: 30 }, (_, i) => ({
        title: `Section ${i}`,
        lines: ["Dépenses : 1 820,00 €, en hausse de 10 % par rapport au mois précédent."],
      })),
    });
    const head = new TextDecoder().decode(bytes.slice(0, 5));
    expect(head).toBe("%PDF-");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
  });
});
