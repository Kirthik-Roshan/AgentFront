import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const sessionCookieName = "agentfront_session";

interface SessionPayload {
  version: 1;
  expiresAt: number;
  nonce: string;
}

export interface FounderSessionOptions {
  apiToken: string;
  sessionSecret?: string;
  secureCookie: boolean;
  ttlSeconds?: number;
  now?: () => number;
}

const digestMatches = (left: string, right: string): boolean => {
  const leftDigest = createHash("sha256").update(left, "utf8").digest();
  const rightDigest = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftDigest, rightDigest);
};

const parseCookies = (header: string | undefined): Map<string, string> => {
  const cookies = new Map<string, string>();
  for (const segment of header?.split(";") ?? []) {
    const separator = segment.indexOf("=");
    if (separator < 1) continue;
    const name = segment.slice(0, separator).trim();
    const value = segment.slice(separator + 1).trim();
    if (name && value) cookies.set(name, value);
  }
  return cookies;
};

export class FounderSessionAuth {
  readonly #apiToken: string;
  readonly #secret: Buffer;
  readonly #secureCookie: boolean;
  readonly #ttlSeconds: number;
  readonly #now: () => number;

  constructor(options: FounderSessionOptions) {
    if (!options.apiToken.trim()) throw new Error("Founder session auth requires an API token.");
    this.#apiToken = options.apiToken;
    this.#secret = createHash("sha256")
      .update("agentfront-founder-session\0", "utf8")
      .update(options.sessionSecret?.trim() || options.apiToken, "utf8")
      .digest();
    this.#secureCookie = options.secureCookie;
    this.#ttlSeconds = options.ttlSeconds ?? 8 * 60 * 60;
    this.#now = options.now ?? Date.now;
  }

  tokenMatches(token: string): boolean {
    return digestMatches(token, this.#apiToken);
  }

  createCookie(): string {
    const payload: SessionPayload = {
      version: 1,
      expiresAt: Math.floor(this.#now() / 1_000) + this.#ttlSeconds,
      nonce: randomBytes(18).toString("base64url"),
    };
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signature = this.#sign(encoded);
    return this.#serializeCookie(`${encoded}.${signature}`, this.#ttlSeconds);
  }

  clearCookie(): string {
    return this.#serializeCookie("deleted", 0);
  }

  validates(cookieHeader: string | undefined): boolean {
    const token = parseCookies(cookieHeader).get(sessionCookieName);
    if (!token) return false;
    const separator = token.lastIndexOf(".");
    if (separator < 1) return false;
    const encoded = token.slice(0, separator);
    const signature = token.slice(separator + 1);
    if (!digestMatches(signature, this.#sign(encoded))) return false;
    try {
      const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<SessionPayload>;
      return payload.version === 1 &&
        typeof payload.nonce === "string" && payload.nonce.length >= 20 &&
        typeof payload.expiresAt === "number" && payload.expiresAt > Math.floor(this.#now() / 1_000);
    } catch {
      return false;
    }
  }

  #sign(encoded: string): string {
    return createHmac("sha256", this.#secret).update(encoded, "utf8").digest("base64url");
  }

  #serializeCookie(value: string, maxAge: number): string {
    return [
      `${sessionCookieName}=${value}`,
      "Path=/api",
      "HttpOnly",
      "SameSite=Strict",
      `Max-Age=${maxAge}`,
      ...(this.#secureCookie ? ["Secure"] : []),
    ].join("; ");
  }
}

export { sessionCookieName };
