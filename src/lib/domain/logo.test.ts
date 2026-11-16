import { describe, expect, it } from "vitest";
import { detectImageType, isLogoCacheFresh, resolveLogo } from "./logo";

describe("resolveLogo", () => {
  it.each([
    [
      { logoSource: "upload", hasUpload: true, brandSlug: "carrefour", domain: "carrefour.fr" },
      { kind: "upload" },
    ],
    [
      { logoSource: "none", hasUpload: true, brandSlug: "carrefour", domain: "carrefour.fr" },
      { kind: "monogram" },
    ],
    [
      { logoSource: null, hasUpload: false, brandSlug: "carrefour", domain: "carrefour.fr" },
      { kind: "brand", slug: "carrefour" },
    ],
    [
      { logoSource: null, hasUpload: false, brandSlug: null, domain: "decathlon.fr" },
      { kind: "favicon" },
    ],
    [{ logoSource: null, hasUpload: false, brandSlug: null, domain: null }, { kind: "monogram" }],
    // "upload" chosen but the file is gone: fall back to the automatic chain.
    [
      { logoSource: "upload", hasUpload: false, brandSlug: null, domain: "fnac.com" },
      { kind: "favicon" },
    ],
  ] as const)("%j", (input, expected) => {
    expect(resolveLogo(input)).toEqual(expected);
  });
});

describe("isLogoCacheFresh", () => {
  const now = new Date("2026-11-16T12:00:00Z");
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

  it.each([
    ["ok", 29, true],
    ["ok", 31, false],
    ["missing", 6, true],
    ["missing", 8, false],
  ] as const)("%s fetched %d days ago -> %s", (status, days, expected) => {
    expect(isLogoCacheFresh({ status, fetchedAt: daysAgo(days) }, now)).toBe(expected);
  });
});

describe("detectImageType", () => {
  const bytes = (...b: number[]) => new Uint8Array([...b, 0, 0, 0, 0, 0, 0, 0, 0]);

  it.each([
    [bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), "image/png"],
    [bytes(0xff, 0xd8, 0xff, 0xe0), "image/jpeg"],
    [bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61), "image/gif"],
    [bytes(0x00, 0x00, 0x01, 0x00), "image/x-icon"],
    [new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]), "image/webp"],
    [new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>"), null],
    [new TextEncoder().encode("<html>"), null],
    [new Uint8Array([]), null],
  ])("%#", (input, expected) => {
    expect(detectImageType(input)).toBe(expected);
  });
});
