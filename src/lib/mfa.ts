import type { AuthError, Factor, Session } from '@supabase/supabase-js';

import i18n from '@/i18n';
import { isNetworkError } from '@/lib/network-diagnosis';

/**
 * Autentificarea în doi pași (TOTP) pentru conturile admin — PLAN_1.1_FIX 4.4.
 *
 * În 1.1 serverul NU cere încă `aal2` (condiția din `is_admin()` vine în faza 11): aici e doar
 * înrolarea și ecranul de cod de după login.
 */

/** Numele afișat în aplicația de autentificare (Google Authenticator, 1Password, Parole iOS…). */
export const MFA_ISSUER = 'TruckSOS';

/** Nivelul `aal` din tokenul de acces (payload base64url decodat local, ca `signedUrlExpiry`). */
function sessionAal(session: Session): string | null {
  const payload = session.access_token?.split('.')[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const aal = (JSON.parse(atob(padded)) as { aal?: unknown }).aal;
    return typeof aal === 'string' ? aal : null;
  } catch {
    return null;
  }
}

/** Factorii TOTP verificați din sesiune (lista vine cu userul, la login și la fiecare refresh). */
export function verifiedTotpFactors(session: Session | null): Factor[] {
  return (session?.user.factors ?? []).filter(
    (f) => f.factor_type === 'totp' && f.status === 'verified',
  );
}

/**
 * `true` când sesiunea trebuie ridicată la `aal2` înainte de a intra în aplicație: contul are
 * un factor verificat (nextLevel = aal2), iar tokenul curent e încă `aal1`.
 *
 * Aceeași regulă ca `supabase.auth.mfa.getAuthenticatorAssuranceLevel()` fără argument (auth-js
 * 2.108: `aal` din JWT + factorii verificați din `session.user`), dar SINCRON și pe sesiunea din
 * starea aplicației: garda de navigare decide pe loc, fără cerere și fără ecran de încărcare, și
 * merge și cu sesiunea citită din storage la pornire pe rețea slabă (atunci `getSession()` din
 * bibliotecă dă null și apelul oficial ar răspunde „nimic de cerut”).
 */
export function sessionNeedsMfa(session: Session | null): boolean {
  if (!session) return false;
  if (verifiedTotpFactors(session).length === 0) return false;
  return sessionAal(session) !== 'aal2';
}

/**
 * Codul QR primit la `mfa.enroll` e `data:image/svg+xml;utf-8,<svg…>` (SVG brut, neescapat).
 * Întoarce SVG-ul ca text, pentru WebView pe telefon; null dacă nu arată a SVG.
 */
export function qrSvgMarkup(qrCode: string | undefined): string | null {
  if (!qrCode) return null;
  const start = qrCode.indexOf('<svg');
  if (start < 0) return null;
  const svg = qrCode.slice(start);
  // GoTrue scrie `<svg width="N" height="N">` fără viewBox: un astfel de SVG nu se scalează, ci
  // se taie când cutia e mai mică decât N. Cu viewBox din dimensiunile lui, se potrivește în cutie.
  const tagEnd = svg.indexOf('>');
  if (tagEnd < 0) return null;
  const tag = svg.slice(0, tagEnd);
  if (/\sviewBox=/i.test(tag)) return svg;
  const width = /\swidth="(\d+(?:\.\d+)?)"/.exec(tag)?.[1];
  const height = /\sheight="(\d+(?:\.\d+)?)"/.exec(tag)?.[1];
  if (!width || !height) return svg;
  return `<svg viewBox="0 0 ${width} ${height}"${svg.slice(4)}`;
}

/** Același SVG ca data URL base64 (pe web: `#` și ghilimelele din SVG brut strică URL-ul). */
export function qrSvgDataUrl(qrCode: string | undefined): string | null {
  const svg = qrSvgMarkup(qrCode);
  if (!svg) return null;
  try {
    return `data:image/svg+xml;base64,${btoa(svg)}`;
  } catch {
    // btoa acceptă doar Latin-1; SVG-ul de la Supabase e ASCII, dar nu riscăm o excepție.
    return null;
  }
}

/** Secretul grupat câte 4 caractere, mai ușor de tastat de mână. */
export function formatSecret(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

/** Mesaj tradus pentru erorile MFA; nimic brut în engleză pe ecran. */
export function translateMfaError(error: AuthError | null): string | null {
  if (!error) return null;
  if (isNetworkError(error)) return i18n.t('authErrors.network');
  if (error.code === 'mfa_verification_failed' || error.code === 'mfa_verification_rejected') {
    return i18n.t('twoFactor.wrongCode');
  }
  if (error.code === 'mfa_challenge_expired') return i18n.t('twoFactor.codeExpired');
  if (error.code === 'mfa_totp_enroll_not_enabled' || error.code === 'mfa_totp_verify_not_enabled') {
    return i18n.t('twoFactor.notEnabled');
  }
  if (error.code === 'over_request_rate_limit') return i18n.t('authErrors.over_request_rate_limit');
  if (__DEV__) console.warn('[mfa]', error.code, error.message);
  return i18n.t('twoFactor.genericError');
}
