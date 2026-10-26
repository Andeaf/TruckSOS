import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { AnnouncementCard } from '@/components/announcement-card';
import { AnnouncementDraftBanner } from '@/components/announcement-draft-banner';
import { EmptyState } from '@/components/empty-state';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedView } from '@/components/themed-view';
import {
  HeaderGradient,
  HeaderGradientDirection,
  Radius,
  Shadows,
  Spacing,
} from '@/constants/theme';
import { useAccountGate } from '@/hooks/use-account-gate';
import { useAuth } from '@/hooks/use-auth';
import { useGuestOpenAnnouncements } from '@/hooks/use-guest-data';
import { useResolvedScheme } from '@/hooks/use-settings';

/**
 * 1.1 (B3): lista anunțurilor deschise pentru OASPEȚI. Ecran separat (nu
 * `announcements-list-screen`, care e „Anunțurile mele” ale șoferului, cu selecție,
 * anulare și caseta „rezolvat?”) — refolosește doar `AnnouncementCard`.
 * Fără Realtime: reîncărcare la focus și pull-to-refresh.
 */
export function GuestAnnouncementsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const scheme = useResolvedScheme();
  const insets = useSafeAreaInsets();
  const { hasDraft } = useAuth();
  const { requireAccount } = useAccountGate();
  const { announcements, loading, error, refresh } = useGuestOpenAnnouncements();

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const [pullRefreshing, setPullRefreshing] = useState(false);
  const onPullRefresh = useCallback(async () => {
    setPullRefreshing(true);
    await refresh();
    setPullRefreshing(false);
  }, [refresh]);

  const openNew = () => router.push('/(guest)/announcements/new' as never);

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader
        title={t('guest.announcements.title')}
        subtitle={t('guest.announcements.subtitle')}
        profileButton
      />

      {hasDraft ? <AnnouncementDraftBanner onPress={openNew} discardable /> : null}

      <FlatList
        data={announcements}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        refreshing={pullRefreshing}
        onRefresh={onPullRefresh}
        renderItem={({ item }) => (
          <AnnouncementCard
            announcement={item}
            driverName={item.driver?.full_name}
            // 25 oct 2026: detaliile anunțului se văd doar cu cont; după cont revine pe el.
            onPress={() => requireAccount('viewAnnouncement', `/(guest)/announcements/${item.id}`)}
          />
        )}
        ListEmptyComponent={
          loading ? null : error && announcements.length === 0 ? (
            <EmptyState
              icon="cloud-off"
              title={t('guest.loadErrorTitle')}
              description={t('guest.loadErrorDescription')}
            />
          ) : (
            <EmptyState
              icon="list-alt"
              title={t('guest.announcements.emptyTitle')}
              description={t('guest.announcements.emptyDescription')}
            />
          )
        }
      />

      <Pressable
        style={({ pressed }) => [
          styles.fab,
          { bottom: insets.bottom + Spacing.three },
          pressed && styles.fabPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={t('guest.announcements.newButton')}
        onPress={openNew}>
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
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: Spacing.six + Spacing.four,
  },
  separator: { height: 12 },
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
