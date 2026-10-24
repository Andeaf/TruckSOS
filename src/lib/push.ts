import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { AppState, Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

/** Ultimul token Expo revendicat de pe instalarea asta (14 sept): dacă Expo ne dă
 *  altul, serverul îl șterge pe cel vechi — altfel telefonul ar primi fiecare
 *  notificare o dată pentru fiecare token. */
const LAST_TOKEN_KEY = 'push:lastRegisteredToken';

/**
 * Notificări push (PLAN_FAZA12.md §3).
 *
 * Push-ul remote NU merge în Expo Go pe Android din SDK 53 — cere development build.
 *
 * ⚠️ `expo-notifications` NU se importă static: simpla importare rulează un side-effect
 * de auto-înregistrare (`DevicePushTokenAutoRegistration.fx`) care în Expo Go SDK 53+
 * aruncă un ERROR la pornire. Îl încărcăm LENEȘ (`require`), doar când `pushAvailable()`,
 * deci în Expo Go modulul nu se evaluează niciodată → fără eroare. Aplicația merge normal,
 * doar fără notificări.
 */

/** Datele pe care le trimite serverul, ca tapul să deschidă ecranul potrivit. */
export interface PushData {
  type?: 'conversation' | 'announcement' | 'application' | 'feed' | 'channel' | 'listing';
  id?: string;
  /** 1.1 (G): mesajul la care derulează tap-ul (push de mențiune/reply în canal). */
  message_id?: string;
  /** 1.1 (G): de ce a venit push-ul direct, fără digest. Clienții 1.0.x îl ignoră. */
  kind?: 'mention' | 'reply';
}

type ExpoNotification = import('expo-notifications').Notification;

/** Firul (conversație/canal) pe care userul îl are în față — vezi useThreadNotifications. */
let activeThread: { type: 'conversation' | 'channel'; id: string } | null = null;

export function setActiveThread(
  type: 'conversation' | 'channel' | null,
  id: string | null
): void {
  activeThread = type && id ? { type, id } : null;
}

/**
 * Scoate firul activ DOAR dacă e tot cel dat. La trecerea dintr-o conversație în alta,
 * curățarea ecranului vechi poate rula DUPĂ ce ecranul nou s-a înregistrat — nu are voie
 * să-l dea jos (altfel push-ul firului deschis ar apărea iar ca banner).
 */
export function clearActiveThread(type: 'conversation' | 'channel', id: string): void {
  if (activeThread && activeThread.type === type && activeThread.id === id) activeThread = null;
}

function isActiveThread(data: PushData | undefined): boolean {
  return (
    !!activeThread && !!data && data.type === activeThread.type && String(data.id) === activeThread.id
  );
}

/**
 * Datele push-ului, oricum ar fi ajuns (13 oct 2026). `content.data` e forma normală
 * (expo-notifications o reconstruiește și pentru celulele afișate cât aplicația era
 * închisă), dar acoperim și variantele întâlnite în practică: JSON ca string, obiectul
 * împachetat sub `body` (forma brută Expo/FCM/APNs) sau doar payload-ul declanșatorului.
 */
export function readPushData(notification: ExpoNotification | undefined): PushData | undefined {
  if (!notification) return undefined;
  const content = notification.request?.content as { data?: unknown } | undefined;
  const trigger = notification.request?.trigger as unknown as
    | { remoteMessage?: { data?: { body?: unknown } }; payload?: { body?: unknown } }
    | null
    | undefined;
  const candidates: unknown[] = [
    content?.data,
    trigger?.remoteMessage?.data?.body,
    trigger?.payload?.body,
  ];
  for (const raw of candidates) {
    const parsed = unwrapPushData(raw);
    if (parsed) return parsed;
  }
  return undefined;
}

function unwrapPushData(raw: unknown): PushData | undefined {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  if (typeof obj.type === 'string') {
    const data: PushData = {
      type: obj.type as PushData['type'],
      id: obj.id == null ? undefined : String(obj.id),
    };
    if (obj.message_id != null) data.message_id = String(obj.message_id);
    if (obj.kind === 'mention' || obj.kind === 'reply') data.kind = obj.kind;
    return data;
  }
  if ('body' in obj) return unwrapPushData(obj.body);
  return undefined;
}

export function pushAvailable(): boolean {
  // Web (7 aug): push-ul Expo nu are transport în browser — totul rămâne oprit elegant
  // (fără token, fără listeners); badge-urile in-app merg oricum prin Realtime.
  if (Platform.OS === 'web') return false;
  // Emulatoarele n-au servicii Google → nu pot primi token.
  if (!Device.isDevice) return false;
  return Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
}

type NotificationsModule = typeof import('expo-notifications');
let notifications: NotificationsModule | null = null;

/** Încarcă expo-notifications lenevos (Metro rulează codul modulului abia la primul
 *  `require`) și setează o singură dată handler-ul de afișare în prim-plan. */
function getNotifications(): NotificationsModule {
  if (!notifications) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    notifications = require('expo-notifications') as NotificationsModule;
    notifications.setNotificationHandler({
      handleNotification: async (notification) => {
        // 13 oct 2026: push-ul firului pe care userul îl citește CHIAR ACUM nu se mai
        // afișează — sosea după markRead (Realtime e mai rapid decât APNs/FCM) și
        // rămânea în bară deși mesajul era deja pe ecran. Doar cu aplicația activă;
        // în fundal handler-ul oricum nu rulează, sistemul afișează direct.
        const silent =
          AppState.currentState === 'active' && isActiveThread(readPushData(notification));
        return {
          shouldShowBanner: !silent,
          shouldShowList: !silent,
          shouldPlaySound: !silent,
          shouldSetBadge: false,
        };
      },
    });
  }
  return notifications;
}

