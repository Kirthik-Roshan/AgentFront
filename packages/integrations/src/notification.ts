export interface DeliveryNotification {
  recipient: string;
  customerName: string | null;
  businessName: string;
  websiteUrl: string;
  checkoutUrl: string;
  amountMinor: number;
  currency: "INR";
  idempotencyKey: string;
}

export interface NotificationReceipt {
  provider: string;
  messageId: string;
  sentAt: string;
}

export interface NotificationProvider {
  readonly name: string;
  readonly configured: boolean;
  sendDelivery(input: DeliveryNotification): Promise<NotificationReceipt>;
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const httpsUrl = (value: string, label: string): string => {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`${label} must use HTTPS.`);
  return url.toString();
};
const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
}[character] ?? character));

export class ResendNotificationProvider implements NotificationProvider {
  readonly name = "Resend Email";
  readonly configured = true;
  constructor(private readonly apiKey: string, private readonly from: string, private readonly fetcher: typeof fetch = fetch) {
    if (!/^re_[A-Za-z0-9_-]{12,}$/.test(apiKey.trim())) throw new Error("RESEND_API_KEY is invalid.");
    if (!from.trim() || from.length > 254) throw new Error("DELIVERY_EMAIL_FROM is invalid.");
  }

  async sendDelivery(input: DeliveryNotification): Promise<NotificationReceipt> {
    const recipient = input.recipient.trim().toLowerCase();
    if (!emailPattern.test(recipient) || recipient.length > 254) throw new Error("Delivery recipient email is invalid.");
    const websiteUrl = httpsUrl(input.websiteUrl, "websiteUrl");
    const checkoutUrl = httpsUrl(input.checkoutUrl, "checkoutUrl");
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 1) throw new Error("Delivery amount is invalid.");
    const amount = (input.amountMinor / 100).toFixed(2);
    const greeting = input.customerName?.trim() ? `Hello ${escapeHtml(input.customerName.trim())},` : "Hello,";
    const response = await this.fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({
        from: this.from,
        to: [recipient],
        subject: `${input.businessName} website is ready`,
        html: `<p>${greeting}</p><p>Your ${escapeHtml(input.businessName)} website is complete.</p><p><a href="${escapeHtml(websiteUrl)}">Open website</a></p><p>Complete the INR ${amount} payment securely:</p><p><a href="${escapeHtml(checkoutUrl)}">Pay with Dodo</a></p><p>Payment is confirmed only after Dodo verifies it.</p>`,
        text: `${input.customerName?.trim() ? `Hello ${input.customerName.trim()},` : "Hello,"}\n\nYour ${input.businessName} website is complete.\nWebsite: ${websiteUrl}\nPayment (INR ${amount}): ${checkoutUrl}\n\nPayment is confirmed only after Dodo verifies it.`,
        tags: [{ name: "category", value: "agentfront_delivery" }],
      }),
      signal: AbortSignal.timeout(12_000),
    });
    const payload = await response.json().catch(() => null) as { id?: unknown; message?: unknown } | null;
    if (!response.ok || typeof payload?.id !== "string") {
      throw new Error(`Resend delivery failed (${response.status}).`);
    }
    return { provider: this.name, messageId: payload.id, sentAt: new Date().toISOString() };
  }
}


interface GmailOAuthConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  senderEmail: string;
}

const singleLine = (value: string): string => value.replace(/[\r\n]+/g, " ").trim();
const base64Url = (value: string): string => Buffer.from(value, "utf8").toString("base64url");

/** Sends through a founder-authorized Gmail mailbox using only the gmail.send scope. */
export class GmailNotificationProvider implements NotificationProvider {
  readonly name = "Gmail API";
  readonly configured = true;
  constructor(private readonly config: GmailOAuthConfig, private readonly fetcher: typeof fetch = fetch) {
    if (!config.clientId.trim() || !config.clientSecret.trim() || !config.refreshToken.trim()) {
      throw new Error("Gmail OAuth credentials are incomplete.");
    }
    if (!emailPattern.test(config.senderEmail.trim()) || config.senderEmail.length > 254) {
      throw new Error("GMAIL_SENDER_EMAIL is invalid.");
    }
  }

  async sendDelivery(input: DeliveryNotification): Promise<NotificationReceipt> {
    const recipient = input.recipient.trim().toLowerCase();
    if (!emailPattern.test(recipient) || recipient.length > 254) throw new Error("Delivery recipient email is invalid.");
    const websiteUrl = httpsUrl(input.websiteUrl, "websiteUrl");
    const checkoutUrl = httpsUrl(input.checkoutUrl, "checkoutUrl");
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 1) throw new Error("Delivery amount is invalid.");
    const tokenResponse = await this.fetcher("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret,
        refresh_token: this.config.refreshToken, grant_type: "refresh_token" }),
      signal: AbortSignal.timeout(12_000),
    });
    const tokenPayload = await tokenResponse.json().catch(() => null) as { access_token?: unknown } | null;
    if (!tokenResponse.ok || typeof tokenPayload?.access_token !== "string") {
      throw new Error(`Gmail OAuth refresh failed (${tokenResponse.status}).`);
    }
    const amount = (input.amountMinor / 100).toFixed(2);
    const customer = input.customerName?.trim();
    const subject = `${singleLine(input.businessName)} website is ready`;
    const text = `${customer ? `Hello ${customer},` : "Hello,"}\n\nYour ${input.businessName} website is complete.\nWebsite: ${websiteUrl}\nPayment (INR ${amount}): ${checkoutUrl}\n\nPayment is confirmed only after Dodo verifies it.`;
    const messageId = `<${singleLine(input.idempotencyKey)}@agentfront.local>`;
    const mime = [
      `From: ${this.config.senderEmail.trim()}`,
      `To: ${recipient}`,
      `Subject: ${subject}`,
      `Message-ID: ${messageId}`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      text,
    ].join("\r\n");
    const response = await this.fetcher("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenPayload.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: base64Url(mime) }),
      signal: AbortSignal.timeout(12_000),
    });
    const payload = await response.json().catch(() => null) as { id?: unknown } | null;
    if (!response.ok || typeof payload?.id !== "string") throw new Error(`Gmail delivery failed (${response.status}).`);
    return { provider: this.name, messageId: payload.id, sentAt: new Date().toISOString() };
  }
}

export class UnconfiguredNotificationProvider implements NotificationProvider {
  readonly name = "Email notification (not configured)";
  readonly configured = false;
  async sendDelivery(): Promise<NotificationReceipt> {
    throw new Error("Configure the selected delivery email provider before delivery.");
  }
}

export function createNotificationProvider(environment: NodeJS.ProcessEnv, fetcher: typeof fetch = fetch): NotificationProvider {
  const provider = environment.NOTIFICATION_PROVIDER?.trim().toLowerCase();
  try {
    if (provider === "gmail") return new GmailNotificationProvider({
      clientId: environment.GMAIL_CLIENT_ID?.trim() ?? "",
      clientSecret: environment.GMAIL_CLIENT_SECRET?.trim() ?? "",
      refreshToken: environment.GMAIL_REFRESH_TOKEN?.trim() ?? "",
      senderEmail: environment.GMAIL_SENDER_EMAIL?.trim() ?? "",
    }, fetcher);
    if (provider === "resend") {
      return new ResendNotificationProvider(environment.RESEND_API_KEY?.trim() ?? "", environment.DELIVERY_EMAIL_FROM?.trim() ?? "", fetcher);
    }
  } catch {
    return new UnconfiguredNotificationProvider();
  }
  return new UnconfiguredNotificationProvider();
}
