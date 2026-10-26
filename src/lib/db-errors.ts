import i18n from '@/i18n';
import { isNetworkError } from '@/lib/network-diagnosis';

/**
 * Erorile de la Supabase (PostgREST, Postgres, Storage), traduse pentru utilizator
 * (26 oct 2026, PLAN_1.1_FIX 2.3, AUDIT #37). Până acum hook-urile întorceau `error.message`
 * brut („new row violates row-level security policy for table …"), care ajungea în Alert.
 *
 * Reguli, în ordinea aplicării:
 *  1. codurile din PASS_THROUGH rămân neatinse — ecranele le tratează singure (ramuri în UI);
 *  2. rețea → același text ca la auth (ecranele pornesc pe el diagnosticul de rețea);
 *  3. codurile ridicate de serverul nostru (RAISE EXCEPTION 'rate_limited' …) → text propriu;
 *  4. SQLSTATE cunoscut (23505, 23514, 42501 …) → text pe categorie;
 *  5. erorile de Storage (MIME respins, fișier prea mare, politică/cotă) → text propriu;
 *  6. orice altceva → „A apărut o eroare” + codul scurt în paranteză (diagnosticabil din captură,
 *     fără numele tabelelor pe ecran).
 */

type ErrorLike = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  status?: unknown;
  statusCode?: unknown;
};

/** Coduri pe care clientul le compară direct (ex. `error === 'blocked_by_you'`). */
const PASS_THROUGH: ReadonlySet<string> = new Set(['blocked_by_you']);

/** Codurile ridicate de RPC-uri și triggere (RAISE EXCEPTION '<cod>'). */
const RAISED: Readonly<Record<string, string>> = {
  rate_limited: 'dbErrors.rate_limited',
  account_banned: 'dbErrors.account_banned',
  photo_limit_reached: 'dbErrors.photo_limit_reached',
  listing_limit_reached: 'dbErrors.listing_limit_reached',
  too_long: 'dbErrors.too_long',
  empty: 'dbErrors.empty',
  not_allowed: 'dbErrors.not_allowed',
  not_admin: 'dbErrors.not_allowed',
  not_found: 'dbErrors.not_found',
  user_not_found: 'dbErrors.not_found',
  listing_not_found: 'dbErrors.not_found',
  profile_not_found: 'dbErrors.not_found',
  not_authenticated: 'common.noSession',
  no_session: 'common.noSession',
  announcement_not_open: 'dbErrors.announcement_not_open',
  'Announcement not available': 'dbErrors.announcement_not_open', // resubmit_application (20260721)
  listing_not_active: 'dbErrors.listing_not_active',
  cannot_contact_self: 'dbErrors.cannot_contact_self',
};

const SQLSTATE: Readonly<Record<string, string>> = {
  '23505': 'dbErrors.duplicate',
  '23503': 'dbErrors.gone',
  '22001': 'dbErrors.too_long',
  '22P02': 'dbErrors.invalid',
  '42501': 'dbErrors.not_allowed',
  PGRST116: 'dbErrors.not_found',
  '57014': 'dbErrors.timeout',
  '53300': 'dbErrors.busy',
  '53400': 'dbErrors.busy',
};

function parts(error: unknown): { code: string | null; message: string; details: string | null; status: number | null } {
  if (typeof error === 'string') return { code: null, message: error, details: null, status: null };
  const e = error as ErrorLike;
  const code = typeof e.code === 'string' ? e.code : null;
  const message = typeof e.message === 'string' ? e.message : String(error);
  const details = typeof e.details === 'string' ? e.details : null;
  const raw = e.statusCode ?? e.status;
  const status = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : null;
  return { code, message, details, status };
}

export function translateDbError(error: null | undefined): null;
export function translateDbError(error: string | object): string;
export function translateDbError(error: unknown): string | null;
export function translateDbError(error: unknown): string | null {
  if (error === null || error === undefined) return null;
  const { code, message, details, status } = parts(error);

  if (PASS_THROUGH.has(message)) return message;
  if (isNetworkError(error)) return i18n.t('authErrors.network');

  if (message === 'rate_limited' && details === 'announcements_open') return i18n.t('dbErrors.rate_limited_open');
  const raised = RAISED[message];
  if (raised) return i18n.t(raised);

  if (code === '23514') {
    // CHECK-urile de lungime se numesc <tabel>_<coloană>_len (migrarea 20261031000100).
    return i18n.t(/_len"?\s*$/.test(message) ? 'dbErrors.too_long' : 'dbErrors.invalid');
  }
  if (code && SQLSTATE[code]) return i18n.t(SQLSTATE[code]);

  // Storage: StorageApiError n-are `code`, are `status`/`statusCode` și mesaje în engleză.
  if (!code) {
    if (/mime ?type .* not supported/i.test(message)) return i18n.t('dbErrors.storage_type');
    if (status === 413 || /exceeded the maximum allowed size|payload too large|too large/i.test(message)) {
      return i18n.t('dbErrors.storage_size');
    }
    if (status === 403 || /row-level security|security policy|not authorized|unauthorized/i.test(message)) {
      return i18n.t('dbErrors.storage_refused');
    }
  }
  if (/row-level security|permission denied/i.test(message)) return i18n.t('dbErrors.not_allowed');

  const tag = code ?? (/^[a-z_]{3,40}$/.test(message) ? message : null);
  return i18n.t('dbErrors.generic') + (tag ? ` (${tag})` : '');
}
