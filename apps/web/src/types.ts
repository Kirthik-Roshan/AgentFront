export type ViewKey =
  | 'overview'
  | 'demo'
  | 'discover'
  | 'leads'
  | 'pipeline'
  | 'sales'
  | 'crm'
  | 'campaigns'
  | 'projects'
  | 'templates'
  | 'deployments'
  | 'agents'
  | 'analytics'
  | 'activity'
  | 'settings';

export type BusinessCategory = 'Restaurant' | 'Salon' | 'Garments' | 'Mechanic';

export type Business = {
  id: string;
  projectId?: string;
  source: 'GOOGLE_PLACES' | 'DEMO';
  name: string;
  category: BusinessCategory;
  area: string;
  city: string;
  latitude: number;
  longitude: number;
  rating: number;
  reviews: number;
  phone: boolean;
  phoneNumber?: string | null;
  address?: string;
  websiteUrl?: string | null;
  googleMapsUrl?: string | null;
  photoUrl?: string | null;
  photoAttribution?: { displayName: string; uri: string | null } | null;
  instagram: boolean;
  website: boolean;
  websiteQuality: 'none' | 'poor' | 'good';
  opportunityScore: number;
  mapX: number;
  mapY: number;
  qualified: boolean;
  contact: string;
  lastActivity: string;
};

export type PipelineStageStatus = 'complete' | 'active' | 'queued' | 'error';

export type PipelineStage = {
  key: string;
  label: string;
  agent: string;
  status: PipelineStageStatus;
  detail: string;
  timestamp?: string;
};

export type ActivityEvent = {
  id: string;
  agent: string;
  eventType: string;
  message: string;
  status: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  createdAt: string;
  durationMs: number | null;
  metadata: Record<string, unknown>;
  leadId: string | null;
  projectId: string | null;
  campaignId: string | null;
  businessId?: string | null;
  workflowId?: string | null;
  correlationId?: string | null;
  sourceAgent?: string | null;
  retryCount?: number;
};

export type TranscriptLine = {
  id: number;
  speaker: 'agent' | 'owner';
  text: string;
  time: string;
};

export type AppState = {
  campaignStatus: 'running' | 'paused' | 'stopped';
  pipelineStep: number;
  selectedBusinessId: string;
  theme: 'light' | 'dark';
  autoAdvance: boolean;
};
