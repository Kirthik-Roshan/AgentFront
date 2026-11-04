import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupportTicketInput } from "@agentfront/types";
import { createSupportProvider } from "./factory";
import { FreshdeskSupportProvider, mapIncidentToFreshdesk } from "./support";

const incident: SupportTicketInput = {
  businessId: "business-1", workflowId: "workflow-business-1", correlationId: "AF-2026-000001",
  category: "BUILD_FAILED", subject: "Build failed — SpiceRoute",
  description: "<script>unsafe</script> & retry", priority: 3, retryCount: 2,
};

describe("Freshdesk operational support adapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("escapes incident details and keeps the business correlation in the ticket body", () => {
    const mapped = mapIncidentToFreshdesk(incident, "operations@example.com");
    expect(mapped).toMatchObject({ email: "operations@example.com", priority: 3, status: 2 });
    expect(mapped.description).toContain("Business ID: business-1");
    expect(mapped.description).toContain("&lt;script&gt;unsafe&lt;/script&gt; &amp; retry");
    expect(mapped.description).not.toContain("<script>");
  });

  it("never claims to create a ticket when configuration is absent or demo mode forces a fallback", async () => {
    const missing = createSupportProvider({});
    expect(await missing.createTicket(incident, "incident-1")).toMatchObject({ status: "NOT_CONFIGURED", id: null });
    expect((await missing.health()).status).toBe("NOT_CONFIGURED");
    const forced = createSupportProvider({ DEMO_MODE: "true", FRESHDESK_DOMAIN: "demo.freshdesk.com",
      FRESHDESK_API_KEY: "test-key", FRESHDESK_REQUESTER_EMAIL: "operations@example.com" });
    expect(forced.mode).toBe("DEMO");
  });

  it("uses the documented ticket API and replays a duplicate key within one process", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 42 }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new FreshdeskSupportProvider({ domain: "demo.freshdesk.com", apiKey: "test-key",
      requesterEmail: "operations@example.com" });
    const created = await provider.createTicket(incident, "incident-1");
    expect(created).toEqual({ status: "CREATED", id: "42", url: "https://demo.freshdesk.com/a/tickets/42" });
    expect(await provider.createTicket(incident, "incident-1")).toEqual(created);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://demo.freshdesk.com/api/v2/tickets");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({ subject: incident.subject, status: 2, priority: 3 });
  });

  it("refuses a domain with a path or credentials", () => {
    expect(() => new FreshdeskSupportProvider({ domain: "demo.freshdesk.com/crm/sales", apiKey: "test-key",
      requesterEmail: "operations@example.com" })).toThrow(/hostname/);
    expect(() => new FreshdeskSupportProvider({ domain: "https://user:pass@demo.freshdesk.com", apiKey: "test-key",
      requesterEmail: "operations@example.com" })).toThrow(/hostname/);
  });
});
