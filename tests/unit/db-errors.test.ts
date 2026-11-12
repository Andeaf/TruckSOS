import { describe, expect, it, vi } from 'vitest';

import { translateDbError } from '@/lib/db-errors';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
// `t` întoarce cheia: testele verifică CE cheie i18n alege traducerea.
vi.mock('@/i18n', async () => (await import('./mocks/i18n')).i18nModule);

describe('translateDbError', () => {
  it('null / undefined → null (fără eroare)', () => {
    expect(translateDbError(null)).toBeNull();
    expect(translateDbError(undefined)).toBeNull();
  });

  it('codurile tratate de ecrane trec neatinse (blocked_by_you), ca string sau ca obiect', () => {
    expect(translateDbError('blocked_by_you')).toBe('blocked_by_you');
    expect(translateDbError({ message: 'blocked_by_you', code: 'P0001' })).toBe('blocked_by_you');
  });

  describe('rețea', () => {
    it.each([
      ['Network request failed'],
      ['TypeError: Failed to fetch'],
      ['Load failed'],
      ['getaddrinfo ENOTFOUND proiect.supabase.co'],
    ])('„%s” → authErrors.network', (message) => {
      expect(translateDbError(new TypeError(message))).toBe('authErrors.network');
      expect(translateDbError(message)).toBe('authErrors.network');
    });

    it('AuthRetryableFetchError fără status HTTP → authErrors.network', () => {
      expect(translateDbError({ name: 'AuthRetryableFetchError', status: 0, message: '{}' })).toBe('authErrors.network');
    });
  });

  describe('codurile ridicate de server (RAISE EXCEPTION)', () => {
    it.each([
      ['rate_limited', 'dbErrors.rate_limited'],
      ['account_banned', 'dbErrors.account_banned'],
      ['photo_limit_reached', 'dbErrors.photo_limit_reached'],
      ['not_admin', 'dbErrors.not_allowed'],
      ['not_mechanic', 'dbErrors.not_allowed'],
      ['own_announcement', 'dbErrors.not_allowed'],
      ['target_not_mechanic', 'dbErrors.not_found'],
      ['profile_not_found', 'dbErrors.not_found'],
      ['not_authenticated', 'common.noSession'],
      ['Announcement not available', 'dbErrors.announcement_not_open'],
      ['cannot_contact_self', 'dbErrors.cannot_contact_self'],
    ])('%s → %s', (message, key) => {
      expect(translateDbError({ code: 'P0001', message })).toBe(key);
    });

    it('rate_limited cu DETAIL „announcements_open” → plafonul de anunțuri deschise', () => {
      expect(translateDbError({ code: 'P0001', message: 'rate_limited', details: 'announcements_open' })).toBe(
        'dbErrors.rate_limited_open',
      );
      expect(translateDbError({ code: 'P0001', message: 'rate_limited', details: 'messages' })).toBe('dbErrors.rate_limited');
    });

    it('funcționează și pentru un Error simplu și pentru string', () => {
      expect(translateDbError(new Error('account_banned'))).toBe('dbErrors.account_banned');
      expect(translateDbError('listing_not_active')).toBe('dbErrors.listing_not_active');
    });
  });

  describe('SQLSTATE', () => {
    it.each([
      ['23505', 'duplicate key value violates unique constraint "x"', 'dbErrors.duplicate'],
      ['23503', 'insert or update on table violates foreign key constraint', 'dbErrors.gone'],
      ['22001', 'value too long for type character varying(500)', 'dbErrors.too_long'],
      ['22P02', 'invalid input syntax for type uuid', 'dbErrors.invalid'],
      ['42501', 'new row violates row-level security policy for table "messages"', 'dbErrors.not_allowed'],
      ['PGRST116', 'JSON object requested, multiple (or no) rows returned', 'dbErrors.not_found'],
      ['53300', 'sorry, too many clients already', 'dbErrors.busy'],
    ])('%s → %s', (code, message, key) => {
      expect(translateDbError({ code, message })).toBe(key);
    });

    it('23514: CHECK-urile de lungime (<tabel>_<coloană>_len) → too_long, restul → invalid', () => {
      expect(
        translateDbError({ code: '23514', message: 'new row for relation "messages" violates check constraint "messages_content_len"' }),
      ).toBe('dbErrors.too_long');
      expect(
        translateDbError({ code: '23514', message: 'new row for relation "ratings" violates check constraint "ratings_score_check"' }),
      ).toBe('dbErrors.invalid');
    });

    it('57014 cu un mesaj fără „timeout” → dbErrors.timeout', () => {
      expect(translateDbError({ code: '57014', message: 'canceling statement due to user request' })).toBe('dbErrors.timeout');
    });

    it('comportament actual, posibil bug: 57014 cu mesajul real al Postgres („statement timeout”) e luat drept eroare de rețea', () => {
      // isNetworkError rulează înaintea SQLSTATE-urilor, iar tiparul lui (/timed? ?out/) prinde „timeout”.
      expect(translateDbError({ code: '57014', message: 'canceling statement due to statement timeout' })).toBe(
        'authErrors.network',
      );
    });
  });

  describe('Storage (fără `code`)', () => {
    it('tipul MIME respins → storage_type', () => {
      expect(translateDbError({ statusCode: '415', message: 'mime type image/heic is not supported' })).toBe('dbErrors.storage_type');
    });

    it('fișier prea mare: statusCode 413 (număr sau string) sau mesajul → storage_size', () => {
      expect(translateDbError({ statusCode: 413, message: 'x' })).toBe('dbErrors.storage_size');
      expect(translateDbError({ statusCode: '413', message: 'x' })).toBe('dbErrors.storage_size');
      expect(translateDbError({ message: 'The object exceeded the maximum allowed size' })).toBe('dbErrors.storage_size');
    });

    it('403 sau mesaj de politică fără cod → storage_refused (nu not_allowed)', () => {
      expect(translateDbError({ status: 403, message: 'x' })).toBe('dbErrors.storage_refused');
      expect(translateDbError({ message: 'new row violates row-level security policy' })).toBe('dbErrors.storage_refused');
      expect(translateDbError('new row violates row-level security policy')).toBe('dbErrors.storage_refused');
    });
  });

  it('„permission denied” cu un cod necunoscut → not_allowed', () => {
    expect(translateDbError({ code: 'XX999', message: 'permission denied for table profiles' })).toBe('dbErrors.not_allowed');
  });

  describe('necunoscut → mesajul generic', () => {
    it('cu codul scurt în paranteză', () => {
      expect(translateDbError({ code: 'XX000', message: 'internal error at table secret_table' })).toBe('dbErrors.generic (XX000)');
    });

    it('un cod ridicat de server, dar necunoscut clientului, ajunge în paranteză', () => {
      expect(translateDbError({ code: 'P0001', message: 'something_new' })).toBe('dbErrors.generic (P0001)');
      expect(translateDbError('something_new')).toBe('dbErrors.generic (something_new)');
    });

    it('textul liber nu ajunge pe ecran (nici numele tabelelor)', () => {
      expect(translateDbError('relation "app.secret" does not exist')).toBe('dbErrors.generic');
      expect(translateDbError({})).toBe('dbErrors.generic');
    });
  });
});
