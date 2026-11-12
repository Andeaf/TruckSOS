import { AuthError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { translateAuthError } from '@/lib/auth-errors';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('@/i18n', async () => (await import('./mocks/i18n')).i18nModule);

describe('translateAuthError', () => {
  it('null → null', () => {
    expect(translateAuthError(null)).toBeNull();
  });

  it.each(['invalid_credentials', 'email_not_confirmed', 'otp_expired', 'weak_password', 'provider_disabled'])(
    'codul cunoscut %s → cheia authErrors.<cod>',
    (code) => {
      expect(translateAuthError(new AuthError('Some English text', 400, code))).toBe(`authErrors.${code}`);
    },
  );

  it('eroarea de rețea (fetch respins / AuthRetryableFetchError) → authErrors.network', () => {
    expect(translateAuthError(new AuthError('Network request failed'))).toBe('authErrors.network');
    expect(translateAuthError(new AuthRetryableFetchError('{}', 0))).toBe('authErrors.network');
  });

  it('un cod necunoscut cade pe mesajul brut (cauza reală nu se ascunde)', () => {
    expect(translateAuthError(new AuthError('Signups not allowed for this instance', 422, 'signup_disabled'))).toBe(
      'Signups not allowed for this instance',
    );
  });
});
