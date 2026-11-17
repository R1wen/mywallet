import { describe, expect, it } from "vitest";
import { parseModelQuery } from "./ask";

describe("parseModelQuery", () => {
  it("accepts a well-formed query and normalizes empty filters", () => {
    expect(
      parseModelQuery('{"measure":"spent","period":"last_month","category":"","merchant":null}'),
    ).toEqual({
      measure: "spent",
      period: "last_month",
      category: null,
      merchant: null,
      groupBy: null,
    });
  });

  it("drops an unknown grouping instead of failing", () => {
    expect(
      parseModelQuery({ measure: "count", period: "2026", groupBy: "weekday" })?.groupBy,
    ).toBeNull();
  });

  it("refuses anything that is not a query", () => {
    expect(parseModelQuery("Vous avez dépensé 300 €")).toBeNull();
    expect(parseModelQuery({ measure: "delete", period: "2026" })).toBeNull();
    expect(parseModelQuery({ measure: "spent" })).toBeNull();
  });
});
