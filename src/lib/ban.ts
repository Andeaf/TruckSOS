import type { Profile } from '@/types/database';

/**
 * Ban APLICATIV (Faza 16). Sursa de adevăr = coloanele de pe profiles.
 * banned_at NULL → nebanat; banned_until NULL → permanent; altfel expiră la depășirea datei.
 * Aceeași logică e impusă server-side de is_banned() + trigger-ul guard_not_banned.
 */
export function isBanned(p: Pick<Profile, 'banned_at' | 'banned_until'> | null | undefined): boolean {
  if (!p?.banned_at) return false;
  if (!p.banned_until) return true;
  return new Date(p.banned_until).getTime() > Date.now();
}
