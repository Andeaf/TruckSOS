import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

import type { MessageMention } from '@/types/database';

/**
 * Coada locală a mesajelor netrimise (1.1, pasul 7.1, AUDIT E.21 „mesajul pierdut").
 *
 * Înainte, compozitorul se golea ÎNAINTE de insert, iar o eroare (rețea, server) arunca
 * mesajul: nu ajungea nicăieri și nici nu mai era pe ecran. Acum fiecare mesaj intră întâi
 * aici (AsyncStorage, per cont + fir), apare ca bulă „se trimite”, iar la eșec rămâne pe
 * ecran ca „Netrimis · Reîncearcă” — și după repornirea aplicației.
 *
 * Firul = `<userId>:conversation:<id>` sau `<userId>:channel:<id>`: id-ul contului intră în
 * cheie fiindcă pe același telefon pot intra mai multe conturi, iar canalele sunt comune —
 * altfel contul B ar vedea (și ar retrimite în numele lui) mesajul netrimis al lui A.
 *
 * LIMITA RĂMASĂ (fără `client_id` pe server): deduplicarea e doar locală. Dacă insert-ul a
 * ajuns în baza de date dar răspunsul s-a pierdut (rețea căzută exact atunci), mesajul e
 * marcat „Netrimis”, iar reîncercarea îl trimite a doua oară → interlocutorul îl vede de
 * două ori. Reîncercările sunt aceleași cereri ca trimiterea (insert / upload + insert),
 * repetate; nicio cerere nouă către server.
 */

export type OutboxAttachment =
  | { kind: 'image'; localUri: string; width: number; height: number }
  | {
      kind: 'file';
      localUri: string;
      name: string;
      size: number;
      mimeType?: string;
      /** Secunde, doar la videoclipuri. */
      durationS?: number | null;
    };

/** Ce se știa despre cardul atașat în clipa trimiterii — doar pentru bula locală. */
export interface OutboxPreview {
  listing: { id: string; title: string; price: number; currency: string } | null;
  mechanic: {
    id: string;
    full_name: string;
    deleted_at: string | null;
    role?: string;
    rating_avg: number;
    rating_count: number;
  } | null;
  announcement: { id: string; location: string } | null;
}

export interface OutboxEntry {
  localId: string;
  content: string;
  replyToId: string | null;
  mentions: MessageMention[] | null;
  /** 0 sau 1 element: o poză / un fișier = o bulă, ca la trimiterea directă. */
  attachments: OutboxAttachment[];
  /** Contextele (card de Market / persoană recomandată / anunț distribuit) — merg la retrimitere. */
  listingId: string | null;
  mechanicId: string | null;
  announcementId: string | null;
  preview: OutboxPreview | null;
  status: 'sending' | 'failed';
  /** Încercările făcute (o reîncercare manuală o readuce la 1). */
  attempts: number;
  /** ISO, ceasul telefonului — ordonează bulele locale între ele. */
  createdAt: string;
  /** ms; cea mai devreme reîncercare automată pe temporizator (backoff). */
  nextRetryAt: number;
}

/** Rezultatul pe care îl întoarce cine trimite efectiv (ecranul de chat). */
export type OutboxSendResult =
  | { ok: true }
  /** `drop`: mesajul nu mai poate fi trimis niciodată (ex. fișierul local a dispărut). */
  | { ok: false; error: string; drop?: boolean };

export type OutboxSender = (entry: OutboxEntry) => Promise<OutboxSendResult>;

/** Reîncercările pe temporizator (backoff 2 s, 4 s, 8 s, 16 s) se opresc după atâtea încercări. */
export const MAX_TIMER_ATTEMPTS = 5;
/** Revenirea rețelei / a aplicației mai încearcă până aici; apoi doar „Reîncearcă” manual. */
export const MAX_AUTO_ATTEMPTS = 20;

const STORAGE_PREFIX = 'outbox:v1:';

const cache = new Map<string, OutboxEntry[]>();
const loading = new Map<string, Promise<OutboxEntry[]>>();
const writes = new Map<string, Promise<void>>();
const listeners = new Map<string, Set<(entries: OutboxEntry[]) => void>>();
/** `<fir>|<localId>` în curs de trimitere — o intrare nu pleacă de două ori deodată. */
const inFlight = new Set<string>();
/** Firele cu un retryAll în desfășurare (declanșatoarele se pot suprapune). */
const retrying = new Set<string>();

export function newLocalId(): string {
  return Crypto.randomUUID();
}

function backoffMs(attempts: number): number {
  return Math.min(60_000, 2000 * 2 ** Math.max(0, attempts - 1));
}

function isEntry(value: unknown): value is OutboxEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<OutboxEntry>;
  return (
    typeof v.localId === 'string' &&
    typeof v.content === 'string' &&
    typeof v.createdAt === 'string' &&
    Array.isArray(v.attachments)
  );
}

