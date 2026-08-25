import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  Bot,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  Cloud,
  Coffee,
  Command,
  Copy,
  Database,
  ExternalLink,
  FileCode2,
  Filter,
  Gauge,
  Globe2,
  Headphones,
  HeartPulse,
  IndianRupee,
  Layers3,
  LayoutDashboard,
  ListFilter,
  Map,
  MapPin,
  Menu,
  Mic2,
  Moon,
  MoreHorizontal,
  Octagon,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Phone,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  Store,
  Sun,
  Target,
  TerminalSquare,
  TrendingUp,
  UploadCloud,
  WandSparkles,
  Wifi,
  X,
  XCircle,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import {
  activitySeed,
  agentRows,
  businesses,
  funnel,
  pipelineBlueprint,
  revenueSeries,
  spiceRoute,
  transcriptSeed,
} from './data/demo';
import {
  dashboardProjection,
  discoverMarket,
  getCRMBoard,
  getAuthSession,
  getDashboard,
  getIntegrationHealth,
  loginWithToken,
  mapAgentEvent,
  mapDiscoveredBusinesses,
  mergeActivityEvents,
  pipelineStepForState,
  startPipelineRun,
  subscribeToAgentEvents,
  updateCampaign,
  type ApiConnectionState,
  type AuthSession,
  type DashboardMetrics,
  type PipelineAggregate,
  type CRMBoardSnapshot,
  type DiscoveryMeta,
  type IntegrationHealth,
  type PersistenceHealth,
} from './api';
import { OpenStreetMapBusinessMap } from './OpenStreetMapBusinessMap';
import { LiveElevenLabsConversation } from './LiveElevenLabsConversation';
import type { ActivityEvent, AppState, Business, PipelineStage, ViewKey } from './types';

const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const navigation: { label: string; items: { id: ViewKey; label: string; icon: LucideIcon; badge?: string }[] }[] = [
  {
    label: 'Command',
    items: [
      { id: 'overview', label: 'Overview', icon: LayoutDashboard },
      { id: 'discover', label: 'Discover', icon: Map, badge: '32' },
      { id: 'leads', label: 'Leads', icon: Target, badge: '186' },
      { id: 'pipeline', label: 'Pipeline', icon: Layers3 },
      { id: 'sales', label: 'Live sales room', icon: Headphones, badge: 'LIVE' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { id: 'crm', label: 'CRM', icon: Building2 },
      { id: 'campaigns', label: 'Campaigns', icon: BriefcaseBusiness },
      { id: 'projects', label: 'Projects', icon: FileCode2, badge: '4' },
      { id: 'deployments', label: 'Deployments', icon: Cloud },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { id: 'agents', label: 'Agents', icon: Bot },
      { id: 'analytics', label: 'Analytics', icon: BarChart3 },
      { id: 'activity', label: 'Activity & logs', icon: Activity },
    ],
  },
];

const validViews = new Set<ViewKey>([
  'overview', 'discover', 'leads', 'pipeline', 'sales', 'crm', 'campaigns',
  'projects', 'deployments', 'agents', 'analytics', 'activity', 'settings',
]);

function hashView(): ViewKey {
  const candidate = window.location.hash.replace(/^#\/?/, '') as ViewKey;
  return validViews.has(candidate) ? candidate : 'overview';
}

const stageEvents = [
  ['Discovery Agent', 'SpiceRoute Kitchen indexed from demo market data.'],
  ['Qualification Agent', 'Opportunity score 91/100 exceeds campaign threshold.'],
  ['CRM Agent', 'Account, contact and deal created idempotently.'],
  ['Sales Agent', 'Realtime owner conversation completed in 4m 31s.'],
  ['Specification Agent', 'Menu, gallery, WhatsApp and Maps requirements collected.'],
  ['Negotiation Agent', 'Final offer ₹7,200 accepted within policy.'],
  ['Orchestrator', 'project_spec.json generated and schema validated.'],
  ['Developer Agent', 'Restaurant v1 customization completed.'],
  ['QA Engine', 'Production checks passed with score 96/100.'],
  ['Deployment', 'Website deployed and CRM lifecycle updated.'],
] as const;

function usePersistentState() {
  const fallback: AppState = {
    campaignStatus: 'running',
    pipelineStep: 1,
    selectedBusinessId: spiceRoute.id,
    theme: 'dark',
    autoAdvance: false,
  };
  const [state, setState] = useState<AppState>(() => {
    try {
      const raw = localStorage.getItem('agentfront-demo-state-v2');
      return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    localStorage.setItem('agentfront-demo-state-v2', JSON.stringify(state));
  }, [state]);
  return [state, setState] as const;
}

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

function isConnectivityFailure(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message : '';
  return /failed to fetch|network|load failed|aborted/i.test(message);
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={classNames('brand', compact && 'brand--compact')}>
      <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
      {!compact && <span className="brand-word">Agent<span>Front</span></span>}
    </div>
  );
}

function Dot({ tone = 'green', pulse = false }: { tone?: 'green' | 'amber' | 'red' | 'blue' | 'muted'; pulse?: boolean }) {
  return <span className={classNames('dot', `dot--${tone}`, pulse && 'dot--pulse')} />;
}

function Pill({ children, tone = 'neutral', icon }: { children: ReactNode; tone?: string; icon?: ReactNode }) {
  return <span className={classNames('pill', `pill--${tone}`)}>{icon}{children}</span>;
}

function IconButton({ label, children, onClick, active = false }: { label: string; children: ReactNode; onClick?: () => void; active?: boolean }) {
  return <button className={classNames('icon-button', active && 'is-active')} type="button" onClick={onClick} aria-label={label} title={label}>{children}</button>;
}

function Button({ children, tone = 'primary', icon, onClick, disabled, type = 'button', className }: {
  children: ReactNode;
  tone?: 'primary' | 'secondary' | 'danger' | 'ghost';
  icon?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
}) {
  return <button className={classNames('button', `button--${tone}`, className)} type={type} onClick={onClick} disabled={disabled}>{icon}{children}</button>;
}

function SectionHeading({ eyebrow, title, copy, action }: { eyebrow?: string; title: string; copy?: string; action?: ReactNode }) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {copy && <p>{copy}</p>}
      </div>
      {action && <div className="section-heading__action">{action}</div>}
    </div>
  );
}

function ScoreRing({ value, size = 72 }: { value: number; size?: number }) {
  const r = 24;
  const circumference = 2 * Math.PI * r;
  return (
    <div className="score-ring" style={{ width: size, height: size }}>
      <svg viewBox="0 0 58 58" role="img" aria-label={`Opportunity score ${value} out of 100`}>
        <circle className="score-ring__track" cx="29" cy="29" r={r} />
        <circle className="score-ring__value" cx="29" cy="29" r={r} strokeDasharray={circumference} strokeDashoffset={circumference * (1 - value / 100)} />
      </svg>
      <strong>{value}</strong>
    </div>
  );
}

function Sparkline({ values = revenueSeries }: { values?: number[] }) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const points = values.map((value, i) => `${(i / (values.length - 1)) * 100},${38 - ((value - min) / (max - min || 1)) * 32}`).join(' ');
  return (
    <svg className="sparkline" viewBox="0 0 100 42" preserveAspectRatio="none" aria-hidden="true">
      <polyline className="sparkline__area" points={`0,42 ${points} 100,42`} />
      <polyline className="sparkline__line" points={points} />
    </svg>
  );
}

function Avatar({ name, tone = 0 }: { name: string; tone?: number }) {
  const initials = name.split(' ').slice(0, 2).map((part) => part[0]).join('');
  return <span className={`avatar avatar--${tone % 5}`}>{initials}</span>;
}

const activityTone = (status: ActivityEvent['status']): 'success' | 'warning' | 'info' | 'neutral' =>
  status === 'SUCCESS' ? 'success' : status === 'ERROR' || status === 'WARNING' ? 'warning' : status === 'INFO' ? 'info' : 'neutral';

