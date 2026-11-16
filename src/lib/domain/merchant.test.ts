import { describe, expect, it } from "vitest";
import {
  findMerchantByLabel,
  mergeAliases,
  merchantInitials,
  normalizeDomain,
  normalizeMerchantName,
} from "./merchant";

describe("merchantInitials", () => {
  it.each([
    ["Carrefour", "CA"],
    ["Leroy Merlin", "LM"],
    ["la Poste", "LP"],
    ["E.Leclerc", "EL"],
    ["SNCF Connect", "SC"],
    ["Café des Arts", "CA"],
    ["  ", "?"],
    ["7-Eleven", "7E"],
  ])("%j -> %s", (name, expected) => {
    expect(merchantInitials(name)).toBe(expected);
  });
});

describe("normalizeMerchantName", () => {
  it.each([
    ["CARREFOUR MARKET 0123", "carrefour market"],
    ["  Monoprix   Paris 11 ", "monoprix paris"],
    ["E.LECLERC", "e leclerc"],
    ["Café de l'Église", "cafe de l eglise"],
    ["AMAZON.FR*2X4Y", "amazon fr"],
    ["CB PICARD 12/03", "picard"],
    ["LIDL F42 0412", "lidl"],
    ["7 ELEVEN", "7 eleven"],
    ["0123", "0123"],
  ])("%j -> %j", (raw, expected) => {
    expect(normalizeMerchantName(raw)).toBe(expected);
  });

  it("runs in linear time on adversarial input (no ReDoS)", () => {
    const start = performance.now();
    expect(normalizeMerchantName(`a${" 9".repeat(50_000)}!`)).toBe("a");
    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe("normalizeDomain", () => {
  it.each([
    ["amazon.fr", "amazon.fr"],
    ["  Amazon.FR ", "amazon.fr"],
    ["https://www.amazon.fr/gp/cart?x=1", "amazon.fr"],
    ["http://shop.example.co.uk", "shop.example.co.uk"],
    ["www.e.leclerc", "e.leclerc"],
    ["sncf-connect.com/", "sncf-connect.com"],
    ["xn--caf-dma.fr", "xn--caf-dma.fr"],
    ["", null],
    ["localhost", null],
    ["127.0.0.1", null],
    ["[::1]", null],
    ["10.0.0.1:8080", null],
    ["amazon", null],
    ["ama zon.fr", null],
    ["-bad.fr", null],
    ["user@evil.com", null],
    ["javascript:alert(1)", null],
    ["a".repeat(64) + ".fr", null],
  ])("%j -> %j", (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });
});

describe("mergeAliases", () => {
  it("unions source names and aliases into the target, without its own key or duplicates", () => {
    expect(
      mergeAliases({ normalizedName: "carrefour", aliases: ["carrefour market"] }, [
        { normalizedName: "carrefour city", aliases: ["crf express", "carrefour market"] },
        { normalizedName: "carrefour", aliases: [] },
      ]),
    ).toEqual(["carrefour city", "carrefour market", "crf express"]);
  });
});

describe("findMerchantByLabel", () => {
  const merchants = [
    { id: "m1", normalizedName: "carrefour", aliases: ["carrefour market", "crf express"] },
    { id: "m2", normalizedName: "amazon", aliases: ["amazon fr", "amzn mktp fr"] },
  ];

  it.each([
    ["CARREFOUR MARKET 0123", "m1"],
    ["Carrefour", "m1"],
    ["AMAZON.FR*2X4Y", "m2"],
    ["CB AMZN Mktp FR 12/03", "m2"],
    ["Picard", null],
    ["", null],
  ])("%j -> %j", (label, expected) => {
    expect(findMerchantByLabel(label, merchants)?.id ?? null).toBe(expected);
  });
});
