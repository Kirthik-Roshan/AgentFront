export type RealtimeTranscriptLine = {
  id: string;
  speaker: 'agent' | 'owner';
  text: string;
  time: string;
};

export function appendRealtimeTranscript(
  current: RealtimeTranscriptLine[],
  event: { message: string; role: 'agent' | 'user'; eventId?: number },
  now = new Date(),
): RealtimeTranscriptLine[] {
  const text = event.message.trim();
  if (!text) return current;
  const speaker: RealtimeTranscriptLine['speaker'] = event.role === 'agent' ? 'agent' : 'owner';
  const previous = current.at(-1);
  if (previous?.speaker === speaker && previous.text === text) return current;
  const suffix = event.eventId === undefined ? `${now.getTime()}-${current.length}` : String(event.eventId);
  return [
    ...current,
    {
      id: `elevenlabs-${speaker}-${suffix}`,
      speaker,
      text,
      time: now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    },
  ].slice(-200);
}

export function conversationOperationKey(kind: 'session' | 'connect' | 'founder-complete' | 'founder-demo-complete', leadId: string): string {
  return `browser-${kind}:${leadId}:${crypto.randomUUID()}`;
}
