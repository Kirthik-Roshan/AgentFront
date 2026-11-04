import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowRight, BadgeCheck, CalendarClock, CheckCircle2, ChevronRight, Clock3,
  FileJson2, Headphones, History, Phone, PhoneIncoming, Plus, RefreshCw,
  Search, ShieldAlert, ShieldCheck, UserRound, Users, XCircle,
} from 'lucide-react';
import { getBusinessPhotoUrl, getSalesBusinessDetail, getSalesOverview, postSalesBusinessAction, simulateInboundSalesCall, type IntegrationHealth } from '../../api';
import { canStartSalesCall, formatSalesTime, salesStateLabel, salesStateTone, salesTimeline, simulatedCallLabel } from './presenter';
import type { SalesBusinessDetail, SalesOverviewSnapshot } from './types';

type Props = { onNotice: (message: string) => void; onDiscover: () => void; telephony?: IntegrationHealth };
const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const key = (action: string) => `sales-ui:${action}:${crypto.randomUUID()}`;
const plusHourLocal = () => {
  const date = new Date(Date.now() + 60 * 60_000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};
const dateInputToIso = (value: string): string | null => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

function Metric({ value, label, hint }: { value: string | number; label: string; hint?: string }) {
  return <div className="sales-ops__metric"><strong>{value}</strong><span>{label}</span>{hint && <small>{hint}</small>}</div>;
}

function Empty({ children }: { children: string }) {
  return <p className="sales-ops__empty">{children}</p>;
}

function BusinessThumbnail({ businessId, name }: { businessId: string; name: string }) {
  const [failedBusinessId, setFailedBusinessId] = useState<string | null>(null);
  const failed = failedBusinessId === businessId;
  return <span className="sales-ops__business-icon">
    {failed ? <Users size={18} /> : <img src={getBusinessPhotoUrl(businessId, 240)} alt={`${name} Google Places`} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedBusinessId(businessId)} />}
  </span>;
}

