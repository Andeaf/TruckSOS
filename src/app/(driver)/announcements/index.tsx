import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { AnnouncementCard } from '@/components/announcement-card';
import { EmptyState } from '@/components/empty-state';
import { HeaderText, ScreenHeader } from '@/components/screen-header';
import { FilterChips } from '@/components/ui/filter-chips';
import { ThemedView } from '@/components/themed-view';
import {
  HeaderGradient,
  HeaderGradientDirection,
  Radius,
  Shadows,
  Spacing,
} from '@/constants/theme';
import { useResolvedScheme } from '@/hooks/use-settings';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import {
  useMyAnnouncements,
  deleteAnnouncement,
  fetchPendingApplicationCounts,
} from '@/hooks/use-announcements';
import type { Announcement } from '@/types/database';

type StatusFilter = 'all' | 'active' | 'resolved';

export default function DriverAnnouncementsScreen() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const theme = useTheme();
  const scheme = useResolvedScheme();
  const { announcements, loading, refresh } = useMyAnnouncements();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [applicantCounts, setApplicantCounts] = useState<Record<string, number>>({});
  // Filtru pur vizual (redesign): nu atinge query-ul, doar ce se afișează.
  const [filter, setFilter] = useState<StatusFilter>('all');
  const filtered = useMemo(() => {
    if (filter === 'active')
      return announcements.filter((a) => a.status === 'open' || a.status === 'accepted');
    if (filter === 'resolved') return announcements.filter((a) => a.status === 'resolved');
    return announcements;
  }, [announcements, filter]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  // Pull-to-refresh separat de load-ul programatic: pe iOS, `refreshing=true` setat
  // programatic inserează insetul spinner-ului, care poate rămâne blocat (gol sub antet).
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const onPullRefresh = useCallback(async () => {
    setPullRefreshing(true);
    await refresh();
    setPullRefreshing(false);
  }, [refresh]);

  // Ofertele în așteptare, recalculate ori de câte ori se schimbă lista de anunțuri.
  useEffect(() => {
    const openIds = announcements.filter((a) => a.status === 'open').map((a) => a.id);
    fetchPendingApplicationCounts(openIds).then(setApplicantCounts);
  }, [announcements]);

  function isSelectable(a: Announcement) {
    return a.status === 'open' || a.status === 'cancelled' || a.status === 'resolved';
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function enterSelection(id: string) {
    setSelectionMode(true);
    setSelectedIds(new Set([id]));
  }

  function exitSelection() {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  const handleDeleteSelected = useCallback(() => {
    const selected = announcements.filter((a) => selectedIds.has(a.id));
    const hasOpen = selected.some((a) => a.status === 'open');
    const message = hasOpen
      ? t('driver.announcements.deleteSelectedConfirmMessageWithOpen')
      : t('driver.announcements.deleteSelectedConfirmMessage');

    Alert.alert(
      t('driver.announcements.deleteSelectedConfirmTitle'),
      message,
      [
        { text: t('conversations.cancelSelection'), style: 'cancel' },
        {
          text: t('driver.announcements.deleteSelectedConfirmOk'),
          style: 'destructive',
          onPress: async () => {
            for (const id of selectedIds) {
              await deleteAnnouncement(id);
            }
            exitSelection();
            refresh();
          },
        },
      ]
    );
  }, [t, selectedIds, announcements, refresh]);

  return (
    <ThemedView style={styles.container}>
      {selectionMode ? (
        <ScreenHeader>
          <View style={styles.selectionHeader}>
            <Pressable onPress={exitSelection} hitSlop={8}>
              <MaterialIcons name="close" size={24} color={theme.onHeader} />
            </Pressable>
            <HeaderText>
              {t('driver.announcements.selectedCount', { count: selectedIds.size })}
            </HeaderText>
            <Pressable onPress={handleDeleteSelected} disabled={selectedIds.size === 0} hitSlop={8}>
              <HeaderText style={selectedIds.size === 0 && styles.deleteTextDisabled}>
                {t('driver.announcements.deleteSelectedButton')}
              </HeaderText>
            </Pressable>
          </View>
        </ScreenHeader>
      ) : (
        <ScreenHeader
          title={t('driver.announcements.listTitle')}
          subtitle={profile?.full_name}
        />
      )}

      {!selectionMode ? (
        <FilterChips
          options={[
            { key: 'all', label: t('driver.announcements.filterAll') },
            { key: 'active', label: t('driver.announcements.filterActive') },
            { key: 'resolved', label: t('driver.announcements.filterResolved') },
          ]}
          value={filter}
          onChange={setFilter}
        />
      ) : null}

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        refreshing={pullRefreshing}
        onRefresh={onPullRefresh}
        renderItem={({ item }) => {
          const selectable = isSelectable(item);
          return (
            <AnnouncementCard
              announcement={item}
              applicantCount={applicantCounts[item.id] ?? 0}
              selectionMode={selectionMode}
              selected={selectedIds.has(item.id)}
              selectable={selectable}
              onPress={() =>
                router.push({
                  pathname: '/(driver)/announcements/[id]',
                  params: { id: item.id },
                })
              }
              onLongPress={() => { if (selectable) enterSelection(item.id); }}
              onToggleSelect={() => toggleSelect(item.id)}
            />
          );
        }}
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

      {!selectionMode ? (
        <Pressable
          style={({ pressed }) => [
            styles.fab,
            { bottom: insets.bottom + Spacing.three },
            pressed && styles.fabPressed,
          ]}
          onPress={() => router.push('/(driver)/announcements/new')}>
          <LinearGradient
            colors={HeaderGradient[scheme]}
            start={HeaderGradientDirection.start}
            end={HeaderGradientDirection.end}
            style={styles.fabGradient}>
            <MaterialIcons name="add" size={30} color="#fff" />
          </LinearGradient>
        </Pressable>
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  selectionHeader: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  deleteTextDisabled: { opacity: 0.4 },
  // Padding-ul listei + gap-ul dintre carduri: valorile exacte din design.
  list: {
    flexGrow: 1,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: Spacing.six + Spacing.four,
  },
  separator: { height: 12 },
  // FAB squircle 58×58 cu gradientul principal (nu cerc — decizie de design).
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