function formatEventTime(createdAt: string, includeDate = false): string {
  const value = new Date(createdAt);
  if (Number.isNaN(value.getTime())) return createdAt || 'Timestamp unavailable';
  return new Intl.DateTimeFormat('en-GB', {
    ...(includeDate ? { year: 'numeric', month: '2-digit', day: '2-digit' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  }).format(value);
}

function ActivityList({ events, compact = false }: { events: ActivityEvent[]; compact?: boolean }) {
  return (
    <div className={classNames('activity-list', compact && 'activity-list--compact')}>
      {events.map((event) => (
        <div className="activity-item" key={event.id}>
          <div className={classNames('activity-icon', `activity-icon--${activityTone(event.status)}`)}>
            {event.status === 'SUCCESS' ? <Check size={14} /> : event.status === 'ERROR' || event.status === 'WARNING' ? <AlertTriangle size={14} /> : <Zap size={14} />}
          </div>
          <div className="activity-item__copy">
            <div><strong>{event.agent}</strong>{event.projectId && <code>{event.projectId}</code>}</div>
            <p>{event.message}</p>
          </div>
          <time dateTime={event.createdAt}>{formatEventTime(event.createdAt)}</time>
        </div>
      ))}
    </div>
  );
}

function FounderLogin({ submitting, error, onLogin }: {
  submitting: boolean;
  error: string | null;
  onLogin: (token: string) => Promise<void>;
}) {
  const [token, setToken] = useState('');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const provided = token.trim();
    if (!provided || submitting) return;
    void onLogin(provided).then(() => setToken(''));
  };
  return (
    <main className="auth-gate">
      <section className="auth-card panel" aria-labelledby="founder-login-title">
        <BrandMark />
        <div className="auth-card__icon"><ShieldCheck size={24} /></div>
        <div><span className="eyebrow">Founder access</span><h1 id="founder-login-title">Open the control center</h1><p>Enter the server-configured AgentFront access token. It is exchanged for an HttpOnly session and is never stored in browser storage.</p></div>
        <form onSubmit={submit}>
          <label><span>Access token</span><input type="password" autoComplete="current-password" value={token} onChange={(event) => setToken(event.target.value)} autoFocus /></label>
          {error && <p className="auth-card__error" role="alert"><AlertTriangle size={15} /> {error}</p>}
          <Button type="submit" disabled={submitting || token.trim().length === 0} icon={submitting ? <RefreshCw size={16} /> : <ArrowRight size={16} />}>{submitting ? 'Authenticating' : 'Continue securely'}</Button>
        </form>
        <small>For local credential-free demo mode, leave <code>AGENTFRONT_API_TOKEN</code> blank and bind the API to loopback.</small>
      </section>
    </main>
  );
}

function App() {
  const [state, setState] = usePersistentState();
  const [view, setView] = useState<ViewKey>(hashView);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [intelligenceOpen, setIntelligenceOpen] = useState(false);
  const [selectedBusinessId, setSelectedBusinessId] = useState(state.selectedBusinessId);
  const [marketBusinesses, setMarketBusinesses] = useState<Business[]>(businesses);
  const [selectedStage, setSelectedStage] = useState(Math.min(state.pipelineStep, 9));
  const [toast, setToast] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState<ApiConnectionState>('connecting');
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [providerHealth, setProviderHealth] = useState<IntegrationHealth[]>([]);
  const [persistenceHealth, setPersistenceHealth] = useState<PersistenceHealth | null>(null);
  const [dashboardMetrics, setDashboardMetrics] = useState<DashboardMetrics | null>(null);
  const [dashboardLeads, setDashboardLeads] = useState<PipelineAggregate[]>([]);
  const [liveEvents, setLiveEvents] = useState<ActivityEvent[]>([]);
  const [activeLeadId, setActiveLeadId] = useState('lead-AF-2026-000001');
  const [activeProjectId, setActiveProjectId] = useState('AF-2026-000001');
  const [deploymentUrl, setDeploymentUrl] = useState<string | null>(null);
  const previousStep = useRef(state.pipelineStep);

  const selectedBusiness = marketBusinesses.find((business) => business.id === selectedBusinessId) ?? spiceRoute;
  const realConversationMode = providerHealth.some(
    (provider) => provider.integration === 'conversation' && provider.mode === 'REAL',
  );
  const persistenceBlocked = persistenceHealth?.durable === true && persistenceHealth.status === 'DEGRADED';

  const applyDashboard = useCallback((snapshot: Awaited<ReturnType<typeof getDashboard>>) => {
    const projection = dashboardProjection(snapshot);
    setDashboardMetrics(projection.metrics);
    setDashboardLeads(snapshot.leads ?? []);
    setLiveEvents(projection.events);
    if (projection.activeLeadId) setActiveLeadId(projection.activeLeadId);
    if (projection.activeProjectId) setActiveProjectId(projection.activeProjectId);
    if (projection.activeBusinessId) {
      setSelectedBusinessId(projection.activeBusinessId);
      setState((current) => ({ ...current, selectedBusinessId: projection.activeBusinessId! }));
    }
    setDeploymentUrl(projection.deploymentUrl);
    setState((current) => ({
      ...current,
      pipelineStep: projection.pipelineStep,
      campaignStatus: projection.campaignStatus ?? current.campaignStatus,
      autoAdvance: false,
    }));
    setSelectedStage(Math.min(projection.pipelineStep, 9));
  }, [setState]);

  useEffect(() => {
    document.documentElement.dataset.theme = state.theme;
  }, [state.theme]);

  useEffect(() => {
    const handleHashChange = () => setView(hashView());
    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener('popstate', handleHashChange);
    return () => {
      window.removeEventListener('hashchange', handleHashChange);
      window.removeEventListener('popstate', handleHashChange);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    void getAuthSession()
      .then((session) => {
        if (mounted) setAuthSession(session);
      })
      .catch(() => {
        if (!mounted) return;
        setApiStatus('offline');
        setAuthSession({ required: false, authenticated: true, mode: 'LOOPBACK_DEMO' });
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!authSession?.authenticated) return;
    let mounted = true;
    let refreshTimer: number | null = null;
    const hydrate = async () => {
      try {
        const [health, dashboard] = await Promise.all([getIntegrationHealth(), getDashboard()]);
        if (!mounted) return;
        setProviderHealth(health.integrations);
        setPersistenceHealth(health.persistence);
        applyDashboard(dashboard);
        setApiStatus('connected');
      } catch {
        if (mounted) setApiStatus('offline');
      }
    };
    const scheduleHydration = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void hydrate(), 180);
    };

    void hydrate();
    const unsubscribe = subscribeToAgentEvents((event) => {
      if (!mounted) return;
      setLiveEvents((current) => mergeActivityEvents(current, [mapAgentEvent(event)]));
      if (event.leadId) setActiveLeadId(event.leadId);
      if (event.projectId) setActiveProjectId(event.projectId);
      if (event.eventType === 'deployment.succeeded' && typeof event.metadata.url === 'string') {
        setDeploymentUrl(event.metadata.url);
      }
      scheduleHydration();
    }, (connected) => {
      if (!mounted) return;
      setApiStatus(connected ? 'connected' : 'offline');
      if (connected) scheduleHydration();
    });

    return () => {
      mounted = false;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      unsubscribe();
    };
  }, [applyDashboard, authSession?.authenticated]);

  useEffect(() => {
    if (
      !state.autoAdvance ||
      apiStatus !== 'offline' ||
      state.campaignStatus !== 'running' ||
      state.pipelineStep >= pipelineBlueprint.length ||
      (realConversationMode && state.pipelineStep >= 4)
    ) return;
    const timer = window.setTimeout(() => {
      setState((current) => ({ ...current, pipelineStep: Math.min(pipelineBlueprint.length, current.pipelineStep + 1) }));
    }, state.pipelineStep === 3 ? 5000 : 3200);
    return () => window.clearTimeout(timer);
  }, [apiStatus, realConversationMode, state.autoAdvance, state.campaignStatus, state.pipelineStep, setState]);

  useEffect(() => {
    if (apiStatus === 'offline' && previousStep.current !== state.pipelineStep && state.pipelineStep > 0) {
      const event = stageEvents[Math.min(state.pipelineStep - 1, stageEvents.length - 1)];
      setToast(`${event[0]} · ${event[1]}`);
      setSelectedStage(Math.min(state.pipelineStep, 9));
      const timer = window.setTimeout(() => setToast(null), 3300);
      previousStep.current = state.pipelineStep;
      return () => window.clearTimeout(timer);
    }
  }, [apiStatus, state.pipelineStep]);

  const pipeline: PipelineStage[] = pipelineBlueprint.map((stage, index) => ({
    ...stage,
    status: index < state.pipelineStep ? 'complete' : index === state.pipelineStep && state.pipelineStep < pipelineBlueprint.length ? 'active' : 'queued',
    timestamp: apiStatus === 'offline' && index < state.pipelineStep ? `13:${String(42 + index).padStart(2, '0')}:${index % 2 ? '14' : '09'}` : undefined,
  }));

  function navigate(next: ViewKey) {
    setView(next);
    window.history.pushState(null, '', `#/${next}`);
    setMobileOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function authenticateFounder(token: string) {
    setAuthSubmitting(true);
    setAuthError(null);
    try {
      const session = await loginWithToken(token);
      setAuthSession(session);
      setApiStatus('connecting');
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Founder authentication failed.');
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function startPipeline(requestedBusiness = selectedBusiness) {
    if (requestedBusiness.id === selectedBusiness.id && state.pipelineStep >= pipelineBlueprint.length) {
      setToast('Idempotency guard · This project is already deployed.');
      return;
    }
    if (persistenceBlocked) {
      setToast('PostgreSQL is degraded · operational commands are blocked until durable persistence recovers.');
      return;
    }
    const browserFallback = apiStatus !== 'connected';
    setState((current) => ({
      ...current,
      campaignStatus: 'running',
      autoAdvance: browserFallback,
      pipelineStep: browserFallback ? Math.max(current.pipelineStep, 2) : current.pipelineStep,
      selectedBusinessId: requestedBusiness.id,
    }));
    setSelectedBusinessId(requestedBusiness.id);
    setIntelligenceOpen(false);
    setToast('Orchestrator accepting · duplicate-safe request in progress');
    navigate('pipeline');
    try {
      const aggregate = await startPipelineRun(requestedBusiness.id, `stage-1:${requestedBusiness.id}`);
      const acceptedStep = pipelineStepForState(aggregate.lead.status);
      setActiveLeadId(aggregate.lead.id);
      setActiveProjectId(aggregate.lead.projectId);
      if (aggregate.deployment?.url) setDeploymentUrl(aggregate.deployment.url);
      setApiStatus('connected');
      setState((current) => ({
        ...current,
        pipelineStep: acceptedStep,
        autoAdvance: false,
      }));
      setToast(acceptedStep >= pipelineBlueprint.length
        ? `Idempotency guard · ${aggregate.lead.projectId} is already deployed.`
        : `Orchestrator started · ${aggregate.lead.projectId} · API trace active`);
    } catch (error) {
      if (isConnectivityFailure(error)) {
        setApiStatus('offline');
        setState((current) => ({ ...current, autoAdvance: true, pipelineStep: Math.max(current.pipelineStep, 2) }));
        setToast('API unavailable · continuing in clearly labelled browser demo mode.');
      } else {
        setToast(error instanceof Error ? error.message : 'The pipeline command was rejected.');
      }
    }
  }

  function resetJourney() {
    if (apiStatus === 'connected') {
      void getDashboard().then(applyDashboard).then(() => {
        setToast('Durable API projection refreshed. Server lifecycle state was not rewritten.');
      }).catch(() => setToast('Unable to refresh the durable API projection.'));
      return;
    }
    setState((current) => ({ ...current, pipelineStep: 1, autoAdvance: false, campaignStatus: 'running' }));
    setDeploymentUrl(null);
    setSelectedStage(1);
    setToast('Demo journey reset to qualification.');
  }

  async function refreshIntegrations() {
    setApiStatus('connecting');
    try {
      const health = await getIntegrationHealth();
      setProviderHealth(health.integrations);
      setPersistenceHealth(health.persistence);
      setApiStatus('connected');
      setToast(`Integration health refreshed · ${health.integrations.filter((provider) => provider.mode === 'REAL').length} real · ${health.integrations.filter((provider) => provider.mode === 'DEMO').length} demo · ${health.persistence.mode}`);
    } catch {
      setApiStatus('offline');
      setToast('AgentFront API is offline · browser demo fallback remains available.');
    }
  }

  async function changeCampaignStatus(next: AppState['campaignStatus']) {
    if (apiStatus !== 'connected') {
      setState((current) => ({ ...current, campaignStatus: next, autoAdvance: next === 'running' ? current.autoAdvance : false }));
      return;
    }
    if (persistenceBlocked) {
      setToast('PostgreSQL is degraded · campaign commands are blocked until durable persistence recovers.');
      return;
    }
    try {
      await updateCampaign(next === 'running' ? 'start' : next === 'paused' ? 'pause' : 'emergency-stop');
      setState((current) => ({ ...current, campaignStatus: next, autoAdvance: false }));
      setToast(next === 'stopped' ? 'Emergency stop acknowledged by the orchestrator.' : `Campaign ${next} · API state synchronized.`);
    } catch (error) {
      if (isConnectivityFailure(error)) setApiStatus('offline');
      setToast(error instanceof Error ? error.message : 'Campaign synchronization failed.');
    }
  }

  const pageProps = {
    navigate,
    state,
    setState,
    selectedBusiness,
    marketBusinesses,
    setMarketBusinesses,
    selectedBusinessId,
    setSelectedBusinessId,
    setIntelligenceOpen,
    pipeline,
    selectedStage,
    setSelectedStage,
    startPipeline,
    resetJourney,
    setToast,
    apiStatus,
    providerHealth,
    persistenceHealth,
    dashboardMetrics,
    dashboardLeads,
    activityEvents: apiStatus === 'connected' ? liveEvents : mergeActivityEvents(activitySeed, liveEvents),
    activeLeadId,
    activeProjectId,
    deploymentUrl,
    refreshIntegrations,
    changeCampaignStatus,
  };
  const realProviderCount = providerHealth.filter((provider) => provider.mode === 'REAL').length;
  const allProvidersDemo = apiStatus === 'connected' && providerHealth.length > 0 && providerHealth.every((provider) => provider.mode === 'DEMO');
  const modeLabel = apiStatus === 'offline'
    ? 'Browser demo'
    : apiStatus === 'connecting'
      ? 'Connecting'
      : realProviderCount > 0
        ? `${realProviderCount} real · ${providerHealth.length - realProviderCount} demo`
        : persistenceBlocked
          ? 'Persistence degraded'
          : 'API demo data';

  if (authSession === null && apiStatus === 'connecting') {
    return <main className="auth-gate"><section className="auth-card panel"><BrandMark /><div className="auth-card__icon"><RefreshCw size={24} /></div><div><span className="eyebrow">AgentFront</span><h1>Connecting to the control center</h1><p>Checking the API and founder session.</p></div></section></main>;
  }
  if (authSession?.required && !authSession.authenticated) {
    return <FounderLogin submitting={authSubmitting} error={authError} onLogin={authenticateFounder} />;
  }

  return (
    <div className={classNames('app-shell', sidebarCollapsed && 'app-shell--collapsed')}>
      <aside className={classNames('sidebar', mobileOpen && 'sidebar--mobile-open')}>
        <div className="sidebar__top">
          <BrandMark compact={sidebarCollapsed} />
          <IconButton label="Close navigation" onClick={() => setMobileOpen(false)}><X size={18} /></IconButton>
        </div>
        <div className="autonomy-badge">
          <div><Dot pulse tone={state.campaignStatus === 'stopped' ? 'red' : apiStatus === 'offline' || state.campaignStatus === 'paused' ? 'amber' : 'green'} /><span>Autonomous operations</span></div>
          <small>{state.campaignStatus === 'stopped' ? 'Emergency stop active' : state.campaignStatus === 'paused' ? 'Processing paused' : apiStatus === 'offline' ? 'Browser demo fallback' : apiStatus === 'connecting' ? 'Checking orchestrator' : 'Orchestrator connected'}</small>
        </div>
        <div className="mobile-operations">
          <Button tone="secondary" icon={state.campaignStatus === 'running' ? <Pause size={14} /> : <Play size={14} />} onClick={() => void changeCampaignStatus(state.campaignStatus === 'running' ? 'paused' : 'running')}>{state.campaignStatus === 'running' ? 'Pause' : 'Resume'}</Button>
          <Button tone="danger" icon={<Octagon size={14} />} onClick={() => void changeCampaignStatus('stopped')}>Stop</Button>
        </div>
        <nav className="sidebar__nav" aria-label="Primary navigation">
          {navigation.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-group__label">{sidebarCollapsed ? '·' : group.label}</div>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <button className={classNames('nav-item', view === item.id && 'is-active')} type="button" key={item.id} onClick={() => navigate(item.id)} title={sidebarCollapsed ? item.label : undefined}>
                    <Icon size={18} strokeWidth={1.8} />
                    <span>{item.label}</span>
                    {item.badge && <em className={item.badge === 'LIVE' ? 'badge-live' : ''}>{item.badge}</em>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar__bottom">
          <button className={classNames('nav-item', view === 'settings' && 'is-active')} type="button" onClick={() => navigate('settings')}>
            <Settings size={18} /><span>Settings</span>
          </button>
          <button className="operator-card" type="button" onClick={() => navigate('settings')}>
            <Avatar name="KR" tone={1} />
            <span><strong>Kirthik Roshan</strong><small>Founder workspace</small></span>
            <MoreHorizontal size={17} />
          </button>
        </div>
      </aside>

      {mobileOpen && <button className="mobile-scrim" type="button" aria-label="Close menu" onClick={() => setMobileOpen(false)} />}

      <div className="workspace">
        <header className="topbar">
          <div className="topbar__left">
            <IconButton label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={19} /></IconButton>
            <IconButton label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setSidebarCollapsed((value) => !value)}>
              {sidebarCollapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
            </IconButton>
            <div className="campaign-select">
              <span>Active campaign</span>
              <button type="button">AgentFront Stage 1 Demo <ChevronDown size={15} /></button>
            </div>
          </div>
          <div className="topbar__controls">
            <Pill tone={realProviderCount > 0 ? 'success' : 'demo'}><Sparkles size={12} /> {modeLabel}</Pill>
            {state.campaignStatus === 'running' ? (
              <Button tone="secondary" icon={<Pause size={15} />} onClick={() => void changeCampaignStatus('paused')}>Pause</Button>
            ) : (
              <Button tone="secondary" icon={<Play size={15} />} onClick={() => void changeCampaignStatus('running')}>Resume</Button>
            )}
            <Button tone="danger" icon={<Octagon size={15} />} onClick={() => void changeCampaignStatus('stopped')}>Emergency stop</Button>
            <IconButton label="Toggle color theme" onClick={() => setState((current) => ({ ...current, theme: current.theme === 'dark' ? 'light' : 'dark' }))}>
              {state.theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </IconButton>
            <IconButton label="Notifications"><Bell size={18} /><span className="notification-dot" /></IconButton>
          </div>
        </header>

        <main className="main-content">
          {persistenceBlocked && <div className="connection-banner connection-banner--danger"><AlertTriangle size={17} /><span><strong>Durable persistence is degraded.</strong><small>{persistenceHealth?.message} Operational commands are blocked until PostgreSQL recovers.</small></span><Button tone="ghost" onClick={refreshIntegrations}>Retest persistence</Button></div>}
          {allProvidersDemo && view === 'overview' && <div className="connection-banner connection-banner--demo"><Sparkles size={17} /><span><strong>Welcome to the credential-free Stage‑1 demo.</strong><small>Every external adapter is clearly labelled DEMO. Select SpiceRoute Kitchen in Discover to run the canonical autonomous journey.</small></span><Button tone="ghost" onClick={() => navigate('discover')}>Start with discovery</Button></div>}
          {view === 'overview' && <Overview {...pageProps} />}
          {view === 'discover' && <Discover {...pageProps} />}
          {view === 'leads' && <Leads {...pageProps} />}
          {view === 'pipeline' && <Pipeline {...pageProps} />}
          {view === 'sales' && <SalesRoom {...pageProps} />}
          {view === 'crm' && <CRM {...pageProps} />}
          {view === 'campaigns' && <Campaigns {...pageProps} />}
          {view === 'projects' && <Projects {...pageProps} />}
          {view === 'deployments' && <Deployments {...pageProps} />}
          {view === 'agents' && <Agents {...pageProps} />}
          {view === 'analytics' && <Analytics />}
          {view === 'activity' && <ActivityPage {...pageProps} />}
          {view === 'settings' && <SettingsPage {...pageProps} />}
        </main>
      </div>

      {intelligenceOpen && (
        <IntelligenceDrawer
          business={selectedBusiness}
          onClose={() => setIntelligenceOpen(false)}
          onStart={startPipeline}
          alreadyStarted={selectedBusiness.id === spiceRoute.id && state.pipelineStep >= 2}
          stageOneEligible={selectedBusiness.id === spiceRoute.id}
        />
      )}

      {toast && <div className="toast"><CheckCircle2 size={18} /><span>{toast}</span><button type="button" onClick={() => setToast(null)}><X size={15} /></button></div>}
    </div>
  );
}

type PageProps = {
  navigate: (view: ViewKey) => void;
  state: AppState;
  setState: (value: AppState | ((state: AppState) => AppState)) => void;
  selectedBusiness: Business;
  marketBusinesses: Business[];
  setMarketBusinesses: (businesses: Business[]) => void;
  selectedBusinessId: string;
  setSelectedBusinessId: (id: string) => void;
  setIntelligenceOpen: (value: boolean) => void;
  pipeline: PipelineStage[];
  selectedStage: number;
  setSelectedStage: (index: number) => void;
  startPipeline: (business?: Business) => Promise<void>;
  resetJourney: () => void;
  setToast: (value: string | null) => void;
  apiStatus: ApiConnectionState;
  providerHealth: IntegrationHealth[];
  persistenceHealth: PersistenceHealth | null;
  dashboardMetrics: DashboardMetrics | null;
  dashboardLeads: PipelineAggregate[];
  activityEvents: ActivityEvent[];
  activeLeadId: string;
  activeProjectId: string;
  deploymentUrl: string | null;
  refreshIntegrations: () => Promise<void>;
  changeCampaignStatus: (status: AppState['campaignStatus']) => Promise<void>;
};

function Overview({ navigate, state, pipeline, startPipeline, activityEvents, apiStatus, dashboardMetrics, marketBusinesses, selectedBusinessId, setSelectedBusinessId }: PageProps) {
  const completed = Math.min(state.pipelineStep, 10);
  const dealWon = state.pipelineStep >= 6;
  const deployed = state.pipelineStep >= pipelineBlueprint.length;
  const eventCount = Math.max(5, Math.min(activityEvents.length, completed + 3));
  const connectedMetrics = apiStatus === 'connected' ? dashboardMetrics : null;
  const topMetrics = connectedMetrics ? [
    { label: 'Revenue earned', value: rupees.format(connectedMetrics.revenueEarned), note: 'API source-of-record projection', icon: IndianRupee, trend: false },
    { label: 'Estimated pipeline', value: rupees.format(connectedMetrics.estimatedPipelineValue), note: 'Open governed opportunities', icon: TrendingUp, trend: false },
    { label: 'Businesses analysed', value: connectedMetrics.businessesDiscovered.toLocaleString('en-IN'), note: 'Persisted discovery records', icon: Store, trend: false },
    { label: 'Qualified leads', value: connectedMetrics.qualifiedLeads.toLocaleString('en-IN'), note: 'Orchestrator-qualified leads', icon: Target, trend: false },
  ] : [
    { label: 'Revenue earned', value: dealWon ? '₹1,24,800' : '₹1,17,600', note: 'Seeded browser demo projection', icon: IndianRupee, trend: false },
    { label: 'Estimated pipeline', value: dealWon ? '₹3,74,800' : '₹3,82,000', note: 'Seeded browser demo projection', icon: TrendingUp, trend: false },
    { label: 'Businesses analysed', value: '1,286', note: 'Seeded portfolio benchmark', icon: Store, trend: false },
    { label: 'Qualified leads', value: '186', note: 'Seeded portfolio benchmark', icon: Target, trend: false },
  ];
  const smallMetrics = connectedMetrics ? [
    ['Voice conversations', connectedMetrics.conversationsCompleted.toLocaleString('en-IN'), 'Completed by the orchestrator'],
    ['Deals won', connectedMetrics.dealsWon.toLocaleString('en-IN'), 'Durable commercial records'],
    ['Conversion', `${connectedMetrics.conversionRate.toFixed(1)}%`, 'Lead-to-win conversion'],
    ['Sites deployed', connectedMetrics.websitesDeployed.toLocaleString('en-IN'), deployed ? 'SpiceRoute is deployed' : 'From API projection'],
  ] : [
    ['Voice conversations', state.pipelineStep >= 4 ? '42' : '41', 'Seeded browser demo'],
    ['Deals won', dealWon ? '13' : '12', 'Seeded browser demo'],
    ['Conversion', dealWon ? '30.9%' : '29.3%', 'Seeded browser demo'],
    ['Sites deployed', deployed ? '12' : '11', 'Seeded browser demo'],
  ];
  return (
    <div className="page overview-page">
      <SectionHeading
        eyebrow="Founder control center · Sunday, 23 August"
        title="The agency is operating."
        copy="Watch acquisition, sales and digital delivery move as one coordinated system."
        action={
          <div className="heading-actions">
            <Button tone="secondary" icon={<Map size={16} />} onClick={() => navigate('discover')}>Search market</Button>
            <Button icon={state.autoAdvance || (apiStatus === 'connected' && state.pipelineStep > 1 && !deployed) ? <Wifi size={16} /> : <Play size={16} />} onClick={startPipeline}>{state.autoAdvance || (apiStatus === 'connected' && state.pipelineStep > 1 && !deployed) ? 'Pipeline running' : deployed ? 'Open deployed pipeline' : 'Run demo pipeline'}</Button>
          </div>
        }
      />

      {apiStatus === 'offline' && <div className="connection-banner"><AlertTriangle size={17} /><span><strong>Browser demo fallback is active.</strong><small>Start the API to persist the canonical journey and receive live orchestrator events.</small></span><Button tone="ghost" onClick={() => navigate('settings')}>Integration health</Button></div>}

      <section className="kpi-grid">
        {topMetrics.map((metric, index) => {
          const Icon = metric.icon;
          return (
            <article className={classNames('metric-card', index === 0 && 'metric-card--feature')} key={metric.label}>
              <div className="metric-card__head"><span>{metric.label}</span><span className="metric-icon"><Icon size={17} /></span></div>
              <strong>{metric.value}</strong>
              <div className="metric-card__foot"><span className={metric.trend ? 'positive' : ''}>{metric.trend && <ArrowUpRight size={13} />}{metric.note}</span><span>{connectedMetrics ? 'live API' : 'demo'}</span></div>
              {index === 0 && <Sparkline />}
            </article>
          );
        })}
      </section>

      <section className="stat-strip">
        {smallMetrics.map(([label, value, note], index) => (
          <div className="stat-strip__item" key={label}>
            <span className={`stat-symbol stat-symbol--${index}`}><Circle size={8} fill="currentColor" /></span>
            <div><small>{label}</small><strong>{value}</strong></div>
            <em>{note}</em>
          </div>
        ))}
      </section>

      <div className="overview-grid">
        <section className="panel active-operation">
          <div className="panel__header">
            <div><div className="eyebrow"><Dot pulse tone="green" /> Live operation</div><h2>SpiceRoute Kitchen</h2></div>
            <button className="text-link" type="button" onClick={() => navigate('pipeline')}>Open pipeline <ArrowRight size={14} /></button>
          </div>
          <div className="operation-meta">
            <div><code>AF-2026-000001</code><span>Restaurant · Sholinganallur</span></div>
            <div className="operation-value"><small>Deal value</small><strong>₹7,200</strong></div>
          </div>
          <div className="operation-track">
            <div className="operation-track__line"><span style={{ width: `${Math.max(6, completed * 10)}%` }} /></div>
            <div className="operation-track__labels">
              {pipeline.map((stage, index) => (
                <button key={stage.key} type="button" className={classNames(index < completed && 'complete', index === completed && 'active')} onClick={() => navigate('pipeline')}>
                  <span>{index < completed ? <Check size={11} /> : index === completed ? <span className="stage-pulse" /> : index + 1}</span>
                  <em>{stage.label.split(' ')[0]}</em>
                </button>
              ))}
            </div>
          </div>
          <div className="agent-work-card">
            <div className="agent-orb"><Bot size={20} /></div>
            <div><span>Currently working</span><strong>{completed >= 10 ? 'Operations complete' : pipeline[Math.min(completed, 9)].agent}</strong><p>{completed >= 10 ? 'Site is live and all systems are synchronized.' : pipeline[Math.min(completed, 9)].detail}</p></div>
            <div className="work-state">{completed >= 10 ? <Pill tone="success"><Check size={12} /> Complete</Pill> : <><Dot pulse tone="blue" /><span>Processing</span></>}</div>
          </div>
        </section>

        <section className="panel revenue-panel">
          <div className="panel__header"><div><span className="panel-label">{connectedMetrics ? 'Revenue source of record' : 'Seeded portfolio benchmark'}</span><h2>{connectedMetrics ? rupees.format(connectedMetrics.revenueEarned) : '₹64,200'} <small>{connectedMetrics ? 'booked' : 'demo week'}</small></h2></div><select aria-label="Revenue chart period"><option>12 weeks</option><option>30 days</option></select></div>
          <div className="revenue-chart">
            <div className="revenue-chart__axis"><span>₹15k</span><span>₹10k</span><span>₹5k</span><span>₹0</span></div>
            <div className="revenue-bars">
              {revenueSeries.map((value, index) => <div className={index === revenueSeries.length - 1 ? 'current' : ''} key={index} style={{ height: `${value / 1.35}%` }}><span>{index === revenueSeries.length - 1 ? '₹12.4k' : ''}</span></div>)}
            </div>
          </div>
          <div className="revenue-summary"><div><span>Average deal</span><strong>₹7,342</strong></div><div><span>Best territory</span><strong>OMR, Chennai</strong></div></div>
        </section>

        <section className="panel activity-panel">
          <div className="panel__header"><div><span className="panel-label">Agent activity</span><h2>Operations stream</h2></div><button className="text-link" type="button" onClick={() => navigate('activity')}>View all <ArrowRight size={14} /></button></div>
          <ActivityList compact events={activityEvents.slice(0, eventCount)} />
        </section>

        <section className="panel territory-panel">
          <div className="panel__header"><div><span className="panel-label">Market pulse</span><h2>Chennai territories</h2></div><IconButton label="Open discovery map" onClick={() => navigate('discover')}><ArrowUpRight size={16} /></IconButton></div>
          <div className="territory-map territory-map--osm">
            <OpenStreetMapBusinessMap
              businesses={marketBusinesses}
              selectedBusinessId={selectedBusinessId}
              onSelect={(business) => {
                setSelectedBusinessId(business.id);
                navigate('discover');
              }}
            />
          </div>
          <div className="territory-stats"><span><Dot tone="green" /> 50 qualified</span><span>₹1.8L opportunity</span></div>
        </section>
      </div>
    </div>
  );
}

function Discover({ selectedBusinessId, setSelectedBusinessId, setIntelligenceOpen, apiStatus, marketBusinesses, setMarketBusinesses, setToast }: PageProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'All' | Business['category']>('Restaurant');
  const [website, setWebsite] = useState<'All' | 'Missing' | 'Poor'>('All');
  const [minimumScore, setMinimumScore] = useState(70);
  const [location, setLocation] = useState('Sholinganallur, Chennai');
  const [radiusKm, setRadiusKm] = useState(5);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(true);
  const [listOpen, setListOpen] = useState(true);
  const [discoveryMeta, setDiscoveryMeta] = useState<DiscoveryMeta>({
    mode: 'DEMO',
    provider: 'AgentFront browser seed',
    attribution: 'DEMO DATA',
  });
  const selected = marketBusinesses.find((business) => business.id === selectedBusinessId) ?? spiceRoute;
  const filtered = useMemo(() => marketBusinesses.filter((business) => {
    const matchesQuery = `${business.name} ${business.area}`.toLowerCase().includes(query.toLowerCase());
    const matchesCategory = category === 'All' || business.category === category;
    const matchesWebsite = website === 'All' || (website === 'Missing' ? !business.website : business.websiteQuality === 'poor');
    return matchesQuery && matchesCategory && matchesWebsite && business.opportunityScore >= minimumScore;
  }), [marketBusinesses, query, category, website, minimumScore]);

  async function runSearch() {
    setSearched(true);
    if (apiStatus === 'offline') {
      setMarketBusinesses(businesses);
      setDiscoveryMeta({ mode: 'DEMO', provider: 'AgentFront browser seed', attribution: 'DEMO DATA' });
      setToast('Browser demo market loaded · start the API for provider-backed discovery.');
      return;
    }
    setSearching(true);
    try {
      const requestedCategory = category === 'All' ? 'restaurant' : category.toLowerCase() as 'restaurant' | 'salon' | 'garments' | 'mechanic';
      const discovered = await discoverMarket({ location, category: requestedCategory, radiusMetres: radiusKm * 1_000 });
      const mapped = mapDiscoveredBusinesses(discovered);
      setMarketBusinesses(mapped);
      setDiscoveryMeta(discovered.meta);
      if (mapped[0]) setSelectedBusinessId(mapped[0].id);
      setToast(`${mapped.length} businesses loaded from ${discovered.meta.provider} · ${discovered.meta.attribution}.`);
    } catch (error) {
      setMarketBusinesses(businesses);
      setSelectedBusinessId(spiceRoute.id);
      setDiscoveryMeta({ mode: 'DEMO', provider: 'AgentFront browser seed', attribution: 'DEMO DATA' });
      setToast(`${error instanceof Error ? error.message : 'Discovery provider unavailable.'} Loaded the labelled demo market instead.`);
    } finally {
      setSearching(false);
    }
  }

  function choose(business: Business) {
    setSelectedBusinessId(business.id);
    const element = document.getElementById(`business-${business.id}`);
    element?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  return (
    <div className="page page--flush discover-page">
      <div className="discover-header">
        <SectionHeading eyebrow="Market intelligence" title="Discover opportunity" copy="Find businesses where AgentFront can create measurable digital value." />
        <div className="discover-searchbar">
          <label className="input-shell input-shell--location"><MapPin size={17} /><span><small>Location</small><input value={location} onChange={(event) => setLocation(event.target.value)} aria-label="Location" /></span></label>
          <label className="input-shell"><Store size={17} /><span><small>Industry</small><select value={category} onChange={(event) => setCategory(event.target.value as typeof category)}><option>All</option><option>Restaurant</option><option>Salon</option><option>Garments</option><option>Mechanic</option></select></span></label>
          <label className="input-shell"><Gauge size={17} /><span><small>Radius</small><select aria-label="Radius" value={radiusKm} onChange={(event) => setRadiusKm(Number(event.target.value))}><option value={5}>5 km</option><option value={10}>10 km</option><option value={20}>20 km</option></select></span></label>
          <Button disabled={searching} icon={searching ? <RefreshCw size={16} /> : <Search size={16} />} onClick={runSearch}>{searching ? 'Searching' : 'Search market'}</Button>
        </div>
        <div className="filter-row">
          <label className="quick-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search these results" /></label>
          <div className="filter-pills">
            <button className={website === 'Missing' ? 'active' : ''} type="button" onClick={() => setWebsite(website === 'Missing' ? 'All' : 'Missing')}>Website missing <span>21</span></button>
            <button className={website === 'Poor' ? 'active' : ''} type="button" onClick={() => setWebsite(website === 'Poor' ? 'All' : 'Poor')}>Poor website <span>4</span></button>
            <label className="score-filter">Score {minimumScore}+ <input type="range" min="60" max="90" step="5" value={minimumScore} onChange={(event) => setMinimumScore(Number(event.target.value))} /></label>
            <button type="button"><ListFilter size={14} /> More filters</button>
          </div>
          <Pill tone={discoveryMeta.mode === 'REAL' ? 'success' : 'demo'}>{discoveryMeta.mode} · {discoveryMeta.provider} · {discoveryMeta.attribution}</Pill>
        </div>
      </div>

      <div className={classNames('discovery-workspace', !listOpen && 'discovery-workspace--map-only')}>
        <aside className="results-panel">
          <div className="results-panel__head"><div><strong>{filtered.length} businesses</strong><span>sorted by opportunity</span></div><button type="button">Highest score <ChevronDown size={14} /></button></div>
          <div className="result-cards">
            {searched && filtered.slice().sort((a, b) => b.opportunityScore - a.opportunityScore).map((business) => (
              <article id={`business-${business.id}`} className={classNames('business-card', selectedBusinessId === business.id && 'is-selected')} key={business.id} onClick={() => choose(business)}>
                <div className="business-card__top">
                  <div className={`business-photo business-photo--${business.category.toLowerCase()}`}><CategoryIcon category={business.category} /></div>
                  <div className="business-card__title"><div><Pill tone={business.qualified ? 'success' : 'neutral'}>{business.qualified ? 'Qualified' : 'Review'}</Pill>{business.source === 'DEMO' && <Pill tone="demo">Demo data</Pill>}</div><h3>{business.name}</h3><p>{business.category} · {business.area}</p></div>
                  <ScoreRing value={business.opportunityScore} size={58} />
                </div>
                <div className="business-card__stats"><span><Star size={14} fill="currentColor" /> <strong>{business.rating}</strong> ({business.reviews})</span><span><Phone size={14} /> {business.phone ? 'Phone' : 'No phone'}</span><span className={business.website ? '' : 'missing'}><Globe2 size={14} /> {business.website ? 'Website' : 'No website'}</span></div>
                <div className="business-card__footer"><span><MapPin size={13} /> {business.area}, Chennai</span><button type="button" onClick={(event) => { event.stopPropagation(); choose(business); setIntelligenceOpen(true); }}>View intelligence <ArrowRight size={13} /></button></div>
              </article>
            ))}
            {!filtered.length && <div className="empty-state"><Search size={30} /><h3>No businesses match</h3><p>Lower the score threshold or clear filters.</p></div>}
          </div>
        </aside>

        <section className="market-map">
          <div className="map-canvas map-canvas--openstreetmap">
            <OpenStreetMapBusinessMap businesses={filtered} selectedBusinessId={selectedBusinessId} onSelect={choose} />
            <div className="map-mode-badge map-mode-badge--real">OpenStreetMap · free map tiles</div>
            <div className="map-legend"><span><i className="legend-high" />85–100</span><span><i className="legend-medium" />70–84</span><span>Opportunity score</span></div>
            <button className="list-toggle" type="button" onClick={() => setListOpen((value) => !value)}>{listOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}{listOpen ? 'Hide list' : 'Show list'}</button>

            <div className="map-selection-card">
              <button type="button" className="map-selection-card__close" onClick={() => setSelectedBusinessId('')}><X size={15} /></button>
              <div><div><Pill tone="success">{selected.opportunityScore} score</Pill><span>{selected.category}</span></div><h3>{selected.name}</h3><p><MapPin size={13} /> {selected.area}, Chennai</p></div>
              <Button onClick={() => setIntelligenceOpen(true)}>View intelligence</Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function CategoryIcon({ category }: { category: Business['category'] }) {
  if (category === 'Restaurant') return <Coffee size={22} />;
  if (category === 'Salon') return <WandSparkles size={22} />;
  if (category === 'Garments') return <Store size={22} />;
  return <Gauge size={22} />;
}

function IntelligenceDrawer({ business, onClose, onStart, alreadyStarted, stageOneEligible }: { business: Business; onClose: () => void; onStart: () => void; alreadyStarted: boolean; stageOneEligible: boolean }) {
  return (
    <div className="drawer-layer">
      <button className="drawer-scrim" type="button" onClick={onClose} aria-label="Close intelligence" />
      <aside className="intelligence-drawer" role="dialog" aria-modal="true" aria-labelledby="intelligence-title">
        <div className="drawer-header"><div><Pill tone={business.source === 'DEMO' ? 'demo' : 'success'}><Sparkles size={11} /> {business.source === 'DEMO' ? 'Demo intelligence' : 'Google Places intelligence'}</Pill><code>{business.projectId ?? 'Not in pipeline'}</code></div><IconButton label="Close intelligence" onClick={onClose}><X size={19} /></IconButton></div>
        <div className="drawer-business">
          <div className={`business-photo business-photo--${business.category.toLowerCase()}`}><CategoryIcon category={business.category} /></div>
          <div><span>{business.category} · {business.area}</span><h2 id="intelligence-title">{business.name}</h2><p><Star size={14} fill="currentColor" /> {business.rating} · {business.reviews} reviews</p></div>
        </div>
        <div className="intelligence-score">
          <ScoreRing value={business.opportunityScore} size={104} />
          <div><span>Digital opportunity score</span><strong>{business.opportunityScore} <small>/ 100</small></strong><Pill tone={business.qualified ? 'success' : 'warning'}>{business.qualified ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />} {business.qualified ? 'Qualified opportunity' : 'Founder review required'}</Pill></div>
        </div>
        <section className="drawer-section"><div className="drawer-section__title"><h3>Why AgentFront qualified this business</h3><span>Policy v2.4</span></div>
          <div className="score-breakdown">
            {[[40, 'No dedicated website', !business.website], [20, 'Contact number available', business.phone], [15, 'Rating above 4.0', business.rating >= 4], [16, 'Strong review activity', business.reviews > 100]].map(([points, label, active]) => (
              <div key={String(label)} className={!active ? 'is-muted' : ''}><span><Check size={13} /></span><strong>+{String(points)}</strong><p>{String(label)}</p></div>
            ))}
          </div>
        </section>
        <section className="drawer-section"><div className="drawer-section__title"><h3>Online presence</h3><button type="button">Refresh scan <RefreshCw size={13} /></button></div>
          <div className="presence-grid">
            {[['Google Business', true], ['Maps listing', true], ['Phone number', business.phone], ['Instagram', business.instagram], ['Dedicated website', business.website], ['Online ordering', false], ['Reservation system', false], ['Mobile optimized', false]].map(([label, available]) => (
              <div key={String(label)}><span>{String(label)}</span>{available ? <CheckCircle2 size={16} className="check" /> : <XCircle size={16} className="cross" />}</div>
            ))}
          </div>
        </section>
        <section className="drawer-section opportunity-note"><Sparkles size={18} /><div><strong>{business.qualified ? 'Qualified for autonomous outreach' : 'Held for founder review'}</strong><p>{business.website ? 'This business has a digital presence; AgentFront will verify quality and scope before outreach.' : 'High review activity and no first-party digital channel indicate a strong conversion opportunity.'}</p></div></section>
        <div className="drawer-footer">
          <div><ShieldCheck size={16} /><span><strong>Policy guard active</strong><small>{stageOneEligible ? '₹5,999–₹11,999 · no duplicate outreach' : 'Queued for a category-specific delivery profile'}</small></span></div>
          <Button disabled={!stageOneEligible} icon={alreadyStarted ? <ArrowRight size={16} /> : <Play size={16} />} onClick={onStart}>{alreadyStarted ? 'Open active pipeline' : stageOneEligible ? 'Start autonomous pipeline' : 'Stage 1 lead queued'}</Button>
        </div>
      </aside>
    </div>
  );
}

function Pipeline({ pipeline, selectedStage, setSelectedStage, state, setState, startPipeline, resetJourney, navigate, apiStatus, activeProjectId, providerHealth }: PageProps) {
  const stage = pipeline[selectedStage] ?? pipeline[0];
  const completed = Math.min(state.pipelineStep, pipeline.length);
  const won = state.pipelineStep >= 6;
  const stageIntegration = selectedStage === 2 ? 'crm' : selectedStage === 3 ? 'conversation' : selectedStage === 7 ? 'developer' : selectedStage === 9 ? 'deployment' : null;
  const stageProvider = stageIntegration ? providerHealth.find((provider) => provider.integration === stageIntegration) : null;
  return (
    <div className="page pipeline-page">
      <SectionHeading
        eyebrow={`Orchestration · ${activeProjectId}`}
        title="SpiceRoute Kitchen pipeline"
        copy="Every transition is recorded, guarded and resumable from one canonical project ID."
        action={<div className="heading-actions"><Button tone="ghost" icon={<RefreshCw size={15} />} onClick={resetJourney}>Reset demo</Button>{state.autoAdvance ? <Button tone="secondary" icon={<Pause size={15} />} onClick={() => setState((current) => ({ ...current, autoAdvance: false }))}>Pause journey</Button> : <Button icon={<Play size={15} />} onClick={startPipeline}>{completed > 1 ? 'Continue journey' : 'Start pipeline'}</Button>}</div>}
      />
      <div className="pipeline-commandbar">
        <div className="pipeline-business"><div className="business-photo business-photo--restaurant"><Coffee size={20} /></div><span><strong>SpiceRoute Kitchen</strong><small>Restaurant · Sholinganallur, Chennai</small></span></div>
        <div className="pipeline-commandbar__stat"><span>Current lifecycle</span><strong>{completed >= 10 ? 'DEPLOYED' : stage.status === 'active' ? stage.label.toUpperCase() : pipeline[Math.min(completed, 9)].label.toUpperCase()}</strong></div>
        <div className="pipeline-commandbar__stat"><span>Commercial</span><strong>{won ? '₹7,200' : '₹7,999'} <small>{won ? 'won' : 'quoted'}</small></strong></div>
        <div className="pipeline-commandbar__stat"><span>Timing source</span><strong>{apiStatus === 'offline' ? 'Seeded demo clock' : 'Structured events'}</strong></div>
        <div className="pipeline-health"><Dot tone={apiStatus === 'connected' ? 'green' : 'amber'} pulse={apiStatus === 'connected'} /><span><strong>{apiStatus === 'connected' ? 'API connected' : 'Browser fallback'}</strong><small>{completed}/10 projected stages complete</small></span></div>
      </div>

      <section className="pipeline-visual panel">
        <div className="pipeline-visual__top"><span className="panel-label">Lifecycle state machine</span><div><Pill tone={apiStatus === 'connected' ? 'success' : 'warning'}><Database size={12} /> {apiStatus === 'connected' ? 'API trace' : 'Browser fallback'}</Pill><Pill tone="success"><ShieldCheck size={12} /> Idempotency guards</Pill></div></div>
        <div className="pipeline-stages">
          {pipeline.map((item, index) => (
            <div className="pipeline-stage-wrap" key={item.key}>
              <button type="button" className={classNames('pipeline-stage', `pipeline-stage--${item.status}`, selectedStage === index && 'is-selected')} onClick={() => setSelectedStage(index)}>
                <span className="pipeline-stage__number">{item.status === 'complete' ? <Check size={16} /> : item.status === 'active' ? <span className="stage-pulse" /> : String(index + 1).padStart(2, '0')}</span>
                <span className="pipeline-stage__copy"><small>{item.agent}</small><strong>{item.label}</strong><em>{item.detail}</em></span>
                <ChevronRight size={16} />
              </button>
              {index < pipeline.length - 1 && <span className={classNames('pipeline-connector', index < completed && 'complete')}><i /></span>}
            </div>
          ))}
        </div>
      </section>

      <div className="pipeline-detail-grid">
        <section className="panel stage-detail">
          <div className="panel__header"><div><span className="panel-label">Selected stage · {String(selectedStage + 1).padStart(2, '0')}</span><h2>{stage.label}</h2></div><Pill tone={stage.status === 'complete' ? 'success' : stage.status === 'active' ? 'live' : 'neutral'}><Dot pulse={stage.status === 'active'} tone={stage.status === 'complete' ? 'green' : stage.status === 'active' ? 'blue' : 'muted'} /> {stage.status}</Pill></div>
          <div className="stage-agent"><div className="agent-orb"><Bot size={20} /></div><div><span>Responsible component</span><strong>{stage.agent}</strong><p>{stage.detail}</p></div></div>
          <div className="detail-cells"><div><span>Started</span><strong>{stage.timestamp ?? (apiStatus === 'connected' ? 'See Activity event' : 'Waiting')}</strong></div><div><span>Duration</span><strong>{apiStatus === 'offline' && stage.status === 'complete' ? `${22 + selectedStage * 7}s · demo` : 'Not reported here'}</strong></div><div><span>Attempts</span><strong>{apiStatus === 'offline' ? stage.status === 'queued' ? '0 · demo' : '1 · demo' : 'See event metadata'}</strong></div><div><span>Provider</span><strong>{stageProvider ? `${stageProvider.provider} · ${stageProvider.mode} · ${stageProvider.status}` : 'AgentFront internal stage'}</strong></div></div>
          <div className="stage-output"><div><span>UI lifecycle projection</span><button type="button" onClick={() => void navigator.clipboard?.writeText(`${activeProjectId}:${stage.key}:${stage.status}`)}><Copy size={13} /> Copy</button></div><code>{`{\n  "projectId": "${activeProjectId}",\n  "stage": "${stage.key.toUpperCase()}",\n  "status": "${stage.status.toUpperCase()}",\n  "source": "${apiStatus === 'connected' ? 'api-dashboard' : 'browser-demo'}"\n}`}</code></div>
          <div className="panel-actions"><Button tone="secondary" icon={<TerminalSquare size={15} />} onClick={() => navigate('activity')}>Inspect logs</Button>{stage.status !== 'queued' && <Button tone="ghost" icon={<RefreshCw size={15} />} onClick={startPipeline}>Replay safely</Button>}</div>
        </section>
        <section className="panel build-monitor">
          <div className="panel__header"><div><span className="panel-label">Developer visualization</span><h2>Production build</h2></div><span className="build-duration">{apiStatus === 'offline' ? '03:42 seeded avg' : 'Event-driven status'}</span></div>
          <div className="template-card"><div className="template-preview"><span /><span /><span /></div><div><span>Selected template</span><strong>Restaurant v1</strong><small>Configuration-driven · mobile first</small></div><CheckCircle2 size={18} /></div>
          <div className="build-checklist">
            {['Template cloned', 'Requirements loaded', 'Customizing website', 'Production build', 'Deterministic QA', 'Deployment'].map((label, index) => {
              const effective = Math.max(0, completed - 6);
              return <div key={label} className={classNames(index < effective && 'complete', index === effective && completed < 10 && 'active')}><span>{index < effective ? <Check size={12} /> : index === effective && completed < 10 ? <span className="stage-pulse" /> : <Circle size={10} />}</span><strong>{label}</strong><em>{index < effective ? 'Done' : index === effective && completed < 10 ? 'Working…' : 'Queued'}</em></div>;
            })}
          </div>
          <div className="build-log"><div><Dot pulse={apiStatus === 'connected'} tone={apiStatus === 'connected' ? 'green' : 'amber'} /><span>{apiStatus === 'connected' ? 'API lifecycle projection' : 'Simulated build output · DEMO'}</span></div><pre>{apiStatus === 'connected' ? `${activeProjectId}  ${stage.key.toUpperCase()}  ${stage.status.toUpperCase()}\nExact timestamps and provider output are available in Activity.` : `13:46:35  Developer Agent started · DEMO\n13:46:38  Loaded Restaurant template · DEMO\n13:46:42  Added WhatsApp ordering · DEMO\n13:47:03  Updated menu structure · DEMO\n13:47:42  Applied branding tokens · DEMO\n${completed > 7 ? '13:48:10  Running production build · DEMO' : '··:··:··  Waiting for development stage · DEMO'}`}</pre></div>
        </section>
      </div>
    </div>
  );
}

function SalesRoom({ state, startPipeline, navigate, providerHealth, activeLeadId, selectedBusiness, setToast }: PageProps) {
  const conversationReady = state.pipelineStep >= 4;
  const complete = state.pipelineStep >= 6;
  const conversationProvider = providerHealth.find((provider) => provider.integration === 'conversation');
  const isReal = conversationProvider?.mode === 'REAL';
  return (
    <div className="page sales-page">
      <SectionHeading
        eyebrow={`${conversationProvider?.provider ?? 'Conversation adapter'} · ${conversationProvider?.mode ?? 'DEMO'}`}
        title="Live sales room"
        copy="Realtime conversation and structured requirement extraction in one operating surface."
        action={<div className="heading-actions"><Pill tone={complete ? 'success' : conversationReady ? 'live' : 'neutral'}><Dot pulse={!complete && conversationReady} tone={complete ? 'green' : conversationReady ? 'red' : 'muted'} /> {complete ? 'Conversation completed' : conversationReady ? isReal ? 'Consent required' : 'Demo call in progress' : 'Waiting for pipeline'}</Pill><Button tone="secondary" icon={<Layers3 size={15} />} onClick={() => navigate('pipeline')}>View pipeline</Button></div>}
      />
      {!conversationReady && (
        <div className="sales-waiting panel"><div className="call-rings"><Phone size={25} /></div><h2>Conversation is queued</h2><p>Start the autonomous demo pipeline. The sales room will activate after CRM creation.</p><Button icon={<Play size={16} />} onClick={startPipeline}>Start autonomous pipeline</Button></div>
      )}
      {conversationReady && <div className="sales-layout">
        <aside className="panel sales-business">
          <div className="sales-business__visual"><div className="restaurant-illustration"><span className="awning" /><span className="door" /><span className="window" /></div><Pill tone="success">91 opportunity</Pill></div>
          <div className="sales-business__name"><span>{selectedBusiness.category}</span><h2>{selectedBusiness.name}</h2><p><MapPin size={14} /> {selectedBusiness.area}, {selectedBusiness.city}</p></div>
          <div className="intel-facts"><div><span>Digital presence</span><strong className={selectedBusiness.website ? '' : 'warning-text'}>{selectedBusiness.website ? selectedBusiness.websiteQuality : 'Website missing'}</strong></div><div><span>Google rating</span><strong><Star size={13} fill="currentColor" /> {selectedBusiness.rating} · {selectedBusiness.reviews} reviews</strong></div><div><span>Decision maker</span><strong>{selectedBusiness.contact}</strong></div><div><span>CRM lifecycle</span><strong>{complete ? 'DEAL WON' : isReal ? 'CONVERSATION ACTIVE' : 'NEGOTIATING'}</strong></div></div>
          <div className="qualification-why"><span>Qualification context</span><p>Selected for a live, founder-approved demonstration of the real conversation, build and deployment flow.</p></div>
          <button className="full-link" type="button">Open full intelligence <ArrowRight size={14} /></button>
        </aside>

        {isReal
          ? <LiveElevenLabsConversation leadId={activeLeadId} business={selectedBusiness} onNotice={setToast} />
          : <section className="panel conversation-panel">
              <div className="conversation-panel__header">
                <div className="call-avatar"><Bot size={21} /><span /></div>
                <div><span>AgentFront Sales Agent · DEMO</span><strong>{complete ? 'Sample call ended · 04:51' : 'Sample call · 04:18'}</strong></div>
                <div className="call-controls"><IconButton label="Demo microphone control"><Mic2 size={17} /></IconButton><button className="end-call" type="button" aria-label="End demo call"><Phone size={16} /></button></div>
              </div>
              <div className="waveform" aria-hidden="true">{Array.from({ length: 48 }, (_, index) => <span key={index} style={{ height: `${12 + ((index * 17) % 38)}px`, animationDelay: `${index * 28}ms` }} />)}</div>
              <div className="transcript-head"><div><span>Seeded demo transcript</span><Pill tone="neutral">English · sample data</Pill></div><button type="button"><Search size={14} /> Search</button></div>
              <div className="transcript">
                {transcriptSeed.slice(0, complete ? 7 : 4).map((line) => (
                  <div className={classNames('transcript-line', `transcript-line--${line.speaker}`)} key={line.id}>
                    {line.speaker === 'agent' ? <span className="transcript-avatar"><Bot size={15} /></span> : <Avatar name="Restaurant Owner" tone={3} />}
                    <div><div><strong>{line.speaker === 'agent' ? 'AgentFront' : 'Restaurant Owner'}</strong><time>{line.time}</time></div><p>{line.text}</p></div>
                  </div>
                ))}
              </div>
              <div className="transcript-status"><Dot pulse={!complete} tone={complete ? 'green' : 'red'} /><span>{complete ? 'Sample transcript complete' : 'Playing deterministic demo transcript…'}</span><span>DEMO only</span></div>
            </section>}

        {isReal
          ? <aside className="panel extracted-intel extracted-intel--governed">
              <div className="panel__header"><div><span className="panel-label">Governed completion</span><h2>Awaiting verified outcome</h2></div><ShieldCheck size={18} /></div>
              <div className="governance-message">
                <ShieldCheck size={24} />
                <strong>No model-authored price is executable</strong>
                <p>Realtime words appear only in the live transcript. Requirements, acceptance, and pricing advance the pipeline only after a server-side tool posts a policy-approved outcome correlated to this exact provider conversation.</p>
              </div>
              <div className="requirements-live">
                <div className="subhead"><span>Completion gates</span><em>server-side</em></div>
                {['Provider conversation ID bound', 'Tool secret authenticated', 'Business and scope validated', 'Campaign pricing policy enforced'].map((label, index) => (
                  <div key={label}><span className={index === 0 ? 'yes' : 'no'}>{index === 0 ? <Check size={12} /> : <Clock3 size={12} />}</span><strong>{label}</strong><em>{index === 0 ? 'On connect' : 'Pending'}</em></div>
                ))}
              </div>
              <div className="offer-box"><div className="offer-rule"><ShieldCheck size={15} /><span>Configure the ElevenLabs post-call server tool/webhook to complete REAL calls automatically.</span></div></div>
            </aside>
          : <aside className="panel extracted-intel">
              <div className="panel__header"><div><span className="panel-label">Demo sales intelligence</span><h2>Seeded intent</h2></div><Sparkles size={18} /></div>
              <div className="signal-cards"><div><span>Interest</span><strong className="high">High</strong><em>+12</em></div><div><span>Sentiment</span><strong>Positive</strong><HeartPulse size={16} /></div><div><span>Budget</span><strong>₹6k–₹8k</strong><CheckCircle2 size={16} /></div></div>
              <div className="requirements-live"><div className="subhead"><span>Seeded requirements</span><em>5 signals</em></div>{[['Menu', true], ['Gallery', true], ['WhatsApp ordering', true], ['Google Maps', true], ['Reservations', false]].map(([label, yes]) => <div key={String(label)}><span className={yes ? 'yes' : 'no'}>{yes ? <Check size={12} /> : <X size={12} />}</span><strong>{String(label)}</strong><em>{yes ? 'Required' : 'Declined'}</em></div>)}</div>
              <div className="design-extraction"><div><span>Brand style</span><strong>Modern / Premium</strong></div><div><span>Primary colour</span><strong><i className="color-swatch" /> Warm / Dark</strong></div><div><span>Customer priority</span><strong>Mobile users</strong></div></div>
              <div className="offer-box"><div><span>Current offer</span><strong>₹7,999</strong></div><div><span>Approved floor</span><strong>₹7,200</strong></div><div className="offer-rule"><ShieldCheck size={15} /><span>Pricing policy enforced by backend rules</span></div></div>
              {complete && <div className="deal-won"><div><Check size={20} /></div><span><small>Demo deal won</small><strong>₹7,200</strong><em>Seeded scope approved</em></span></div>}
            </aside>}
      </div>}
    </div>
  );
}

function Leads({ navigate, setSelectedBusinessId, setIntelligenceOpen }: PageProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [qualifiedOnly, setQualifiedOnly] = useState(false);
  const filtered = businesses.filter((business) => (category === 'All' || business.category === category) && (!qualifiedOnly || business.qualified) && `${business.name} ${business.area}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="page leads-page">
      <SectionHeading eyebrow="Acquisition database" title="Leads" copy="Qualified opportunity with CRM and lifecycle context — not another disconnected prospect list." action={<div className="heading-actions"><Button tone="secondary" icon={<UploadCloud size={15} />}>Export</Button><Button icon={<Search size={15} />} onClick={() => navigate('discover')}>Discover businesses</Button></div>} />
      <div className="lead-summary-strip">{[['All leads', '186', '+14 today'], ['Outreach ready', '46', '24.7%'], ['In conversation', '8', '4 live'], ['Pipeline value', '₹3.82L', '+18.4%']].map(([label, value, note], index) => <div key={label}><span className={`stat-symbol stat-symbol--${index}`}><Circle size={8} fill="currentColor" /></span><span><small>{label}</small><strong>{value}</strong></span><em>{note}</em></div>)}</div>
      <section className="panel data-panel">
        <div className="table-toolbar"><label className="quick-search"><Search size={15} /><input placeholder="Search business, area or ID" value={query} onChange={(event) => setQuery(event.target.value)} /></label><div><select value={category} onChange={(event) => setCategory(event.target.value)}><option>All</option><option>Restaurant</option><option>Salon</option><option>Garments</option><option>Mechanic</option></select><button type="button" className={qualifiedOnly ? 'active' : ''} onClick={() => setQualifiedOnly((value) => !value)}><Filter size={14} /> Qualified</button><button type="button"><CalendarDays size={14} /> Last 30 days</button></div><span>{filtered.length} demo rows</span></div>
        <div className="data-table-wrap"><table className="data-table leads-table"><thead><tr><th><input type="checkbox" aria-label="Select all leads" /></th><th>Business</th><th>Industry / territory</th><th>Presence</th><th>Opportunity</th><th>CRM stage</th><th>Deal value</th><th>Last activity</th><th /></tr></thead><tbody>
          {filtered.map((business, index) => {
            const stages = ['Qualified', 'Contact ready', 'Negotiating', 'Interested', 'Requirements'];
            const stage = index === 0 ? 'Negotiating' : stages[index % stages.length];
            return <tr key={business.id} onClick={() => { setSelectedBusinessId(business.id); setIntelligenceOpen(true); }}><td onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Select ${business.name}`} /></td><td><div className="table-business"><div className={`table-icon table-icon--${business.category.toLowerCase()}`}><CategoryIcon category={business.category} /></div><span><strong>{business.name}</strong><small>{business.projectId ?? `AF-LEAD-${String(index + 21).padStart(4, '0')}`}</small></span></div></td><td><strong>{business.category}</strong><small>{business.area}, Chennai</small></td><td><span className={classNames('website-state', !business.website && 'missing')}><Globe2 size={13} />{business.website ? business.websiteQuality : 'Missing'}</span><small><Star size={11} fill="currentColor" /> {business.rating} · {business.reviews}</small></td><td><div className="score-cell"><strong>{business.opportunityScore}</strong><span><i style={{ width: `${business.opportunityScore}%` }} /></span></div></td><td><Pill tone={stage === 'Negotiating' ? 'live' : stage === 'Interested' ? 'success' : 'neutral'}>{stage}</Pill></td><td><strong>{business.qualified ? rupees.format(5999 + (index % 5) * 500) : '—'}</strong></td><td><span>{business.lastActivity}</span><small>{index % 2 ? 'Qualification Agent' : 'CRM Agent'}</small></td><td><ChevronRight size={16} /></td></tr>;
          })}
        </tbody></table></div>
        <div className="table-pagination"><span>Showing 1–{filtered.length} of 186 leads</span><div><button type="button" disabled><ArrowLeft size={14} /></button><button className="active" type="button">1</button><button type="button">2</button><button type="button">3</button><span>…</span><button type="button">7</button><button type="button"><ArrowRight size={14} /></button></div></div>
      </section>
    </div>
  );
}

function CRM({ navigate, state, providerHealth, apiStatus }: PageProps) {
  const crmHealth = providerHealth.find((provider) => provider.integration === 'crm');
  const [board, setBoard] = useState<CRMBoardSnapshot | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [loadingBoard, setLoadingBoard] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    if (apiStatus !== 'connected') {
      setBoard(null);
      setBoardError('The CRM mirror needs the AgentFront API connection.');
      return () => { active = false; };
    }
    setLoadingBoard(true);
    setBoardError(null);
    void getCRMBoard().then((snapshot) => {
      if (active) setBoard(snapshot);
    }).catch((error) => {
      if (active) setBoardError(error instanceof Error ? error.message : 'Unable to load CRM records.');
    }).finally(() => {
      if (active) setLoadingBoard(false);
    });
    return () => { active = false; };
  }, [apiStatus, refreshKey]);

  const crmIsReal = board?.mode === 'REAL' || (board === null && crmHealth?.mode === 'REAL');
  const stages = ['Qualified', 'Contacted', 'Interested', 'Negotiating', 'Won / Building'];
  const stageForDeal = (stage: string): string => {
    const normalized = stage.trim().toLowerCase();
    if (/won|closed won|deployed|building/.test(normalized)) return 'Won / Building';
    if (/negotiat/.test(normalized)) return 'Negotiating';
    if (/interest/.test(normalized)) return 'Interested';
    if (/contact/.test(normalized)) return 'Contacted';
    return 'Qualified';
  };
  const deals = board?.deals ?? [];
  const columns = stages.map((label) => {
    const columnDeals = deals.filter((deal) => stageForDeal(deal.stage) === label);
    return { label, deals: columnDeals, total: columnDeals.reduce((sum, deal) => sum + deal.amount, 0) };
  });
  const wonDeals = columns.find((column) => column.label === 'Won / Building')?.deals ?? [];
  const openDeals = deals.filter((deal) => !wonDeals.includes(deal));
  const openValue = openDeals.reduce((sum, deal) => sum + deal.amount, 0);
  const weightedValue = openDeals.reduce((sum, deal) => sum + deal.amount * 0.5, 0);
  const wonValue = wonDeals.reduce((sum, deal) => sum + deal.amount, 0);
  return (
    <div className="page crm-page">
      <SectionHeading eyebrow={`${crmIsReal ? 'Freshworks read-only mirror' : 'Demo CRM adapter'} · ${apiStatus === 'connected' ? 'server connected' : 'browser offline'}`} title="Client lifecycle" copy="Deal records below are loaded from the configured CRM adapter. No seeded portfolio records are mixed into this board." action={<div className="heading-actions"><Pill tone={crmIsReal ? 'success' : 'demo'}>{crmIsReal ? <CheckCircle2 size={12} /> : <Sparkles size={12} />} {crmIsReal ? 'Freshworks live data' : 'Demo adapter'}</Pill><Button disabled={!board?.consoleUrl} tone="secondary" icon={<ExternalLink size={15} />} onClick={() => { if (board?.consoleUrl) window.open(board.consoleUrl, '_blank', 'noopener,noreferrer'); }}>Open Freshworks</Button></div>} />
      <div className="crm-summary">{[
        ['Open pipeline', rupees.format(openValue), `${openDeals.length} live deal${openDeals.length === 1 ? '' : 's'}`],
        ['Weighted value', rupees.format(weightedValue), '50% board projection'],
        ['Won / building', String(wonDeals.length), rupees.format(wonValue)],
        ['Sync source', board?.provider ?? 'Checking', crmHealth?.status ?? 'Not checked'],
      ].map(([label, value, note], index) => <div key={label}><span className={`metric-icon metric-icon--${index}`}><CircleDollarSign size={17} /></span><span><small>{label}</small><strong>{value}</strong><em>{note}</em></span></div>)}</div>
      <div className="crm-board-head"><div><button className="active" type="button">Pipeline board</button><span>Read-only provider mirror</span></div><div><Button tone="ghost" icon={<RefreshCw size={14} />} onClick={() => setRefreshKey((value) => value + 1)} disabled={loadingBoard}>Refresh records</Button></div></div>
      <div className="crm-board">
        {columns.map((column, columnIndex) => <section className="crm-column" key={column.label}><div className="crm-column__head"><span><Dot tone={columnIndex < 2 ? 'muted' : columnIndex < 4 ? 'blue' : 'green'} /><strong>{column.label}</strong><em>{column.deals.length}</em></span><small>{rupees.format(column.total)}</small></div><div className="crm-column__deals">{column.deals.map((deal, index) => <article className="deal-card" key={deal.id} onClick={() => { if (deal.url) window.open(deal.url, '_blank', 'noopener,noreferrer'); }}><div><Avatar name={deal.name} tone={columnIndex + index} /><Pill tone={crmIsReal ? 'success' : 'demo'}>{deal.id}</Pill></div><h3>{deal.name}</h3><p>{deal.accountName ?? deal.contactName ?? 'CRM account'} · {deal.stage}</p><div><strong>{rupees.format(deal.amount)}</strong><span><Clock3 size={12} /> {deal.updatedAt ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(new Date(deal.updatedAt)) : 'Synced now'}</span></div><div className="deal-card__sync"><RefreshCw size={12} /> {board?.provider ?? 'CRM adapter'} · {crmIsReal ? 'external record' : 'demo record'}</div></article>)}{column.deals.length === 0 && <p className="add-deal">{loadingBoard ? 'Loading CRM records…' : boardError ?? 'No records in this stage.'}</p>}</div><span className="add-deal"><ListFilter size={14} /> Read-only mirror</span></section>)}
      </div>
    </div>
  );
}

function Campaigns({ state, setToast, changeCampaignStatus }: PageProps) {
  const [editing, setEditing] = useState(false);
  const status = state.campaignStatus;
  return (
    <div className="page campaigns-page">
      <SectionHeading eyebrow="Acquisition policy" title="Campaigns" copy="Define the market and commercial guardrails. Agents decide execution within founder-approved policy." action={<Button icon={<Plus size={15} />}>New campaign</Button>} />
      <section className="campaign-hero panel">
        <div className="campaign-hero__top"><div><Pill tone={status === 'running' ? 'success' : status === 'paused' ? 'warning' : 'danger'}><Dot pulse={status === 'running'} tone={status === 'running' ? 'green' : status === 'paused' ? 'amber' : 'red'} /> {status}</Pill><Pill tone="demo">Demo campaign</Pill><h2>AgentFront Stage 1 Demo</h2><p>High-intent local businesses across Chennai's OMR corridor.</p></div><div className="campaign-actions"><Button tone="secondary" icon={<Settings size={15} />} onClick={() => setEditing((value) => !value)}>Edit policy</Button>{status === 'running' ? <Button tone="secondary" icon={<Pause size={15} />} onClick={() => void changeCampaignStatus('paused')}>Pause</Button> : <Button icon={<Play size={15} />} onClick={() => void changeCampaignStatus('running')}>Start campaign</Button>}</div></div>
        <div className="campaign-progress"><div><span>Daily outreach</span><strong>18 <small>/ 25 calls</small></strong></div><div className="campaign-progress__bar"><span style={{ width: '72%' }} /></div><div><span>Window 10:00–19:00 IST</span><span>6h 12m remaining</span></div></div>
        <div className="campaign-kpis">{[['32', 'Discovered today'], ['14', 'Qualified'], ['6', 'Contacted'], ['3', 'Interested'], ['₹38.4k', 'Pipeline created']].map(([value, label]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>
      </section>
      <div className="campaign-layout">
        <section className="panel policy-panel"><div className="panel__header"><div><span className="panel-label">Qualification policy</span><h2>Target market</h2></div><Pill tone="neutral"><ShieldCheck size={12} /> Policy v2.4</Pill></div>
          <div className="policy-form">
            <label><span>Campaign name</span><input value="AgentFront Stage 1 Demo" readOnly={!editing} onChange={() => undefined} /></label>
            <div className="form-row"><label><span>Locations</span><div className="tag-input"><span>Sholinganallur <X size={11} /></span><span>Velachery <X size={11} /></span><span>OMR <X size={11} /></span></div></label><label><span>Target industries</span><div className="tag-input"><span>Restaurant <X size={11} /></span><span>Salon <X size={11} /></span></div></label></div>
            <div className="form-row form-row--3"><label><span>Minimum rating</span><input value="3.5 stars" readOnly /></label><label><span>Minimum reviews</span><input value="20" readOnly /></label><label><span>Opportunity score</span><input value="75 / 100" readOnly /></label></div>
            <label><span>Website requirement</span><div className="segmented"><button className="active" type="button">Missing / poor</button><button type="button">Missing only</button><button type="button">Any</button></div></label>
          </div>
        </section>
        <section className="panel policy-panel"><div className="panel__header"><div><span className="panel-label">Commercial controls</span><h2>Outreach & pricing</h2></div><Pill tone="success">Enforced server-side</Pill></div>
          <div className="commercial-rule"><span><Phone size={16} /><span><small>Maximum calls per day</small><strong>25</strong></span></span><span><Clock3 size={16} /><span><small>Allowed calling window</small><strong>10:00–19:00</strong></span></span></div>
          <div className="price-policy"><div><span>Approved price range</span><strong>₹5,999 — ₹11,999</strong></div><div className="price-range"><span /><i className="min" /><i className="max" /></div><div><small>Negotiation floor</small><small>Package ceiling</small></div></div>
          <div className="automation-rule"><div><span className="toggle-off" /><span><strong>Automatic processing</strong><small>Manual approval required for demo</small></span></div><Pill tone="warning">Off</Pill></div>
        </section>
      </div>
      {editing && <div className="save-bar"><span><Circle size={8} fill="currentColor" /> You have unsaved policy changes</span><div><Button tone="ghost" onClick={() => setEditing(false)}>Cancel</Button><Button onClick={() => { setEditing(false); setToast('Campaign policy saved as version 2.5.'); }}>Save policy</Button></div></div>}
    </div>
  );
}

function Projects({ navigate, state, marketBusinesses, startPipeline }: PageProps) {
  const spiceStatus = state.pipelineStep >= 10 ? 'Deployed' : state.pipelineStep >= 9 ? 'Deploying' : state.pipelineStep >= 8 ? 'QA' : state.pipelineStep >= 7 ? 'Building' : state.pipelineStep >= 6 ? 'Spec ready' : 'Awaiting deal';
  const demoBuildTargets = ['Kaveri Silks', 'Studio Bloom', 'Torque Works']
    .map((name) => marketBusinesses.find((business) => business.name === name))
    .filter((business): business is Business => Boolean(business));
  const projects = [
    { id: 'AF-2026-000001', name: 'SpiceRoute Kitchen', category: 'Restaurant', value: state.pipelineStep >= 6 ? '₹7,200' : '₹7,999 quoted', status: spiceStatus, progress: Math.max(10, state.pipelineStep * 10), agent: state.pipelineStep >= 9 ? 'Deployment Adapter' : state.pipelineStep >= 8 ? 'QA Engine' : state.pipelineStep >= 7 ? 'Developer Agent' : 'Orchestrator', template: 'Restaurant v1', business: undefined as Business | undefined },
    ...demoBuildTargets.map((business) => ({
      id: business.id,
      name: business.name,
      category: business.category,
      value: business.category === 'Garments' ? '₹9,999' : business.category === 'Salon' ? '₹8,499' : '₹7,999',
      status: 'Ready for live demo', progress: 0, agent: 'Sales Agent', template: `${business.category} v1`, business,
    })),
  ];
  return (
    <div className="page projects-page">
      <SectionHeading eyebrow="Digital delivery" title="Projects" copy="Every won deal becomes a validated specification, controlled build and observable deployment." action={<div className="heading-actions"><Button tone="secondary" icon={<Filter size={15} />}>Filter</Button><Button icon={<Plus size={15} />}>New project</Button></div>} />
      <div className="project-summary">{[['4', 'Active projects'], ['2', 'Building now'], ['96', 'Average QA score'], ['03m 42s', 'Average build time']].map(([value, label], i) => <div key={label}><span className={`metric-icon metric-icon--${i}`}><FileCode2 size={17} /></span><span><strong>{value}</strong><small>{label}</small></span></div>)}</div>
      <div className="project-grid">{projects.map((project, index) => <article className={classNames('project-card panel', index === 0 && 'project-card--featured')} key={project.id} onClick={() => index === 0 ? navigate('pipeline') : undefined}><div className="project-card__top"><div className={`project-brand project-brand--${project.category.toLowerCase()}`}><CategoryIcon category={project.category as Business['category']} /></div><div><code>{project.id}</code><h2>{project.name}</h2><p>{project.category} · {project.template}</p></div><IconButton label="More project actions"><MoreHorizontal size={17} /></IconButton></div><div className="project-card__commercial"><div><span>Deal value</span><strong>{project.value}</strong></div><Pill tone={project.status === 'Deployed' ? 'success' : project.status === 'Ready for live demo' ? 'live' : 'neutral'}><Dot pulse={project.status === 'Ready for live demo'} tone={project.status === 'Deployed' ? 'green' : project.status === 'Ready for live demo' ? 'blue' : 'muted'} /> {project.status}</Pill></div><div className="project-card__progress"><div><span>Delivery progress</span><strong>{project.progress}%</strong></div><div><span style={{ width: `${project.progress}%` }} /></div></div><div className="project-checks"><span><CheckCircle2 size={14} /> Requirements <strong>{project.status === 'Ready for live demo' ? 'Live chat' : '4 / 4'}</strong></span><span className={project.progress > 75 ? '' : 'muted'}><ClipboardCheck size={14} /> QA <strong>{project.progress > 75 ? 'Running' : 'Pending'}</strong></span><span className={project.status === 'Deployed' ? '' : 'muted'}><Rocket size={14} /> Deploy <strong>{project.status === 'Deployed' ? 'Live' : 'Pending'}</strong></span></div><div className="project-card__agent"><div className="agent-orb"><Bot size={16} /></div><span><small>Currently assigned</small><strong>{project.agent}</strong></span>{project.business ? <Button className="project-launch" icon={<Play size={14} />} onClick={() => void startPipeline(project.business)}>Run live flow</Button> : <em>{project.status === 'Queued' ? 'Waiting' : 'Working…'}</em>}</div></article>)}</div>
    </div>
  );
}

function Deployments({ navigate, setToast, state, deploymentUrl, providerHealth, refreshIntegrations, dashboardLeads }: PageProps) {
  const spiceRouteDeployed = state.pipelineStep >= pipelineBlueprint.length;
  const deploymentHealth = providerHealth.find((provider) => provider.integration === 'deployment');
  const realDeploymentUrl = deploymentHealth?.mode === 'REAL' && deploymentHealth.status === 'CONNECTED'
    ? deploymentUrl
    : null;
  const adapterDegraded = deploymentHealth?.status === 'DEGRADED' || deploymentHealth?.status === 'NOT_CONFIGURED';
  const deployments = dashboardLeads
    .filter((aggregate) => aggregate.deployment)
    .map((aggregate) => ({
      name: aggregate.business?.name ?? aggregate.lead.projectId,
      url: aggregate.deployment!.url,
      provider: aggregate.deployment!.provider ?? deploymentHealth?.provider ?? 'Deployment provider',
      status: aggregate.deployment!.status ?? 'DEPLOYED',
      id: aggregate.lead.projectId,
      qa: aggregate.project?.qaStatus === 'PASSED' ? 'Deterministic QA passed' : 'Release record from API',
      time: 'API source of record',
      mode: aggregate.deployment!.providerMode ?? 'DEMO',
    }));
  if (deployments.length === 0) deployments.push({
    name: 'SpiceRoute Kitchen',
    url: spiceRouteDeployed ? realDeploymentUrl ?? '/generated-sites/AF-2026-000001/index.html' : 'Awaiting autonomous delivery',
    provider: deploymentHealth?.provider ?? 'AgentFront demo deployment',
    status: spiceRouteDeployed ? realDeploymentUrl ? 'DEPLOYED' : 'BUNDLED DEMO' : 'QUEUED',
    id: 'AF-2026-000001', qa: spiceRouteDeployed ? 'All deterministic release gates passed' : 'Release gates pending',
    time: spiceRouteDeployed ? 'Latest canonical run' : 'Pending', mode: realDeploymentUrl ? 'REAL' : 'DEMO',
  });

  function openDeployment(_id: string, url: string) {
    if (url.startsWith('/')) {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        window.open(parsed.href, '_blank', 'noopener,noreferrer');
        return;
      }
    } catch { /* Render the API record but do not open malformed provider output. */ }
    setToast('This deployment does not have an openable runtime URL yet.');
  }

  const adapterLabel = deploymentHealth
    ? `${deploymentHealth.mode} · ${deploymentHealth.status}`
    : 'Health not reported';

  return (
    <div className="page deployments-page">
      <SectionHeading eyebrow="Release operations" title="Deployments" copy="Canonical release state from the API alongside clearly labelled seeded portfolio examples." action={<Button tone="secondary" icon={<RefreshCw size={15} />} onClick={() => void refreshIntegrations()}>Refresh health</Button>} />
      <div className="deployment-health panel"><div className="health-score"><span>{adapterDegraded ? <AlertTriangle size={28} /> : <Cloud size={28} />}</span><div><small>Deployment adapter</small><strong>{adapterLabel}</strong><p>{deploymentHealth?.message ?? 'Start the API to inspect deployment provider health.'}</p></div></div><div className="provider-health"><div><span><Dot tone={deployments.some((item) => item.mode === 'REAL') ? 'green' : 'amber'} /> Runtime releases</span><strong>{deployments.filter((item) => item.mode === 'REAL').length} provider URL{deployments.filter((item) => item.mode === 'REAL').length === 1 ? '' : 's'}</strong></div><div><span><Dot tone="blue" /> API release records</span><strong>{deployments.length} deployed project{deployments.length === 1 ? '' : 's'}</strong></div><div><span><Dot tone={adapterDegraded ? 'amber' : 'green'} /> Health status</span><strong>{deploymentHealth?.status ?? 'Unavailable'}</strong></div></div><div className="uptime"><span>Health checked</span><strong>{deploymentHealth ? formatEventTime(deploymentHealth.checkedAt, true) : 'Not available'}</strong><small>No synthetic uptime claim</small></div></div>
      <section className="panel data-panel">
        <div className="table-toolbar"><label className="quick-search"><Search size={15} /><input placeholder="Search deployment" /></label><div><button type="button"><Filter size={14} /> Provider</button><button type="button"><CalendarDays size={14} /> History</button></div><Pill tone={deployments.some((item) => item.mode === 'REAL') ? 'success' : 'demo'}>{deployments.some((item) => item.mode === 'REAL') ? 'Provider releases' : 'Bundled demo release'}</Pill></div>
        <div className="data-table-wrap"><table className="data-table deployments-table"><thead><tr><th>Website</th><th>Project ID</th><th>Provider</th><th>Status</th><th>Release / QA</th><th>Source time</th><th /></tr></thead><tbody>{deployments.map((deployment) => <tr key={deployment.id}><td><div className="site-cell"><span className="site-thumbnail"><Globe2 size={18} /></span><span><strong>{deployment.name}</strong><small>{deployment.url}</small></span></div></td><td><code>{deployment.id}</code></td><td><span className="provider-cell"><Cloud size={14} />{deployment.provider}</span></td><td><Pill tone={deployment.mode === 'REAL' ? 'success' : 'demo'}><Dot tone={deployment.mode === 'REAL' ? 'green' : 'amber'} /> {deployment.status}</Pill></td><td><span className="qa-cell"><ShieldCheck size={14} /> {deployment.qa}</span></td><td><span>{deployment.time}</span></td><td><div className="row-actions"><IconButton label={deployment.id === 'AF-2026-000001' && spiceRouteDeployed ? 'Open generated website' : 'Inspect deployment record'} onClick={() => openDeployment(deployment.id, deployment.url)}><ExternalLink size={15} /></IconButton><IconButton label="Deployment actions"><MoreHorizontal size={15} /></IconButton></div></td></tr>)}</tbody></table></div>
      </section>
      <div className="deployment-callout"><Rocket size={19} /><div><strong>{deployments[0].name} release record available</strong><span>{deployments[0].mode === 'REAL' ? 'All deterministic release gates passed and the provider returned a runtime URL.' : 'All deterministic release gates passed; the bundled example is available.'}</span></div><Button tone="secondary" icon={<ExternalLink size={15} />} onClick={() => openDeployment(deployments[0].id, deployments[0].url)}>Open release</Button></div>
    </div>
  );
}

function Agents({ navigate }: PageProps) {
  return (
    <div className="page agents-page">
      <SectionHeading eyebrow="Autonomous workforce" title="Agent performance" copy="A measurable operating team coordinated through the AgentFront orchestrator — never direct agent-to-agent coupling." action={<div className="heading-actions"><Pill tone="success"><Dot tone="green" pulse /> 5 online</Pill><Button tone="secondary" icon={<Settings size={15} />}>Policies</Button></div>} />
      <div className="agent-overview panel"><div className="orchestrator-core"><div className="core-rings"><Command size={28} /></div><span><small>Central coordinator</small><strong>AgentFront Orchestrator</strong><p>State machine healthy · 7 active workflows</p></span><Pill tone="success"><HeartPulse size={12} /> Nominal</Pill></div><div className="orchestrator-links">{agentRows.slice(0, 5).map((agent, index) => <div key={agent.name} className={`link-${index}`}><span /><em>{agent.name.replace(' Agent', '')}</em></div>)}</div><div className="orchestrator-stats"><div><span>Events / min</span><strong>48</strong></div><div><span>Queue depth</span><strong>12</strong></div><div><span>Success rate</span><strong>98.7%</strong></div><div><span>p95 latency</span><strong>284ms</strong></div></div></div>
      <div className="agent-grid">{agentRows.map((agent, index) => <article className="panel agent-card" key={agent.name}><div className="agent-card__head"><div className={`agent-identity agent-identity--${index}`}><Bot size={20} /></div><div><h3>{agent.name}</h3><p>{agent.role}</p></div><Pill tone={agent.status === 'live' ? 'live' : agent.status === 'working' ? 'success' : 'neutral'}><Dot pulse={agent.status !== 'idle'} tone={agent.status === 'live' ? 'red' : agent.status === 'working' ? 'green' : 'muted'} /> {agent.status}</Pill></div><div className="agent-card__metrics"><div><span>Output</span><strong>{agent.metric}</strong></div><div><span>Performance</span><strong>{agent.success}</strong></div></div><div className="agent-load"><div><span>Current utilization</span><strong>{agent.load}%</strong></div><div><span style={{ width: `${agent.load}%` }} /></div></div><button type="button" onClick={() => navigate('activity')}>Inspect activity <ArrowRight size={14} /></button></article>)}</div>
      <section className="panel agent-events"><div className="panel__header"><div><span className="panel-label">Performance ledger</span><h2>Last 24 hours</h2></div><select><option>All components</option></select></div><div className="performance-table"><div className="performance-row performance-row--head"><span>Component</span><span>Runs</span><span>Success</span><span>Avg duration</span><span>Retries</span><span>Cost</span></div>{agentRows.map((agent, i) => <div className="performance-row" key={agent.name}><span><Dot tone={i === 4 ? 'muted' : 'green'} />{agent.name}</span><strong>{[1286, 186, 42, 13, 156, 11][i]}</strong><strong>{[99.8, 98.9, 95.2, 92.3, 98.1, 100][i]}%</strong><span>{['1.2s', '0.8s', '4m 31s', '3m 42s', '18.4s', '42s'][i]}</span><span>{[2, 1, 2, 1, 3, 0][i]}</span><span>{i === 2 ? '₹184' : i === 3 ? '₹96' : '—'}</span></div>)}</div></section>
    </div>
  );
}

function Analytics() {
  const [period, setPeriod] = useState('30 days');
  const industries = [
    { name: 'Restaurants', deals: 6, revenue: 48600, color: 'var(--accent)' },
    { name: 'Salons', deals: 3, revenue: 25400, color: 'var(--blue)' },
    { name: 'Garments', deals: 2, revenue: 16800, color: 'var(--violet)' },
    { name: 'Mechanics', deals: 2, revenue: 15400, color: 'var(--amber)' },
  ];
  return (
    <div className="page analytics-page">
      <SectionHeading eyebrow="Business intelligence" title="Analytics" copy="The economics and throughput of an autonomous digital agency." action={<div className="heading-actions"><select className="period-select" value={period} onChange={(event) => setPeriod(event.target.value)}><option>7 days</option><option>30 days</option><option>90 days</option></select><Button tone="secondary" icon={<UploadCloud size={15} />}>Export report</Button></div>} />
      <div className="analytics-kpis">{[['₹1,24,800', 'Revenue earned', '+18.4%', true], ['30.9%', 'Conversation close rate', '+4.2%', true], ['₹7,342', 'Average deal value', '+₹384', true], ['03m 42s', 'Average build time', '−22s', true], ['14.5%', 'Qualification rate', '−1.3%', false]].map(([value, label, delta, good], i) => <div className="panel" key={String(label)}><span>{String(label)}</span><strong>{String(value)}</strong><em className={good ? 'positive' : 'negative'}>{good ? <ArrowUpRight size={13} /> : <ArrowDown size={13} />}{String(delta)}</em>{i === 0 && <Sparkline />}</div>)}</div>
      <div className="analytics-grid">
        <section className="panel revenue-analytics"><div className="panel__header"><div><span className="panel-label">Revenue over time</span><h2>₹1.24L realized</h2></div><div className="chart-legend"><span><i /> Realized</span><span><i /> Pipeline</span></div></div><div className="line-chart"><div className="line-chart__grid"><span>₹20k</span><span>₹15k</span><span>₹10k</span><span>₹5k</span><span>₹0</span></div><svg viewBox="0 0 600 210" preserveAspectRatio="none" aria-label="Revenue trend chart"><defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity=".24" /><stop offset="100%" stopColor="var(--accent)" stopOpacity="0" /></linearGradient></defs><path className="chart-area" d="M0 185 C45 172 65 180 105 150 S165 155 205 125 S265 142 310 108 S360 115 405 82 S470 102 510 59 S565 66 600 31 L600 210 L0 210Z" /><path className="chart-line" d="M0 185 C45 172 65 180 105 150 S165 155 205 125 S265 142 310 108 S360 115 405 82 S470 102 510 59 S565 66 600 31" /><path className="chart-pipeline" d="M0 163 C80 148 120 160 190 118 S280 121 350 84 S460 75 600 22" /></svg><div className="line-chart__labels"><span>Jul 25</span><span>Aug 1</span><span>Aug 8</span><span>Aug 15</span><span>Aug 22</span></div></div></section>
        <section className="panel funnel-panel"><div className="panel__header"><div><span className="panel-label">Acquisition funnel</span><h2>Discover to deploy</h2></div><Pill tone="success">0.86% end-to-end</Pill></div><div className="funnel-chart">{funnel.map((stage, index) => <div key={stage.label}><span>{stage.label}</span><div><i style={{ width: `${Math.max(10, (stage.value / funnel[0].value) * 100)}%` }}><em>{stage.value.toLocaleString('en-IN')}</em></i></div>{index < funnel.length - 1 && <small>{Math.round((funnel[index + 1].value / stage.value) * 100)}%</small>}</div>)}</div></section>
        <section className="panel industry-panel"><div className="panel__header"><div><span className="panel-label">Revenue mix</span><h2>By industry</h2></div><span>13 deals</span></div><div className="donut-wrap"><div className="donut-chart"><div><strong>₹1.06L</strong><span>closed value</span></div></div><div className="donut-legend">{industries.map((industry) => <div key={industry.name}><i style={{ background: industry.color }} /><span><strong>{industry.name}</strong><small>{industry.deals} deals</small></span><em>{rupees.format(industry.revenue)}</em></div>)}</div></div></section>
        <section className="panel territory-analytics"><div className="panel__header"><div><span className="panel-label">Territory performance</span><h2>OMR leads the market</h2></div><MapPin size={18} /></div>{[['Sholinganallur', 92, '₹42.6k', '38 leads'], ['Velachery', 73, '₹31.4k', '29 leads'], ['Navalur', 61, '₹22.8k', '24 leads'], ['Perungudi', 48, '₹18.2k', '21 leads']].map(([name, width, value, leads], index) => <div className="territory-row" key={name}><span><em>{index + 1}</em><strong>{name}</strong><small>{leads}</small></span><div><i style={{ width: `${width}%` }} /></div><strong>{value}</strong></div>)}</section>
      </div>
    </div>
  );
}

function ActivityPage({ navigate, activityEvents, apiStatus }: PageProps) {
  const [search, setSearch] = useState('');
  const [live, setLive] = useState(true);
  const [pausedEvents, setPausedEvents] = useState<ActivityEvent[] | null>(null);
  const displayedEvents = live ? activityEvents : pausedEvents ?? activityEvents;
  const events = displayedEvents.filter((event) =>
    `${event.agent} ${event.eventType} ${event.message} ${event.projectId ?? ''} ${event.leadId ?? ''} ${event.campaignId ?? ''}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const durationSamples = events.filter((event) => event.durationMs !== null).length;
  const errorCount = events.filter((event) => event.status === 'ERROR').length;
  const componentCount = new Set(events.map((event) => event.agent)).size;
  const toggleLive = () => {
    if (live) {
      setPausedEvents(activityEvents);
      setLive(false);
      return;
    }
    setPausedEvents(null);
    setLive(true);
  };
  return (
    <div className="page activity-page">
      <SectionHeading eyebrow="Observability" title="Activity & structured logs" copy="Inspect API events without synthesizing timestamps, outcomes, correlation IDs or durations." action={<div className="heading-actions"><Pill tone={apiStatus === 'connected' && live ? 'live' : apiStatus === 'offline' ? 'demo' : 'neutral'}><Dot pulse={apiStatus === 'connected' && live} tone={apiStatus === 'connected' ? 'green' : 'amber'} /> {apiStatus === 'connected' ? live ? 'API event stream' : 'Display paused' : 'Seeded event history'}</Pill><Button tone="secondary" icon={live ? <Pause size={15} /> : <Play size={15} />} onClick={toggleLive}>{live ? 'Pause display' : 'Resume display'}</Button></div>} />
      <div className="log-health">{[[String(events.length), 'Events in view'], [String(componentCount), 'Components represented'], [String(errorCount), 'Errors in view'], [String(durationSamples), 'Measured durations']].map(([value, label], i) => <div key={label}><span className={`metric-icon metric-icon--${i}`}><Activity size={16} /></span><span><strong>{value}</strong><small>{label}</small></span></div>)}</div>
      <section className="panel log-console"><div className="log-toolbar"><label className="quick-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search event, correlation ID or component" /></label><div><Pill tone={apiStatus === 'connected' ? 'success' : 'demo'}>{apiStatus === 'connected' ? 'API records' : 'Seeded demo records'}</Pill></div></div><div className="log-stream"><div className="log-stream__head"><span>Timestamp (IST)</span><span>Component / correlation</span><span>Event</span><span>Status</span><span>Duration</span><span /></div>{events.map((event) => { const correlationId = event.projectId ?? event.leadId ?? event.campaignId; return <div className="log-row" key={event.id}><time dateTime={event.createdAt}>{formatEventTime(event.createdAt, true)}</time><div><strong>{event.agent}</strong><code>{correlationId ?? 'No correlation ID'}</code></div><p title={`${event.eventType}: ${event.message}`}>{event.message}</p><Pill tone={activityTone(event.status)}>{event.status}</Pill><span>{event.durationMs === null ? 'Not reported' : `${event.durationMs} ms`}</span><IconButton label={`Event type: ${event.eventType}`}><ChevronRight size={15} /></IconButton></div>; })}</div><div className="log-footer"><span><Dot pulse={apiStatus === 'connected' && live} tone={apiStatus === 'connected' && live ? 'green' : 'muted'} /> {apiStatus === 'connected' ? live ? 'Listening for orchestrator events' : 'Display snapshot paused; source may continue' : live ? 'Showing labelled seeded history' : 'Seeded display paused'}</span><button type="button" onClick={() => navigate('pipeline')}>Open project pipeline <ArrowRight size={14} /></button></div></section>
    </div>
  );
}

function SettingsPage({ state, setState, resetJourney, setToast, providerHealth, persistenceHealth, apiStatus, refreshIntegrations }: PageProps) {
  const [tab, setTab] = useState('Workspace');
  const [saved, setSaved] = useState(false);
  const [toggles, setToggles] = useState({ alerts: true, errors: true, revenue: true, crm: false, autoRetry: true });
  const toggle = (key: keyof typeof toggles) => setToggles((current) => ({ ...current, [key]: !current[key] }));
  const integrationDefinitions: Array<{ key: IntegrationHealth['integration']; name: string; role: string; Icon: LucideIcon }> = [
    { key: 'places', name: 'Google Places', role: 'Market discovery', Icon: Map },
    { key: 'crm', name: 'Freshworks', role: 'Accounts, contacts & deals', Icon: Building2 },
    { key: 'conversation', name: 'ElevenLabs', role: 'Realtime sales conversations', Icon: Headphones },
    { key: 'developer', name: 'Codex CLI', role: 'Website customization', Icon: TerminalSquare },
    { key: 'deployment', name: 'Deployment', role: 'Provider-neutral releases', Icon: Cloud },
  ];
  return (
    <div className="page settings-page">
      <SectionHeading eyebrow="System control" title="Settings" copy="Browser preferences, reported provider health and the production controls that require operator review." action={<Button icon={<Check size={15} />} onClick={() => { setSaved(true); setToast('Local UI preview applied. Provider credentials and backend policy remain environment-controlled.'); window.setTimeout(() => setSaved(false), 2000); }}>{saved ? 'Applied locally' : 'Apply local preview'}</Button>} />
      <div className="settings-layout">
        <aside className="settings-nav panel">{['Workspace', 'Integrations', 'AI & agents', 'Commercial policy', 'Notifications', 'Security', 'Demo mode'].map((item) => <button className={tab === item ? 'active' : ''} type="button" key={item} onClick={() => setTab(item)}>{item === 'Workspace' ? <Building2 size={16} /> : item === 'Integrations' ? <Layers3 size={16} /> : item === 'AI & agents' ? <Bot size={16} /> : item === 'Commercial policy' ? <IndianRupee size={16} /> : item === 'Notifications' ? <Bell size={16} /> : item === 'Security' ? <ShieldCheck size={16} /> : <Sparkles size={16} />}<span>{item}</span><ChevronRight size={14} /></button>)}</aside>
        <div className="settings-content">
          {tab === 'Workspace' && <><section className="panel settings-section"><div className="settings-section__head"><div><h2>Workspace profile</h2><p>Used across campaign reports and founder operations.</p></div></div><div className="workspace-profile"><div className="large-brand"><BrandMark compact /></div><div><Button tone="secondary">Change logo</Button><small>SVG or PNG · maximum 2 MB</small></div></div><div className="settings-form"><div className="form-row"><label><span>Workspace name</span><input defaultValue="AgentFront" /></label><label><span>Operating timezone</span><select defaultValue="Asia/Kolkata"><option>Asia/Kolkata</option><option>UTC</option></select></label></div><div className="form-row"><label><span>Founder name</span><input defaultValue="Kirthik Roshan" /></label><label><span>Default currency</span><select defaultValue="INR"><option>INR · Indian Rupee</option><option>USD · US Dollar</option></select></label></div></div></section><section className="panel settings-section"><div className="settings-section__head"><div><h2>Appearance</h2><p>Choose the control center theme. Your preference is stored locally.</p></div></div><div className="theme-choices"><button className={state.theme === 'dark' ? 'active' : ''} type="button" onClick={() => setState((current) => ({ ...current, theme: 'dark' }))}><span className="theme-preview theme-preview--dark"><i /><i /><i /></span><span><Moon size={15} /> Dark operations</span></button><button className={state.theme === 'light' ? 'active' : ''} type="button" onClick={() => setState((current) => ({ ...current, theme: 'light' }))}><span className="theme-preview theme-preview--light"><i /><i /><i /></span><span><Sun size={15} /> Light operations</span></button></div></section></>}
          {tab === 'Integrations' && <section className="panel settings-section"><div className="settings-section__head"><div><h2>Provider adapters</h2><p>Reported server-side health and data mode. DEMO records are never presented as live provider output.</p></div><Pill tone={apiStatus === 'connected' ? 'success' : apiStatus === 'offline' ? 'warning' : 'neutral'}>{apiStatus === 'connected' ? 'API connected' : apiStatus === 'offline' ? 'API offline' : 'Checking'}</Pill></div><div className={classNames('persistence-summary', persistenceHealth?.status === 'DEGRADED' && 'persistence-summary--danger')}><Database size={18} /><span><small>Persistence</small><strong>{persistenceHealth ? `${persistenceHealth.mode} · ${persistenceHealth.status}` : apiStatus === 'offline' ? 'Health unavailable' : 'Checking'}</strong><em>{persistenceHealth?.message ?? 'No persistence report received.'}</em></span></div><div className="integration-list">{integrationDefinitions.map(({ key, name, role, Icon }) => { const health = providerHealth.find((provider) => provider.integration === key); const degraded = health?.status === 'DEGRADED' || health?.status === 'NOT_CONFIGURED'; const label = health ? `${health.mode} · ${health.status}` : 'NOT CHECKED'; return <div key={key}><span className="integration-icon"><Icon size={19} /></span><span><strong>{name}</strong><small>{health?.message ?? (apiStatus === 'offline' ? 'Browser demo fallback; API health unavailable.' : role)}</small></span><code>{health?.provider ?? 'Not reported'}</code><Pill tone={degraded ? 'warning' : health?.mode === 'REAL' ? 'success' : 'demo'}><Dot tone={degraded ? 'amber' : health?.mode === 'REAL' ? 'green' : 'amber'} /> {label}</Pill><Button tone="ghost" onClick={() => void refreshIntegrations()}>Test</Button></div>; })}</div></section>}
          {tab === 'AI & agents' && <section className="panel settings-section"><div className="settings-section__head"><div><h2>Agent operations preview</h2><p>These Stage-1 controls are a browser-local policy preview; deploy backend policy changes through configuration.</p></div><Pill tone="demo"><Sparkles size={12} /> Local preview</Pill></div><div className="setting-rows">{[['Automatic safe retries', 'Preview transient-provider retry preference.', 'autoRetry'], ['Transcript retention preference', 'Preview transcript-retention intent; provider and database policy remain authoritative.', 'alerts'], ['Require schema validation', 'Preview the schema-validation requirement used by the delivery flow.', 'errors']].map(([name, copy, key]) => <div key={name}><span><strong>{name}</strong><small>{copy}</small></span><button className={toggles[key as keyof typeof toggles] ? 'toggle active' : 'toggle'} type="button" onClick={() => toggle(key as keyof typeof toggles)}><span /></button></div>)}</div></section>}
          {tab === 'Commercial policy' && <section className="panel settings-section"><div className="settings-section__head"><div><h2>Global commercial guardrails</h2><p>Sales agents cannot override these server-enforced bounds.</p></div></div><div className="settings-form"><div className="form-row"><label><span>Minimum project value</span><input defaultValue="₹5,999" /></label><label><span>Default negotiation floor</span><input defaultValue="₹7,200" /></label></div><label><span>Approval rule</span><select><option>Founder approval below negotiation floor</option></select></label></div><div className="security-callout"><ShieldCheck size={18} /><span><strong>LLMs never calculate final price</strong><small>Quotes and negotiation offers resolve through deterministic backend rules.</small></span></div></section>}
          {tab === 'Notifications' && <section className="panel settings-section"><div className="settings-section__head"><div><h2>Founder notifications</h2><p>Choose which operating events deserve your attention.</p></div></div><div className="setting-rows">{[['Deal won', 'Notify when a customer accepts an approved offer.', 'revenue'], ['Pipeline error', 'Notify immediately when a workflow requires intervention.', 'errors'], ['CRM sync delay', 'Notify if Freshworks falls more than five minutes behind.', 'crm'], ['Website deployed', 'Notify when production URL and QA report are available.', 'alerts']].map(([name, copy, key]) => <div key={name}><span><strong>{name}</strong><small>{copy}</small></span><button className={toggles[key as keyof typeof toggles] ? 'toggle active' : 'toggle'} type="button" onClick={() => toggle(key as keyof typeof toggles)}><span /></button></div>)}</div></section>}
          {tab === 'Security' && <section className="panel settings-section"><div className="settings-section__head"><div><h2>Security controls & deployment requirements</h2><p>This inventory describes implemented controls; it is not an independent security attestation.</p></div><Pill tone="warning"><AlertTriangle size={12} /> Review for production</Pill></div><div className="security-grid">{[['Founder access', 'HttpOnly signed session', ShieldCheck, false], ['Build containment', 'Ownership-bound workspace', CheckCircle2, false], ['Release validation', 'Schema + deterministic gates', ClipboardCheck, false], ['Tenant boundary', 'Container isolation required', AlertTriangle, true]].map(([name, value, Icon, warning]) => { const C = Icon as LucideIcon; return <div className={warning ? 'security-grid__warning' : undefined} key={String(name)}><C size={18} /><span><small>{String(name)}</small><strong>{String(value)}</strong></span></div>; })}</div><div className="security-callout security-callout--warning"><AlertTriangle size={18} /><span><strong>Workspace-write is not read isolation</strong><small>Run provider CLIs in a dedicated container or sandbox with tenant-specific credentials and filesystem boundaries before multi-tenant production use.</small></span></div></section>}
          {tab === 'Demo mode' && <section className="panel settings-section demo-settings"><div className="settings-section__head"><div><h2>Demo environment</h2><p>Seeded data is clearly identified and never presented as live provider data.</p></div><Pill tone="demo"><Sparkles size={12} /> {providerHealth.some((provider) => provider.mode === 'REAL') ? 'Hybrid fallback' : 'Active'}</Pill></div><div className="demo-banner"><div className="agent-orb"><Sparkles size={20} /></div><span><strong>32 seeded Chennai businesses</strong><small>8 restaurants · 8 salons · 8 garment shops · 8 mechanic workshops</small></span></div><Button tone="secondary" icon={<RefreshCw size={15} />} onClick={resetJourney}>Reset SpiceRoute view</Button></section>}
        </div>
      </div>
    </div>
  );
}

export default App;
