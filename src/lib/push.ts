import * as Device from 'expo-device';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

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
  type?: 'conversation' | 'announcement' | 'application' | 'feed' | 'channel';
  id?: string;
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
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  }
  return notifications;
}

/**
 * Cere permisiunea, obține tokenul Expo și îl salvează în `push_tokens`.
 * Întoarce tokenul (ca să-l putem șterge la logout) sau `null` dacă push-ul
 * nu e disponibil ori userul a refuzat.
 */
export async function registerPushToken(userId: string): Promise<string | null> {
  if (!pushAvailable()) return null;

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
    if (!granted) return null;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    if (!projectId) return null;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });

    // RPC SECURITY DEFINER: revendică tokenul pentru contul curent. Un `upsert` direct
    // NU poate muta un token de pe alt cont (RLS UPDATE cere user_id = auth.uid() pe
    // rândul VECHI) → tokenul ar rămâne legat de contul precedent și notificările ar
    // ajunge pe dispozitivul greșit. Vezi 20260715_faza14_fix_push_token_claim.sql.
    // Supabase NU aruncă la eșec (întoarce {error}) — netratat, tokenul ar părea
    // înregistrat deși n-a intrat în DB (bug găsit 22 iul: RPC-ul lipsea din Studio).
    const { error } = await supabase.rpc('claim_push_token', { p_token: token } as never);
    if (error) {
      console.warn('[push] claim_push_token a eșuat:', error.message);
      return null;
    }

    return token;
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
export async function dismissThreadNotifications(
  type: 'conversation' | 'channel',
  id: string
): Promise<void> {
  if (!pushAvailable()) return;
  try {
    const Notifications = getNotifications();
    const presented = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      presented
        .filter((n) => {
          const data = n.request.content.data as PushData | undefined;
          return data?.type === type && data?.id === id;
        })
        .map((n) => Notifications.dismissNotificationAsync(n.request.identifier))
    );
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
