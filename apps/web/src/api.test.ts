import { describe, expect, it } from 'vitest';
import { validateDodoTestCheckoutUrl } from './api';

describe('validateDodoTestCheckoutUrl', () => {
  it('accepts only the exact HTTPS Dodo test-checkout origin', () => {
    expect(validateDodoTestCheckoutUrl(
      'https://test.checkout.dodopayments.com/session/cks_spiceroute_123?locale=en-IN',
    )).toBe('https://test.checkout.dodopayments.com/session/cks_spiceroute_123?locale=en-IN');
  });

  it.each([
    'http://test.checkout.dodopayments.com/session/cks_spiceroute_123',
    'https://test.checkout.dodopayments.com.evil.example/session/cks_spiceroute_123',
    'https://checkout.dodopayments.com/session/cks_spiceroute_123',
    'https://user@test.checkout.dodopayments.com/session/cks_spiceroute_123',
    'https://test.checkout.dodopayments.com:8443/session/cks_spiceroute_123',
  ])('rejects an untrusted checkout URL: %s', (url) => {
    expect(() => validateDodoTestCheckoutUrl(url)).toThrow(/blocked/);
  });
});
