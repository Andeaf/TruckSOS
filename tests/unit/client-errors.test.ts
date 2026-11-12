import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { describeClientError, reportClientError, scrubText } from '@/lib/client-errors';

const env = await vi.hoisted(async () => {
  const { createPlatform } = await import('./mocks/react-native');
  type RpcError = { message: string; code?: string };
  return {
    platform: createPlatform(),
    appVersion: vi.fn<() => string | null>(() => '1.1.0'),
    getSession: vi.fn<() => Promise<{ data: { session: { user: { id: string } } | null } }>>(),
    rpc: vi.fn<(fn: string, args: Record<string, unknown>) => Promise<{ error: RpcError | null }>>(),
  };
});

vi.mock('react-native', () => ({ Platform: env.platform }));
vi.mock('@/lib/app-version', () => ({ currentAppVersion: env.appVersion }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: env.getSession }, rpc: env.rpc } }));

// Valorile cu formă de secret se compun la rulare (nu apar ca atare în sursă).
const JWT = ['eyJ' + 'hbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjMifQ', 'c2lnbmF0dXJl'].join('.');
const SB_SECRET = 'sb_' + 'secret_' + 'abcDEF123';
const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('scrubText', () => {
  it('înlocuiește tokenurile: JWT, Bearer, chei sb_, tokenuri Expo', () => {
    expect(scrubText(`auth ${JWT} end`, 500)).toBe('auth [token] end');
    expect(scrubText('Authorization: Bearer abc.DEF-123_x', 500)).toBe('Authorization: [token]');
    expect(scrubText(`key=${SB_SECRET}`, 500)).toBe('key=[token]');
    expect(scrubText('ExponentPushToken[AbC123xyz] și ExpoPushToken[q]', 500)).toBe('[token] și [token]');
  });

  it('înlocuiește e-mailurile, id-urile și telefoanele', () => {
    expect(scrubText('scrie la ion.pop+test@firma.ro', 500)).toBe('scrie la [email]');
    expect(scrubText(`/conversations/${UUID}`, 500)).toBe('/conversations/[id]');
    expect(scrubText('sună la +40 722 123 456 sau 0049.171.1234567', 500)).toBe('sună la [phone] sau [phone]');
  });

  it('UUID-ul nu pierde primul grup ca „telefon” (ordinea regulilor)', () => {
    expect(scrubText('12345678-1234-1234-1234-123456789012', 500)).toBe('[id]');
  });

  it('lasă neatinse numerele scurte și textul obișnuit', () => {
    expect(scrubText('Eroare 404 la pasul 3, cod 1234567', 500)).toBe('Eroare 404 la pasul 3, cod 1234567');
  });

  it('null / undefined → șir gol', () => {
    expect(scrubText(null, 10)).toBe('');
    expect(scrubText(undefined, 10)).toBe('');
  });

  it('taie la `max` caractere pe puncte de cod (un emoji nu se rupe)', () => {
    expect(scrubText('abcdef', 3)).toBe('abc');
    expect(scrubText('😀😀😀', 2)).toBe('😀😀');
    expect(scrubText('abc', 3)).toBe('abc');
  });

  it('`max` negativ, zero sau nenumeric → șir gol; zecimalele se rotunjesc în jos', () => {
    expect(scrubText('abc', 0)).toBe('');
    expect(scrubText('abc', -5)).toBe('');
    expect(scrubText('abc', Number.NaN)).toBe('');
    expect(scrubText('abcdef', 2.9)).toBe('ab');
  });

  it('curăță ÎNAINTE de trunchiere (un e-mail tăiat la jumătate nu scapă)', () => {
    expect(scrubText('x ion@firma.ro', 4)).toBe('x [e');
  });
});

