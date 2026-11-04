import { describe, expect, it } from 'vitest';
import { canStartSalesCall, formatSalesTime, salesStateLabel, salesTimeline, simulatedCallLabel } from './presenter';
import type { SalesBusinessDetail, SalesCall } from './types';

const detail = {
  business: { id: 'business-1', businessCode: null, name: 'Spice Garden', category: 'restaurant', city: 'Chennai', address: 'OMR', phone: '+919999999999', website: null, salesState: 'QUALIFIED', updatedAt: '2026-09-18T10:00:00.000Z' },
  contacts: [],
  calls: [],
  memory: null,
  followUps: [],
  events: [
    { id: 'older', eventType: 'LEAD_QUEUED', timestamp: '2026-09-18T09:00:00.000Z', metadata: {} },
    { id: 'newer', eventType: 'CALL_STARTED', timestamp: '2026-09-18T10:00:00.000Z', metadata: {} },
  ],
  transitions: [],
  projectSpec: null,
} satisfies SalesBusinessDetail;

describe('sales operations presentation', () => {
  it('uses recorded events in newest-first order', () => {
    expect(salesTimeline(detail).map((event) => event.id)).toEqual(['newer', 'older']);
  });

  it('guards outbound control for active calls and do-not-contact state', () => {
    expect(canStartSalesCall(detail)).toBe(true);
    expect(canStartSalesCall({ ...detail, calls: [{ status: 'QUEUED' } as SalesCall] })).toBe(false);
    expect(canStartSalesCall({ ...detail, business: { ...detail.business, salesState: 'DO_NOT_CONTACT' } })).toBe(false);
  });

  it('labels provider demo calls without implying real telephony', () => {
    expect(simulatedCallLabel({ providerMode: 'DEMO', provider: 'Demo Telephony' } as SalesCall)).toBe('SIMULATED TELEPHONY');
    expect(salesStateLabel('OWNER_CONTACT_IDENTIFIED')).toBe('Owner Contact Identified');
    expect(formatSalesTime(null)).toBe('Not yet');
  });
});
