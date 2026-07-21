import * as Location from 'expo-location';
import { Linking, Platform } from 'react-native';

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
 * Ultima poziție cunoscută de OS — se întoarce INSTANT, fără a porni GPS-ul.
 * Poate fi veche de câteva minute (maxAge mai jos), deci e potrivită DOAR pentru
 * centrarea inițială a hărții — NU pentru coordonate de anunț sau poziția de
 * referință a mecanicului (acelea rămân pe getCurrentCoords, cu fix real).
 * `null` = nu există cache valid (ex. telefon abia pornit) → apelantul cade pe
 * getCurrentCoords().
 */
export async function getLastKnownCoords(): Promise<CoordsResult | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return { error: 'denied' };

    const pos = await Location.getLastKnownPositionAsync({ maxAge: 15 * 60 * 1000 });
    if (!pos) return null;
    return {
      latitude: round6(pos.coords.latitude),
      longitude: round6(pos.coords.longitude),
    };
  } catch {
    return null;
  }
}

/**
 * Distanța Haversine în km, pentru filtrul de rază (PLAN_FAZA13.md §1.3).
 * Eroarea (<0.5% sub 500 km) e irelevantă pentru un filtru vizual; serverul are
 * propria variantă SQL (`distance_km`, Faza 12) pentru filtrul de push.
 */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

async function openUrl(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Google Maps cu traseul până la coordonate (app nativă sau browser).
 * Doar destinația — originul e completat din locația dispozitivului, deci nu
 * cerem nicio permisiune de locație aici (PLAN_FAZA8.md §4).
 * Pe iOS e butonul SECUNDAR (mulți preferă Google Maps); fără app-ul instalat cade în Safari.
 */
export function openInGoogleMaps(latitude: number, longitude: number): Promise<boolean> {
  return openUrl(`https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`);
}

/**
 * Aplicația de hărți implicită a platformei, cu traseul până la coordonate.
 * Android: Google Maps. iOS: Apple Maps — e mereu instalat (PLAN_FAZA17.md H3).
 */
export function openInMaps(latitude: number, longitude: number): Promise<boolean> {
  if (Platform.OS === 'ios') {
    return openUrl(`https://maps.apple.com/?daddr=${latitude},${longitude}`);
  }
  return openInGoogleMaps(latitude, longitude);
}
