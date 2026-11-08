// 2 nov 2026 — teste pentru logica pură din payload.ts (fără rețea; fetch nu e apelat).
// Rulare: deno test .claude/wip/faza3/functions/push-dispatch (după mutare: supabase/functions/push-dispatch).

import { assertEquals } from 'jsr:@std/assert';
import {
  aggregateResults,
  BUDGET_RELEASE_ERROR,
  buildExpoMessage,
  chunk,
  type ClaimRow,
  classifySendResponse,
  classifyTicket,
  dispatchRows,
  type ExpoMessage,
  type HttpReply,
  interpretSendResponse,
  isValidExpoToken,
  type MessageOutcome,
  releaseAll,
  summarize,
} from './payload.ts';

/** Exact forma întoarsă de PostgREST pentru timestamptz (microsecunde, +00:00). */
const CLAIMED = '2026-11-02T17:36:40.472711+00:00';

function row(over: Partial<ClaimRow> = {}): ClaimRow {
  return {
    queue_id: 1,
    token: 'ExponentPushToken[aaa]',
    platform: 'android',
    title: 'Titlu',
    body: 'Corp',
    data: { type: 'chat', id: 'c1' },
    tag: null,
    ios_title: null,
    ios_body: null,
    attempts: 0,
    claimed_at: CLAIMED,
    ...over,
  };
}

// ── (a)–(d) forma mesajelor: copia literală a lui notify_push ────────────────

Deno.test('(a) iOS cu tag: threadId, fără collapseId/channelId; ios_title/ios_body au prioritate', () => {
  const msg = buildExpoMessage(
    row({ platform: 'ios', tag: 'chat-c1', ios_title: 'Ion', ios_body: 'Salut' }),
  );
  assertEquals(msg, {
    to: 'ExponentPushToken[aaa]',
    title: 'Ion',
    body: 'Salut',
    data: { type: 'chat', id: 'c1' },
    sound: 'default',
    priority: 'high',
    threadId: 'chat-c1',
  });
  assertEquals('collapseId' in msg, false);
  assertEquals('channelId' in msg, false);
  assertEquals('tag' in msg, false);
});

Deno.test('(a) iOS cu tag: ios_title/ios_body null cad pe title/body (COALESCE)', () => {
  const msg = buildExpoMessage(row({ platform: 'ios', tag: 'channel-7' }));
  assertEquals(msg, {
    to: 'ExponentPushToken[aaa]',
    title: 'Titlu',
    body: 'Corp',
    data: { type: 'chat', id: 'c1' },
    sound: 'default',
    priority: 'high',
    threadId: 'channel-7',
  });
});

Deno.test('(a) iOS cu tag: doar unul dintre ios_title/ios_body setat', () => {
  const msg = buildExpoMessage(row({ platform: 'ios', tag: 't', ios_title: 'X' }));
  assertEquals([msg.title, msg.body], ['X', 'Corp']);
  const msg2 = buildExpoMessage(row({ platform: 'ios', tag: 't', ios_body: 'Y' }));
  assertEquals([msg2.title, msg2.body], ['Titlu', 'Y']);
});

Deno.test('(b) iOS fără tag: forma Android (channelId default, fără tag), ios_* ignorate', () => {
  const msg = buildExpoMessage(row({ platform: 'ios', ios_title: 'Ignorat', ios_body: 'Ignorat' }));
  assertEquals(msg, {
    to: 'ExponentPushToken[aaa]',
    title: 'Titlu',
    body: 'Corp',
    data: { type: 'chat', id: 'c1' },
    sound: 'default',
    channelId: 'default',
    priority: 'high',
  });
  assertEquals('threadId' in msg, false);
});

Deno.test('(c) Android cu tag: tag + collapseId', () => {
  const msg = buildExpoMessage(row({ platform: 'android', tag: 'chat-c1', ios_title: 'Ignorat' }));
  assertEquals(msg, {
    to: 'ExponentPushToken[aaa]',
    title: 'Titlu',
    body: 'Corp',
    data: { type: 'chat', id: 'c1' },
    sound: 'default',
    channelId: 'default',
    priority: 'high',
    tag: 'chat-c1',
    collapseId: 'chat-c1',
  });
});

