import { useCallback } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/empty-state';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useMyApplications, type ApplicationWithDetails } from '@/hooks/use-announcements';
import type { ApplicationStatus, PriceType } from '@/types/database';

const STATUS_COLORS: Record<ApplicationStatus, { color: string; bg: string }> = {
  pending:  { color: '#f59e0b', bg: '#f59e0b1A' },
  accepted: { color: '#22c55e', bg: '#22c55e1A' },
  rejected: { color: '#6b7280', bg: '#6b72801A' },
};

function useTimeAgo() {
  const { t } = useTranslation();
  return (dateStr: string): string => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t('common.timeNow');
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}z`;
  };
}

function ApplicationStatusBadge({ status }: { status: ApplicationStatus }) {
  const { t } = useTranslation();
  const { color, bg } = STATUS_COLORS[status];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeLabel, { color }]}>
        {t(`mechanic.applications.status_${status}`)}
      </Text>
    </View>
  );
}

function priceLabel(priceType: PriceType, amount: number, currency: string, t: (k: string) => string) {
  const typeLabel =
    priceType === 'fixed'
      ? t('mechanic.apply.priceTypeFixed')
      : t('mechanic.apply.priceTypeHourly');
  return `${amount} ${currency} · ${typeLabel}`;
}

function ApplicationCard({
  item,
  onChatPress,
}: {
  item: ApplicationWithDetails;
  onChatPress: (conversationId: string) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const timeAgo = useTimeAgo();
  const { announcement } = item;
  if (!announcement) return null;
  const conversationId = announcement.conversations?.[0]?.id ?? null;

  const truckLine =
    announcement.truck_make || announcement.truck_model
      ? [announcement.truck_make, announcement.truck_model, announcement.truck_year]
          .filter(Boolean)
          .join(' ')
      : null;

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.cardHeader}>
        <ThemedText type="smallBold" numberOfLines={1} style={styles.driverName}>
          {announcement.driver?.full_name ?? t('common.defaultUser')}
        </ThemedText>
        <ThemedText themeColor="textSecondary" type="small">
          {timeAgo(item.created_at)}
        </ThemedText>
      </View>

      <View style={styles.locationRow}>
        <MaterialIcons name="location-on" size={12} color={theme.textSecondary} />
        <ThemedText themeColor="textSecondary" type="small" numberOfLines={1} style={styles.locationText}>
          {announcement.location}
        </ThemedText>
      </View>

      {truckLine ? (
        <View style={styles.truckRow}>
          <MaterialIcons name="local-shipping" size={12} color={theme.textSecondary} />
          <ThemedText themeColor="textSecondary" type="small" numberOfLines={1} style={styles.locationText}>
            {truckLine}
          </ThemedText>
        </View>
      ) : null}

      <ThemedText type="smallBold" style={styles.price}>
        {priceLabel(item.price_type, item.price_amount, item.currency, t)}
      </ThemedText>

      {item.message ? (
        <ThemedText themeColor="textSecondary" type="small" numberOfLines={2} style={styles.message}>
          "{item.message}"
        </ThemedText>
      ) : null}

      <View style={styles.cardFooter}>
        <ApplicationStatusBadge status={item.status} />
        {item.status === 'accepted' && conversationId ? (
          <Pressable
            onPress={() => onChatPress(conversationId)}
            style={({ pressed }) => [styles.chatButton, pressed && styles.pressed]}>
            <MaterialIcons name="chat" size={14} color="#22c55e" />
            <Text style={styles.chatButtonText}>{t('mechanic.applications.goToChat')}</Text>
          </Pressable>
        ) : null}
      </View>
    </ThemedView>
  );
}

export default function ApplicationsScreen() {
  const { t } = useTranslation();
  const { applications, loading, refresh } = useMyApplications();
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
        <ThemedText type="subtitle">{t('mechanic.applications.title')}</ThemedText>
      </View>

      <FlatList
        data={applications}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        refreshing={loading}
        onRefresh={refresh}
        renderItem={({ item }) => (
          <ApplicationCard
            item={item}
            onChatPress={(conversationId) =>
              router.push({
                pathname: '/(mechanic)/conversations/[id]' as never,
                params: { id: conversationId },
              })
            }
          />
        )}
        ListEmptyComponent={
          !loading ? (
            <EmptyState
              icon="assignment"
              title={t('mechanic.applications.emptyTitle')}
              description={t('mechanic.applications.emptyDescription')}
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
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  list: {
    flexGrow: 1,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
  },
  separator: { height: Spacing.two },
  card: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.two,
  },
  driverName: { flex: 1 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  truckRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  locationText: { flex: 1 },
  price: { color: '#22c55e' },
  message: { fontStyle: 'italic' },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  badgeLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  chatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: '#22c55e1A',
  },
  chatButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#22c55e',
  },
  pressed: { opacity: 0.7 },
});
