import { describe, expect, it } from 'vitest';
import { appendRealtimeTranscript } from './realtime-conversation';

describe('appendRealtimeTranscript', () => {
  it('maps provider roles, ignores blanks and de-duplicates repeated final messages', () => {
    const at = new Date('2026-08-23T10:30:00.000Z');
    const first = appendRealtimeTranscript([], { message: ' Hello ', role: 'agent', eventId: 7 }, at);
    expect(first).toEqual([{
      id: 'elevenlabs-agent-7',
      speaker: 'agent',
      text: 'Hello',
      time: at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    }]);
    expect(appendRealtimeTranscript(first, { message: 'Hello', role: 'agent', eventId: 7 }, at)).toBe(first);
    expect(appendRealtimeTranscript(first, { message: '   ', role: 'user' }, at)).toBe(first);
    expect(appendRealtimeTranscript(first, { message: 'Yes', role: 'user', eventId: 8 }, at).at(-1)).toMatchObject({
      speaker: 'owner',
      text: 'Yes',
    });
  });
});