Deno.test('(c) Android fără tag: fără tag/collapseId', () => {
  const msg = buildExpoMessage(row({ platform: 'android' }));
  assertEquals(msg, {
    to: 'ExponentPushToken[aaa]',
    title: 'Titlu',
    body: 'Corp',
    data: { type: 'chat', id: 'c1' },
    sound: 'default',
    channelId: 'default',
    priority: 'high',
  });
});

Deno.test('(d) platform null: forma Android (cu și fără tag)', () => {
  assertEquals(buildExpoMessage(row({ platform: null, tag: 'feed' })), {
    to: 'ExponentPushToken[aaa]',
    title: 'Titlu',
    body: 'Corp',
    data: { type: 'chat', id: 'c1' },
    sound: 'default',
    channelId: 'default',
    priority: 'high',
    tag: 'feed',
    collapseId: 'feed',
  });
  assertEquals(buildExpoMessage(row({ platform: null })), {
    to: 'ExponentPushToken[aaa]',
    title: 'Titlu',
    body: 'Corp',
    data: { type: 'chat', id: 'c1' },
    sound: 'default',
    channelId: 'default',
    priority: 'high',
  });
});

Deno.test('JSON trimis: niciun câmp undefined/null în plus', () => {
  const sent = JSON.parse(JSON.stringify([buildExpoMessage(row())]));
  assertEquals(Object.keys(sent[0]).sort(), ['body', 'channelId', 'data', 'priority', 'sound', 'title', 'to']);
});

// ── (e) loturi ───────────────────────────────────────────────────────────────

Deno.test('(e) 250 de mesaje → loturi de 100/100/50, în ordine', () => {
  const items = Array.from({ length: 250 }, (_, i) => i);
  const parts = chunk(items, 100);
  assertEquals(parts.map((p) => p.length), [100, 100, 50]);
  assertEquals(parts[0][0], 0);
  assertEquals(parts[1][0], 100);
  assertEquals(parts[2][49], 249);
  assertEquals(chunk(items).map((p) => p.length), [100, 100, 50]); // implicit = 100
  assertEquals(chunk([], 100), []);
  assertEquals(chunk([1, 2, 3], 100), [[1, 2, 3]]);
});

// ── interpretarea biletelor ──────────────────────────────────────────────────

Deno.test('classifyTicket: ok / DeviceNotRegistered / altă eroare / formă necunoscută', () => {
  assertEquals(classifyTicket({ status: 'ok', id: 't-1' }), { kind: 'ok', ticketId: 't-1' });
  assertEquals(
    classifyTicket({ status: 'error', message: 'nu e înregistrat', details: { error: 'DeviceNotRegistered' } }),
    { kind: 'dead' },
  );
  assertEquals(
    classifyTicket({ status: 'error', message: 'Message too big', details: { error: 'MessageTooBig' } }),
    { kind: 'error', error: 'MessageTooBig: Message too big' },
  );
  assertEquals(classifyTicket({ status: 'error', message: 'fără detalii' }), { kind: 'error', error: 'fără detalii' });
  assertEquals(classifyTicket({ status: 'ok' }), { kind: 'error', error: 'malformed_ticket' });
  assertEquals(classifyTicket(null), { kind: 'error', error: 'malformed_ticket' });
});

Deno.test('interpretSendResponse: 200 cu bilete în ordine', () => {
  const out = interpretSendResponse(
    200,
    { data: [{ status: 'ok', id: 'a' }, { status: 'error', message: 'x', details: { error: 'DeviceNotRegistered' } }] },
    2,
  );
  assertEquals(out, [{ kind: 'ok', ticketId: 'a' }, { kind: 'dead' }]);
});

