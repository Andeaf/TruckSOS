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
import { AppState, Platform } from 'react-native';

import {
  distanceKm,
  getCurrentCoords,
  getLocationPermissionState,
  requestLocationPermission,
  type LocationPermissionState,
} from '@/lib/location';
import { loadRadiusPref, saveRadiusPref } from '@/lib/preferences';

/**
 * Filtrul de rază al mecanicului (PLAN_FAZA13.md §1) — stare PARTAJATĂ între feed
 * și hartă, ambele montate simultan ca tab-uri.
 *
 * DISTINCT de raza de notificări (`profiles.notify_radius_km`): aceea filtrează
 * push-urile server-side pe poziția de REFERINȚĂ din Setări; aici filtrăm doar ce
 * se VEDE, client-side, pe poziția CURENTĂ — nu se sincronizează (decizie R1).
 */

/**
 * Treptele standard din dropdown-ul de rază. Include 300 km (autostrăzi fără limită
 * de viteză — un mecanic ajunge departe repede); orice altă valoare se dă prin
 * opțiunea „Personalizat". `null` (fără filtru) e tratat separat în UI.
 */
export const RADIUS_FILTER_STANDARD: number[] = [25, 50, 100, 200, 300];

/** Poziția nu se re-cere mai des de atât — un filtru vizual nu justifică GPS continuu. */
const COORDS_TTL_MS = 2 * 60 * 1000;

export type Coords = { latitude: number; longitude: number };
type LocationError = 'denied' | 'unavailable';
/** `unknown` = încă neverificată — și mereu pe web, unde nu există cardul (vezi mai jos). */
export type LocationPermission = LocationPermissionState | 'unknown';

/**
 * 1.1 (7.6, AUDIT #34): pe telefon permisiunea de locație nu se mai cere singură (la
 * pornirea cu rază salvată, la focus pe feed/hartă) — doar se verifică; dialogul vine la
 * alegerea razei sau din cardul „Activează locația”. Pe web rămâne ca înainte: browserul
 * își cere acordul la prima citire, iar harta web n-are cardul.
 */
const SILENT_PERMISSION = Platform.OS !== 'web';

interface RadiusFilterValue {
  radiusKm: number | null;
  setRadiusKm: (km: number | null) => void;
  /** Poziția curentă a mecanicului; `null` până la primul fix (sau la refuz). */
  coords: Coords | null;
  /** Setat când ultima cerere de poziție a eșuat; `coords` vechi rămân valabile. */
  locationError: LocationError | null;
  /** De apelat la focus pe feed/hartă: re-cere poziția, cu throttle intern. Fără dialog. */
  refreshCoords: () => void;
  /** Starea permisiunii (verificată fără dialog); `askable` → feed-ul și harta arată cardul. */
  locationPermission: LocationPermission;
  /** Butonul din card: dialogul de sistem, apoi poziția (dacă raza e aleasă). */
  enableLocation: () => Promise<boolean>;
}

const RadiusFilterContext = createContext<RadiusFilterValue | null>(null);

