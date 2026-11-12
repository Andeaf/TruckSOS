import { translateDbError } from '@/lib/db-errors';
import { supabase } from '@/lib/supabase';

/**
 * Consimțământul la Termeni + confirmarea vârstei (1.1, faza 8.2 — C8.2; migrarea
 * 20261110000100_terms_consent). Aceeași valoare apare în textele legale („Versiunea 1.1.0”),
 * se trimite la `accept_terms` și se compară în poarta din `_layout.tsx`: la o versiune nouă a
 * textelor se schimbă AICI, iar toți cei cu altă versiune pe server văd din nou foaia.
 */
export const TERMS_VERSION = '1.1.0';

export type TermsStatus = {
  terms_version: string | null;
  terms_accepted_at: string | null;
  age_confirmed_at: string | null;
};

/**
 * Plafonul citirii la pornire: cât timp așteaptă, garda ține ecranul de încărcare. Pe rețea
 * slabă nu ținem omul mai mult de atât (fetch-ul global are 10 s); la depășire → null (vezi
 * `needsTermsAcceptance`).
 */
const STATUS_TIMEOUT_MS = 5000;

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Starea proprie, prin RPC-ul `my_terms_status()`. Orice eșec → null: rețea, timeout, sesiune
 * fără token valid (cererea pleacă anonim, anon n-are EXECUTE) sau serverul încă fără migrarea
 * 8.2 (PGRST202) — clientul 1.1 merge atunci exact ca înainte.
 */
export async function fetchTermsStatus(): Promise<TermsStatus | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), STATUS_TIMEOUT_MS);
    });
    const request = supabase.rpc('my_terms_status').then(({ data, error }) => {
      if (error) {
        if (__DEV__) console.warn('[terms] my_terms_status:', error.code, error.message);
        return null;
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
      const row = data as Record<string, unknown>;
      return {
        terms_version: asStringOrNull(row.terms_version),
        terms_accepted_at: asStringOrNull(row.terms_accepted_at),
        age_confirmed_at: asStringOrNull(row.age_confirmed_at),
      };
    });
    return await Promise.race([request, timeout]);
  } catch (e) {
    if (__DEV__) console.warn('[terms] my_terms_status a eșuat:', e);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Acceptarea versiunii curente (`accept_terms`): scrie pe server versiunea, data și confirmarea
 * 18+, plus rândul din jurnalul de consimțământ. Întoarce eroarea tradusă sau null la succes.
 */
export async function acceptTerms(source: 'signup' | 'update'): Promise<string | null> {
  try {
    const { error } = await supabase.rpc('accept_terms', {
      p_version: TERMS_VERSION,
      p_source: source,
    });
    return error ? translateDbError(error) : null;
  } catch (e) {
    return translateDbError(e);
  }
}

/**
 * Poarta „Termenii s-au actualizat” se coboară doar cu răspunsul serverului că versiunea
 * acceptată nu e cea curentă (inclusiv NULL — conturile 1.0.x). La `status === null` (citirea
 * a picat: rețea, timeout, server fără migrare) NU blocăm aplicația: un om cu sesiune validă
 * n-ar mai putea folosi nimic pe o rețea proastă; foaia apare la următoarea pornire reușită.
 */
export function needsTermsAcceptance(status: TermsStatus | null): boolean {
  if (status === null) return false;
  return status.terms_version !== TERMS_VERSION;
}