// interpretSendResponse e doar fallback-ul: în rulare, 400 și 401/403 sunt interceptate
// înainte de classifySendResponse (split / oprire), vezi testele (3b) și (4).
Deno.test('interpretSendResponse: 429, 500, 401, errors la nivel de cerere, corp ilizibil, număr greșit → retry pe tot lotul', () => {
  assertEquals(interpretSendResponse(429, null, 2), [
    { kind: 'retry', error: 'http_429' },
    { kind: 'retry', error: 'http_429' },
  ]);
  assertEquals(interpretSendResponse(500, { errors: [{ code: 'INTERNAL_SERVER_ERROR', message: 'boom' }] }, 1), [
    { kind: 'retry', error: 'http_500: INTERNAL_SERVER_ERROR' },
  ]);
  assertEquals(interpretSendResponse(401, { errors: [{ message: 'bad token' }] }, 1), [
    { kind: 'retry', error: 'http_401: bad token' },
  ]);
  assertEquals(interpretSendResponse(200, { errors: [{ code: 'PUSH_TOO_MANY_EXPERIENCE_IDS' }] }, 1), [
    { kind: 'retry', error: 'expo_request_error: PUSH_TOO_MANY_EXPERIENCE_IDS' },
  ]);
  assertEquals(interpretSendResponse(200, null, 1), [{ kind: 'retry', error: 'expo_bad_response' }]);
  assertEquals(interpretSendResponse(200, { data: 'x' }, 1), [{ kind: 'retry', error: 'expo_bad_response' }]);
  assertEquals(interpretSendResponse(200, { data: [{ status: 'ok', id: 'a' }] }, 2), [
    { kind: 'retry', error: 'expo_ticket_count_mismatch: 1/2' },
    { kind: 'retry', error: 'expo_ticket_count_mismatch: 1/2' },
  ]);
});

// ── (f) agregarea pe rând din coadă ──────────────────────────────────────────

const A = 'ExponentPushToken[A]';
const B = 'ExponentPushToken[B]';

Deno.test('(f) 2 tokeni: unul ok + unul DeviceNotRegistered → sent, 1 bilet, 1 dead_token', () => {
  const rows = [row({ queue_id: 10, token: A }), row({ queue_id: 10, token: B })];
  const outcomes: MessageOutcome[] = [{ kind: 'ok', ticketId: 'tk-1' }, { kind: 'dead' }];
  assertEquals(aggregateResults(rows, outcomes), [
    { queue_id: 10, claimed_at: CLAIMED, outcome: 'sent', error: null, tickets: [{ ticket_id: 'tk-1', token: A }], dead_tokens: [B] },
  ]);
});

Deno.test('(f) ambii tokeni DeviceNotRegistered → failed DeviceNotRegistered + 2 dead', () => {
  const rows = [row({ queue_id: 10, token: A }), row({ queue_id: 10, token: B })];
  assertEquals(aggregateResults(rows, [{ kind: 'dead' }, { kind: 'dead' }]), [
    { queue_id: 10, claimed_at: CLAIMED, outcome: 'failed', error: 'DeviceNotRegistered', tickets: [], dead_tokens: [A, B] },
  ]);
});

Deno.test('(f) eroare de lot 429 → retry pentru toate rândurile lotului', () => {
  const rows = [row({ queue_id: 1, token: A }), row({ queue_id: 2, token: B })];
  const outcomes = interpretSendResponse(429, null, rows.length);
  assertEquals(aggregateResults(rows, outcomes), [
    { queue_id: 1, claimed_at: CLAIMED, outcome: 'retry', error: 'http_429', tickets: [], dead_tokens: [] },
    { queue_id: 2, claimed_at: CLAIMED, outcome: 'retry', error: 'http_429', tickets: [], dead_tokens: [] },
  ]);
});

Deno.test('(f) eroare de mesaj MessageTooBig → failed cu textul', () => {
  const rows = [row({ queue_id: 5, token: A })];
  const outcomes = interpretSendResponse(
    200,
    { data: [{ status: 'error', message: 'Message too big', details: { error: 'MessageTooBig' } }] },
    1,
  );
  assertEquals(aggregateResults(rows, outcomes), [
    { queue_id: 5, claimed_at: CLAIMED, outcome: 'failed', error: 'MessageTooBig: Message too big', tickets: [], dead_tokens: [] },
  ]);
});

