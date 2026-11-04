const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
const SAFE_PHONE_INPUT = /^[+\d\s().-]+$/;

export class InvalidPhoneNumberError extends Error {
  constructor(message = "Phone number is not a valid E.164 or Indian national number.") {
    super(message);
    this.name = "InvalidPhoneNumberError";
  }
}

export function isE164Phone(value: string): boolean {
  return E164_PATTERN.test(value);
}

/**
 * Normalize a public/caller phone number without resolving it to a person or
 * business. Callers can legitimately match multiple contacts; that ambiguity
 * must be handled by the repository/identity layer, not hidden here.
 */
export function normalizePhoneToE164(value: string): string {
  const input = value.trim();
  if (!input || input.length > 64 || !SAFE_PHONE_INPUT.test(input)) {
    throw new InvalidPhoneNumberError();
  }

  const plusCount = [...input].filter((character) => character === "+").length;
  if (plusCount > 1 || (plusCount === 1 && !input.startsWith("+"))) {
    throw new InvalidPhoneNumberError();
  }

  const digits = input.replace(/\D/g, "");
  let normalized: string;

  if (input.startsWith("+")) {
    normalized = `+${digits}`;
  } else if (digits.startsWith("00")) {
    normalized = `+${digits.slice(2)}`;
  } else if (digits.length === 12 && digits.startsWith("91")) {
    normalized = `+${digits}`;
  } else if (digits.length === 11 && digits.startsWith("0")) {
    normalized = `+91${digits.slice(1)}`;
  } else if (digits.length === 10 && !digits.startsWith("0")) {
    normalized = `+91${digits}`;
  } else {
    throw new InvalidPhoneNumberError();
  }

  if (!isE164Phone(normalized)) throw new InvalidPhoneNumberError();
  return normalized;
}

export function tryNormalizePhoneToE164(value: string): string | null {
  try {
    return normalizePhoneToE164(value);
  } catch (error) {
    if (error instanceof InvalidPhoneNumberError) return null;
    throw error;
  }
}
