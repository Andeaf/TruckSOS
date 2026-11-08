// 2 nov 2026 — logica PURĂ a lui `push-dispatch` (faza 3, push prin coadă).
// Fără I/O: nici fetch, nici rpc, nici Deno.env. index.ts face doar transportul,
// iar tot ce decide ceva (forma mesajului, loturile, interpretarea răspunsului Expo,
// agregarea pe rând din coadă) stă aici și e acoperit de payload_test.ts.
//
// CONTRACTUL DE COMPATIBILITATE: forma mesajelor e copia exactă a celei din
// `notify_push` (SQL, migrarea 20261101000100). Aplicațiile publicate 1.0.6–1.0.8
// depind de ea (threadId pe iPhone, tag/collapseId pe Android, data.type/id pentru
// ștergerea notificărilor din bară). NU se schimbă nimic aici fără o decizie explicită.

/** Câte mesaje acceptă Expo într-un singur POST la /push/send. */
export const EXPO_SEND_CHUNK = 100;

/** Un rând întors de `claim_push_batch`: un token per rând (un rând din coadă poate
 *  apărea de mai multe ori, câte o dată pentru fiecare dispozitiv al utilizatorului). */
export interface ClaimRow {
  queue_id: number;
  token: string;
  platform: 'ios' | 'android' | null;
  title: string;
  body: string;
  data: Record<string, unknown>;
  tag: string | null;
  ios_title: string | null;
  ios_body: string | null;
  attempts: number;
  /** Momentul claim-ului, exact cum vine de la server (ISO cu microsecunde). Se retrimite
   *  NEMODIFICAT la finish: serverul compară egalitatea, un Date ar tăia microsecundele. */
  claimed_at: string;
}

/** Forma unui token Expo; ce nu se potrivește nu se trimite (Expo ar respinge tot lotul cu 400). */
const EXPO_TOKEN_RE = /^Expo(nent)?PushToken\[.+\]$/;

/** true dacă tokenul arată a token Expo (`ExponentPushToken[…]` sau `ExpoPushToken[…]`). */
export function isValidExpoToken(token: string): boolean {
  return EXPO_TOKEN_RE.test(token);
}

/** iPhone, notificare de fir: o celulă PER MESAJ, stivuite prin threadId.
 *  Fără collapseId și fără channelId (exact ca în SQL). */
export interface IosThreadMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: 'default';
  priority: 'high';
  threadId: string;
}

/** Android, tokenuri fără platformă și iPhone fără tag: forma clasică. */
export interface DefaultMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: 'default';
  channelId: 'default';
  priority: 'high';
  tag?: string;
  collapseId?: string;
}

export type ExpoMessage = IosThreadMessage | DefaultMessage;

/** Construiește mesajul Expo pentru un rând, identic cu `notify_push` din SQL.
 *  `??` = COALESCE (un șir gol rămâne gol în ambele). Cheile opționale nu se pun
 *  deloc când nu au valoare (niciun `undefined` în obiect). */
export function buildExpoMessage(row: ClaimRow): ExpoMessage {
  if (row.platform === 'ios' && row.tag !== null) {
    return {
      to: row.token,
      title: row.ios_title ?? row.title,
      body: row.ios_body ?? row.body,
      data: row.data,
      sound: 'default',
      priority: 'high',
      threadId: row.tag,
    };
  }
  // Android + tokenuri fără platformă cunoscută (aplicații nemigrate) + iPhone fără tag.
  const msg: DefaultMessage = {
    to: row.token,
    title: row.title,
    body: row.body,
    data: row.data,
    sound: 'default',
    channelId: 'default',
    // FCM „high”: livrare imediată și în Doze; fără el Samsung amâna minute.
    priority: 'high',
  };
  // `tag` (Android) înlocuiește celula din bară; `collapseId` coalescează în
  // tranzit și, pe iOS-urile nemigrate, înlocuiește celula.
  if (row.tag !== null) {
    msg.tag = row.tag;
    msg.collapseId = row.tag;
  }
  return msg;
}

/** Împarte o listă în bucăți de cel mult `size` elemente, în ordine. */
export function chunk<T>(items: readonly T[], size: number = EXPO_SEND_CHUNK): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error('chunk_size_invalid');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ── Interpretarea răspunsului Expo ────────────────────────────────────────────

