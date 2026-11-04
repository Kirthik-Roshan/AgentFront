import type { Business, Deal, ProjectSpecification, Requirements } from "@agentfront/types";

export interface ValidationIssue {
  path: string;
  message: string;
}

export type SpecificationValidation =
  | { success: true; value: ProjectSpecification }
  | { success: false; issues: ValidationIssue[] };

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

export function createProjectSpecification(
  projectId: string,
  business: Business,
  requirements: Requirements,
  deal: Deal,
): ProjectSpecification {
  if (deal.status !== "WON") throw new Error("A project specification can only be created for a won deal.");
  if (!business.phone) throw new Error("A verified business phone number is required in the approved specification.");
  if (!requirements.approvedAt) throw new Error("Requirements must be approved before specification generation.");

  return {
    schemaVersion: 1,
    projectId,
    business: {
      name: business.name,
      type: business.category,
      location: `${business.address}, ${business.city}`,
      phone: business.phone,
    },
    commercial: {
      quotedPrice: deal.quotedAmount,
      finalPrice: deal.finalAmount,
      currency: deal.currency,
    },
    pages: [...requirements.pages],
    features: { ...requirements.features },
    clientBrief: [...requirements.contentRequirements, ...requirements.notes]
      .map((item) => item.trim()).filter(Boolean).slice(0, 50),
    design: {
      style: requirements.branding.style,
      ...(requirements.branding.primaryColour
        ? { primaryColour: requirements.branding.primaryColour }
        : {}),
      mobileFirst: true,
    },
  };
}

export function validateProjectSpecification(input: unknown): SpecificationValidation {
  const issues: ValidationIssue[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { success: false, issues: [{ path: "$", message: "Specification must be an object." }] };
  }

  const candidate = input as Partial<ProjectSpecification>;
  if (candidate.schemaVersion !== 1) issues.push({ path: "schemaVersion", message: "Must be 1." });
  if (!/^AF-\d{4}-\d{6}$/.test(candidate.projectId ?? "")) {
    issues.push({ path: "projectId", message: "Must match AF-YYYY-NNNNNN." });
  }
  if (!candidate.business || typeof candidate.business !== "object") {
    issues.push({ path: "business", message: "Business is required." });
  } else {
    if (!isNonEmptyString(candidate.business.name)) issues.push({ path: "business.name", message: "Required." });
    if (!isNonEmptyString(candidate.business.location)) {
      issues.push({ path: "business.location", message: "Required." });
    }
    if (!/^\+?[0-9][0-9 -]{7,}$/.test(candidate.business.phone ?? "")) {
      issues.push({ path: "business.phone", message: "Must be a valid verified phone number." });
    }
    if (!["restaurant", "salon", "garments", "mechanic", "clinic", "education", "realestate", "fitness", "bakery", "legal"].includes(candidate.business.type ?? "")) {
      issues.push({ path: "business.type", message: "Unsupported business type." });
    }
  }
  if (!candidate.commercial || typeof candidate.commercial !== "object") {
    issues.push({ path: "commercial", message: "Commercial terms are required." });
  } else {
    if (!isPositiveInteger(candidate.commercial.quotedPrice)) {
      issues.push({ path: "commercial.quotedPrice", message: "Must be a positive integer." });
    }
    if (!isPositiveInteger(candidate.commercial.finalPrice)) {
      issues.push({ path: "commercial.finalPrice", message: "Must be a positive integer." });
    }
    if (
      isPositiveInteger(candidate.commercial.quotedPrice) &&
      isPositiveInteger(candidate.commercial.finalPrice) &&
      candidate.commercial.finalPrice > candidate.commercial.quotedPrice
    ) {
      issues.push({ path: "commercial.finalPrice", message: "Cannot exceed quoted price." });
    }
    if (!candidate.commercial.currency) issues.push({ path: "commercial.currency", message: "Required." });
  }
  if (!Array.isArray(candidate.pages) || candidate.pages.length === 0 || !candidate.pages.every(isNonEmptyString)) {
    issues.push({ path: "pages", message: "At least one valid page is required." });
  }
  if (!candidate.features || typeof candidate.features !== "object" || Array.isArray(candidate.features)) {
    issues.push({ path: "features", message: "Features must be an object." });
  } else if (Object.values(candidate.features).some((value) => typeof value !== "boolean")) {
    issues.push({ path: "features", message: "Feature values must be boolean." });
  }
  if (candidate.clientBrief !== undefined && (
    !Array.isArray(candidate.clientBrief) || candidate.clientBrief.length > 50 ||
    !candidate.clientBrief.every((item) => isNonEmptyString(item) && item.length <= 2_000)
  )) {
    issues.push({ path: "clientBrief", message: "Must contain at most 50 non-empty strings of at most 2,000 characters." });
  }
  if (!candidate.design || !isNonEmptyString(candidate.design.style)) {
    issues.push({ path: "design.style", message: "A design style is required." });
  } else if (candidate.design.mobileFirst !== true) {
    issues.push({ path: "design.mobileFirst", message: "AgentFront specifications must be mobile-first." });
  }

  return issues.length === 0
    ? { success: true, value: candidate as ProjectSpecification }
    : { success: false, issues };
}

export function assertValidProjectSpecification(input: unknown): ProjectSpecification {
  const result = validateProjectSpecification(input);
  if (!result.success) {
    throw new Error(`Invalid project specification: ${result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
  }
  return result.value;
}
