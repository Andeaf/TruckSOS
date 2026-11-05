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

import { approxCoordinate, useAdminMechanicMask } from '@/hooks/use-admin-mask';
import { fetchOpenAnnouncementsNear, type OpenAnnouncementNear } from '@/hooks/use-announcements';
import { useAuth } from '@/hooks/use-auth';
import { useRadiusFilter } from '@/hooks/use-radius-filter';

/**
 * Feed-ul de anunțuri deschise al mecanicului (1.1, faza 4.3) — stare PARTAJATĂ între
 * feed și hartă (ambele montate ca tab-uri): același set de date, același `refresh`.
 * Raza se aplică pe server (`open_announcements_near`); aici doar paginăm și ținem cache.
 *
 * - fără rază: pagini de 50, cursor pe `created_at` (`loadMore`);
 * - cu rază și poziție: o singură cerere, cel mult 100, ordonate după distanță;
 * - TTL 30 s: un `refresh()` (focus pe feed/hartă) în interiorul TTL-ului nu mai cheamă
 *   serverul; `refresh({ force: true })` (pull-to-refresh) da. Schimbarea razei, a poziției
 *   sau a contului invalidează cache-ul și recere (doar după ce cineva a cerut datele).
 */

const PAGE_SIZE = 50;
const RADIUS_LIMIT = 100;
const TTL_MS = 30 * 1000;
/**
 * Fără rază, un refresh reîncarcă (în lanț, în aceeași generație) câte rânduri erau
 * încărcate, ca lista să nu scadă la 50 (FlatList și-ar pierde poziția) — dar cel mult atât.
 * Tot 200 arăta și vechiul feed (`.limit(200)`); harta crește lista până aici o singură dată.
 */
const MAX_REFRESH_ROWS = 200;

interface OpenAnnouncementsValue {
  announcements: OpenAnnouncementNear[];
  /** Prima încărcare / reîncărcarea e în curs. */
  loading: boolean;
  /** Se încarcă pagina următoare. */
  loadingMore: boolean;
  /** Mai există pagini (doar fără rază). */
  hasMore: boolean;
  /** Lista afișată a venit deja filtrată pe rază (cu distanțe). Între activarea razei și
   * sosirea răspunsului e încă lista fără rază — ecranul nu arată distanțe/„nimic în rază”. */
  radiusApplied: boolean;
  refresh: (options?: { force?: boolean }) => Promise<void>;
  loadMore: () => Promise<void>;
}

const OpenAnnouncementsContext = createContext<OpenAnnouncementsValue | null>(null);

type Query = {
  /** Cheia cache-ului: contul + raza + poziția rotunjită (~100 m — zgomotul GPS nu recere). */
  key: string;
  userId: string | undefined;
  radius: { latitude: number; longitude: number; radiusKm: number } | null;
  /** Raza e aleasă, dar poziția n-a sosit încă (nici eroarea ei): cererea se amână. */
  waitingForCoords: boolean;
};

