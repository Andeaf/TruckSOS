/**
 * Validări UȘOARE pentru câmpurile de profil (Faza 18.4) — sanity checks care
 * refuză doar formate evident invalide, nu validare completă (explicit FĂRĂ VIES).
 * Refolosite de: editarea profilului, pasul de date din role-select și formularul
 * admin de editare (F18.5) — aceleași reguli peste tot.
 */

/** Scoate spații, puncte, cratime, paranteze — ce rămâne trebuie să fie +?cifre. */
export function normalizePhone(raw: string): string {
  return raw.replace(/[\s().-]/g, '');
}

export function isValidPhone(raw: string): boolean {
  return /^\+?[0-9]{8,15}$/.test(normalizePhone(raw));
}

/** Uppercase + fără spații/puncte/cratime — forma în care se și salvează. */
export function normalizeVat(raw: string): string {
  return raw.replace(/[\s.-]/g, '').toUpperCase();
}

/**
 * RO/DE strict(ish), UE generic, plus CUI românesc fără prefix (uzual nefiscal) —
 * un CUI valid nu trebuie respins doar pentru că userul n-a scris „RO" în față.
 */
export function isValidVat(raw: string): boolean {
  const v = normalizeVat(raw);
  if (v.startsWith('RO')) return /^RO[0-9]{2,10}$/.test(v);
  if (v.startsWith('DE')) return /^DE[0-9]{9}$/.test(v);
  if (/^[A-Z]{2}/.test(v)) return /^[A-Z]{2}[0-9A-Z]{2,12}$/.test(v); // generic UE
  return /^[0-9]{2,10}$/.test(v); // CUI fără prefix de țară
}
