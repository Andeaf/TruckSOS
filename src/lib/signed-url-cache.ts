import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  SIGNED_URL_TTL,
  activeTransform,
  signedUrlExpiry,
  signedUrlPath,
  signedUrls,
  type ImageTransform,
} from '@/lib/storage';

/**
 * Cache GLOBAL de URL-uri semnate: path (+ miniatură) → { url, exp } (AUDIT #29, pas 7.3).
 *
 * De ce: fiecare ecran (și fiecare refresh din Market) cerea din nou URL-uri pentru
 * aceleași poze. Pe rețea slabă, fiecare semnare în plus e o șansă de poză goală,
 * iar URL-ul nou (alt token) rata cache-ul — cauzele raportului din 15 oct.
 *
 * - În memorie: un Map în ordine LRU (o citire mută intrarea la coadă).
 * - Pe disc: o singură cheie JSON în AsyncStorage, scrisă cu debounce, plafonată la
 *   MAX_ENTRIES (~500 × ~0,5 KB ≈ 250 KB) — după o repornire în aceeași oră pozele
 *   se afișează fără nicio cerere de semnare.
 * - Expirare pe CEASUL TELEFONULUI (review 7.3): `exp` din token e ora serverului; cu
 *   ceasul telefonului în urmă, un URL mort ar fi părut valid (și ar fi rămas așa și
 *   după repornire, din disc). Deci: semnările proprii primesc `exp = momentul cererii
 *   + TTL` (ceasul telefonului, ușor pesimist), iar din ele învățăm decalajul
 *   server − telefon; URL-urile „învățate" (semnate de alt cod) se convertesc cu el
 *   și se ignoră cât timp decalajul nu e cunoscut. O intrare e folosibilă doar dacă
 *   mai are cel puțin `minValidityMs` (implicit 60 s).
 * - Eșecurile (RLS, rețea) NU se păstrează — rămân de reîncercat.
 * - Logout: nu se golește automat. URL-urile semnate nu țin de sesiune (sunt valabile
 *   ≤ 1h oricui le are), iar UI-ul unui alt cont cere doar path-uri din rânduri pe care
 *   RLS i le arată deja; ce rămâne pe disc expiră singur în cel mult o oră.
 *   `clearSignedUrlCache()` există pentru logout / ștergere cont (pas ulterior).
 */

interface Entry {
  url: string;
  /** Expirarea, ms epoch pe ceasul TELEFONULUI. */
  exp: number;
}

// v2: `exp` pe ceasul telefonului (v1, cu ora din token, nu a ajuns la useri).
const STORAGE_KEY = 'signed-url-cache-v2';
const MAX_ENTRIES = 500;
const PERSIST_DEBOUNCE_MS = 2000;
/**
 * O semnare în zbor mai veche de atât nu mai e așteptată de cererile noi: un fetch
 * blocat (fără timeout, ~60 s pe iOS) nu ține pe loc semnările pornite de „rețea revenită".
 */
const INFLIGHT_STALE_MS = 20_000;
/** Prag implicit (cerut de brief): sub atât, URL-ul e tratat ca expirat. */
export const MIN_VALIDITY_MS = 60_000;
/**
 * Pragul pentru listele care stau mult pe ecran (hook-ul de semnare, coperți Market):
 * refolosim un URL doar dacă mai are ≥ 15 min, adică are cel mult 45 min — exact
 * regula de re-semnare de dinainte. Altfel, cardurile montate la scroll după câteva
 * minute ar primi tokenuri expirate și ar re-semna fiecare separat.
 */
export const LIST_MIN_VALIDITY_MS = 15 * 60_000;

const entries = new Map<string, Entry>();
const inflight = new Map<string, { promise: Promise<string | undefined>; startedAt: number }>();
let hydration: Promise<void> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
/** Ora din token − ora telefonului (ms); null până la prima semnare proprie reușită. */
let clockOffsetMs: number | null = null;
/** Crește la `clearSignedUrlCache`: rezultatele sosite după golire nu mai intră în cache. */
let generation = 0;

