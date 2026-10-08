import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { AnnouncementCard } from '@/components/announcement-card';
import { EmptyState } from '@/components/empty-state';
import { RadiusFilterMenu } from '@/components/radius-filter-menu';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { FilterChips } from '@/components/ui/filter-chips';
import { Input } from '@/components/ui/input';
import {
  HeaderGradient,
  HeaderGradientDirection,
  Radius,
  Shadows,
  Spacing,
} from '@/constants/theme';
import { useExitConfirm } from '@/hooks/use-exit-confirm';
import { useResolvedScheme } from '@/hooks/use-settings';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import {
  useMyAnnouncements,
  useOpenAnnouncements,
  fetchPendingApplicationAnnouncementIds,
  fetchPendingApplicationCounts,
  fetchRejectedAnnouncementIds,
  type AnnouncementWithDriver,
} from '@/hooks/use-announcements';
import { applyRadiusFilter, useRadiusFilter } from '@/hooks/use-radius-filter';
import { useViewedAnnouncements } from '@/hooks/use-viewed-announcements';
import { distanceKm } from '@/lib/location';
import { dismissNotificationsOfType } from '@/lib/push';
import { matchesSearch } from '@/lib/search';

const VIEW_MODE_KEY = 'mechanic_feed_view_mode';
type ViewMode = 'compact' | 'extended';
/** `nolocation` (10 sept): pastila „Fără locație" stă în același rând cu cele de status
 * (decizie user) — toate statusurile, dar doar anunțurile fără coordonate. */
type StatusFilter = 'all' | 'active' | 'accepted' | 'resolved' | 'nolocation';

function hasLocation(a: { latitude: number | null; longitude: number | null }): boolean {
  return a.latitude != null && a.longitude != null;
}

