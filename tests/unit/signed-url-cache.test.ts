import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deferred } from './mocks/flush';

/**
 * `@/lib/storage` rulează REAL (signedUrls, signedUrlPath, signedUrlExpiry); se înlocuiesc doar
 * frunzele lui native și clientul Supabase. `createSignedUrls` imită serverul: tokenul JWT are
 * `exp` = ceasul SERVERULUI + TTL, iar ceasul serverului poate fi decalat față de telefon (`skewMs`).
 */
const env = await vi.hoisted(async () => {
  const { createMemoryStorage } = await import('./mocks/async-storage');
  const { createPlatform } = await import('./mocks/react-native');
  type SignedItem = { path: string | null; signedUrl: string | null; error: string | null };
  type SignResult = { data: SignedItem[] | null; error: { message: string } | null };
  const bucket = {
    createSignedUrls: vi.fn<(paths: string[], ttl: number) => Promise<SignResult>>(),
    createSignedUrl: vi.fn(),
    upload: vi.fn(),
    remove: vi.fn(),
  };
  return {
    storage: createMemoryStorage(),
    platform: createPlatform(),
    bucket,
    from: vi.fn<(bucketName: string) => typeof bucket>(() => bucket),
    clock: { skewMs: 0 },
  };
});

vi.mock('@react-native-async-storage/async-storage', () => ({ default: env.storage.api }));
vi.mock('react-native', () => ({ Platform: env.platform }));
vi.mock('expo-file-system', () => ({ File: class {} }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'uuid' }));
vi.mock('@/lib/images', () => ({ compressImage: vi.fn() }));
vi.mock('@/i18n', async () => (await import('./mocks/i18n')).i18nModule);
vi.mock('@/lib/supabase', () => ({ supabase: { storage: { from: env.from } } }));

type CacheModule = typeof import('@/lib/signed-url-cache');
let cache: CacheModule;

const T0 = new Date('2026-11-12T10:00:00.000Z').getTime();
const TTL_MS = 3600 * 1000;
const STORAGE_KEY = 'signed-url-cache-v2';
const BASE = 'https://proiect.supabase.co/storage/v1/object/sign/photos/';

