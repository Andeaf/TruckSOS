import { Alert, Linking, Platform } from 'react-native';
import { openBrowserAsync, WebBrowserPresentationStyle } from 'expo-web-browser';

import { WEB_HOST } from '@/lib/share-app';

type T = (key: string, opts?: Record<string, unknown>) => string;

/**
 * Deschiderea linkurilor din chat (7 sept 2026, cerere user): NICIODATĂ direct —
 * întâi o confirmare cu URL-ul complet la vedere, ca utilizatorul să știe unde
 * pleacă (mesajele vin de la străini; phishing-ul prin „link scurt" e clasic).
 *
 * Excepție: linkurile de profil TruckSOS (trucksos.net/p/<id>) rămân ÎN aplicație —
 * `onOpenProfile` le navighează fără întrebare, nu au cum să ducă în afară.
 */

const PROFILE_LINK_RE = new RegExp(
  `^https?:\\/\\/(?:www\\.)?${WEB_HOST.replace('.', '\\.')}\\/p\\/([0-9a-f-]{36})\\/?(?:[?#].*)?$`,
  'i',
);

/** Id-ul utilizatorului dacă URL-ul e un link de profil partajat, altfel null. */
export function profileIdFromUrl(url: string): string | null {
  const m = PROFILE_LINK_RE.exec(url);
  return m ? m[1] : null;
}

/** Deschide URL-ul în browser: pe nativ în browserul din aplicație, pe web într-un tab nou. */
export async function openExternalUrl(url: string, t: T): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      await Linking.openURL(url);
      return;
    }
    // Custom Tabs / SFSafariViewController: utilizatorul rămâne „în" aplicație și se
    // întoarce cu un tap; dacă modulul nu e disponibil, cădem pe browserul sistemului.
    try {
      await openBrowserAsync(url, { presentationStyle: WebBrowserPresentationStyle.AUTOMATIC });
    } catch {
      await Linking.openURL(url);
    }
  } catch {
    Alert.alert(t('chat.openLinkError'));
  }
}

/** Întreabă, apoi deschide. Linkurile de profil TruckSOS sar peste întrebare. */
export function confirmOpenUrl(
  url: string,
  t: T,
  onOpenProfile?: (userId: string) => void,
): void {
  const profileId = profileIdFromUrl(url);
  if (profileId && onOpenProfile) {
    onOpenProfile(profileId);
    return;
  }
  Alert.alert(t('chat.openLinkTitle'), t('chat.openLinkBody', { url }), [
    { text: t('common.cancel'), style: 'cancel' },
    { text: t('chat.openLinkConfirm'), onPress: () => void openExternalUrl(url, t) },
  ]);
}

/**
 * Apasă pe un număr → aplicația Telefon cu numărul deja tastat (`tel:`). Fără
 * confirmare proprie: Android deschide doar dialerul (nu sună), iar iOS întreabă
 * el „Apelezi …?" înainte de a forma numărul.
 */
export async function openPhone(number: string, t: T): Promise<void> {
  try {
    await Linking.openURL(`tel:${number}`);
  } catch {
    Alert.alert(t('chat.callError'));
  }
}