/** Cheia din cache: path-ul simplu sau path + miniatură (chei separate). */
function cacheKey(path: string, transform?: ImageTransform): string {
  return transform ? `${path}|w${transform.width}|${transform.resize ?? 'cover'}` : path;
}

/** Cheia `cacheKey` pentru expo-image a unei miniaturi (URL-ul ei nu conține lățimea). */
export function thumbnailCacheKey(path: string, transform: ImageTransform): string {
  return cacheKey(path, transform);
}

function isUsable(entry: Entry | undefined, minValidityMs: number): entry is Entry {
  return !!entry && entry.exp - minValidityMs > Date.now();
}

function trim() {
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const now = Date.now();
    const rows: [string, string, number][] = [];
    entries.forEach((entry, key) => {
      if (entry.exp - MIN_VALIDITY_MS > now) rows.push([key, entry.url, entry.exp]);
    });
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(rows.slice(-MAX_ENTRIES))).catch(() => {
      // best-effort: fără disc, cache-ul rămâne doar în memorie
    });
  }, PERSIST_DEBOUNCE_MS);
}

/** Încarcă intrările de pe disc o singură dată (leneș, la prima folosire — nu la import). */
function ensureHydrated(): Promise<void> {
  if (!hydration) {
    const gen = generation;
    hydration = AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!raw || gen !== generation) return;
        const rows = JSON.parse(raw) as unknown;
        if (!Array.isArray(rows)) return;
        const now = Date.now();
        // Cele de pe disc sunt mai vechi decât cele din sesiunea curentă → în fața LRU.
        const merged = new Map<string, Entry>();
        rows.forEach((row: unknown) => {
          if (!Array.isArray(row)) return;
          const [key, url, exp] = row as unknown[];
          if (typeof key !== 'string' || typeof url !== 'string' || typeof exp !== 'number') return;
          // Un `exp` absurd de departe (ceasul telefonului dat înapoi între timp) → aruncat.
          if (exp - MIN_VALIDITY_MS <= now || exp > now + SIGNED_URL_TTL * 1000) return;
          if (entries.has(key)) return;
          merged.set(key, { url, exp });
        });
        if (merged.size === 0) return;
        entries.forEach((entry, key) => merged.set(key, entry));
        entries.clear();
        merged.forEach((entry, key) => entries.set(key, entry));
        trim();
      })
      .catch(() => {
        // JSON stricat sau disc indisponibil: pornim cu cache gol
      });
  }
  return hydration;
}

/**
 * URL-ul din cache, SINCRON (fără disc, fără rețea) — pentru prima randare, ca o
 * poză deja semnată să nu mai clipească la remontare. `undefined` dacă lipsește
 * sau mai are sub `minValidityMs`.
 */
export function getCachedUrl(
  path: string,
  transform?: ImageTransform,
  minValidityMs: number = MIN_VALIDITY_MS,
): string | undefined {
  void ensureHydrated();
  const key = cacheKey(path, activeTransform(transform));
  const entry = entries.get(key);
  if (!isUsable(entry, minValidityMs)) return undefined;
  entries.delete(key);
  entries.set(key, entry);
  return entry.url;
}

/**
 * Expirarea unui URL semnat pe ceasul TELEFONULUI (ms epoch), de comparat cu
 * `Date.now()`: din cache dacă e chiar URL-ul de acolo, altfel din token corectat cu
 * decalajul învățat (fără decalaj: ora din token, ca înainte). null = necunoscută.
 */
export function localExpiry(url: string): number | null {
  const path = signedUrlPath(url);
  const entry = path ? entries.get(path) : undefined;
  if (entry && entry.url === url) return entry.exp;
  const tokenExp = signedUrlExpiry(url);
  if (tokenExp == null) return null;
  return clockOffsetMs == null ? tokenExp : tokenExp - clockOffsetMs;
}

function putEntry(key: string, url: string, exp: number): boolean {
  const current = entries.get(key);
  if (current && current.exp >= exp) return false;
  entries.delete(key);
  entries.set(key, { url, exp });
  return true;
}

function afterPut(changed: boolean) {
  if (!changed) return;
  trim();
  schedulePersist();
}