Deno.test('(f) precedență: ok bate eroarea de lot; lotul bate tokenul mort; mort + eroare de mesaj → eroarea', () => {
  // queue 1: un token ok (lotul 1), altul în lotul 2 picat cu 503 → tot sent.
  // queue 2: un token mort + unul în lotul picat → retry, dar tokenul mort tot raportat.
  // queue 3: un token mort + unul cu MessageTooBig → failed cu textul erorii, nu DeviceNotRegistered.
  const C = 'ExponentPushToken[C]';
  const D = 'ExponentPushToken[D]';
  const rows = [
    row({ queue_id: 1, token: A }),
    row({ queue_id: 2, token: B }),
    row({ queue_id: 3, token: C }),
    row({ queue_id: 3, token: D }),
    row({ queue_id: 1, token: C }),
    row({ queue_id: 2, token: D }),
  ];
  const outcomes: MessageOutcome[] = [
    { kind: 'ok', ticketId: 't1' },
    { kind: 'dead' },
    { kind: 'dead' },
    { kind: 'error', error: 'MessageTooBig: x' },
    { kind: 'retry', error: 'http_503' },
    { kind: 'retry', error: 'http_503' },
  ];
  const results = aggregateResults(rows, outcomes);
  assertEquals(results, [
    { queue_id: 1, claimed_at: CLAIMED, outcome: 'sent', error: null, tickets: [{ ticket_id: 't1', token: A }], dead_tokens: [] },
    { queue_id: 2, claimed_at: CLAIMED, outcome: 'retry', error: 'http_503', tickets: [], dead_tokens: [B] },
    { queue_id: 3, claimed_at: CLAIMED, outcome: 'failed', error: 'MessageTooBig: x', tickets: [], dead_tokens: [C] },
  ]);
  assertEquals(summarize(results), { sent: 1, retried: 1, failed: 1, released: 0, dead_tokens: 2 });
});

Deno.test('(f) un queue_id împărțit între două loturi (indexul global peste 100)', () => {
  const rows = Array.from({ length: 101 }, (_, i) =>
    row({ queue_id: i < 99 ? i : 99, token: `ExponentPushToken[${i}]` })
  );
  // lotul 1 (0..99) ok; lotul 2 (100) picat cu 429 → queue 99 are un bilet ok → sent.
  const outcomes: MessageOutcome[] = [
    ...Array.from({ length: 100 }, (_, i): MessageOutcome => ({ kind: 'ok', ticketId: `t${i}` })),
    ...interpretSendResponse(429, null, 1),
  ];
  const results = aggregateResults(rows, outcomes);
  assertEquals(results.length, 100);
  assertEquals(results[99], {
    queue_id: 99,
    claimed_at: CLAIMED,
    outcome: 'sent',
    error: null,
    tickets: [{ ticket_id: 't99', token: 'ExponentPushToken[99]' }],
    dead_tokens: [],
  });
});

// ── review 2 nov: rate limit, pre-filtru, 400 împărțit, 401/403, buget, claimed_at ──

type FakeReply = HttpReply | Error | ((messages: ExpoMessage[]) => HttpReply);

/** Transport fals: răspunsurile date, pe rând (o eroare = fetch aruncat); reține tokenii trimiși. */
function fakePost(replies: readonly FakeReply[]) {
  const calls: string[][] = [];
  const post = (messages: ExpoMessage[]): Promise<HttpReply> => {
    calls.push(messages.map((m) => m.to));
    const r = replies[calls.length - 1];
    if (r === undefined) return Promise.reject(new Error('unexpected_post'));
    if (r instanceof Error) return Promise.reject(r);
    return Promise.resolve(typeof r === 'function' ? r(messages) : r);
  };
  return { post, calls };
}

/** 200 cu câte un bilet ok per mesaj (id derivat din token, ca să se vadă împerecherea). */
function okFor(messages: ExpoMessage[]): HttpReply {
  return { status: 200, body: { data: messages.map((m) => ({ status: 'ok', id: `tk-${m.to}` })) } };
}

const always = (): boolean => true;

Deno.test('(1) MessageRateExceeded pe bilet → retry (rândul se reîncearcă, nu se pierde)', () => {
  const ticket = { status: 'error', message: 'Too many messages', details: { error: 'MessageRateExceeded' } };
  assertEquals(classifyTicket(ticket), { kind: 'retry', error: 'MessageRateExceeded: Too many messages' });
  const outcomes = interpretSendResponse(200, { data: [ticket] }, 1);
  assertEquals(aggregateResults([row({ queue_id: 7 })], outcomes), [
    {
      queue_id: 7,
      claimed_at: CLAIMED,
      outcome: 'retry',
      error: 'MessageRateExceeded: Too many messages',
      tickets: [],
      dead_tokens: [],
    },
  ]);
});

