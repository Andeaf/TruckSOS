import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import MapView, { Circle, Marker, type Region } from 'react-native-maps';

import { LocationPrimerCard } from '@/components/location-primer-card';
import { RadiusFilterMenu, type RadiusFilterMenuHandle } from '@/components/radius-filter-menu';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { DARK_MAP_STYLE, ROMANIA_REGION, USER_REGION_DELTA } from '@/constants/map-style';
import { Radius, Spacing } from '@/constants/theme';
import { useAccountGate } from '@/hooks/use-account-gate';
import { useAuth } from '@/hooks/use-auth';
import { type AnnouncementWithDriver } from '@/hooks/use-announcements';
import { useGuestOpenAnnouncements } from '@/hooks/use-guest-data';
import {
  clusterForViewport,
  useOpenAnnouncements,
  type MapCluster,
  type MapViewport,
} from '@/hooks/use-open-announcements';
import { applyRadiusFilter, useRadiusFilter } from '@/hooks/use-radius-filter';
import { useResolvedScheme } from '@/hooks/use-settings';
import { useTheme } from '@/hooks/use-theme';
import { useTimeAgo } from '@/hooks/use-time-ago';
import { useViewedAnnouncements } from '@/hooks/use-viewed-announcements';
import { getCurrentCoords, getLastKnownCoords, getLocationPermissionState } from '@/lib/location';

/**
 * Harta mecanicului (PLAN_FAZA11.md §2): un pin per anunț deschis CU coordonate.
 * Anunțurile fără GPS nu pot fi plasate — nu le inventăm poziția (fără geocodare),
 * doar le numărăm, ca mecanicul să știe că harta nu e lista completă.
 */

/** Plafonul hărții fără rază (membru): cât arăta vechiul feed (`.limit(200)`). */
const MAP_MEMBER_MIN_PINS = 200;

/** Anunț cu coordonate garantat non-null — îngustăm tipul o singură dată, la filtrare. */
type Located = AnnouncementWithDriver & { latitude: number; longitude: number };

function hasCoords(a: AnnouncementWithDriver): a is Located {
  return a.latitude != null && a.longitude != null;
}

function coordsToRegion(c: { latitude: number; longitude: number }): Region {
  return {
    latitude: c.latitude,
    longitude: c.longitude,
    latitudeDelta: USER_REGION_DELTA,
    longitudeDelta: USER_REGION_DELTA,
  };
}

function regionToViewport(r: Region): MapViewport {
  return {
    north: r.latitude + r.latitudeDelta / 2,
    south: r.latitude - r.latitudeDelta / 2,
    east: r.longitude + r.longitudeDelta / 2,
    west: r.longitude - r.longitudeDelta / 2,
  };
}

/**
 * Pinul unui grup (1.1, faza 4.3): cerc cu numărul de anunțuri. `tracksViewChanges` pornit
 * doar până la primul cadru — pe Android un marker cu view propriu care urmărește mereu
 * schimbările costă la fiecare frame, iar oprit de la început poate ieși gol. Cifra nouă =
 * `key` nou (remontare), deci textul nu rămâne vechi.
 */
function ClusterMarker({
  cluster,
  color,
  label,
  onPress,
}: {
  cluster: MapCluster<Located>;
  color: string;
  label: string;
  onPress: () => void;
}) {
  const [tracks, setTracks] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => setTracks(false), 500);
    return () => clearTimeout(id);
  }, []);
  return (
    <Marker
      coordinate={{ latitude: cluster.latitude, longitude: cluster.longitude }}
      tracksViewChanges={tracks}
      onPress={onPress}
      accessibilityLabel={label}>
      <View style={[styles.cluster, { backgroundColor: color }]}>
        <Text style={styles.clusterText} maxFontSizeMultiplier={1.3}>
          {cluster.count}
        </Text>
      </View>
    </Marker>
  );
}

/**
 * `guest` (1.1, B3): harta oaspetelui — anunțurile din `guest_announcements`, cu pin-urile pe
 * coordonatele APROXIMATIVE (~1 km); tap pe card → detaliul de oaspete. Filtrul de rază
 * rămâne (folosește poziția curentă a telefonului, nu profilul).
 */
