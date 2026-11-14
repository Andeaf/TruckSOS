import type { Profile } from '@/types/database';

/**
 * Ban APLICATIV (Faza 16). Sursa de adevăr = coloanele de pe profiles.
 * banned_at NULL → nebanat; banned_until NULL → permanent; altfel expiră la depășirea datei.
 * Aceeași logică e impusă server-side de is_banned() + trigger-ul guard_not_banned.
 */
export function isBanned(p: Pick<Profile, 'banned_at' | 'banned_until'> | null | undefined): boolean {
  if (!p?.banned_at) return false;
  if (!p.banned_until) return true;
  const until = new Date(p.banned_until).getTime();
  // O dată care nu se poate citi NU înseamnă „ban expirat”: contul are banned_at, deci rămâne banat în interfață
  // (12 nov 2026). Serverul rămâne autoritatea — is_banned() + guard_not_banned decid ce poate scrie contul.
  if (Number.isNaN(until)) return true;
  return until > Date.now();
}

/**
 * Data la care expiră banul, pentru afișare. `null` = fără dată de arătat: ban permanent sau o dată care nu se
 * poate citi (ecranul arată atunci varianta fără dată, nu „Invalid Date”).
 */
export function banExpiryDate(p: Pick<Profile, 'banned_until'> | null | undefined): Date | null {
  if (!p?.banned_until) return null;
  const until = new Date(p.banned_until);
  return Number.isNaN(until.getTime()) ? null : until;
}
