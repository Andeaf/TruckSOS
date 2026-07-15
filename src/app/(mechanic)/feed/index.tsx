import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { AnnouncementCard } from '@/components/announcement-card';
import { EmptyState } from '@/components/empty-state';
import { RadiusFilterMenu } from '@/components/radius-filter-menu';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { useOpenAnnouncements, fetchRejectedAnnouncementIds } from '@/hooks/use-announcements';
import { applyRadiusFilter, useRadiusFilter } from '@/hooks/use-radius-filter';
import { useViewedAnnouncements } from '@/hooks/use-viewed-announcements';
import { distanceKm } from '@/lib/location';

const VIEW_MODE_KEY = 'mechanic_feed_view_mode';
type ViewMode = 'compact' | 'extended';

export default function MechanicFeedScreen() {
  const { profile, session } = useAuth();
  const { t } = useTranslation();
  const theme = useTheme();
  const { announcements, loading, refresh } = useOpenAnnouncements();
  const router = useRouter();
  const [viewMode, setViewMode] = useState<ViewMode>('extended');
  const [rejectedIds, setRejectedIds] = useState<Set<string>>(new Set());
  const { viewed, refresh: refreshViewed } = useViewedAnnouncements(session?.user.id);
  const { radiusKm, coords, locationError, refreshCoords } = useRadiusFilter();

  // Filtrul e „aplicat" doar cu rază ȘI poziție — fără poziție, lista rămâne completă.
  const filterActive = radiusKm != null && coords != null;
  const filtered = useMemo(
    () => applyRadiusFilter(announcements, radiusKm, coords),
    [announcements, radiusKm, coords]
  );

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
      // La întoarcerea din detaliu, anunțul tocmai deschis nu mai e „Nou".
      refreshViewed();
      // Poziția pentru filtrul de rază — throttle intern, nu interoghează GPS-ul mereu.
      refreshCoords();
      if (session?.user.id) {
        fetchRejectedAnnouncementIds(session.user.id).then(setRejectedIds);
      }
    }, [refresh, refreshViewed, refreshCoords, session?.user.id])
  );

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader
        title={t('mechanic.feed.title')}
        subtitle={profile?.full_name}
        right={
          <View style={styles.headerActions}>
            <RadiusFilterMenu />
            <Pressable onPress={toggleViewMode} hitSlop={12} accessibilityLabel={t('mechanic.feed.toggleView')}>
              <MaterialIcons
                name={viewMode === 'extended' ? 'view-list' : 'view-agenda'}
                size={22}
                color={theme.onHeader}
              />
            </Pressable>
          </View>
        }
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

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={viewMode === 'compact' ? styles.separatorCompact : styles.separator} />}
        refreshing={loading}
        onRefresh={refresh}
        renderItem={({ item }) => (
          <AnnouncementCard
            announcement={item}
            driverName={item.driver?.full_name}
            compact={viewMode === 'compact'}
            rejectedByUser={rejectedIds.has(item.id)}
            isNew={!viewed.has(item.id)}
            distanceKm={
              !filterActive
                ? undefined
                : item.latitude == null || item.longitude == null
                  ? null
                  : distanceKm(coords.latitude, coords.longitude, item.latitude, item.longitude)
            }
            onPress={() =>
              router.push({
                pathname: '/(mechanic)/feed/[id]',
                params: { id: item.id },
              })
            }
          />
        )}
        ListEmptyComponent={
          !loading ? (
            announcements.length > 0 && radiusKm != null ? (
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
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: {
    flexGrow: 1,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.four,
  },
  separator: { height: Spacing.two },
  separatorCompact: { height: Spacing.one },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
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
});
