import { describe, expect, it } from 'vitest';
import { hasValidMapCoordinates } from './map-coordinates';

describe('hasValidMapCoordinates', () => {
  it('accepts valid Chennai coordinates and rejects invalid provider coordinates', () => {
    expect(hasValidMapCoordinates({ latitude: 12.8996, longitude: 80.2279 })).toBe(true);
    expect(hasValidMapCoordinates({ latitude: Number.NaN, longitude: 80.2279 })).toBe(false);
    expect(hasValidMapCoordinates({ latitude: 91, longitude: 80.2279 })).toBe(false);
    expect(hasValidMapCoordinates({ latitude: 12.8996, longitude: 181 })).toBe(false);
  });
});
