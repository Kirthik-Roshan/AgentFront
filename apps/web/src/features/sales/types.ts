export type SalesContact = {
  id: string;
  businessId: string;
  name: string | null;
  phone: string;
  roles: string[];
  isDecisionMaker: boolean;
  preferredLanguage: string | null;
  source: string;
  verified: boolean;
  updatedAt: string;
};

export type SalesBusiness = {
  id: string;
  businessCode: string | null;
  name: string;
  category: string;
  city: string;
  address: string;
  phone: string | null;
  website: string | null;
  freshworksAccountId?: string | null;
  freshworksDealId?: string | null;
  salesState: string;
  updatedAt: string;
};

export type SalesCall = {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  provider: string;
  providerCallId: string | null;
  providerMode: 'REAL' | 'DEMO';
  status: string;
  outcome: string | null;
  contactId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
  summary: string | null;
  transcript: string | null;
  recordingUrl: string | null;
  metadata: Record<string, unknown>;
};

export type SalesMemory = {
  summary: string;
  objections: string[];
  requirements: Record<string, unknown>;
  quotedPrice: number | null;
  agreedPrice: number | null;
  currency: string;
  dealStage: string;
  nextAction: string | null;
  nextActionAt: string | null;
};

export type SalesFollowUp = {
  id: string;
  type: string;
  status: string;
  scheduledAt: string;
  reason: string;
  attempts: number;
  contactId: string | null;
};

export type SalesEvent = {
  id: string;
  eventType: string;
  timestamp: string;
  metadata: Record<string, unknown>;
};

export type SalesProjectSpec = {
  id: string;
  status: string;
  version: number;
  specification: {
    requirements: { pages: string[]; features: Record<string, boolean>; notes: string[] };
    commercial: { agreedPrice: number | null; quotedPrice: number | null; currency: string };
  };
  createdAt: string;
};

export type SalesBusinessDetail = {
  business: SalesBusiness;
  contacts: SalesContact[];
  calls: SalesCall[];
  memory: SalesMemory | null;
  followUps: SalesFollowUp[];
  events: SalesEvent[];
  transitions: Array<{ id: string; from: string; to: string; reason: string; createdAt: string }>;
  projectSpec: SalesProjectSpec | null;
};

export type SalesOverviewMetrics = {
  totalBusinesses: number;
  qualifiedBusinesses: number;
  callsQueued: number;
  callsAttempted: number;
  callsActive: number;
  receptionistContacts: number;
  decisionMakersIdentified: number;
  callbacksScheduled: number;
  negotiationsActive: number;
  dealsWon: number;
  dealsLost: number;
  conversionRate: number;
};

export type SalesOverviewRow = {
  business: SalesBusiness;
  contacts: SalesContact[];
  activeCall: SalesCall | null;
  lastCall: SalesCall | null;
  nextFollowUp: SalesFollowUp | null;
  memory: SalesMemory | null;
  projectSpec: SalesProjectSpec | null;
};

export type SalesOverviewSnapshot = {
  metrics: SalesOverviewMetrics;
  businesses: SalesOverviewRow[];
};

export type InboundResolution = {
  mode: 'DEMO';
  label: 'SIMULATED TELEPHONY';
  resolution: { status: string; [key: string]: unknown };
};
