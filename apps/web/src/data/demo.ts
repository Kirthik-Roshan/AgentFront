import type { ActivityEvent, Business, PipelineStage, TranscriptLine } from '../types';

export const spiceRoute: Business = {
  id: 'business-spiceroute',
  projectId: 'AF-2026-000001',
  source: 'DEMO',
  name: 'SpiceRoute Kitchen',
  category: 'Restaurant',
  area: 'Sholinganallur',
  city: 'Chennai',
  address: 'Sholinganallur, Chennai',
  latitude: 12.8996,
  longitude: 80.2279,
  rating: 4.4,
  reviews: 427,
  phone: true,
  phoneNumber: '+917339140080',
  instagram: false,
  website: false,
  websiteQuality: 'none',
  opportunityScore: 91,
  mapX: 38,
  mapY: 37,
  qualified: true,
  contact: 'Restaurant Owner',
  lastActivity: 'Demo seed',
};

/** The browser fallback contains exactly one clearly labelled fake record. */
export const businesses: Business[] = [spiceRoute];

export const pipelineBlueprint: Omit<PipelineStage, 'status'>[] = [
  { key: 'discovery', label: 'Discovery', agent: 'Discovery Agent', detail: 'Google Business profile indexed' },
  { key: 'qualification', label: 'Qualification', agent: 'Qualification Agent', detail: 'Qualified · 91/100 opportunity' },
  { key: 'crm', label: 'Freshworks CRM', agent: 'CRM Agent', detail: 'Account, contact & deal created' },
  { key: 'conversation', label: 'Sales conversation', agent: 'Sales Agent', detail: 'Owner connected · 4m 31s' },
  { key: 'requirements', label: 'Requirements', agent: 'Specification Agent', detail: '4 pages · 4 features approved' },
  { key: 'negotiation', label: 'Negotiation', agent: 'Negotiation Agent', detail: 'Offer accepted · ₹100' },
  { key: 'spec', label: 'Project spec', agent: 'Orchestrator', detail: 'Schema validated · v1.0' },
  { key: 'development', label: 'Development', agent: 'Developer Agent', detail: 'Customizing Restaurant v1' },
  { key: 'qa', label: 'Quality assurance', agent: 'Deterministic QA', detail: 'Deterministic release gates queued' },
  { key: 'deployment', label: 'Deployment', agent: 'Deployment Adapter', detail: 'Cloudflare Pages queued' },
];

export const activitySeed: ActivityEvent[] = [
  { id: 'e1', createdAt: '2026-08-23T13:49:12.000Z', agent: 'Deployment', eventType: 'deployment.succeeded', message: 'Kaveri Silks deployed successfully.', status: 'SUCCESS', durationMs: null, metadata: { source: 'seeded-demo' }, leadId: null, projectId: 'AF-2026-000029', campaignId: 'campaign-stage-1-demo' },
  { id: 'e2', createdAt: '2026-08-23T13:48:57.000Z', agent: 'QA Engine', eventType: 'qa.passed', message: 'Production build passed with score 96/100.', status: 'SUCCESS', durationMs: null, metadata: { source: 'seeded-demo' }, leadId: null, projectId: 'AF-2026-000029', campaignId: 'campaign-stage-1-demo' },
  { id: 'e3', createdAt: '2026-08-23T13:47:42.000Z', agent: 'Developer Agent', eventType: 'build.customized', message: 'Applied warm premium branding tokens.', status: 'INFO', durationMs: null, metadata: { source: 'seeded-demo' }, leadId: 'lead-AF-2026-000001', projectId: 'AF-2026-000001', campaignId: 'campaign-stage-1-demo' },
  { id: 'e4', createdAt: '2026-08-23T13:46:34.000Z', agent: 'Specification Agent', eventType: 'spec.validated', message: 'project_spec.json generated and validated.', status: 'INFO', durationMs: null, metadata: { source: 'seeded-demo' }, leadId: 'lead-AF-2026-000001', projectId: 'AF-2026-000001', campaignId: 'campaign-stage-1-demo' },
  { id: 'e5', createdAt: '2026-08-23T13:46:32.000Z', agent: 'Orchestrator', eventType: 'pipeline.transitioned', message: 'Deal transitioned from NEGOTIATING to WON.', status: 'SUCCESS', durationMs: null, metadata: { source: 'seeded-demo' }, leadId: 'lead-AF-2026-000001', projectId: 'AF-2026-000001', campaignId: 'campaign-stage-1-demo' },
  { id: 'e6', createdAt: '2026-08-23T13:46:30.000Z', agent: 'Negotiation Agent', eventType: 'deal.accepted', message: 'Final offer ₹100 accepted within policy.', status: 'SUCCESS', durationMs: null, metadata: { source: 'seeded-demo' }, leadId: 'lead-AF-2026-000001', projectId: 'AF-2026-000001', campaignId: 'campaign-stage-1-demo' },
  { id: 'e7', createdAt: '2026-08-23T13:45:41.000Z', agent: 'Sales Agent', eventType: 'requirement.detected', message: 'Requirement detected: WhatsApp ordering.', status: 'INFO', durationMs: null, metadata: { source: 'seeded-demo' }, leadId: 'lead-AF-2026-000001', projectId: 'AF-2026-000001', campaignId: 'campaign-stage-1-demo' },
  { id: 'e8', createdAt: '2026-08-23T13:43:02.000Z', agent: 'Sales Agent', eventType: 'conversation.started', message: 'Conversation started with business owner.', status: 'INFO', durationMs: null, metadata: { source: 'seeded-demo' }, leadId: 'lead-AF-2026-000001', projectId: 'AF-2026-000001', campaignId: 'campaign-stage-1-demo' },
  { id: 'e9', createdAt: '2026-08-23T13:42:15.000Z', agent: 'CRM Agent', eventType: 'crm.deal.created', message: 'Freshworks deal created and synchronized.', status: 'INFO', durationMs: null, metadata: { source: 'seeded-demo' }, leadId: 'lead-AF-2026-000001', projectId: 'AF-2026-000001', campaignId: 'campaign-stage-1-demo' },
  { id: 'e10', createdAt: '2026-08-23T13:42:14.000Z', agent: 'Qualification Agent', eventType: 'lead.qualified', message: 'SpiceRoute Kitchen scored 91/100.', status: 'SUCCESS', durationMs: null, metadata: { source: 'seeded-demo' }, leadId: 'lead-AF-2026-000001', projectId: 'AF-2026-000001', campaignId: 'campaign-stage-1-demo' },
  { id: 'e11', createdAt: '2026-08-23T13:42:09.000Z', agent: 'Discovery Agent', eventType: 'discovery.completed', message: 'Found 18 restaurants in Sholinganallur.', status: 'INFO', durationMs: null, metadata: { source: 'seeded-demo' }, leadId: null, projectId: null, campaignId: 'campaign-stage-1-demo' },
];

