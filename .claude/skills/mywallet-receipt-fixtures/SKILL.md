---
name: mywallet-receipt-fixtures
description: How to add a receipt/invoice fixture (photo, scan or PDF) with its expected extraction result to the myWallet OCR test set, anonymised. Use it whenever a receipt image or PDF is added for tests or benchmarks, when the parser or OCR pipeline gets a new case, or when the user drops tickets into fixtures/receipts-private/.
---

# Receipt fixtures

The OCR benchmark and the deterministic parser are only as good as their fixtures. Each fixture pairs a real-world receipt with the exact values a human would validate, so regressions are caught by `pnpm test` rather than by the user noticing a wrong total.

## Two folders, two privacy levels

- `fixtures/receipts/<id>/` — committed. Must be anonymised (see below). Used by CI.
- `fixtures/receipts-private/<id>/` — git-ignored, the user's real tickets. Same layout. Used locally for the benchmark only. Never copy their content, text or values into committed files, docs, test names or logs; report aggregate metrics only.

## Layout

```
fixtures/receipts/<id>/
  source.jpg | source.png | source.webp | source.heic | source.pdf
  expected.json
  ocr.txt          (optional: raw OCR text, lets parser tests run without OCR)
  NOTES.md         (optional: what makes this case hard)
```

`<id>` = `<merchant-slug>-<yyyy-mm>-<nn>`, e.g. `carrefour-2026-11-01`.

## expected.json

```json
{
  "merchant": "Carrefour",
  "merchantRaw": "CARREFOUR MARKET 0123",
  "date": "2026-11-14",
  "time": "18:42",
  "currency": "EUR",
  "totalCents": 8040,
  "paymentMethod": "card",
  "vat": [{ "rateBp": 550, "baseCents": 5210, "vatCents": 287 }],
  "items": [
    { "label": "LAIT DEMI ECR 1L", "quantity": 2, "unitPriceCents": 125, "totalCents": 250 }
  ],
  "discountsCents": -120,
  "returnDeadline": null,
  "warrantyUntil": null,
  "difficulty": ["photo", "crumpled", "low-light"]
}
```

Rules: amounts in integer cents; VAT rates in basis points (5,5 % = 550); dates ISO in Europe/Paris; `items` sum + discounts must equal `totalCents` (the test helper checks it); use `null` for fields absent from the receipt, never a guess.

## Anonymisation (committed fixtures)

- Blur or crop: card numbers (even masked), loyalty numbers, names, addresses of private persons, barcodes/QR codes linked to an account, transaction IDs.
- Keep merchant name, date, items, totals, VAT: they are the point of the test.
- Strip EXIF (GPS!): `node scripts/strip-exif.mjs <file>` (Sprint 3) or re-encode with sharp.
- Prefer public sample receipts or receipts you photographed yourself and are happy to publish.

## Checklist when adding one

1. Create the folder, add the source file (stripped of EXIF).
2. Write `expected.json` by reading the receipt yourself, not from OCR output.
3. Add `difficulty` tags so the benchmark can break results down by category.
4. Run `pnpm test -- receipts` (parser) and, in Sprint 3+, the benchmark command in `docs/OCR-BENCHMARK.md`.
5. Aim for variety: supermarket, restaurant, fuel, pharmacy, e-commerce PDF invoice, multi-page PDF, handwritten total, faded thermal paper, skewed photo.
