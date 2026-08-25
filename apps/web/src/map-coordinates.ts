import type { Business } from './types';

export const hasValidMapCoordinates = (
  business: Pick<Business, 'latitude' | 'longitude'>,
): boolean =>
  Number.isFinite(business.latitude) &&
  business.latitude >= -90 &&
  business.latitude <= 90 &&
  Number.isFinite(business.longitude) &&
  business.longitude >= -180 &&
  business.longitude <= 180;