describe('describeClientError', () => {
  it('întoarce tipul, mesajul și ecranul curățate, plus versiunea aplicației', () => {
    const error = new TypeError(`Cannot read property of undefined (user ${UUID})`);
    expect(describeClientError(`/(driver)/conversations/${UUID}`, error)).toEqual({
      type: 'TypeError',
      message: 'Cannot read property of undefined (user [id])',
      screen: '/(driver)/conversations/[id]',
      version: '1.1.0',
    });
  });

  it('tipul gol devine „Error”; ecranul lipsă și versiunea lipsă devin șir gol', () => {
    const error = new Error('x');
    error.name = '';
    env.appVersion.mockReturnValueOnce(null);
    expect(describeClientError(null, error)).toEqual({ type: 'Error', message: 'x', screen: '', version: '' });
  });

  it('mesajul arătat pe ecran se taie la 200 de caractere', () => {
    expect(describeClientError('/', new Error('a'.repeat(300))).message).toHaveLength(200);
  });
});

describe('reportClientError', () => {
  const session = { data: { session: { user: { id: 'u1' } } } };

  beforeEach(() => {
    env.platform.OS = 'ios';
    env.platform.Version = '17.4';
    env.getSession.mockReset();
    env.rpc.mockReset();
    env.getSession.mockResolvedValue(session);
    env.rpc.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fără sesiune nu trimite nimic → no_session', async () => {
    env.getSession.mockResolvedValue({ data: { session: null } });
    expect(await reportClientError({ screen: '/', error: new Error('x') })).toEqual({ ok: false, reason: 'no_session' });
    expect(env.rpc).not.toHaveBeenCalled();
  });

  it('trimite câmpurile curățate și plafonate (inclusiv stiva)', async () => {
    const error = new Error(`boom pentru ion@firma.ro ${'m'.repeat(600)}`);
    error.stack = `Error: boom\n    at Screen (${UUID}.js:1:2)\n    token ${JWT}`;

    expect(await reportClientError({ screen: `/p/${UUID}`, error })).toEqual({ ok: true });
    expect(env.rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = env.rpc.mock.calls[0];
    expect(fn).toBe('report_client_error');
    expect(args).toMatchObject({
      p_app_build: '1.1.0',
      p_platform: 'ios',
      p_os_version: '17.4',
      p_screen: '/p/[id]',
      p_error_type: 'Error',
      p_stack: 'Error: boom\n    at Screen ([id].js:1:2)\n    token [token]',
    });
    expect(String(args.p_message)).toMatch(/^boom pentru \[email\] m+$/);
    expect(String(args.p_message)).toHaveLength(500);
  });

  it('pe web versiunea sistemului pleacă goală', async () => {
    env.platform.OS = 'web';
    env.platform.Version = undefined;
    await reportClientError({ screen: '/', error: new Error('x') });
    expect(env.rpc.mock.calls[0][1]).toMatchObject({ p_platform: 'web', p_os_version: '' });
  });

  it.each([
    [{ message: 'rate_limited' }, { ok: false, reason: 'rate_limited' }],
    [{ message: 'not_authenticated' }, { ok: false, reason: 'no_session' }],
    [{ message: 'Could not find the function public.report_client_error', code: 'PGRST202' }, { ok: false, reason: 'failed' }],
  ])('eroarea RPC %o → %o', async (rpcError, expected) => {
    env.rpc.mockResolvedValue({ error: rpcError });
    expect(await reportClientError({ screen: '/', error: new Error('x') })).toEqual(expected);
  });

  it('nu aruncă niciodată: o excepție (rețea) → failed', async () => {
    env.getSession.mockRejectedValue(new TypeError('Network request failed'));
    expect(await reportClientError({ screen: '/', error: new Error('x') })).toEqual({ ok: false, reason: 'failed' });
  });

  it('după 15 s fără răspuns → failed (butonul nu se rotește la nesfârșit)', async () => {
    vi.useFakeTimers();
    env.rpc.mockReturnValue(new Promise(() => {}));

    const report = reportClientError({ screen: '/', error: new Error('x') });
    let settled = false;
    void report.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await report).toEqual({ ok: false, reason: 'failed' });
  });
});
