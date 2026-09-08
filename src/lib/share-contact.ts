import { Platform, Share } from 'react-native';

import { WEB_BASE_URL } from '@/lib/share-app';

type T = (key: string, opts?: Record<string, unknown>) => string;

export interface ShareableContact {
  id: string;
  /** Numele afișat (deja trecut prin displayName). */
  name: string;
  role?: string | null;
}

/**
 * Linkul public al unui profil (7 sept 2026). Rută scurtă, fără query string —
 * aceeași lecție ca la /android și /ios: `?` se rupe în unele clienți de mail/chat.
 *   - aplicația instalată → App Link / Universal Link → profilul, direct în aplicație;
 *   - fără aplicație → pagina web /p/<id> trimite la magazin (vezi src/app/p/[id].tsx).
 */
export function profileShareUrl(userId: string): string {
  return `${WEB_BASE_URL}/p/${userId}`;
}

export type ShareContactResult = 'shared' | 'copied' | 'cancelled';

/**
 * Partajează contactul unei persoane ÎN AFARA aplicației (WhatsApp, Messenger,
 * Facebook, SMS, email…) prin sheet-ul nativ de share. Pe web: Web Share API
 * (browserele de telefon o au), altfel textul ajunge în clipboard.
 *
 * Doar `message` (fără `url` separat): pe iOS unele aplicații lipesc AMÂNDOUĂ și
 * linkul apărea de două ori. Aruncă doar la eroare reală; închiderea sheet-ului de
 * către utilizator întoarce 'cancelled'.
 */
export async function shareContact(contact: ShareableContact, t: T): Promise<ShareContactResult> {
  const url = profileShareUrl(contact.id);
  const role = t(contact.role === 'driver' ? 'auth.roleSelect.driverTitle' : 'auth.roleSelect.mechanicTitle');
  const message = t('shareContact.message', { name: contact.name, role, url });
  const title = t('shareContact.dialogTitle');

  if (Platform.OS === 'web') {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (nav?.share) {
      try {
        await nav.share({ title, text: message });
        return 'shared';
      } catch (e) {
        // AbortError = utilizatorul a închis sheet-ul; orice altceva cade pe clipboard.
        if ((e as { name?: string })?.name === 'AbortError') return 'cancelled';
      }
    }
    await nav?.clipboard?.writeText(message);
    return 'copied';
  }

  const result = await Share.share(
    Platform.OS === 'android' ? { message, title } : { message },
    { dialogTitle: title, subject: title },
  );
  return result.action === Share.dismissedAction ? 'cancelled' : 'shared';
}
