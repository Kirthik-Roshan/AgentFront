import { describe, expect, it } from "vitest";
import {
  InvalidPhoneNumberError,
  isE164Phone,
  normalizePhoneToE164,
  tryNormalizePhoneToE164,
} from "./phone";

describe("normalizePhoneToE164", () => {
  it("normalizes common Indian mobile and landline formats", () => {
    expect(normalizePhoneToE164("98765 43210")).toBe("+919876543210");
    expect(normalizePhoneToE164("91-98765-43210")).toBe("+919876543210");
    expect(normalizePhoneToE164("+91 (98765) 43210")).toBe("+919876543210");
    expect(normalizePhoneToE164("0091 98765 43210")).toBe("+919876543210");
    expect(normalizePhoneToE164("044 2345 6789")).toBe("+914423456789");
  });

  it("preserves valid explicit international E.164 country codes", () => {
    expect(normalizePhoneToE164("+1 (415) 555-2671")).toBe("+14155552671");
    expect(isE164Phone("+14155552671")).toBe(true);
  });

  it("rejects extensions, letters, ambiguous raw international input and malformed values", () => {
    for (const input of [
      "9876543210 ext 2",
      "tel:+919876543210",
      "12345",
      "44123456789",
      "+91+9876543210",
      "91+9876543210",
      "+0000000000",
      "+1234567890123456",
    ]) {
      expect(() => normalizePhoneToE164(input), input).toThrow(InvalidPhoneNumberError);
    }
  });

  it("offers a null-returning lookup helper without making identity assumptions", () => {
    expect(tryNormalizePhoneToE164("9876543210")).toBe("+919876543210");
    expect(tryNormalizePhoneToE164("unknown caller")).toBeNull();
  });
});
