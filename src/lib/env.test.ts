import { describe, expect, it } from "vitest";
import { parseServerEnv } from "./env";

const base = {
  DATABASE_URL: "postgres://u:p@localhost:5433/db",
  BETTER_AUTH_SECRET: "x".repeat(32),
};

describe("parseServerEnv", () => {
  it("defaults BETTER_AUTH_URL to localhost outside Vercel production", () => {
    expect(parseServerEnv(base).BETTER_AUTH_URL).toBe("http://localhost:3000");
    expect(parseServerEnv({ ...base, NODE_ENV: "production" }).BETTER_AUTH_URL).toBe(
      "http://localhost:3000",
    );
  });

  it("uses the deployment URL on Vercel previews when BETTER_AUTH_URL is not set", () => {
    expect(
      parseServerEnv({ ...base, VERCEL_ENV: "preview", VERCEL_URL: "mw-abc.vercel.app" })
        .BETTER_AUTH_URL,
    ).toBe("https://mw-abc.vercel.app");
  });

  it("requires an https BETTER_AUTH_URL in Vercel production", () => {
    expect(() => parseServerEnv({ ...base, VERCEL_ENV: "production" })).toThrow(/BETTER_AUTH_URL/);
    expect(() =>
      parseServerEnv({ ...base, VERCEL_ENV: "production", BETTER_AUTH_URL: "http://x.fr" }),
    ).toThrow(/https/);
    expect(
      parseServerEnv({ ...base, VERCEL_ENV: "production", BETTER_AUTH_URL: "https://x.fr" })
        .BETTER_AUTH_URL,
    ).toBe("https://x.fr");
  });

  it('treats empty variables as unset (vercel pull writes VERCEL_URL="")', () => {
    expect(
      parseServerEnv({ ...base, VERCEL_URL: "", BETTER_AUTH_URL: "", VERCEL_ENV: "" })
        .BETTER_AUTH_URL,
    ).toBe("http://localhost:3000");
    expect(() => parseServerEnv({ ...base, DATABASE_URL: "" })).toThrow(/DATABASE_URL/);
  });

  it("rejects a short secret and lists the faulty variables", () => {
    expect(() => parseServerEnv({ ...base, BETTER_AUTH_SECRET: "court" })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
    expect(() => parseServerEnv({})).toThrow(/DATABASE_URL/);
  });
});
