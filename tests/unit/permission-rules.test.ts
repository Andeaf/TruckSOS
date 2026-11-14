import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearAuthEntry, readAuthEntry, setAuthEntry } from '@/lib/auth-entry';
import { MIN_PASSWORD_LENGTH } from '@/lib/auth-rules';
import { banExpiryDate, isBanned } from '@/lib/ban';
import { readGuestMode, writeGuestMode } from '@/lib/guest';
import { isValidPhone, isValidVat, normalizePhone, normalizeVat } from '@/lib/profile-validation';

/**
 * „Regulile de permisiuni” din client: ce are voie contul (ban), cum intră (parola minimă, de unde a
 * pornit sesiunea → alegerea rolului sau deconectare), modul oaspete și validarea datelor de profil.
 * Serverul le impune oricum; aici verificăm că și clientul decide la fel.
 */
const env = await vi.hoisted(async () => {
  const { createMemoryStorage } = await import('./mocks/async-storage');
  return { storage: createMemoryStorage() };
});

vi.mock('@react-native-async-storage/async-storage', () => ({ default: env.storage.api }));

beforeEach(() => {
  env.storage.reset();
});

describe('auth-rules', () => {
  it('parola minimă e 8 (aceeași valoare ca „Minimum password length” din Supabase)', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
  });
});

describe('isBanned', () => {
  const NOW = new Date('2026-11-12T10:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fără profil sau fără banned_at → nebanat', () => {
    expect(isBanned(null)).toBe(false);
    expect(isBanned(undefined)).toBe(false);
    expect(isBanned({ banned_at: null, banned_until: null })).toBe(false);
    // banned_until fără banned_at nu contează.
    expect(isBanned({ banned_at: null, banned_until: '2027-01-01T00:00:00Z' })).toBe(false);
  });

  it('banned_at fără banned_until → ban permanent', () => {
    expect(isBanned({ banned_at: '2026-11-01T00:00:00Z', banned_until: null })).toBe(true);
  });

  it('ban temporar: activ până la banned_until, expirat din clipa aceea', () => {
    const ban = { banned_at: '2026-11-01T00:00:00Z', banned_until: '2026-11-12T10:00:01.000Z' };
    expect(isBanned(ban)).toBe(true);
    vi.setSystemTime(new Date('2026-11-12T10:00:01.000Z'));
    expect(isBanned(ban)).toBe(false);
  });

  it('o dată banned_until ilizibilă → tratat ca banat (nu ca ban expirat); serverul rămâne autoritatea', () => {
    expect(isBanned({ banned_at: '2026-11-01T00:00:00Z', banned_until: 'nu-e-data' })).toBe(true);
    // Fără banned_at contul nu e banat, oricât de stricat ar fi banned_until.
    expect(isBanned({ banned_at: null, banned_until: 'nu-e-data' })).toBe(false);
  });

  it('banExpiryDate: data de afișat pe ecranul de ban; null la ban permanent sau la o dată ilizibilă', () => {
    expect(banExpiryDate({ banned_until: '2026-11-20T08:00:00.000Z' })?.toISOString()).toBe('2026-11-20T08:00:00.000Z');
    expect(banExpiryDate({ banned_until: null })).toBeNull();
    expect(banExpiryDate({ banned_until: 'nu-e-data' })).toBeNull();
    expect(banExpiryDate(null)).toBeNull();
    expect(banExpiryDate(undefined)).toBeNull();
  });
});

describe('modul oaspete', () => {
  it('pornit, citit, oprit', async () => {
    expect(await readGuestMode()).toBe(false);
    await writeGuestMode(true);
    expect(env.storage.store.get('guest-mode')).toBe('1');
    expect(await readGuestMode()).toBe(true);
    await writeGuestMode(false);
    expect(env.storage.store.has('guest-mode')).toBe(false);
    expect(await readGuestMode()).toBe(false);
  });

  it('doar valoarea exactă „1” înseamnă oaspete', async () => {
    env.storage.store.set('guest-mode', 'true');
    expect(await readGuestMode()).toBe(false);
  });

  it('cu discul indisponibil: citirea → nu e oaspete (login), scrierea nu aruncă', async () => {
    env.storage.failures.add('getItem');
    env.storage.failures.add('setItem');
    expect(await readGuestMode()).toBe(false);
    await expect(writeGuestMode(true)).resolves.toBeUndefined();
  });
});

describe('de unde a pornit sesiunea (auth-entry)', () => {
  it.each(['signup', 'login-password', 'login-social'] as const)('„%s” se salvează și se citește', async (entry) => {
    await setAuthEntry(entry);
    expect(await readAuthEntry()).toBe(entry);
  });

  it('o valoare necunoscută sau lipsă → null (fără profil = alegerea rolului, ca înainte)', async () => {
    expect(await readAuthEntry()).toBeNull();
    env.storage.store.set('auth-entry', 'login-magic');
    expect(await readAuthEntry()).toBeNull();
  });

  it('clearAuthEntry șterge valoarea', async () => {
    await setAuthEntry('login-social');
    await clearAuthEntry();
    expect(await readAuthEntry()).toBeNull();
  });

  it('cu discul indisponibil: nimic nu aruncă, citirea → null', async () => {
    env.storage.failures.add('setItem');
    env.storage.failures.add('getItem');
    env.storage.failures.add('removeItem');
    await expect(setAuthEntry('signup')).resolves.toBeUndefined();
    expect(await readAuthEntry()).toBeNull();
    await expect(clearAuthEntry()).resolves.toBeUndefined();
  });
});

describe('validarea profilului', () => {
  it('normalizePhone scoate spații, puncte, cratime și paranteze', () => {
    expect(normalizePhone('+40 (722) 123-456.7')).toBe('+407221234567');
  });

  it.each([
    ['+40 722 123 456', true],
    ['0722123456', true],
    ['(0049) 171-1234567', true],
    ['1234567', false], // 7 cifre
    ['+1234567890123456', false], // 16 cifre
    ['0722 ABC 456', false],
    ['++40722123456', false],
    ['', false],
  ])('isValidPhone(%j) → %s', (raw, expected) => {
    expect(isValidPhone(raw)).toBe(expected);
  });

  it('normalizeVat: majuscule, fără spații, puncte, cratime', () => {
    expect(normalizeVat(' ro 12.345-678 ')).toBe('RO12345678');
  });

  it.each([
    ['RO12345678', true],
    ['ro 12', true],
    ['RO1', false],
    ['RO12345678901', false],
    ['ROABC', false],
    ['DE123456789', true],
    ['DE12345678', false],
    ['FR12345678901', true],
    ['ATU12345678', true],
    ['X1', false],
    ['12345678', true], // CUI fără prefix de țară
    ['1', false],
    ['12345678901', false],
  ])('isValidVat(%j) → %s', (raw, expected) => {
    expect(isValidVat(raw)).toBe(expected);
  });
});
