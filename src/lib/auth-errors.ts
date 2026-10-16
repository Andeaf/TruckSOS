import type { AuthError } from '@supabase/supabase-js';

import i18n from '@/i18n';
import { isNetworkError } from '@/lib/network-diagnosis';

/**
 * Supabase întoarce erorile de auth în engleză („Invalid login credentials").
 * Mapăm codurile cunoscute pe chei i18n; ce nu cunoaștem cade pe mesajul brut,
 * ca să nu ascundem niciodată cauza reală.
 */
const KNOWN_CODES = [
  'invalid_credentials',
  'email_not_confirmed',
  'user_already_exists',
  'email_exists',
  'otp_expired',
  'over_email_send_rate_limit',
  'over_request_rate_limit',
  'same_password',
  'weak_password',
  'email_address_invalid',
  'validation_failed',
  // 6 oct 2026: signInWithIdToken cu Google/Apple când furnizorul nu e activat în Supabase.
  'provider_disabled',
] as const;

export function translateAuthError(error: AuthError | null): string | null {
  if (!error) return null;
  const code = error.code;
  if (code && (KNOWN_CODES as readonly string[]).includes(code)) {
    return i18n.t(`authErrors.${code}`);
  }
  // 13 oct 2026: cererea n-a ajuns deloc la server („Network request failed" brut
  // în captura unui utilizator). Mesaj tradus; ecranele de auth pornesc pe el
  // diagnosticul de rețea (useNetworkDiagnosis recunoaște același text).
  if (isNetworkError(error)) return i18n.t('authErrors.network');
  return error.message;
}
