import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import {
  SEARCH_MIN_LENGTH,
  fetchRecentRecommendedMechanics,
  useUserSearch,
  type MechanicSearchResult,
} from '@/hooks/use-mechanic-search';
import { useSignedUrls } from '@/hooks/use-signed-urls';
import { useTheme } from '@/hooks/use-theme';

/**
 * Faza 19.5/19.6: pickerul „Recomandă un mecanic / un transportator" al meniului „+".
 * Căutare server-side prin RPC-ul search_users (unaccent, ambele roluri), filtrată pe
 * rolul cerut; istoricul „Recente" e filtrat pe același rol. Alegerea setează
 * pendingMechanic la caller — bannerul din compozitor preia restul.
 */
interface MechanicPickerSheetProps {
  visible: boolean;
  /** Pentru istoricul „Recente" (ultimii utilizatori recomandați de user). */
  userId: string;
  /** Faza 19.6: mecanic sau transportator — texte, icoane și filtrare pe rol. */
  targetRole: 'mechanic' | 'driver';
  onClose: () => void;
  onPick: (mechanic: MechanicSearchResult) => void;
}

export function MechanicPickerSheet({
  visible,
  userId,
  targetRole,
  onClose,
  onPick,
}: MechanicPickerSheetProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const { results: allResults, loading } = useUserSearch(query);
  const results = useMemo(
    () => allResults.filter((r) => r.role === targetRole),
    [allResults, targetRole],
  );
  // Istoricul recomandărilor — afișat cât timp nu s-a tastat nimic.
  const [recent, setRecent] = useState<MechanicSearchResult[]>([]);
  useEffect(() => {
    let active = true;
    fetchRecentRecommendedMechanics(userId, targetRole).then((list) => {
      if (active) setRecent(list);
    });
    return () => {
      active = false;
    };
  }, [userId, targetRole]);
  const tooShort = query.trim().length < SEARCH_MIN_LENGTH;
  const showRecent = tooShort && recent.length > 0;
  const listData = showRecent ? recent : results;
  const avatarPaths = useMemo(
    () => listData.map((r) => r.avatar_path).filter((p): p is string => !!p),
    [listData],
  );
  const urls = useSignedUrls(avatarPaths);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent>
      <View style={styles.wrapper}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            { backgroundColor: theme.backgroundElement, paddingBottom: insets.bottom + Spacing.two },
          ]}>
          <View style={styles.header}>
            <ThemedText type="smallBold">
              {t(targetRole === 'driver' ? 'attach.driverPickerTitle' : 'attach.mechanicPickerTitle')}
            </ThemedText>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel={t('photos.close')}>
              <MaterialIcons name="close" size={22} color={theme.textSecondary} />
            </Pressable>
          </View>

          <TextInput
            style={[styles.search, { color: theme.text, backgroundColor: theme.background }]}
            value={query}
            onChangeText={setQuery}
            placeholder={t(
              targetRole === 'driver' ? 'attach.searchDrivers' : 'attach.searchMechanics'
            )}
            placeholderTextColor={theme.textTertiary}
            autoFocus
          />

          {tooShort && !showRecent ? (
            <View style={styles.centered}>
              <MaterialIcons
                name={targetRole === 'driver' ? 'local-shipping' : 'engineering'}
                size={36}
                color={theme.textTertiary}
              />
              <ThemedText themeColor="textSecondary" type="small">
                {t('attach.searchHint')}
              </ThemedText>
            </View>
          ) : !tooShort && loading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={theme.brand} />
            </View>
          ) : !tooShort && results.length === 0 ? (
            <View style={styles.centered}>
              <ThemedText themeColor="textSecondary" type="small">
                {t('attach.noResults')}
              </ThemedText>
            </View>
          ) : (
            <FlatList
              data={listData}
              keyExtractor={(item) => item.id}
              style={styles.list}
              keyboardShouldPersistTaps="handled"
              ListHeaderComponent={
                // Faza 19.6: istoricul „Recente" — vizibil până începe căutarea.
                showRecent ? (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
                    {t('attach.recent')}
                  </ThemedText>
                ) : null
              }
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => onPick(item)}
                  style={({ pressed }) => [
                    styles.row,
                    pressed && { backgroundColor: theme.backgroundSelected },
                  ]}>
                  <Avatar
                    url={item.avatar_path ? urls[item.avatar_path] : undefined}
                    name={item.full_name}
                    size={40}
                    userId={item.id}
                  />
                  <View style={styles.info}>
                    <ThemedText numberOfLines={1} type="smallBold">
                      {item.full_name}
                    </ThemedText>
                    <ThemedText numberOfLines={1} type="small" themeColor="textSecondary">
                      {item.rating_count > 0
                        ? `★ ${item.rating_avg.toFixed(1)} (${item.rating_count})` +
                          (item.activity_zone ? ` · ${item.activity_zone}` : '')
                        : (item.activity_zone ?? '')}
                    </ThemedText>
                  </View>
                  <MaterialIcons name="chevron-right" size={20} color={theme.textTertiary} />
                </Pressable>
              )}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    height: '80%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  search: {
    marginHorizontal: Spacing.four,
    marginBottom: Spacing.two,
    borderRadius: Radius.badge,
    paddingHorizontal: Spacing.three,
    paddingVertical: 9,
    fontSize: 14,
  },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.two },
  list: { flex: 1 },
  sectionLabel: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.one,
    fontWeight: '700',
    textTransform: 'uppercase',
    fontSize: 11,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  info: { flex: 1, gap: 1 },
});
