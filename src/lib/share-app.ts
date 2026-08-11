import { Share } from 'react-native';

/**
 * Fișa aplicației în Google Play — link-ul public rămâne același și după
 * lansarea din closed testing. Când apare și versiunea de App Store, mesajul
 * de share se extinde aici, într-un singur loc.
 */
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.andeaf.trucksos';

/** Deschide sheet-ul nativ de share cu mesajul de recomandare a aplicației. */
export async function shareApp(t: (key: string, opts?: Record<string, unknown>) => string) {
  try {
    await Share.share({ message: t('profile.shareMessage', { url: PLAY_STORE_URL }) });
  } catch {
    // Sheet închis de utilizator / share indisponibil pe platformă — nimic de făcut.
  }
}
