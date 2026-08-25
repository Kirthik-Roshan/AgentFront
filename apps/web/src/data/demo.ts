import type { ActivityEvent, Business, PipelineStage, TranscriptLine } from '../types';

type BusinessSeed = [string, string, number, number, boolean, boolean, boolean, number];

const seeds: Record<Business['category'], BusinessSeed[]> = {
  Restaurant: [
    ['SpiceRoute Kitchen', 'Sholinganallur', 4.4, 427, true, true, false, 91],
    ['Anjappar Claypot', 'Sholinganallur', 4.2, 318, true, false, false, 86],
    ['OMR Tiffin House', 'Sholinganallur', 4.1, 186, true, true, false, 84],
    ['Madras Pepper Grill', 'Perumbakkam', 4.5, 612, true, false, true, 72],
    ['Coastal Curry Leaf', 'Navalur', 4.0, 93, true, false, false, 82],
    ['Velachery Millet Cafe', 'Velachery', 4.3, 254, true, true, false, 89],
    ['Bay Bowl Express', 'Thoraipakkam', 3.9, 142, true, false, false, 79],
    ['Namma Virundhu', 'Karapakkam', 4.6, 1104, true, false, true, 68],
  ],
  Salon: [
    ['Aura Beauty Studio', 'Sholinganallur', 4.5, 306, true, true, false, 88],
    ['Blush & Bloom Salon', 'Sholinganallur', 4.3, 221, true, false, false, 85],
    ['Studio Bloom', 'Navalur', 4.1, 128, true, false, false, 83],
    ['Malar Family Salon', 'Perumbakkam', 4.0, 88, true, false, false, 70],
    ['The Grooming Room', 'Thoraipakkam', 4.6, 519, true, false, true, 67],
    ['Velvet Scissors', 'Velachery', 3.9, 76, true, false, false, 86],
    ['Radiance Bridal Lounge', 'Karapakkam', 4.4, 347, true, true, false, 80],
    ['Naturals Corner', 'Medavakkam', 4.2, 411, true, false, true, 87],
  ],
  Garments: [
    ['Chennai Cotton Collective', 'Sholinganallur', 4.3, 284, true, true, false, 87],
    ['Kaveri Silks', 'Sholinganallur', 4.1, 178, true, false, false, 79],
    ['OMR Fashion Street', 'Karapakkam', 4.0, 111, true, false, false, 82],
    ['Thread & Loom', 'Navalur', 4.5, 492, true, false, true, 84],
    ['Varnam Boutique', 'Velachery', 4.4, 237, true, true, false, 89],
    ['Everyday Menswear', 'Thoraipakkam', 3.8, 63, true, false, false, 71],
    ['Little Loom Kids', 'Perumbakkam', 4.2, 156, true, false, false, 77],
    ['Sundari Saree House', 'Medavakkam', 4.6, 718, true, false, true, 90],
  ],
  Mechanic: [
    ['OMR Motor Works', 'Sholinganallur', 4.4, 376, true, false, false, 90],
    ['Pitstop Auto Care', 'Sholinganallur', 4.2, 265, true, true, false, 86],
    ['Navalur Car Clinic', 'Navalur', 4.1, 149, true, false, false, 73],
    ['Torque Works', 'Thoraipakkam', 4.5, 538, true, false, false, 83],
    ['Sri Ganesh Two Wheeler Care', 'Perumbakkam', 4.0, 102, true, false, false, 85],
    ['Velachery Auto Doctor', 'Velachery', 4.3, 323, true, false, false, 89],
    ['Highway Diesel Garage', 'Karapakkam', 3.9, 74, true, false, false, 79],
    ['Medavakkam Wheel Works', 'Medavakkam', 4.6, 806, true, false, true, 74],
  ],
};

const positions = [
  [38, 37], [54, 26], [66, 43], [43, 58], [74, 62], [27, 68], [58, 76], [82, 33],
  [31, 29], [62, 20], [78, 50], [47, 71], [69, 70], [23, 49], [52, 84], [87, 61],
  [36, 20], [70, 31], [84, 44], [42, 79], [73, 81], [19, 61], [60, 63], [90, 73],
  [30, 41], [57, 17], [80, 38], [35, 70], [67, 55], [23, 80], [53, 71], [86, 58],
];

