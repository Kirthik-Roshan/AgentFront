import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
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
  WandSparkles,
  X,
  XCircle,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import {
  activitySeed,
  businesses,
  pipelineBlueprint,
  revenueSeries,
  spiceRoute,
  transcriptSeed,
} from './data/demo';
import {
  dashboardProjection,
  discoverMarket,
  getCRMBoard,
  getDashboard,
  getIntegrationHealth,
  getSalesBusinessDetail,
  mapAgentEvent,
  mapDiscoveredBusinesses,
  mergeActivityEvents,
  pipelineStepForState,
  postSalesBusinessAction,
  startPipelineRun,
  setEmergencyStop,
  subscribeToAgentEvents,
  updateCampaign,
  type ApiConnectionState,
  type DashboardMetrics,
  type PipelineAggregate,
  type CRMBoardSnapshot,
  type DiscoveryMeta,
  type IntegrationHealth,
  type PersistenceHealth,
} from './api';
import { OpenStreetMapBusinessMap } from './OpenStreetMapBusinessMap';
import { LiveElevenLabsConversation } from './LiveElevenLabsConversation';
import { SalesOperations } from './features/sales/SalesOperations';
import type { SalesBusinessDetail as LiveSalesBusinessDetail } from './features/sales/types';
import { SpiceRouteDemo } from './features/SpiceRouteDemo';
import { SpiceRouteAdPreview } from './features/SpiceRouteAdPreview';
import { TemplateLibrary } from './features/TemplateLibrary';
import type { ActivityEvent, AppState, Business, PipelineStage, ViewKey } from './types';
import { BUSINESS_VERTICALS, resolveBusinessVertical } from '@agentfront/types';

