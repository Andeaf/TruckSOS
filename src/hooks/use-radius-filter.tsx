import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { distanceKm, getCurrentCoords } from '@/lib/location';
import { loadRadiusPref, saveRadiusPref } from '@/lib/preferences';

/**
 * Filtrul de rază al mecanicului (PLAN_FAZA13.md §1) — stare PARTAJATĂ între feed
 * și hartă, ambele montate simultan ca tab-uri.
 *
 * DISTINCT de raza de notificări (`profiles.notify_radius_km`): aceea filtrează
 * push-urile server-side pe poziția de REFERINȚĂ din Setări; aici filtrăm doar ce
 * se VEDE, client-side, pe poziția CURENTĂ — nu se sincronizează (decizie R1).
 */

/** Aceleași trepte ca raza de notificări din Setări; `null` = fără filtru. */
export const RADIUS_FILTER_OPTIONS: (number | null)[] = [25, 50, 100, 200, null];

/** Poziția nu se re-cere mai des de atât — un filtru vizual nu justifică GPS continuu. */
const COORDS_TTL_MS = 2 * 60 * 1000;

export type Coords = { latitude: number; longitude: number };
type LocationError = 'denied' | 'unavailable';

interface RadiusFilterValue {
  radiusKm: number | null;
  setRadiusKm: (km: number | null) => void;
  /** Poziția curentă a mecanicului; `null` până la primul fix (sau la refuz). */
  coords: Coords | null;
  /** Setat când ultima cerere de poziție a eșuat; `coords` vechi rămân valabile. */
  locationError: LocationError | null;
  /** De apelat la focus pe feed/hartă: re-cere poziția, cu throttle intern. */
  refreshCoords: () => void;
}

const RadiusFilterContext = createContext<RadiusFilterValue | null>(null);

export function RadiusFilterProvider({ children }: { children: ReactNode }) {
  const [radiusKm, setRadiusState] = useState<number | null>(null);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [locationError, setLocationError] = useState<LocationError | null>(null);
  const lastFetchRef = useRef(0);
  const fetchingRef = useRef(false);

  const fetchCoords = useCallback(async () => {
    const now = Date.now();
    if (fetchingRef.current || now - lastFetchRef.current < COORDS_TTL_MS) return;
    fetchingRef.current = true;
    lastFetchRef.current = now;
    const result = await getCurrentCoords();
    fetchingRef.current = false;
    if ('latitude' in result) {
      setCoords({ latitude: result.latitude, longitude: result.longitude });
      setLocationError(null);
    } else {
      setLocationError(result.error);
    }
  }, []);

  // Poziția se cere LAZY: doar dacă filtrul era activ la ultima sesiune…
  useEffect(() => {
    loadRadiusPref().then((stored) => {
      setRadiusState(stored);
      if (stored != null) void fetchCoords();
    });
  }, [fetchCoords]);

  // …sau când mecanicul îl activează acum. Cine nu-l folosește nu vede dialogul GPS.
  const setRadiusKm = useCallback(
    (km: number | null) => {
      setRadiusState(km);
      void saveRadiusPref(km);
      if (km != null) void fetchCoords();
    },
    [fetchCoords]
  );

  const refreshCoords = useCallback(() => {
    if (radiusKm != null) void fetchCoords();
  }, [radiusKm, fetchCoords]);

  const value = useMemo<RadiusFilterValue>(
    () => ({ radiusKm, setRadiusKm, coords, locationError, refreshCoords }),
    [radiusKm, setRadiusKm, coords, locationError, refreshCoords]
  );

  return <RadiusFilterContext.Provider value={value}>{children}</RadiusFilterContext.Provider>;
}

export function useRadiusFilter(): RadiusFilterValue {
  const context = useContext(RadiusFilterContext);
  if (!context)
    throw new Error('useRadiusFilter trebuie folosit în interiorul RadiusFilterProvider');
  return context;
}

/**
 * Regula de filtrare, unică pentru feed și hartă: anunțurile FĂRĂ coordonate rămân
 * (nu le putem calcula distanța — nu le ascundem), cele cu coordonate trec doar
 * dacă intră în rază. Fără rază sau fără poziție → lista netrunchiată.
 */
export function applyRadiusFilter<T extends { latitude: number | null; longitude: number | null }>(
  items: T[],
  radiusKm: number | null,
  coords: Coords | null
): T[] {
  if (radiusKm == null || coords == null) return items;
  return items.filter(
    (item) =>
      item.latitude == null ||
      item.longitude == null ||
      distanceKm(coords.latitude, coords.longitude, item.latitude, item.longitude) <= radiusKm
  );
}