export function OpenAnnouncementsProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const { radiusKm, coords, locationError } = useRadiusFilter();

  const [announcements, setAnnouncements] = useState<OpenAnnouncementNear[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [radiusApplied, setRadiusApplied] = useState(false);

  const radius =
    radiusKm != null && coords != null
      ? { latitude: coords.latitude, longitude: coords.longitude, radiusKm }
      : null;
  // Fără asta, la pornirea cu raza salvată ar pleca întâi o cerere fără rază, apoi una cu rază.
  const waitingForCoords = radiusKm != null && coords == null && locationError == null;
  // Rotunjirea la ~100 m: o mișcare mică peste o graniță de rotunjire tot schimbă cheia și
  // declanșează o cerere — acceptat (poziția se re-cere oricum cel mult o dată la 2 minute).
  const key = `${userId ?? ''}|${
    radius
      ? `${radius.radiusKm}|${radius.latitude.toFixed(3)}|${radius.longitude.toFixed(3)}`
      : 'all'
  }`;
  // `refresh`/`loadMore` rămân stabile (nu re-declanșează useFocusEffect-urile ecranelor)
  // și citesc interogarea curentă din ref.
  const queryRef = useRef<Query>({ key, userId, radius, waitingForCoords });
  queryRef.current = { key, userId, radius, waitingForCoords };

  // Lista curentă (doar providerul o scrie) — loadMore lipește paginile peste ea.
  const rowsRef = useRef<OpenAnnouncementNear[]>([]);
  // Câte rânduri reîncarcă un refresh fără rază: max(încărcate, 50), plafonat la 200.
  const targetCountRef = useRef(PAGE_SIZE);
  const loadedKeyRef = useRef<string | null>(null);
  const fetchedAtRef = useRef(0);
  const inFlightRef = useRef<{ key: string; promise: Promise<void> } | null>(null);
  // Generația reîncărcării: un răspuns întârziat (rază schimbată între timp) se ignoră.
  const genRef = useRef(0);
  const cursorRef = useRef<string | null>(null);
  const hasMoreRef = useRef(false);
  const loadingMoreRef = useRef(false);
  // Până nu cere nimeni datele (feed/hartă nefocusate), schimbările de rază nu recer.
  const activatedRef = useRef(false);

  const refresh = useCallback(async (options?: { force?: boolean }) => {
    const query = queryRef.current;
    activatedRef.current = true;
    if (!query.userId) {
      // Fără sesiune (hidratare / oaspete): RPC-ul e închis pentru anon — nicio cerere.
      setLoading(false);
      return;
    }
    // Cererea pleacă singură când sosește poziția (sau eroarea ei) — efectul de mai jos.
    if (query.waitingForCoords) return;
    // Aceeași interogare deja pornită (feed + hartă la focus): o așteptăm, nu o dublăm.
    if (inFlightRef.current && inFlightRef.current.key === query.key) {
      return inFlightRef.current.promise;
    }
    if (
      !options?.force &&
      loadedKeyRef.current === query.key &&
      Date.now() - fetchedAtRef.current < TTL_MS
    ) {
      return;
    }

    const gen = ++genRef.current;
    const promise = (async () => {
      setLoading(true);
      // Eroare (rețea slabă) pe oricare cerere: păstrăm lista veche întreagă, iar cache-ul
      // rămâne expirat ca următorul focus să reîncerce.
      let rows: OpenAnnouncementNear[] = [];
      let more = false;
      if (query.radius) {
        const { data, error } = await fetchOpenAnnouncementsNear({
          ...query.radius,
          limit: RADIUS_LIMIT,
        });
        if (gen !== genRef.current) return;
        if (error) {
          setLoading(false);
          return;
        }
        rows = data;
      } else {
        // Paginile până la țintă, una după alta, în aceeași generație.
        const target = Math.min(Math.max(targetCountRef.current, PAGE_SIZE), MAX_REFRESH_ROWS);
        let before: string | undefined;
        do {
          const { data, error } = await fetchOpenAnnouncementsNear({ limit: PAGE_SIZE, before });
          if (gen !== genRef.current) return;
          if (error) {
            setLoading(false);
            return;
          }
          const seen = new Set(rows.map((a) => a.id));
          rows = [...rows, ...data.filter((a) => !seen.has(a.id))];
          more = data.length === PAGE_SIZE;
          if (data.length > 0) before = data[data.length - 1].created_at;
        } while (more && rows.length < target);
        targetCountRef.current = Math.min(Math.max(rows.length, PAGE_SIZE), MAX_REFRESH_ROWS);
      }
      rowsRef.current = rows;
      setAnnouncements(rows);
      setRadiusApplied(query.radius != null);
      loadedKeyRef.current = query.key;
      fetchedAtRef.current = Date.now();
      cursorRef.current = rows.length > 0 ? rows[rows.length - 1].created_at : null;
      hasMoreRef.current = more;
      setHasMore(more);
      setLoading(false);
    })();
    inFlightRef.current = { key: query.key, promise };
    try {
      await promise;
    } finally {
      if (inFlightRef.current?.promise === promise) inFlightRef.current = null;
    }
  }, []);

  const loadMore = useCallback(async () => {
    const query = queryRef.current;
    if (
      !query.userId ||
      query.radius ||
      loadingMoreRef.current ||
      inFlightRef.current ||
      !hasMoreRef.current ||
      loadedKeyRef.current !== query.key ||
      !cursorRef.current
    ) {
      return;
    }
    const gen = genRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const { data, error } = await fetchOpenAnnouncementsNear({
      limit: PAGE_SIZE,
      before: cursorRef.current,
    });
    loadingMoreRef.current = false;
    setLoadingMore(false);
    // Între timp s-a reîncărcat lista (pull-to-refresh, rază nouă): pagina e veche.
    if (gen !== genRef.current || error) return;
    cursorRef.current = data.length > 0 ? data[data.length - 1].created_at : cursorRef.current;
    hasMoreRef.current = data.length === PAGE_SIZE;
    setHasMore(hasMoreRef.current);
    // Cursorul strict (`created_at < p_before`) nu dă dubluri; riscul e invers: un anunț cu
    // EXACT același created_at (la microsecundă) ca ultimul rând al paginii ar fi SĂRIT —
    // practic imposibil, tolerat. Filtrul pe id rămâne doar ca plasă de siguranță.
    const seen = new Set(rowsRef.current.map((a) => a.id));
    const next = [...rowsRef.current, ...data.filter((a) => !seen.has(a.id))];
    rowsRef.current = next;
    targetCountRef.current = Math.min(Math.max(next.length, PAGE_SIZE), MAX_REFRESH_ROWS);
    setAnnouncements(next);
  }, []);

  // Rază / poziție / cont schimbate → cache invalid. Fără cont: golim tot (deconectare).
  useEffect(() => {
    if (!userId) {
      genRef.current += 1;
      // Altfel, la reconectarea rapidă cu același cont, refresh() ar primi promisiunea
      // veche (cu generația expirată, deci ignorată) și lista ar rămâne goală.
      inFlightRef.current = null;
      rowsRef.current = [];
      targetCountRef.current = PAGE_SIZE;
      loadedKeyRef.current = null;
      fetchedAtRef.current = 0;
      cursorRef.current = null;
      hasMoreRef.current = false;
      setAnnouncements([]);
      setHasMore(false);
      setRadiusApplied(false);
      setLoading(false);
      return;
    }
    if (activatedRef.current && !waitingForCoords && loadedKeyRef.current !== key) void refresh();
  }, [key, userId, waitingForCoords, refresh]);

  // Admin „ca mecanic” (1.1): RPC-ul îi dă adminului coordonatele exacte; feed-ul și harta
  // arată poziția la ~1 km, ca la un mecanic (plăcuța/VIN-ul sunt deja null aici). Mască
  // client-side, doar pentru teste — paginarea (rowsRef, cursorul pe created_at) rămâne pe
  // rândurile brute; mecanicii reali primesc oricum datele mascate de server.
  const adminMask = useAdminMechanicMask();
  const visibleAnnouncements = useMemo(
    () =>
      adminMask
        ? announcements.map((a) => ({
            ...a,
            latitude: approxCoordinate(a.latitude),
            longitude: approxCoordinate(a.longitude),
            plate_number: null,
            chassis_number: null,
          }))
        : announcements,
    [adminMask, announcements],
  );

  const value = useMemo<OpenAnnouncementsValue>(
    () => ({
      announcements: visibleAnnouncements,
      loading,
      loadingMore,
      hasMore,
      radiusApplied,
      refresh,
      loadMore,
    }),
    [visibleAnnouncements, loading, loadingMore, hasMore, radiusApplied, refresh, loadMore],
  );

  return (
    <OpenAnnouncementsContext.Provider value={value}>{children}</OpenAnnouncementsContext.Provider>
  );
}

