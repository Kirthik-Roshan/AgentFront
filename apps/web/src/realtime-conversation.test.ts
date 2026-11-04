import { describe, expect, it } from 'vitest';
import { appendRealtimeTranscript, buildConfirmedConversationOutcome } from './realtime-conversation';

describe('appendRealtimeTranscript', () => {
  it('maps provider roles, ignores blanks and de-duplicates repeated final messages', () => {
    const at = new Date('2026-08-23T10:30:00.000Z');
    const first = appendRealtimeTranscript([], { message: ' Hello ', role: 'agent', eventId: 7 }, at);
    expect(first).toEqual([{
      id: 'elevenlabs-agent-7',
      speaker: 'agent',
      text: 'Hello',
      time: at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      at: at.toISOString(),
    }]);
    expect(appendRealtimeTranscript(first, { message: 'Hello', role: 'agent', eventId: 7 }, at)).toBe(first);
    expect(appendRealtimeTranscript(first, { message: '   ', role: 'user' }, at)).toBe(first);
    expect(appendRealtimeTranscript(first, { message: 'Yes', role: 'user', eventId: 8 }, at).at(-1)).toMatchObject({
      speaker: 'owner',
      text: 'Yes',
    });
  });

  it('keeps a second genuine turn even when the speaker repeats the same words', () => {
    const first = appendRealtimeTranscript([], { message: 'Yes', role: 'user', eventId: 1 });
    const second = appendRealtimeTranscript(first, { message: 'Yes', role: 'user', eventId: 2 });
    expect(second).toHaveLength(2);
  });
});

describe('buildConfirmedConversationOutcome', () => {
  const at = new Date('2026-08-23T10:30:00.000Z');
  const transcript = appendRealtimeTranscript(
    appendRealtimeTranscript([], { message: 'Which pages?', role: 'agent', eventId: 1 }, at),
    { message: 'Home and menu for ₹8300', role: 'user', eventId: 2 }, at,
  );
  const brief = {
    businessType: 'restaurant' as const,
    businessName: 'SpiceRoute Kitchen',
    pages: 'Home, Menu',
    style: 'Warm and modern',
    colour: 'Saffron',
    content: 'Show the verified menu and contact details.',
    price: '8300',
    features: ['menu', 'gallery'],
  };

  it('submits only captured provider turns and explicitly entered scope and price', () => {
    expect(buildConfirmedConversationOutcome(transcript, brief, at)).toMatchObject({
      transcript: [
        { id: 'elevenlabs-agent-1', speaker: 'AGENT', text: 'Which pages?', at: at.toISOString() },
        { id: 'elevenlabs-owner-2', speaker: 'CUSTOMER', text: 'Home and menu for ₹8300', at: at.toISOString() },
      ],
      sentiment: 'UNKNOWN',
      requirements: {
        pages: ['Home', 'Menu'],
        branding: { style: 'Warm and modern', primaryColour: 'Saffron', mobileFirst: true },
        features: { menu: true, gallery: true },
        approvedAt: at.toISOString(),
      },
      acceptedAmount: 8300,
    });
  });

  it('rejects a deal without both live speakers or an exact entered amount', () => {
    expect(() => buildConfirmedConversationOutcome(transcript.slice(0, 1), brief, at)).toThrow(/captured agent turn and customer turn/);
    expect(() => buildConfirmedConversationOutcome(transcript, { ...brief, price: '' }, at)).toThrow(/exact agreed price/);
    expect(() => buildConfirmedConversationOutcome(transcript, { ...brief, price: '7,200' }, at)).toThrow(/exact agreed price/);
  });
});
