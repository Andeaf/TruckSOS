import { Platform } from 'react-native';

import i18n from '@/i18n';

/**
 * Diagnostic de rețea pentru erorile „Network request failed" (13 oct 2026).
 *
 * Reclamație reală: un mecanic din Germania (iPhone, 5G, rețeaua 1&1) nu se putea
 * conecta de câteva zile; captura arăta ecranul de login cu eroarea brută a lui fetch,
 * netradusă și fără nicio indicație. Internetul lui mergea (ne-a trimis email de pe
 * același telefon), deci blocajul era specific aplicației sau host-ului nostru —
 * date mobile oprite pentru aplicație, VPN/DNS privat/blocant de reclame, ceas greșit.
 *
 * Nu putem repara telefonul de la distanță, dar putem spune EXACT ce e de făcut:
 * trei sonde în paralel (API-ul nostru, site-ul nostru, un host neutru Google) separă
 * „aplicația n-are deloc internet" de „internetul merge, dar serverul TruckSOS nu
 * poate fi contactat", iar antetul `Date` al oricărui răspuns reușit prinde ceasul
 * greșit. Orice răspuns HTTP (și 401/404) înseamnă „host accesibil"; doar respingerea
 * lui fetch (DNS, TCP, TLS, politică de sistem) înseamnă blocaj.
 *
 * Raportul complet (sonde, durate, starea rețelei din expo-network) se pune în coada
 * de diagnostice (lib/diagnostic-log.ts) și ajunge la admini după prima conectare
 * reușită — ca să vedem pe toți utilizatorii de la ce vin erorile.
 */
export type NetworkDiagnosis = 'offline' | 'blocked' | 'clock' | 'ok';

export interface ProbeResult {
  reachable: boolean;
  /** Durata până la răspuns sau până la eșec. */
  ms: number;
  status: number | null;
  /** Mesajul respingerii lui fetch (DNS/TCP/TLS/timeout), când nu e accesibil. */
  error: string | null;
  /** Ceasul serverului (antetul Date), ca să-l comparăm cu al telefonului. */
  serverTime: number | null;
}

export interface NetworkState {
  type: string | null;
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
}

export interface NetworkReport {
  diagnosis: NetworkDiagnosis;
  probes: { api: ProbeResult; web: ProbeResult; neutral: ProbeResult };
  /** Ceasul telefonului − ceasul serverului (ms); null fără niciun răspuns. */
  clockDriftMs: number | null;
  network: NetworkState | null;
}

const API_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const API_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const WEB_URL = 'https://trucksos.net';
const NEUTRAL_URL = 'https://www.gstatic.com/generate_204';

const PROBE_TIMEOUT_MS = 6000;
/** Peste atât, certificatele TLS încep să pice și serverul respinge token-urile. */
const CLOCK_DRIFT_MS = 5 * 60 * 1000;

const NETWORK_MESSAGE =
  /network request failed|failed to fetch|fetch failed|load failed|network error|networkerror|timed? ?out|ECONNREFUSED|ENOTFOUND|ERR_NETWORK/i;

/**
 * Eroarea vine din transport (nu de la server)? Acceptă obiecte Error/AuthError
 * (RN: „Network request failed"; Chrome: „Failed to fetch"; Safari: „Load failed";
 * supabase-js: `AuthRetryableFetchError`) sau direct mesajul deja tradus.
 */
export function isNetworkError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === 'string') {
    return error === i18n.t('authErrors.network') || NETWORK_MESSAGE.test(error);
  }
  const e = error as { name?: unknown; message?: unknown; status?: unknown };
  if (e.name === 'AuthRetryableFetchError' && (e.status === 0 || e.status === undefined)) return true;
  return typeof e.message === 'string' && NETWORK_MESSAGE.test(e.message);
}

/** Mesajul brut al unei erori, pentru jurnal (max 500 de caractere). */
export function errorMessageOf(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === 'string') return error.slice(0, 500);
  const e = error as { name?: unknown; message?: unknown };
  const name = typeof e.name === 'string' ? e.name : null;
  const message = typeof e.message === 'string' ? e.message : String(error);
  return (name && name !== 'Error' ? `${name}: ${message}` : message).slice(0, 500);
}

async function probe(url: string, init: RequestInit = {}): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const started = Date.now();
  try {
    const response = await fetch(url, { cache: 'no-store', ...init, signal: controller.signal });
    const date = response.headers?.get?.('date');
    const parsed = date ? Date.parse(date) : NaN;
    return {
      reachable: true,
      ms: Date.now() - started,
      status: response.status || null,
      error: null,
      serverTime: Number.isNaN(parsed) ? null : parsed,
    };
  } catch (e) {
    return {
      reachable: false,
      ms: Date.now() - started,
      status: null,
      error: controller.signal.aborted ? `timeout ${PROBE_TIMEOUT_MS}ms` : errorMessageOf(e),
      serverTime: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

const UNAVAILABLE: ProbeResult = { reachable: false, ms: 0, status: null, error: 'unconfigured', serverTime: null };

/** Starea rețelei văzută de sistem (expo-network); null dacă modulul nu răspunde. */
async function readNetworkState(): Promise<NetworkState | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Network = require('expo-network') as typeof import('expo-network');
    const state = await Network.getNetworkStateAsync();
    return {
      type: state.type ?? null,
      isConnected: state.isConnected ?? null,
      isInternetReachable: state.isInternetReachable ?? null,
    };
  } catch {
    return null;
  }
}

export async function diagnoseNetwork(): Promise<NetworkReport> {
  // Pe web, host-ul neutru nu are CORS → `no-cors`: răspuns opac, dar fetch-ul se
  // rezolvă (= accesibil) în loc să fie respins. RN ignoră `mode`.
  const [api, web, neutral, network] = await Promise.all([
    API_URL
      ? probe(`${API_URL}/auth/v1/health`, { headers: { apikey: API_KEY } })
      : Promise.resolve(UNAVAILABLE),
    probe(`${WEB_URL}/`, Platform.OS === 'web' ? { mode: 'no-cors' } : {}),
    probe(NEUTRAL_URL, { mode: 'no-cors' }),
    readNetworkState(),
  ]);

  const serverTime = api.serverTime ?? web.serverTime ?? neutral.serverTime;
  const clockDriftMs = serverTime === null ? null : Date.now() - serverTime;
  const clockOff = clockDriftMs !== null && Math.abs(clockDriftMs) > CLOCK_DRIFT_MS;

  const diagnosis: NetworkDiagnosis = api.reachable
    ? 'ok'
    : clockOff
      ? 'clock'
      : !web.reachable && !neutral.reachable
        ? 'offline'
        : 'blocked';

  return { diagnosis, probes: { api, web, neutral }, clockDriftMs, network };
}
