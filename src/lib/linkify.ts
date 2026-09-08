/**
 * Tokenizer pentru textul mesajelor din chat (7 sept 2026): găsește LINKURILE și
 * NUMERELE DE TELEFON ca să poată fi evidențiate și apăsate (vezi LinkifiedText).
 *
 * Pur, fără React — testabil cu `node`. Ordinea contează: întâi linkurile (un URL
 * poate conține cifre care ar arăta ca un telefon), apoi telefoanele DOAR în
 * bucățile rămase de text simplu.
 *
 * Telefoane — reguli anti-fals-pozitiv (chat-ul e plin de prețuri, date, coduri):
 *   - candidat = 7–16 cifre, cu separatoare spațiu / punct / liniuță / bară / paranteze;
 *   - `+…`  → 8–15 cifre (E.164);  `00…` → 10–17;  `0…` (național) → 9–13;
 *     fără prefix → 10–15 cifre (ex. „40722123456");
 *   - respins: „07.09.2026" (8 cifre), „1.500.000" (7, fără prefix), „2026-09-07";
 *   - un singur fel de separator dintre punct / liniuță / bară, iar punctul nu se
 *     amestecă cu spații — altfel „07.09.2026 10" ar trece drept telefon;
 *   - la margini nu stă literă/cifră (coduri gen „RO49AAAA…0075" nu se rup în bucăți).
 */

export type LinkToken =
  | { type: 'text'; value: string }
  | { type: 'url'; value: string; href: string }
  | { type: 'phone'; value: string; number: string };

// TLD-uri pentru domeniile scrise FĂRĂ „http(s)://" sau „www." („trucksos.net/p/…").
// Lista e intenționat scurtă (țările din jur + generice uzuale): orice „a.b" cu un
// sufix necunoscut rămâne text — mai bine un link nedetectat decât „fisier.txt" albastru.
const TLDS =
  'ro|com|net|org|eu|de|info|io|app|dev|co|uk|it|fr|es|hu|pl|bg|md|at|ch|nl|be|pt|cz|sk|gr|tr|ua|rs|hr|si|lt|lv|ee|dk|se|no|fi|ie|lu|biz|shop|online|site';

// Caractere care NU pot face parte dintr-un URL scris în chat (ghilimelele tipografice
// incluse — Android le pune automat la dictare).
const URL_STOP = '\\s<>"\'\u2018\u2019\u201c\u201d';

const URL_RE = new RegExp(
  `https?:\\/\\/[^${URL_STOP}]+` +
    `|www\\.[^${URL_STOP}]+` +
    `|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${TLDS})(?:\\/[^${URL_STOP}]*)?`,
  'gi',
);

// Paranteza de deschidere e opțională ca „(0722) 123 456" să se evidențieze întreg.
const PHONE_RE = /\(?(?:\+|00)?\d(?:[\s.\-/()]{0,2}\d){6,15}/g;

const ALNUM = /[\p{L}\p{N}]/u;

function isAlnum(ch: string | undefined): boolean {
  return !!ch && ALNUM.test(ch);
}

/** Taie punctuația de final care aparține propoziției, nu linkului („vezi trucksos.net."). */
function trimUrl(raw: string): string {
  let url = raw;
  for (;;) {
    const last = url[url.length - 1];
    if (!last) break;
    if ('.,;:!?'.includes(last)) {
      url = url.slice(0, -1);
      continue;
    }
    if (last === ')' && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) {
      url = url.slice(0, -1);
      continue;
    }
    break;
  }
  return url;
}

/** URL-ul complet pentru Linking (domeniile goale și „www." primesc https://). */
export function normalizeHref(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

/**
 * Numărul curat pentru `tel:` dacă textul brut arată a telefon, altfel null.
 * „00" internațional devine „+" (dialerul îl înțelege oriunde); restul păstrează
 * cifrele așa cum au fost scrise.
 */
export function phoneNumberOf(input: string): string | null {
  const raw = input.replace(/^\(/, '');
  const digits = raw.replace(/\D/g, '');
  const n = digits.length;
  const seps = raw.replace(/[\d+]/g, '');
  const kinds = [seps.includes('.'), seps.includes('-'), seps.includes('/')].filter(Boolean).length;
  if (kinds > 1) return null;
  if (seps.includes('.') && /\s/.test(seps)) return null;

  if (raw.startsWith('+')) return n >= 8 && n <= 15 ? `+${digits}` : null;
  if (raw.startsWith('00')) return n >= 10 && n <= 17 ? `+${digits.slice(2)}` : null;
  if (raw.startsWith('0')) return n >= 9 && n <= 13 ? digits : null;
  return n >= 10 && n <= 15 ? digits : null;
}

function phoneTokens(text: string, out: LinkToken[]): void {
  let cursor = 0;
  PHONE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PHONE_RE.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    const before = text[start - 1];
    const after = text[end];
    // Lipit de literă/cifră/„+" → e o bucată dintr-un cod, nu un telefon; „#"/„№"
    // înainte = număr de comandă/factură. (Candidatul respins rămâne consumat —
    // bucățile unui IBAN nu se re-evaluează ca telefoane mai scurte.)
    if (isAlnum(before) || before === '+' || before === '#' || before === '№' || isAlnum(after)) {
      continue;
    }
    const number = phoneNumberOf(m[0]);
    if (!number) continue;
    if (start > cursor) out.push({ type: 'text', value: text.slice(cursor, start) });
    out.push({ type: 'phone', value: m[0], number });
    cursor = end;
  }
  if (cursor < text.length) out.push({ type: 'text', value: text.slice(cursor) });
}

/** Sparge textul în bucăți: text simplu, linkuri și telefoane, în ordinea din mesaj. */
export function tokenize(text: string): LinkToken[] {
  const out: LinkToken[] = [];
  if (!text) return out;
  let cursor = 0;
  URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text)) !== null) {
    const start = m.index;
    const raw = trimUrl(m[0]);
    if (!raw) continue;
    const end = start + raw.length;
    const before = text[start - 1];
    // Domeniu „gol" lipit de altceva (ex. partea de după „@" dintr-un email) → text.
    const bare = !/^(https?:\/\/|www\.)/i.test(raw);
    if (bare && (isAlnum(before) || before === '@' || before === '.' || isAlnum(text[end]))) {
      continue;
    }
    if (start > cursor) phoneTokens(text.slice(cursor, start), out);
    out.push({ type: 'url', value: raw, href: normalizeHref(raw) });
    cursor = end;
    URL_RE.lastIndex = end;
  }
  if (cursor < text.length) phoneTokens(text.slice(cursor), out);
  return out;
}