Deno.test('(3a) isValidExpoToken: doar ExponentPushToken[…] / ExpoPushToken[…]', () => {
  assertEquals(isValidExpoToken('ExponentPushToken[xyz]'), true);
  assertEquals(isValidExpoToken('ExpoPushToken[xyz]'), true);
  assertEquals(isValidExpoToken('ExponentPushToken[]'), false);
  assertEquals(isValidExpoToken('ExponentPushToken'), false);
  assertEquals(isValidExpoToken('Expo[abc]'), false);
  assertEquals(isValidExpoToken('ExpoentPushToken[abc]'), false);
  assertEquals(isValidExpoToken(' ExponentPushToken[abc]'), false);
  assertEquals(isValidExpoToken('ExponentPushToken[abc] '), false);
  assertEquals(isValidExpoToken('fcm:APA91b'), false);
  assertEquals(isValidExpoToken(''), false);
});

Deno.test('(3a) pre-filtru: tokenul invalid nu pleacă, intră în dead_tokens; rând fără tokeni valizi → failed invalid_token', async () => {
  const rows = [
    row({ queue_id: 1, token: 'garbage' }),
    row({ queue_id: 1, token: A }),
    row({ queue_id: 2, token: 'ExponentPushToken[]' }),
    row({ queue_id: 2, token: 'fcm:APA91b' }),
  ];
  const { post, calls } = fakePost([okFor]);
  const run = await dispatchRows(rows, post, always);
  assertEquals(calls, [[A]]);
  assertEquals(run.posts, 1);
  assertEquals(run.authStatus, null);
  assertEquals(aggregateResults(rows, run.outcomes), [
    {
      queue_id: 1,
      claimed_at: CLAIMED,
      outcome: 'sent',
      error: null,
      tickets: [{ ticket_id: `tk-${A}`, token: A }],
      dead_tokens: ['garbage'],
    },
    {
      queue_id: 2,
      claimed_at: CLAIMED,
      outcome: 'failed',
      error: 'invalid_token',
      tickets: [],
      dead_tokens: ['ExponentPushToken[]', 'fcm:APA91b'],
    },
  ]);

  // Doar tokeni invalizi în tot claim-ul → niciun POST.
  const only = fakePost([]);
  const run2 = await dispatchRows([row({ token: 'x' })], only.post, always);
  assertEquals(only.calls, []);
  assertEquals(run2.posts, 0);
  assertEquals(run2.outcomes, [{ kind: 'invalid' }]);
});

Deno.test('(3b) classifySendResponse: 400 pe lot → split; 400 pe un mesaj → eroare de mesaj; 429/5xx → retry', () => {
  const body400 = { errors: [{ code: 'VALIDATION_ERROR', message: '"to" is invalid' }] };
  assertEquals(classifySendResponse(400, body400, 3), { kind: 'split' });
  assertEquals(classifySendResponse(400, body400, 1), {
    kind: 'outcomes',
    outcomes: [{ kind: 'error', error: 'http_400: VALIDATION_ERROR: "to" is invalid' }],
  });
  assertEquals(classifySendResponse(400, null, 1), { kind: 'outcomes', outcomes: [{ kind: 'error', error: 'http_400' }] });
  assertEquals(classifySendResponse(429, null, 2), {
    kind: 'outcomes',
    outcomes: [
      { kind: 'retry', error: 'http_429' },
      { kind: 'retry', error: 'http_429' },
    ],
  });
  assertEquals(classifySendResponse(503, null, 1), { kind: 'outcomes', outcomes: [{ kind: 'retry', error: 'http_503' }] });
  assertEquals(classifySendResponse(200, { data: [{ status: 'ok', id: 'a' }] }, 1), {
    kind: 'outcomes',
    outcomes: [{ kind: 'ok', ticketId: 'a' }],
  });
});

