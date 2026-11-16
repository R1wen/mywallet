import { describe, expect, it } from "vitest";
import { merchantInitials, normalizeMerchantName } from "./merchant";

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