export function RadiusFilterProvider({ children }: { children: ReactNode }) {
  const [radiusKm, setRadiusState] = useState<number | null>(null);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [locationError, setLocationError] = useState<LocationError | null>(null);
  const [locationPermission, setLocationPermission] = useState<LocationPermission>('unknown');
  const lastFetchRef = useRef(0);
  const fetchingRef = useRef(false);
  // Citite sincron din ascultătorul AppState și din `enableLocation` (starea React ar fi în urmă).
  const permissionRef = useRef<LocationPermission>('unknown');
  const radiusRef = useRef<number | null>(null);
  useEffect(() => {
    radiusRef.current = radiusKm;
  }, [radiusKm]);

  const updatePermission = useCallback((state: LocationPermission) => {
    permissionRef.current = state;
    setLocationPermission(state);
  }, []);

  /**
   * `prompt`: doar după un gest (alegerea razei) poate apărea dialogul de sistem; altfel se
   * verifică întâi permisiunea și, fără ea, nu se cere nimic. `force` trece peste throttle
   * (poziția imediat după ce userul a acordat permisiunea din card).
   */
  const fetchCoords = useCallback(
    async (options: { prompt: boolean; force?: boolean }) => {
      const now = Date.now();
      if (!options.force && (fetchingRef.current || now - lastFetchRef.current < COORDS_TTL_MS)) {
        return;
      }
      fetchingRef.current = true;
      try {
        if (SILENT_PERMISSION && !options.prompt) {
          const state = await getLocationPermissionState();
          updatePermission(state);
          if (state !== 'granted') {
            // Fără permisiune și fără gest: nu cerem. `denied` deblochează lista (altfel ar
            // aștepta poziția la nesfârșit) și nu consumă throttle-ul — următorul focus sau
            // alegerea razei verifică din nou.
            setLocationError('denied');
            return;
          }
        }
        lastFetchRef.current = now;
        // Cu permisiunea deja acordată, cererea din getCurrentCoords nu afișează nimic.
        const result = await getCurrentCoords();
        if ('latitude' in result) {
          setCoords({ latitude: result.latitude, longitude: result.longitude });
          setLocationError(null);
          if (SILENT_PERMISSION) updatePermission('granted');
        } else {
          setLocationError(result.error);
          if (SILENT_PERMISSION && result.error === 'denied') {
            updatePermission(await getLocationPermissionState());
          }
        }
      } finally {
        fetchingRef.current = false;
      }
    },
    [updatePermission]
  );

  // Poziția se cere LAZY: doar dacă filtrul era activ la ultima sesiune (pe telefon, doar
  // cu permisiunea deja acordată)…
  useEffect(() => {
    if (SILENT_PERMISSION) void getLocationPermissionState().then(updatePermission);
    loadRadiusPref().then((stored) => {
      setRadiusState(stored);
      radiusRef.current = stored;
      if (stored != null) void fetchCoords({ prompt: !SILENT_PERMISSION });
    });
  }, [fetchCoords, updatePermission]);

  // Permisiunea acordată din setările telefonului (sau „Doar de data asta” expirată): la
  // revenirea în aplicație re-verificăm — fără dialog și doar cât timp nu e acordată, deci
  // cine o are deja nu pornește GPS-ul la fiecare prim-plan (ca până acum).
  useEffect(() => {
    if (!SILENT_PERMISSION) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || permissionRef.current === 'granted') return;
      void getLocationPermissionState().then((state) => {
        updatePermission(state);
        if (state === 'granted' && radiusRef.current != null) {
          void fetchCoords({ prompt: false, force: true });
        }
      });
    });
    return () => sub.remove();
  }, [fetchCoords, updatePermission]);

  // …sau când mecanicul îl activează acum (gest explicit → aici poate apărea dialogul).
  // Cine nu-l folosește nu vede dialogul GPS.
  const setRadiusKm = useCallback(
    (km: number | null) => {
      setRadiusState(km);
      radiusRef.current = km;
      void saveRadiusPref(km);
      if (km != null) void fetchCoords({ prompt: true });
    },
    [fetchCoords]
  );

  const refreshCoords = useCallback(() => {
    if (radiusKm != null) {
      void fetchCoords({ prompt: !SILENT_PERMISSION });
    } else if (SILENT_PERMISSION && permissionRef.current !== 'granted') {
      // Fără rază poziția nu trebuie, dar harta își arată cardul după starea asta.
      void getLocationPermissionState().then(updatePermission);
    }
  }, [radiusKm, fetchCoords, updatePermission]);

  const enableLocation = useCallback(async () => {
    const state = await requestLocationPermission();
    updatePermission(state);
    if (state !== 'granted') return false;
    if (radiusRef.current != null) {
      // Lista așteaptă poziția (nu mai pleacă fără rază), iar poziția o cerem imediat.
      setLocationError(null);
      void fetchCoords({ prompt: false, force: true });
    }
    return true;
  }, [fetchCoords, updatePermission]);

  const value = useMemo<RadiusFilterValue>(
    () => ({
      radiusKm,
      setRadiusKm,
      coords,
      locationError,
      refreshCoords,
      locationPermission,
      enableLocation,
    }),
    [radiusKm, setRadiusKm, coords, locationError, refreshCoords, locationPermission, enableLocation]
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