Deno.test('(3b) 400 pe lot → fiecare mesaj retrimis singur și clasificat separat', async () => {
  const C = 'ExponentPushToken[C]';
  const rows = [row({ queue_id: 1, token: A }), row({ queue_id: 2, token: B }), row({ queue_id: 3, token: C })];
  const bad: HttpReply = { status: 400, body: { errors: [{ code: 'VALIDATION_ERROR', message: 'bad' }] } };
  const { post, calls } = fakePost([bad, okFor, bad, { status: 503, body: null }]);
  const run = await dispatchRows(rows, post, always);
  assertEquals(calls, [[A, B, C], [A], [B], [C]]);
  assertEquals(run.posts, 4);
  assertEquals(aggregateResults(rows, run.outcomes), [
    {
      queue_id: 1,
      claimed_at: CLAIMED,
      outcome: 'sent',
      error: null,
      tickets: [{ ticket_id: `tk-${A}`, token: A }],
      dead_tokens: [],
    },
    {
      queue_id: 2,
      claimed_at: CLAIMED,
      outcome: 'failed',
      error: 'http_400: VALIDATION_ERROR: bad',
      tickets: [],
      dead_tokens: [],
    },
    { queue_id: 3, claimed_at: CLAIMED, outcome: 'retry', error: 'http_503', tickets: [], dead_tokens: [] },
  ]);
});

Deno.test('(3b) split: bugetul se verifică înainte de fiecare POST individual; restul → release', async () => {
  const rows = [row({ queue_id: 1, token: A }), row({ queue_id: 2, token: B })];
  const { post, calls } = fakePost([{ status: 400, body: null }, okFor]);
  let budgetChecks = 0;
  const run = await dispatchRows(rows, post, () => ++budgetChecks <= 2); // lotul + primul mesaj
  assertEquals(calls, [[A, B], [A]]);
  assertEquals(run.outcomes, [
    { kind: 'ok', ticketId: `tk-${A}` },
    { kind: 'release', error: BUDGET_RELEASE_ERROR },
  ]);
});

Deno.test('(4) 401/403 → auth; tot ce n-a plecat → release expo_auth_<status>, fără alte POST-uri', async () => {
  assertEquals(classifySendResponse(401, { errors: [{ message: 'bad token' }] }, 5), { kind: 'auth', status: 401 });
  assertEquals(classifySendResponse(403, null, 1), { kind: 'auth', status: 403 });

  // 150 de rânduri = 2 loturi; primul primește 401 → al doilea nu mai pleacă.
  const rows = Array.from({ length: 150 }, (_, i) => row({ queue_id: i, token: `ExponentPushToken[${i}]` }));
  const { post, calls } = fakePost([{ status: 401, body: null }]);
  const run = await dispatchRows(rows, post, always);
  assertEquals(calls.length, 1);
  assertEquals(run.posts, 1);
  assertEquals(run.authStatus, 401);
  const results = aggregateResults(rows, run.outcomes);
  assertEquals(results.every((r) => r.outcome === 'release' && r.error === 'expo_auth_401'), true);
  assertEquals(results[149], {
    queue_id: 149,
    claimed_at: CLAIMED,
    outcome: 'release',
    error: 'expo_auth_401',
    tickets: [],
    dead_tokens: [],
  });
  assertEquals(summarize(results), { sent: 0, retried: 0, failed: 0, released: 150, dead_tokens: 0 });
});

Deno.test('(4) 403 pe un POST individual (după un 400) oprește și restul split-ului', async () => {
  const C = 'ExponentPushToken[C]';
  const rows = [row({ queue_id: 1, token: A }), row({ queue_id: 2, token: B }), row({ queue_id: 3, token: C })];
  const { post, calls } = fakePost([{ status: 400, body: null }, okFor, { status: 403, body: null }]);
  const run = await dispatchRows(rows, post, always);
  assertEquals(calls, [[A, B, C], [A], [B]]);
  assertEquals(run.authStatus, 403);
  assertEquals(run.outcomes, [
    { kind: 'ok', ticketId: `tk-${A}` },
    { kind: 'release', error: 'expo_auth_403' },
    { kind: 'release', error: 'expo_auth_403' },
  ]);
});