export function useOpenAnnouncements(): OpenAnnouncementsValue {
  const context = useContext(OpenAnnouncementsContext);
  if (!context)
    throw new Error('useOpenAnnouncements trebuie folosit în interiorul OpenAnnouncementsProvider');
  return context;
}

// ── Gruparea pinurilor pe hartă ─────────────────────────────────────────────

/** Peste atâtea pinuri în zona vizibilă, harta le grupează (sub prag: pinuri individuale). */
export const MAP_CLUSTER_THRESHOLD = 100;
/** Câte celule de grid încap pe lățimea hărții la nivelul de zoom curent. */
const GRID_CELLS_ACROSS = 6;

export interface MapViewport {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface MapCluster<T> {
  key: string;
  latitude: number;
  longitude: number;
  count: number;
  items: T[];
}

function inBox(lat: number, lng: number, box: MapViewport): boolean {
  if (lat < box.south || lat > box.north) return false;
  // Antimeridianul (west > east) nu ne privește în Europa, dar nu-l stricăm.
  return box.west <= box.east ? lng >= box.west && lng <= box.east : lng >= box.west || lng <= box.east;
}

/**
 * Grupare simplă pe grid, în client (fără dependențe): cu cel mult `MAP_CLUSTER_THRESHOLD`
 * pinuri în zona vizibilă → toate individual, ca azi. Peste prag → pinurile din zona vizibilă
 * (plus o margine) se grupează pe celule a căror mărime urmează zoom-ul, rotunjit la un nivel
 * întreg ca gridul să nu „tremure” la pan; o celulă cu un singur anunț rămâne pin.
 */
export function clusterForViewport<T extends { latitude: number; longitude: number }>(
  items: T[],
  viewport: MapViewport | null,
): { singles: T[]; clusters: MapCluster<T>[] } {
  if (!viewport) return { singles: items, clusters: [] };
  let inView = 0;
  for (const item of items) {
    if (inBox(item.latitude, item.longitude, viewport)) inView += 1;
  }
  if (inView <= MAP_CLUSTER_THRESHOLD) return { singles: items, clusters: [] };

  const lngSpan = viewport.west <= viewport.east
    ? viewport.east - viewport.west
    : viewport.east + 360 - viewport.west;
  const latSpan = viewport.north - viewport.south;
  const zoom = Math.max(0, Math.round(Math.log2(360 / Math.max(lngSpan, 1e-6))));
  const cell = 360 / 2 ** zoom / GRID_CELLS_ACROSS;
  // Marginea: o jumătate de ecran în fiecare parte, ca pan-ul scurt să nu arate goluri.
  const padded: MapViewport = {
    north: viewport.north + latSpan / 2,
    south: viewport.south - latSpan / 2,
    east: viewport.east + lngSpan / 2,
    west: viewport.west - lngSpan / 2,
  };

  const cells = new Map<string, T[]>();
  for (const item of items) {
    if (!inBox(item.latitude, item.longitude, padded)) continue;
    const cellKey = `${Math.floor(item.latitude / cell)}:${Math.floor(item.longitude / cell)}`;
    const bucket = cells.get(cellKey);
    if (bucket) bucket.push(item);
    else cells.set(cellKey, [item]);
  }

  const singles: T[] = [];
  const clusters: MapCluster<T>[] = [];
  for (const [cellKey, bucket] of cells) {
    if (bucket.length === 1) {
      singles.push(bucket[0]);
      continue;
    }
    let lat = 0;
    let lng = 0;
    for (const item of bucket) {
      lat += item.latitude;
      lng += item.longitude;
    }
    clusters.push({
      key: `${zoom}:${cellKey}`,
      latitude: lat / bucket.length,
      longitude: lng / bucket.length,
      count: bucket.length,
      items: bucket,
    });
  }
  return { singles, clusters };
}
