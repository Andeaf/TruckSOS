import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { StatusBadge } from '@/components/ui/status-badge';
import { RatingSheet } from '@/components/rating-sheet';
import { HeaderText, ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useBack } from '@/hooks/use-back';
import { useTheme } from '@/hooks/use-theme';
import { hideFromHistory, useHistory, type HistoryAnnouncement } from '@/hooks/use-history';
import { useMyRatingFor } from '@/hooks/use-ratings';

const LOCALE_MAP: Record<string, string> = { ro: 'ro-RO', en: 'en-GB', de: 'de-DE' };

function formatDate(dateStr: string, language: string) {
  return new Date(dateStr).toLocaleDateString(LOCALE_MAP[language] ?? 'ro-RO', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function HistoryCard({
  item,
  selectionMode,
  selected,
  onPress,
  onLongPress,
  onToggleSelect,
  onRate,
}: {
  item: HistoryAnnouncement;
  selectionMode: boolean;
  selected: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onToggleSelect: () => void;
  onRate: () => void;
}) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  // Evaluarea are sens doar pe un anunț finalizat cu un mecanic asignat — aceeași
  // condiție pe care o impune RLS-ul (§4).
  const canRate = item.status === 'resolved' && !!item.mechanic;

  return (
    <Pressable
      onPress={selectionMode ? onToggleSelect : onPress}
      onLongPress={onLongPress}
      delayLongPress={300}>
      <ThemedView type="backgroundElement" style={styles.card}>
        {selectionMode ? (
          <MaterialIcons
            name={selected ? 'check-circle' : 'radio-button-unchecked'}
            size={22}
            color={selected ? '#208AEF' : theme.textSecondary}
          />
        ) : null}

        <View style={styles.cardBody}>
          <View style={styles.cardTop}>
            <StatusBadge status={item.status} />
            <ThemedText themeColor="textSecondary" type="small">
              {formatDate(item.created_at, i18n.language)}
            </ThemedText>
          </View>

          <ThemedText numberOfLines={2}>{item.description}</ThemedText>

          <View style={styles.metaRow}>
            <MaterialIcons name="location-on" size={12} color={theme.textSecondary} />
            <ThemedText themeColor="textSecondary" type="small" numberOfLines={1} style={styles.metaText}>
              {item.location}
            </ThemedText>
          </View>

          {item.mechanic ? (
            <View style={styles.metaRow}>
              <MaterialIcons name="build" size={12} color={theme.textSecondary} />
              <ThemedText themeColor="textSecondary" type="small" numberOfLines={1} style={styles.metaText}>
                {t('driver.history.mechanicLabel')}: {item.mechanic.full_name}
              </ThemedText>
            </View>
          ) : null}

          {canRate && !selectionMode ? (
            <Pressable
              onPress={onRate}
              style={({ pressed }) => [styles.rateButton, pressed && styles.pressed]}
              hitSlop={6}>
              <MaterialIcons name="star" size={14} color="#f59e0b" />
              <ThemedText style={styles.rateText}>{t('rating.rateButton')}</ThemedText>
            </Pressable>
          ) : null}
        </View>
      </ThemedView>
    </Pressable>
  );
}

export default function DriverHistoryScreen() {
  const { session } = useAuth();
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const goBack = useBack('/(driver)/profile');
  const { items, loading, refresh } = useHistory(session?.user.id);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Mecanicul pe care îl evaluăm acum (null = sheet închis).
  const [rating, setRating] = useState<{ id: string; name: string } | null>(null);
  const { rating: myRating, refresh: refreshMyRating } = useMyRatingFor(
    rating?.id,
    session?.user.id,
  );

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function exitSelection() {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  // Ascunderea e SOFT: anunțul dispare din istoric, dar rămâne în DB (rating-ul din
  // 9.4 depinde de existența anunțului `resolved`). Mesajul îi spune asta șoferului.
  function confirmHide(ids: string[] | undefined, titleKey: string) {
    Alert.alert(
      t(titleKey),
      t('driver.history.deleteConfirmMessage'),
      [
        { text: t('driver.history.cancel'), style: 'cancel' },
        {
          text: t('driver.history.deleteConfirmOk'),
          style: 'destructive',
          onPress: async () => {
            const err = await hideFromHistory(ids);
            exitSelection();
            if (err) { Alert.alert(t('common.error'), err); return; }
            refresh();
          },
        },
      ]
    );
  }

  return (
    <ThemedView style={styles.container}>
      {selectionMode ? (
        <ScreenHeader>
          <View style={styles.selectionHeader}>
            <Pressable onPress={exitSelection} hitSlop={12}>
              <MaterialIcons name="close" size={24} color={theme.onHeader} />
            </Pressable>
            <HeaderText>
              {t('driver.history.selectedCount', { count: selectedIds.size })}
            </HeaderText>
            <Pressable
              onPress={() => confirmHide([...selectedIds], 'driver.history.deleteConfirmTitle')}
              disabled={selectedIds.size === 0}
              hitSlop={12}>
              <HeaderText style={selectedIds.size === 0 && styles.deleteTextDisabled}>
                {t('driver.history.deleteButton')}
              </HeaderText>
            </Pressable>
          </View>
        </ScreenHeader>
      ) : (
        <ScreenHeader
          title={t('driver.history.title')}
          onBack={goBack}
          right={
            items.length > 0 ? (
              <Pressable
                onPress={() => confirmHide(undefined, 'driver.history.deleteAllConfirmTitle')}
                hitSlop={12}>
                <MaterialIcons name="delete-sweep" size={22} color={theme.onHeader} />
              </Pressable>
            ) : null
          }
        />
      )}

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshing={loading}
        onRefresh={refresh}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <MaterialIcons name="history" size={48} color={theme.textSecondary} />
              <ThemedText themeColor="textSecondary" type="small" style={styles.emptyText}>
                {t('driver.history.empty')}
              </ThemedText>
            </View>
          ) : null
        }
        ListHeaderComponent={
          items.length > 0 && !selectionMode ? (
            <ThemedText themeColor="textSecondary" type="small" style={styles.hint}>
              {t('driver.history.hint')}
            </ThemedText>
          ) : null
        }
        renderItem={({ item }) => (
          <HistoryCard
            item={item}
            selectionMode={selectionMode}
            selected={selectedIds.has(item.id)}
            onPress={() =>
              router.push({
                pathname: '/(driver)/announcements/[id]' as never,
                params: { id: item.id },
              })
            }
            onLongPress={() => {
              setSelectionMode(true);
              setSelectedIds(new Set([item.id]));
            }}
            onToggleSelect={() => toggleSelect(item.id)}
            onRate={() =>
              item.mechanic && setRating({ id: item.mechanic.id, name: item.mechanic.full_name })
            }
          />
        )}
      />

      {rating && session ? (
        <RatingSheet
          visible
          mechanicId={rating.id}
          mechanicName={rating.name}
          driverId={session.user.id}
          initialStars={myRating?.stars}
          initialComment={myRating?.comment}
          onClose={() => setRating(null)}
          onSaved={() => { setRating(null); refreshMyRating(); }}
        />
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
  list: {
    padding: Spacing.four,
    gap: Spacing.two,
    flexGrow: 1,
  },
  hint: { marginBottom: Spacing.one },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: Radius.card,
    padding: Spacing.three,
  },
  cardBody: { flex: 1, gap: Spacing.one },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { flex: 1 },
  rateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    marginTop: Spacing.one,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.control,
    borderWidth: 1.5,
    borderColor: '#f59e0b',
  },
  rateText: { color: '#f59e0b', fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.7 },
  deleteTextDisabled: { opacity: 0.4 },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.two,
  },
  emptyText: { textAlign: 'center' },
});
