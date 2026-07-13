import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { AnnouncementCard } from '@/components/announcement-card';
import { EmptyState } from '@/components/empty-state';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { useOpenAnnouncements, fetchRejectedAnnouncementIds } from '@/hooks/use-announcements';
import { useViewedAnnouncements } from '@/hooks/use-viewed-announcements';

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
      if (session?.user.id) {
        fetchRejectedAnnouncementIds(session.user.id).then(setRejectedIds);
      }
    }, [refresh, refreshViewed, session?.user.id])
  );

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader
        title={t('mechanic.feed.title')}
        subtitle={profile?.full_name}
        right={
          <Pressable onPress={toggleViewMode} hitSlop={12} accessibilityLabel={t('mechanic.feed.toggleView')}>
            <MaterialIcons
              name={viewMode === 'extended' ? 'view-list' : 'view-agenda'}
              size={22}
              color={theme.onHeader}
            />
          </Pressable>
        }
      />

      <FlatList
        data={announcements}
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
            <EmptyState
              icon="directions-car"
              title={t('mechanic.feed.emptyTitle')}
              description={t('mechanic.feed.emptyDescription')}
            />
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
});
