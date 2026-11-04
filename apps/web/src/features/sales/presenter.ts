import type { SalesBusinessDetail, SalesCall, SalesOverviewRow } from './types';

export function salesStateLabel(state: string): string {
  return state.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function salesStateTone(state: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (['DEAL_WON', 'SPEC_GENERATED', 'BUILD_PENDING', 'BUILDING', 'QA', 'DEPLOYING', 'DEPLOYED'].includes(state)) return 'success';
  if (['DEAL_LOST', 'DO_NOT_CONTACT'].includes(state)) return 'danger';
  if (['CALL_PENDING', 'CALLING', 'CALLBACK_REQUESTED', 'FOLLOW_UP_SCHEDULED', 'FOLLOW_UP_REQUIRED', 'DECISION_MAKER_REQUIRED'].includes(state)) return 'warning';
  return 'neutral';
}

export function formatSalesTime(value: string | null | undefined): string {
  if (!value) return 'Not yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Not reported'
    : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function canStartSalesCall(row: SalesOverviewRow | SalesBusinessDetail): boolean {
  const business = row.business;
  const activeCall = 'activeCall' in row ? row.activeCall : row.calls.find((call) => ['QUEUED', 'INITIATING', 'RINGING', 'IN_PROGRESS'].includes(call.status));
  return Boolean(business.phone) && business.salesState !== 'DO_NOT_CONTACT' && !activeCall;
}

export function simulatedCallLabel(call: SalesCall): string {
  return call.providerMode === 'DEMO' ? 'SIMULATED TELEPHONY' : call.provider;
}

export function salesTimeline(detail: SalesBusinessDetail) {
  return detail.events.slice().sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}