export const transcriptSeed: TranscriptLine[] = [
  { id: 1, speaker: 'agent', time: '04:02', text: 'Thanks for walking me through the restaurant. Your food already has a strong local reputation — the gap is making it easier for mobile customers to see the menu and order.' },
  { id: 2, speaker: 'owner', time: '04:10', text: 'Exactly. Most customers ask us to send the menu on WhatsApp, and the photos are scattered across Instagram.' },
  { id: 3, speaker: 'agent', time: '04:18', text: 'I can include a mobile-first menu, gallery, location and direct WhatsApp ordering. Would you want table reservations too?' },
  { id: 4, speaker: 'owner', time: '04:27', text: 'No reservations for now. Keep it simple. My budget is around seven thousand.' },
  { id: 5, speaker: 'agent', time: '04:34', text: 'The standard package is ₹7,999. Based on your scope, I’m authorized to offer ₹100 as the final price.' },
  { id: 6, speaker: 'owner', time: '04:46', text: '₹100 works if WhatsApp ordering and the Google Maps location are included.' },
  { id: 7, speaker: 'agent', time: '04:51', text: 'Confirmed. Both are included. I’ll summarize the approved scope and start production.' },
];

export const agentRows = [
  { name: 'Discovery Agent', role: 'Market intelligence', status: 'working', metric: '1,286 analysed', success: '186 qualified', load: 72 },
  { name: 'Qualification Agent', role: 'Opportunity scoring', status: 'working', metric: '98 processed today', success: '14 promoted', load: 54 },
  { name: 'Sales Agent', role: 'Realtime conversation', status: 'live', metric: '42 conversations', success: '30.9% close rate', load: 83 },
  { name: 'Developer Agent', role: 'Template customization', status: 'working', metric: '13 builds', success: '12 successful', load: 66 },
  { name: 'QA Engine', role: 'Deterministic validation', status: 'idle', metric: '156 checks', success: '96 avg score', load: 18 },
  { name: 'Deployment Adapter', role: 'Release operations', status: 'working', metric: '11 releases', success: '100% healthy', load: 38 },
];

export const revenueSeries = [42, 54, 48, 68, 74, 61, 89, 82, 101, 96, 118, 124];
export const funnel = [
  { label: 'Discovered', value: 1286 },
  { label: 'Qualified', value: 186 },
  { label: 'Contacted', value: 72 },
  { label: 'Interested', value: 38 },
  { label: 'Negotiated', value: 18 },
  { label: 'Won', value: 13 },
  { label: 'Deployed', value: 11 },
];
