import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearPushPermissionAskedAt, pushAvailable, pushPermissionAskedAtKey, readPushData } from '@/lib/push';

const env = await vi.hoisted(async () => {
  const { createMemoryStorage } = await import('./mocks/async-storage');
  const { createPlatform } = await import('./mocks/react-native');
  return {
    storage: createMemoryStorage(),
    platform: createPlatform(),
    device: { isDevice: true },
    constants: { executionEnvironment: 'standalone', expoConfig: { version: '1.1.0' } },
  };
});

vi.mock('@react-native-async-storage/async-storage', () => ({ default: env.storage.api }));
vi.mock('react-native', () => ({ Platform: env.platform, AppState: { currentState: 'active' } }));
vi.mock('expo-device', () => env.device);
vi.mock('expo-constants', () => ({
  default: env.constants,
  ExecutionEnvironment: { Bare: 'bare', Standalone: 'standalone', StoreClient: 'storeClient' },
}));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));

type Notification = NonNullable<Parameters<typeof readPushData>[0]>;

/** O notificare cum o dă expo-notifications, cu doar câmpurile citite de readPushData. */
function notification(data: unknown, trigger: unknown = null): Notification {
  return { request: { identifier: 'n1', content: { data }, trigger } } as unknown as Notification;
}

beforeEach(() => {
  env.platform.OS = 'ios';
  env.device.isDevice = true;
  env.constants.executionEnvironment = 'standalone';
  env.storage.reset();
});

describe('readPushData: datele unei notificări → { type, id, message_id, kind }', () => {
  it('fără notificare → undefined', () => {
    expect(readPushData(undefined)).toBeUndefined();
  });

  it('forma normală (content.data); id-urile numerice devin string', () => {
    expect(readPushData(notification({ type: 'conversation', id: 'c1' }))).toEqual({ type: 'conversation', id: 'c1' });
    expect(readPushData(notification({ type: 'announcement', id: 42 }))).toEqual({ type: 'announcement', id: '42' });
  });

  it('push de mențiune / reply în canal: message_id și kind se păstrează', () => {
    expect(readPushData(notification({ type: 'channel', id: 'g', message_id: 7, kind: 'mention' }))).toEqual({
      type: 'channel',
      id: 'g',
      message_id: '7',
      kind: 'mention',
    });
    expect(readPushData(notification({ type: 'channel', id: 'g', kind: 'reply' }))?.kind).toBe('reply');
  });

  it('un `kind` necunoscut și câmpurile în plus se aruncă', () => {
    expect(readPushData(notification({ type: 'channel', id: 'g', kind: 'digest', title: 'x', body_text: 'y' }))).toEqual({
      type: 'channel',
      id: 'g',
    });
  });

  it('id lipsă sau null → id undefined (navigarea ignoră apoi notificarea)', () => {
    expect(readPushData(notification({ type: 'feed', id: null }))).toEqual({ type: 'feed', id: undefined });
    expect(readPushData(notification({ type: 'feed' }))).toEqual({ type: 'feed', id: undefined });
  });

  it('datele venite ca JSON în string', () => {
    expect(readPushData(notification(JSON.stringify({ type: 'listing', id: 'l1' })))).toEqual({ type: 'listing', id: 'l1' });
  });

  it('obiectul împachetat sub `body` (obiect sau JSON), pe oricâte niveluri', () => {
    expect(readPushData(notification({ body: { type: 'report', id: 'r1' } }))).toEqual({ type: 'report', id: 'r1' });
    expect(readPushData(notification({ body: JSON.stringify({ body: { type: 'moderation', id: 'm1' } }) }))).toEqual({
      type: 'moderation',
      id: 'm1',
    });
  });

  it('content.data gol → payload-ul declanșatorului: Android (remoteMessage.data.body) și iOS (payload.body)', () => {
    const android = { remoteMessage: { data: { body: JSON.stringify({ type: 'application', id: 'a1' }) } } };
    expect(readPushData(notification({}, android))).toEqual({ type: 'application', id: 'a1' });

    const ios = { payload: { body: { type: 'conversation', id: 'c9' } } };
    expect(readPushData(notification(undefined, ios))).toEqual({ type: 'conversation', id: 'c9' });
  });

  it('tap pe notificare: use-push-navigation citește răspunsul prin readPushData, deci toate formele dau { type, id } navigabile', () => {
    // Din 12 nov 2026 hook-ul nu mai ia `content.data` direct (un payload ca text JSON sau sub `body` nu deschidea nimic).
    // Răspunsul unui tap = { notification }; hook-ul apelează readPushData(response.notification) și navighează doar cu rezultat.
    const tapped = [
      notification({ type: 'conversation', id: 'c1' }),
      notification(JSON.stringify({ type: 'conversation', id: 'c1' })),
      notification({ body: { type: 'conversation', id: 'c1' } }),
      notification({ body: JSON.stringify({ type: 'conversation', id: 'c1' }) }),
      notification({}, { remoteMessage: { data: { body: JSON.stringify({ type: 'conversation', id: 'c1' }) } } }),
      notification(undefined, { payload: { body: { type: 'conversation', id: 'c1' } } }),
    ].map((n) => readPushData(({ notification: n }).notification));
    for (const data of tapped) expect(data).toEqual({ type: 'conversation', id: 'c1' });
    // Mesajul la care derulează canalul ajunge la navigare ca text, și dintr-un payload împachetat.
    expect(readPushData(notification({ body: { type: 'channel', id: 'g', message_id: 7, kind: 'mention' } }))).toEqual({
      type: 'channel',
      id: 'g',
      message_id: '7',
      kind: 'mention',
    });
    // Fără date citibile hook-ul nu navighează (înainte: `open(undefined)` ar fi aruncat la `data.id`).
    expect(readPushData(notification(undefined))).toBeUndefined();
  });

  it('content.data are prioritate față de declanșator', () => {
    const trigger = { payload: { body: { type: 'feed', id: 'din-trigger' } } };
    expect(readPushData(notification({ type: 'feed', id: 'din-content' }, trigger))?.id).toBe('din-content');
  });

  it('fără `type` text nicăieri, sau JSON stricat → undefined', () => {
    expect(readPushData(notification({ id: 'x' }))).toBeUndefined();
    expect(readPushData(notification({ type: 5, id: 'x' }))).toBeUndefined();
    expect(readPushData(notification('{stricat'))).toBeUndefined();
    expect(readPushData(notification(null, { payload: { body: 'nu e json' } }))).toBeUndefined();
  });

  it('comportament actual: un `type` necunoscut (server mai nou) trece nevalidat; îl ignoră abia hook-ul de navigare', () => {
    expect(readPushData(notification({ type: 'tip_din_viitor', id: 'x' }))).toEqual({ type: 'tip_din_viitor', id: 'x' });
  });
});

