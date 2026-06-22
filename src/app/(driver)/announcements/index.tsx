import { useCallback } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { AnnouncementCard } from '@/components/announcement-card';
import { EmptyState } from '@/components/empty-state';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useMyAnnouncements } from '@/hooks/use-announcements';

export default function DriverAnnouncementsScreen() {
  const { profile, signOut } = useAuth();
  const { t } = useTranslation();
  const { announcements, loading, refresh } = useMyAnnouncements();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View>
          <ThemedText type="subtitle">{t('driver.announcements.listTitle')}</ThemedText>
          <ThemedText themeColor="textSecondary" type="small">
            {profile?.full_name}
          </ThemedText>
        </View>
        <Pressable onPress={signOut} hitSlop={12}>
          <MaterialIcons name="logout" size={22} color="#60646C" />
        </Pressable>
      </View>

      <FlatList
        data={announcements}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        refreshing={loading}
        onRefresh={refresh}
        renderItem={({ item }) => (
          <AnnouncementCard
            announcement={item}
            onPress={() =>
              router.push({
                pathname: '/(driver)/announcements/[id]',
                params: { id: item.id },
              })
            }
          />
        )}
        ListEmptyComponent={
          !loading ? (
            <EmptyState
              icon="list-alt"
              title={t('driver.announcements.emptyTitle')}
              description={t('driver.announcements.emptyDescription')}
            />
          ) : null
        }
      />

      <Pressable
        style={[styles.fab, { bottom: insets.bottom + Spacing.three }]}
        onPress={() => router.push('/(driver)/announcements/new')}>
        <MaterialIcons name="add" size={28} color="#fff" />
      </Pressable>
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
  list: {
    flexGrow: 1,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.six + Spacing.four,
  },
  separator: { height: Spacing.two },
  fab: {
    position: 'absolute',
    right: Spacing.four,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#208AEF',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
});
