import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useBack } from '@/hooks/use-back';
import { useModerationNotices } from '@/hooks/use-moderation-notices';
import { useTheme } from '@/hooks/use-theme';
import type { ModerationNoticeKind } from '@/types/database-overrides';

/**
 * „Notificări de moderare" din Setări (PLAN_1.1_FIX 7.9; DSA art. 17), comun ambelor roluri
 * prin rute subțiri. Doar citire: țintele sunt șterse, deci rândurile nu navighează nicăieri.
 * La prima încărcare, necititele se marchează citite o singură dată; punctul rămâne pe ele
 * cât timp ecranul e deschis, ca utilizatorul să vadă ce e nou.
 */

const LOCALE_MAP: Record<string, string> = { ro: 'ro-RO', en: 'en-GB', de: 'de-DE' };

const KIND_ICON: Record<ModerationNoticeKind, ComponentProps<typeof MaterialIcons>['name']> = {
  message_deleted: 'chat-bubble-outline',
  announcement_deleted: 'campaign',
  listing_deleted: 'storefront',
  review_deleted: 'star-outline',
  banned: 'block',
};

export function ModerationNoticesScreen({ backPath }: { backPath: string }) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const goBack = useBack(backPath);
  const { rows, loading, refresh, markAllRead } = useModerationNotices();
  const [refreshing, setRefreshing] = useState(false);
  // Necititele de la prima încărcare: markAllRead le stinge imediat în stare, dar punctul
  // trebuie să rămână vizibil pe ecranul pe care tocmai au fost citite.
  const [freshIds, setFreshIds] = useState<ReadonlySet<string>>(() => new Set());
  const marked = useRef(false);

  useEffect(() => {
    if (loading || marked.current) return;
    marked.current = true;
    const unread = rows.filter((r) => r.read_at == null).map((r) => r.id);
    if (unread.length === 0) return;
    setFreshIds(new Set(unread));
    void markAllRead(unread);
  }, [loading, rows, markAllRead]);

  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  function formatDateTime(dateStr: string): string {
    return new Date(dateStr).toLocaleString(LOCALE_MAP[i18n.language] ?? 'ro-RO', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t('moderation.title')} onBack={goBack} />

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.brand} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          contentContainerStyle={rows.length === 0 ? styles.emptyList : styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onPullRefresh}
              tintColor={theme.brand}
              colors={[theme.brand]}
            />
          }
          ListEmptyComponent={
            <View style={styles.centered}>
              <MaterialIcons name="gavel" size={48} color={theme.textSecondary} />
              <ThemedText themeColor="textSecondary" type="small" style={styles.emptyText}>
                {t('moderation.empty')}
              </ThemedText>
            </View>
          }
          renderItem={({ item }) => {
            const unread = item.read_at == null || freshIds.has(item.id);
            return (
              <ThemedView
                type="backgroundElement"
                style={styles.row}
                accessibilityLabel={unread ? t('moderation.unread') : undefined}
              >
                <MaterialIcons
                  name={KIND_ICON[item.kind] ?? 'gavel'}
                  size={24}
                  color={theme.textSecondary}
                />
                <View style={styles.rowInfo}>
                  {/* Un `kind` nou de pe un server mai nou decât clientul: titlul generic, nu cheia brută. */}
                  <ThemedText type="smallBold">
                    {t(`moderation.kind.${item.kind}`, { defaultValue: t('moderation.title') })}
                  </ThemedText>
                  <ThemedText themeColor="textSecondary" type="small">
                    {item.reason?.trim() || t('moderation.noReason')}
                  </ThemedText>
                  <ThemedText themeColor="textSecondary" type="small">
                    {formatDateTime(item.created_at)}
                  </ThemedText>
                </View>
                {unread ? <View style={[styles.dot, { backgroundColor: theme.brand }]} /> : null}
              </ThemedView>
            );
          }}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.two },
  emptyList: { flexGrow: 1 },
  emptyText: { textAlign: 'center', paddingHorizontal: Spacing.five },
  list: { padding: Spacing.four, gap: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.card,
  },
  rowInfo: { flex: 1, gap: 2 },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
