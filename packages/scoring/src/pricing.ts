import type { PricingPolicy, ProjectFeature } from "@agentfront/types";

export interface QuoteInput {
  features: Partial<Record<ProjectFeature, boolean>>;
}

export interface QuoteResult {
  amount: number;
  currency: PricingPolicy["currency"];
  lineItems: Array<{ item: string; amount: number }>;
}

export interface NegotiationResult {
  acceptedOffer: number;
  floor: number;
  discount: number;
  discountPercent: number;
  atFloor: boolean;
}

const assertMoney = (value: number, field: string): void => {
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new Error(`${field} must be a non-negative integer in the currency's smallest billing unit.`);
  }
};

export function validatePricingPolicy(policy: PricingPolicy): void {
  assertMoney(policy.basePrice, "basePrice");
  assertMoney(policy.minimumPrice, "minimumPrice");
  assertMoney(policy.maximumPrice, "maximumPrice");
  if (policy.minimumPrice > policy.basePrice || policy.basePrice > policy.maximumPrice) {
    throw new Error("Pricing must satisfy minimumPrice <= basePrice <= maximumPrice.");
  }
  if (policy.maximumDiscountPercent < 0 || policy.maximumDiscountPercent > 100) {
    throw new Error("maximumDiscountPercent must be between 0 and 100.");
  }
  for (const [feature, amount] of Object.entries(policy.featurePrices)) {
    if (amount !== undefined) assertMoney(amount, `featurePrices.${feature}`);
  }
}

export function calculateQuote(input: QuoteInput, policy: PricingPolicy): QuoteResult {
  validatePricingPolicy(policy);
  const lineItems: QuoteResult["lineItems"] = [{ item: "Base website package", amount: policy.basePrice }];

  for (const [feature, enabled] of Object.entries(input.features) as Array<[ProjectFeature, boolean | undefined]>) {
    const price = policy.featurePrices[feature] ?? 0;
    if (enabled && price > 0) lineItems.push({ item: feature, amount: price });
  }

  const rawAmount = lineItems.reduce((sum, item) => sum + item.amount, 0);
  const amount = Math.min(policy.maximumPrice, Math.max(policy.minimumPrice, rawAmount));
  return { amount, currency: policy.currency, lineItems };
}

export function calculateNegotiationFloor(quotedAmount: number, policy: PricingPolicy): number {
  validatePricingPolicy(policy);
  assertMoney(quotedAmount, "quotedAmount");
  const discounted = quotedAmount * (1 - policy.maximumDiscountPercent / 100);
  const roundedUpToHundred = Math.ceil(discounted / 100) * 100;
  return Math.min(quotedAmount, Math.max(policy.minimumPrice, roundedUpToHundred));
}

export function getNegotiationOffer(
  quotedAmount: number,
  requestedAmount: number,
  policy: PricingPolicy,
): NegotiationResult {
  assertMoney(requestedAmount, "requestedAmount");
  const floor = calculateNegotiationFloor(quotedAmount, policy);
  const acceptedOffer = Math.min(quotedAmount, Math.max(requestedAmount, floor));
  const discount = quotedAmount - acceptedOffer;

  return {
    acceptedOffer,
    floor,
    discount,
    discountPercent: quotedAmount === 0 ? 0 : Math.round((discount / quotedAmount) * 10_000) / 100,
    atFloor: acceptedOffer === floor,
  };
}