/** Userul a refuzat permisiunea în rularea asta → nu mai insistăm la fiecare foreground. */
let permissionRefused = false;

/**
 * Cere permisiunea, obține tokenul Expo și îl salvează în `push_tokens`.
 * Întoarce tokenul (ca să-l putem șterge la logout) sau `null` dacă push-ul
 * nu e disponibil ori userul a refuzat.
 */
export async function registerPushToken(userId: string): Promise<string | null> {
  if (!pushAvailable() || permissionRefused) return null;

  try {
    const Notifications = getNotifications();
    // Canalul TREBUIE creat înainte de a cere tokenul (Android 8+), altfel
    // notificările sosesc dar nu se afișează.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'TruckSOS',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#0E3A7D',
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    const granted =
      existing.granted ||
      (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) {
      // Refuzul e persistent (iOS nici nu mai afișează dialogul a doua oară), iar de
      // pe 2 sept încercarea se reia la fiecare revenire în prim-plan — memorăm, ca
      // să nu mai batem la ușă degeaba tot restul sesiunii.
      permissionRefused = true;
      return null;
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    if (!projectId) return null;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });

    // 14 sept 2026 — „aceeași notificare de mai multe ori": serverul primește acum
    // și platforma (pe iOS trimite o notificare per mesaj, stivuite pe fir, în loc
    // de înlocuirea cu collapseId care re-afișa același conținut), tokenul NATIV
    // (APNs/FCM — un dispozitiv fizic = un singur rând în push_tokens, oricâte
    // tokenuri Expo ar fi primit între timp) și tokenul Expo anterior al acestei
    // instalări (dacă s-a schimbat, cel vechi e șters). Toate sunt opționale:
    // orice eșec aici lasă revendicarea clasică să meargă mai departe.
    let deviceToken: string | null = null;
    try {
      const native = await Notifications.getDevicePushTokenAsync();
      deviceToken = typeof native.data === 'string' && native.data ? native.data : null;
    } catch {
      deviceToken = null;
    }
    let previousToken: string | null = null;
    try {
      previousToken = await AsyncStorage.getItem(LAST_TOKEN_KEY);
    } catch {
      previousToken = null;
    }
    const claimArgs = {
      p_token: token,
      p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
      p_device_token: deviceToken,
      p_previous_token: previousToken && previousToken !== token ? previousToken : null,
      p_app_build: Constants.expoConfig?.version ?? null,
    };

    // RPC SECURITY DEFINER: revendică tokenul pentru contul curent. Un `upsert` direct
    // NU poate muta un token de pe alt cont (RLS UPDATE cere user_id = auth.uid() pe
    // rândul VECHI) → tokenul ar rămâne legat de contul precedent și notificările ar
    // ajunge pe dispozitivul greșit. Vezi 20260715_faza14_fix_push_token_claim.sql.
    // Supabase NU aruncă la eșec (întoarce {error}) — netratat, tokenul ar părea
    // înregistrat deși n-a intrat în DB (bug găsit 22 iul: RPC-ul lipsea din Studio).
    // 2 sept 2026: un singur apel, fără retry, a costat 83% din tokenuri — orice
    // eșec (cursă cu crearea profilului, rețea proastă pe drum, DB ocupată) lăsa
    // dispozitivul fără notificări până la următoarea repornire a aplicației.
    // Trei încercări cu pauză crescătoare; apelantul reia oricum la foreground.
    let lastError: string | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      let { error } = await supabase.rpc('claim_push_token', claimArgs as never);
      // PGRST202 = serverul are încă semnătura veche (migrarea 20260914 nerulată):
      // cădem pe apelul clasic, cu un singur argument, ca să nu rămână fără push.
      if (error?.code === 'PGRST202') {
        ({ error } = await supabase.rpc('claim_push_token', { p_token: token } as never));
      }
      if (!error) {
        try {
          await AsyncStorage.setItem(LAST_TOKEN_KEY, token);
        } catch {
          // Doar optimizare; fără ea dedupe-ul rămâne pe tokenul nativ.
        }
        return token;
      }
      lastError = error.message;
      console.warn(`[push] claim_push_token a eșuat (încercarea ${attempt}/3):`, error.message);
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 1500));
    }
    console.warn('[push] tokenul NU a intrat în push_tokens:', lastError);
    return null;
  } catch (e) {
    // Push-ul e un plus, nu o funcție critică: o eroare aici nu blochează login-ul.
    // Logăm totuși (adb logcat / consola dev): FIS_AUTH_ERROR pe buildul din Play
    // e altfel complet invizibil — tokenul lipsește tăcut din push_tokens.
    console.warn('[push] înregistrarea tokenului a eșuat:', e);
    return null;
  }
}

