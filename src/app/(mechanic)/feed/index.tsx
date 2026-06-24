import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { AnnouncementCard } from '@/components/announcement-card';
import { EmptyState } from '@/components/empty-state';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { useOpenAnnouncements } from '@/hooks/use-announcements';

const VIEW_MODE_KEY = 'mechanic_feed_view_mode';
type ViewMode = 'compact' | 'extended';

export default function MechanicFeedScreen() {
  const { profile, signOut } = useAuth();
  const { t } = useTranslation();
  const theme = useTheme();
  const { announcements, loading, refresh } = useOpenAnnouncements();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [viewMode, setViewMode] = useState<ViewMode>('extended');

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
    }, [refresh])
  );

  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View>
          <ThemedText type="subtitle">{t('mechanic.feed.title')}</ThemedText>
          <ThemedText themeColor="textSecondary" type="small">
            {profile?.full_name}
          </ThemedText>
        </View>
        <View style={styles.headerActions}>
          <Pressable onPress={toggleViewMode} hitSlop={12} accessibilityLabel={t('mechanic.feed.toggleView')}>
            <MaterialIcons
              name={viewMode === 'extended' ? 'view-list' : 'view-agenda'}
              size={22}
              color={theme.textSecondary}
            />
          </Pressable>
          <Pressable onPress={signOut} hitSlop={12}>
            <MaterialIcons name="logout" size={22} color={theme.textSecondary} />
          </Pressable>
        </View>
      </View>

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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  list: {
    flexGrow: 1,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
  },
  separator: { height: Spacing.two },
  separatorCompact: { height: Spacing.one },
});
