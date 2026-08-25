import { describe, expect, it } from "vitest";
import { FounderSessionAuth, sessionCookieName } from "./session-auth";

describe("FounderSessionAuth", () => {
  it("mints an HttpOnly signed session without exposing the API token", () => {
    let now = Date.parse("2026-08-23T12:00:00.000Z");
    const auth = new FounderSessionAuth({
      apiToken: "founder-secret-token",
      sessionSecret: "independent-cookie-secret",
      secureCookie: true,
      ttlSeconds: 60,
      now: () => now,
    });

    const cookie = auth.createCookie();
    expect(cookie).toContain(`${sessionCookieName}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure");
    expect(cookie).not.toContain("founder-secret-token");
    expect(auth.validates(cookie)).toBe(true);

    now += 61_000;
    expect(auth.validates(cookie)).toBe(false);
  });

  it("rejects tampered cookies and compares login tokens", () => {
    const auth = new FounderSessionAuth({ apiToken: "correct-token", secureCookie: false });
    const cookie = auth.createCookie();
    const tampered = cookie.replace(`${sessionCookieName}=`, `${sessionCookieName}=x`);

    expect(auth.tokenMatches("correct-token")).toBe(true);
    expect(auth.tokenMatches("incorrect-token")).toBe(false);
    expect(auth.validates(tampered)).toBe(false);
    expect(auth.clearCookie()).toContain("Max-Age=0");
  });
});
