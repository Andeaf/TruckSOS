import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { ApplyBottomSheet } from '@/components/apply-bottom-sheet';
import { EmptyState } from '@/components/empty-state';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useMyApplications, withdrawApplication, dismissApplication, resubmitApplication, type ApplicationWithDetails } from '@/hooks/use-announcements';
import { useTimeAgo } from '@/hooks/use-time-ago';
import type { ApplicationStatus, PriceType } from '@/types/database';

const STATUS_COLORS: Record<ApplicationStatus, { color: string; bg: string }> = {
  pending:  { color: '#f59e0b', bg: '#f59e0b1A' },
  accepted: { color: '#22c55e', bg: '#22c55e1A' },
  rejected: { color: '#ef4444', bg: '#ef44441A' },
};

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
  onPress,
  onChatPress,
  onWithdraw,
  onDismiss,
  onResubmit,
}: {
  item: ApplicationWithDetails;
  onPress: () => void;
  onChatPress: (conversationId: string) => void;
  onWithdraw: (id: string) => void;
  onDismiss: (id: string) => void;
  onResubmit: (item: ApplicationWithDetails) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const timeAgo = useTimeAgo();
  const { announcement } = item;
  if (!announcement) return null;
  const conversationId = announcement.conversations?.[0]?.id ?? null;
  const isResubmittable = item.status === 'rejected' && announcement.status === 'open';
  const isDismissable = !isResubmittable && (item.status === 'rejected' || announcement.status === 'cancelled');

  const truckLine =
    announcement.truck_make || announcement.truck_model
      ? [announcement.truck_make, announcement.truck_model, announcement.truck_year]
          .filter(Boolean)
          .join(' ')
      : null;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView type="backgroundElement" style={styles.card}>
        <View style={styles.cardHeader}>
          <ThemedText type="smallBold" numberOfLines={1} style={styles.driverName}>
            {announcement.driver?.full_name ?? t('common.defaultUser')}
          </ThemedText>
          <View style={styles.headerRight}>
            <ApplicationStatusBadge status={item.status} />
            {isDismissable ? (
              <Pressable onPress={() => onDismiss(item.id)} hitSlop={8}>
                <MaterialIcons name="close" size={18} color={theme.textSecondary} />
              </Pressable>
            ) : null}
          </View>
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
            &quot;{item.message}&quot;
          </ThemedText>
        ) : null}

        <View style={styles.cardFooter}>
          <View style={styles.footerLeft}>
            {item.status === 'accepted' && conversationId ? (
              <Pressable
                onPress={() => onChatPress(conversationId)}
                style={({ pressed }) => [styles.chatButton, pressed && styles.pressed]}>
                <MaterialIcons name="chat" size={14} color="#22c55e" />
                <Text style={styles.chatButtonText}>{t('mechanic.applications.goToChat')}</Text>
              </Pressable>
            ) : null}
            {item.status === 'pending' ? (
              <Pressable
                onPress={() => onWithdraw(item.id)}
                style={({ pressed }) => [styles.withdrawButton, pressed && styles.pressed]}>
                <Text style={styles.withdrawButtonText}>{t('mechanic.applications.withdrawButton')}</Text>
              </Pressable>
            ) : null}
            {isResubmittable ? (
              <Pressable
                onPress={() => onResubmit(item)}
                style={({ pressed }) => [styles.resubmitButton, pressed && styles.pressed]}>
                <Text style={styles.resubmitButtonText}>{t('mechanic.apply.resubmitSheetTitle')}</Text>
              </Pressable>
            ) : null}
          </View>
          <ThemedText themeColor="textSecondary" type="small" numberOfLines={1} style={styles.time}>
            {timeAgo(item.created_at)}
          </ThemedText>
        </View>
      </ThemedView>
    </Pressable>
  );
}

export default function ApplicationsScreen() {
  const { t } = useTranslation();
  const { applications, loading, refresh } = useMyApplications();
  const router = useRouter();
  const [sheetVisible, setSheetVisible] = useState(false);
  const [sheetItem, setSheetItem] = useState<ApplicationWithDetails | null>(null);

  function handleResubmit(item: ApplicationWithDetails) {
    setSheetItem(item);
    setSheetVisible(true);
  }

  const handleWithdraw = useCallback((id: string) => {
    Alert.alert(
      t('mechanic.applications.withdrawConfirmTitle'),
      t('mechanic.applications.withdrawConfirmMessage'),
      [
        { text: t('driver.announcements.cancelConfirmCancel'), style: 'cancel' },
        {
          text: t('mechanic.applications.withdrawConfirmOk'),
          style: 'destructive',
          onPress: async () => {
            await withdrawApplication(id);
            refresh();
          },
        },
      ]
    );
  }, [t, refresh]);

  const handleDismiss = useCallback((id: string) => {
    Alert.alert(
      t('mechanic.applications.dismissConfirmTitle'),
      undefined,
      [
        { text: t('driver.announcements.cancelConfirmCancel'), style: 'cancel' },
        {
          text: t('mechanic.applications.dismissConfirmOk'),
          style: 'destructive',
          onPress: async () => {
            const err = await dismissApplication(id);
            if (err) {
              Alert.alert(t('common.error'), err);
            } else {
              refresh();
            }
          },
        },
      ]
    );
  }, [t, refresh]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t('mechanic.applications.title')} />

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
            onPress={() =>
              router.push({
                pathname: '/(mechanic)/applications/[id]' as never,
                params: { id: item.id },
              })
            }
            onChatPress={(conversationId) =>
              router.push({
                pathname: '/(mechanic)/conversations/[id]' as never,
                params: { id: conversationId },
              })
            }
            onWithdraw={handleWithdraw}
            onDismiss={handleDismiss}
            onResubmit={handleResubmit}
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

      <ApplyBottomSheet
        visible={sheetVisible}
        announcementId={sheetItem?.announcement.id ?? ''}
        onClose={() => { setSheetVisible(false); setSheetItem(null); }}
        onSuccess={() => { setSheetVisible(false); setSheetItem(null); refresh(); }}
        applicationId={sheetItem?.id}
        initialData={sheetItem ? {
          priceType: sheetItem.price_type,
          priceAmount: sheetItem.price_amount,
          currency: sheetItem.currency,
          message: sheetItem.message || '',
        } : undefined}
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
  card: {
    borderRadius: Radius.card,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.two,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexShrink: 0 },
  driverName: { flex: 1 },
  footerLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexShrink: 1 },
  time: { flexShrink: 0 },
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
    borderRadius: Radius.badge,
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
    borderRadius: Radius.control,
    backgroundColor: '#22c55e1A',
  },
  chatButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#22c55e',
  },
  withdrawButton: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.control,
    backgroundColor: '#ef44441A',
  },
  withdrawButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ef4444',
  },
  resubmitButton: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.control,
    backgroundColor: '#22c55e1A',
    borderWidth: 1,
    borderColor: '#22c55e',
  },
  resubmitButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#22c55e',
  },
  pressed: { opacity: 0.7 },
});
