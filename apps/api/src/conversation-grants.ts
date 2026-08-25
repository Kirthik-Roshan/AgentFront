import { randomUUID } from "node:crypto";
import type {
  ConversationProvider,
  ConversationSessionInput,
  ProviderMode,
} from "@agentfront/types";

export interface BrowserConversationGrant {
  grantId: string;
  logicalConversationId: string;
  signedUrl: string;
  expiresAt: string;
  mode: ProviderMode;
}

interface StoredGrant extends BrowserConversationGrant {
  leadId: string;
  idempotencyKey: string;
  issuedAt: string;
  boundProviderConversationId: string | null;
}

export class ConversationGrantStore {
  readonly #byId = new Map<string, StoredGrant>();
  readonly #byOperation = new Map<string, string>();
  readonly #inFlight = new Map<string, {
    logicalConversationId: string;
    promise: Promise<{ grant: BrowserConversationGrant; replayed: boolean }>;
  }>();

  constructor(
    private readonly maximumEntries = 500,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async issue(input: {
    leadId: string;
    logicalConversationId: string;
    idempotencyKey: string;
    provider: ConversationProvider;
    providerInput: ConversationSessionInput;
  }): Promise<{ grant: BrowserConversationGrant; replayed: boolean }> {
    this.#prune();
    const operation = `${input.leadId}:${input.idempotencyKey}`;
    const existingId = this.#byOperation.get(operation);
    const existing = existingId ? this.#byId.get(existingId) : null;
    if (existing) {
      if (existing.logicalConversationId !== input.logicalConversationId) {
        throw new Error("The idempotency key conflicts with another logical conversation.");
      }
      if (existing.boundProviderConversationId) {
        throw new Error("The browser conversation grant has already been consumed.");
      }
      return { grant: this.#public(existing), replayed: true };
    }
    const inFlight = this.#inFlight.get(operation);
    if (inFlight) {
      if (inFlight.logicalConversationId !== input.logicalConversationId) {
        throw new Error("The idempotency key conflicts with another logical conversation.");
      }
      const issued = await inFlight.promise;
      return { grant: issued.grant, replayed: true };
    }
    if (this.#byId.size + this.#inFlight.size >= this.maximumEntries) {
      throw new Error("The browser conversation grant capacity has been reached.");
    }

    const promise = this.#issueNew(input, operation);
    this.#inFlight.set(operation, { logicalConversationId: input.logicalConversationId, promise });
    try {
      return await promise;
    } finally {
      this.#inFlight.delete(operation);
    }
  }

  async #issueNew(
    input: {
      leadId: string;
      logicalConversationId: string;
      idempotencyKey: string;
      provider: ConversationProvider;
      providerInput: ConversationSessionInput;
    },
    operation: string,
  ): Promise<{ grant: BrowserConversationGrant; replayed: boolean }> {
    const authorized = await input.provider.authorizeClientSession(input.providerInput, input.idempotencyKey);
    const now = this.clock();
    const providerExpiry = new Date(authorized.expiresAt);
    if (!Number.isFinite(providerExpiry.getTime()) || providerExpiry.getTime() <= now.getTime()) {
      throw new Error("The conversation provider returned an expired browser grant.");
    }
    const maximumExpiry = new Date(now.getTime() + 15 * 60_000);
    const expiresAt = providerExpiry.getTime() < maximumExpiry.getTime() ? providerExpiry : maximumExpiry;
    const stored: StoredGrant = {
      grantId: `conversation-grant-${randomUUID()}`,
      logicalConversationId: input.logicalConversationId,
      signedUrl: authorized.signedUrl,
      expiresAt: expiresAt.toISOString(),
      mode: authorized.mode,
      leadId: input.leadId,
      idempotencyKey: input.idempotencyKey,
      issuedAt: now.toISOString(),
      boundProviderConversationId: null,
    };
    this.#byId.set(stored.grantId, stored);
    this.#byOperation.set(operation, stored.grantId);
    return { grant: this.#public(stored), replayed: false };
  }

  getForBinding(grantId: string, leadId: string): { consumed: boolean } | null {
    this.#prune();
    const grant = this.#byId.get(grantId);
    if (!grant || grant.leadId !== leadId) return null;
    return { consumed: grant.boundProviderConversationId !== null };
  }

  markBound(grantId: string, leadId: string, providerConversationId: string): void {
    this.#prune();
    const grant = this.#byId.get(grantId);
    if (!grant || grant.leadId !== leadId) throw new Error("The browser conversation grant is invalid or expired.");
    if (
      grant.boundProviderConversationId &&
      grant.boundProviderConversationId !== providerConversationId
    ) {
      throw new Error("The browser conversation grant is already bound to another provider conversation.");
    }
    grant.boundProviderConversationId = providerConversationId;
  }

  #public(grant: StoredGrant): BrowserConversationGrant {
    return {
      grantId: grant.grantId,
      logicalConversationId: grant.logicalConversationId,
      signedUrl: grant.signedUrl,
      expiresAt: grant.expiresAt,
      mode: grant.mode,
    };
  }

  #prune(): void {
    const now = this.clock().getTime();
    for (const [id, grant] of this.#byId) {
      if (Date.parse(grant.expiresAt) > now) continue;
      this.#byId.delete(id);
      this.#byOperation.delete(`${grant.leadId}:${grant.idempotencyKey}`);
    }
  }
}
