import { describe, expect, it } from "vitest";
import { safeNextPath } from "./redirect";

describe("safeNextPath", () => {
  it.each([
    ["/transactions?page=2", "/transactions?page=2"],
    ["/", "/"],
    [null, "/"],
    ["", "/"],
    ["https://evil.example", "/"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["javascript:alert(1)", "/"],
    ["/\u0000evil", "/"],
  ])("%j -> %j", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});