export default function MechanicMapScreen({ guest = false }: { guest?: boolean }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const scheme = useResolvedScheme();
  const router = useRouter();
  const timeAgo = useTimeAgo();
  const { session } = useAuth();
  // Propriile anunțuri nu apar pe hartă (le gestionezi sub „Ale mele" din feed).
  // Oaspetele (1.1, B3): sursa e view-ul de oaspete. Ambele hook-uri citesc DOAR la
  // `refresh()` (nimic la montare), deci cel nefolosit nu face nicio cerere.
  // 1.1 (faza 4.3): membrul ia datele din OpenAnnouncementsProvider — aceleași ca feed-ul,
  // cu același cache de 30 s, deja filtrate pe rază de server.
  const memberFeed = useOpenAnnouncements();
  const guestFeed = useGuestOpenAnnouncements();
  const source = guest ? guestFeed : memberFeed;
  const announcements: AnnouncementWithDriver[] = source.announcements;
  const refresh = source.refresh;

  // Fără rază, providerul aduce pagini de 50; harta arăta până la 200 de anunțuri (vechiul
  // `.limit(200)`), deci membrul încarcă în lanț pagini până la plafon sau până nu mai sunt.
  // Ref-ul ține lista din care s-a cerut ultima pagină: o pagină eșuată (rețea slabă) lasă
  // aceeași listă, deci nu reîncercăm în buclă; următorul refresh reia lanțul.
  const lastChainedFromRef = useRef<AnnouncementWithDriver[] | null>(null);
  const {
    announcements: memberAnnouncements,
    hasMore: memberHasMore,
    loadingMore: memberLoadingMore,
    loadMore: memberLoadMore,
  } = memberFeed;
  useEffect(() => {
    if (guest || !memberHasMore || memberLoadingMore) return;
    if (memberAnnouncements.length === 0 || memberAnnouncements.length >= MAP_MEMBER_MIN_PINS) return;
    if (lastChainedFromRef.current === memberAnnouncements) return;
    lastChainedFromRef.current = memberAnnouncements;
    void memberLoadMore();
  }, [guest, memberAnnouncements, memberHasMore, memberLoadingMore, memberLoadMore]);
  const { requireAccount } = useAccountGate();
  const { viewed, refresh: refreshViewed } = useViewedAnnouncements(session?.user.id);
  const { radiusKm, coords, locationError, refreshCoords, locationPermission, enableLocation } =
    useRadiusFilter();
  // 1.1 (7.6, AUDIT #34): harta nu mai cere permisiunea la deschidere. Fără ea pornește pe
  // România, fără punctul albastru, cu cardul „Activează locația” (dialogul doar la buton).
  // Pe lângă starea comună, ținem minte verificarea proprie de la montare: harta se randează
  // abia după ea, deci cine are deja permisiunea vede punctul albastru din primul cadru.
  const [mapLocationGranted, setMapLocationGranted] = useState(false);
  const locationGranted = mapLocationGranted || locationPermission === 'granted';
  const showLocationCard = !locationGranted && locationPermission === 'askable';

  // `initialRegion` se aplică o singură dată, la montare → randăm harta abia după ce
  // știm de unde pornim (poziția mecanicului sau, la refuz/eroare, centrul României).
  const [region, setRegion] = useState<Region | null>(null);
  // Zona afișată acum (după pan/zoom) — decide gruparea pinurilor.
  // Legată de tema cu care a fost raportată: la schimbarea temei harta se remontează
  // (key={scheme}) și revine la `initialRegion`, deci zona veche nu mai e valabilă.
  const [viewState, setViewState] = useState<{ scheme: string; region: Region } | null>(null);
  const viewRegion = viewState?.scheme === scheme ? viewState.region : null;
  const [selected, setSelected] = useState<Located | null>(null);
  const mapRef = useRef<MapView>(null);
  const rangeMenuRef = useRef<RadiusFilterMenuHandle>(null);

  useEffect(() => {
    let active = true;
    const toRegion = coordsToRegion;

    (async () => {
      // 0) Permisiunea, FĂRĂ dialog (7.6): neacordată → România, cardul o cere la buton.
      //    Acordată → exact ca până acum (cererea din getLastKnownCoords nu mai afișează nimic).
      const permission = await getLocationPermissionState();
      if (!active) return;
      if (permission !== 'granted') {
        setRegion(ROMANIA_REGION);
        return;
      }
      setMapLocationGranted(true);

      // 1) Cache-ul OS (getLastKnownPositionAsync) — instant, fără pornirea GPS-ului.
      //    Pentru CENTRARE e suficient: poziția exactă o arată oricum punctul albastru
      //    (showsUserLocation), iar butonul nativ de localizare recentrează la nevoie.
      //    Un fix real (getCurrentPositionAsync) poate dura ~10s cu GPS „rece" — de aici
      //    veneau încărcările lente ale hărții.
      const cached = await getLastKnownCoords();
      if (!active) return;
      if (cached) {
        setRegion('latitude' in cached ? toRegion(cached) : ROMANIA_REGION);
        return;
      }

      // 2) Fără cache (ex. telefon abia pornit): cerem fix real, dar plafonat la 5s —
      //    harta se deschide pe România și nu mai ține mecanicul pe spinner.
      const fix = getCurrentCoords();
      const result = await Promise.race([
        fix,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
      ]);
      if (!active) return;
      setRegion(result && 'latitude' in result ? toRegion(result) : ROMANIA_REGION);

      // 3) Dacă fixul sosește după plafon, recentrăm o singură dată pe poziția reală.
      if (result === null) {
        fix.then((late) => {
          if (active && 'latitude' in late) {
            mapRef.current?.animateToRegion(toRegion(late), 600);
          }
        });
      }
    })();

    return () => { active = false; };
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
      // La întoarcerea din detaliu, pinul tocmai deschis trebuie să devină „văzut".
      refreshViewed();
      // Poziția pentru filtrul de rază — throttle intern.
      refreshCoords();
    }, [refresh, refreshViewed, refreshCoords])
  );

  const located = useMemo(() => announcements.filter(hasCoords), [announcements]);
  // Contorul „fără locație" rămâne pe lista COMPLETĂ (R8): acele anunțuri nu sunt
  // excluse de filtru, pur și simplu nu pot fi desenate.
  const missingCount = announcements.length - located.length;
  // Membrul: serverul a filtrat deja pe rază. Oaspetele (view fără rază): filtrul rămâne local.
  const visible = useMemo(
    () => (guest ? applyRadiusFilter(located, radiusKm, coords) : located),
    [guest, located, radiusKm, coords]
  );
  // Peste 100 de pinuri în zona vizibilă → grupuri pe grid (tap = zoom in); sub prag, ca azi.
  const { singles, clusters } = useMemo(
    () => {
      // Până la primul onRegionChangeComplete, zona e cea de pornire.
      const shown = viewRegion ?? region;
      return clusterForViewport(visible, shown ? regionToViewport(shown) : null);
    },
    [visible, viewRegion, region]
  );

  function zoomIntoCluster(cluster: MapCluster<Located>) {
    setSelected(null);
    const base = viewRegion ?? region;
    if (!base) return;
    mapRef.current?.animateToRegion(
      {
        latitude: cluster.latitude,
        longitude: cluster.longitude,
        latitudeDelta: base.latitudeDelta / 4,
        longitudeDelta: base.longitudeDelta / 4,
      },
      400
    );
  }

  // Tap pe bula „N anunțuri fără locație" (10 sept): feedul, cu filtrul „Fără
  // locație" gata activat — acolo pot fi citite. `nonce` unic per tap (vezi feed).
  function openMissing() {
    if (guest) {
      // Lista oaspetelui n-are filtrul „Fără locație” — anunțurile apar toate acolo.
      router.navigate('/(guest)/announcements' as never);
      return;
    }
    router.navigate({
      pathname: '/(mechanic)/feed',
      params: { location: 'without', nonce: String(Date.now()) },
    } as never);
  }

  // Butonul din cardul de locație: abia aici apare dialogul de sistem; acordată → centrăm
  // pe poziție (întâi cache-ul OS, instant; altfel un fix real) și o păstrăm ca regiune de
  // pornire, ca remontarea la schimbarea temei să nu revină pe România.
  async function handleEnableLocation() {
    const granted = await enableLocation();
    if (!granted) return;
    setMapLocationGranted(true);
    const cached = await getLastKnownCoords();
    const found = cached && 'latitude' in cached ? cached : await getCurrentCoords();
    if (!('latitude' in found)) return;
    const next = coordsToRegion(found);
    setRegion(next);
    mapRef.current?.animateToRegion(next, 600);
  }

  // „Anunțuri în rază": încadrează harta pe anunțurile din raza aleasă, ca mecanicul
  // să vadă dintr-o privire toți șoferii cu probleme din jur.
  function handleFitRange() {
    // Fără rază aleasă → deschidem selectorul „Arie", nu blocăm mecanicul.
    if (radiusKm == null) {
      rangeMenuRef.current?.open();
      return;
    }
    if (visible.length === 0) {
      Alert.alert(
        t('radiusFilter.emptyFilteredTitle', { km: radiusKm }),
        t('radiusFilter.emptyFilteredDescription')
      );
      return;
    }
    // Includem și poziția mecanicului (centrul cercului), ca încadrarea să arate
    // unde e el față de anunțuri, nu doar aglomerarea de pin-uri.
    const points = [
      ...(coords ? [coords] : []),
      ...visible.map((v) => ({ latitude: v.latitude, longitude: v.longitude })),
    ];
    mapRef.current?.fitToCoordinates(points, {
      edgePadding: { top: 90, right: 60, bottom: 140, left: 60 },
      animated: true,
    });
  }

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader
        title={t('mechanic.map.title')}
        subtitle={t('mechanic.map.pinCount', { count: visible.length })}
        right={<RadiusFilterMenu ref={rangeMenuRef} />}
        profileButton
      />

      {region ? (
        <View style={styles.mapWrapper}>
          <MapView
            // react-native-maps (1.20.1) NU resetează `customMapStyle` când prop-ul
            // trece de la stilul dark înapoi la `undefined` — stilul vechi rămâne lipit
            // pe harta nativă. Remontăm harta la schimbarea temei ca stilul corect să
            // se aplice de la zero. `initialRegion` se re-aplică din `region` (păstrat
            // în state), deci se recentrează, nu se pierde poziția.
            key={scheme}
            ref={mapRef}
            style={StyleSheet.absoluteFill}
            initialRegion={region}
            // Doar cu permisiunea deja acordată (7.6): fără ea nu cerem nimic de la hartă.
            // Trecerea false → true după „Permite” repornește punctul albastru (Android
            // verifică permisiunea la fiecare setare a prop-ului).
            showsUserLocation={locationGranted}
            showsMyLocationButton={locationGranted}
            toolbarEnabled={false}
            customMapStyle={scheme === 'dark' ? DARK_MAP_STYLE : undefined}
            // customMapStyle e Google-only (ignorat de Apple Maps); pe iOS tema hărții
            // se leagă de tema aplicației prin userInterfaceStyle (prop Apple Maps-only,
            // fără efect pe Android) — altfel harta ar urma tema sistemului, nu Setările.
            userInterfaceStyle={scheme}
            // iOS (Apple Maps): tap-ul pe un Marker declanșează ȘI onPress-ul hărții,
            // care ar închide imediat cardul abia deschis — ignorăm evenimentul de tip
            // marker-press (pe Android nu se emite dublu, ramura e no-op).
            onPress={(e) => {
              if (e.nativeEvent.action !== 'marker-press') setSelected(null);
            }}
            onRegionChangeComplete={(r) => setViewState({ scheme, region: r })}>
            {/* Raza filtrului, desenată — face vizibil intuitiv de ce lipsesc pin-uri. */}
            {radiusKm != null && coords != null ? (
              <Circle
                center={coords}
                radius={radiusKm * 1000}
                strokeColor={theme.brand}
                strokeWidth={1}
                fillColor={`${theme.brand}1F`}
              />
            ) : null}
            {singles.map((item) => (
              <Marker
                key={item.id}
                coordinate={{ latitude: item.latitude, longitude: item.longitude }}
                // Anunțurile nedeschise încă ies în evidență; restul se estompează.
                pinColor={viewed.has(item.id) ? '#9aa0a6' : theme.brand}
                onPress={() => setSelected(item)}
              />
            ))}
            {clusters.map((cluster) => (
              <ClusterMarker
                key={`${cluster.key}:${cluster.count}`}
                cluster={cluster}
                color={theme.brand}
                label={t('mechanic.map.pinCount', { count: cluster.count })}
                onPress={() => zoomIntoCluster(cluster)}
              />
            ))}
          </MapView>

          {/* box-none: bula „fără locație" primește tap-uri, restul zonei lasă harta. */}
          <View style={styles.banners} pointerEvents="box-none">
            {showLocationCard ? (
              <LocationPrimerCard floating onEnable={handleEnableLocation} />
            ) : null}
            {missingCount > 0 ? (
              <Pressable
                onPress={openMissing}
                accessibilityRole="button"
                accessibilityLabel={t('mechanic.map.missingOpen')}
                style={({ pressed }) => pressed && styles.pressed}>
                <ThemedView type="backgroundElement" style={styles.missingBanner}>
                  <MaterialIcons name="location-off" size={14} color={theme.textSecondary} />
                  <ThemedText themeColor="textSecondary" type="small">
                    {t('mechanic.map.missingCount', { count: missingCount })}
                  </ThemedText>
                  <MaterialIcons name="chevron-right" size={16} color={theme.textSecondary} />
                </ThemedView>
              </Pressable>
            ) : null}
            {!showLocationCard && radiusKm != null && coords == null && locationError != null ? (
              <ThemedView type="backgroundElement" style={styles.missingBanner}>
                <MaterialIcons name="location-off" size={14} color={theme.textSecondary} />
                <ThemedText themeColor="textSecondary" type="small">
                  {t(
                    locationError === 'denied'
                      ? 'radiusFilter.locationDenied'
                      : 'radiusFilter.locationUnavailable'
                  )}
                </ThemedText>
              </ThemedView>
            ) : null}
          </View>

          {/* Buton de încadrare pe rază — ascuns cât timp un card de anunț e deschis,
              ca să nu se suprapună peste el. */}
          {!selected ? (
            <Pressable
              onPress={handleFitRange}
              accessibilityLabel={t('mechanic.map.fitRange')}
              style={({ pressed }) => [
                styles.fitButton,
                { backgroundColor: theme.brand },
                pressed && styles.pressed,
              ]}>
              <MaterialIcons name="zoom-out-map" size={18} color="#fff" />
              <Text style={styles.fitLabel}>{t('mechanic.map.fitRange')}</Text>
            </Pressable>
          ) : null}

          {/* Cardul dispare dacă pinul lui tocmai a ieșit din rază (filtru strâns). */}
          {selected && visible.some((v) => v.id === selected.id) ? (
            <Pressable
              onPress={() =>
                // 25 oct 2026: oaspetele nu vede detaliul anunțului; după cont revine pe el.
                guest
                  ? requireAccount('viewAnnouncement', `/(guest)/announcements/${selected.id}`)
                  : router.push({ pathname: '/(mechanic)/feed/[id]' as never, params: { id: selected.id } })
              }
              style={({ pressed }) => [styles.cardWrapper, pressed && styles.pressed]}>
              <ThemedView type="backgroundElement" style={styles.card}>
                <View style={styles.cardHeader}>
                  <MaterialIcons name="location-on" size={16} color={theme.brand} />
                  <ThemedText type="smallBold" numberOfLines={1} style={styles.cardTitle}>
                    {selected.location}
                  </ThemedText>
                  <ThemedText themeColor="textSecondary" type="small">
                    {timeAgo(selected.created_at)}
                  </ThemedText>
                </View>

                <ThemedText themeColor="textSecondary" type="small" numberOfLines={2}>
                  {selected.description}
                </ThemedText>

                <View style={styles.cardFooter}>
                  <ThemedText themeColor="textSecondary" type="small" numberOfLines={1}>
                    {selected.driver?.full_name ?? ''}
                  </ThemedText>
                  <MaterialIcons name="chevron-right" size={20} color={theme.textSecondary} />
                </View>
              </ThemedView>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.brand} />
        </View>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  mapWrapper: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  banners: {
    position: 'absolute',
    top: Spacing.three,
    left: Spacing.four,
    right: Spacing.four,
    alignItems: 'center',
    gap: Spacing.two,
  },
  missingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.card,
    // Umbra ține banda lizibilă peste orice zonă a hărții.
    ...Platform.select({
      android: { elevation: 3 },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.2,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 },
      },
    }),
  },
  cardWrapper: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
    bottom: Spacing.three,
  },
  card: {
    padding: Spacing.three,
    borderRadius: Radius.card,
    gap: Spacing.two,
    ...Platform.select({
      android: { elevation: 6 },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.25,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
      },
    }),
  },
  fitButton: {
    position: 'absolute',
    right: Spacing.three,
    bottom: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.control,
    ...Platform.select({
      android: { elevation: 6 },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.25,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
      },
    }),
  },
  fitLabel: { color: '#fff', fontSize: 14, fontWeight: '600' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  cardTitle: { flex: 1 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pressed: { opacity: 0.9 },
  cluster: {
    minWidth: 36,
    minHeight: 36,
    paddingHorizontal: Spacing.one,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clusterText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
