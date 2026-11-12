import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { flushPromises } from './mocks/flush';

const env = await vi.hoisted(async () => {
  const { createMemoryStorage } = await import('./mocks/async-storage');
  return { storage: createMemoryStorage() };
});

vi.mock('@react-native-async-storage/async-storage', () => ({ default: env.storage.api }));

type PendingLinkModule = typeof import('@/lib/pending-link');
let link: PendingLinkModule;

const T0 = new Date('2026-11-12T10:00:00.000Z').getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  env.storage.reset();
  vi.resetModules();
  link = await import('@/lib/pending-link');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('resolvePendingLink', () => {
  it('linkurile care nu sunt de oaspete trec neschimbate (cu tot cu query)', () => {
    expect(link.resolvePendingLink('/p/abc-123', 'driver')).toBe('/p/abc-123');
    expect(link.resolvePendingLink('/(mechanic)/feed/x?y=1', 'driver')).toBe('/(mechanic)/feed/x?y=1');
  });

  it('Market: lista și anunțul pe partea rolului; formularul „new” sau un id ciudat → ecranul de start', () => {
    expect(link.resolvePendingLink('/(guest)/market', 'driver')).toBe('/(driver)/market');
    expect(link.resolvePendingLink('/(guest)/market/L-1', 'mechanic')).toBe('/(mechanic)/market/L-1');
    expect(link.resolvePendingLink('/(guest)/market/L-1?from=sheet#top', 'driver')).toBe('/(driver)/market/L-1');
    expect(link.resolvePendingLink('/(guest)/market/new', 'driver')).toBeNull();
    expect(link.resolvePendingLink('/(guest)/market/id_cu_underscore', 'driver')).toBeNull();
    expect(link.resolvePendingLink('/(guest)/market/L-1/edit', 'driver')).toBeNull();
  });

  it('mecanici: lista doar pentru șofer, profilul prin /p/<id> pentru oricine', () => {
    expect(link.resolvePendingLink('/(guest)/mechanics', 'driver')).toBe('/(driver)/search');
    expect(link.resolvePendingLink('/(guest)/mechanics', 'mechanic')).toBeNull();
    expect(link.resolvePendingLink('/(guest)/mechanics/m-9', 'mechanic')).toBe('/p/m-9');
    expect(link.resolvePendingLink('/(guest)/mechanics/m 9', 'driver')).toBeNull();
  });

  it('anunțurile deschise se văd doar în feed-ul mecanicului', () => {
    expect(link.resolvePendingLink('/(guest)/announcements/a1', 'mechanic')).toBe('/(mechanic)/feed/a1');
    expect(link.resolvePendingLink('/(guest)/announcements/a1', 'driver')).toBeNull();
    expect(link.resolvePendingLink('/(guest)/announcements/new', 'mechanic')).toBeNull();
    expect(link.resolvePendingLink('/(guest)/announcements', 'mechanic')).toBeNull();
  });

  it('harta doar pentru mecanic; comunitatea pe conversațiile rolului; restul → null', () => {
    expect(link.resolvePendingLink('/(guest)/map', 'mechanic')).toBe('/(mechanic)/map');
    expect(link.resolvePendingLink('/(guest)/map', 'driver')).toBeNull();
    expect(link.resolvePendingLink('/(guest)/community', 'driver')).toBe('/(driver)/conversations');
    expect(link.resolvePendingLink('/(guest)/settings', 'driver')).toBeNull();
    expect(link.resolvePendingLink('/(guest)', 'driver')).toBeNull();
  });
});

describe('linkul amânat: set / take / load', () => {
  it('take îl întoarce o singură dată și îl șterge și de pe disc', async () => {
    link.setPendingLink('/p/abc');
    await flushPromises();
    expect(JSON.parse(env.storage.store.get('pending-link') ?? 'null')).toEqual({ path: '/p/abc', at: T0 });

    expect(link.takePendingLink()).toBe('/p/abc');
    expect(link.takePendingLink()).toBeNull();
    await flushPromises();
    expect(env.storage.store.has('pending-link')).toBe(false);
  });

  it('load aduce linkul salvat după repornire, dacă are sub o zi', async () => {
    env.storage.store.set('pending-link', JSON.stringify({ path: '/(guest)/market/L-1', at: T0 - DAY_MS + 1 }));
    await link.loadPendingLink();
    expect(link.takePendingLink()).toBe('/(guest)/market/L-1');
  });

  it('un link mai vechi de o zi se ignoră și se șterge de pe disc', async () => {
    env.storage.store.set('pending-link', JSON.stringify({ path: '/p/vechi', at: T0 - DAY_MS }));
    await link.loadPendingLink();
    expect(link.takePendingLink()).toBeNull();
    expect(env.storage.store.has('pending-link')).toBe(false);
  });

  it('valoare stricată pe disc → ignorată', async () => {
    env.storage.store.set('pending-link', JSON.stringify({ path: 5, at: T0 }));
    await link.loadPendingLink();
    expect(link.takePendingLink()).toBeNull();

    env.storage.store.set('pending-link', '{stricat');
    await expect(link.loadPendingLink()).resolves.toBeUndefined();
    expect(link.takePendingLink()).toBeNull();
  });

  it('load nu suprascrie un link setat deja în rularea curentă', async () => {
    env.storage.store.set('pending-link', JSON.stringify({ path: '/p/de-pe-disc', at: T0 }));
    link.setPendingLink('/p/nou');
    await link.loadPendingLink();
    expect(link.takePendingLink()).toBe('/p/nou');
  });

  it('fără disc, linkul rămâne în memorie pe durata rulării', async () => {
    env.storage.failures.add('setItem');
    link.setPendingLink('/p/abc');
    await flushPromises();
    expect(link.takePendingLink()).toBe('/p/abc');
  });
});
