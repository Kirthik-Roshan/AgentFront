import { ConversationProvider, useConversation } from '@elevenlabs/react';
import { ArrowRight, Bot, Phone, RefreshCw, ShieldCheck } from 'lucide-react';
import { useCallback, useRef, useState, type FormEvent } from 'react';
import { authorizeBrowserConversation, bindBrowserConversation, completeFounderConversation } from './api';
import type { Business } from './types';
import {
  appendRealtimeTranscript,
  conversationOperationKey,
  type RealtimeTranscriptLine,
} from './realtime-conversation';

type LiveElevenLabsConversationProps = {
  leadId: string;
  business: Business;
  onNotice: (message: string) => void;
};

type BindingState = 'idle' | 'binding' | 'bound' | 'failed';

function publicError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/wss?:\/\/\S+/gi, '[redacted transport credential]');
}

function createFounderDemoOutcome(business: Business) {
  const businessType = business.category.toLowerCase() as 'restaurant' | 'salon' | 'garments' | 'mechanic';
  const profile = {
    restaurant: { pages: ['Home', 'Menu', 'Location', 'Contact'], features: { menu: true, gallery: true, whatsappOrdering: true, googleMaps: true }, colour: 'Saffron', price: 7200 },
    salon: { pages: ['Home', 'Services', 'Gallery', 'Book now'], features: { booking: true, gallery: true, whatsappOrdering: true, googleMaps: true, testimonials: true }, colour: 'Rose', price: 8499 },
    garments: { pages: ['Home', 'Collections', 'Lookbook', 'Contact'], features: { catalog: true, gallery: true, whatsappOrdering: true, googleMaps: true }, colour: 'Indigo', price: 9999 },
    mechanic: { pages: ['Home', 'Services', 'Emergency contact', 'Location'], features: { emergencyContact: true, whatsappOrdering: true, googleMaps: true, testimonials: true }, colour: 'Steel blue', price: 7999 },
  }[businessType];
  const now = new Date().toISOString();
  return {
    transcript: [
      { id: `founder-${business.id}-1`, speaker: 'AGENT', text: `We can prepare a mobile-first ${business.name} website using the approved scope.`, at: now },
      { id: `founder-${business.id}-2`, speaker: 'CUSTOMER', text: `I approve the ${profile.pages.join(', ')} scope and the agreed delivery price.`, at: now },
    ],
    summary: `Founder-approved demo brief for ${business.name}.`,
    sentiment: 'POSITIVE',
    requirements: {
      businessType,
      pages: profile.pages,
      features: profile.features,
      branding: { style: 'Modern and trustworthy', primaryColour: profile.colour, mobileFirst: true },
      contentRequirements: ['Use verified business name, location and contact information only.'],
      budget: { minimum: profile.price, maximum: profile.price, currency: 'INR' },
      notes: ['Approved by the founder for the live demonstration build.'],
      approvedAt: now,
    },
    acceptedAmount: profile.price,
  };
}

