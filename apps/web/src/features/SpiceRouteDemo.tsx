import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, BadgeCheck, CheckCircle2, Cloud, Coffee, CreditCard, ExternalLink, Headphones, LoaderCircle, LockKeyhole, MapPin, RefreshCw, ShieldCheck, Sparkles, TerminalSquare, TriangleAlert } from 'lucide-react';
import {
  createSpiceRouteTestCheckout,
  getSpiceRoutePaymentStatus,
  validateDodoTestCheckoutUrl,
  type ApiConnectionState,
  type IntegrationHealth,
  type PipelineAggregate,
  type SpiceRoutePaymentStatus,
} from '../api';
import type { ActivityEvent, ViewKey } from '../types';
import { SpiceRouteAdPreview } from './SpiceRouteAdPreview';
import './SpiceRouteDemo.css';

type Props = {
  apiStatus: ApiConnectionState;
  pipelineStep: number;
  providerHealth: IntegrationHealth[];
  activityEvents: ActivityEvent[];
  dashboardLeads: PipelineAggregate[];
  onStart: () => void;
  onNavigate: (view: ViewKey) => void;
};

const statusFor = (items: IntegrationHealth[], key: IntegrationHealth['integration']) => items.find((item) => item.integration === key);

const paymentStateCopy: Record<SpiceRoutePaymentStatus['status'], { label: string; detail: string; tone: string }> = {
  NOT_STARTED: { label: 'Not started', detail: 'No Dodo test checkout has been persisted.', tone: 'neutral' },
  CHECKOUT_PENDING: { label: 'Creating checkout', detail: 'A checkout reservation is in progress. Refresh before retrying.', tone: 'warning' },
  CHECKOUT_READY: { label: 'Test checkout ready', detail: 'The Dodo link is ready; payment is still unverified.', tone: 'ready' },
  TEST_PAID: { label: 'Test payment verified', detail: 'A signed Dodo webhook was matched to the stored checkout.', tone: 'success' },
};

const paymentTime = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatPaymentTime(value: string | null): string {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'Invalid timestamp' : paymentTime.format(date);
}

function identityFingerprint(email: string, name: string): string {
  return `${email.trim().toLowerCase()}\u0000${name.trim()}`;
}

function newCheckoutAttemptSeed(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID().replaceAll('-', '');
  const bytes = crypto.getRandomValues(new Uint32Array(4));
  return Array.from(bytes, (value) => value.toString(16).padStart(8, '0')).join('');
}