/**
 * Rezultatul unei semnări PROPRII: `exp` = momentul cererii + TTL (ceasul telefonului);
 * din tokenuri învățăm decalajul server − telefon (măsurat la primire → pesimist).
 */
function storeOwnSigning(
  urls: Record<string, string>,
  transform: ImageTransform | undefined,
  signedAt: number,
  receivedAt: number,
): void {
  const exp = signedAt + SIGNED_URL_TTL * 1000;
  let changed = false;
  Object.entries(urls).forEach(([path, url]) => {
    const tokenExp = signedUrlExpiry(url);
    if (tokenExp != null) clockOffsetMs = tokenExp - (receivedAt + SIGNED_URL_TTL * 1000);
    if (putEntry(cacheKey(path, transform), url, exp)) changed = true;
  });
  afterPut(changed);
}

/**
 * Învață un URL semnat primit din altă parte (ex. semnat direct de un ecran): dacă e
 * al bucket-ului nostru și expiră mai târziu decât ce știm, îl păstrăm. Fără decalajul
 * de ceas încă învățat nu-l păstrăm (n-am ști când expiră pe ceasul telefonului).
 */
export function rememberSignedUrl(url: string): void {
  const path = signedUrlPath(url);
  const tokenExp = signedUrlExpiry(url);
  if (!path || tokenExp == null || clockOffsetMs == null) return;
  // Plafon: niciun URL nu trăiește mai mult de un TTL de acum.
  const exp = Math.min(tokenExp - clockOffsetMs, Date.now() + SIGNED_URL_TTL * 1000);
  afterPut(putEntry(path, url, exp));
}

/**
 * Golește tot (memorie, cereri în zbor, disc). Pentru logout / ștergere cont — încă
 * neapelată (use-auth.tsx, pas ulterior).
 */
export async function clearSignedUrlCache(): Promise<void> {
  generation += 1;
  entries.clear();
  inflight.clear();
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  // Discul a fost golit → nu mai e nimic de încărcat de acolo.
  hydration = Promise.resolve();
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // best-effort: ce rămâne pe disc expiră singur în cel mult o oră
  }
}

/**
 * Path → URL semnat pentru afișare. Ce e valid în cache nu mai pleacă la server;
 * restul se cere ÎNTR-UN SINGUR apel per lot, iar un path deja în zbor (alt ecran,
 * aceeași clipă) nu se cere a doua oară. Path-urile refuzate (RLS) sau picate
 * (rețea) lipsesc din rezultat și nu intră în cache.
 */
export async function signPaths(
  paths: string[],
  options?: { transform?: ImageTransform; minValidityMs?: number },
): Promise<Record<string, string>> {
  const transform = activeTransform(options?.transform);
  const minValidityMs = options?.minValidityMs ?? MIN_VALIDITY_MS;
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (unique.length === 0) return {};
  await ensureHydrated();

  const result: Record<string, string> = {};
  const waiting: Promise<void>[] = [];
  const toFetch: string[] = [];
  const now = Date.now();

  unique.forEach((path) => {
    const cached = getCachedUrl(path, transform, minValidityMs);
    if (cached) {
      result[path] = cached;
      return;
    }
    const pending = inflight.get(cacheKey(path, transform));
    if (pending && now - pending.startedAt < INFLIGHT_STALE_MS) {
      waiting.push(
        pending.promise.then((url) => {
          if (url) result[path] = url;
        }),
      );
      return;
    }
    toFetch.push(path);
  });

  if (toFetch.length > 0) {
    const signedAt = Date.now();
    const gen = generation;
    const batch = signedUrls(toFetch, { transform })
      .catch((): Record<string, string> => ({}))
      .then((fresh) => {
        if (gen === generation) storeOwnSigning(fresh, transform, signedAt, Date.now());
        return fresh;
      });
    toFetch.forEach((path) => {
      const key = cacheKey(path, transform);
      const promise = batch.then((fresh) => fresh[path] as string | undefined);
      inflight.set(key, { promise, startedAt: signedAt });
      waiting.push(
        promise.then((url) => {
          if (inflight.get(key)?.promise === promise) inflight.delete(key);
          if (url) result[path] = url;
        }),
      );
    });
  }

  await Promise.all(waiting);
  return result;
}