export function SalesOperations({ onNotice, onDiscover, telephony }: Props) {
  const [overview, setOverview] = useState<SalesOverviewSnapshot | null>(null);
  const [detail, setDetail] = useState<SalesBusinessDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [receptionistName, setReceptionistName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [callbackAt, setCallbackAt] = useState(plusHourLocal);
  const [handoffSummary, setHandoffSummary] = useState('Receptionist shared the owner contact and requested an owner callback.');
  const [inboundPhone, setInboundPhone] = useState('');
  const [quote, setQuote] = useState('7999');
  const [agreed, setAgreed] = useState('100');
  const [pages, setPages] = useState('Home, Services, About, Contact');
  const [dealSummary, setDealSummary] = useState('Verified decision maker accepted the website scope and agreed price.');

  const refreshRecords = useCallback(() => {
    setLoading(true);
    setDetailLoading(true);
    setRefresh((value) => value + 1);
  }, []);

  useEffect(() => {
    let active = true;
    void getSalesOverview().then((snapshot) => {
      if (!active) return;
      setOverview(snapshot);
      setError(null);
      setDetailLoading(true);
      setSelectedId((current) => current && snapshot.businesses.some((row) => row.business.id === current)
        ? current : snapshot.businesses[0]?.business.id ?? null);
    }).catch((cause) => {
      if (!active) return;
      setOverview(null);
      setDetail(null);
      setError(cause instanceof Error ? cause.message : 'Sales API is unavailable.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh]);

  useEffect(() => {
    if (!selectedId || !overview) return;
    let active = true;
    void getSalesBusinessDetail(selectedId).then((record) => {
      if (active) { setDetail(record); setActionError(null); }
    }).catch((cause) => {
      if (active) setActionError(cause instanceof Error ? cause.message : 'Business detail could not be loaded.');
    }).finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [selectedId, overview]);

  // The API remains authoritative while the founder watches a worker-driven
  // build. Poll only in a visible tab; manual Refresh still surfaces errors.
  useEffect(() => {
    let active = true;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      setCurrentTime(Date.now());
      void getSalesOverview().then((snapshot) => {
        if (active) setOverview(snapshot);
      }).catch(() => {});
      if (selectedId) void getSalesBusinessDetail(selectedId).then((record) => {
        if (active) setDetail(record);
      }).catch(() => {});
    }, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [selectedId]);

  const rows = useMemo(() => (overview?.businesses ?? []).filter((row) => {
    const text = `${row.business.name} ${row.business.city} ${row.business.businessCode ?? ''} ${row.business.id}`.toLowerCase();
    return text.includes(query.toLowerCase()) && (statusFilter === 'ALL' || row.business.salesState === statusFilter);
  }), [overview, query, statusFilter]);
  const states = [...new Set((overview?.businesses ?? []).map((row) => row.business.salesState))].sort();
  const realTelephony = telephony?.mode === 'REAL';
  const telephonyReady = realTelephony && telephony?.status === 'CONNECTED';

  async function operate(label: string, operation: () => Promise<unknown>, notice: string) {
    if (busy || !detail) return;
    setBusy(label);
    setActionError(null);
    try {
      await operation();
      onNotice(notice);
      refreshRecords();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'The sales operation failed.');
    } finally {
      setBusy(null);
    }
  }

  const current = detail?.business;
  const demoCall = detail?.calls.find((call) => call.direction === 'OUTBOUND' && call.providerMode === 'DEMO');
  const owner = detail?.contacts.find((contact) => contact.isDecisionMaker && !contact.verified);
  const verifiedOwner = detail?.contacts.find((contact) => contact.isDecisionMaker && contact.verified);
  const ownerCall = detail?.calls.find((call) => call.contactId === verifiedOwner?.id && call.direction === 'INBOUND');
  const canClose = Boolean(verifiedOwner && ownerCall && ['OWNER_CONTACTED', 'DISCOVERY_CONVERSATION', 'REQUIREMENTS_COLLECTING', 'NEGOTIATING', 'QUOTE_PRESENTED'].includes(current?.salesState ?? ''));
  const canHandoff = Boolean(demoCall && ['CALLING', 'CONTACTED', 'RECEPTIONIST_CONTACTED'].includes(current?.salesState ?? ''));
  const canQueue = ['DISCOVERED', 'QUALIFIED', 'CALLBACK_REQUESTED', 'FOLLOW_UP_REQUIRED', 'FOLLOW_UP_SCHEDULED', 'OWNER_CONTACT_IDENTIFIED']
    .includes(current?.salesState ?? '');
  const activeCall = detail?.calls.find((call) => ['QUEUED', 'INITIATING', 'RINGING', 'IN_PROGRESS'].includes(call.status));
  const canReleaseStaleCall = Boolean(activeCall && currentTime - Date.parse(activeCall.updatedAt) >= 10 * 60_000);

  function requestOutboundCall() {
    if (!current?.phone) { setActionError('A callable business phone is required.'); return; }
    if (realTelephony && !window.confirm(
      `Call ${current.name} at ${current.phone} with Sarvam?\n\nThis confirms the exact selected destination and starts a real outbound call.`,
    )) return;
    void operate('call', async () => {
      if (current.salesState === 'DISCOVERED') {
        await postSalesBusinessAction(current.id, 'queue', {}, key('queue-before-call'));
      }
      return postSalesBusinessAction(current.id, 'call', realTelephony
        ? { founderApproved: true, approvedPhone: current.phone }
        : { allowDemoOutsideWindow: true }, key('call'));
    }, realTelephony
      ? `Sarvam call requested for ${current.name}. Live status and the final transcript will appear below.`
      : 'SIMULATED TELEPHONY · Outbound call recorded.');
  }

  function submitHandoff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current || !demoCall) return;
    const callback = dateInputToIso(callbackAt);
    if (!callback || Date.parse(callback) <= Date.now()) { setActionError('Choose a callback time in the future.'); return; }
    void operate('handoff', () => postSalesBusinessAction(current.id, 'receptionist-handoff', {
      callId: demoCall.id, receptionistName: receptionistName.trim() || null,
      ownerName: ownerName.trim(), ownerPhone: ownerPhone.trim(), callbackAt: callback,
      summary: handoffSummary.trim(),
    }, key('handoff')), 'SIMULATED TELEPHONY · Receptionist handoff and callback saved.');
  }

  function submitInbound(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    void operate('inbound', () => simulateInboundSalesCall(inboundPhone.trim(), key('inbound')),
      'SIMULATED TELEPHONY · Inbound caller resolution recorded.');
  }

  function submitDeal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current || !verifiedOwner || !ownerCall) return;
    const pageNames = pages.split(',').map((item) => item.trim()).filter(Boolean);
    const quotedPrice = Number(quote);
    const agreedPrice = Number(agreed);
    if (!pageNames.length || !Number.isSafeInteger(quotedPrice) || !Number.isSafeInteger(agreedPrice)) {
      setActionError('Enter at least one page and whole-rupee prices.'); return;
    }
    if (!current.phone) { setActionError('A public business phone is required for the website.'); return; }
    void operate('deal', () => postSalesBusinessAction(current.id, 'deal-won', {
      callId: ownerCall.id, decisionMakerContactId: verifiedOwner.id,
      summary: dealSummary.trim(), publicBusinessPhone: current.phone, quotedPrice, agreedPrice,
      objections: [], requirements: { pages: pageNames, features: { whatsappOrdering: true, googleMaps: true }, notes: [] },
      branding: { style: 'Modern, mobile-first' },
    }, key('deal')), 'Deal recorded under pricing policy · project_spec.json generated.');
  }

  return <div className="page sales-ops">
    <div className="sales-ops__heading">
      <div><span className="eyebrow">Autonomous workforce / source of truth</span><h1>Sales operations</h1><p>Business-linked contacts, calls, follow-ups and deal decisions from the AgentFront API.</p></div>
      <div className="sales-ops__heading-actions"><span className="sales-ops__mode"><Headphones size={15} /> {realTelephony ? `${telephony?.provider ?? 'Sarvam'} · ${telephonyReady ? 'real outbound ready' : `real outbound ${telephony?.status.toLowerCase() ?? 'unavailable'}`}` : 'Telephony simulation only'}</span><button className="button button--secondary" type="button" onClick={refreshRecords} disabled={loading}><RefreshCw size={15} /> Refresh</button></div>
    </div>

    {error && <div className="sales-ops__notice sales-ops__notice--error"><XCircle size={18} /><span><strong>Sales API unavailable</strong>{error}<br />No static leads or simulated success are shown here.</span><button type="button" onClick={refreshRecords}>Retry</button></div>}
    {actionError && <div className="sales-ops__notice sales-ops__notice--error"><ShieldAlert size={17} /><span>{actionError}</span><button type="button" onClick={() => setActionError(null)}>Dismiss</button></div>}

    <div className="sales-ops__metrics" aria-label="Sales overview metrics">
      <Metric value={overview?.metrics.totalBusinesses ?? '—'} label="Businesses" />
      <Metric value={overview?.metrics.qualifiedBusinesses ?? '—'} label="Qualified" />
      <Metric value={overview?.metrics.callsAttempted ?? '—'} label="Calls attempted" hint="Provider-recorded only" />
      <Metric value={overview?.metrics.receptionistContacts ?? '—'} label="Receptionists" />
      <Metric value={overview?.metrics.decisionMakersIdentified ?? '—'} label="Decision makers" />
      <Metric value={overview?.metrics.callbacksScheduled ?? '—'} label="Callbacks queued" />
      <Metric value={overview?.metrics.dealsWon ?? '—'} label="Deals won" />
      <Metric value={overview ? `${overview.metrics.conversionRate.toFixed(1)}%` : '—'} label="Conversion" />
    </div>

    <div className="sales-ops__layout">
      <section className="sales-ops__directory panel" aria-label="Sales businesses">
        <div className="sales-ops__section-head"><div><span className="panel-label">Live business register</span><h2>Businesses <em>{overview?.businesses.length ?? '—'}</em></h2></div><button type="button" onClick={onDiscover} title="Discover businesses"><Plus size={19} /></button></div>
        <label className="sales-ops__search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, city or ID" aria-label="Search sales businesses" /></label>
        <select className="sales-ops__filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter by sales state"><option value="ALL">All sales states</option>{states.map((state) => <option key={state} value={state}>{salesStateLabel(state)}</option>)}</select>
        <div className="sales-ops__business-list">
          {loading && <Empty>Loading persisted sales records…</Empty>}
          {!loading && !error && rows.length === 0 && <Empty>{overview?.businesses.length ? 'No businesses match this filter.' : 'No businesses have entered sales operations yet. Discover and qualify one to begin.'}</Empty>}
          {rows.map((row) => <button type="button" key={row.business.id} className={`sales-ops__business${selectedId === row.business.id ? ' is-selected' : ''}`} onClick={() => { setSelectedId(row.business.id); setDetailLoading(true); setDetail(null); }}>
            <BusinessThumbnail businessId={row.business.id} name={row.business.name} /><span className="sales-ops__business-copy"><strong>{row.business.name}</strong><small>{row.business.category} · {row.business.city}</small><span className={`sales-ops__state is-${salesStateTone(row.business.salesState)}`}>{salesStateLabel(row.business.salesState)}</span></span><ChevronRight size={17} />
          </button>)}
        </div>
      </section>

      <div className="sales-ops__detail">
        {(detailLoading || (selectedId && detail?.business.id !== selectedId)) && <section className="panel sales-ops__placeholder">Loading business record…</section>}
        {!detailLoading && !detail && !error && <section className="panel sales-ops__placeholder">Select a business to inspect its sales history.</section>}
        {detail && current && !detailLoading && <>
          <section className="panel sales-ops__hero">
            <div><span className="panel-label">{current.businessCode ?? current.id} · {current.category} · {current.city}</span><h2>{current.name}</h2><p>{current.address}</p><div className="sales-ops__hero-meta"><span className={`sales-ops__state is-${salesStateTone(current.salesState)}`}>{salesStateLabel(current.salesState)}</span><span>{current.website ? 'Website on record' : 'Website missing'}</span><span>{detail.contacts.length} contacts</span></div></div>
            <div className="sales-ops__hero-actions">{activeCall && <small className="sales-ops__call-hint">Sarvam accepted attempt {activeCall.providerCallId ?? 'pending ID'}. Only a provider callback can confirm ringing or connection.</small>}{canReleaseStaleCall && <button className="button button--secondary" type="button" disabled={Boolean(busy)} onClick={() => { if (window.confirm('Release this unconfirmed provider attempt? Check Sarvam/Vobiz first; this does not cancel a live provider call.')) void operate('release-stale', () => postSalesBusinessAction(current.id, `calls/${encodeURIComponent(activeCall!.id)}/release-stale`, {}, key('release-stale')), 'Unconfirmed attempt released. You can retry with a new idempotency key.'); }}>Release stale attempt</button>}<button className="button button--secondary" type="button" disabled={Boolean(busy) || !canQueue} onClick={() => void operate('queue', () => postSalesBusinessAction(current.id, 'queue', {}, key('queue')), 'Lead queued in the persistent Sales Orchestrator.')}><Plus size={15} /> Queue lead</button><button className="button" type="button" disabled={Boolean(busy) || !canStartSalesCall(detail) || (realTelephony && !telephonyReady)} onClick={requestOutboundCall}><Phone size={15} /> {realTelephony ? telephonyReady ? current.salesState === 'DISCOVERED' ? 'Queue & call with Sarvam' : 'Call with Sarvam' : 'Sarvam unavailable' : 'Start demo call'}</button>{realTelephony && <small className="sales-ops__call-hint">{telephonyReady ? 'The selected business, location and public digital-presence signals are supplied to Sarvam. A real call still requires this explicit confirmation.' : telephony?.message ?? 'Restore the Sarvam callback before calling.'}</small>}</div>
          </section>

          <div className="sales-ops__columns">
            <div className="sales-ops__stack">
              <section className="panel sales-ops__card"><div className="sales-ops__card-head"><span><UserRound size={18} /><h3>Contacts & identity</h3></span><small>Same business ID</small></div>
                {detail.contacts.length === 0 ? <Empty>No contacts recorded yet.</Empty> : detail.contacts.map((contact) => <div className="sales-ops__contact" key={contact.id}><div><strong>{contact.name ?? 'Name not captured'}</strong><span>{contact.roles.map(salesStateLabel).join(' · ')} · {contact.phone}</span><small>{contact.source.replaceAll('_', ' ')} · {contact.preferredLanguage ?? 'Language not set'}</small></div><div><span className={`sales-ops__state is-${contact.verified ? 'success' : 'warning'}`}>{contact.verified ? 'Verified' : 'Unverified'}</span>{contact.isDecisionMaker && <span className="sales-ops__identity"><BadgeCheck size={13} /> Decision maker</span>}</div></div>)}
                {owner && <button className="button button--secondary sales-ops__full" type="button" disabled={Boolean(busy)} onClick={() => void operate('identify', () => postSalesBusinessAction(current.id, `contacts/${encodeURIComponent(owner.id)}/identify`, { name: owner.name, roles: owner.roles, isDecisionMaker: true, preferredLanguage: owner.preferredLanguage }, key('identify')), 'Owner identity attested by founder and saved.')}><ShieldCheck size={15} /> Attest owner identity after checking</button>}
                {owner && <p className="sales-ops__caution">Attest only after you have independently confirmed the caller is the decision maker. A phone match alone is not proof.</p>}
              </section>

              <section className="panel sales-ops__card"><div className="sales-ops__card-head"><span><Headphones size={18} /><h3>Call history</h3></span><small>{detail.calls.length} recorded</small></div>
                {detail.calls.length === 0 ? <Empty>No call has been attempted. This page does not create fictitious call records.</Empty> : detail.calls.map((call) => {
                  const duration = typeof call.metadata.durationSeconds === 'number' ? call.metadata.durationSeconds : null;
                  const interactionId = typeof call.metadata.sarvamInteractionId === 'string' ? call.metadata.sarvamInteractionId : null;
                  const variables = call.metadata.finalAgentVariables && typeof call.metadata.finalAgentVariables === 'object' && !Array.isArray(call.metadata.finalAgentVariables)
                    ? call.metadata.finalAgentVariables as Record<string, unknown> : null;
                  return <div className="sales-ops__call" key={call.id}><span className="sales-ops__call-icon">{call.direction === 'INBOUND' ? <PhoneIncoming size={17} /> : <Phone size={17} />}</span><div><strong>{call.direction === 'INBOUND' ? 'Inbound' : 'Outbound'} · {call.status.replaceAll('_', ' ')}</strong><small>{simulatedCallLabel(call)} · {formatSalesTime(call.startedAt ?? call.createdAt)}{duration !== null ? ` · ${Math.round(duration)} sec` : ''}</small>{call.summary && <p>{call.summary}</p>}
                    {(call.transcript || variables || interactionId || call.recordingUrl) && <details className="sales-ops__call-evidence"><summary>Review what the agent did <ChevronRight size={14} /></summary>
                      {call.recordingUrl ? <audio controls preload="none" src={call.recordingUrl}>Your browser cannot play this recording.</audio> : <p className="sales-ops__recording-note"><Headphones size={14} /> Audio is not attached to Sarvam's outbound webhook. Use the interaction ID in Sarvam Call Logs when recording is enabled.</p>}
                      {interactionId && <div className="sales-ops__interaction-id"><span>Sarvam interaction</span><code>{interactionId}</code></div>}
                      {call.transcript && <div className="sales-ops__transcript"><strong>Transcript</strong>{call.transcript.split('\n').map((line, index) => <p key={`${call.id}-turn-${index}`} className={line.startsWith('AGENT:') ? 'is-agent' : 'is-customer'}>{line}</p>)}</div>}
                      {variables && <div className="sales-ops__variables"><strong>Captured outcome</strong>{Object.entries(variables).filter(([, value]) => typeof value === 'string' && value).map(([name, value]) => <span key={name}><small>{salesStateLabel(name)}</small><b>{String(value)}</b></span>)}</div>}
                    </details>}
                  </div><span className="sales-ops__state is-neutral">{call.outcome ? salesStateLabel(call.outcome) : 'No outcome'}</span></div>;
                })}
              </section>

              <section className="panel sales-ops__card"><div className="sales-ops__card-head"><span><CalendarClock size={18} /><h3>Follow-ups</h3></span><small>{detail.followUps.length} records</small></div>
                {detail.followUps.length === 0 ? <Empty>No callback has been scheduled.</Empty> : detail.followUps.map((followUp) => <div className="sales-ops__followup" key={followUp.id}><div><strong>{salesStateLabel(followUp.type)}</strong><small>{followUp.reason}</small></div><span><b>{followUp.status}</b><small>{formatSalesTime(followUp.scheduledAt)}</small></span></div>)}
              </section>
            </div>

            <div className="sales-ops__stack">
              <section className="panel sales-ops__card"><div className="sales-ops__card-head"><span><History size={18} /><h3>Sales memory</h3></span><small>Persisted</small></div>
                {detail.memory ? <><p className="sales-ops__memory-summary">{detail.memory.summary || 'No summary recorded yet.'}</p><div className="sales-ops__keyvals"><div><span>Deal stage</span><strong>{salesStateLabel(detail.memory.dealStage)}</strong></div><div><span>Next action</span><strong>{detail.memory.nextAction ?? 'None scheduled'}</strong></div><div><span>Action due</span><strong>{formatSalesTime(detail.memory.nextActionAt)}</strong></div><div><span>Agreed value</span><strong>{detail.memory.agreedPrice == null ? 'Not agreed' : currency.format(detail.memory.agreedPrice)}</strong></div></div>{detail.memory.objections.length > 0 && <div className="sales-ops__objections"><strong>Objections</strong>{detail.memory.objections.map((item, index) => <span key={`${index}-${item}`}>{item}</span>)}</div>}</> : <Empty>No interaction memory has been stored.</Empty>}
              </section>

              {!realTelephony && <section className="panel sales-ops__card sales-ops__actions"><div className="sales-ops__card-head"><span><ShieldCheck size={18} /><h3>Guided demo actions</h3></span><span className="sales-ops__state is-warning">SIMULATED TELEPHONY</span></div>
                <p className="sales-ops__caution">These controls record a labelled simulation in AgentFront. They do not make a real phone call or speak through ElevenLabs.</p>
                {canHandoff && <form onSubmit={submitHandoff} className="sales-ops__form"><strong>1 · Receptionist → owner handoff</strong><div className="sales-ops__field-pair"><label>Receptionist name<input value={receptionistName} onChange={(event) => setReceptionistName(event.target.value)} placeholder="Optional" /></label><label>Owner name<input required value={ownerName} onChange={(event) => setOwnerName(event.target.value)} placeholder="Decision maker" /></label></div><div className="sales-ops__field-pair"><label>Owner phone<input required type="tel" value={ownerPhone} onChange={(event) => setOwnerPhone(event.target.value)} placeholder="+91…" /></label><label>Callback time<input required type="datetime-local" value={callbackAt} onChange={(event) => setCallbackAt(event.target.value)} /></label></div><label>Handoff summary<textarea required rows={2} value={handoffSummary} onChange={(event) => setHandoffSummary(event.target.value)} /></label><button className="button" type="submit" disabled={Boolean(busy)}>Save receptionist handoff <ArrowRight size={15} /></button></form>}
                {detail.contacts.some((contact) => contact.isDecisionMaker) && <form onSubmit={submitInbound} className="sales-ops__form"><strong>2 · Simulate an inbound callback</strong><label>Caller phone<input required type="tel" value={inboundPhone} onChange={(event) => setInboundPhone(event.target.value)} placeholder="Use the saved owner number" /></label><button className="button button--secondary" type="submit" disabled={Boolean(busy)}><PhoneIncoming size={15} /> Resolve inbound caller</button></form>}
                {canClose && <form onSubmit={submitDeal} className="sales-ops__form"><strong>3 · Record verified deal acceptance</strong><div className="sales-ops__field-pair"><label>Quoted price ₹<input required type="number" min="1" value={quote} onChange={(event) => setQuote(event.target.value)} /></label><label>Agreed price ₹<input required type="number" min="1" value={agreed} onChange={(event) => setAgreed(event.target.value)} /></label></div><label>Pages (comma-separated)<input required value={pages} onChange={(event) => setPages(event.target.value)} /></label><label>Conversation summary<textarea required rows={2} value={dealSummary} onChange={(event) => setDealSummary(event.target.value)} /></label><button className="button" type="submit" disabled={Boolean(busy)}><CheckCircle2 size={15} /> Record deal & generate spec</button></form>}
                {!canHandoff && !canClose && !detail.contacts.some((contact) => contact.isDecisionMaker) && <Empty>Start an outbound demo call to unlock the receptionist handoff.</Empty>}
              </section>}
              {realTelephony && <section className="panel sales-ops__card sales-ops__actions"><div className="sales-ops__card-head"><span><ShieldCheck size={18} /><h3>Sarvam-controlled outcome</h3></span><span className="sales-ops__state is-success">REAL TELEPHONY</span></div><p className="sales-ops__caution">The call transcript, outcome and post-interaction variables arrive through the correlated Sarvam webhook. A validated WON result automatically queues Claude customization; no manual deal shortcut is used.</p></section>}

              <section className="panel sales-ops__card"><div className="sales-ops__card-head"><span><FileJson2 size={18} /><h3>Delivery specification</h3></span><small>Backend generated</small></div>{detail.projectSpec ? <div className="sales-ops__spec"><span className="sales-ops__state is-success">{detail.projectSpec.status}</span><strong>project_spec.json · v{detail.projectSpec.version}</strong><p>{detail.projectSpec.specification.requirements.pages.join(' · ')}</p><small>{formatSalesTime(detail.projectSpec.createdAt)} · {detail.projectSpec.specification.commercial.agreedPrice == null ? 'Price pending' : currency.format(detail.projectSpec.specification.commercial.agreedPrice)}</small><a href={`/api/sales/businesses/${encodeURIComponent(current.id)}/project_spec.json`} target="_blank" rel="noreferrer">View structured spec <ChevronRight size={15} /></a></div> : <Empty>Generated only after a verified decision maker accepts a governed quote.</Empty>}</section>
            </div>
          </div>

          <section className="panel sales-ops__card sales-ops__timeline"><div className="sales-ops__card-head"><span><Clock3 size={18} /><h3>Activity timeline</h3></span><small>{detail.events.length} recorded events</small></div>{salesTimeline(detail).length === 0 ? <Empty>No sales events recorded yet.</Empty> : <div className="sales-ops__timeline-list">{salesTimeline(detail).map((event) => <div key={event.id}><span className="sales-ops__timeline-dot" /><div><strong>{salesStateLabel(event.eventType)}</strong><small>{formatSalesTime(event.timestamp)}</small><p>{Object.entries(event.metadata).filter(([name, value]) => ['from', 'to', 'actor', 'scheduledAt', 'agreedPrice', 'providerMode'].includes(name) && (typeof value === 'string' || typeof value === 'number')).map(([name, value]) => `${salesStateLabel(name)}: ${value}`).join(' · ') || 'Persisted orchestration event'}</p></div></div>)}</div>}</section>
          <section className="sales-ops__danger"><div><ShieldAlert size={18} /><span><strong>Do not contact</strong><small>Stops future outreach and cancels scheduled follow-ups.</small></span></div><button className="button button--danger" type="button" disabled={Boolean(busy) || current.salesState === 'DO_NOT_CONTACT'} onClick={() => { if (window.confirm(`Mark ${current.name} as do not contact? This cancels scheduled follow-ups.`)) void operate('dnc', () => postSalesBusinessAction(current.id, 'do-not-contact', { reason: 'Founder marked business as do not contact.' }, key('dnc')), 'Do-not-contact saved. Scheduled follow-ups cancelled.'); }}>Mark DNC</button></section>
        </>}
      </div>
    </div>
  </div>;
}
