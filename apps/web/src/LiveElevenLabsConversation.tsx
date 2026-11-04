import { ConversationProvider, useConversation } from '@elevenlabs/react';
import { ArrowRight, Bot, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { useCallback, useRef, useState, type FormEvent } from 'react';
import { authorizeBrowserConversation, bindBrowserConversation, completeFounderConversation } from './api';
import type { Business } from './types';
import {
  appendRealtimeTranscript,
  buildConfirmedConversationOutcome,
  conversationOperationKey,
  type ConfirmedBrief,
  type RealtimeTranscriptLine,
} from './realtime-conversation';
import './features/sales/conversation-brief.css';

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

const featureOptions: Record<ConfirmedBrief['businessType'], { key: string; label: string }[]> = {
  restaurant: [{ key: 'menu', label: 'Menu' }, { key: 'gallery', label: 'Gallery' }, { key: 'whatsappOrdering', label: 'WhatsApp ordering' }, { key: 'googleMaps', label: 'Map' }],
  salon: [{ key: 'booking', label: 'Booking enquiry' }, { key: 'gallery', label: 'Gallery' }, { key: 'testimonials', label: 'Testimonials' }, { key: 'googleMaps', label: 'Map' }],
  garments: [{ key: 'catalog', label: 'Catalogue' }, { key: 'gallery', label: 'Lookbook' }, { key: 'whatsappOrdering', label: 'WhatsApp enquiry' }, { key: 'googleMaps', label: 'Map' }],
  mechanic: [{ key: 'emergencyContact', label: 'Emergency contact' }, { key: 'testimonials', label: 'Testimonials' }, { key: 'googleMaps', label: 'Map' }, { key: 'whatsappOrdering', label: 'WhatsApp enquiry' }],
  clinic: [{ key: 'appointments', label: 'Appointments' }, { key: 'doctors', label: 'Doctors' }, { key: 'services', label: 'Care services' }, { key: 'googleMaps', label: 'Map' }],
  education: [{ key: 'programmes', label: 'Programmes' }, { key: 'mentors', label: 'Mentors' }, { key: 'admissions', label: 'Admissions' }, { key: 'googleMaps', label: 'Map' }],
  realestate: [{ key: 'listings', label: 'Listings' }, { key: 'viewings', label: 'Private viewings' }, { key: 'whatsappOrdering', label: 'WhatsApp enquiry' }, { key: 'googleMaps', label: 'Map' }],
  fitness: [{ key: 'classes', label: 'Classes' }, { key: 'coaches', label: 'Coaches' }, { key: 'trialBooking', label: 'Trial booking' }, { key: 'googleMaps', label: 'Map' }],
  bakery: [{ key: 'menu', label: 'Bake list' }, { key: 'preorders', label: 'Pre-orders' }, { key: 'celebrationCakes', label: 'Celebration cakes' }, { key: 'googleMaps', label: 'Map' }],
  legal: [{ key: 'practiceAreas', label: 'Practice areas' }, { key: 'consultations', label: 'Consultations' }, { key: 'team', label: 'Professionals' }, { key: 'googleMaps', label: 'Map' }],
  spa: [{ key: 'services', label: 'Services' }, { key: 'gallery', label: 'Gallery' }, { key: 'booking', label: 'Enquiry' }, { key: 'googleMaps', label: 'Map' }],
  dental: [{ key: 'services', label: 'Services' }, { key: 'gallery', label: 'Gallery' }, { key: 'booking', label: 'Enquiry' }, { key: 'googleMaps', label: 'Map' }],
  physiotherapy: [{ key: 'services', label: 'Services' }, { key: 'gallery', label: 'Gallery' }, { key: 'booking', label: 'Enquiry' }, { key: 'googleMaps', label: 'Map' }],
  petcare: [{ key: 'services', label: 'Services' }, { key: 'gallery', label: 'Gallery' }, { key: 'booking', label: 'Enquiry' }, { key: 'googleMaps', label: 'Map' }],
  catering: [{ key: 'services', label: 'Services' }, { key: 'gallery', label: 'Gallery' }, { key: 'booking', label: 'Enquiry' }, { key: 'googleMaps', label: 'Map' }],
  events: [{ key: 'services', label: 'Services' }, { key: 'gallery', label: 'Gallery' }, { key: 'booking', label: 'Enquiry' }, { key: 'googleMaps', label: 'Map' }],
  photography: [{ key: 'services', label: 'Services' }, { key: 'gallery', label: 'Gallery' }, { key: 'booking', label: 'Enquiry' }, { key: 'googleMaps', label: 'Map' }],
  interiors: [{ key: 'services', label: 'Services' }, { key: 'gallery', label: 'Gallery' }, { key: 'booking', label: 'Enquiry' }, { key: 'googleMaps', label: 'Map' }],
  travel: [{ key: 'services', label: 'Services' }, { key: 'gallery', label: 'Gallery' }, { key: 'booking', label: 'Enquiry' }, { key: 'googleMaps', label: 'Map' }],
  movers: [{ key: 'services', label: 'Services' }, { key: 'gallery', label: 'Gallery' }, { key: 'booking', label: 'Enquiry' }, { key: 'googleMaps', label: 'Map' }],
  appliance: [{ key: 'services', label: 'Services' }, { key: 'gallery', label: 'Gallery' }, { key: 'booking', label: 'Enquiry' }, { key: 'googleMaps', label: 'Map' }],
  trades: [{ key: 'services', label: 'Services' }, { key: 'gallery', label: 'Gallery' }, { key: 'booking', label: 'Enquiry' }, { key: 'googleMaps', label: 'Map' }],
  detailing: [{ key: 'services', label: 'Services' }, { key: 'gallery', label: 'Gallery' }, { key: 'booking', label: 'Enquiry' }, { key: 'googleMaps', label: 'Map' }],
  drivingschool: [{ key: 'services', label: 'Services' }, { key: 'gallery', label: 'Gallery' }, { key: 'booking', label: 'Enquiry' }, { key: 'googleMaps', label: 'Map' }],
  laundry: [{ key: 'services', label: 'Services' }, { key: 'gallery', label: 'Gallery' }, { key: 'booking', label: 'Enquiry' }, { key: 'googleMaps', label: 'Map' }],
  furniture: [{ key: 'services', label: 'Services' }, { key: 'gallery', label: 'Gallery' }, { key: 'booking', label: 'Enquiry' }, { key: 'googleMaps', label: 'Map' }],
  devicerepair: [{ key: 'services', label: 'Services' }, { key: 'gallery', label: 'Gallery' }, { key: 'booking', label: 'Enquiry' }, { key: 'googleMaps', label: 'Map' }],
  printing: [{ key: 'services', label: 'Services' }, { key: 'gallery', label: 'Gallery' }, { key: 'booking', label: 'Enquiry' }, { key: 'googleMaps', label: 'Map' }],
  florist: [{ key: 'services', label: 'Services' }, { key: 'gallery', label: 'Gallery' }, { key: 'booking', label: 'Enquiry' }, { key: 'googleMaps', label: 'Map' }],
  jewellery: [{ key: 'services', label: 'Services' }, { key: 'gallery', label: 'Gallery' }, { key: 'booking', label: 'Enquiry' }, { key: 'googleMaps', label: 'Map' }],
  tailoring: [{ key: 'services', label: 'Services' }, { key: 'gallery', label: 'Gallery' }, { key: 'booking', label: 'Enquiry' }, { key: 'googleMaps', label: 'Map' }],
  cloudkitchen: [{ key: 'services', label: 'Services' }, { key: 'gallery', label: 'Gallery' }, { key: 'booking', label: 'Enquiry' }, { key: 'googleMaps', label: 'Map' }],
};

function agentSuggestion(parameters: Record<string, unknown>): Partial<ConfirmedBrief> {
  const outcome = parameters.outcome && typeof parameters.outcome === 'object' && !Array.isArray(parameters.outcome)
    ? parameters.outcome as Record<string, unknown> : parameters;
  const requirements = outcome.requirements && typeof outcome.requirements === 'object' && !Array.isArray(outcome.requirements)
    ? outcome.requirements as Record<string, unknown> : {};
  const branding = requirements.branding && typeof requirements.branding === 'object' && !Array.isArray(requirements.branding)
    ? requirements.branding as Record<string, unknown> : {};
  const rawFeatures = requirements.features && typeof requirements.features === 'object' && !Array.isArray(requirements.features)
    ? requirements.features as Record<string, unknown> : {};
  return {
    ...(Array.isArray(requirements.pages) ? { pages: requirements.pages.filter((page): page is string => typeof page === 'string').join(', ') } : {}),
    ...(typeof branding.style === 'string' ? { style: branding.style } : {}),
    ...(typeof branding.primaryColour === 'string' ? { colour: branding.primaryColour } : {}),
    ...(Array.isArray(requirements.contentRequirements) ? { content: requirements.contentRequirements.filter((line): line is string => typeof line === 'string').join('\n') } : {}),
    ...(Number.isSafeInteger(outcome.acceptedAmount) && Number(outcome.acceptedAmount) > 0 ? { price: String(outcome.acceptedAmount) } : {}),
    ...(requirements.features && typeof requirements.features === 'object' && !Array.isArray(requirements.features)
      ? { features: Object.entries(rawFeatures).filter(([, enabled]) => enabled === true).map(([key]) => key) }
      : {}),
  };
}

function LiveConversationPanel({ leadId, business, onNotice }: LiveElevenLabsConversationProps) {
  const [requestingAccess, setRequestingAccess] = useState(false);
  const [transcript, setTranscript] = useState<RealtimeTranscriptLine[]>([]);
  const [providerConversationId, setProviderConversationId] = useState<string | null>(null);
  const [bindingState, setBindingState] = useState<BindingState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [agentBriefReady, setAgentBriefReady] = useState(false);
  const [brief, setBrief] = useState<ConfirmedBrief>({
    businessType: business.category.toLowerCase() as ConfirmedBrief['businessType'],
    businessName: business.name,
    pages: '', style: '', colour: '', content: '', price: '', features: [],
  });
  const [scopeApproved, setScopeApproved] = useState(false);
  const [priceApproved, setPriceApproved] = useState(false);
  const [approvingBuild, setApprovingBuild] = useState(false);
  const grantIdRef = useRef<string | null>(null);
  const connectOperationRef = useRef<string | null>(null);
  const completionOperationRef = useRef<string | null>(null);

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
      onNotice(`ElevenLabs text chat connected · provider conversation ${conversationId} verified by the API`);
    } catch (cause) {
      setBindingState('failed');
      setError(`The live chat connected, but secure server correlation failed: ${publicError(cause)}`);
    }
  }, [leadId, onNotice]);

  const conversation = useConversation({
    textOnly: true,
    clientTools: {
      submit_build_brief: async (parameters: Record<string, unknown>) => {
        setBrief((current) => {
          const suggestion = agentSuggestion(parameters);
          return {
            ...current,
            ...suggestion,
            features: (suggestion.features ?? current.features).filter((key) => featureOptions[current.businessType].some((option) => option.key === key)),
          };
        });
        setAgentBriefReady(true);
        setScopeApproved(false);
        setPriceApproved(false);
        onNotice('Agent-suggested brief received. Check every detail and confirm the scope and price yourself.');
        return 'Draft displayed for customer review. It will not trigger a build without explicit approval.';
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
    setTranscript([]);
    setProviderConversationId(null);
    setAgentBriefReady(false);
    setScopeApproved(false);
    setPriceApproved(false);
    setBrief({ businessType: business.category.toLowerCase() as ConfirmedBrief['businessType'], businessName: business.name, pages: '', style: '', colour: '', content: '', price: '', features: [] });
    grantIdRef.current = null;
    connectOperationRef.current = null;
    completionOperationRef.current = conversationOperationKey('founder-complete', leadId);
    try {
      if (conversation.status === 'error') conversation.endSession();
      const idempotencyKey = conversationOperationKey('session', leadId);
      const grant = await authorizeBrowserConversation(leadId, idempotencyKey);
      grantIdRef.current = grant.grantId;
      setBindingState('idle');
      await conversation.startSession({
        signedUrl: grant.signedUrl,
        connectionType: 'websocket',
        userId: leadId,
        dynamicVariables: grant.dynamicVariables,
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
    if (!providerConversationId || bindingState !== 'bound' || approvingBuild || !scopeApproved || !priceApproved) return;
    setApprovingBuild(true);
    setError(null);
    try {
      const outcome = buildConfirmedConversationOutcome(transcript, brief);
      await completeFounderConversation({
        leadId,
        providerConversationId,
        outcome,
        idempotencyKey: completionOperationRef.current ?? conversationOperationKey('founder-complete', leadId),
      });
      setScopeApproved(false);
      setPriceApproved(false);
      onNotice('Customer-confirmed deal submitted · the approved build workflow is continuing.');
    } catch (cause) {
      setError(`Build approval failed: ${publicError(cause)}`);
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
          ? 'Chat ended'
            : 'Ready for consent';

  return (
    <section className="panel conversation-panel conversation-panel--real">
      <div className="conversation-panel__header">
        <div className="call-avatar"><Bot size={21} /><span /></div>
        <div>
          <span>AgentFront Sales Agent · ElevenLabs live text chat</span>
          <strong>{statusLabel}</strong>
          {providerConversationId && <code title={providerConversationId}>ID · {providerConversationId}</code>}
        </div>
        <div className="call-controls">
          <button
            className="end-call"
            type="button"
            aria-label="End live text chat"
            title="End live text chat"
            disabled={!connected && conversation.status !== 'connecting'}
            onClick={endRealConversation}
          ><X size={16} /></button>
        </div>
      </div>

      {!providerConversationId && (conversation.status === 'disconnected' || conversation.status === 'error') && (
        <div className="conversation-consent">
          <div className="conversation-consent__icon"><Bot size={24} /></div>
          <h3>{conversation.status === 'error' ? 'Retry the real text conversation' : 'Start a real text conversation'}</h3>
          <p>
            Chat with your ElevenLabs sales agent about the {business.name} site. This is a browser text session,
            not a phone call. Review the captured conversation and confirm the exact scope and price before a build.
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
          <div className="transcript-head">
            <div><span>Captured provider messages</span><span className="pill pill--neutral">{connected ? 'text chat' : 'ended'}</span></div>
            <span className="conversation-mode">{connected ? 'Browser text session live' : 'Session closed'}</span>
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
                  <div><strong>{line.speaker === 'agent' ? 'AgentFront' : `${business.name} owner`}</strong><time>{line.time}</time></div>
                  <p>{line.text}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="transcript-status">
            <span className={`dot dot--${error ? 'red' : connected ? 'green' : 'muted'}${connected ? ' dot--pulse' : ''}`} />
            <span>{error ?? (connected ? 'Text chat is live · only provider messages shown above can be submitted as transcript' : 'Realtime text session ended')}</span>
            {bindingState === 'failed' && providerConversationId
              ? <button type="button" onClick={() => void bindConversation(providerConversationId)}><RefreshCw size={12} /> Retry binding</button>
              : <span>{bindingState === 'bound' ? 'Server correlated' : 'No seeded transcript'}</span>}
          </div>
          {connected && <form className="conversation-input" onSubmit={sendMessage}>
            <input value={message} onChange={(event) => { setMessage(event.target.value); conversation.sendUserActivity(); }} placeholder={`Describe the ${business.name} website you want…`} />
            <button className="button button--primary" type="submit" disabled={message.trim().length === 0}><ArrowRight size={16} /> Send</button>
          </form>}
          {bindingState === 'bound' && <form className="conversation-brief" onSubmit={(event) => { event.preventDefault(); void approveBuild(); }}>
            <div className="conversation-brief__heading">
              <ShieldCheck size={20} />
              <div>
                <strong>Confirm the deal from this conversation</strong>
                <p>{agentBriefReady ? 'The agent suggested values below. Edit them to match what you actually agreed.' : 'Enter the scope you agreed in the chat. No sample transcript, features or price are pre-approved.'}</p>
              </div>
            </div>
            <div className="conversation-brief__fields">
              <label>Pages to build <input value={brief.pages} onChange={(event) => { setBrief({ ...brief, pages: event.target.value }); setScopeApproved(false); }} placeholder="Home, Menu, Location, Contact" required maxLength={800} /></label>
              <label>Visual direction <input value={brief.style} onChange={(event) => { setBrief({ ...brief, style: event.target.value }); setScopeApproved(false); }} placeholder="For example: warm, modern, local" required maxLength={200} /></label>
              <label>Primary colour <input value={brief.colour} onChange={(event) => { setBrief({ ...brief, colour: event.target.value }); setScopeApproved(false); }} placeholder="Optional" maxLength={100} /></label>
              <label>Agreed price (INR) <input value={brief.price} onChange={(event) => { setBrief({ ...brief, price: event.target.value }); setPriceApproved(false); }} inputMode="numeric" pattern="[0-9]+" placeholder="Enter exact agreed price" required /></label>
              <label className="conversation-brief__wide">Customer’s specific requirements <textarea value={brief.content} onChange={(event) => { setBrief({ ...brief, content: event.target.value }); setScopeApproved(false); }} placeholder="What did you ask for in the chat? Include any verified menu, contact, copy or design details." required maxLength={1000} rows={3} /></label>
            </div>
            <fieldset className="conversation-brief__features">
              <legend>Features included in the agreed scope</legend>
              {featureOptions[brief.businessType].map((option) => <label key={option.key}><input type="checkbox" checked={brief.features.includes(option.key)} onChange={(event) => { setBrief({ ...brief, features: event.target.checked ? [...brief.features, option.key] : brief.features.filter((key) => key !== option.key) }); setScopeApproved(false); }} /> {option.label}</label>)}
            </fieldset>
            <label className="conversation-brief__confirmation"><input type="checkbox" checked={scopeApproved} onChange={(event) => setScopeApproved(event.target.checked)} /> I am the customer/founder and approve these pages, features and requirements.</label>
            <label className="conversation-brief__confirmation"><input type="checkbox" checked={priceApproved} onChange={(event) => setPriceApproved(event.target.checked)} /> I agree to pay exactly ₹{brief.price || '—'} for this scope.</label>
            <div className="conversation-brief__footer">
              <small>Requires a captured agent turn and customer turn. Submitting starts the governed build; a browser text chat does not prove a phone call.</small>
              <button className="button button--primary" type="submit" disabled={approvingBuild || !scopeApproved || !priceApproved || !transcript.some((line) => line.speaker === 'agent') || !transcript.some((line) => line.speaker === 'owner')}>{approvingBuild ? 'Submitting confirmed deal…' : 'Approve scope, price & build'}</button>
            </div>
          </form>}
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