async function load(thread: string): Promise<OutboxEntry[]> {
  const known = cache.get(thread);
  if (known) return known;
  const pending = loading.get(thread);
  if (pending) return pending;
  const promise = (async () => {
    let entries: OutboxEntry[] = [];
    try {
      const raw = await AsyncStorage.getItem(STORAGE_PREFIX + thread);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      entries = Array.isArray(parsed) ? parsed.filter(isEntry) : [];
      // Un `localId` apare o singură dată (prima intrare rămâne): o dublură de pe disc ar pleca de două ori.
      const seen = new Set<string>();
      entries = entries.filter((e) => {
        if (seen.has(e.localId)) return false;
        seen.add(e.localId);
        return true;
      });
    } catch {
      entries = [];
    }
    // Web: URI-urile `blob:` / `data:` ale atașamentelor mor la reîncărcarea paginii — o
    // asemenea intrare n-ar mai putea pleca niciodată (bulă ruptă, 20 de încercări degeaba).
    if (Platform.OS === 'web') {
      entries = entries.filter(
        (e) => !e.attachments.some((a) => /^(blob|data):/.test(a.localUri)),
      );
    }
    // „sending” salvat de o rulare anterioară = aplicația a murit în timpul trimiterii;
    // rezultatul e necunoscut → îl arătăm ca netrimis (vezi LIMITA de sus). `nextRetryAt`
    // nenul = „a mai fost încercat" (ecranul verifică atunci că fișierul local există).
    entries = entries.map((e) =>
      e.status === 'sending' && !inFlight.has(`${thread}|${e.localId}`)
        ? { ...e, status: 'failed' as const, nextRetryAt: e.nextRetryAt || Date.now() }
        : e,
    );
    // O scriere făcută cât timp citeam are prioritate (cache-ul e deja sursa adevărului).
    const current = cache.get(thread);
    if (current) return current;
    cache.set(thread, entries);
    return entries;
  })();
  loading.set(thread, promise);
  try {
    return await promise;
  } finally {
    loading.delete(thread);
  }
}

/** Scrie instantaneul curent al firului; scrierile aceluiași fir rulează în ordine. */
function persist(thread: string): Promise<void> {
  const previous = writes.get(thread) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      const entries = cache.get(thread) ?? [];
      if (entries.length === 0) await AsyncStorage.removeItem(STORAGE_PREFIX + thread);
      else await AsyncStorage.setItem(STORAGE_PREFIX + thread, JSON.stringify(entries));
    });
  writes.set(thread, next);
  return next;
}

function notify(thread: string) {
  const entries = cache.get(thread) ?? [];
  listeners.get(thread)?.forEach((listener) => listener(entries));
}

async function update(
  thread: string,
  change: (entries: OutboxEntry[]) => OutboxEntry[],
): Promise<void> {
  const entries = await load(thread);
  cache.set(thread, change(entries));
  notify(thread);
  try {
    await persist(thread);
  } catch {
    // Starea din memorie rămâne corectă pe durata rulării; la repornire se pierde doar ultima schimbare.
  }
}

/** Intrările firului (copie), cele mai vechi primele. */
export async function list(thread: string): Promise<OutboxEntry[]> {
  return [...(await load(thread))];
}

/**
 * Ascultă schimbările firului (bulele locale din ecranul de chat). Primește și starea
 * curentă, imediat ce firul e citit din AsyncStorage (citită la momentul livrării, deci
 * niciodată mai veche decât o schimbare notificată între timp).
 */
export function subscribe(thread: string, listener: (entries: OutboxEntry[]) => void): () => void {
  let set = listeners.get(thread);
  if (!set) {
    set = new Set();
    listeners.set(thread, set);
  }
  set.add(listener);
  let active = true;
  void load(thread).then(() => {
    if (active) listener(cache.get(thread) ?? []);
  });
  return () => {
    active = false;
    set.delete(listener);
    if (set.size === 0) listeners.delete(thread);
  };
}

/**
 * Pune mesajul în coadă. `true` doar dacă a ajuns și în AsyncStorage — abia atunci
 * compozitorul are voie să se golească (altfel textul ar exista doar în memorie).
 */
export async function enqueue(thread: string, entry: OutboxEntry): Promise<boolean> {
  const entries = await load(thread);
  // Același `localId` = același mesaj (un al doilea apel pentru aceeași trimitere): rămâne intrarea existentă, cu
  // starea ei (poate fi deja în curs de trimitere) — altfel mesajul ar pleca de două ori (12 nov 2026). Se confirmă
  // doar că e pe disc; la eșec NU se scoate nimic din coadă (intrarea e a primului apel). `true` doar dacă intrarea
  // mai e în coadă după scriere: dacă scrierea primului apel a eșuat între timp, el a scos-o deja și textul nu are
  // voie să dispară din compozitor.
  if (entries.some((e) => e.localId === entry.localId)) {
    try {
      await persist(thread);
      return (cache.get(thread) ?? []).some((e) => e.localId === entry.localId);
    } catch {
      return false;
    }
  }
  cache.set(thread, [...entries, entry]);
  notify(thread);
  try {
    await persist(thread);
    return true;
  } catch {
    cache.set(
      thread,
      (cache.get(thread) ?? []).filter((e) => e.localId !== entry.localId),
    );
    notify(thread);
    return false;
  }
}

