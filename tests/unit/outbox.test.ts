import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OutboxEntry, OutboxSendResult, OutboxSender } from '@/lib/outbox';

import { deferred, flushPromises } from './mocks/flush';

const env = await vi.hoisted(async () => {
  const { createMemoryStorage } = await import('./mocks/async-storage');
  const { createPlatform } = await import('./mocks/react-native');
  return { storage: createMemoryStorage(), platform: createPlatform() };
});

vi.mock('@react-native-async-storage/async-storage', () => ({ default: env.storage.api }));
vi.mock('react-native', () => ({ Platform: env.platform }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-generat' }));

type OutboxModule = typeof import('@/lib/outbox');
let outbox: OutboxModule;

const T0 = new Date('2026-11-12T10:00:00.000Z').getTime();
const THREAD = 'u1:conversation:c1';
const PREFIX = 'outbox:v1:';

function entry(localId: string, overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    localId,
    content: `mesaj ${localId}`,
    replyToId: null,
    mentions: null,
    attachments: [],
    listingId: null,
    mechanicId: null,
    announcementId: null,
    preview: null,
    status: 'sending',
    attempts: 0,
    createdAt: new Date(T0).toISOString(),
    nextRetryAt: 0,
    ...overrides,
  };
}

function stored(thread: string): OutboxEntry[] | null {
  const raw = env.storage.store.get(PREFIX + thread);
  return raw === undefined ? null : (JSON.parse(raw) as OutboxEntry[]);
}

type Listener = (entries: OutboxEntry[]) => void;

const ok: OutboxSender = async () => ({ ok: true });
const fail: OutboxSender = async () => ({ ok: false, error: 'network' });

/** Simulează repornirea aplicației: modulul își pierde memoria, „discul” rămâne. */
async function restart() {
  vi.resetModules();
  outbox = await import('@/lib/outbox');
}

beforeEach(async () => {
  // Doar `Date` e falsificat: modulul nu folosește temporizatoare, iar `flushPromises` are nevoie de setImmediate real.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  env.storage.reset();
  env.platform.OS = 'ios';
  await restart();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('newLocalId', () => {
  it('folosește UUID-ul din expo-crypto (id-ul local al bulei)', () => {
    expect(outbox.newLocalId()).toBe('uuid-generat');
  });
});

describe('outbox: coada și persistența', () => {
  it('enqueue păstrează ordinea și scrie firul în AsyncStorage', async () => {
    expect(await outbox.enqueue(THREAD, entry('a'))).toBe(true);
    expect(await outbox.enqueue(THREAD, entry('b'))).toBe(true);

    expect((await outbox.list(THREAD)).map((e) => e.localId)).toEqual(['a', 'b']);
    expect(stored(THREAD)?.map((e) => e.localId)).toEqual(['a', 'b']);
  });

  it('list întoarce o copie: modificarea ei nu schimbă coada', async () => {
    await outbox.enqueue(THREAD, entry('a'));
    const copy = await outbox.list(THREAD);
    copy.pop();
    expect(await outbox.list(THREAD)).toHaveLength(1);
  });

  it('după repornire, intrările vin de pe disc, iar „sending” devine „failed” (rezultat necunoscut)', async () => {
    await outbox.enqueue(THREAD, entry('a', { status: 'sending', nextRetryAt: 0 }));
    await outbox.enqueue(THREAD, entry('b', { status: 'sending', nextRetryAt: T0 - 5000 }));
    vi.setSystemTime(T0 + 30_000);

    await restart();
    const entries = await outbox.list(THREAD);

    expect(entries.map((e) => [e.localId, e.status])).toEqual([
      ['a', 'failed'],
      ['b', 'failed'],
    ]);
    // nextRetryAt gol primește „acum” (semnul „a mai fost încercat”); cel existent rămâne.
    expect(entries[0].nextRetryAt).toBe(T0 + 30_000);
    expect(entries[1].nextRetryAt).toBe(T0 - 5000);
  });

  it('ignoră conținutul stricat de pe disc: JSON invalid, ne-listă, intrări incomplete', async () => {
    env.storage.store.set(PREFIX + 'u1:conversation:stricat', '{nu e json');
    env.storage.store.set(PREFIX + 'u1:conversation:obiect', JSON.stringify({ localId: 'x' }));
    env.storage.store.set(
      PREFIX + 'u1:conversation:amestec',
      JSON.stringify([entry('bun'), { localId: 'fara-continut' }, null, 'text']),
    );

    expect(await outbox.list('u1:conversation:stricat')).toEqual([]);
    expect(await outbox.list('u1:conversation:obiect')).toEqual([]);
    expect((await outbox.list('u1:conversation:amestec')).map((e) => e.localId)).toEqual(['bun']);
  });

  it('pe web, la încărcare, aruncă intrările cu atașamente blob:/data: (mor la reîncărcarea paginii)', async () => {
    const image = (localUri: string) => [{ kind: 'image' as const, localUri, width: 1, height: 1 }];
    await outbox.enqueue(THREAD, entry('blob', { attachments: image('blob:https://trucksos.net/1') }));
    await outbox.enqueue(THREAD, entry('data', { attachments: image('data:image/png;base64,AAA') }));
    await outbox.enqueue(THREAD, entry('text'));

    env.platform.OS = 'web';
    await restart();
    expect((await outbox.list(THREAD)).map((e) => e.localId)).toEqual(['text']);

    env.platform.OS = 'ios';
    await restart();
    expect((await outbox.list(THREAD)).map((e) => e.localId)).toEqual(['blob', 'data', 'text']);
  });

  it('enqueue elimină dublurile după localId: al doilea apel păstrează intrarea existentă, cu starea ei', async () => {
    const listener = vi.fn<Listener>();
    outbox.subscribe(THREAD, listener);
    await flushPromises();
    expect(await outbox.enqueue(THREAD, entry('a', { content: 'primul' }))).toBe(true);
    await outbox.markFailed(THREAD, 'a');
    const calls = listener.mock.calls.length;

    // Același id a doua oară (dublu apel pentru aceeași trimitere): `true` (e pe disc), fără o a doua bulă.
    expect(await outbox.enqueue(THREAD, entry('a', { content: 'al doilea' }))).toBe(true);
    const entries = await outbox.list(THREAD);
    expect(entries.map((e) => e.localId)).toEqual(['a']);
    expect(entries[0]).toMatchObject({ content: 'primul', status: 'failed' });
    expect(stored(THREAD)?.map((e) => e.content)).toEqual(['primul']);
    // Nimic nu s-a schimbat, deci ascultătorii nu sunt anunțați din nou.
    expect(listener.mock.calls.length).toBe(calls);
    // Alte id-uri intră normal, în ordine.
    await outbox.enqueue(THREAD, entry('b'));
    expect((await outbox.list(THREAD)).map((e) => e.localId)).toEqual(['a', 'b']);
  });

  it('dublură + disc care nu scrie: întoarce false, dar intrarea originală rămâne în coadă', async () => {
    await outbox.enqueue(THREAD, entry('a'));
    env.storage.failures.add('setItem');
    expect(await outbox.enqueue(THREAD, entry('a'))).toBe(false);
    expect((await outbox.list(THREAD)).map((e) => e.localId)).toEqual(['a']);
  });

  it('dublurile de pe disc (același localId) se elimină la citire: rămâne prima', async () => {
    env.storage.store.set(
      PREFIX + THREAD,
      JSON.stringify([entry('a', { content: 'primul', status: 'failed' }), entry('b'), entry('a', { content: 'dublura' })]),
    );
    await restart();
    const entries = await outbox.list(THREAD);
    expect(entries.map((e) => `${e.localId}:${e.content}`)).toEqual(['a:primul', 'b:mesaj b']);
  });

  it('enqueue întoarce false și scoate intrarea când scrierea pe disc eșuează', async () => {
    const listener = vi.fn<Listener>();
    outbox.subscribe(THREAD, listener);
    await flushPromises();
    env.storage.failures.add('setItem');

    expect(await outbox.enqueue(THREAD, entry('a'))).toBe(false);
    expect(await outbox.list(THREAD)).toEqual([]);
    // Ascultătorul a văzut bula apărând și apoi dispărând.
    expect(listener.mock.calls.map(([entries]) => entries.length)).toEqual([0, 1, 0]);
  });

  it('firele sunt izolate între conversații și între conturi', async () => {
    await outbox.enqueue('u1:conversation:c1', entry('a'));
    await outbox.enqueue('u1:channel:c1', entry('b'));
    await outbox.enqueue('u2:conversation:c1', entry('c'));

    expect((await outbox.list('u1:conversation:c1')).map((e) => e.localId)).toEqual(['a']);
    expect((await outbox.list('u1:channel:c1')).map((e) => e.localId)).toEqual(['b']);
    expect((await outbox.list('u2:conversation:c1')).map((e) => e.localId)).toEqual(['c']);
    expect(await outbox.list('u1:conversation:c2')).toEqual([]);
  });

  it('remove scoate intrarea; firul gol își șterge cheia de pe disc', async () => {
    await outbox.enqueue(THREAD, entry('a'));
    await outbox.enqueue(THREAD, entry('b'));

    await outbox.remove(THREAD, 'a');
    expect(stored(THREAD)?.map((e) => e.localId)).toEqual(['b']);

    await outbox.remove(THREAD, 'b');
    expect(stored(THREAD)).toBeNull();
  });
});

describe('outbox: subscribe', () => {
  it('livrează starea curentă după citirea de pe disc, apoi fiecare schimbare', async () => {
    env.storage.store.set(PREFIX + THREAD, JSON.stringify([entry('vechi', { status: 'failed' })]));
    const listener = vi.fn<Listener>();

    outbox.subscribe(THREAD, listener);
    await flushPromises();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].map((e) => e.localId)).toEqual(['vechi']);

    await outbox.enqueue(THREAD, entry('nou'));
    expect(listener).toHaveBeenLastCalledWith([expect.objectContaining({ localId: 'vechi' }), expect.objectContaining({ localId: 'nou' })]);
  });

  it('dezabonarea oprește notificările; alte fire nu notifică', async () => {
    const listener = vi.fn<Listener>();
    const unsubscribe = outbox.subscribe(THREAD, listener);
    await flushPromises();
    listener.mockClear();

    await outbox.enqueue('u1:conversation:alt', entry('x'));
    expect(listener).not.toHaveBeenCalled();

    unsubscribe();
    await outbox.enqueue(THREAD, entry('a'));
    expect(listener).not.toHaveBeenCalled();
  });

  it('dezabonarea înainte de citirea de pe disc nu mai livrează starea inițială', async () => {
    const listener = vi.fn<Listener>();
    const unsubscribe = outbox.subscribe(THREAD, listener);
    unsubscribe();
    await flushPromises();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('outbox: sendEntry și markFailed', () => {
  it('succes → intrarea iese din coadă; sender-ul primește încercarea marcată „sending”', async () => {
    await outbox.enqueue(THREAD, entry('a', { status: 'failed', attempts: 2 }));
    const sender = vi.fn<OutboxSender>(async () => ({ ok: true }));

    expect(await outbox.sendEntry(THREAD, 'a', sender)).toEqual({ ok: true });
    expect(sender).toHaveBeenCalledWith(expect.objectContaining({ localId: 'a', status: 'sending', attempts: 3 }));
    expect(await outbox.list(THREAD)).toEqual([]);
    expect(stored(THREAD)).toBeNull();
  });

  it('eșec → rămâne „failed”, cu încercarea numărată și backoff 2 s, 4 s, 8 s … plafonat la 60 s', async () => {
    await outbox.enqueue(THREAD, entry('a'));
    const delays: number[] = [];
    for (let i = 0; i < 7; i++) {
      expect(await outbox.sendEntry(THREAD, 'a', fail)).toEqual({ ok: false, error: 'network' });
      const [current] = await outbox.list(THREAD);
      expect(current.status).toBe('failed');
      expect(current.attempts).toBe(i + 1);
      delays.push(current.nextRetryAt - T0);
    }
    expect(delays).toEqual([2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000]);
    expect(stored(THREAD)?.[0].status).toBe('failed');
  });

  it('un sender care aruncă e tratat ca eșec (Error → mesajul, altceva → String)', async () => {
    await outbox.enqueue(THREAD, entry('a'));
    await outbox.enqueue(THREAD, entry('b'));

    const throwsError: OutboxSender = async () => {
      throw new Error('timeout');
    };
    const throwsString: OutboxSender = () => Promise.reject('căzut');

    expect(await outbox.sendEntry(THREAD, 'a', throwsError)).toEqual({ ok: false, error: 'timeout' });
    expect(await outbox.sendEntry(THREAD, 'b', throwsString)).toEqual({ ok: false, error: 'căzut' });
    expect((await outbox.list(THREAD)).map((e) => e.status)).toEqual(['failed', 'failed']);
  });

  it('drop → intrarea e scoasă chiar dacă trimiterea a eșuat', async () => {
    await outbox.enqueue(THREAD, entry('a'));
    const result = await outbox.sendEntry(THREAD, 'a', async () => ({ ok: false, error: 'missing_file', drop: true }));
    expect(result).toEqual({ ok: false, error: 'missing_file', drop: true });
    expect(await outbox.list(THREAD)).toEqual([]);
  });

  it('reîncercarea manuală readuce numărătoarea încercărilor la 1', async () => {
    await outbox.enqueue(THREAD, entry('a', { status: 'failed', attempts: 19 }));
    const sender = vi.fn(fail);
    await outbox.sendEntry(THREAD, 'a', sender, { manual: true });
    expect(sender).toHaveBeenCalledWith(expect.objectContaining({ attempts: 1 }));
    expect((await outbox.list(THREAD))[0].attempts).toBe(1);
  });

  it('o intrare inexistentă → null, fără apel la sender', async () => {
    const sender = vi.fn(ok);
    expect(await outbox.sendEntry(THREAD, 'lipsa', sender)).toBeNull();
    expect(sender).not.toHaveBeenCalled();
  });

  it('aceeași intrare nu pleacă de două ori deodată (a doua cerere → null)', async () => {
    await outbox.enqueue(THREAD, entry('a'));
    const pending = deferred<OutboxSendResult>();
    const sender = vi.fn(() => pending.promise);

    const first = outbox.sendEntry(THREAD, 'a', sender);
    await flushPromises();
    expect(await outbox.sendEntry(THREAD, 'a', sender)).toBeNull();

    pending.resolve({ ok: true });
    expect(await first).toEqual({ ok: true });
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it('o intrare în curs de trimitere rămâne „sending” la recitirea firului', async () => {
    await outbox.enqueue(THREAD, entry('a'));
    const pending = deferred<OutboxSendResult>();
    const first = outbox.sendEntry(THREAD, 'a', () => pending.promise);
    await flushPromises();

    expect((await outbox.list(THREAD))[0].status).toBe('sending');
    pending.resolve({ ok: false, error: 'x' });
    await first;
  });

  it('markFailed calculează backoff-ul din încercările deja făcute', async () => {
    await outbox.enqueue(THREAD, entry('a', { attempts: 3 }));
    await outbox.markFailed(THREAD, 'a');
    const [current] = await outbox.list(THREAD);
    expect(current.status).toBe('failed');
    expect(current.nextRetryAt).toBe(T0 + 8000);
  });
});

describe('outbox: retryAll și plafoanele de încercări', () => {
  it('pe temporizator trimite doar intrările ajunse la termen (cu toleranță de 100 ms)', async () => {
    await outbox.enqueue(THREAD, entry('scadent', { status: 'failed', attempts: 1, nextRetryAt: T0 + 100 }));
    await outbox.enqueue(THREAD, entry('viitor', { status: 'failed', attempts: 1, nextRetryAt: T0 + 101 }));
    const sender = vi.fn(ok);

    expect(await outbox.retryAll(THREAD, sender, { respectBackoff: true })).toBe(true);
    expect(sender.mock.calls.map(([e]) => e.localId)).toEqual(['scadent']);
    expect((await outbox.list(THREAD)).map((e) => e.localId)).toEqual(['viitor']);
  });

  it(`pe temporizator se oprește la MAX_TIMER_ATTEMPTS; altfel continuă până la MAX_AUTO_ATTEMPTS`, async () => {
    expect(outbox.MAX_TIMER_ATTEMPTS).toBe(5);
    expect(outbox.MAX_AUTO_ATTEMPTS).toBe(20);
    const failed = (localId: string, attempts: number) =>
      entry(localId, { status: 'failed', attempts, nextRetryAt: T0 - 1 });
    await outbox.enqueue(THREAD, failed('sub-timer', outbox.MAX_TIMER_ATTEMPTS - 1));
    await outbox.enqueue(THREAD, failed('la-timer', outbox.MAX_TIMER_ATTEMPTS));
    await outbox.enqueue(THREAD, failed('sub-auto', outbox.MAX_AUTO_ATTEMPTS - 1));
    await outbox.enqueue(THREAD, failed('la-auto', outbox.MAX_AUTO_ATTEMPTS));

    const onTimer = vi.fn(ok);
    await outbox.retryAll(THREAD, onTimer, { respectBackoff: true });
    expect(onTimer.mock.calls.map(([e]) => e.localId)).toEqual(['sub-timer']);

    const onNetwork = vi.fn(ok);
    await outbox.retryAll(THREAD, onNetwork);
    expect(onNetwork.mock.calls.map(([e]) => e.localId)).toEqual(['la-timer', 'sub-auto']);

    // Peste plafon: doar „Reîncearcă” manual.
    expect((await outbox.list(THREAD)).map((e) => e.localId)).toEqual(['la-auto']);
  });

  it('ignoră intrările care nu sunt „failed” (bula „se trimite” proaspăt pusă în coadă)', async () => {
    await outbox.enqueue(THREAD, entry('nou', { status: 'sending' }));
    const sender = vi.fn(ok);
    await outbox.retryAll(THREAD, sender);
    expect(sender).not.toHaveBeenCalled();
  });

  it('trimite în ordine și se oprește la primul eșec', async () => {
    for (const id of ['a', 'b', 'c']) await outbox.enqueue(THREAD, entry(id, { status: 'failed', attempts: 1 }));
    const sender = vi.fn<OutboxSender>(async (e) => (e.localId === 'b' ? { ok: false, error: 'x' } : { ok: true }));

    await outbox.retryAll(THREAD, sender);
    expect(sender.mock.calls.map(([e]) => e.localId)).toEqual(['a', 'b']);
    expect((await outbox.list(THREAD)).map((e) => [e.localId, e.attempts])).toEqual([
      ['b', 2],
      ['c', 1],
    ]);
  });

  it('un „drop” nu oprește reîncercarea celorlalte', async () => {
    for (const id of ['a', 'b']) await outbox.enqueue(THREAD, entry(id, { status: 'failed', attempts: 1 }));
    const sender = vi.fn<OutboxSender>(async (e) =>
      e.localId === 'a' ? { ok: false, error: 'missing_file', drop: true } : { ok: true },
    );

    await outbox.retryAll(THREAD, sender);
    expect(sender).toHaveBeenCalledTimes(2);
    expect(await outbox.list(THREAD)).toEqual([]);
  });

  it('un al doilea retryAll pe același fir, cât rulează primul, întoarce false', async () => {
    await outbox.enqueue(THREAD, entry('a', { status: 'failed', attempts: 1 }));
    const pending = deferred<OutboxSendResult>();
    const sender = vi.fn(() => pending.promise);

    const first = outbox.retryAll(THREAD, sender);
    await flushPromises();
    expect(await outbox.retryAll(THREAD, sender)).toBe(false);
    // Alt fir nu e blocat.
    expect(await outbox.retryAll('u1:conversation:alt', sender)).toBe(true);

    pending.resolve({ ok: true });
    expect(await first).toBe(true);
    expect(sender).toHaveBeenCalledTimes(1);
  });
});

describe('outbox: clearOutbox', () => {
  it('golește toate firele contului (memorie + disc) și anunță ascultătorii; alte conturi rămân', async () => {
    await outbox.enqueue('u1:conversation:c1', entry('a'));
    await outbox.enqueue('u1:channel:g', entry('b'));
    await outbox.enqueue('u10:conversation:c1', entry('c'));
    await outbox.enqueue('u2:conversation:c1', entry('d'));
    // Un fir al lui u1 doar pe disc (necitit în rularea asta).
    env.storage.store.set(PREFIX + 'u1:conversation:vechi', JSON.stringify([entry('e')]));
    const listener = vi.fn<Listener>();
    outbox.subscribe('u1:conversation:c1', listener);
    await flushPromises();
    listener.mockClear();

    await outbox.clearOutbox('u1');

    expect(listener).toHaveBeenCalledWith([]);
    expect([...env.storage.store.keys()].sort()).toEqual([
      PREFIX + 'u10:conversation:c1',
      PREFIX + 'u2:conversation:c1',
    ]);
    expect(await outbox.list('u1:conversation:c1')).toEqual([]);
    expect(await outbox.list('u1:conversation:vechi')).toEqual([]);
    expect(await outbox.list('u10:conversation:c1')).toHaveLength(1);
    expect(await outbox.list('u2:conversation:c1')).toHaveLength(1);
  });

  it('o trimitere în zbor care eșuează după logout nu mai repune mesajul în coadă', async () => {
    await outbox.enqueue(THREAD, entry('a'));
    const pending = deferred<OutboxSendResult>();
    const sending = outbox.sendEntry(THREAD, 'a', () => pending.promise);
    await flushPromises();

    await outbox.clearOutbox('u1');
    pending.resolve({ ok: false, error: 'network' });
    await sending;

    expect(await outbox.list(THREAD)).toEqual([]);
    expect(stored(THREAD)).toBeNull();
  });

  it('nu aruncă dacă discul e indisponibil (best-effort): memoria se golește oricum', async () => {
    await outbox.enqueue(THREAD, entry('a'));
    env.storage.failures.add('getAllKeys');

    await expect(outbox.clearOutbox('u1')).resolves.toBeUndefined();
    expect(env.storage.store.has(PREFIX + THREAD)).toBe(true);
    // Comportament documentat în cod: intrarea rămasă pe disc reapare la următoarea citire.
    expect((await outbox.list(THREAD)).map((e) => e.localId)).toEqual(['a']);
  });
});
