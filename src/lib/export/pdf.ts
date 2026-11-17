import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

/**
 * Monthly report as a PDF (ADR-042): A4, standard Helvetica (no font file to ship),
 * black on white for printing. Text is reduced to what WinAnsi can encode.
 */

const WIN_ANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";

/** Spaces of French formatting become plain spaces; unsupported characters become "?". */
export function pdfText(input: string): string {
  return input
    .replace(/[   ]/g, " ")
    .replace(/→/g, "->")
    .replace(/[^ -~ -ÿ]/g, (c) => (WIN_ANSI_EXTRA.includes(c) ? c : "?"));
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = pdfText(text).split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > width && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export async function buildReportPdf(report: {
  title: string;
  subtitle: string;
  sections: { title: string; lines: string[] }[];
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfText(report.title));
  doc.setProducer("myWallet");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const [W, H] = [595.28, 841.89];
  const margin = 56;
  const width = W - margin * 2;
  let page = doc.addPage([W, H]);
  let y = H - margin;
  const ensure = (needed: number) => {
    if (y - needed < margin) {
      page = doc.addPage([W, H]);
      y = H - margin;
    }
  };
  const draw = (text: string, font: PDFFont, size: number, color = rgb(0, 0, 0), gap = 4) => {
    for (const line of wrap(text, font, size, width)) {
      ensure(size + gap);
      y -= size;
      page.drawText(line, { x: margin, y, size, font, color });
      y -= gap;
    }
  };

  draw(report.title, bold, 20, rgb(0, 0, 0), 8);
  draw(report.subtitle, regular, 10, rgb(0.35, 0.35, 0.35), 18);
  for (const s of report.sections) {
    ensure(40);
    draw(s.title, bold, 12, rgb(0, 0, 0), 6);
    for (const line of s.lines) draw(line, regular, 11, rgb(0.1, 0.1, 0.1), 5);
    y -= 12;
  }
  return doc.save();
}