Deno.test('(2) buget epuizat înaintea unui lot → lotul și cele următoare devin release (nu retry)', async () => {
  assertEquals(releaseAll(2, BUDGET_RELEASE_ERROR), [
    { kind: 'release', error: 'time_budget_exhausted' },
    { kind: 'release', error: 'time_budget_exhausted' },
  ]);

  // 250 de rânduri = 3 loturi; bugetul ține doar pentru primul POST.
  const rows = Array.from({ length: 250 }, (_, i) => row({ queue_id: i, token: `ExponentPushToken[${i}]` }));
  const { post, calls } = fakePost([okFor]);
  let budgetChecks = 0;
  const run = await dispatchRows(rows, post, () => ++budgetChecks <= 1);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].length, 100);
  const results = aggregateResults(rows, run.outcomes);
  assertEquals(summarize(results), { sent: 100, retried: 0, failed: 0, released: 150, dead_tokens: 0 });
  assertEquals(results[100], {
    queue_id: 100,
    claimed_at: CLAIMED,
    outcome: 'release',
    error: BUDGET_RELEASE_ERROR,
    tickets: [],
    dead_tokens: [],
  });

  // Fără buget de la început: niciun POST, totul release.
  const none = fakePost([]);
  const run2 = await dispatchRows(rows.slice(0, 3), none.post, () => false);
  assertEquals(none.calls, []);
  assertEquals(run2.outcomes, releaseAll(3, BUDGET_RELEASE_ERROR));
});

Deno.test('precedență cu release: ok > retry > release > dead/invalid', () => {
  const C = 'ExponentPushToken[C]';
  const rows = [
    row({ queue_id: 1, token: A }),
    row({ queue_id: 1, token: B }),
    row({ queue_id: 2, token: A }),
    row({ queue_id: 2, token: B }),
    row({ queue_id: 3, token: C }),
    row({ queue_id: 3, token: 'garbage' }),
  ];
  const outcomes: MessageOutcome[] = [
    { kind: 'ok', ticketId: 't1' },
    { kind: 'release', error: BUDGET_RELEASE_ERROR },
    { kind: 'retry', error: 'http_429' },
    { kind: 'release', error: BUDGET_RELEASE_ERROR },
    { kind: 'dead' },
    { kind: 'release', error: BUDGET_RELEASE_ERROR },
  ];
  assertEquals(
    aggregateResults(rows, outcomes).map((r) => [r.queue_id, r.outcome, r.error, r.dead_tokens]),
    [
      [1, 'sent', null, []],
      [2, 'retry', 'http_429', []],
      [3, 'release', BUDGET_RELEASE_ERROR, [C]],
    ],
  );
  // mort + invalid, niciun ok → DeviceNotRegistered (invalid_token doar când TOȚI sunt invalizi).
  const mixed = aggregateResults(
    [row({ queue_id: 4, token: A }), row({ queue_id: 4, token: 'garbage' })],
    [{ kind: 'dead' }, { kind: 'invalid' }],
  );
  assertEquals([mixed[0].outcome, mixed[0].error, mixed[0].dead_tokens], ['failed', 'DeviceNotRegistered', [A, 'garbage']]);
});

Deno.test('excepție la POST (rețea/timeout) → retry pe mesajele acelui POST', async () => {
  const rows = [row({ queue_id: 1, token: A }), row({ queue_id: 2, token: B })];
  const { post } = fakePost([new Error('timed out')]);
  const run = await dispatchRows(rows, post, always);
  assertEquals(run.outcomes, [
    { kind: 'retry', error: 'network: timed out' },
    { kind: 'retry', error: 'network: timed out' },
  ]);
});

Deno.test('(6) claimed_at ajunge NEATINS în rezultat (string, cu microsecunde, per queue_id)', async () => {
  const c1 = '2026-11-02T17:36:40.472711+00:00';
  const c2 = '2026-11-02T17:36:41.000001+00:00';
  const rows = [
    row({ queue_id: 1, token: A, claimed_at: c1 }),
    row({ queue_id: 2, token: B, claimed_at: c2 }),
    row({ queue_id: 1, token: 'garbage', claimed_at: c1 }),
  ];
  const { post } = fakePost([okFor]);
  const run = await dispatchRows(rows, post, always);
  const results = aggregateResults(rows, run.outcomes);
  assertEquals(
    results.map((r) => [r.queue_id, r.claimed_at]),
    [
      [1, c1],
      [2, c2],
    ],
  );
  // Așa pleacă spre finish_push_batch: exact string-ul primit, fără conversie prin Date.
  const sent = JSON.parse(JSON.stringify(results)) as { claimed_at: string }[];
  assertEquals(sent.map((r) => r.claimed_at), [c1, c2]);
});