describe('pushAvailable', () => {
  it('telefon real, build propriu (standalone / bare) → disponibil', () => {
    expect(pushAvailable()).toBe(true);
    env.constants.executionEnvironment = 'bare';
    env.platform.OS = 'android';
    expect(pushAvailable()).toBe(true);
  });

  it('web → indisponibil', () => {
    env.platform.OS = 'web';
    expect(pushAvailable()).toBe(false);
  });

  it('emulator / simulator → indisponibil', () => {
    env.device.isDevice = false;
    expect(pushAvailable()).toBe(false);
  });

  it('Expo Go (StoreClient) → indisponibil', () => {
    env.constants.executionEnvironment = 'storeClient';
    expect(pushAvailable()).toBe(false);
  });
});

describe('pauza cererii de permisiune, per cont', () => {
  it('cheia include id-ul contului (conturile de pe același telefon nu se amestecă)', () => {
    expect(pushPermissionAskedAtKey('u1')).toBe('pushPermission:askedAt:u1');
    expect(pushPermissionAskedAtKey('u2')).not.toBe(pushPermissionAskedAtKey('u1'));
  });

  it('clearPushPermissionAskedAt șterge doar cheia contului dat', async () => {
    env.storage.store.set('pushPermission:askedAt:u1', '123');
    env.storage.store.set('pushPermission:askedAt:u2', '456');
    await clearPushPermissionAskedAt('u1');
    expect([...env.storage.store.keys()]).toEqual(['pushPermission:askedAt:u2']);
  });

  it('clearPushPermissionAskedAt nu aruncă dacă discul e indisponibil', async () => {
    env.storage.failures.add('removeItem');
    await expect(clearPushPermissionAskedAt('u1')).resolves.toBeUndefined();
  });
});

describe('getPushPermissionState', () => {
  // `expo-notifications` se încarcă prin `require` leneș (push.ts, getNotifications), pe care vi.mock nu-l
  // interceptează: în Node apelul aruncă și funcția cade pe `catch` → 'unavailable' oricare ar fi permisiunea.
  // Un test aici ar trece din motivul greșit; ar cere o schimbare în src (import injectabil), în afara brief-ului.
  it.todo('granted / askable / blocked după getPermissionsAsync și refuzul din rularea curentă (netestabil fără schimbare în src)');
});