export async function markFailed(thread: string, localId: string): Promise<void> {
  await update(thread, (entries) =>
    entries.map((e) =>
      e.localId === localId
        ? { ...e, status: 'failed' as const, nextRetryAt: Date.now() + backoffMs(e.attempts) }
        : e,
    ),
  );
}

export async function remove(thread: string, localId: string): Promise<void> {
  await update(thread, (entries) => entries.filter((e) => e.localId !== localId));
}

/**
 * Trimite o intrare prin `sender`: succes → iese din coadă; eșec → „failed” cu backoff.
 * `null` = n-a pornit (intrarea nu mai există sau e deja în curs de trimitere).
 * `manual` (tap pe „Reîncearcă”) readuce numărătoarea încercărilor la 1.
 */
export async function sendEntry(
  thread: string,
  localId: string,
  sender: OutboxSender,
  options: { manual?: boolean } = {},
): Promise<OutboxSendResult | null> {
  const key = `${thread}|${localId}`;
  if (inFlight.has(key)) return null;
  const entries = await load(thread);
  const entry = entries.find((e) => e.localId === localId);
  if (!entry || inFlight.has(key)) return null;
  inFlight.add(key);
  const attempt: OutboxEntry = {
    ...entry,
    status: 'sending',
    attempts: options.manual ? 1 : entry.attempts + 1,
  };
  let result: OutboxSendResult;
  try {
    await update(thread, (all) => all.map((e) => (e.localId === localId ? attempt : e)));
    result = await sender(attempt);
  } catch (e) {
    result = { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    inFlight.delete(key);
  }
  if (result.ok || result.drop) await remove(thread, localId);
  else await markFailed(thread, localId);
  return result;
}

/**
 * Reîncearcă, în ordine, mesajele netrimise ale firului; se oprește la primul eșec (rețeaua
 * e probabil tot căzută — nu are rost să le încercăm pe toate). `respectBackoff` = apel de
 * pe temporizator: doar intrările ajunse la termen și sub MAX_TIMER_ATTEMPTS. Altfel
 * (rețeaua a revenit, aplicația în prim-plan, deschiderea firului): toate, sub MAX_AUTO_ATTEMPTS.
 * `false` = n-a rulat (alt retryAll al firului era în curs) — temporizatorul se reprogramează.
 */
export async function retryAll(
  thread: string,
  sender: OutboxSender,
  options: { respectBackoff?: boolean } = {},
): Promise<boolean> {
  if (retrying.has(thread)) return false;
  retrying.add(thread);
  try {
    // Toleranță de 100 ms: temporizatorul pornește exact la termen, ceasul poate fi cu o clipă în urmă.
    const now = Date.now() + 100;
    const due = (await load(thread)).filter(
      (e) =>
        e.status === 'failed' &&
        !inFlight.has(`${thread}|${e.localId}`) &&
        (options.respectBackoff
          ? e.attempts < MAX_TIMER_ATTEMPTS && e.nextRetryAt <= now
          : e.attempts < MAX_AUTO_ATTEMPTS),
    );
    for (const entry of due) {
      const result = await sendEntry(thread, entry.localId, sender);
      if (result && !result.ok && !result.drop) break;
    }
    return true;
  } finally {
    retrying.delete(thread);
  }
}

/**
 * Șterge coada locală a contului (logout / ștergerea contului): mesajele netrimise conțin
 * text și căi spre fișiere — nu rămân pe telefon pentru următorul cont. O trimitere deja în
 * zbor nu se poate opri; rezultatul ei nu mai repune nimic în coadă.
 */
export async function clearOutbox(userId: string): Promise<void> {
  const prefix = `${userId}:`;
  for (const thread of [...cache.keys()]) {
    if (!thread.startsWith(prefix)) continue;
    // Scrierile încă la coadă citesc cache-ul la execuție → vor șterge, nu rescrie.
    cache.set(thread, []);
    notify(thread);
  }
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) =>
      k.startsWith(STORAGE_PREFIX + prefix),
    );
    await Promise.all(
      keys.map((k) => writes.get(k.slice(STORAGE_PREFIX.length))?.catch(() => {})),
    );
    if (keys.length > 0) await AsyncStorage.multiRemove(keys);
  } catch {
    // best-effort: la următorul login al aceluiași cont intrările ar reapărea doar pe acest telefon
  }
  for (const thread of [...cache.keys()]) {
    if (thread.startsWith(prefix)) cache.delete(thread);
  }
}
