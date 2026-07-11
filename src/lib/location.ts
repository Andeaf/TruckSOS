import * as Location from 'expo-location';
import { Linking } from 'react-native';

export type CoordsResult =
  | { latitude: number; longitude: number }
  | { error: 'denied' | 'unavailable' };

/** ~6 zecimale ≈ 0.1 m — suficient pentru un reper pe șosea, fără zgomot. */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * Cere permisiunea de locație în foreground și întoarce poziția curentă.
 * Foreground location e inclus în Expo Go (SDK 54) — nu necesită development build.
 * Nu aruncă: întoarce `{ error }` pe refuz de permisiune sau GPS indisponibil.
 */
export async function getCurrentCoords(): Promise<CoordsResult> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return { error: 'denied' };

    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      latitude: round6(pos.coords.latitude),
      longitude: round6(pos.coords.longitude),
    };
  } catch {
    return { error: 'unavailable' };
  }
}

/**
 * Deschide Google Maps (app nativă sau browser) cu traseul până la coordonate.
 * Doar `destination` — Google completează originul din locația dispozitivului,
 * deci nu cerem nicio permisiune de locație aici (PLAN_FAZA8.md §4).
 * Întoarce `false` dacă URL-ul nu poate fi deschis.
 */
export async function openInGoogleMaps(latitude: number, longitude: number): Promise<boolean> {
  const url = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