function LiveConversationPanel({ leadId, business, onNotice }: LiveElevenLabsConversationProps) {
  const [requestingAccess, setRequestingAccess] = useState(false);
  const [transcript, setTranscript] = useState<RealtimeTranscriptLine[]>([]);
  const [providerConversationId, setProviderConversationId] = useState<string | null>(null);
  const [bindingState, setBindingState] = useState<BindingState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [pendingOutcome, setPendingOutcome] = useState<unknown>(null);
  const [approvingBuild, setApprovingBuild] = useState(false);
  const grantIdRef = useRef<string | null>(null);
  const sessionOperationRef = useRef<string | null>(null);
  const connectOperationRef = useRef<string | null>(null);

  const bindConversation = useCallback(async (conversationId: string) => {
    const grantId = grantIdRef.current;
    if (!grantId) {
      setBindingState('failed');
      setError('The provider connected without an AgentFront browser grant. End the call and try again.');
      return;
    }
    const idempotencyKey = connectOperationRef.current ?? conversationOperationKey('connect', leadId);
    connectOperationRef.current = idempotencyKey;
    setBindingState('binding');
    try {
      await bindBrowserConversation({
        leadId,
        grantId,
        providerConversationId: conversationId,
        idempotencyKey,
      });
      setBindingState('bound');
      setError(null);
      onNotice(`ElevenLabs connected · provider conversation ${conversationId} verified by the API`);
    } catch (cause) {
      setBindingState('failed');
      setError(`The live call connected, but secure server correlation failed: ${publicError(cause)}`);
    }
  }, [leadId, onNotice]);

  const conversation = useConversation({
    textOnly: true,
    clientTools: {
      submit_build_brief: async (parameters: Record<string, unknown>) => {
        const outcome = parameters.outcome ?? parameters;
        setPendingOutcome(outcome);
        onNotice('ElevenLabs prepared a build brief. Review the chat, then approve the build and deployment.');
        return 'Build brief received; waiting for founder approval.';
      },
    },
    onConnect: ({ conversationId }) => {
      setProviderConversationId(conversationId);
      void bindConversation(conversationId);
    },
    onMessage: ({ message, role, event_id: eventId }) => {
      setTranscript((current) => appendRealtimeTranscript(current, { message, role, eventId }));
    },
    onError: (message) => {
      setError(publicError(message));
    },
  });

  async function startRealConversation() {
    if (requestingAccess || (conversation.status !== 'disconnected' && conversation.status !== 'error')) return;
    setRequestingAccess(true);
    setError(null);
    try {
      if (conversation.status === 'error') conversation.endSession();
      const idempotencyKey = sessionOperationRef.current ?? conversationOperationKey('session', leadId);
      sessionOperationRef.current = idempotencyKey;
      const grant = await authorizeBrowserConversation(leadId, idempotencyKey);
      grantIdRef.current = grant.grantId;
      setBindingState('idle');
      await conversation.startSession({
        signedUrl: grant.signedUrl,
        connectionType: 'websocket',
        userId: leadId,
      });
    } catch (cause) {
      setError(publicError(cause));
    } finally {
      setRequestingAccess(false);
    }
  }

  function endRealConversation() {
    conversation.endSession();
  }

  function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (!text || conversation.status !== 'connected') return;
    conversation.sendUserMessage(text);
    setMessage('');
  }

  async function approveBuild() {
    if (!pendingOutcome || !providerConversationId || bindingState !== 'bound' || approvingBuild) return;
    setApprovingBuild(true);
    setError(null);
    try {
      await completeFounderConversation({
        leadId,
        providerConversationId,
        outcome: pendingOutcome,
        idempotencyKey: conversationOperationKey('founder-complete', leadId),
      });
      setPendingOutcome(null);
      onNotice('Build brief approved · Codex build and Vercel deployment are now running.');
    } catch (cause) {
      setError(`Build approval failed: ${publicError(cause)}`);
    } finally {
      setApprovingBuild(false);
    }
  }

  async function approveFounderDemoBuild() {
    if (!providerConversationId || bindingState !== 'bound' || approvingBuild) return;
    setApprovingBuild(true);
    setError(null);
    try {
      await completeFounderConversation({
        leadId,
        providerConversationId,
        outcome: createFounderDemoOutcome(business),
        idempotencyKey: conversationOperationKey('founder-demo-complete', leadId),
      });
      onNotice(`Founder-approved demo deal for ${business.name} · Codex build and Vercel deployment are now running.`);
    } catch (cause) {
      setError(`Demo build approval failed: ${publicError(cause)}`);
    } finally {
      setApprovingBuild(false);
    }
  }

  const connected = conversation.status === 'connected';
  const busy = requestingAccess || conversation.status === 'connecting';
  const statusLabel = requestingAccess
    ? 'Opening secure text chat'
    : conversation.status === 'connected'
      ? bindingState === 'bound'
      ? 'Connected · server verified'
        : bindingState === 'failed'
          ? 'Connected · correlation needs attention'
          : 'Connected · verifying correlation'
      : conversation.status === 'error'
        ? 'Connection error'
        : conversation.status === 'connecting'
          ? 'Connecting securely'
          : providerConversationId
            ? 'Call ended'
            : 'Ready for consent';

  return (
    <section className="panel conversation-panel conversation-panel--real">
      <div className="conversation-panel__header">
        <div className="call-avatar"><Bot size={21} /><span /></div>
        <div>
          <span>AgentFront Sales Agent · ElevenLabs REAL</span>
          <strong>{statusLabel}</strong>
          {providerConversationId && <code title={providerConversationId}>ID · {providerConversationId}</code>}
        </div>
        <div className="call-controls">
          <button
            className={`icon-button${conversation.isMuted ? ' is-active' : ''}`}
            type="button"
            aria-label={conversation.isMuted ? 'Unmute microphone' : 'Mute microphone'}
            title={conversation.isMuted ? 'Unmute microphone' : 'Mute microphone'}
            disabled={!connected}
            onClick={() => conversation.setMuted(!conversation.isMuted)}
          >
            {conversation.isMuted ? <Phone size={17} /> : <Bot size={17} />}
          </button>
          <button
            className="end-call"
            type="button"
            aria-label="End live conversation"
            title="End live conversation"
            disabled={!connected && conversation.status !== 'connecting'}
            onClick={endRealConversation}
          ><Phone size={16} /></button>
        </div>
      </div>

      {!providerConversationId && (conversation.status === 'disconnected' || conversation.status === 'error') && (
        <div className="conversation-consent">
          <div className="conversation-consent__icon"><Bot size={24} /></div>
          <h3>{conversation.status === 'error' ? 'Retry the real text conversation' : 'Start a real text conversation'}</h3>
          <p>
            Chat with your ElevenLabs sales agent to agree the {business.name} site. The transcript stays connected
            to this exact project, and the agent can prepare a build brief for your approval.
          </p>
          <button
            className="button button--primary"
            type="button"
            disabled={busy}
            onClick={() => void startRealConversation()}
          >
            <Bot size={16} /> {busy ? 'Connecting…' : conversation.status === 'error' ? 'Retry ElevenLabs chat' : 'Start ElevenLabs chat'}
          </button>
          <small><ShieldCheck size={13} /> This text-only session does not request microphone access. The ElevenLabs API key stays on the server.</small>
        </div>
      )}

      {(providerConversationId || conversation.status !== 'disconnected') && (
        <>
          <div className={`waveform${conversation.isSpeaking ? ' is-speaking' : ''}`} aria-hidden="true">
            {Array.from({ length: 48 }, (_, index) => (
              <span key={index} style={{ height: `${12 + ((index * 17) % 38)}px`, animationDelay: `${index * 28}ms` }} />
            ))}
          </div>
          <div className="transcript-head">
            <div><span>Live provider transcript</span><span className="pill pill--neutral">{connected ? conversation.mode : 'ended'}</span></div>
            <span className="conversation-mode">{connected ? (conversation.isMuted ? 'Microphone muted' : 'Microphone live') : 'Session closed'}</span>
          </div>
          <div className="transcript" aria-live="polite">
            {transcript.length === 0 && (
              <div className="transcript-empty">
                <Bot size={20} />
                <p>{connected ? 'Listening for the first live turn…' : 'No provider transcript was received in this browser session.'}</p>
              </div>
            )}
            {transcript.map((line) => (
              <div className={`transcript-line transcript-line--${line.speaker}`} key={line.id}>
                {line.speaker === 'agent'
                  ? <span className="transcript-avatar"><Bot size={15} /></span>
                  : <span className="avatar avatar--3">RO</span>}
                <div>
                  <div><strong>{line.speaker === 'agent' ? 'AgentFront' : 'Restaurant Owner'}</strong><time>{line.time}</time></div>
                  <p>{line.text}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="transcript-status">
            <span className={`dot dot--${error ? 'red' : connected ? 'green' : 'muted'}${connected ? ' dot--pulse' : ''}`} />
            <span>{error ?? (connected ? `${conversation.mode === 'speaking' ? 'Agent speaking' : 'Listening'} · transcript stays in this page until governed completion` : 'Realtime session ended')}</span>
            {bindingState === 'failed' && providerConversationId
              ? <button type="button" onClick={() => void bindConversation(providerConversationId)}><RefreshCw size={12} /> Retry binding</button>
              : <span>{bindingState === 'bound' ? 'Server correlated' : 'No seeded transcript'}</span>}
          </div>
          {connected && <form className="conversation-input" onSubmit={sendMessage}>
            <input value={message} onChange={(event) => { setMessage(event.target.value); conversation.sendUserActivity(); }} placeholder={`Describe the ${business.name} website you want…`} />
            <button className="button button--primary" type="submit" disabled={message.trim().length === 0}><ArrowRight size={16} /> Send</button>
          </form>}
          {pendingOutcome && <div className="conversation-approval">
            <span><ShieldCheck size={17} /><strong>Build brief received from ElevenLabs</strong><small>Review the discussion, then explicitly authorize Codex and Vercel to continue.</small></span>
            <button className="button button--primary" type="button" disabled={approvingBuild || bindingState !== 'bound'} onClick={() => void approveBuild()}>{approvingBuild ? 'Starting build…' : 'Approve build & deploy'}</button>
          </div>}
          {connected && !pendingOutcome && bindingState === 'bound' && <div className="conversation-approval conversation-approval--demo">
            <span><ShieldCheck size={17} /><strong>Demo video shortcut</strong><small>After your live chat, use an explicitly founder-approved sample brief to show the real Codex build and Vercel deployment.</small></span>
            <button className="button button--secondary" type="button" disabled={approvingBuild} onClick={() => void approveFounderDemoBuild()}>{approvingBuild ? 'Starting build…' : 'Close demo deal & build'}</button>
          </div>}
        </>
      )}
    </section>
  );
}

export function LiveElevenLabsConversation(props: LiveElevenLabsConversationProps) {
  return (
    <ConversationProvider>
      <LiveConversationPanel {...props} />
    </ConversationProvider>
  );
}
