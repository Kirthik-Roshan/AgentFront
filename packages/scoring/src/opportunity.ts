import type { Business, OpportunityScore, QualificationPolicy, ScoreFactor } from "@agentfront/types";

const websiteFactor = (business: Business): ScoreFactor => {
  if (!business.website || business.digitalPresenceStatus === "NONE") {
    return {
      key: "website",
      label: "No dedicated website",
      points: 40,
      maximum: 40,
      reason: "No dedicated website was found.",
    };
  }

  if (business.digitalPresenceStatus === "WEAK") {
    return {
      key: "website",
      label: "Weak website",
      points: 25,
      maximum: 40,
      reason: "The existing website has a weak digital presence.",
    };
  }

  if (business.digitalPresenceStatus === "ADEQUATE") {
    return {
      key: "website",
      label: "Basic website",
      points: 8,
      maximum: 40,
      reason: "The existing website leaves limited room for improvement.",
    };
  }

  return {
    key: "website",
    label: "Strong website",
    points: 0,
    maximum: 40,
    reason: "A strong website already exists.",
  };
};

const phoneFactor = (business: Business): ScoreFactor => ({
  key: "phone",
  label: business.phone ? "Contact number available" : "No contact number",
  points: business.phone ? 20 : 0,
  maximum: 20,
  reason: business.phone ? "A direct outreach channel is available." : "No direct outreach channel was found.",
});

const ratingFactor = (business: Business): ScoreFactor => {
  const points = business.rating >= 4 ? 15 : business.rating >= 3.5 ? 8 : business.rating >= 3 ? 3 : 0;
  return {
    key: "rating",
    label: points === 15 ? "Rating above 4.0" : "Customer rating",
    points,
    maximum: 15,
    reason: `${business.rating.toFixed(1)} star public rating.`,
  };
};

const reviewFactor = (business: Business): ScoreFactor => {
  const points =
    business.reviewCount >= 1_000
      ? 25
      : business.reviewCount >= 500
        ? 20
        : business.reviewCount >= 250
          ? 16
          : business.reviewCount >= 100
            ? 12
            : business.reviewCount >= 20
              ? 6
              : 0;

  return {
    key: "reviews",
    label: points >= 16 ? "Strong review activity" : "Review activity",
    points,
    maximum: 25,
    reason: `${business.reviewCount.toLocaleString("en-IN")} public reviews indicate local demand.`,
  };
};

export function calculateOpportunityScore(
  business: Business,
  minimumOpportunityScore = 75,
): OpportunityScore {
  const factors = [websiteFactor(business), phoneFactor(business), ratingFactor(business), reviewFactor(business)];
  const total = Math.min(100, factors.reduce((sum, factor) => sum + factor.points, 0));
  const qualified = total >= minimumOpportunityScore;

  return {
    total,
    maximum: 100,
    qualified,
    factors,
    reason: qualified
      ? `Qualified at ${total}/100: strong demand and a clear digital-presence gap.`
      : `Not qualified: ${total}/100 is below the ${minimumOpportunityScore}-point threshold.`,
  };
}

export function satisfiesQualificationPolicy(business: Business, policy: QualificationPolicy): boolean {
  if (business.rating < policy.minimumRating || business.reviewCount < policy.minimumReviewCount) {
    return false;
  }
  if (policy.requirePhone && !business.phone) {
    return false;
  }
  if (
    policy.requireMissingOrPoorWebsite &&
    business.digitalPresenceStatus !== "NONE" &&
    business.digitalPresenceStatus !== "WEAK"
  ) {
    return false;
  }
  return true;
}
