import { describe, expect, it } from "vitest";
import {
  parseSarvamOutboundCompletion,
  resolveSarvamCustomerEmail,
  resolveSarvamPublicBusinessPhone,
} from "./sarvam-routes";

const documentedPayload = {
  attempt_id: "attempt-001",
  status: "connected",
  channel_info: {
    channel_type: "v2v",
    channel_provider: "vobiz",
    agent_phone_number: "+914400000000",
  },
  duration: 74.5,
  interaction_id: "interaction-001",
  failure_reason: null,
  final_agent_variables: {
    deal_status: "WON",
    owner_name: "Kirthik",
    public_business_phone: "+91 44 4000 2222",
    agreed_price: "7200",
    requirements_summary: "Restaurant site with menu, WhatsApp and map.",
  },
  webhook_config: {
    url: "https://api.example.com/api/webhooks/sarvam/outbound?token=secret",
    metadata: { business_id: "business-spiceroute", salesCallId: "sales-call-001" },
  },
  interaction_transcript: [
    { role: "agent", en_text: "Hello, I am AgentFront's AI sales assistant." },
    { role: "user", en_text: "Yes, I agree to the package." },
  ],
};

describe("Sarvam outbound webhook schema", () => {
  it("normalizes the documented Instant Outbound payload and correlation metadata", () => {
    expect(parseSarvamOutboundCompletion(documentedPayload)).toMatchObject({
      attemptId: "attempt-001",
      status: "connected",
      duration: 74.5,
      interactionId: "interaction-001",
      businessId: "business-spiceroute",
      salesCallId: "sales-call-001",
      variables: { deal_status: "WON", agreed_price: "7200" },
      transcript: [{ role: "agent" }, { role: "user" }],
    });
  });

  it("accepts the compatibility output-variable shape and gives it precedence", () => {
    expect(parseSarvamOutboundCompletion({
      ...documentedPayload,
      final_agent_variables: {
        ...documentedPayload.final_agent_variables,
        deal_status: "OPEN",
      },
      output_agent_variables: {
        deal_status: "WON",
        agreed_price: "7200",
      },
    }).variables).toMatchObject({
      deal_status: "WON",
      owner_name: "Kirthik",
      agreed_price: "7200",
    });
  });

  it("accepts the documented null fields for a call that did not connect", () => {
    expect(parseSarvamOutboundCompletion({
      ...documentedPayload,
      attempt_id: "attempt-no-answer",
      status: "no_answer",
      duration: null,
      interaction_id: null,
      final_agent_variables: null,
      interaction_transcript: null,
    })).toMatchObject({
      attemptId: "attempt-no-answer",
      status: "no_answer",
      duration: null,
      interactionId: null,
      variables: {},
      transcript: [],
    });
  });

  it("rejects unknown statuses, missing correlation, and malformed transcript roles", () => {
    expect(() => parseSarvamOutboundCompletion({ ...documentedPayload, status: "invented" })).toThrow(/unsupported/i);
    expect(() => parseSarvamOutboundCompletion({
      ...documentedPayload,
      webhook_config: { ...documentedPayload.webhook_config, metadata: {} },
    })).toThrow(/business_id/i);
    expect(() => parseSarvamOutboundCompletion({
      ...documentedPayload,
      interaction_transcript: [{ role: "system", en_text: "hidden" }],
    })).toThrow(/role/i);
  });

  it("uses explicit customer transcript details only when post-call output is absent", () => {
    const transcript = [
      { role: "agent" as const, en_text: "Please confirm the delivery details." },
      { role: "user" as const, en_text: "Use owner@example.com and publish 73391 40080." },
    ];
    expect(resolveSarvamCustomerEmail({}, transcript)).toBe("owner@example.com");
    expect(resolveSarvamPublicBusinessPhone({}, { DEMO_PUBLIC_BUSINESS_PHONE: "+917339140080" }, transcript))
      .toBe("+917339140080");
    expect(resolveSarvamCustomerEmail({}, [
      ...transcript,
      { role: "user", en_text: "Actually use other@example.com." },
    ])).toBeNull();
  });

  it("requires a separately allowlisted public phone instead of falling back to the dial target", () => {
    const variables = { public_business_phone: "+91 44 4000 2222" };
    expect(resolveSarvamPublicBusinessPhone(variables, {
      DEMO_PUBLIC_BUSINESS_PHONE: "+914440002222",
    })).toBe("+914440002222");
    expect(resolveSarvamPublicBusinessPhone({}, {
      DEMO_PUBLIC_BUSINESS_PHONE: "+914440002222",
    })).toBeNull();
    expect(resolveSarvamPublicBusinessPhone(variables, {
      DEMO_PUBLIC_BUSINESS_PHONE: "+914440003333",
    })).toBeNull();
    const consentedDialTarget = "+919876543210";
    expect(resolveSarvamPublicBusinessPhone({ public_business_phone: consentedDialTarget }, {
      DEMO_PUBLIC_BUSINESS_PHONE: consentedDialTarget,
    })).toBe(consentedDialTarget);
    expect(resolveSarvamPublicBusinessPhone({}, {
      DEMO_PUBLIC_BUSINESS_PHONE: consentedDialTarget,
    })).toBeNull();
  });
});