function realDeploymentUrl(deployment: PipelineAggregate['deployment']): string | undefined {
  if (deployment?.providerMode !== 'REAL' || deployment.status !== 'DEPLOYED') return undefined;
  try {
    const url = new URL(deployment.url);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function SpiceRouteCheckout({
  apiStatus,
  verifiedSiteUrl,
  crm,
}: {
  apiStatus: ApiConnectionState;
  verifiedSiteUrl?: string;
  crm?: IntegrationHealth;
}) {
  const [payment, setPayment] = useState<SpiceRoutePaymentStatus | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [checkoutNotice, setCheckoutNotice] = useState<string | null>(null);
  const [createdCheckoutUrl, setCreatedCheckoutUrl] = useState<string | null>(null);
  const [attemptSeed] = useState(newCheckoutAttemptSeed);
  const [identity, setIdentity] = useState({ email: '', name: '', revision: 0 });

  const refreshPayment = useCallback(async (quiet = false): Promise<SpiceRoutePaymentStatus | null> => {
    if (apiStatus !== 'connected') {
      setPayment(null);
      setPaymentError(null);
      setPaymentLoading(false);
      return null;
    }
    if (!quiet) setPaymentLoading(true);
    try {
      const latest = await getSpiceRoutePaymentStatus();
      setPayment(latest);
      setPaymentError(null);
      return latest;
    } catch (cause) {
      setPaymentError(cause instanceof Error ? cause.message : 'Payment status could not be loaded.');
      return null;
    } finally {
      if (!quiet) setPaymentLoading(false);
    }
  }, [apiStatus]);

  useEffect(() => {
    if (apiStatus !== 'connected') return;
    const initial = window.setTimeout(() => void refreshPayment(), 0);
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshPayment(true);
    };
    const timer = window.setInterval(refreshWhenVisible, 8_000);
    window.addEventListener('focus', refreshWhenVisible);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshWhenVisible);
    };
  }, [apiStatus, refreshPayment]);

  const checkoutUrl = payment?.checkoutUrl ?? createdCheckoutUrl;
  const paymentCopy = payment ? paymentStateCopy[payment.status] : null;
  const apiReady = apiStatus === 'connected';
  const deploymentReady = Boolean(verifiedSiteUrl);
  const dodoReady = payment?.configured === true;
  const paymentRecorded = payment?.status === 'TEST_PAID';
  const checkoutPending = payment?.status === 'CHECKOUT_PENDING';
  const checkoutBlocked = !apiReady || !deploymentReady || !dodoReady || paymentLoading || Boolean(paymentError) || checkoutPending || paymentRecorded || checkoutBusy;
  const attemptKey = `spiceroute_${attemptSeed}_${identity.revision}`;

  const updateIdentity = (field: 'email' | 'name', value: string) => {
    setIdentity((current) => {
      const next = { ...current, [field]: value };
      const changed = identityFingerprint(next.email, next.name) !== identityFingerprint(current.email, current.name);
      return { ...next, revision: changed ? current.revision + 1 : current.revision };
    });
    setCheckoutError(null);
    setCheckoutNotice(null);
  };

  const openCheckout = (candidate: string | null) => {
    try {
      const verifiedUrl = validateDodoTestCheckoutUrl(candidate);
      window.open(verifiedUrl, '_blank', 'noopener,noreferrer');
      setCheckoutNotice('Dodo TEST checkout opened. If the new tab was blocked, use the verified link below.');
      setCheckoutError(null);
    } catch (cause) {
      setCheckoutError(cause instanceof Error ? cause.message : 'The checkout URL was rejected.');
    }
  };

  const submitCheckout = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (checkoutUrl) {
      if (!checkoutBlocked) openCheckout(checkoutUrl);
      return;
    }
    if (!apiReady) {
      setCheckoutError('Connect the AgentFront API before creating a checkout.');
      return;
    }
    if (!deploymentReady) {
      setCheckoutError('A real DEPLOYED provider URL is required before checkout.');
      return;
    }
    if (!dodoReady) {
      setCheckoutError('Dodo test mode and durable payment persistence must be configured first.');
      return;
    }
    if (checkoutPending || paymentRecorded) return;

    setCheckoutBusy(true);
    setCheckoutError(null);
    setCheckoutNotice(null);
    try {
      const session = await createSpiceRouteTestCheckout({
        email: identity.email.trim().toLowerCase(),
        ...(identity.name.trim() ? { name: identity.name.trim() } : {}),
        idempotencyKey: attemptKey,
      });
      // The API client already validates this, and the immediate second check
      // keeps the navigation boundary visibly local to the action that opens it.
      const verifiedUrl = validateDodoTestCheckoutUrl(session.checkoutUrl);
      setCreatedCheckoutUrl(verifiedUrl);
      openCheckout(verifiedUrl);
      await refreshPayment(true);
    } catch (cause) {
      setCheckoutError(cause instanceof Error ? cause.message : 'Dodo test checkout could not be created.');
    } finally {
      setCheckoutBusy(false);
    }
  };

  const crmState = payment?.crmSyncedAt
    ? { label: 'Freshworks synced', detail: formatPaymentTime(payment.crmSyncedAt), tone: 'success' }
    : payment?.status !== 'TEST_PAID'
      ? { label: 'Waiting for verified payment', detail: 'CRM sync does not start from a checkout redirect.', tone: 'neutral' }
      : payment.crmLastError
        ? { label: 'Freshworks retry queued', detail: payment.crmLastError, tone: 'warning' }
        : crm?.mode === 'REAL' && crm.status === 'CONNECTED'
          ? { label: 'Freshworks sync pending', detail: 'The worker will write the verified payment milestone.', tone: 'ready' }
          : { label: 'Freshworks unavailable', detail: 'Payment is recorded; CRM provider health is not connected.', tone: 'warning' };

  const unavailableReason = !apiReady
    ? apiStatus === 'connecting' ? 'Waiting for the AgentFront API.' : 'The AgentFront API is offline.'
    : !deploymentReady
      ? 'Complete a real provider deployment before checkout.'
      : paymentLoading
        ? 'Checking the persisted payment record.'
        : paymentError
          ? 'Payment status must be readable before checkout.'
          : !dodoReady
            ? 'Dodo TEST credentials, webhook secret and durable database are not configured.'
            : checkoutPending
              ? 'A checkout reservation is already being created.'
              : paymentRecorded
                ? 'This demo payment has already been verified.'
                : null;

  return <section className="panel spice-demo__checkout" aria-labelledby="spice-payment-title">
    <div className="spice-demo__checkout-head">
      <div><span className="spice-demo__test-label"><CreditCard size={15} /> Dodo Payments · TEST MODE</span><h2 id="spice-payment-title">Deliver the site, then verify the test payment.</h2><p>The checkout is available only after AgentFront sees a real deployment. Product, price and project identity stay locked on the server.</p></div>
      <span className={`spice-demo__payment-pill is-${paymentCopy?.tone ?? 'neutral'}`}><span aria-hidden="true" />{paymentLoading ? 'Checking status' : paymentCopy?.label ?? (apiReady ? 'Status unavailable' : 'API offline')}</span>
    </div>

    <div className="spice-demo__checkout-gates" aria-label="Checkout prerequisites">
      <div className={apiReady ? 'is-ready' : 'is-blocked'}><span>01</span><div><strong>AgentFront API</strong><small>{apiReady ? 'Connected' : apiStatus === 'connecting' ? 'Connecting' : 'Offline'}</small></div>{apiReady ? <CheckCircle2 size={17} /> : <TriangleAlert size={17} />}</div>
      <div className={deploymentReady ? 'is-ready' : 'is-blocked'}><span>02</span><div><strong>Real deployment</strong><small>{deploymentReady ? 'DEPLOYED URL verified' : 'Provider release required'}</small></div>{deploymentReady ? <CheckCircle2 size={17} /> : <TriangleAlert size={17} />}</div>
      <div className={dodoReady && !paymentError ? 'is-ready' : 'is-blocked'}><span>03</span><div><strong>Dodo test rail</strong><small>{paymentLoading ? 'Checking configuration' : paymentError ? 'Status check failed' : dodoReady ? 'Configured · no live charge' : 'Not configured'}</small></div>{paymentLoading ? <LoaderCircle className="is-spinning" size={17} /> : dodoReady && !paymentError ? <CheckCircle2 size={17} /> : <TriangleAlert size={17} />}</div>
    </div>

    <div className="spice-demo__checkout-layout">
      <form className="spice-demo__checkout-form" onSubmit={(event) => void submitCheckout(event)}>
        <div className="spice-demo__form-heading"><span><LockKeyhole size={18} /></span><div><h3>Customer checkout identity</h3><p>Changing either field generates a new request key. Retrying unchanged details safely reuses the same key.</p></div></div>
        <label>Customer name <span>optional</span><input name="name" autoComplete="name" maxLength={120} value={identity.name} onChange={(event) => updateIdentity('name', event.target.value)} placeholder="SpiceRoute owner" /></label>
        <label>Email for checkout <input required name="email" type="email" autoComplete="email" maxLength={254} value={identity.email} onChange={(event) => updateIdentity('email', event.target.value)} placeholder="owner@spiceroute.example" /></label>
        <p className="spice-demo__checkout-note"><ShieldCheck size={15} /> TEST checkout only. No live revenue is counted and the browser cannot choose a different product or amount.</p>
        {checkoutUrl ? <button className="button" type="button" disabled={checkoutBlocked} onClick={() => openCheckout(checkoutUrl)}>Open Dodo TEST checkout <ExternalLink size={16} /></button> : <button className="button" type="submit" disabled={checkoutBlocked}>{checkoutBusy ? <><LoaderCircle className="is-spinning" size={16} /> Creating secure test checkout…</> : <>Create Dodo TEST checkout <ArrowRight size={16} /></>}</button>}
        {unavailableReason && <p className="spice-demo__blocked"><TriangleAlert size={15} /> {unavailableReason}</p>}
        {checkoutError && <p className="spice-demo__checkout-feedback is-error" role="alert"><TriangleAlert size={15} /> {checkoutError}</p>}
        {checkoutNotice && <p className="spice-demo__checkout-feedback is-success" role="status"><CheckCircle2 size={15} /> {checkoutNotice}</p>}
        {checkoutUrl && !checkoutBlocked && <a className="spice-demo__verified-link" href={checkoutUrl} target="_blank" rel="noopener noreferrer">test.checkout.dodopayments.com <ExternalLink size={14} /></a>}
      </form>

      <div className="spice-demo__payment-ledger" aria-live="polite">
        <div className="spice-demo__ledger-head"><div><span className="panel-label">Persisted delivery record</span><h3>Payment + CRM state</h3></div><button type="button" disabled={!apiReady || paymentLoading} onClick={() => void refreshPayment()} aria-label="Refresh payment status"><RefreshCw className={paymentLoading ? 'is-spinning' : ''} size={16} /> Refresh</button></div>
        {paymentError && <p className="spice-demo__status-error"><TriangleAlert size={15} /> {paymentError}</p>}
        <div className="spice-demo__status-track">
          <div className={`is-${paymentCopy?.tone ?? 'neutral'}`}><span className="spice-demo__status-icon"><CreditCard size={17} /></span><div><small>Dodo TEST payment</small><strong>{paymentCopy?.label ?? 'No readable record'}</strong><p>{paymentCopy?.detail ?? 'Connect the API to load the durable status.'}</p></div></div>
          <div className={paymentRecorded ? 'is-success' : 'is-neutral'}><span className="spice-demo__status-icon"><BadgeCheck size={17} /></span><div><small>Webhook authority</small><strong>{paymentRecorded ? 'Signature verified + matched' : 'Awaiting signed webhook'}</strong><p>{paymentRecorded ? `${payment?.paymentId ?? 'Payment recorded'} · ${formatPaymentTime(payment?.paidAt ?? null)}` : 'Opening or returning from checkout never marks this record paid.'}</p></div></div>
          <div className={`is-${crmState.tone}`}><span className="spice-demo__status-icon"><Cloud size={17} /></span><div><small>Freshworks milestone</small><strong>{crmState.label}</strong><p>{crmState.detail}</p></div></div>
        </div>
        {payment?.checkoutSessionId && <div className="spice-demo__session-id"><span>Checkout session</span><code>{payment.checkoutSessionId}</code></div>}
        <div className="spice-demo__webhook-rule"><LockKeyhole size={17} /><p><strong>Webhook-only truth.</strong> This screen polls <code>GET /api/demo/spiceroute/payment</code>. It never reads a return URL or checkout redirect as proof of payment.</p></div>
      </div>
    </div>
  </section>;
}

