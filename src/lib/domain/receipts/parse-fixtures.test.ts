/**
 * Parser regression gate on the committed fixtures (ADR-030): the raw OCR outputs saved
 * by the benchmark are parsed and compared with expected.json. Exact per-receipt checks
 * for the fields a wrong value would hurt most (total, date), minimum rates for the rest
 * (some remaining misses are OCR misreads, not parser bugs: see docs/OCR-BENCHMARK.md).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseReceiptText, type ParsedReceipt } from "./parse";

const ROOT = path.join(process.cwd(), "fixtures", "receipts");
const ENGINES = ["tesseract", "paddle"] as const;

type Case = { id: string; text: string; expected: ParsedReceipt };

function cases(engine: (typeof ENGINES)[number]): Case[] {
  if (!existsSync(ROOT)) return [];
  return readdirSync(ROOT).flatMap((id) => {
    const dir = path.join(ROOT, id);
    const file = [`ocr.${engine}.txt`, "ocr.pdf-text.txt"]
      .map((f) => path.join(dir, f))
      .find((f) => existsSync(f));
    if (!file) return [];
    const expected = JSON.parse(readFileSync(path.join(dir, "expected.json"), "utf8"));
    return [{ id, text: readFileSync(file, "utf8"), expected }];
  });
}

const rate = (list: Case[], ok: (r: ParsedReceipt, c: Case) => boolean) =>
  list.filter((c) => ok(parseReceiptText(c.text), c)).length / list.length;

describe.each(ENGINES)("parser on %s output", (engine) => {
  const list = cases(engine);

  it("has at least 15 fixtures", () => {
    expect(list.length).toBeGreaterThanOrEqual(15);
  });

  it.each(list.map((c) => [c.id, c] as const))("%s: total and date", (_, c) => {
    const r = parseReceiptText(c.text);
    expect(r.totalCents).toBe(c.expected.totalCents);
    expect(r.date).toBe(c.expected.date);
  });

  it("reads items, VAT, payment and deadlines on most receipts", () => {
    const sameItems = (r: ParsedReceipt, c: Case) =>
      r.items.length === c.expected.items.length &&
      r.items.every((it, i) => it.totalCents === c.expected.items[i]?.totalCents);
    expect(rate(list, sameItems)).toBeGreaterThanOrEqual(0.9);
    expect(
      rate(list, (r, c) => JSON.stringify(r.vat) === JSON.stringify(c.expected.vat)),
    ).toBeGreaterThanOrEqual(0.9);
    expect(rate(list, (r, c) => r.paymentMethod === c.expected.paymentMethod)).toBe(1);
    expect(rate(list, (r, c) => r.discountsCents === c.expected.discountsCents)).toBe(1);
    expect(
      rate(
        list,
        (r, c) =>
          r.returnDeadline === c.expected.returnDeadline &&
          r.warrantyUntil === c.expected.warrantyUntil,
      ),
    ).toBe(1);
  });
});
