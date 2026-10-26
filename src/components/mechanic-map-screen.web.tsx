import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { RadiusFilterMenu, type RadiusFilterMenuHandle } from '@/components/radius-filter-menu';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { DARK_MAP_STYLE, ROMANIA_REGION } from '@/constants/map-style';
import { Radius, Spacing } from '@/constants/theme';
import { useAccountGate } from '@/hooks/use-account-gate';
import { useAuth } from '@/hooks/use-auth';
import { useOpenAnnouncements, type AnnouncementWithDriver } from '@/hooks/use-announcements';
import { useGuestOpenAnnouncements } from '@/hooks/use-guest-data';
import { applyRadiusFilter, useRadiusFilter } from '@/hooks/use-radius-filter';
import { useResolvedScheme } from '@/hooks/use-settings';
import { useTheme } from '@/hooks/use-theme';
import { useTimeAgo } from '@/hooks/use-time-ago';
import { useViewedAnnouncements } from '@/hooks/use-viewed-announcements';
import {
  MAPS_WEB_KEY,
  loadGoogleMaps,
  type GCircle,
  type GMap,
  type GMapsApi,
  type GMarker,
} from '@/lib/google-maps-web';

/**
 * Harta mecanicului pe WEB (7 aug 2026) — aceleași reguli ca varianta nativă
 * (`mechanic-map-screen.tsx`): un pin per anunț deschis CU coordonate, cerc pe raza
 * filtrului, card la tap pe pin. Diferă doar motorul: Maps JavaScript API în loc de
 * `react-native-maps` (care nu rulează în browser). Metro alege fișierul după
 * platformă — ruta e doar un wrapper, fișierele de rută nu se pot splitui.
 *
 * Fără cheie web configurată (EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY) ecranul cade elegant
 * pe vechiul stub cu trimitere la feed — deci build-ul web merge și fără ea.
 */

type Located = AnnouncementWithDriver & { latitude: number; longitude: number };

function hasCoords(a: AnnouncementWithDriver): a is Located {
  return a.latitude != null && a.longitude != null;
}

/** Zoom-uri echivalente cu delta-urile regiunilor native (țară vs. „în jurul meu"). */
const COUNTRY_ZOOM = 6;
const USER_ZOOM = 12;