export function SpiceRouteDemo({ apiStatus, pipelineStep, providerHealth, activityEvents, dashboardLeads, onStart, onNavigate }: Props) {
  const spiceLead = dashboardLeads
    .filter((item) => item.lead.businessId === 'business-spiceroute' || item.business?.name === 'SpiceRoute Kitchen')
    .sort((left, right) => {
      const leftSalesSpec = left.lead.campaignId.startsWith('sales-spec-') ? 1 : 0;
      const rightSalesSpec = right.lead.campaignId.startsWith('sales-spec-') ? 1 : 0;
      if (leftSalesSpec !== rightSalesSpec) return rightSalesSpec - leftSalesSpec;
      return String(right.lead.updatedAt ?? '').localeCompare(String(left.lead.updatedAt ?? ''));
    })[0];
  const deployment = spiceLead?.deployment;
  const verifiedSiteUrl = realDeploymentUrl(deployment);
  const crm = statusFor(providerHealth, 'crm');
  const conversation = statusFor(providerHealth, 'conversation');
  const telephony = statusFor(providerHealth, 'telephony');
  const developer = statusFor(providerHealth, 'developer');
  const release = statusFor(providerHealth, 'deployment');
  const relatedEvents = apiStatus === 'connected'
    ? activityEvents.filter((item) => item.projectId === spiceLead?.lead.projectId || item.leadId === spiceLead?.lead.id).slice(0, 6)
    : [];
  const milestones = [
    { Icon: MapPin, number: '01', title: 'Discover', state: pipelineStep >= 1 ? 'Indexed' : 'Waiting', description: 'SpiceRoute Kitchen is the one consented demo business.', action: 'View discovery', view: 'discover' as ViewKey },
    { Icon: Headphones, number: '02', title: 'Sell', state: pipelineStep >= 6 ? 'Deal captured' : pipelineStep >= 4 ? 'Conversation ready' : 'Waiting', description: conversation?.mode === 'REAL' ? 'Browser ElevenLabs conversation; actual phone ringing needs a telephony bridge.' : 'The sales conversation is a labelled demo until ElevenLabs is connected.', action: 'Open sales room', view: 'sales' as ViewKey },
    { Icon: ShieldCheck, number: '03', title: 'Record in CRM', state: crm?.mode === 'REAL' && crm.status === 'CONNECTED' ? 'Freshworks connected' : 'Demo / unavailable', description: 'Business milestones should be inspected in Freshworks, not inferred from a seed.', action: 'Inspect CRM', view: 'crm' as ViewKey },
    { Icon: TerminalSquare, number: '04', title: 'Adapt & build', state: pipelineStep >= 9 ? 'QA complete' : pipelineStep >= 7 ? 'Building' : 'Waiting', description: `Existing restaurant template only. ${developer?.mode === 'REAL' && developer.status === 'CONNECTED' ? 'Codex CLI is configured.' : 'The developer adapter is not verified as live.'}`, action: 'Inspect pipeline', view: 'pipeline' as ViewKey },
    { Icon: Cloud, number: '05', title: 'Deploy & deliver', state: verifiedSiteUrl ? 'Vercel URL recorded' : deployment ? 'Demo release only' : 'Waiting', description: verifiedSiteUrl ? 'A real provider URL is recorded; customer delivery and payment remain separate steps.' : 'A bundled example is not a deployed production URL.', action: 'Inspect release', view: 'deployments' as ViewKey },
  ];

  return <div className="page spice-demo">
    <section className="spice-demo__hero panel">
      <div className="spice-demo__hero-copy"><span className="spice-demo__eyebrow"><Sparkles size={15} /> One-business hackathon run</span><h1>SpiceRoute Kitchen.<br /><em>One complete story.</em></h1><p>Show a consented sales conversation, Freshworks milestones, bounded restaurant-template changes, a verified release, test checkout and ad creative—without presenting a preview as a live customer outcome.</p><div className="spice-demo__hero-actions"><button className="button" type="button" disabled={apiStatus !== 'connected'} onClick={pipelineStep <= 1 ? onStart : () => onNavigate('pipeline')}>{pipelineStep <= 1 ? 'Start SpiceRoute flow' : 'Inspect live pipeline'} <ArrowRight size={16} /></button><button className="button button--secondary" type="button" onClick={() => onNavigate('sales')}>Open sales room</button></div></div>
      <div className="spice-demo__hero-art" aria-hidden="true"><div className="spice-demo__plate"><Coffee size={48} /></div><span className="spice-demo__orbit spice-demo__orbit--one" /><span className="spice-demo__orbit spice-demo__orbit--two" /><span className="spice-demo__art-label">Chennai / Sholinganallur<br />Restaurant template</span></div>
    </section>

    <div className="spice-demo__truth"><span><CheckCircle2 size={16} /> Five bounded product roles</span><span>Phone bridge: {telephony?.mode === 'REAL' && telephony.status === 'CONNECTED' ? 'provider connected' : 'not verified—use browser conversation'}</span><span>Ad placement: preview only</span></div>

    <section className="spice-demo__journey" aria-labelledby="spice-demo-stages"><div className="spice-demo__section-head"><div><span className="panel-label">The panelist's path</span><h2 id="spice-demo-stages">Follow the real evidence.</h2></div><p>Each step opens its source-of-record screen. Status labels come from the API and reported provider health.</p></div><div className="spice-demo__steps">{milestones.map(({ Icon, number, title, state, description, action, view }) => <article className="panel spice-demo__step" key={number}><div className="spice-demo__step-head"><span>{number}</span><Icon size={21} /></div><h3>{title}</h3><strong>{apiStatus === 'connected' ? state : 'API offline'}</strong><p>{description}</p><button type="button" onClick={() => onNavigate(view)}>{action} <ArrowRight size={15} /></button></article>)}</div></section>

    <div className="spice-demo__proof-grid"><section className="panel spice-demo__release"><span className="panel-label">Client delivery</span><h2>{verifiedSiteUrl ? 'A verified site URL is ready.' : 'The website still needs a verified release.'}</h2><p>{verifiedSiteUrl ? 'Open the Vercel URL recorded by the deployment provider. Sharing it with the customer is a distinct delivery action.' : 'The existing bundled SpiceRoute example is useful for visual review, but it is not proof of a new Vercel deployment.'}</p>{verifiedSiteUrl ? <a href={verifiedSiteUrl} target="_blank" rel="noopener noreferrer">Open deployed website <ExternalLink size={16} /></a> : <button type="button" onClick={() => onNavigate('deployments')}>Inspect deployment record <ArrowRight size={16} /></button>}<div><span>Deployment adapter</span><strong>{release ? `${release.mode} · ${release.status}` : 'Not reported'}</strong></div></section><section className="panel spice-demo__ledger"><span className="panel-label">SpiceRoute event trail</span><h2>{apiStatus === 'connected' ? 'Latest recorded actions' : 'Connect the API for recorded actions'}</h2>{relatedEvents.length ? <div>{relatedEvents.map((event) => <p key={event.id}><span>{event.agent}</span><strong>{event.message}</strong></p>)}</div> : <p className="spice-demo__empty">No correlated SpiceRoute events are available yet. Demo previews do not create evidence.</p>}<button type="button" onClick={() => onNavigate('activity')}>View full ledger <ArrowRight size={15} /></button></section></div>

    <SpiceRouteCheckout apiStatus={apiStatus} verifiedSiteUrl={verifiedSiteUrl} crm={crm} />

    <SpiceRouteAdPreview siteUrl={verifiedSiteUrl} />
  </div>;
}