export default function MechanicFeedScreen() {
  // Tab-ul de start al mecanicului: back-ul de aici întreabă dacă închide aplicația.
  useExitConfirm();
  const { profile, session } = useAuth();
  const { t } = useTranslation();
  const theme = useTheme();
  const scheme = useResolvedScheme();
  const insets = useSafeAreaInsets();
  // Feedul altora (doar `open`; propriile se exclud — vin separat, cu toate statusurile).
  const { announcements, loading, refresh } = useOpenAnnouncements(session?.user.id);
  // Anunțurile PROPRII (decizie 5 aug, rev. 2): fără pagină separată — stau în capul
  // listei, iar „+" postează direct de aici, exact ca la transportatori.
  const { announcements: myAnnouncements, refresh: refreshMine } = useMyAnnouncements();
  const [applicantCounts, setApplicantCounts] = useState<Record<string, number>>({});
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  // Harta poate preseta „Fără locație" (10 sept): tap pe bula „N anunțuri fără
  // locație" navighează aici cu ?location=without — `nonce` diferă la fiecare tap,
  // altfel al doilea tap (după ce userul a schimbat manual filtrul) n-ar mai
  // re-declanșa efectul.
  const { location: locationParam, nonce: locationNonce } = useLocalSearchParams<{
    location?: string;
    nonce?: string;
  }>();
  useEffect(() => {
    if (locationParam === 'without') setStatusFilter('nolocation');
  }, [locationParam, locationNonce]);
  const router = useRouter();
  const [viewMode, setViewMode] = useState<ViewMode>('extended');
  const [rejectedIds, setRejectedIds] = useState<Set<string>>(new Set());
  // 26 iul: anunțurile cu candidatura mea în așteptare → badge „În așteptare".
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
  const { viewed, refresh: refreshViewed } = useViewedAnnouncements(session?.user.id);
  const { radiusKm, coords, locationError, refreshCoords } = useRadiusFilter();

  // Filtrul e „aplicat" doar cu rază ȘI poziție — fără poziție, lista rămâne completă.
  const filterActive = radiusKm != null && coords != null;
  const filtered = useMemo(
    () => applyRadiusFilter(announcements, radiusKm, coords),
    [announcements, radiusKm, coords]
  );

  // Lista finală: PROPRIILE anunțuri primele (scutite de filtrul de rază — sunt de
  // gestionat, nu de găsit), apoi feedul altora. Chips-urile de status se aplică
  // peste tot: ale altora sunt mereu `open`, deci apar doar la Toate/Active;
  // Acceptate/Rezolvate rămân practic vederile propriilor anunțuri.
  // „Fără locație" = ca „Toate", dar doar anunțurile fără coordonate (ale mele + ale
  // altora). Cele fără coordonate trec oricum de filtrul de rază (applyRadiusFilter
  // le păstrează), deci pastila arată exact anunțurile care lipsesc de pe hartă.
  const merged = useMemo<AnnouncementWithDriver[]>(() => {
    const noLocationOnly = statusFilter === 'nolocation';
    const mineFiltered = myAnnouncements.filter((a) => {
      if (statusFilter === 'active') return a.status === 'open';
      if (statusFilter === 'accepted') return a.status === 'accepted';
      if (statusFilter === 'resolved') return a.status === 'resolved';
      return true;
    });
    const mineWithDriver = mineFiltered.map((a) => ({ ...a, driver: null }));
    const others =
      statusFilter === 'all' || statusFilter === 'active' || noLocationOnly ? filtered : [];
    const all = [...mineWithDriver, ...others];
    return noLocationOnly ? all.filter((a) => !hasLocation(a)) : all;
  }, [myAnnouncements, statusFilter, filtered]);

  // Căutarea filtrează local peste lista deja filtrată de rază (toate anunțurile
  // deschise sunt oricum în memorie) — instant, fără query-uri suplimentare.
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchActive = searchOpen && query.trim().length > 0;
  const visible = useMemo(() => {
    if (!searchActive) return merged;
    return merged.filter((a) =>
      matchesSearch(query, [
        a.driver?.full_name,
        a.location,
        a.description,
        a.truck_make,
        a.truck_model,
        a.plate_number,
      ])
    );
  }, [merged, searchActive, query]);

  function toggleSearch() {
    setSearchOpen((prev) => {
      if (prev) setQuery('');
      return !prev;
    });
  }

  useEffect(() => {
    AsyncStorage.getItem(VIEW_MODE_KEY).then((stored) => {
      if (stored === 'compact' || stored === 'extended') setViewMode(stored);
    });
  }, []);

  function toggleViewMode() {
    setViewMode((prev) => {
      const next: ViewMode = prev === 'extended' ? 'compact' : 'extended';
      AsyncStorage.setItem(VIEW_MODE_KEY, next);
      return next;
    });
  }

  useFocusEffect(
    useCallback(() => {
      refresh();
      refreshMine();
      // Feed-ul e în față → push-urile „anunț nou în zona ta" (`type: 'feed'`) dispar din
      // bara de notificări (6 oct; ca pe Market și ca celulele de chat la citire).
      void dismissNotificationsOfType('feed');
      // La întoarcerea din detaliu, anunțul tocmai deschis nu mai e „Nou".
      refreshViewed();
      // Poziția pentru filtrul de rază — throttle intern, nu interoghează GPS-ul mereu.
      refreshCoords();
      if (session?.user.id) {
        fetchRejectedAnnouncementIds(session.user.id).then(setRejectedIds);
        fetchPendingApplicationAnnouncementIds(session.user.id).then(setAppliedIds);
      }
    }, [refresh, refreshMine, refreshViewed, refreshCoords, session?.user.id])
  );

  // Ofertele în așteptare la anunțurile PROPRII (bulina de pe card, ca la șofer).
  useEffect(() => {
    const openIds = myAnnouncements.filter((a) => a.status === 'open').map((a) => a.id);
    fetchPendingApplicationCounts(openIds).then(setApplicantCounts);
  }, [myAnnouncements]);

  // Pull-to-refresh separat de load-ul programatic: pe iOS, `refreshing=true` setat
  // programatic (la fiecare focus) inserează insetul spinner-ului, care uneori rămâne
  // blocat → spațiu gol scrollabil sub antet (confirmat pe iPhone cu screenshot).
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const onPullRefresh = useCallback(async () => {
    setPullRefreshing(true);
    await Promise.all([refresh(), refreshMine()]);
    setPullRefreshing(false);
  }, [refresh, refreshMine]);

  return (
    <ThemedView style={styles.container}>
      {/* În antet rămâne doar filtrul de rază — comutatorul de aspect s-a mutat
          deasupra cardurilor (antetul era prea înghesuit, feedback pe device). */}
      <ScreenHeader
        title={t('mechanic.feed.title')}
        subtitle={profile?.full_name}
        right={<RadiusFilterMenu />}
        profileButton
      />

      {/* Filtrele de status (5 aug, rev. 2 — fără pagină separată „Ale mele"):
          aceleași 4 chips ca la transportatori; ale altora sunt mereu `open`,
          deci Acceptate/Rezolvate arată propriile anunțuri. + „Fără locație"
          (10 sept, aceeași iconiță ca pe hartă) — în același rând, decizie user. */}
      <FilterChips
        options={[
          { key: 'all', label: t('driver.announcements.filterAll') },
          { key: 'active', label: t('driver.announcements.filterActive') },
          { key: 'accepted', label: t('driver.announcements.filterAccepted') },
          { key: 'resolved', label: t('driver.announcements.filterResolved') },
          { key: 'nolocation', label: t('mechanic.feed.locationWithout'), icon: 'location-off' },
        ]}
        value={statusFilter}
        onChange={setStatusFilter}
      />

      {/* Raza e setată, dar n-avem poziția (permisiune refuzată / GPS indisponibil):
          spunem de ce lista e nefiltrată, fără să blocăm nimic. */}
      {radiusKm != null && coords == null && locationError != null ? (
        <ThemedView type="backgroundElement" style={styles.locationBanner}>
          <MaterialIcons name="location-off" size={14} color={theme.textSecondary} />
          <ThemedText themeColor="textSecondary" type="small" style={styles.locationBannerText}>
            {t(
              locationError === 'denied'
                ? 'radiusFilter.locationDenied'
                : 'radiusFilter.locationUnavailable'
            )}
          </ThemedText>
        </ThemedView>
      ) : null}

      {/* Lupa stă în stânga, pe același rând cu comutatorul de aspect (dreapta). */}
      <View style={styles.listToolbar}>
        <Pressable onPress={toggleSearch} hitSlop={12} accessibilityLabel={t('mechanic.feed.searchToggle')}>
          <MaterialIcons
            name="search"
            size={22}
            color={searchOpen ? theme.brand : theme.textSecondary}
          />
        </Pressable>
        <Pressable onPress={toggleViewMode} hitSlop={12} accessibilityLabel={t('mechanic.feed.toggleView')}>
          <MaterialIcons
            name={viewMode === 'extended' ? 'view-list' : 'view-agenda'}
            size={22}
            color={theme.textSecondary}
          />
        </Pressable>
      </View>

      {searchOpen ? (
        <View style={styles.searchRow}>
          <View style={styles.searchInput}>
            <Input
              value={query}
              onChangeText={setQuery}
              placeholder={t('mechanic.feed.searchPlaceholder')}
              autoFocus
              returnKeyType="search"
              autoCorrect={false}
            />
          </View>
          <Pressable onPress={toggleSearch} hitSlop={12} accessibilityLabel={t('mechanic.feed.searchClose')}>
            <MaterialIcons name="close" size={22} color={theme.textSecondary} />
          </Pressable>
        </View>
      ) : null}

      <FlatList
        data={visible}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={viewMode === 'compact' ? styles.separatorCompact : styles.separator} />}
        refreshing={pullRefreshing}
        onRefresh={onPullRefresh}
        renderItem={({ item }) => {
          // Propriul anunț: fără nume de autor / distanță / „Nou" — în schimb are
          // bulina de oferte și duce la detaliul de PROPRIETAR, nu la cel de ofertant.
          const isMine = item.driver_id === session?.user.id;
          return (
            <AnnouncementCard
              announcement={item}
              driverName={isMine ? undefined : item.driver?.full_name}
              applicantCount={isMine ? (applicantCounts[item.id] ?? 0) : undefined}
              compact={viewMode === 'compact'}
              rejectedByUser={!isMine && rejectedIds.has(item.id)}
              appliedByUser={!isMine && appliedIds.has(item.id)}
              isNew={!isMine && !viewed.has(item.id)}
              distanceKm={
                isMine || !filterActive
                  ? undefined
                  : item.latitude == null || item.longitude == null
                    ? null
                    : distanceKm(coords.latitude, coords.longitude, item.latitude, item.longitude)
              }
              onPress={() =>
                router.push({
                  pathname: (isMine ? '/(mechanic)/feed/mine/[id]' : '/(mechanic)/feed/[id]') as never,
                  params: { id: item.id },
                })
              }
            />
          );
        }}
        ListEmptyComponent={
          !loading ? (
            searchActive ? (
              // Căutarea n-a găsit nimic — mesaj dedicat, înaintea celui de rază.
              <EmptyState
                icon="search-off"
                title={t('mechanic.feed.searchEmptyTitle')}
                description={t('mechanic.feed.searchEmptyDescription')}
              />
            ) : statusFilter === 'nolocation' ? (
              // „Fără locație" n-a lăsat nimic — mesaj dedicat, cu iconița pastilei.
              <EmptyState
                icon="location-off"
                title={t('mechanic.feed.locationEmptyWithout')}
                description={t('mechanic.feed.locationEmptyDescription')}
              />
            ) : announcements.length > 0 && radiusKm != null ? (
              // Filtrul a ascuns tot — altă cauză decât „nu există anunțuri".
              <EmptyState
                icon="filter-alt"
                title={t('radiusFilter.emptyFilteredTitle', { km: radiusKm })}
                description={t('radiusFilter.emptyFilteredDescription')}
              />
            ) : (
              <EmptyState
                icon="directions-car"
                title={t('mechanic.feed.emptyTitle')}
                description={t('mechanic.feed.emptyDescription')}
              />
            )
          ) : null
        }
      />

      {/* FAB de postare direct pe feed (5 aug, rev. 2) — identic cu al șoferului. */}
      <Pressable
        style={({ pressed }) => [
          styles.fab,
          { bottom: insets.bottom + Spacing.three },
          pressed && styles.fabPressed,
        ]}
        onPress={() => router.push('/(mechanic)/feed/mine/new' as never)}>
        <LinearGradient
          colors={HeaderGradient[scheme]}
          start={HeaderGradientDirection.start}
          end={HeaderGradientDirection.end}
          style={styles.fabGradient}>
          <MaterialIcons name="add" size={30} color="#fff" />
        </LinearGradient>
      </Pressable>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: {
    flexGrow: 1,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.four,
  },
  separator: { height: Spacing.two },
  separatorCompact: { height: Spacing.one },
  listToolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
  },
  searchInput: { flex: 1 },
  locationBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.four,
    marginTop: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  locationBannerText: { flex: 1 },
  // FAB squircle 58×58 cu gradientul principal — copiat 1:1 din lista șoferului.
  fab: {
    position: 'absolute',
    right: 18,
    width: 58,
    height: 58,
    borderRadius: Radius.fab,
    ...Shadows.fab,
  },
  fabPressed: { opacity: 0.85 },
  fabGradient: {
    flex: 1,
    borderRadius: Radius.fab,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