/** Rezultatul unui singur mesaj, în aceeași ordine ca mesajele trimise. */
export type MessageOutcome =
  | { kind: 'ok'; ticketId: string }
  | { kind: 'dead' } // DeviceNotRegistered: tokenul e mort, nu e eroare a rândului
  | { kind: 'invalid' } // token cu formă greșită, oprit înainte de POST (se șterge ca un token mort)
  | { kind: 'error'; error: string } // eroare a mesajului (MessageTooBig, 400 individual etc.)
  | { kind: 'retry'; error: string } // eroare a lotului întreg (429, 5xx, rețea, răspuns ilizibil) sau MessageRateExceeded
  | { kind: 'release'; error: string }; // netrimis (buget epuizat, autentificare Expo picată): înapoi în coadă fără încercare

/** Plafonul textului de eroare trimis spre `last_error` (mesajele Expo pot fi lungi). */
const MAX_ERROR_LEN = 500;

function clip(text: string): string {
  return text.length > MAX_ERROR_LEN ? text.slice(0, MAX_ERROR_LEN) : text;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Codul Expo din `details.error`, dacă există și e text. */
export function detailsErrorCode(entry: Record<string, unknown>): string | null {
  const details = entry.details;
  if (!isRecord(details)) return null;
  return typeof details.error === 'string' ? details.error : null;
}

/** Textul unei erori de bilet/chitanță: „Cod: mesaj” când Expo dă un cod, altfel mesajul. */
export function expoErrorText(entry: Record<string, unknown>): string {
  const code = detailsErrorCode(entry);
  const message = typeof entry.message === 'string' ? entry.message : 'unknown_error';
  return clip(code ? `${code}: ${message}` : message);
}

/** Interpretează un bilet individual din `data[]`. Un bilet cu formă necunoscută e
 *  tratat ca eroare de mesaj (nu știm dacă a plecat; nu-l retrimitem la nesfârșit). */
export function classifyTicket(ticket: unknown): MessageOutcome {
  if (!isRecord(ticket)) return { kind: 'error', error: 'malformed_ticket' };
  if (ticket.status === 'ok' && typeof ticket.id === 'string' && ticket.id !== '') {
    return { kind: 'ok', ticketId: ticket.id };
  }
  if (ticket.status === 'error') {
    const code = detailsErrorCode(ticket);
    if (code === 'DeviceNotRegistered') return { kind: 'dead' };
    // Prea multe mesaje către același dispozitiv: trecător, se reîncearcă cu backoff (nu se pierde).
    if (code === 'MessageRateExceeded') return { kind: 'retry', error: expoErrorText(ticket) };
    return { kind: 'error', error: expoErrorText(ticket) };
  }
  return { kind: 'error', error: 'malformed_ticket' };
}

/** Toate mesajele lotului primesc aceeași eroare de lot → rândurile se reîncearcă. */
export function retryAll(count: number, error: string): MessageOutcome[] {
  const e = clip(error);
  return Array.from({ length: count }, () => ({ kind: 'retry' as const, error: e }));
}

/** Toate mesajele primesc același `release`: n-au plecat (buget epuizat, autentificare
 *  Expo picată) → rândurile revin în coadă imediat, fără să consume o încercare. */
export function releaseAll(count: number, error: string): MessageOutcome[] {
  const e = clip(error);
  return Array.from({ length: count }, () => ({ kind: 'release' as const, error: e }));
}

/** Text pentru o excepție de rețea (fetch aruncat, timeout, JSON ilizibil). */
export function networkErrorText(e: unknown): string {
  return `network: ${e instanceof Error ? e.message : String(e)}`;
}

/**
 * Interpretează răspunsul HTTP al unui POST la /push/send pentru `expected` mesaje.
 *  - 2xx cu `data` = array de exact `expected` bilete → fiecare bilet interpretat.
 *  - 429, 5xx, orice alt cod ne-2xx, `errors` la nivel de cerere, corp ilizibil sau
 *    număr de bilete diferit → TOT lotul e `retry` (serverul plafonează încercările
 *    la 6, apoi `failed`, deci nimic nu se reîncearcă la nesfârșit).
 *  Numărul de bilete trebuie să fie exact: biletele sunt POZIȚIONALE, iar o
 *  împerechere greșită bilet → token ar face ca `push-receipts` să șteargă alt token.
 *  `body` e JSON-ul deja parsat (null dacă corpul nu era JSON).
 *  400 și 401/403 sunt tratate înainte, în `classifySendResponse` (split / oprire).
 */
export function interpretSendResponse(
  httpStatus: number,
  body: unknown,
  expected: number,
): MessageOutcome[] {
  if (httpStatus < 200 || httpStatus >= 300) {
    return retryAll(expected, `http_${httpStatus}${requestErrorSuffix(body)}`);
  }
  if (!isRecord(body)) return retryAll(expected, 'expo_bad_response');
  if (Array.isArray(body.errors) && body.errors.length > 0) {
    return retryAll(expected, `expo_request_error${requestErrorSuffix(body)}`);
  }
  const data = body.data;
  if (!Array.isArray(data)) return retryAll(expected, 'expo_bad_response');
  if (data.length !== expected) {
    return retryAll(expected, `expo_ticket_count_mismatch: ${data.length}/${expected}`);
  }
  return data.map(classifyTicket);
}

/** „: COD” din primul element al `errors[]` (cererea întreagă respinsă), dacă există. */
function requestErrorSuffix(body: unknown): string {
  if (!isRecord(body) || !Array.isArray(body.errors) || body.errors.length === 0) return '';
  const first: unknown = body.errors[0];
  if (!isRecord(first)) return '';
  if (typeof first.code === 'string') return `: ${first.code}`;
  if (typeof first.message === 'string') return `: ${first.message}`;
  return '';
}

/** „: COD: mesaj” din primul element al `errors[]` (pentru 400 individual: motivul exact al lui Expo). */
function requestErrorDetail(body: unknown): string {
  if (!isRecord(body) || !Array.isArray(body.errors) || body.errors.length === 0) return '';
  const first: unknown = body.errors[0];
  if (!isRecord(first)) return '';
  const code = typeof first.code === 'string' ? first.code : null;
  const message = typeof first.message === 'string' ? first.message : null;
  if (code !== null && message !== null) return `: ${code}: ${message}`;
  if (code !== null) return `: ${code}`;
  if (message !== null) return `: ${message}`;
  return '';
}

/** Ce facem cu răspunsul unui POST la /push/send. */
export type SendDecision =
  | { kind: 'outcomes'; outcomes: MessageOutcome[] }
  // 400 pe un lot de mai multe mesaje: un singur mesaj greșit respinge tot lotul → câte un POST per mesaj.
  | { kind: 'split' }
  // 401/403: EXPO_ACCESS_TOKEN greșit → nimic nu mai pleacă în rularea asta.
  | { kind: 'auth'; status: number };

/**
 * Decizia pentru răspunsul unui POST cu `expected` mesaje (`body` = JSON parsat sau null).
 *  - 401/403 → `auth` (rularea se oprește, rândurile netrimise se eliberează).
 *  - 400 cu mai multe mesaje → `split`; 400 cu un singur mesaj → `error` pe mesajul ăla
 *    (cu motivul lui Expo), deci rândul devine `failed` fără să-i tragă după el pe ceilalți.
 *  - restul (2xx, 429, 5xx, alte coduri) → `interpretSendResponse`.
 */
export function classifySendResponse(httpStatus: number, body: unknown, expected: number): SendDecision {
  if (httpStatus === 401 || httpStatus === 403) return { kind: 'auth', status: httpStatus };
  if (httpStatus === 400) {
    if (expected > 1) return { kind: 'split' };
    const error = clip(`http_400${requestErrorDetail(body)}`);
    return { kind: 'outcomes', outcomes: Array.from({ length: expected }, () => ({ kind: 'error' as const, error })) };
  }
  return { kind: 'outcomes', outcomes: interpretSendResponse(httpStatus, body, expected) };
}

// ── Trimiterea rândurilor unui claim (transportul e injectat: fără fetch aici) ──

/** Răspunsul HTTP al unui POST (`body` = JSON parsat sau null dacă nu era JSON). */
export interface HttpReply {
  status: number;
  body: unknown;
}

/** Eroarea scrisă în `last_error` pentru rândurile eliberate pe buget. */
export const BUDGET_RELEASE_ERROR = 'time_budget_exhausted';

/** Rezultatul trimiterii rândurilor unui claim. */
export interface DispatchRun {
  /** `outcomes[i]` ↔ `rows[i]` (indexul din claim, inclusiv rândurile oprite de pre-filtru). */
  outcomes: MessageOutcome[];
  /** POST-uri făcute la Expo (loturi + mesajele retrimise individual). */
  posts: number;
  /** 401/403 primit de la Expo (rularea trebuie oprită), altfel null. */
  authStatus: number | null;
}

/**
 * Trimite rândurile unui claim: pre-filtru pe token (cei invalizi nu pleacă), loturi de
 * cel mult 100, bugetul verificat ÎNAINTE de fiecare POST (inclusiv cele individuale).
 *  - buget epuizat → mesajele netrimise devin `release` (BUDGET_RELEASE_ERROR);
 *  - 401/403 → mesajele lotului și tot ce urmează devin `release` cu `expo_auth_<status>`;
 *  - 400 pe lot → fiecare mesaj al lotului se retrimite singur și se clasifică separat;
 *  - excepție la POST (rețea, timeout) → `retry` pe mesajele acelui POST.
 * `post` primește mesajele și întoarce răspunsul HTTP (sau aruncă); `hasBudget` spune
 * dacă mai avem timp pentru încă un POST.
 */
export async function dispatchRows(
  rows: readonly ClaimRow[],
  post: (messages: ExpoMessage[]) => Promise<HttpReply>,
  hasBudget: () => boolean,
): Promise<DispatchRun> {
  const outcomes: (MessageOutcome | null)[] = rows.map((r): MessageOutcome | null =>
    isValidExpoToken(r.token) ? null : { kind: 'invalid' }
  );
  const sendable: number[] = [];
  outcomes.forEach((o, i) => {
    if (o === null) sendable.push(i);
  });
  let posts = 0;
  let authStatus: number | null = null;

  const assign = (indices: readonly number[], out: readonly MessageOutcome[]): void => {
    indices.forEach((rowIndex, k) => {
      outcomes[rowIndex] = out[k];
    });
  };
  // null = se poate trimite; altfel motivul pentru care mesajele rămase se eliberează.
  const blockedReason = (): string | null => {
    if (authStatus !== null) return `expo_auth_${authStatus}`;
    return hasBudget() ? null : BUDGET_RELEASE_ERROR;
  };
  const send = async (indices: readonly number[]): Promise<SendDecision> => {
    posts += 1;
    try {
      const reply = await post(indices.map((i) => buildExpoMessage(rows[i])));
      return classifySendResponse(reply.status, reply.body, indices.length);
    } catch (e) {
      return { kind: 'outcomes', outcomes: retryAll(indices.length, networkErrorText(e)) };
    }
  };

  for (const part of chunk(sendable, EXPO_SEND_CHUNK)) {
    const reason = blockedReason();
    if (reason !== null) {
      assign(part, releaseAll(part.length, reason));
      continue;
    }
    const decision = await send(part);
    if (decision.kind === 'auth') {
      authStatus = decision.status;
      assign(part, releaseAll(part.length, `expo_auth_${decision.status}`));
      continue;
    }
    if (decision.kind === 'outcomes') {
      assign(part, decision.outcomes);
      continue;
    }
    // split: câte un POST per mesaj, tot cu bugetul verificat înainte de fiecare.
    for (const i of part) {
      const why = blockedReason();
      if (why !== null) {
        assign([i], releaseAll(1, why));
        continue;
      }
      const single = await send([i]);
      if (single.kind === 'auth') {
        authStatus = single.status;
        assign([i], releaseAll(1, `expo_auth_${single.status}`));
      } else if (single.kind === 'outcomes') {
        assign([i], single.outcomes);
      } else {
        // Imposibil (un singur mesaj nu se mai împarte); apărare: eroare de mesaj, nu buclă.
        assign([i], [{ kind: 'error', error: 'http_400' }]);
      }
    }
  }

  // Fiecare index a primit un rezultat mai sus; apărare: un rând uitat se eliberează, nu se pierde.
  return {
    outcomes: outcomes.map((o): MessageOutcome => o ?? { kind: 'release', error: 'not_dispatched' }),
    posts,
    authStatus,
  };
}

// ── Agregarea pe rând din coadă ───────────────────────────────────────────────

export interface PushTicket {
  ticket_id: string;
  token: string;
}

/** Un element din `p_results` pentru `finish_push_batch`. */
export interface QueueResult {
  queue_id: number;
  /** Copiat neschimbat din rândul revendicat (serverul actualizează doar dacă coincide). */
  claimed_at: string;
  outcome: 'sent' | 'retry' | 'failed' | 'release';
  error: string | null;
  tickets: PushTicket[];
  dead_tokens: string[];
}

interface Acc {
  queue_id: number;
  claimed_at: string;
  tickets: PushTicket[];
  dead_tokens: string[];
  retryError: string | null;
  releaseError: string | null;
  messageError: string | null;
  invalid: number;
  total: number;
}

/**
 * Un rezultat per `queue_id` distinct, în ordinea primei apariții. `outcomes[i]`
 * corespunde lui `rows[i]` (indexul global, peste TOATE loturile claim-ului: un
 * `queue_id` poate fi împărțit între două POST-uri). `claimed_at` vine din primul rând
 * al `queue_id`-ului (toate rândurile lui îl au identic), ca string neatins.
 * Precedența: cel puțin un bilet ok → `sent`; altfel vreo eroare de lot → `retry`;
 * altfel vreun mesaj netrimis → `release`; altfel toți tokenii invalizi (pre-filtru) →
 * `failed` cu 'invalid_token'; altfel toți tokenii morți sau invalizi → `failed` cu
 * 'DeviceNotRegistered'; altfel `failed` cu prima eroare de mesaj. `dead_tokens`
 * (inclusiv cei invalizi) se raportează în TOATE cazurile, ca serverul să-i șteargă oricum.
 */
export function aggregateResults(rows: readonly ClaimRow[], outcomes: readonly MessageOutcome[]): QueueResult[] {
  if (rows.length !== outcomes.length) throw new Error('outcomes_length_mismatch');
  const byQueue = new Map<number, Acc>();
  rows.forEach((row, i) => {
    let acc = byQueue.get(row.queue_id);
    if (!acc) {
      acc = {
        queue_id: row.queue_id,
        claimed_at: row.claimed_at,
        tickets: [],
        dead_tokens: [],
        retryError: null,
        releaseError: null,
        messageError: null,
        invalid: 0,
        total: 0,
      };
      byQueue.set(row.queue_id, acc);
    }
    acc.total += 1;
    const o = outcomes[i];
    switch (o.kind) {
      case 'ok':
        acc.tickets.push({ ticket_id: o.ticketId, token: row.token });
        break;
      case 'dead':
        acc.dead_tokens.push(row.token);
        break;
      case 'invalid':
        acc.dead_tokens.push(row.token);
        acc.invalid += 1;
        break;
      case 'error':
        if (acc.messageError === null) acc.messageError = o.error;
        break;
      case 'retry':
        if (acc.retryError === null) acc.retryError = o.error;
        break;
      case 'release':
        if (acc.releaseError === null) acc.releaseError = o.error;
        break;
    }
  });

  return [...byQueue.values()].map((acc): QueueResult => {
    const base = {
      queue_id: acc.queue_id,
      claimed_at: acc.claimed_at,
      tickets: acc.tickets,
      dead_tokens: acc.dead_tokens,
    };
    if (acc.tickets.length > 0) return { ...base, outcome: 'sent', error: null };
    if (acc.retryError !== null) return { ...base, outcome: 'retry', error: acc.retryError };
    if (acc.releaseError !== null) return { ...base, outcome: 'release', error: acc.releaseError };
    if (acc.invalid === acc.total) return { ...base, outcome: 'failed', error: 'invalid_token' };
    if (acc.dead_tokens.length === acc.total) return { ...base, outcome: 'failed', error: 'DeviceNotRegistered' };
    return { ...base, outcome: 'failed', error: acc.messageError ?? 'unknown_error' };
  });
}

/** Contoarele din răspunsul EF-ului pentru un set de rezultate. */
export function summarize(results: readonly QueueResult[]): {
  sent: number;
  retried: number;
  failed: number;
  released: number;
  dead_tokens: number;
} {
  let sent = 0;
  let retried = 0;
  let failed = 0;
  let released = 0;
  let dead = 0;
  for (const r of results) {
    if (r.outcome === 'sent') sent += 1;
    else if (r.outcome === 'retry') retried += 1;
    else if (r.outcome === 'release') released += 1;
    else failed += 1;
    dead += r.dead_tokens.length;
  }
  return { sent, retried, failed, released, dead_tokens: dead };
}