/** `guest` (1.1, B3): ca pe nativ — sursa e `guest_announcements`, coordonate aproximative. */
export default function MechanicMapScreenWeb({ guest = false }: { guest?: boolean }) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const scheme = useResolvedScheme();
  const router = useRouter();
  const timeAgo = useTimeAgo();
  const { session } = useAuth();
  // Oaspetele (1.1, B3): sursa e view-ul de oaspete; hook-urile citesc doar la `refresh()`.
  const memberFeed = useOpenAnnouncements(session?.user.id);
  const guestFeed = useGuestOpenAnnouncements();
  const { announcements, refresh } = guest ? guestFeed : memberFeed;
  const { requireAccount } = useAccountGate();
  const { viewed, refresh: refreshViewed } = useViewedAnnouncements(session?.user.id);
  const { radiusKm, coords, locationError, refreshCoords } = useRadiusFilter();

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    MAPS_WEB_KEY ? 'loading' : 'error',
  );
  const [selected, setSelected] = useState<Located | null>(null);
  const rangeMenuRef = useRef<RadiusFilterMenuHandle>(null);

  const containerRef = useRef<View>(null);
  const apiRef = useRef<GMapsApi | null>(null);
  const mapRef = useRef<GMap | null>(null);
  const markersRef = useRef<Map<string, GMarker>>(new Map());
  const circleRef = useRef<GCircle | null>(null);
  const meMarkerRef = useRef<GMarker | null>(null);
  const centeredRef = useRef(false);

  const located = useMemo(() => announcements.filter(hasCoords), [announcements]);
  // Contorul „fără locație" rămâne pe lista COMPLETĂ: acele anunțuri nu sunt
  // excluse de filtru, pur și simplu nu pot fi desenate.
  const missingCount = announcements.length - located.length;
  const visible = useMemo(
    () => applyRadiusFilter(located, radiusKm, coords),
    [located, radiusKm, coords],
  );
  // Handler-ele de pe pin-uri citesc lista din ref → nu recreăm markerii doar ca
  // să reîmprospătăm closure-ul (și nu servim date vechi în card).
  const visibleRef = useRef<Located[]>(visible);
  visibleRef.current = visible;

  // Tap pe bula „N anunțuri fără locație" (10 sept): feedul, cu filtrul „Fără
  // locație" gata activat — ca pe nativ. `nonce` unic per tap (vezi feed).
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

  useFocusEffect(
    useCallback(() => {
      refresh();
      refreshViewed();
      refreshCoords();
    }, [refresh, refreshViewed, refreshCoords]),
  );

  // ── Încărcarea API-ului + crearea hărții (o singură dată) ──────────────────
  useEffect(() => {
    if (!MAPS_WEB_KEY) return;
    let active = true;

    loadGoogleMaps(i18n.language)
      .then((api) => {
        const node = containerRef.current as unknown as HTMLElement | null;
        if (!active || !node) return;
        apiRef.current = api;
        mapRef.current = new api.Map(node, {
          center: { lat: ROMANIA_REGION.latitude, lng: ROMANIA_REGION.longitude },
          zoom: COUNTRY_ZOOM,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
          gestureHandling: 'greedy',
          styles: scheme === 'dark' ? DARK_MAP_STYLE : [],
        });
        // Tap pe hartă (nu pe pin) închide cardul — ca pe nativ.
        mapRef.current.addListener('click', () => setSelected(null));
        setStatus('ready');
      })
      .catch(() => {
        if (active) setStatus('error');
      });

    return () => {
      active = false;
    };
    // Stilul temei se aplică într-un efect separat; harta se creează o singură dată.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i18n.language]);

  // ── Tema: harta urmează Setările aplicației, nu tema sistemului ────────────
  useEffect(() => {
    mapRef.current?.setOptions({ styles: scheme === 'dark' ? DARK_MAP_STYLE : [] });
  }, [scheme, status]);

  // ── Centrare pe poziția mecanicului, o singură dată (când sosește) ─────────
  useEffect(() => {
    if (!mapRef.current || centeredRef.current || !coords) return;
    centeredRef.current = true;
    mapRef.current.panTo({ lat: coords.latitude, lng: coords.longitude });
    mapRef.current.setZoom(USER_ZOOM);
  }, [coords, status]);

  // ── Pin-urile: creare/ștergere incrementală + culoare după „văzut" ─────────
  useEffect(() => {
    const api = apiRef.current;
    const map = mapRef.current;
    if (!api || !map) return;

    const icon = (isViewed: boolean) => ({
      path: api.SymbolPath.CIRCLE,
      scale: 8,
      fillColor: isViewed ? '#9aa0a6' : theme.brand,
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 2,
    });

    const alive = new Set(visible.map((v) => v.id));
    for (const [id, marker] of markersRef.current) {
      if (!alive.has(id)) {
        marker.setMap(null);
        markersRef.current.delete(id);
      }
    }

    for (const item of visible) {
      const existing = markersRef.current.get(item.id);
      if (existing) {
        existing.setIcon(icon(viewed.has(item.id)));
        continue;
      }
      const marker = new api.Marker({
        map,
        position: { lat: item.latitude, lng: item.longitude },
        icon: icon(viewed.has(item.id)),
        title: item.location,
        zIndex: 2,
      });
      marker.addListener('click', () => {
        setSelected(visibleRef.current.find((v) => v.id === item.id) ?? null);
      });
      markersRef.current.set(item.id, marker);
    }
  }, [visible, viewed, theme.brand, status]);

  // ── Cercul razei + punctul propriu ─────────────────────────────────────────
  useEffect(() => {
    const api = apiRef.current;
    const map = mapRef.current;
    if (!api || !map) return;

    if (radiusKm != null && coords != null) {
      const options = {
        center: { lat: coords.latitude, lng: coords.longitude },
        radius: radiusKm * 1000,
        strokeColor: theme.brand,
        strokeOpacity: 0.9,
        strokeWeight: 1,
        fillColor: theme.brand,
        fillOpacity: 0.12,
        clickable: false,
      };
      if (circleRef.current) circleRef.current.setOptions(options);
      else circleRef.current = new api.Circle({ ...options, map });
    } else {
      circleRef.current?.setMap(null);
      circleRef.current = null;
    }

    if (coords) {
      const meIcon = {
        path: api.SymbolPath.CIRCLE,
        scale: 6,
        fillColor: '#1a73e8',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2,
      };
      if (meMarkerRef.current) meMarkerRef.current.setIcon(meIcon);
      else
        meMarkerRef.current = new api.Marker({
          map,
          position: { lat: coords.latitude, lng: coords.longitude },
          icon: meIcon,
          zIndex: 1,
        });
    }
  }, [radiusKm, coords, theme.brand, status]);

  // Curățenie la demontare: harta se recreează la următoarea montare.
  useEffect(
    () => () => {
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current.clear();
      circleRef.current?.setMap(null);
      meMarkerRef.current?.setMap(null);
      mapRef.current = null;
      centeredRef.current = false;
    },
    [],
  );

  function handleFitRange() {
    const api = apiRef.current;
    const map = mapRef.current;
    if (!api || !map) return;
    if (radiusKm == null) {
      rangeMenuRef.current?.open();
      return;
    }
    if (visible.length === 0) {
      Alert.alert(
        t('radiusFilter.emptyFilteredTitle', { km: radiusKm }),
        t('radiusFilter.emptyFilteredDescription'),
      );
      return;
    }
    const bounds = new api.LatLngBounds();
    if (coords) bounds.extend({ lat: coords.latitude, lng: coords.longitude });
    visible.forEach((v) => bounds.extend({ lat: v.latitude, lng: v.longitude }));
    map.fitBounds(bounds, { top: 90, right: 60, bottom: 140, left: 60 });
  }

  // Fără cheie sau cu scriptul căzut: vechiul stub — feed-ul are aceleași anunțuri.
  if (status === 'error') {
    return (
      <ThemedView style={styles.container}>
        <ScreenHeader title={t('mechanic.map.title')} profileButton />
        <View style={styles.body}>
          <MaterialIcons name="map" size={48} color={theme.textSecondary} />
          <ThemedText themeColor="textSecondary" style={styles.text}>
            {t('mechanic.map.webBody')}
          </ThemedText>
          <Pressable
            onPress={() =>
              router.replace((guest ? '/(guest)/announcements' : '/(mechanic)/feed') as never)
            }
            style={[styles.cta, { backgroundColor: theme.brand }]}>
            <Text style={styles.ctaText}>{t('mechanic.map.webCta')}</Text>
          </Pressable>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader
        title={t('mechanic.map.title')}
        subtitle={t('mechanic.map.pinCount', { count: visible.length })}
        right={<RadiusFilterMenu ref={rangeMenuRef} />}
        profileButton
      />

      <View style={styles.mapWrapper}>
        {/* Nodul DOM al hărții — trebuie să existe ÎNAINTE ca scriptul să termine. */}
        <View ref={containerRef} style={StyleSheet.absoluteFill} />

        {status === 'loading' ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={theme.brand} />
          </View>
        ) : null}

        {/* box-none: bula „fără locație" primește click-uri, restul zonei lasă harta. */}
        <View style={styles.banners} pointerEvents="box-none">
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
          {radiusKm != null && coords == null && locationError != null ? (
            <ThemedView type="backgroundElement" style={styles.missingBanner}>
              <MaterialIcons name="location-off" size={14} color={theme.textSecondary} />
              <ThemedText themeColor="textSecondary" type="small">
                {t(
                  locationError === 'denied'
                    ? 'radiusFilter.locationDenied'
                    : 'radiusFilter.locationUnavailable',
                )}
              </ThemedText>
            </ThemedView>
          ) : null}
        </View>

        {status === 'ready' && !selected ? (
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
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  mapWrapper: { flex: 1 },
  centered: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  text: { textAlign: 'center', maxWidth: 420 },
  cta: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Radius.control,
  },
  ctaText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
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
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  fitButton: {
    position: 'absolute',
    right: Spacing.three,
    bottom: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.control,
  },
  fitLabel: { color: '#fff', fontSize: 13, fontWeight: '700' },
  cardWrapper: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
    bottom: Spacing.three,
  },
  card: {
    padding: Spacing.three,
    borderRadius: Radius.card,
    gap: Spacing.one,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  cardTitle: { flex: 1 },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.one,
  },
  pressed: { opacity: 0.85 },
});
