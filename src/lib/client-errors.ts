import { Platform } from 'react-native';

import { currentAppVersion } from '@/lib/app-version';
import { supabase } from '@/lib/supabase';

/**
 * Erorile clientului fără terț (1.1, faza 9.1 — decizia D9.1 = NU Sentry). Un raport pleacă DOAR când
 * omul apasă „Trimite raportul” pe ecranul de eroare (components/error-boundary.tsx): fără handler
 * global, fără trimitere automată. RPC-ul `report_client_error` (migrarea 20261111000100) cere sesiune
 * (anon n-are EXECUTE), are plafon 10 / oră (`rate_limited`) și curăță textul DIN NOU la server
 * (`app.scrub_client_text`); pe un server fără migrare răspunde PGRST202 → `failed`.
 */

// ── Curățarea textului ─────────────────────────────────────────────────────────────────────────────
// ACELEAȘI reguli și ACEEAȘI ordine ca `app.scrub_client_text` din migrarea 20261111000100 (tiparele
// POSIX de acolo, rescrise pentru JS; se schimbă doar împreună). Ordinea contează: tokenurile întâi (un
// JWT conține puncte și cifre), apoi e-mailurile, UUID-urile și abia la urmă secvențele lungi de cifre
// (altfel un UUID ar pierde primul grup ca „telefon”). Diferențe de sintaxă față de SQL:
//  - `[[:space:]]` → `[ \t\n\v\f\r]` (spațiile ASCII ale clasei POSIX; nu `\s`, care prinde și Unicode);
//  - `Expo(nent)?PushToken[[][^]]*[]]` → paranteza pătrată scăpată (`[^]]` în JS ar însemna „orice caracter”
//    urmat de `]`).
// „Telefon” = cel puțin 8 cifre cu cel mult 3 separatori (spațiu ( ) . / -) între două cifre; prinde și date ISO,
// timestamp-uri și offset-uri lungi din stivă — acceptat (se pierde diagnostic, nu apare risc).
const SCRUB_RULES: readonly (readonly [RegExp, string])[] = [
  [/eyJ[A-Za-z0-9_-]{5,}[.][A-Za-z0-9_-]{5,}[.][A-Za-z0-9_-]{5,}/g, '[token]'],
  [/[Bb]earer[ \t\n\v\f\r]+[A-Za-z0-9._~+/=-]+/g, '[token]'],
  [/sb_(secret|publishable)_[A-Za-z0-9_-]+/g, '[token]'],
  [/Expo(?:nent)?PushToken\[[^\]]*\]/g, '[token]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,}/g, '[email]'],
  [/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, '[id]'],
  [/[+]?[0-9](?:[ ()./-]{0,3}[0-9]){7,}/g, '[phone]'],
];

/**
 * Textul fără e-mailuri, id-uri, telefoane și tokenuri, tăiat la `max` caractere (ca `left()` din
 * Postgres: pe puncte de cod, deci un emoji nu se rupe în două). `null` / `undefined` → `''`.
 */
export function scrubText(text: string | null | undefined, max: number): string {
  let out = text ?? '';
  for (const [pattern, replacement] of SCRUB_RULES) {
    out = out.replace(pattern, replacement);
  }
  const limit = Math.max(Math.floor(max) || 0, 0);
  const chars = Array.from(out);
  return chars.length > limit ? chars.slice(0, limit).join('') : out;
}

// ── Raportul ──────────────────────────────────────────────────────────────────────────────────────
const MAX_SCREEN = 120;
const MAX_TYPE = 80;
const MAX_MESSAGE = 500;
const MAX_STACK = 4000;
/** Plafonul cererii: pe rețea slabă omul vede „nu s-a putut trimite”, nu un buton care se rotește la nesfârșit. */
const REPORT_TIMEOUT_MS = 15_000;

export interface ClientErrorInput {
  /** Ruta curentă (usePathname) — curățată (id-urile din cale devin `[id]`). */
  screen: string | null | undefined;
  error: Error;
}

export type ReportClientErrorResult = {
  ok: boolean;
  reason?: 'no_session' | 'rate_limited' | 'failed';
};

/** Cât din mesajul tehnic se arată pe ecran (la server pleacă primele 500 de caractere). */
const MAX_MESSAGE_SHOWN = 200;

/** Ce i se arată omului înainte de trimitere (aceleași valori curățate care pleacă la server). */
export function describeClientError(
  screen: string | null | undefined,
  error: Error
): { type: string; message: string; screen: string; version: string } {
  return {
    // Serverul pune `Error` când tipul vine gol — aceeași rezervă aici.
    type: scrubText(error.name, MAX_TYPE).trim() || 'Error',
    message: scrubText(error.message, MAX_MESSAGE_SHOWN).trim(),
    screen: scrubText(screen, MAX_SCREEN).trim(),
    version: currentAppVersion() ?? '',
  };
}

/**
 * Trimite raportul. Nu aruncă niciodată. Fără sesiune nu trimite nimic (`no_session`); `rate_limited` =
 * plafonul de 10 / oră; orice altceva (rețea, timeout, RPC lipsă pe server) = `failed`.
 */
export async function reportClientError({ screen, error }: ClientErrorInput): Promise<ReportClientErrorResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ReportClientErrorResult>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: 'failed' }), REPORT_TIMEOUT_MS);
  });
  try {
    return await Promise.race([send(screen, error), timeout]);
  } catch {
    return { ok: false, reason: 'failed' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function send(screen: string | null | undefined, error: Error): Promise<ReportClientErrorResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { ok: false, reason: 'no_session' };

  const { error: rpcError } = await supabase.rpc('report_client_error', {
    p_app_build: currentAppVersion() ?? '',
    p_platform: Platform.OS,
    // Pe web `Platform.Version` nu există (ar pleca textul „undefined”).
    p_os_version: Platform.OS === 'web' || Platform.Version == null ? '' : String(Platform.Version),
    p_screen: scrubText(screen, MAX_SCREEN),
    p_error_type: scrubText(error.name, MAX_TYPE),
    p_message: scrubText(error.message, MAX_MESSAGE),
    p_stack: scrubText(error.stack, MAX_STACK),
  });
  if (!rpcError) return { ok: true };
  if (rpcError.message === 'rate_limited') return { ok: false, reason: 'rate_limited' };
  // `not_authenticated` (sesiune expirată între timp) — butonul nu mai are sens.
  if (rpcError.message === 'not_authenticated') return { ok: false, reason: 'no_session' };
  return { ok: false, reason: 'failed' };
}