function base64url(text: string): string {
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** URL semnat ca al Supabase: path-ul obiectului + `?token=<jwt>` cu `exp` în secunde. */
function signedUrl(path: string, expMs: number, nonce = 'n'): string {
  const token = [base64url('{"alg":"HS256"}'), base64url(JSON.stringify({ exp: Math.floor(expMs / 1000), nonce })), 'sig'].join('.');
  return `${BASE}${path}?token=${token}`;
}

let signCounter = 0;
function serverSigns(paths: string[]) {
  signCounter += 1;
  const serverNow = Date.now() + env.clock.skewMs;
  return {
    data: paths.map((path) => ({ path, signedUrl: signedUrl(path, serverNow + TTL_MS, `s${signCounter}`), error: null })),
    error: null,
  };
}

async function restart() {
  vi.resetModules();
  cache = await import('@/lib/signed-url-cache');
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  env.storage.reset();
  env.clock.skewMs = 0;
  env.from.mockClear();
  env.bucket.createSignedUrls.mockReset();
  env.bucket.createSignedUrls.mockImplementation(async (paths) => serverSigns(paths));
  await restart();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('signPaths', () => {
  it('semnează într-un singur apel doar path-urile unice și nevide', async () => {
    const result = await cache.signPaths(['a.jpg', 'a.jpg', '', 'b.jpg']);

    expect(Object.keys(result).sort()).toEqual(['a.jpg', 'b.jpg']);
    expect(env.from).toHaveBeenCalledWith('photos');
    expect(env.bucket.createSignedUrls).toHaveBeenCalledTimes(1);
    expect(env.bucket.createSignedUrls).toHaveBeenCalledWith(['a.jpg', 'b.jpg'], 3600);
  });

  it('lista goală nu face nicio cerere', async () => {
    expect(await cache.signPaths([])).toEqual({});
    expect(await cache.signPaths([''])).toEqual({});
    expect(env.bucket.createSignedUrls).not.toHaveBeenCalled();
  });

  it('ce e valid în cache nu mai pleacă la server; se cere doar ce lipsește', async () => {
    const first = await cache.signPaths(['a.jpg']);
    const second = await cache.signPaths(['a.jpg', 'b.jpg']);

    expect(second['a.jpg']).toBe(first['a.jpg']);
    expect(env.bucket.createSignedUrls).toHaveBeenCalledTimes(2);
    expect(env.bucket.createSignedUrls).toHaveBeenLastCalledWith(['b.jpg'], 3600);
  });

  it('un path deja în zbor nu se cere a doua oară', async () => {
    const pending = deferred<ReturnType<typeof serverSigns>>();
    env.bucket.createSignedUrls.mockImplementationOnce(() => pending.promise);

    const first = cache.signPaths(['a.jpg']);
    await vi.advanceTimersByTimeAsync(0);
    const second = cache.signPaths(['a.jpg']);
    await vi.advanceTimersByTimeAsync(0);
    pending.resolve(serverSigns(['a.jpg']));

    const [r1, r2] = await Promise.all([first, second]);
    expect(r2['a.jpg']).toBe(r1['a.jpg']);
    expect(env.bucket.createSignedUrls).toHaveBeenCalledTimes(1);
  });

  it('o semnare în zbor mai veche de 20 s nu mai e așteptată: se pornește alta', async () => {
    env.bucket.createSignedUrls.mockImplementationOnce(() => new Promise(() => {}));
    void cache.signPaths(['a.jpg']);
    await vi.advanceTimersByTimeAsync(20_000);

    const result = await cache.signPaths(['a.jpg']);
    expect(result['a.jpg']).toContain('a.jpg');
    expect(env.bucket.createSignedUrls).toHaveBeenCalledTimes(2);
  });

  it('o eroare de rețea (respingere) → rezultat gol, nimic în cache, următorul apel reîncearcă', async () => {
    env.bucket.createSignedUrls.mockRejectedValueOnce(new TypeError('Network request failed'));

    expect(await cache.signPaths(['a.jpg'])).toEqual({});
    expect(cache.getCachedUrl('a.jpg')).toBeUndefined();

    const retry = await cache.signPaths(['a.jpg']);
    expect(retry['a.jpg']).toContain('a.jpg');
    expect(env.bucket.createSignedUrls).toHaveBeenCalledTimes(2);
  });

  it('o eroare întoarsă de Storage sau path-urile refuzate (RLS) lipsesc din rezultat și din cache', async () => {
    env.bucket.createSignedUrls.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    expect(await cache.signPaths(['a.jpg'])).toEqual({});

    env.bucket.createSignedUrls.mockResolvedValueOnce({
      data: [
        { path: 'permis.jpg', signedUrl: signedUrl('permis.jpg', T0 + TTL_MS), error: null },
        { path: 'refuzat.jpg', signedUrl: null, error: 'Either the object does not exist or you do not have access to it' },
      ],
      error: null,
    });
    const result = await cache.signPaths(['permis.jpg', 'refuzat.jpg']);
    expect(Object.keys(result)).toEqual(['permis.jpg']);
    expect(cache.getCachedUrl('refuzat.jpg')).toBeUndefined();
  });

  it('o semnare care sosește după clearSignedUrlCache nu mai intră în cache', async () => {
    const pending = deferred<ReturnType<typeof serverSigns>>();
    env.bucket.createSignedUrls.mockImplementationOnce(() => pending.promise);

    const signing = cache.signPaths(['a.jpg']);
    await vi.advanceTimersByTimeAsync(0);
    await cache.clearSignedUrlCache();
    pending.resolve(serverSigns(['a.jpg']));

    // Apelantul inițial primește totuși URL-ul (îl poate afișa), dar cache-ul rămâne gol.
    expect((await signing)['a.jpg']).toBeDefined();
    expect(cache.getCachedUrl('a.jpg')).toBeUndefined();
  });

  it('păstrează cel mult 500 de intrări: cea mai veche iese prima (LRU)', async () => {
    const paths = Array.from({ length: 501 }, (_, i) => `p${i}.jpg`);
    await cache.signPaths(paths);

    expect(cache.getCachedUrl('p0.jpg')).toBeUndefined();
    expect(cache.getCachedUrl('p1.jpg')).toBeDefined();
    expect(cache.getCachedUrl('p500.jpg')).toBeDefined();
  });
});

describe('getCachedUrl: expirarea pe ceasul telefonului', () => {
  it('URL-ul e folosibil doar cât mai are peste MIN_VALIDITY_MS (60 s) din TTL', async () => {
    const { 'a.jpg': url } = await cache.signPaths(['a.jpg']);
    expect(cache.MIN_VALIDITY_MS).toBe(60_000);

    vi.setSystemTime(T0 + TTL_MS - cache.MIN_VALIDITY_MS - 1);
    expect(cache.getCachedUrl('a.jpg')).toBe(url);

    vi.setSystemTime(T0 + TTL_MS - cache.MIN_VALIDITY_MS);
    expect(cache.getCachedUrl('a.jpg')).toBeUndefined();
  });

  it('pragul de liste (LIST_MIN_VALIDITY_MS = 15 min) refuză un URL mai vechi de 45 min', async () => {
    await cache.signPaths(['a.jpg']);
    expect(cache.LIST_MIN_VALIDITY_MS).toBe(15 * 60_000);

    vi.setSystemTime(T0 + 45 * 60_000 + 1);
    expect(cache.getCachedUrl('a.jpg', undefined, cache.LIST_MIN_VALIDITY_MS)).toBeUndefined();
    expect(cache.getCachedUrl('a.jpg')).toBeDefined();
  });

  it('un URL aproape expirat se re-semnează la signPaths', async () => {
    const { 'a.jpg': old } = await cache.signPaths(['a.jpg']);
    vi.setSystemTime(T0 + TTL_MS - 30_000);

    const { 'a.jpg': fresh } = await cache.signPaths(['a.jpg']);
    expect(fresh).not.toBe(old);
    expect(env.bucket.createSignedUrls).toHaveBeenCalledTimes(2);
  });

  it('cu ceasul serverului în urmă, expirarea vine din momentul cererii pe telefon, nu din token', async () => {
    env.clock.skewMs = -10 * 60_000;
    const { 'a.jpg': url } = await cache.signPaths(['a.jpg']);

    expect(cache.localExpiry(url)).toBe(T0 + TTL_MS);
    // `exp` din token (T0 + 50 min) e deja depășit pe ceasul telefonului; cache-ul socotește de la cerere.
    vi.setSystemTime(T0 + 55 * 60_000);
    expect(cache.getCachedUrl('a.jpg')).toBe(url);
  });

  it('cu ceasul serverului înainte, un token „valabil” mai mult nu prelungește viața în cache', async () => {
    env.clock.skewMs = 10 * 60_000;
    const { 'a.jpg': url } = await cache.signPaths(['a.jpg']);

    expect(cache.localExpiry(url)).toBe(T0 + TTL_MS);
    // Tokenul arată `exp` = T0 + 70 min, dar pe telefon URL-ul iese din uz la T0 + 60 min − 60 s.
    vi.setSystemTime(T0 + TTL_MS - cache.MIN_VALIDITY_MS);
    expect(cache.getCachedUrl('a.jpg')).toBeUndefined();
  });
});

describe('cheia de cache', () => {
  it('cheia e path-ul: un URL nou (alt token) pentru același path îl înlocuiește pe cel vechi', async () => {
    await cache.signPaths(['a.jpg']);
    vi.setSystemTime(T0 + 10 * 60_000);
    const newer = signedUrl('a.jpg', T0 + 10 * 60_000 + TTL_MS, 'altul');

    cache.rememberSignedUrl(newer);
    expect(cache.getCachedUrl('a.jpg')).toBe(newer);
  });

  it('thumbnailCacheKey dă chei diferite pentru lățimi și moduri de redimensionare diferite', () => {
    expect(cache.thumbnailCacheKey('a.jpg', { width: 200 })).toBe('a.jpg|w200|cover');
    expect(cache.thumbnailCacheKey('a.jpg', { width: 200, resize: 'contain' })).toBe('a.jpg|w200|contain');
    expect(cache.thumbnailCacheKey('a.jpg', { width: 400 })).not.toBe(cache.thumbnailCacheKey('a.jpg', { width: 200 }));
  });

  it('cu IMAGE_TRANSFORMS_ENABLED = false, transformarea e ignorată: miniatura folosește URL-ul pozei întregi', async () => {
    const { 'a.jpg': url } = await cache.signPaths(['a.jpg']);

    expect(cache.getCachedUrl('a.jpg', { width: 200 })).toBe(url);
    const thumb = await cache.signPaths(['a.jpg'], { transform: { width: 200 } });
    expect(thumb['a.jpg']).toBe(url);
    expect(env.bucket.createSignedUrls).toHaveBeenCalledTimes(1);
  });
});

describe('localExpiry și rememberSignedUrl', () => {
  it('fără nicio semnare proprie: localExpiry = ora din token; URL fără token → null', () => {
    const url = signedUrl('x.jpg', T0 + 30 * 60_000);
    expect(cache.localExpiry(url)).toBe(T0 + 30 * 60_000);
    expect(cache.localExpiry(`${BASE}x.jpg`)).toBeNull();
    expect(cache.localExpiry('https://example.com/poza.jpg')).toBeNull();
  });

  it('după o semnare proprie, localExpiry corectează tokenurile străine cu decalajul învățat', async () => {
    env.clock.skewMs = 5 * 60_000; // serverul e cu 5 min înainte
    await cache.signPaths(['a.jpg']);

    const foreign = signedUrl('b.jpg', T0 + 5 * 60_000 + 20 * 60_000);
    expect(cache.localExpiry(foreign)).toBe(T0 + 20 * 60_000);
  });

  it('rememberSignedUrl e ignorat cât timp decalajul de ceas nu e cunoscut', () => {
    cache.rememberSignedUrl(signedUrl('b.jpg', T0 + 30 * 60_000));
    expect(cache.getCachedUrl('b.jpg')).toBeUndefined();
  });

  it('după o semnare proprie, rememberSignedUrl păstrează URL-urile bucket-ului nostru', async () => {
    await cache.signPaths(['a.jpg']);
    const foreign = signedUrl('b.jpg', T0 + 30 * 60_000);

    cache.rememberSignedUrl(foreign);
    cache.rememberSignedUrl('https://altcineva.example/storage/v1/object/sign/alt/c.jpg?token=x.y.z');

    expect(cache.getCachedUrl('b.jpg')).toBe(foreign);
    expect(cache.localExpiry(foreign)).toBe(T0 + 30 * 60_000);
  });

  it('rememberSignedUrl nu înlocuiește un URL care expiră mai târziu și plafonează la un TTL de acum', async () => {
    const { 'a.jpg': own } = await cache.signPaths(['a.jpg']);

    cache.rememberSignedUrl(signedUrl('a.jpg', T0 + 10 * 60_000, 'mai-vechi'));
    expect(cache.getCachedUrl('a.jpg')).toBe(own);

    const farFuture = signedUrl('c.jpg', T0 + 5 * TTL_MS);
    cache.rememberSignedUrl(farFuture);
    expect(cache.localExpiry(farFuture)).toBe(T0 + TTL_MS);
  });
});

describe('persistența pe disc', () => {
  it('scrie cache-ul cu debounce de 2 s, apoi o repornire îl refolosește fără nicio cerere', async () => {
    const { 'a.jpg': url } = await cache.signPaths(['a.jpg']);
    await vi.advanceTimersByTimeAsync(1999);
    expect(env.storage.store.has(STORAGE_KEY)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(JSON.parse(env.storage.store.get(STORAGE_KEY) ?? 'null')).toEqual([['a.jpg', url, T0 + TTL_MS]]);

    vi.setSystemTime(T0 + 5 * 60_000);
    await restart();
    env.bucket.createSignedUrls.mockClear();

    expect(await cache.signPaths(['a.jpg'])).toEqual({ 'a.jpg': url });
    expect(env.bucket.createSignedUrls).not.toHaveBeenCalled();
  });

  it('la citire aruncă rândurile expirate, cele cu `exp` absurd de departe și cele stricate', async () => {
    const now = T0;
    env.storage.store.set(
      STORAGE_KEY,
      JSON.stringify([
        ['bun.jpg', 'url-bun', now + 30 * 60_000],
        ['expirat.jpg', 'url-expirat', now + 60_000],
        ['viitor.jpg', 'url-viitor', now + TTL_MS + 1],
        ['stricat.jpg', 42, now + 30 * 60_000],
        'nu-e-rand',
      ]),
    );
    await restart();
    expect(await cache.signPaths(['bun.jpg'])).toEqual({ 'bun.jpg': 'url-bun' });
    expect(env.bucket.createSignedUrls).not.toHaveBeenCalled();

    expect(cache.getCachedUrl('bun.jpg')).toBe('url-bun');
    expect(cache.getCachedUrl('expirat.jpg')).toBeUndefined();
    expect(cache.getCachedUrl('viitor.jpg')).toBeUndefined();
    expect(cache.getCachedUrl('stricat.jpg')).toBeUndefined();
  });

  it('un JSON stricat pe disc nu aruncă: cache-ul pornește gol și semnează normal', async () => {
    env.storage.store.set(STORAGE_KEY, '{stricat');
    await restart();
    const result = await cache.signPaths(['a.jpg']);
    expect(result['a.jpg']).toContain('a.jpg');
  });

  it('clearSignedUrlCache golește memoria și discul, iar o scriere programată nu mai pleacă', async () => {
    await cache.signPaths(['a.jpg']);
    await vi.advanceTimersByTimeAsync(2000);
    expect(env.storage.store.has(STORAGE_KEY)).toBe(true);

    await cache.signPaths(['b.jpg']);
    await cache.clearSignedUrlCache();
    await vi.advanceTimersByTimeAsync(5000);

    expect(env.storage.store.has(STORAGE_KEY)).toBe(false);
    expect(cache.getCachedUrl('a.jpg')).toBeUndefined();
    expect(cache.getCachedUrl('b.jpg')).toBeUndefined();
  });

  it('clearSignedUrlCache nu aruncă dacă discul e indisponibil', async () => {
    env.storage.failures.add('removeItem');
    await expect(cache.clearSignedUrlCache()).resolves.toBeUndefined();
  });
});