/**
 * Șterge din bara de notificări celula conversației/canalului tocmai citit
 * (7 aug: „dacă intru pe conversație și văd mesajele, notificarea dispare").
 * Serverul grupează push-urile pe fir prin `tag`/`collapseId`; aici filtrăm după
 * `data` (type + id), ca să prindem și notificările vechi, dinainte de tag.
 */
export function dismissThreadNotifications(
  type: 'conversation' | 'channel',
  id: string
): Promise<void> {
  // Pe Android serverul pune și tag-ul `channel-<id>` / `conversation-<id>` drept
  // identificator al celulei — a doua cheie, pentru cazul în care `data` lipsește.
  const tag = `${type}-${id}`;
  return dismissPresented(
    (data, identifier) => (data?.type === type && String(data.id) === id) || identifier === tag
  );
}

/**
 * Șterge din bară TOATE notificările de un anumit tip, indiferent de id (6 oct 2026):
 * la deschiderea Marketului, push-urile „anunț nou pe Market" (`type: 'listing'`) nu
 * mai au ce să anunțe — userul vede deja lista. Simetric cu celulele de chat de mai sus.
 */
export function dismissNotificationsOfType(type: NonNullable<PushData['type']>): Promise<void> {
  return dismissPresented((data) => data?.type === type);
}

async function dismissPresented(
  match: (data: PushData | undefined, identifier: string) => boolean
): Promise<void> {
  if (!pushAvailable()) return;
  try {
    const Notifications = getNotifications();
    // Două treceri (13 oct 2026): a doua prinde celulele livrate/re-afișate de sistem
    // în timpul primei (iOS stivuiește per mesaj, Android regrupează după cancel) și
    // reîncearcă ce n-a dispărut.
    for (let pass = 0; pass < 2; pass++) {
      const presented = await Notifications.getPresentedNotificationsAsync();
      const targets = presented.filter((n) => match(readPushData(n), n.request.identifier));
      if (targets.length === 0) return;
      if (__DEV__ && pass === 1) console.warn('[push] celule rămase după dismiss:', targets.length);
      await Promise.all(
        targets.map((n) => Notifications.dismissNotificationAsync(n.request.identifier))
      );
      await new Promise((r) => setTimeout(r, 400));
    }
  } catch {
    // Curățenie best-effort — nu blocăm mark-read-ul pentru asta.
  }
}

/** La logout: ștergem DOAR tokenul acestui dispozitiv, nu toate ale userului. */
export async function unregisterPushToken(token: string): Promise<void> {
  try {
    await supabase.from('push_tokens').delete().eq('token', token);
  } catch {
    // Fără efect vizibil pentru user; la următorul login tokenul se re-asociază oricum.
  }
}
