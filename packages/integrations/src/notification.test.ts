import { describe, expect, it, vi } from "vitest";
import { createNotificationProvider, GmailNotificationProvider, ResendNotificationProvider } from "./notification";

const input = {
  recipient: "Owner@Example.com",
  customerName: "Kirthik",
  businessName: "SpiceRoute Kitchen",
  websiteUrl: "https://spiceroute.example.com/",
  checkoutUrl: "https://test.checkout.dodopayments.com/session",
  amountMinor: 10_000,
  currency: "INR" as const,
  idempotencyKey: "agentfront-delivery-spec-1",
};

describe("delivery notification provider", () => {
  it("fails closed when the selected provider is not fully configured", () => {
    expect(createNotificationProvider({ NOTIFICATION_PROVIDER: "gmail" })).toMatchObject({ configured: false });
    expect(createNotificationProvider({ NOTIFICATION_PROVIDER: "resend" })).toMatchObject({ configured: false });
    expect(createNotificationProvider({})).toMatchObject({ configured: false });
  });

  it("refreshes an offline token and sends through Gmail with the narrow provider", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "access-123" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "gmail-message-1" }), { status: 200 })) as unknown as typeof fetch;
    const provider = new GmailNotificationProvider({ clientId: "client-id", clientSecret: "client-secret",
      refreshToken: "refresh-token", senderEmail: "agentfront@gmail.com" }, fetcher);
    await expect(provider.sendDelivery(input)).resolves.toMatchObject({ provider: "Gmail API", messageId: "gmail-message-1" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [tokenUrl, tokenRequest] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(tokenUrl).toBe("https://oauth2.googleapis.com/token");
    expect(String((tokenRequest as RequestInit).body)).toContain("grant_type=refresh_token");
    const [sendUrl, sendRequest] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(sendUrl).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    expect((sendRequest as RequestInit).headers).toMatchObject({ Authorization: "Bearer access-123" });
    const raw = JSON.parse(String((sendRequest as RequestInit).body)).raw;
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    expect(decoded).toContain(input.websiteUrl);
    expect(decoded).toContain(input.checkoutUrl);
    expect(decoded).toContain("INR 100.00");
  });

  it("sends one idempotent delivery email containing the website and checkout", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: "email_123" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;
    const provider = new ResendNotificationProvider("re_123456789012", "AgentFront <delivery@example.com>", fetcher);
    await expect(provider.sendDelivery(input)).resolves.toMatchObject({ provider: "Resend Email", messageId: "email_123" });
    expect(fetcher).toHaveBeenCalledOnce();
    const [, request] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((request as RequestInit).headers).toMatchObject({ "Idempotency-Key": input.idempotencyKey });
    const body = JSON.parse(String((request as RequestInit).body));
    expect(body.to).toEqual(["owner@example.com"]);
    expect(body.text).toContain(input.websiteUrl);
    expect(body.text).toContain(input.checkoutUrl);
    expect(body.text).toContain("INR 100.00");
  });

  it("rejects insecure delivery URLs before contacting the provider", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const provider = new ResendNotificationProvider("re_123456789012", "delivery@example.com", fetcher);
    await expect(provider.sendDelivery({ ...input, websiteUrl: "http://example.com" })).rejects.toThrow(/HTTPS/);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