// Mirrors the clearly labelled seeded Chennai market so the optional real map
// can render demo records at deterministic coordinates before a provider search.
const coordinates = [
  [12.8996, 80.2279], [12.9014, 80.2292], [12.8978, 80.2258], [12.9051, 80.2138],
  [12.8447, 80.2264], [12.9815, 80.218], [12.9416, 80.2362], [12.9152, 80.2298],
  [12.9003, 80.2246], [12.903, 80.2281], [12.8455, 80.2281], [12.906, 80.2148],
  [12.9391, 80.2341], [12.9791, 80.2204], [12.9143, 80.2311], [12.9171, 80.1927],
  [12.9021, 80.2263], [12.8984, 80.2301], [12.9131, 80.2304], [12.8472, 80.2275],
  [12.9801, 80.2171], [12.9424, 80.2352], [12.9071, 80.2151], [12.916, 80.1938],
  [12.8962, 80.2239], [12.9041, 80.226], [12.8437, 80.2249], [12.9401, 80.2327],
  [12.9082, 80.2125], [12.9824, 80.2166], [12.912, 80.2287], [12.919, 80.1944],
] as const;

let index = 0;
export const businesses: Business[] = (Object.entries(seeds) as [Business['category'], BusinessSeed[]][])
  .flatMap(([category, rows]) => rows.map((row) => {
    const [name, area, rating, reviews, phone, instagram, website, opportunityScore] = row;
    const i = index++;
    return {
      id: i === 0 ? 'business-spiceroute' : `business-demo-${String(i + 1).padStart(2, '0')}`,
      projectId: i === 0 ? 'AF-2026-000001' : undefined,
      source: 'DEMO',
      name,
      category,
      area,
      city: 'Chennai',
      latitude: coordinates[i][0],
      longitude: coordinates[i][1],
      rating,
      reviews,
      phone,
      instagram,
      website,
      websiteQuality: website ? (i % 3 === 0 ? 'poor' : 'good') : 'none',
      opportunityScore,
      mapX: positions[i][0],
      mapY: positions[i][1],
      qualified: opportunityScore >= 75,
      contact: i === 0 ? 'Restaurant Owner' : 'Owner / Manager',
      lastActivity: i < 8 ? `${3 + i * 4}m ago` : `${1 + (i % 12)}h ago`,
    } satisfies Business;
  }));

export const spiceRoute = businesses[0];

export const pipelineBlueprint: Omit<PipelineStage, 'status'>[] = [
  { key: 'discovery', label: 'Discovery', agent: 'Discovery Agent', detail: 'Google Business profile indexed' },
  { key: 'qualification', label: 'Qualification', agent: 'Qualification Agent', detail: 'Qualified · 91/100 opportunity' },
  { key: 'crm', label: 'Freshworks CRM', agent: 'CRM Agent', detail: 'Account, contact & deal created' },
  { key: 'conversation', label: 'Sales conversation', agent: 'Sales Agent', detail: 'Owner connected · 4m 31s' },
  { key: 'requirements', label: 'Requirements', agent: 'Specification Agent', detail: '4 pages · 4 features approved' },
  { key: 'negotiation', label: 'Negotiation', agent: 'Negotiation Agent', detail: 'Offer accepted · ₹7,200' },
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
  { id: 'e6', createdAt: '2026-08-23T13:46:30.000Z', agent: 'Negotiation Agent', eventType: 'deal.accepted', message: 'Final offer ₹7,200 accepted within policy.', status: 'SUCCESS', durationMs: null, metadata: { source: 'seeded-demo' }, leadId: 'lead-AF-2026-000001', projectId: 'AF-2026-000001', campaignId: 'campaign-stage-1-demo' },
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
  { id: 5, speaker: 'agent', time: '04:34', text: 'The standard package is ₹7,999. Based on your scope, I’m authorized to offer ₹7,200 as the final price.' },
  { id: 6, speaker: 'owner', time: '04:46', text: '₹7,200 works if WhatsApp ordering and the Google Maps location are included.' },
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
