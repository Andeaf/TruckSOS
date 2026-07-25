import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/empty-state';
import { MarketCard } from '@/components/market-card';
import { HeaderProfileButton, ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
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
  MARKET_CATEGORIES,
  useMarketListings,
  type MarketSort,
} from '@/hooks/use-market';
import type { MarketCategory, Role } from '@/types/database';

/**
 * Tab-ul Market — design final 23 iul (screenshot user): search pill INTEGRAT în
 * antetul cu gradient (titlu + avatar 40 pe primul rând), chips de categorii +
 * „Ale mele" + sortare pe un rând scrollabil, grilă de 2 coloane, FAB squircle.
 * Logica (căutare server-side, paginare, ale-mele) e neschimbată — doar UI-ul.
 */

interface MarketFeedScreenProps {
  role: Extract<Role, 'driver' | 'mechanic'>;
}

type CategoryFilter = MarketCategory | 'all';

export function MarketFeedScreen({ role }: MarketFeedScreenProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const scheme = useResolvedScheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session } = useAuth();
  const base = role === 'driver' ? '/(driver)/market' : '/(mechanic)/market';

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [sort, setSort] = useState<MarketSort>('recent');
  const [mine, setMine] = useState(false);

  const { listings, covers, loading, loadingMore, hasMore, refresh, loadMore } =
    useMarketListings(session?.user.id, {
      query,
      category: category === 'all' ? null : category,
      sort,
      mine,
    });

  // Datele pot fi editate pe ecranele push-uite (detaliu/editare) → refresh la focus.
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

  function openSortMenu() {
    Alert.alert(t('market.sortTitle'), undefined, [
      { text: t('market.sortRecent'), onPress: () => setSort('recent') },
      { text: t('market.sortPriceAsc'), onPress: () => setSort('price_asc') },
      { text: t('market.sortPriceDesc'), onPress: () => setSort('price_desc') },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  }

  function chip(
    key: string,
    label: string | null,
    icon: keyof typeof Feather.glyphMap | null,
    active: boolean,
    onPress: () => void,
  ) {
    return (
      <Pressable
        key={key}
        onPress={onPress}
        hitSlop={{ top: 8, bottom: 8, left: 2, right: 2 }}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        style={[
          styles.chip,
          active
            ? { backgroundColor: theme.brand }
            : { backgroundColor: theme.backgroundElement, ...Shadows.chip },
        ]}>
        {icon ? (
          <Feather name={icon} size={14} color={active ? '#fff' : theme.textSecondary} />
        ) : null}
        {label ? (
          <ThemedText
            style={[styles.chipLabel, { color: active ? '#FFFFFF' : theme.textSecondary }]}
            maxFontSizeMultiplier={1.2}>
            {label}
          </ThemedText>
        ) : null}
      </Pressable>
    );
  }

  const emptyMine = mine && !loading && listings.length === 0;
  const emptySearch = !mine && query.trim().length >= 2 && !loading && listings.length === 0;

  return (
    <ThemedView style={styles.container}>
      {/* Antet custom: titlu + avatar, apoi search pill — totul pe gradient. */}
      <ScreenHeader>
        <View style={styles.headerContent}>
          <View style={styles.headerRow}>
            <ThemedText style={[styles.headerTitle, { color: theme.onHeader }]}>
              {t('market.title')}
            </ThemedText>
            <HeaderProfileButton size={40} />
          </View>

          <View style={styles.searchPill}>
            <Feather name="search" size={16} color="rgba(255,255,255,0.75)" />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder={t('market.searchPlaceholder')}
              placeholderTextColor="rgba(255,255,255,0.75)"
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
            />
            {query.length > 0 ? (
              <Pressable onPress={() => setQuery('')} hitSlop={10}>
                <Feather name="x" size={16} color="rgba(255,255,255,0.75)" />
              </Pressable>
            ) : null}
          </View>
        </View>
      </ScreenHeader>

      {/* Chips: categorii + „Ale mele" + sortare, un singur rând scrollabil. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipsScroll}
        contentContainerStyle={styles.chipsRow}>
        {chip('all', t('market.categoryAll'), null, category === 'all' && !mine, () => {
          setCategory('all');
          setMine(false);
        })}
        {MARKET_CATEGORIES.map((c) =>
          chip(c, t(`market.categories.${c}`), null, category === c && !mine, () => {
            setCategory(c);
            setMine(false);
          }),
        )}
        {chip('mine', t('market.tabMine'), 'user', mine, () => setMine((v) => !v))}
        {chip('sort', null, 'sliders', sort !== 'recent', openSortMenu)}
      </ScrollView>

      <FlatList
        data={listings}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.columnWrapper}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        refreshing={pullRefreshing}
        onRefresh={onPullRefresh}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        renderItem={({ item }) => (
          <MarketCard
            listing={item}
            coverUrl={covers[item.id]}
            onPress={() =>
              router.push({ pathname: `${base}/[id]`, params: { id: item.id } } as never)
            }
          />
        )}
        ListFooterComponent={
          loadingMore && hasMore ? (
            <ActivityIndicator size="small" color={theme.textSecondary} style={styles.footer} />
          ) : null
        }
        ListEmptyComponent={
          loading ? null : emptyMine ? (
            <EmptyState
              icon="storefront"
              title={t('market.emptyMineTitle')}
              description={t('market.emptyMineDescription')}
            />
          ) : emptySearch ? (
            <EmptyState
              icon="search-off"
              title={t('market.emptySearchTitle')}
              description={t('market.emptySearchDescription')}
            />
          ) : (
            <EmptyState
              icon="storefront"
              title={t('market.emptyTitle')}
              description={t('market.emptyDescription')}
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
        onPress={() => router.push(`${base}/new` as never)}>
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
  headerContent: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: { fontSize: 24, fontWeight: '800', letterSpacing: -0.3, lineHeight: 30 },
  // Search pill integrat în gradient: alb translucid + bordură discretă (design 23 iul).
  searchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: Radius.badge,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.20)',
  },
  searchInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 14,
    padding: 0,
  },
  chipsScroll: { flexGrow: 0 },
  chipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 4,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: Radius.badge,
  },
  chipLabel: { fontSize: 13, fontWeight: '600', lineHeight: 18 },
  columnWrapper: { gap: 12 },
  list: {
    flexGrow: 1,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: Spacing.six + Spacing.four,
    gap: 12,
  },
  footer: { paddingVertical: Spacing.three },
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
