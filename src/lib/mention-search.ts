import { normalizeSearch } from '@/lib/search';
import type { Role } from '@/types/database';

/**
 * Menționări „@Nume" în chat (10 sept 2026, cerere user: „ca pe WhatsApp").
 *
 * Pur, fără React — testabil cu `node`. Două piese:
 *   1. `mentionQueryAt` — găsește, la poziția cursorului, un „@" care POATE fi
 *      o menționare: la începutul textului sau după spațiu (un „@" lipit de un
 *      cuvânt e adresă de email, nu menționare); textul de după „@" până la
 *      cursor e interogarea.
 *   2. `rankMentionCandidates` — ordonează candidații după cât de bine se
 *      potrivesc cu interogarea: prefix de cuvânt > substring > subșir (fuzzy),
 *      fiecare cuvânt din interogare trebuie să se potrivească undeva în nume
 *      („io po" → „Ion Popescu"). Fără diacritice (Brașov = brasov), ß = ss.
 */

export interface MentionUser {
  id: string;
  full_name: string;
  avatar_path: string | null;
  role: Role;
}

/** Cel mult atâtea caractere după „@" mai pot fi o interogare (numele sunt scurte). */
const MAX_QUERY_LENGTH = 40;
/** Un nume are rar peste 3 cuvinte — după al 3-lea spațiu nu mai căutăm. */
const MAX_QUERY_SPACES = 2;

export interface MentionQuery {
  /** Indexul lui „@" în text. */
  start: number;
  /** Textul dintre „@" și cursor (poate fi gol: tocmai s-a tastat „@"). */
  query: string;
}

/**
 * Interogarea de menționare de la cursor, sau null dacă nu suntem într-una.
 * Se oprește la linie nouă, la „@ " (spațiu imediat după „@" = nu e menționare)
 * și când textul de după „@" nu mai seamănă a nume (prea lung / prea multe spații).
 */
export function mentionQueryAt(text: string, cursor: number): MentionQuery | null {
  const end = Math.max(0, Math.min(cursor, text.length));
  const before = text.slice(0, end);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  // „@" în mijlocul unui cuvânt (ion@firma.ro) → email, nu menționare.
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (query.length > MAX_QUERY_LENGTH) return null;
  if (/^\s/.test(query) || query.includes('\n')) return null;
  if ((query.match(/ /g)?.length ?? 0) > MAX_QUERY_SPACES) return null;
  return { start: at, query };
}

function norm(text: string): string {
  return normalizeSearch(text).replace(/ß/g, 'ss').trim().replace(/\s+/g, ' ');
}

/** `needle` apare în `hay` cu literele în ordine (nu neapărat consecutive): „ppc" ⊂ „popescu". */
function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) {
    if (hay[j] === needle[i]) i++;
  }
  return i === needle.length;
}

/**
 * Scorul unui cuvânt din interogare față de cuvintele numelui; 0 = nu se potrivește.
 * Prefixul de cuvânt e regele (așa tastează lumea nume), primul cuvânt primește un
 * bonus mic (prenumele), iar potrivirea „fuzzy" pe subșir intră doar de la 3 litere
 * (sub atât ar potrivi aproape orice).
 */
function scoreWord(q: string, words: string[], compact: string): number {
  let best = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    let s = 0;
    if (w === q) s = 120;
    else if (w.startsWith(q)) s = 100;
    else if (w.includes(q)) s = 60;
    else if (q.length >= 3 && isSubsequence(q, w)) s = 30;
    else continue;
    if (i === 0) s += 8;
    if (s > best) best = s;
  }
  if (best === 0 && q.length >= 3 && isSubsequence(q, compact)) best = 15;
  return best;
}

/**
 * Candidații care se potrivesc cu interogarea, cei mai buni primii. Interogare
 * goală = lista în ordinea primită (apelantul o dă pe recență), plafonată.
 * Costul e liniar în numărul de candidați × cuvinte — instant pentru sutele de
 * conturi din aplicație, fără index și fără server.
 */
export function rankMentionCandidates<T extends { full_name: string }>(
  query: string,
  items: T[],
  limit = 12,
): T[] {
  const q = norm(query);
  if (!q) return items.slice(0, limit);
  const qWords = q.split(' ').filter(Boolean);

  const scored: { item: T; score: number; name: string }[] = [];
  for (const item of items) {
    const name = norm(item.full_name);
    if (!name) continue;
    const words = name.split(' ');
    const compact = words.join('');
    let total = 0;
    let ok = true;
    for (const qw of qWords) {
      const s = scoreWord(qw, words, compact);
      if (s === 0) {
        ok = false;
        break;
      }
      total += s;
    }
    if (!ok) continue;
    // Interogarea întreagă e începutul numelui („ion po" ⊂ „ion popescu") → în față.
    if (name.startsWith(q)) total += 40;
    scored.push({ item, score: total, name });
  }

  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return scored.slice(0, limit).map((s) => s.item);
}
