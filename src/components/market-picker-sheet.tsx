import { useState } from 'react';
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

import { RemoteImage } from '@/components/remote-image';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useMarketListings } from '@/hooks/use-market';
import { useTheme } from '@/hooks/use-theme';
import type { MarketListing } from '@/types/database';

/**
 * Faza 19.5: pickerul „Anunț din Market" al meniului „+" din chat.
 * Refolosește integral useMarketListings (paginare + căutare server-side + coveruri
 * semnate); alegerea NU trimite nimic — callerul setează pendingListing, iar bannerul
 * „Anunț atașat" existent preia restul fluxului.
 */
interface MarketPickerSheetProps {
  visible: boolean;
  userId: string;
  onClose: () => void;
  onPick: (listing: MarketListing) => void;
}

export function MarketPickerSheet({ visible, userId, onClose, onPick }: MarketPickerSheetProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [mine, setMine] = useState(false);
  const { listings, covers, loading, loadingMore, loadMore } = useMarketListings(userId, {
    query,
    category: null,
    sort: 'recent',
    mine,
  });

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
            <ThemedText type="smallBold">{t('attach.marketPickerTitle')}</ThemedText>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel={t('photos.close')}>
              <MaterialIcons name="close" size={22} color={theme.textSecondary} />
            </Pressable>
          </View>

          <TextInput
            style={[styles.search, { color: theme.text, backgroundColor: theme.background }]}
            value={query}
            onChangeText={setQuery}
            placeholder={t('attach.searchListings')}
            placeholderTextColor={theme.textTertiary}
          />

          <View style={styles.tabs}>
            {([false, true] as const).map((m) => (
              <Pressable
                key={String(m)}
                onPress={() => setMine(m)}
                style={[styles.tab, { backgroundColor: mine === m ? theme.brand : theme.background }]}>
                <ThemedText
                  type="small"
                  style={{ color: mine === m ? '#ffffff' : theme.textSecondary, fontWeight: '700' }}>
                  {m ? t('market.tabMine') : t('market.tabAll')}
                </ThemedText>
              </Pressable>
            ))}
          </View>

          {loading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={theme.brand} />
            </View>
          ) : listings.length === 0 ? (
            <View style={styles.centered}>
              <ThemedText themeColor="textSecondary" type="small">
                {t('attach.noResults')}
              </ThemedText>
            </View>
          ) : (
            <FlatList
              data={listings}
              keyExtractor={(item) => item.id}
              style={styles.list}
              onEndReached={loadMore}
              onEndReachedThreshold={0.4}
              ListFooterComponent={
                loadingMore ? (
                  <ActivityIndicator style={styles.footerSpinner} color={theme.textSecondary} />
                ) : null
              }
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => onPick(item)}
                  style={({ pressed }) => [
                    styles.row,
                    pressed && { backgroundColor: theme.backgroundSelected },
                  ]}>
                  {covers[item.id] ? (
                    <RemoteImage uri={covers[item.id]} style={styles.cover} contentFit="cover" />
                  ) : (
                    <View
                      style={[styles.cover, styles.coverPlaceholder, { backgroundColor: theme.background }]}>
                      <MaterialIcons name="sell" size={18} color={theme.textTertiary} />
                    </View>
                  )}
                  <View style={styles.info}>
                    <ThemedText numberOfLines={1} type="smallBold">
                      {item.title}
                    </ThemedText>
                    <ThemedText type="small" style={{ color: theme.price, fontWeight: '800' }}>
                      {`${Number(item.price).toLocaleString()} ${item.currency}`}
                      {item.status === 'sold' ? ` · ${t('market.soldBadge')}` : ''}
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
    borderRadius: Radius.badge,
    paddingHorizontal: Spacing.three,
    paddingVertical: 9,
    fontSize: 14,
  },
  tabs: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  tab: {
    borderRadius: Radius.badge,
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
  },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { flex: 1 },
  footerSpinner: { marginVertical: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  cover: { width: 44, height: 44, borderRadius: 8 },
  coverPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  info: { flex: 1, gap: 1 },
});
