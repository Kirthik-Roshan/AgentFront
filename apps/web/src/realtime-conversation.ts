export type RealtimeTranscriptLine = {
  id: string;
  speaker: 'agent' | 'owner';
  text: string;
  time: string;
  at: string;
};

export type ConfirmedBrief = {
  businessType: 'restaurant' | 'salon' | 'garments' | 'mechanic' | 'clinic' | 'education' | 'realestate' | 'fitness' | 'bakery' | 'legal' | 'spa' | 'dental' | 'physiotherapy' | 'petcare' | 'catering' | 'events' | 'photography' | 'interiors' | 'travel' | 'movers' | 'appliance' | 'trades' | 'detailing' | 'drivingschool' | 'laundry' | 'furniture' | 'devicerepair' | 'printing' | 'florist' | 'jewellery' | 'tailoring' | 'cloudkitchen';
  businessName: string;
  pages: string;
  style: string;
  colour: string;
  content: string;
  price: string;
  features: string[];
};

const allowedFeatures = new Set([
  'menu', 'gallery', 'whatsappOrdering', 'googleMaps', 'reservations',
  'booking', 'testimonials', 'catalog', 'emergencyContact',
]);

export function appendRealtimeTranscript(
  current: RealtimeTranscriptLine[],
  event: { message: string; role: 'agent' | 'user'; eventId?: number },
  now = new Date(),
): RealtimeTranscriptLine[] {
  const text = event.message.trim();
  if (!text) return current;
  const speaker: RealtimeTranscriptLine['speaker'] = event.role === 'agent' ? 'agent' : 'owner';
  const previous = current.at(-1);
  if (event.eventId !== undefined && previous?.id === `elevenlabs-${speaker}-${event.eventId}`) return current;
  const suffix = event.eventId === undefined ? `${now.getTime()}-${current.length}` : String(event.eventId);
  return [
    ...current,
    {
      id: `elevenlabs-${speaker}-${suffix}`,
      speaker,
      text,
      time: now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      at: now.toISOString(),
    },
  ].slice(-200);
}

export function buildConfirmedConversationOutcome(lines: RealtimeTranscriptLine[], brief: ConfirmedBrief, approvedAt = new Date()) {
  if (!lines.some((line) => line.speaker === 'agent') || !lines.some((line) => line.speaker === 'owner')) {
    throw new Error('A captured agent turn and customer turn are required before approving a deal.');
  }
  const pages = [...new Set(brief.pages.split(/[,\n]/).map((page) => page.trim()).filter(Boolean))];
  if (!pages.length || pages.length > 30 || pages.some((page) => page.length > 100)) {
    throw new Error('Enter 1–30 page names, each under 100 characters.');
  }
  const style = brief.style.trim();
  const content = brief.content.trim();
  if (!style || style.length > 200 || !content || content.length > 1_000) {
    throw new Error('Enter a short visual direction and the customer’s specific site requirements.');
  }
  const colour = brief.colour.trim();
  if (colour.length > 100) throw new Error('Keep the primary colour under 100 characters.');
  const amount = Number(brief.price.trim());
  if (!/^\d+$/.test(brief.price.trim()) || !Number.isSafeInteger(amount) || amount < 1 || amount > 10_000_000) {
    throw new Error('Enter the exact agreed price in whole INR, without commas or symbols.');
  }
  const features = Object.fromEntries(brief.features.filter((feature) => allowedFeatures.has(feature)).map((feature) => [feature, true]));
  return {
    transcript: lines.map((line) => ({
      id: line.id,
      speaker: line.speaker === 'owner' ? 'CUSTOMER' as const : 'AGENT' as const,
      text: line.text,
      at: line.at,
    })),
    summary: `Customer-confirmed ${brief.businessName} website scope: ${pages.join(', ')}; ${content}`,
    sentiment: 'UNKNOWN' as const,
    requirements: {
      businessType: brief.businessType,
      pages,
      features,
      branding: { style, primaryColour: colour || null, mobileFirst: true },
      contentRequirements: [content],
      budget: { minimum: amount, maximum: amount, currency: 'INR' as const },
      notes: ['Scope and exact price confirmed in the browser after the live provider discussion.'],
      approvedAt: approvedAt.toISOString(),
    },
    acceptedAmount: amount,
  };
}

export function conversationOperationKey(kind: 'session' | 'connect' | 'founder-complete', leadId: string): string {
  return `browser-${kind}:${leadId}:${crypto.randomUUID()}`;
}