const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const navigation: { label: string; items: { id: ViewKey; label: string; icon: LucideIcon; badge?: string }[] }[] = [
  {
    label: 'Command',
    items: [
      { id: 'overview', label: 'Overview', icon: LayoutDashboard },
      { id: 'discover', label: 'Discover', icon: Map, badge: '32' },
      { id: 'leads', label: 'Sales operations', icon: Target },
      { id: 'pipeline', label: 'Pipeline', icon: Layers3 },
    ],
  },
  {
    label: 'Operations',
    items: [
      { id: 'crm', label: 'CRM', icon: Building2 },
      { id: 'campaigns', label: 'Campaigns', icon: BriefcaseBusiness },
      { id: 'projects', label: 'Projects', icon: FileCode2, badge: '4' },
      { id: 'templates', label: 'Templates', icon: WandSparkles, badge: '4' },
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
  'overview', 'demo', 'discover', 'leads', 'pipeline', 'sales', 'crm', 'campaigns',
  'projects', 'templates', 'deployments', 'agents', 'analytics', 'activity', 'settings',
]);

function hashView(): ViewKey {
  const candidate = window.location.hash.replace(/^#\/?/, '') as ViewKey;
  return validViews.has(candidate) ? candidate : 'overview';
}

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

function SectionHeading({ eyebrow, title, copy, action }: { eyebrow?: string; title: ReactNode; copy?: string; action?: ReactNode }) {
  const words = typeof title === 'string' ? title.trim().split(/\s+/) : [];
  const styledTitle = typeof title !== 'string' ? title : words.length > 1
    ? <>{words.slice(0, -1).join(' ')} <span className="heading-accent">{words.at(-1)}</span></>
    : <>{title}<span className="heading-accent">.</span></>;
  return (
    <div className="section-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{styledTitle}</h1>
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
  const [providerHealth, setProviderHealth] = useState<IntegrationHealth[]>([]);
  const [persistenceHealth, setPersistenceHealth] = useState<PersistenceHealth | null>(null);
  const [dashboardMetrics, setDashboardMetrics] = useState<DashboardMetrics | null>(null);
  const [dashboardLeads, setDashboardLeads] = useState<PipelineAggregate[]>([]);
  const [workflows, setWorkflows] = useState<NonNullable<Awaited<ReturnType<typeof getDashboard>>['workflows']>>([]);
  const [agentRuns, setAgentRuns] = useState<NonNullable<Awaited<ReturnType<typeof getDashboard>>['agentRuns']>>([]);
  const [emergencyStopped, setEmergencyStopped] = useState(false);
  const [liveEvents, setLiveEvents] = useState<ActivityEvent[]>([]);
  const [activeLeadId, setActiveLeadId] = useState('lead-AF-2026-000001');
  const [activeProjectId, setActiveProjectId] = useState('AF-2026-000001');
  const [deploymentUrl, setDeploymentUrl] = useState<string | null>(null);
  const [salesCallStarting, setSalesCallStarting] = useState(false);

  const selectedBusiness = marketBusinesses.find((business) => business.id === selectedBusinessId) ?? spiceRoute;
  const persistenceBlocked = persistenceHealth?.durable === true && persistenceHealth.status === 'DEGRADED';

  const applyDashboard = useCallback((snapshot: Awaited<ReturnType<typeof getDashboard>>) => {
    const projection = dashboardProjection(snapshot);
    setDashboardMetrics(projection.metrics);
    setDashboardLeads(snapshot.leads ?? []);
    setWorkflows(snapshot.workflows ?? []);
    setAgentRuns(snapshot.agentRuns ?? []);
    setEmergencyStopped(Boolean(snapshot.emergencyStopped));
    setLiveEvents(projection.events);
    if (projection.activeLeadId) setActiveLeadId(projection.activeLeadId);
    if (projection.activeProjectId) setActiveProjectId(projection.activeProjectId);
    // Dashboard polling updates workflow state only. Discover selection is an
    // operator-owned UI state and must not jump back to the active pipeline
    // business while its intelligence drawer is open.
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
    const recoveryTimer = window.setInterval(() => void hydrate(), 5_000);
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
      // The event stream is optional observability. Its connection state must
      // never downgrade a healthy HTTP API into browser-demo mode.
      if (connected) setApiStatus('connected');
      scheduleHydration();
    });

    return () => {
      mounted = false;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      window.clearInterval(recoveryTimer);
      unsubscribe();
    };
  }, [applyDashboard]);

  const pipeline: PipelineStage[] = pipelineBlueprint.map((stage, index) => ({
    ...stage,
    status: index < state.pipelineStep ? 'complete' : index === state.pipelineStep && state.pipelineStep < pipelineBlueprint.length ? 'active' : 'queued',
    timestamp: undefined,
  }));

  function navigate(next: ViewKey) {
    setView(next);
    window.history.pushState(null, '', `#/${next}`);
    setMobileOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function startPipeline(requestedBusiness = selectedBusiness) {
    if (apiStatus !== 'connected') {
      setToast('API unavailable · cannot start work or simulate backend milestones.');
      return;
    }
    if (requestedBusiness.id === selectedBusiness.id && state.pipelineStep >= pipelineBlueprint.length) {
      setToast('Idempotency guard · This project is already deployed.');
      return;
    }
    if (persistenceBlocked) {
      setToast('PostgreSQL is degraded · operational commands are blocked until durable persistence recovers.');
      return;
    }
    setState((current) => ({
      ...current,
      campaignStatus: 'running',
      autoAdvance: false,
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
        setToast('API unavailable · no backend work was confirmed. Reconnect to check the durable record.');
      } else {
        setToast(error instanceof Error ? error.message : 'The pipeline command was rejected.');
      }
    }
  }

  async function approveAndCallWithSarvam(business: Business) {
    const telephony = providerHealth.find((provider) => provider.integration === 'telephony');
    if (apiStatus !== 'connected' || persistenceBlocked) {
      setToast('The durable AgentFront API must be connected before starting a sales call.');
      return;
    }
    if (!business.qualified || !business.phone || !business.phoneNumber) {
      setToast('This business must be qualified and have a Google Places phone number before calling.');
      return;
    }
    if (telephony?.mode !== 'REAL' || telephony.status !== 'CONNECTED' || !telephony.provider.toLowerCase().includes('sarvam')) {
      setToast('Sarvam/Vobiz is not connected. Open Settings → Integrations and test telephony first.');
      return;
    }
    const callTarget = business.source === 'DEMO'
      ? 'your configured personal demo number'
      : business.phoneNumber;
    const callMode = business.source === 'DEMO' ? 'DEMO TARGET' : 'REAL CLIENT';
    if (!window.confirm(`${callMode}: Call ${business.name} at ${callTarget} with Sarvam now? Confirm that this outreach is permitted. Calling hours are 10:00–19:00 IST.`)) return;
    setSalesCallStarting(true);
    setToast('Founder review accepted · reserving the Sarvam call');
    try {
      const detail = await getSalesBusinessDetail(business.id);
      const activeCall = detail.calls.find((call) => ['QUEUED', 'INITIATING', 'RINGING', 'IN_PROGRESS'].includes(call.status));
      if (activeCall || detail.business.salesState === 'CALLING') {
        setIntelligenceOpen(false);
        navigate('leads');
        setToast(`A Sarvam call is already ${activeCall?.status.toLowerCase() ?? 'active'} · tracking it in Sales operations.`);
        return;
      }
      const operationId = crypto.randomUUID();
      if (detail.business.salesState !== 'CALL_PENDING') {
        const queueableStates = new Set([
          'DISCOVERED', 'QUALIFIED', 'CALLBACK_REQUESTED', 'FOLLOW_UP_REQUIRED',
          'FOLLOW_UP_SCHEDULED', 'OWNER_CONTACT_IDENTIFIED',
        ]);
        if (!queueableStates.has(detail.business.salesState)) {
          throw new Error(`A new call cannot start while the sales workflow is ${detail.business.salesState}.`);
        }
        await postSalesBusinessAction(
          business.id,
          'queue',
          { campaignId: 'campaign-stage-1-demo' },
          `discover-review:${business.id}:${operationId}:queue`,
        );
      }
      await postSalesBusinessAction(
        business.id,
        'call',
        { campaignId: 'campaign-stage-1-demo', founderApproved: true, approvedPhone: business.phoneNumber },
        `discover-review:${business.id}:${operationId}:call`,
      );
      setIntelligenceOpen(false);
      navigate('leads');
      setToast('Real Sarvam call requested · open Sales operations to track its live status.');
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'The Sarvam call request failed.');
    } finally {
      setSalesCallStarting(false);
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
      setToast('AgentFront API is offline · workflow state is unavailable.');
    }
  }

  async function changeCampaignStatus(next: AppState['campaignStatus']) {
    if (apiStatus !== 'connected') {
      setToast('API unavailable · no campaign control can be confirmed.');
      return;
    }
    if (persistenceBlocked) {
      setToast('PostgreSQL is degraded · campaign commands are blocked until durable persistence recovers.');
      return;
    }
    try {
      if (next === 'running' && emergencyStopped) {
        const control = await setEmergencyStop(false);
        setEmergencyStopped(control.stopped);
        if (control.stopped) {
          throw new Error('The global emergency stop could not be cleared. Check persistence health and try again.');
        }
      }
      await updateCampaign(next === 'running' ? 'start' : next === 'paused' ? 'pause' : 'emergency-stop');
      setState((current) => ({ ...current, campaignStatus: next, autoAdvance: false }));
      if (next === 'stopped') setEmergencyStopped(true);
      setToast(next === 'stopped' ? 'Emergency stop acknowledged by the orchestrator.' : next === 'running' ? 'Emergency stop cleared · campaign running.' : `Campaign ${next} · API state synchronized.`);
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
    workflows,
    agentRuns,
    emergencyStopped,
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

  return (
    <div className={classNames('app-shell', sidebarCollapsed && 'app-shell--collapsed')}>
      <aside className={classNames('sidebar', mobileOpen && 'sidebar--mobile-open')}>
        <div className="sidebar__top">
          <BrandMark compact={sidebarCollapsed} />
          <IconButton label="Close navigation" onClick={() => setMobileOpen(false)}><X size={18} /></IconButton>
        </div>
        <div className="autonomy-badge">
          <div><Dot pulse tone={emergencyStopped || state.campaignStatus === 'stopped' ? 'red' : apiStatus === 'offline' || state.campaignStatus === 'paused' ? 'amber' : 'green'} /><span>Autonomous operations</span></div>
          <small>{emergencyStopped || state.campaignStatus === 'stopped' ? 'Emergency stop active' : state.campaignStatus === 'paused' ? 'Processing paused' : apiStatus === 'offline' ? 'API disconnected · preview only' : apiStatus === 'connecting' ? 'Checking orchestrator' : 'API connected · check worker health'}</small>
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
          {allProvidersDemo && view === 'overview' && <div className="connection-banner connection-banner--demo"><Sparkles size={17} /><span><strong>Credential-free Stage‑1 preview.</strong><small>Provider adapters marked DEMO do not prove real calls, builds, ads or delivery.</small></span><Button tone="ghost" onClick={() => navigate('demo')}>Open demo lab</Button></div>}
          {view === 'overview' && <Overview {...pageProps} />}
          {view === 'demo' && <SpiceRouteDemo apiStatus={apiStatus} pipelineStep={state.pipelineStep} providerHealth={providerHealth} activityEvents={pageProps.activityEvents} dashboardLeads={dashboardLeads} onStart={() => void startPipeline(spiceRoute)} onNavigate={navigate} />}
          {view === 'discover' && <Discover {...pageProps} />}
          {view === 'leads' && <SalesOperations onNotice={setToast} onDiscover={() => navigate('discover')} telephony={providerHealth.find((provider) => provider.integration === 'telephony')} />}
          {view === 'pipeline' && <Pipeline {...pageProps} />}
          {view === 'sales' && <SalesRoom {...pageProps} />}
          {view === 'crm' && <CRM {...pageProps} />}
          {view === 'campaigns' && <Campaigns {...pageProps} />}
          {view === 'projects' && <Projects {...pageProps} />}
          {view === 'templates' && <TemplateLibrary />}
          {view === 'deployments' && <Deployments {...pageProps} />}
          {view === 'agents' && <Agents {...pageProps} />}
          {view === 'analytics' && <Analytics {...pageProps} />}
          {view === 'activity' && <ActivityPage {...pageProps} />}
          {view === 'settings' && <SettingsPage {...pageProps} />}
        </main>
      </div>

      {intelligenceOpen && (
        <IntelligenceDrawer
          business={selectedBusiness}
          onClose={() => setIntelligenceOpen(false)}
          onCall={() => void approveAndCallWithSarvam(selectedBusiness)}
          calling={salesCallStarting}
          telephonyReady={providerHealth.some((provider) => provider.integration === 'telephony' && provider.mode === 'REAL' && provider.status === 'CONNECTED')}
          stageOneEligible={selectedBusiness.qualified && selectedBusiness.phone && Boolean(selectedBusiness.phoneNumber)}
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
  workflows: NonNullable<Awaited<ReturnType<typeof getDashboard>>['workflows']>;
  agentRuns: NonNullable<Awaited<ReturnType<typeof getDashboard>>['agentRuns']>;
  emergencyStopped: boolean;
  activityEvents: ActivityEvent[];
  activeLeadId: string;
  activeProjectId: string;
  deploymentUrl: string | null;
  refreshIntegrations: () => Promise<void>;
  changeCampaignStatus: (status: AppState['campaignStatus']) => Promise<void>;
};

function Overview({ navigate, state, pipeline, startPipeline, changeCampaignStatus, activityEvents, apiStatus, providerHealth, dashboardMetrics, workflows, agentRuns, emergencyStopped, marketBusinesses, selectedBusinessId, setSelectedBusinessId }: PageProps) {
  const completed = Math.min(state.pipelineStep, 10);
  const realTelephonyAvailable = providerHealth.some((provider) =>
    provider.integration === 'telephony' && provider.mode === 'REAL' && provider.status === 'CONNECTED');
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
        eyebrow="AgentFront · control tower"
        title={<>Your operations <span className="heading-accent">at a glance.</span></>}
        copy="Observe persisted workflow events and agent attempts. Provider actions only count when the backend records them."
        action={
          <div className="heading-actions">
            <Button tone="secondary" icon={<Sparkles size={16} />} onClick={() => navigate('demo')}>Hackathon demo</Button>
            <Button tone="secondary" icon={<Map size={16} />} onClick={() => navigate('discover')}>Inspect discovery</Button>
            {apiStatus === 'connected' ? <Button icon={<Activity size={16} />} onClick={() => navigate('activity')}>View event ledger</Button>
              : <Button icon={<Play size={16} />} onClick={startPipeline}>Demo API unavailable</Button>}
          </div>
        }
      />

      {apiStatus === 'offline' && <div className="connection-banner"><AlertTriangle size={17} /><span><strong>API disconnected — preview only.</strong><small>Offline data is labelled demo; no pipeline advances or backend events are synthesized.</small></span><Button tone="ghost" onClick={() => navigate('settings')}>Integration health</Button></div>}
      {apiStatus === 'connected' && !realTelephonyAvailable && <div className="connection-banner connection-banner--demo"><Headphones size={17} /><span><strong>Real telephony is unavailable.</strong><small>The browser voice room is available only as a clearly labelled fallback; it does not place a PSTN call.</small></span><Button tone="ghost" onClick={() => navigate('sales')}>Open browser fallback</Button></div>}
      {apiStatus === 'connected' && emergencyStopped && <div className="connection-banner connection-banner--danger"><AlertTriangle size={17} /><span><strong>Global emergency stop active.</strong><small>Workers must not claim new tasks. Existing provider effects may require reconciliation.</small></span><Button tone="ghost" onClick={() => void changeCampaignStatus('running')}>Resume safely</Button></div>}

      <section className="kpi-grid">
        {topMetrics.map((metric, index) => {
          const Icon = metric.icon;
          return (
            <article className={classNames('metric-card', index === 0 && 'metric-card--feature')} key={metric.label}>
              <div className="metric-card__head"><span>{metric.label}</span><span className="metric-icon"><Icon size={17} /></span></div>
              <strong>{metric.value}</strong>
              <div className="metric-card__foot"><span className={metric.trend ? 'positive' : ''}>{metric.trend && <ArrowUpRight size={13} />}{metric.note}</span><Pill tone={connectedMetrics ? 'success' : 'demo'}><Dot tone={connectedMetrics ? 'green' : 'muted'} />{connectedMetrics ? 'Live API' : 'Demo'}</Pill></div>
              <Sparkline values={[[12, 18, 15, 24, 26, 20, 34, 30, 39, 41], [8, 9, 14, 12, 16, 19, 17, 23, 24, 29], [9, 13, 11, 18, 16, 24, 22, 31, 28, 36], [10, 8, 15, 13, 20, 18, 26, 23, 30, 34]][index]} />
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
        {apiStatus === 'connected' ? <>
          <section className="panel active-operation" aria-label="Persisted business workflows">
            <div className="panel__header"><div><span className="panel-label">PostgreSQL source of record</span><h2>Business workflows</h2></div><button className="text-link" type="button" onClick={() => navigate('activity')}>View event ledger <ArrowRight size={14} /></button></div>
            <div className="control-tower-list">{workflows.length ? workflows.slice(0, 8).map((workflow) => <article key={workflow.id}>
              <span><strong>{marketBusinesses.find((business) => business.id === workflow.businessId)?.name ?? workflow.businessId}</strong><small>{workflow.currentAgent ?? 'No active agent'} · {workflow.currentTask ?? 'No task recorded'}</small></span>
              <span><Pill tone={workflow.status === 'FAILED' ? 'danger' : workflow.status === 'COMPLETED' ? 'success' : 'neutral'}>{workflow.status}</Pill><time dateTime={workflow.updatedAt}>{formatEventTime(workflow.updatedAt, true)}</time></span>
            </article>) : <p>No workflow has entered the durable pipeline yet. Scheduled discovery is a later phase.</p>}</div>
          </section>
          <section className="panel revenue-panel" aria-label="Recorded agent attempts">
            <div className="panel__header"><div><span className="panel-label">Worker attempts · PostgreSQL</span><h2>Agent runs</h2></div><span>{agentRuns.length} in view</span></div>
            <div className="control-tower-list">{agentRuns.length ? agentRuns.slice(0, 8).map((run) => <article key={run.id}>
              <span><strong>{run.agentType}</strong><small>Business {run.businessId} · retry {run.retryCount}</small></span>
              <span><Pill tone={run.status === 'FAILED' ? 'danger' : run.status === 'SUCCEEDED' ? 'success' : 'neutral'}>{run.status}</Pill><time dateTime={run.startedAt}>{formatEventTime(run.startedAt, true)}</time></span>
            </article>) : <p>No worker attempts have been recorded. A connected API does not mean five agents are online.</p>}</div>
          </section>
        </> : <>
        <section className="panel active-operation">
          <div className="panel__header">
            <div><div className="eyebrow"><Dot pulse tone="green" /> Live operation</div><h2>SpiceRoute Kitchen</h2></div>
            <button className="text-link" type="button" onClick={() => navigate('pipeline')}>Open pipeline <ArrowRight size={14} /></button>
          </div>
          <div className="operation-meta">
            <div><code>AF-2026-000001</code><span>Restaurant · Sholinganallur</span></div>
            <div className="operation-value"><small>Deal value</small><strong>₹100</strong></div>
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
        </>}

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
          <div className="territory-stats">{apiStatus === 'connected'
            ? <span><Dot tone="green" /> Map preview · search Discover for current provider results</span>
            : <><span><Dot tone="green" /> 50 qualified · seeded preview</span><span>₹1.8L · demo estimate</span></>}</div>
        </section>
      </div>
    </div>
  );
}

function Discover({ selectedBusinessId, setSelectedBusinessId, setIntelligenceOpen, apiStatus, marketBusinesses, setMarketBusinesses, setToast }: PageProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('restaurant');
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
  const filtered = useMemo(() => marketBusinesses.filter((business) => {
    const matchesQuery = `${business.name} ${business.area}`.toLowerCase().includes(query.toLowerCase());
    const templateFamily = resolveBusinessVertical(category)?.template ?? 'restaurant';
    const matchesCategory = business.category.toLowerCase() === templateFamily;
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
      const discovered = await discoverMarket({ location, category, radiusMetres: radiusKm * 1_000 });
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
          <label className="input-shell"><Gauge size={17} /><span><small>Distance</small><select aria-label="Distance" value={radiusKm} onChange={(event) => setRadiusKm(Number(event.target.value))}><option value={5}>Within 5 km</option><option value={10}>Within 10 km</option><option value={20}>Within 20 km</option></select></span></label>
          <label className="input-shell"><Store size={17} /><span><small>Business type</small><select value={category} onChange={(event) => setCategory(event.target.value)}>{BUSINESS_VERTICALS.map((vertical) => <option key={vertical.id} value={vertical.id}>{vertical.label}</option>)}</select></span></label>
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
                  <BusinessPhoto business={business} />
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

          </div>
        </section>
      </div>
    </div>
  );
}

function BusinessPhoto({ business }: { business: Business }) {
  const fallback = `/template-imagery/${business.category.toLowerCase()}-hero.png`;
  return <div className={`business-photo business-photo--${business.category.toLowerCase()}`}>
    <CategoryIcon category={business.category} />
    <img
      src={business.photoUrl || fallback}
      alt={`${business.name} business`}
      loading="lazy"
      onError={(event) => { if (event.currentTarget.src !== new URL(fallback, window.location.href).href) event.currentTarget.src = fallback; else event.currentTarget.hidden = true; }}
    />
  </div>;
}

function CategoryIcon({ category }: { category: Business['category'] }) {
  if (category === 'Restaurant') return <Coffee size={22} />;
  if (category === 'Salon') return <WandSparkles size={22} />;
  if (category === 'Garments') return <Store size={22} />;
  return <Gauge size={22} />;
}

function IntelligenceDrawer({ business, onClose, onCall, calling, telephonyReady, stageOneEligible }: {
  business: Business;
  onClose: () => void;
  onCall: () => void;
  calling: boolean;
  telephonyReady: boolean;
  stageOneEligible: boolean;
}) {
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
        <section className="drawer-section opportunity-note"><Sparkles size={18} /><div><strong>{business.qualified ? 'Ready for founder-approved outreach' : 'Held for founder review'}</strong><p>{business.source === 'GOOGLE_PLACES' ? 'Review the live Place record and explicitly authorize outreach to its listed phone.' : 'This review is the explicit gate before Sarvam calls the consented demo number.'}</p></div></section>
        <div className="drawer-footer">
          <div><ShieldCheck size={16} /><span><strong>{telephonyReady ? 'Sarvam/Vobiz connected' : 'Telephony unavailable'}</strong><small>{stageOneEligible ? `${business.source === 'DEMO' ? 'Personal demo number' : business.phoneNumber} · ${business.source === 'DEMO' ? 'demo target' : 'real client'} · 10:00–19:00 IST` : 'A qualified business with a callable number is required'}</small></span></div>
          <Button disabled={!stageOneEligible || calling} icon={calling ? <RefreshCw size={16} /> : <Phone size={16} />} onClick={onCall}>{calling ? 'Requesting call…' : !telephonyReady ? 'Check call connection' : stageOneEligible ? 'Approve & call with Sarvam' : 'No callable number'}</Button>
        </div>
      </aside>
    </div>
  );
}

function Pipeline({ pipeline: projectedPipeline, selectedStage, setSelectedStage, state, setState, startPipeline, resetJourney, navigate, apiStatus, activeProjectId, providerHealth, dashboardLeads }: PageProps) {
  const [salesDetail, setSalesDetail] = useState<LiveSalesBusinessDetail | null>(null);
  const [salesDetailError, setSalesDetailError] = useState<string | null>(null);
  useEffect(() => {
    if (apiStatus !== 'connected') return;
    let active = true;
    const refresh = () => void getSalesBusinessDetail('business-spiceroute').then((detail) => {
      if (active) { setSalesDetail(detail); setSalesDetailError(null); }
    }).catch((error) => {
      if (active) setSalesDetailError(error instanceof Error ? error.message : 'Live sales state is unavailable.');
    });
    refresh();
    const timer = window.setInterval(refresh, 3_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [apiStatus]);
  const salesState = salesDetail?.business.salesState;
  const salesStep = (() => {
    if (!salesState) return null;
    if (salesState === 'DEPLOYED') return 10;
    if (salesState === 'DEPLOYING') return 9;
    if (salesState === 'QA') return 8;
    if (['DEAL_WON', 'SPEC_GENERATED', 'BUILD_PENDING', 'BUILDING'].includes(salesState)) return 7;
    if (['NEGOTIATING', 'QUOTE_PRESENTED'].includes(salesState)) return 5;
    if (['OWNER_CONTACTED', 'DISCOVERY_CONVERSATION', 'REQUIREMENTS_COLLECTING'].includes(salesState)) return 4;
    if (['CALLING', 'CONTACTED', 'RECEPTIONIST_CONTACTED', 'DECISION_MAKER_REQUIRED', 'OWNER_CONTACT_IDENTIFIED',
      'CALLBACK_REQUESTED', 'FOLLOW_UP_SCHEDULED', 'FOLLOW_UP_REQUIRED', 'DEAL_LOST', 'DO_NOT_CONTACT'].includes(salesState)) return 3;
    if (['QUALIFIED', 'CALL_PENDING'].includes(salesState)) return 2;
    return 1;
  })();
  const deliveryAggregate = dashboardLeads
    .filter((aggregate) => aggregate.lead.businessId === 'business-spiceroute' && aggregate.lead.campaignId.startsWith('sales-spec-'))
    .sort((left, right) => String(right.lead.updatedAt ?? '').localeCompare(String(left.lead.updatedAt ?? '')))[0] ?? null;
  const deliveryState = deliveryAggregate?.lead.status ?? null;
  const liveStep = deliveryState ? pipelineStepForState(deliveryState) : salesStep;
  const liveProjectId = deliveryAggregate?.lead.projectId ?? (salesDetail ? salesDetail.business.id : activeProjectId);
  const deliveryEvents = deliveryAggregate?.events.slice(-7) ?? [];
  const buildProgress = deliveryState === 'DEPLOYED' ? 6
    : deliveryState === 'DEPLOYING' ? 5
      : deliveryState === 'QA' ? 4
        : deliveryState && ['SPEC_GENERATED', 'BUILD_QUEUED', 'BUILDING', 'BUILD_FAILED'].includes(deliveryState) ? 2 : 0;
  const activeBuildIndex = deliveryState === 'BUILD_QUEUED' || deliveryState === 'BUILDING' ? 2
    : deliveryState === 'QA' ? 4
      : deliveryState === 'DEPLOYING' ? 5 : null;
  const latestCall = salesDetail?.calls[0] ?? null;
  const finalVariables = latestCall?.metadata?.finalAgentVariables && typeof latestCall.metadata.finalAgentVariables === 'object'
    ? latestCall.metadata.finalAgentVariables as Record<string, unknown> : null;
  const blockedReasons = salesDetail && finalVariables?.deal_status === 'WON' && !salesDetail.projectSpec ? [
    Number(String(finalVariables.agreed_price ?? '').replaceAll(',', '')) !== 100 ? `Sarvam returned ₹${String(finalVariables.agreed_price || '—')}; required ₹100` : null,
    !finalVariables.client_email ? 'confirmed delivery email missing' : null,
    !finalVariables.public_business_phone ? 'approved public website phone missing' : null,
  ].filter((item): item is string => Boolean(item)) : [];
  const detailByStage = [
    'Google Business profile indexed',
    `Qualified · ${salesState ?? 'waiting'}`,
    salesDetail?.business.freshworksAccountId
      ? `Freshworks account ${salesDetail.business.freshworksAccountId}${salesDetail.business.freshworksDealId ? ' · deal synced' : ' · deal pending valid win'}`
      : 'Freshworks account sync pending',
    latestCall ? `${latestCall.provider} · ${latestCall.status}${latestCall.outcome ? ` · ${latestCall.outcome}` : ''}` : 'Waiting for an approved sales call',
    salesDetail?.projectSpec ? `${salesDetail.projectSpec.specification.requirements.pages.length} pages approved` : 'Waiting for validated call requirements',
    salesDetail?.memory?.agreedPrice ? `Offer accepted · ${rupees.format(salesDetail.memory.agreedPrice)}` : 'No governed agreement recorded',
    salesDetail?.projectSpec ? `Specification v${salesDetail.projectSpec.version} · ${salesDetail.projectSpec.status}` : 'No project specification generated',
    deliveryState === 'BUILDING' || deliveryState === 'BUILD_QUEUED' ? `Claude template customization · ${deliveryState}` : deliveryState && ['QA', 'DEPLOYING', 'DEPLOYED'].includes(deliveryState) ? 'Template customization complete' : 'Waiting for validated project specification',
    deliveryState === 'QA' ? 'Deterministic QA running' : deliveryState && ['DEPLOYING', 'DEPLOYED'].includes(deliveryState) ? 'Deterministic QA passed' : 'QA queued after build',
    deliveryState === 'DEPLOYED' ? 'Real deployment recorded' : deliveryState === 'DEPLOYING' ? 'Vercel deployment running' : 'Deployment queued after QA',
  ];
  const pipeline: PipelineStage[] = liveStep === null ? projectedPipeline : pipelineBlueprint.map((item, index) => ({
    ...item, detail: detailByStage[index] ?? item.detail,
    status: index < liveStep ? 'complete' : index === liveStep && liveStep < pipelineBlueprint.length ? 'active' : 'queued',
    timestamp: undefined,
  }));
  useEffect(() => {
    if (liveStep !== null) setSelectedStage(Math.min(liveStep, pipelineBlueprint.length - 1));
  }, [liveStep, setSelectedStage]);
  const stage = pipeline[selectedStage] ?? pipeline[0];
  const completed = liveStep ?? Math.min(state.pipelineStep, pipeline.length);
  const won = Boolean(salesDetail?.projectSpec);
  const stageIntegration = selectedStage === 2 ? 'crm' : selectedStage === 3 ? 'conversation' : selectedStage === 7 ? 'developer' : selectedStage === 9 ? 'deployment' : null;
  const stageProvider = stageIntegration ? providerHealth.find((provider) => provider.integration === stageIntegration) : null;
  return (
    <div className="page pipeline-page">
      <SectionHeading
        eyebrow={`Live orchestration · ${liveProjectId}`}
        title="SpiceRoute Kitchen pipeline"
        copy="Authoritative Sarvam sales state merged with the exact Claude, QA and Vercel delivery project."
        action={salesDetail ? <div className="heading-actions"><Pill tone={blockedReasons.length ? 'warning' : 'live'}><Dot pulse={!blockedReasons.length} tone={blockedReasons.length ? 'amber' : 'blue'} /> {deliveryState ?? salesState}</Pill><Button tone="secondary" icon={<Target size={15} />} onClick={() => navigate('leads')}>Open sales operations</Button></div> : <div className="heading-actions"><Button tone="ghost" icon={<RefreshCw size={15} />} onClick={resetJourney}>Reset demo</Button>{state.autoAdvance ? <Button tone="secondary" icon={<Pause size={15} />} onClick={() => setState((current) => ({ ...current, autoAdvance: false }))}>Pause journey</Button> : <Button icon={<Play size={15} />} onClick={startPipeline}>Start pipeline</Button>}</div>}
      />
      <div className="pipeline-commandbar">
        <div className="pipeline-business"><div className="business-photo business-photo--restaurant"><Coffee size={20} /></div><span><strong>SpiceRoute Kitchen</strong><small>Restaurant · Sholinganallur, Chennai</small></span></div>
        <div className="pipeline-commandbar__stat"><span>Current lifecycle</span><strong>{deliveryState ?? salesState ?? (completed >= 10 ? 'DEPLOYED' : stage.label.toUpperCase())}</strong></div>
        <div className="pipeline-commandbar__stat"><span>Commercial</span><strong>{salesDetail?.memory?.agreedPrice ? rupees.format(salesDetail.memory.agreedPrice) : '₹100'} <small>{won ? 'won' : 'required'}</small></strong></div>
        <div className="pipeline-commandbar__stat"><span>Timing source</span><strong>{salesDetail ? 'Live sales record' : apiStatus === 'offline' ? 'Seeded demo clock' : 'Structured events'}</strong></div>
        <div className="pipeline-health"><Dot tone={apiStatus === 'connected' ? 'green' : 'amber'} pulse={apiStatus === 'connected'} /><span><strong>{apiStatus === 'connected' ? 'API connected' : 'Browser fallback'}</strong><small>{completed}/10 projected stages complete</small></span></div>
      </div>
      {salesDetailError && <div className="security-callout"><AlertTriangle size={18} /><span><strong>Live workflow unavailable</strong><small>{salesDetailError}</small></span></div>}
      {blockedReasons.length > 0 && <div className="security-callout"><AlertTriangle size={18} /><span><strong>Developer handoff blocked after the completed Sarvam call</strong><small>{blockedReasons.join(' · ')}. No build has started; complete a corrected call to generate the project specification.</small></span></div>}

      <section className="pipeline-visual panel">
        <div className="pipeline-visual__top"><span className="panel-label">Lifecycle state machine</span><div><Pill tone={apiStatus === 'connected' ? 'success' : 'warning'}><Database size={12} /> {apiStatus === 'connected' ? 'API trace' : 'Browser fallback'}</Pill><Pill tone="success"><ShieldCheck size={12} /> Idempotency guards</Pill></div></div>
        <div className="pipeline-stages">
          {pipeline.map((item, index) => (
            <div className="pipeline-stage-wrap" key={item.key}>
              <button type="button" className={classNames('pipeline-stage', `pipeline-stage--${item.status}`, selectedStage === index && 'is-selected')} onClick={() => setSelectedStage(index)}>
                <span className="pipeline-stage__number">{item.status === 'complete' ? <Check size={16} /> : item.status === 'active' ? <span className="stage-pulse" /> : String(index + 1).padStart(2, '0')}</span>
                <span className="pipeline-stage__icon">{[<Search />, <Target />, <Database />, <Headphones />, <ClipboardCheck />, <CircleDollarSign />, <FileCode2 />, <TerminalSquare />, <ShieldCheck />, <Rocket />][index]}</span>
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
          <div className="stage-output"><div><span>Authoritative lifecycle state</span><button type="button" onClick={() => void navigator.clipboard?.writeText(`${liveProjectId}:${stage.key}:${stage.status}`)}><Copy size={13} /> Copy</button></div><code>{`{\n  "projectId": "${liveProjectId}",\n  "stage": "${stage.key.toUpperCase()}",\n  "status": "${stage.status.toUpperCase()}",\n  "salesState": "${salesState ?? 'UNAVAILABLE'}",\n  "deliveryState": "${deliveryState ?? 'NOT_CREATED'}",\n  "source": "${deliveryAggregate ? 'delivery-aggregate' : salesDetail ? 'sales-repository' : 'browser-fallback'}"\n}`}</code></div>
          <div className="panel-actions"><Button tone="secondary" icon={<TerminalSquare size={15} />} onClick={() => navigate('activity')}>Inspect logs</Button></div>
        </section>
        <section className="panel build-monitor">
          <div className="panel__header"><div><span className="panel-label">Developer visualization</span><h2>Production build</h2></div><span className="build-duration">{apiStatus === 'offline' ? '03:42 seeded avg' : 'Event-driven status'}</span></div>
          <div className="template-card"><div className="template-preview"><span /><span /><span /></div><div><span>Selected template</span><strong>Restaurant v1</strong><small>Configuration-driven · mobile first</small></div><CheckCircle2 size={18} /></div>
          <div className="build-checklist">
            {['Template selected', 'Requirements loaded', 'Claude customization', 'Production build', 'Deterministic QA', 'Vercel deployment'].map((label, index) => {
              const complete = index < buildProgress;
              const active = activeBuildIndex === index;
              return <div key={label} className={classNames(complete && 'complete', active && 'active')}><span>{complete ? <Check size={12} /> : active ? <span className="stage-pulse" /> : <Circle size={10} />}</span><strong>{label}</strong><em>{complete ? 'Done' : active ? 'Working…' : 'Queued'}</em></div>;
            })}
          </div>
          <div className="build-log"><div><Dot pulse={Boolean(deliveryAggregate)} tone={deliveryAggregate ? 'green' : 'amber'} /><span>{deliveryAggregate ? 'Persisted developer / QA / deployment events' : 'Developer handoff not created'}</span></div><pre>{deliveryEvents.length
            ? deliveryEvents.map((event) => `${new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(event.createdAt))}  ${event.agentType}  ${event.message}`).join('\n')
            : blockedReasons.length ? `No Claude build started.\n${blockedReasons.map((reason) => `BLOCKED  ${reason}`).join('\n')}\nComplete a corrected Sarvam call; the worker will then start automatically.`
              : 'No developer project exists yet. A validated won deal and project specification are required.'}</pre></div>
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
              <div className="offer-box"><div><span>Current offer</span><strong>₹7,999</strong></div><div><span>Approved floor</span><strong>₹100</strong></div><div className="offer-rule"><ShieldCheck size={15} /><span>Pricing policy enforced by backend rules</span></div></div>
              {complete && <div className="deal-won"><div><Check size={20} /></div><span><small>Demo deal won</small><strong>₹100</strong><em>Seeded scope approved</em></span></div>}
            </aside>}
      </div>}
    </div>
  );
}

function CRM({ providerHealth, apiStatus }: PageProps) {
  const crmHealth = providerHealth.find((provider) => provider.integration === 'crm');
  const [board, setBoard] = useState<CRMBoardSnapshot | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [loadingBoard, setLoadingBoard] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [spiceRouteDetail, setSpiceRouteDetail] = useState<LiveSalesBusinessDetail | null>(null);
  const [spiceRouteError, setSpiceRouteError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (apiStatus !== 'connected') {
      return () => { active = false; };
    }
    void getCRMBoard().then((snapshot) => {
      if (active) { setBoard(snapshot); setBoardError(null); }
    }).catch((error) => {
      if (active) setBoardError(error instanceof Error ? error.message : 'Unable to load CRM records.');
    }).finally(() => {
      if (active) setLoadingBoard(false);
    });
    void getSalesBusinessDetail("business-spiceroute").then((detail) => {
      if (active) { setSpiceRouteDetail(detail); setSpiceRouteError(null); }
    }).catch((error) => {
      if (active) {
        setSpiceRouteDetail(null);
        setSpiceRouteError(error instanceof Error ? error.message : "Unable to load SpiceRoute sales state.");
      }
    });
    return () => { active = false; };
  }, [apiStatus, refreshKey]);

  const visibleBoard = apiStatus === 'connected' ? board : null;
  const visibleBoardError = apiStatus === 'connected'
    ? boardError
    : 'The CRM mirror needs the AgentFront API connection.';
  const crmIsReal = visibleBoard?.mode === 'REAL' || (visibleBoard === null && crmHealth?.mode === 'REAL');
  const stages = ['Qualified', 'Contacted', 'Interested', 'Negotiating', 'Won / Building'];
  const stageForDeal = (stage: string): string => {
    const normalized = stage.trim().toLowerCase();
    if (/won|closed won|deployed|building/.test(normalized)) return 'Won / Building';
    if (/negotiat/.test(normalized)) return 'Negotiating';
    if (/interest/.test(normalized)) return 'Interested';
    if (/contact/.test(normalized)) return 'Contacted';
    return 'Qualified';
  };
  const deals = visibleBoard?.deals ?? [];
  const columns = stages.map((label) => {
    const columnDeals = deals.filter((deal) => stageForDeal(deal.stage) === label);
    return { label, deals: columnDeals, total: columnDeals.reduce((sum, deal) => sum + deal.amount, 0) };
  });
  const wonDeals = columns.find((column) => column.label === 'Won / Building')?.deals ?? [];
  const openDeals = deals.filter((deal) => !wonDeals.includes(deal));
  const openValue = openDeals.reduce((sum, deal) => sum + deal.amount, 0);
  const weightedValue = openDeals.reduce((sum, deal) => sum + deal.amount * 0.5, 0);
  const wonValue = wonDeals.reduce((sum, deal) => sum + deal.amount, 0);
  const spiceRouteCall = spiceRouteDetail?.calls[0] ?? null;
  const spiceRouteVariables = spiceRouteCall?.metadata?.finalAgentVariables && typeof spiceRouteCall.metadata.finalAgentVariables === 'object'
    ? spiceRouteCall.metadata.finalAgentVariables as Record<string, unknown> : null;
  const spiceRouteBlockers = spiceRouteDetail && spiceRouteVariables?.deal_status === 'WON' && !spiceRouteDetail.projectSpec ? [
    Number(String(spiceRouteVariables.agreed_price ?? '').replaceAll(',', '')) !== 100
      ? `price returned as ₹${String(spiceRouteVariables.agreed_price || '—')} instead of the configured ₹100` : null,
    !spiceRouteVariables.client_email ? 'delivery email was not extracted' : null,
    !spiceRouteVariables.public_business_phone ? 'approved public website phone was not extracted' : null,
  ].filter((item): item is string => Boolean(item)) : [];
  const spiceRouteCrmStatus = spiceRouteDetail?.business.freshworksDealId
    ? `Freshworks deal ${spiceRouteDetail.business.freshworksDealId} is correlated to AgentFront.`
    : spiceRouteDetail?.business.freshworksAccountId
      ? 'The Freshworks account is synced, but no deal was created because no validated win/specification exists.'
      : 'The SpiceRoute Freshworks account has not synced yet.';
  return (
    <div className="page crm-page">
      <SectionHeading eyebrow={`${crmIsReal ? 'Freshworks read-only mirror' : 'Demo CRM adapter'} · ${apiStatus === 'connected' ? 'server connected' : 'browser offline'}`} title="Client lifecycle" copy="Deal records below are loaded from the configured CRM adapter. No seeded portfolio records are mixed into this board." action={<div className="heading-actions"><Pill tone={crmIsReal ? 'success' : 'demo'}>{crmIsReal ? <CheckCircle2 size={12} /> : <Sparkles size={12} />} {crmIsReal ? 'Freshworks live data' : 'Demo adapter'}</Pill><Button disabled={!visibleBoard?.consoleUrl} tone="secondary" icon={<ExternalLink size={15} />} onClick={() => { if (visibleBoard?.consoleUrl) window.open(visibleBoard.consoleUrl, '_blank', 'noopener,noreferrer'); }}>Open Freshworks</Button></div>} />
      {(spiceRouteDetail || spiceRouteError) && <div className="security-callout"><AlertTriangle size={18} /><span><strong>SpiceRoute workflow · {spiceRouteDetail?.business.salesState ?? 'unavailable'}</strong><small>{spiceRouteError ?? `${spiceRouteCrmStatus}${spiceRouteCall ? ` Latest Sarvam call: ${spiceRouteCall.status}${spiceRouteCall.outcome ? ` / ${spiceRouteCall.outcome}` : ''}.` : ''}${spiceRouteBlockers.length ? ` Developer handoff blocked: ${spiceRouteBlockers.join('; ')}.` : ''}${visibleBoard?.ignoredProviderRecords ? ` ${visibleBoard.ignoredProviderRecords} unrelated tenant record${visibleBoard.ignoredProviderRecords === 1 ? ' was' : 's were'} hidden.` : ''}`}</small></span></div>}
      <div className="crm-summary">{[
        ['Open pipeline', rupees.format(openValue), `${openDeals.length} live deal${openDeals.length === 1 ? '' : 's'}`],
        ['Weighted value', rupees.format(weightedValue), '50% board projection'],
        ['Won / building', String(wonDeals.length), rupees.format(wonValue)],
        ['Sync source', visibleBoard?.provider ?? 'Checking', crmHealth?.status ?? 'Not checked'],
      ].map(([label, value, note], index) => <div key={label}><span className={`metric-icon metric-icon--${index}`}><CircleDollarSign size={17} /></span><span><small>{label}</small><strong>{value}</strong><em>{note}</em></span></div>)}</div>
      <div className="crm-board-head"><div><button className="active" type="button">Pipeline board</button><span>Read-only provider mirror</span></div><div><Button tone="ghost" icon={<RefreshCw size={14} />} onClick={() => { setLoadingBoard(true); setBoardError(null); setRefreshKey((value) => value + 1); }} disabled={loadingBoard}>Refresh records</Button></div></div>
      <div className="crm-board">
        {columns.map((column, columnIndex) => <section className="crm-column" key={column.label}><div className="crm-column__head"><span><Dot tone={columnIndex < 2 ? 'muted' : columnIndex < 4 ? 'blue' : 'green'} /><strong>{column.label}</strong><em>{column.deals.length}</em></span><small>{rupees.format(column.total)}</small></div><div className="crm-column__deals">{column.deals.map((deal, index) => <article className="deal-card" key={deal.id} onClick={() => { if (deal.url) window.open(deal.url, '_blank', 'noopener,noreferrer'); }}><div><Avatar name={deal.name} tone={columnIndex + index} /><Pill tone={crmIsReal ? 'success' : 'demo'}>{deal.id}</Pill></div><h3>{deal.name}</h3><p>{deal.accountName ?? deal.contactName ?? 'CRM account'} · {deal.stage}</p><div><strong>{rupees.format(deal.amount)}</strong><span><Clock3 size={12} /> {deal.updatedAt ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(new Date(deal.updatedAt)) : 'Synced now'}</span></div><div className="deal-card__sync"><RefreshCw size={12} /> {visibleBoard?.provider ?? 'CRM adapter'} · {crmIsReal ? 'external record' : 'demo record'}</div></article>)}{column.deals.length === 0 && <p className="add-deal">{loadingBoard ? 'Loading CRM records…' : visibleBoardError ?? 'No records in this stage.'}</p>}</div><span className="add-deal"><ListFilter size={14} /> Read-only mirror</span></section>)}
      </div>
    </div>
  );
}

function Campaigns({ state, setToast, changeCampaignStatus, dashboardLeads }: PageProps) {
  const [editing, setEditing] = useState(false);
  const status = state.campaignStatus;
  const spiceDeployment = dashboardLeads.find((item) => item.lead.businessId === 'business-spiceroute')?.deployment;
  const verifiedSiteUrl = spiceDeployment?.providerMode === 'REAL' && /^https:\/\//i.test(spiceDeployment.url) ? spiceDeployment.url : undefined;
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
      <SpiceRouteAdPreview siteUrl={verifiedSiteUrl} />
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
    { id: 'AF-2026-000001', name: 'SpiceRoute Kitchen', category: 'Restaurant', value: state.pipelineStep >= 6 ? '₹100' : '₹7,999 quoted', status: spiceStatus, progress: Math.max(10, state.pipelineStep * 10), agent: state.pipelineStep >= 9 ? 'Deployment Adapter' : state.pipelineStep >= 8 ? 'QA Engine' : state.pipelineStep >= 7 ? 'Developer Agent' : 'Orchestrator', template: 'Restaurant v1', business: undefined as Business | undefined },
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

function Deployments({ setToast, state, deploymentUrl, providerHealth, refreshIntegrations, dashboardLeads }: PageProps) {
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

function Agents({ navigate, providerHealth, apiStatus, activityEvents }: PageProps) {
  const provider = (name: IntegrationHealth['integration']) => providerHealth.find((item) => item.integration === name);
  const label = (name: IntegrationHealth['integration']) => {
    const item = provider(name);
    return apiStatus !== 'connected' ? 'API offline' : item ? `${item.mode} · ${item.status}` : 'Not reported';
  };
  const roles: Array<{ name: string; purpose: string; evidence: string; status: string; Icon: LucideIcon; target: ViewKey }> = [
    { name: 'Discover', purpose: 'Find and qualify a website-gap business.', evidence: provider('places')?.message ?? 'Provider health unavailable.', status: label('places'), Icon: Map, target: 'discover' },
    { name: 'Sales', purpose: 'Hold a consented conversation and capture an approved deal.', evidence: `${provider('conversation')?.message ?? 'Voice status unavailable.'} Phone bridge: ${label('telephony')}.`, status: label('conversation'), Icon: Headphones, target: 'sales' },
    { name: 'Developer', purpose: 'Adapt one approved template, run QA, then deploy.', evidence: provider('developer')?.message ?? 'Build provider health unavailable.', status: label('developer'), Icon: TerminalSquare, target: 'pipeline' },
    { name: 'Advertise', purpose: 'Prepare regional creative for the deployed client site.', evidence: 'Instagram/Reels and Google/YouTube are previews only; no ad delivery is claimed.', status: 'PREVIEW ONLY', Icon: TrendingUp, target: 'campaigns' },
    { name: 'Deliver', purpose: 'Give the customer the verified site URL and test checkout.', evidence: `${provider('deployment')?.message ?? 'Deployment status unavailable.'} Customer messaging and payment require separate verification.`, status: label('deployment'), Icon: Cloud, target: 'deployments' },
  ];
  const recorded = apiStatus === 'connected' ? activityEvents.slice(0, 6) : [];
  return <div className="page agents-page">
    <SectionHeading eyebrow="Five bounded roles · one durable workflow" title="Agent operations" copy="AgentFront supervises provider-backed work. Each card reports a capability, not a fictional agent online count." action={<Button tone="secondary" icon={<Activity size={15} />} onClick={() => navigate('activity')}>View event ledger</Button>} />
    <div className="operator-role-grid">{roles.map(({ name, purpose, evidence, status, Icon, target }, index) => <article className="panel operator-role" key={name}>
      <div className="operator-role__head"><span className="operator-role__number">0{index + 1}</span><span className="operator-role__icon"><Icon size={22} /></span></div>
      <h2>{name}</h2><p>{purpose}</p><span className="operator-role__status">{status}</span><small>{evidence}</small>
      <button type="button" onClick={() => navigate(target)}>Inspect {name.toLowerCase()} <ArrowRight size={15} /></button>
    </article>)}</div>
    <section className="panel operator-ledger"><div><span className="panel-label">Source-of-record activity</span><h2>{apiStatus === 'connected' ? 'Latest API events' : 'Connect the API to inspect live work'}</h2><p>The dashboard does not advance work by itself. The API and persistent worker own transitions and retries.</p></div><div className="operator-ledger__events">{recorded.length ? recorded.map((event) => <div key={event.id}><span className={`operator-ledger__dot is-${event.status.toLowerCase()}`} /><span><strong>{event.agent}</strong><small>{event.message}</small></span><time dateTime={event.createdAt}>{formatEventTime(event.createdAt, true)}</time></div>) : <p>No API events are available in this view.</p>}</div></section>
  </div>;
}

function Analytics({ dashboardMetrics, dashboardLeads, activityEvents, apiStatus }: PageProps) {
  const metrics = apiStatus === 'connected' ? dashboardMetrics : null;
  const averageDeal = metrics?.dealsWon ? Math.round(metrics.revenueEarned / metrics.dealsWon) : 0;
  const funnelData = metrics ? [
    { label: 'Discovered', value: metrics.businessesDiscovered },
    { label: 'Qualified', value: metrics.qualifiedLeads },
    { label: 'Conversations', value: metrics.conversationsCompleted },
    { label: 'Deals won', value: metrics.dealsWon },
    { label: 'Deployed', value: metrics.websitesDeployed },
  ] : [];
  const templateColours: Record<string, string> = {
    restaurant: 'var(--accent)', salon: 'var(--blue)', garments: 'var(--violet)', mechanic: 'var(--amber)', clinic: '#168f7b', education: '#6558e8', realestate: '#a55f35', spa: '#b77a86', dental: '#278a9b', physiotherapy: '#e05b3f', petcare: '#e07c45', catering: '#b85031', events: '#c94766', photography: '#c66b42', interiors: '#8f653e', travel: '#167c8b', movers: '#df5c2f', appliance: '#177fc4', trades: '#dc9b1f', detailing: '#29a7d8', drivingschool: '#ef7042', laundry: '#4178b8', furniture: '#9a6540', devicerepair: '#6558e8', printing: '#ef4e37', florist: '#c65b76', jewellery: '#a97822', tailoring: '#973f59', cloudkitchen: '#dc4d2f',
  };
  const templateCounts = Object.entries(dashboardLeads.reduce<Record<string, number>>((counts, aggregate) => {
    const template = aggregate.project?.templateType;
    if (template) counts[template] = (counts[template] ?? 0) + 1;
    return counts;
  }, {}));
  const recentEvidence = apiStatus === 'connected' ? activityEvents.slice(0, 6) : [];
  return (
    <div className="page analytics-page">
      <SectionHeading eyebrow="API-backed evidence only" title="Analytics" copy="Metrics below come from the current AgentFront API snapshot. No invented trends, revenue deltas or build durations are mixed in." action={<Pill tone={metrics ? 'success' : 'warning'}><Dot tone={metrics ? 'green' : 'amber'} /> {metrics ? 'Live API snapshot' : 'Metrics unavailable'}</Pill>} />
      <div className="analytics-kpis">{[
        [metrics ? rupees.format(metrics.revenueEarned) : '—', 'Recorded revenue', metrics ? `${metrics.dealsWon} won deal${metrics.dealsWon === 1 ? '' : 's'}` : 'API offline'],
        [metrics ? `${metrics.conversionRate.toFixed(1)}%` : '—', 'Recorded conversion', metrics ? `${metrics.conversationsCompleted} completed conversations` : 'API offline'],
        [metrics ? rupees.format(averageDeal) : '—', 'Average won deal', metrics?.dealsWon ? 'Calculated from recorded wins' : 'No recorded wins'],
        [metrics ? String(metrics.websitesDeployed) : '—', 'Websites deployed', metrics ? 'Provider records in workflow store' : 'API offline'],
        [metrics ? String(metrics.qualifiedLeads) : '—', 'Qualified leads', metrics ? `${metrics.businessesDiscovered} businesses discovered` : 'API offline'],
      ].map(([value, label, note]) => <div className="panel" key={String(label)}><span>{String(label)}</span><strong>{String(value)}</strong><small>{String(note)}</small></div>)}</div>
      <div className="analytics-grid">
        <section className="panel revenue-analytics"><div className="panel__header"><div><span className="panel-label">Metric authority</span><h2>What this screen counts</h2></div><Database size={18} /></div><div className="analytics-source-list"><p><strong>Workflow store</strong><span>Discovery, qualification, conversation, deal and deployment records.</span></p><p><strong>Provider provenance</strong><span>REAL and DEMO outputs remain distinguishable throughout the API.</span></p><p><strong>Payment boundary</strong><span>Dodo test payment is a sandbox milestone and is never added to live revenue.</span></p><p><strong>Unknown values</strong><span>Missing durations or provider results remain unknown instead of being estimated.</span></p></div></section>
        <section className="panel funnel-panel"><div className="panel__header"><div><span className="panel-label">Recorded acquisition funnel</span><h2>Discover to deploy</h2></div>{metrics && <Pill tone="success">{metrics.websitesDeployed} deployed</Pill>}</div>{funnelData.length ? <div className="funnel-chart">{funnelData.map((stage, index) => <div key={stage.label}><span>{stage.label}</span><div><i style={{ width: `${Math.max(stage.value ? 10 : 0, funnelData[0].value ? (stage.value / funnelData[0].value) * 100 : 0)}%` }}><em>{stage.value.toLocaleString('en-IN')}</em></i></div>{index < funnelData.length - 1 && <small>{stage.value ? Math.round((funnelData[index + 1].value / stage.value) * 100) : 0}%</small>}</div>)}</div> : <p className="analytics-empty">Connect the API to load the recorded funnel.</p>}</section>
        <section className="panel industry-panel"><div className="panel__header"><div><span className="panel-label">Template workload</span><h2>Projects by approved template</h2></div><span>{templateCounts.reduce((sum, [, count]) => sum + count, 0)} projects</span></div><div className="donut-wrap"><div className="donut-chart"><div><strong>{templateCounts.length}</strong><span>template types</span></div></div><div className="donut-legend">{templateCounts.length ? templateCounts.map(([name, count]) => <div key={name}><i style={{ background: templateColours[name] ?? 'var(--muted)' }} /><span><strong>{name[0].toUpperCase() + name.slice(1)}</strong><small>Recorded projects</small></span><em>{count}</em></div>) : <p className="analytics-empty">No project records are available.</p>}</div></div></section>
        <section className="panel territory-analytics"><div className="panel__header"><div><span className="panel-label">Recent evidence</span><h2>Latest API milestones</h2></div><Activity size={18} /></div><div className="analytics-evidence">{recentEvidence.length ? recentEvidence.map((event) => <p key={event.id}><span className={`operator-ledger__dot is-${event.status.toLowerCase()}`} /><span><strong>{event.agent}</strong><small>{event.message}</small></span></p>) : <p className="analytics-empty">No API-backed events are available.</p>}</div></section>
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
    `${event.agent} ${event.eventType} ${event.message} ${event.correlationId ?? ''} ${event.workflowId ?? ''} ${event.businessId ?? ''} ${event.projectId ?? ''} ${event.leadId ?? ''} ${event.campaignId ?? ''}`
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
      <section className="panel log-console"><div className="log-toolbar"><label className="quick-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search event, correlation ID or component" /></label><div><Pill tone={apiStatus === 'connected' ? 'success' : 'demo'}>{apiStatus === 'connected' ? 'API records' : 'Seeded demo records'}</Pill></div></div><div className="log-stream"><div className="log-stream__head"><span>Timestamp (IST)</span><span>Component / correlation</span><span>Event</span><span>Status</span><span>Duration</span><span /></div>{events.map((event) => { const correlationId = event.correlationId ?? event.workflowId ?? null; return <div className="log-row" key={event.id}><time dateTime={event.createdAt}>{formatEventTime(event.createdAt, true)}</time><div><strong>{event.sourceAgent ?? event.agent}</strong><code title={event.businessId ?? undefined}>{correlationId ?? 'Legacy event · no correlation ID'}</code></div><p title={`${event.eventType}: ${event.message}`}>{event.message}{event.retryCount ? ` · retry ${event.retryCount}` : ''}</p><Pill tone={activityTone(event.status)}>{event.status}</Pill><span>{event.durationMs === null ? 'Not reported' : `${event.durationMs} ms`}</span><IconButton label={`Event type: ${event.eventType}`}><ChevronRight size={15} /></IconButton></div>; })}</div><div className="log-footer"><span><Dot pulse={apiStatus === 'connected' && live} tone={apiStatus === 'connected' && live ? 'green' : 'muted'} /> {apiStatus === 'connected' ? live ? 'Listening for persisted workflow events' : 'Display snapshot paused; source may continue' : live ? 'Showing labelled seeded history' : 'Seeded display paused'}</span><button type="button" onClick={() => navigate('pipeline')}>Open project pipeline <ArrowRight size={14} /></button></div></section>
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
    { key: 'support', name: 'Freshdesk', role: 'Operational exception tickets; automation pending', Icon: HeartPulse },
    { key: 'conversation', name: 'ElevenLabs', role: 'Realtime sales conversations', Icon: Headphones },
    { key: 'telephony', name: 'Telephony', role: 'Outbound and inbound calls', Icon: Phone },
    { key: 'jobQueue', name: 'Sales job queue', role: 'Durable sales and CRM work', Icon: Layers3 },
    { key: 'scheduler', name: 'Sales worker', role: 'Callbacks and delivery dispatch', Icon: Clock3 },
    { key: 'developer', name: 'Developer', role: 'Bounded existing-template customization', Icon: TerminalSquare },
    { key: 'deployment', name: 'Deployment', role: 'Provider-neutral releases', Icon: Cloud },
  ];
  return (
    <div className="page settings-page">
      <SectionHeading eyebrow="System control" title="Settings" copy="Browser preferences, reported provider health and the production controls that require operator review." action={<Button icon={<Check size={15} />} onClick={() => { setSaved(true); setToast('Local UI preview applied. Provider credentials and backend policy remain environment-controlled.'); window.setTimeout(() => setSaved(false), 2000); }}>{saved ? 'Applied locally' : 'Apply local preview'}</Button>} />
      <div className="settings-layout">
        <aside className="settings-nav panel">{['Workspace', 'Integrations', 'AI & agents', 'Commercial policy', 'Notifications', 'Security', 'Demo mode'].map((item) => <button className={tab === item ? 'active' : ''} type="button" key={item} onClick={() => setTab(item)}>{item === 'Workspace' ? <Building2 size={16} /> : item === 'Integrations' ? <Layers3 size={16} /> : item === 'AI & agents' ? <Bot size={16} /> : item === 'Commercial policy' ? <IndianRupee size={16} /> : item === 'Notifications' ? <Bell size={16} /> : item === 'Security' ? <ShieldCheck size={16} /> : <Sparkles size={16} />}<span>{item}</span><ChevronRight size={14} /></button>)}</aside>
        <div className="settings-content">
          {tab === 'Workspace' && <><section className="panel settings-section"><div className="settings-section__head"><div><h2>Workspace profile</h2><p>Used across campaign reports and founder operations.</p></div></div><div className="workspace-profile"><div className="large-brand"><BrandMark compact /></div><div><Button tone="secondary">Change logo</Button><small>SVG or PNG · maximum 2 MB</small></div></div><div className="settings-form"><div className="form-row"><label><span>Workspace name</span><input defaultValue="AgentFront" /></label><label><span>Operating timezone</span><select defaultValue="Asia/Kolkata"><option>Asia/Kolkata</option><option>UTC</option></select></label></div><div className="form-row"><label><span>Founder name</span><input defaultValue="Kirthik Roshan" /></label><label><span>Default currency</span><select defaultValue="INR"><option>INR · Indian Rupee</option><option>USD · US Dollar</option></select></label></div></div></section><section className="panel settings-section"><div className="settings-section__head"><div><h2>Appearance</h2><p>Choose the control center theme. Your preference is stored locally.</p></div></div><div className="theme-choices"><button className={state.theme === 'dark' ? 'active' : ''} type="button" onClick={() => setState((current) => ({ ...current, theme: 'dark' }))}><span className="theme-preview theme-preview--dark"><i /><i /><i /></span><span><Moon size={15} /> Dark operations</span></button><button className={state.theme === 'light' ? 'active' : ''} type="button" onClick={() => setState((current) => ({ ...current, theme: 'light' }))}><span className="theme-preview theme-preview--light"><i /><i /><i /></span><span><Sun size={15} /> Light operations</span></button></div></section></>}
          {tab === 'Integrations' && <section className="panel settings-section"><div className="settings-section__head"><div><h2>Provider adapters</h2><p>Reported server-side health and data mode. DEMO records are never presented as live provider output.</p></div><Pill tone={apiStatus === 'connected' ? 'success' : apiStatus === 'offline' ? 'warning' : 'neutral'}>{apiStatus === 'connected' ? 'API connected' : apiStatus === 'offline' ? 'API offline' : 'Checking'}</Pill></div><div className={classNames('persistence-summary', persistenceHealth?.status === 'DEGRADED' && 'persistence-summary--danger')}><Database size={18} /><span><small>Persistence</small><strong>{persistenceHealth ? `${persistenceHealth.mode} · ${persistenceHealth.status}` : apiStatus === 'offline' ? 'Health unavailable' : 'Checking'}</strong><em>{persistenceHealth?.message ?? 'No persistence report received.'}</em></span></div><div className="integration-list">{integrationDefinitions.map(({ key, name, role, Icon }) => { const health = providerHealth.find((provider) => provider.integration === key); const degraded = health?.status === 'DEGRADED' || health?.status === 'NOT_CONFIGURED' || health?.status === 'UNAVAILABLE'; const label = health ? `${health.mode} · ${health.status}` : 'NOT CHECKED'; return <div key={key}><span className="integration-icon"><Icon size={19} /></span><span><strong>{name}</strong><small>{health?.message ?? (apiStatus === 'offline' ? 'Browser demo fallback; API health unavailable.' : role)}</small></span><code>{health?.provider ?? 'Not reported'}</code><Pill tone={degraded ? 'warning' : health?.mode === 'REAL' ? 'success' : 'demo'}><Dot tone={degraded ? 'amber' : health?.mode === 'REAL' ? 'green' : 'amber'} /> {label}</Pill><Button tone="ghost" onClick={() => void refreshIntegrations()}>Test</Button></div>; })}</div></section>}
          {tab === 'AI & agents' && <section className="panel settings-section"><div className="settings-section__head"><div><h2>Agent operations preview</h2><p>These Stage-1 controls are a browser-local policy preview; deploy backend policy changes through configuration.</p></div><Pill tone="demo"><Sparkles size={12} /> Local preview</Pill></div><div className="setting-rows">{[['Automatic safe retries', 'Preview transient-provider retry preference.', 'autoRetry'], ['Transcript retention preference', 'Preview transcript-retention intent; provider and database policy remain authoritative.', 'alerts'], ['Require schema validation', 'Preview the schema-validation requirement used by the delivery flow.', 'errors']].map(([name, copy, key]) => <div key={name}><span><strong>{name}</strong><small>{copy}</small></span><button className={toggles[key as keyof typeof toggles] ? 'toggle active' : 'toggle'} type="button" onClick={() => toggle(key as keyof typeof toggles)}><span /></button></div>)}</div></section>}
          {tab === 'Commercial policy' && <section className="panel settings-section"><div className="settings-section__head"><div><h2>Global commercial guardrails</h2><p>Sales agents cannot override these server-enforced bounds.</p></div></div><div className="settings-form"><div className="form-row"><label><span>Minimum project value</span><input defaultValue="₹5,999" /></label><label><span>Default negotiation floor</span><input defaultValue="₹100" /></label></div><label><span>Approval rule</span><select><option>Founder approval below negotiation floor</option></select></label></div><div className="security-callout"><ShieldCheck size={18} /><span><strong>LLMs never calculate final price</strong><small>Quotes and negotiation offers resolve through deterministic backend rules.</small></span></div></section>}
          {tab === 'Notifications' && <section className="panel settings-section"><div className="settings-section__head"><div><h2>Founder notifications</h2><p>Choose which operating events deserve your attention.</p></div></div><div className="setting-rows">{[['Deal won', 'Notify when a customer accepts an approved offer.', 'revenue'], ['Pipeline error', 'Notify immediately when a workflow requires intervention.', 'errors'], ['CRM sync delay', 'Notify if Freshworks falls more than five minutes behind.', 'crm'], ['Website deployed', 'Notify when production URL and QA report are available.', 'alerts']].map(([name, copy, key]) => <div key={name}><span><strong>{name}</strong><small>{copy}</small></span><button className={toggles[key as keyof typeof toggles] ? 'toggle active' : 'toggle'} type="button" onClick={() => toggle(key as keyof typeof toggles)}><span /></button></div>)}</div></section>}
          {tab === 'Security' && <section className="panel settings-section"><div className="settings-section__head"><div><h2>Security controls & deployment requirements</h2><p>This inventory describes implemented controls; it is not an independent security attestation.</p></div><Pill tone="warning"><AlertTriangle size={12} /> Review for production</Pill></div><div className="security-grid">{[['Founder access', 'HttpOnly signed session', ShieldCheck, false], ['Build containment', 'Ownership-bound workspace', CheckCircle2, false], ['Release validation', 'Schema + deterministic gates', ClipboardCheck, false], ['Tenant boundary', 'Container isolation required', AlertTriangle, true]].map(([name, value, Icon, warning]) => { const C = Icon as LucideIcon; return <div className={warning ? 'security-grid__warning' : undefined} key={String(name)}><C size={18} /><span><small>{String(name)}</small><strong>{String(value)}</strong></span></div>; })}</div><div className="security-callout security-callout--warning"><AlertTriangle size={18} /><span><strong>Workspace-write is not read isolation</strong><small>Run provider CLIs in a dedicated container or sandbox with tenant-specific credentials and filesystem boundaries before multi-tenant production use.</small></span></div></section>}
          {tab === 'Demo mode' && <section className="panel settings-section demo-settings"><div className="settings-section__head"><div><h2>Demo environment</h2><p>Seeded data is clearly identified and never presented as live provider data.</p></div><Pill tone="demo"><Sparkles size={12} /> {providerHealth.some((provider) => provider.mode === 'REAL') ? 'Hybrid fallback' : 'Active'}</Pill></div><div className="demo-banner"><div className="agent-orb"><Sparkles size={20} /></div><span><strong>32 seeded Chennai businesses</strong><small>8 restaurants · 8 salons · 8 garment shops · 8 mechanic workshops</small></span></div><Button tone="secondary" icon={<RefreshCw size={15} />} onClick={resetJourney}>Reset SpiceRoute view</Button></section>}
        </div>
      </div>
    </div>
  );
}

export default App;
