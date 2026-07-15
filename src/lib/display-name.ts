/**
 * Numele de afișat pentru un alt utilizator (Faza 15).
 * Un cont șters (piatră-funerară, `deleted_at` setat) apare peste tot ca „Utilizator șters",
 * indiferent de valoarea stocată în `full_name` (care e golită la '' la purjă). Marcajul se
 * traduce per privitor, deci nu-l stocăm în DB.
 */
export function displayName(
  user: { full_name?: string | null; deleted_at?: string | null } | null | undefined,
  t: (key: string) => string,
): string {
  if (!user) return t('common.defaultUser');
  if (user.deleted_at) return t('common.deletedUser');
  return user.full_name || t('common.defaultUser');
}

/** True dacă profilul e o piatră-funerară (cont șters) — pentru a dezactiva acțiunile de inițiere. */
export function isDeletedUser(user: { deleted_at?: string | null } | null | undefined): boolean {
  return !!user?.deleted_at;
}
