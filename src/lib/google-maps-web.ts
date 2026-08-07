/**
 * Încărcătorul Google Maps JavaScript API — DOAR web (7 aug 2026).
 *
 * Pe telefon harta rămâne `react-native-maps` (Maps SDK for Android / Apple Maps);
 * în browser nu există echivalent nativ, deci injectăm scriptul oficial o singură
 * dată și lucrăm direct cu API-ul. Cheia vine dintr-o variabilă EXPO_PUBLIC_* —
 * ajunge inevitabil în bundle-ul public, de aceea protecția reală e restricția de
 * REFERRER de pe cheie (Google Cloud), nu ascunderea ei.
 *
 * Tipurile sunt declarate local (structural, doar ce folosim) ca să nu adăugăm
 * dependența @types/google.maps pentru un singur ecran.
 */

export interface GLatLngLiteral {
  lat: number;
  lng: number;
}

export interface GMapOptions {
  center: GLatLngLiteral;
  zoom: number;
  disableDefaultUI?: boolean;
  zoomControl?: boolean;
  mapTypeControl?: boolean;
  streetViewControl?: boolean;
  fullscreenControl?: boolean;
  gestureHandling?: string;
  clickableIcons?: boolean;
  styles?: unknown[];
}

export interface GMapListener {
  remove: () => void;
}

export interface GMap {
  setOptions: (options: Partial<GMapOptions>) => void;
  panTo: (latLng: GLatLngLiteral) => void;
  setZoom: (zoom: number) => void;
  fitBounds: (
    bounds: GLatLngBounds,
    padding?: { top: number; right: number; bottom: number; left: number },
  ) => void;
  addListener: (event: string, handler: () => void) => GMapListener;
}

export interface GMarker {
  setMap: (map: GMap | null) => void;
  setIcon: (icon: unknown) => void;
  setZIndex: (z: number) => void;
  addListener: (event: string, handler: () => void) => GMapListener;
}

export interface GCircle {
  setMap: (map: GMap | null) => void;
  setOptions: (options: Record<string, unknown>) => void;
}

export interface GLatLngBounds {
  extend: (latLng: GLatLngLiteral) => void;
}

export interface GMapsApi {
  Map: new (element: HTMLElement, options: GMapOptions) => GMap;
  Marker: new (options: Record<string, unknown>) => GMarker;
  Circle: new (options: Record<string, unknown>) => GCircle;
  LatLngBounds: new () => GLatLngBounds;
  SymbolPath: { CIRCLE: number };
}

/** Cheia web (restricționată pe referrer). Absentă = ecranul cade elegant pe stub. */
export const MAPS_WEB_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY ?? '';

const SCRIPT_ID = 'trucksos-google-maps';
let loaderPromise: Promise<GMapsApi> | null = null;

interface MapsWindow extends Window {
  google?: { maps?: GMapsApi };
}

/**
 * Injectează scriptul o singură dată per sesiune (promisiunea e memorată la nivel
 * de modul): re-montarea ecranului nu mai plătește o încărcare — și, mai important,
 * nu contorizează un „map load" în plus la Google.
 */
export function loadGoogleMaps(language: string): Promise<GMapsApi> {
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise<GMapsApi>((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('no_document'));
      return;
    }
    if (!MAPS_WEB_KEY) {
      reject(new Error('no_key'));
      return;
    }

    const win = window as MapsWindow;
    const done = () => {
      const api = win.google?.maps;
      if (api) resolve(api);
      else reject(new Error('maps_missing'));
    };

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', done);
      existing.addEventListener('error', () => reject(new Error('script_error')));
      return;
    }

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.async = true;
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(MAPS_WEB_KEY)}` +
      `&v=weekly&language=${encodeURIComponent(language)}`;
    script.addEventListener('load', done);
    script.addEventListener('error', () => {
      // Permitem o reîncercare la o montare viitoare (rețea căzută temporar).
      loaderPromise = null;
      script.remove();
      reject(new Error('script_error'));
    });
    document.head.appendChild(script);
  });

  return loaderPromise;
}
