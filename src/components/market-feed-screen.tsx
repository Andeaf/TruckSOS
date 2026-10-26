import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ActivityIndicator,
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

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
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
import { useAccountGate } from '@/hooks/use-account-gate';
import { useAuth } from '@/hooks/use-auth';
import { useGuestMarketListings } from '@/hooks/use-guest-data';
import {
  MARKET_CATEGORIES,
  useMarketListings,
  type MarketSort,
} from '@/hooks/use-market';
import { dismissNotificationsOfType } from '@/lib/push';
import type { MarketCategory, Role } from '@/types/database';

/**
 * Tab-ul Market — design final 23 iul (screenshot user): search pill INTEGRAT în
 * antetul cu gradient (titlu + avatar 40 pe primul rând), chips de categorii +
 * „Ale mele" + sortare pe un rând scrollabil, grilă de 2 coloane, FAB squircle.
 * Logica (căutare server-side, paginare, ale-mele) e neschimbată — doar UI-ul.
 */

interface MarketFeedScreenProps {
  /** Grupul de rute al utilizatorului logat; lipsește la oaspete. */
  role?: Extract<Role, 'driver' | 'mechanic'>;
  /**
   * 1.1 (B3): oaspete — anunțurile active din `guest_market_listings` (RPC-ul de căutare
   * de oaspete), fără „Ale mele”; „+” deschide pop-upul de cont. Prop FIX per rută.
   */
  guest?: boolean;
}

type CategoryFilter = MarketCategory | 'all';

/** 26 iul: aspect comutabil — „pătrate" (grilă 2 col) vs „dreptunghiuri" (listă). */
const VIEW_MODE_KEY = 'market_view_mode';
type MarketViewMode = 'grid' | 'list';

export function MarketFeedScreen({ role, guest = false }: MarketFeedScreenProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const scheme = useResolvedScheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session } = useAuth();
  const { requireAccount } = useAccountGate();
  const base = guest
    ? '/(guest)/market'
    : role === 'driver'
      ? '/(driver)/market'
      : '/(mechanic)/market';

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [sort, setSort] = useState<MarketSort>('recent');
  const [mine, setMine] = useState(false);
  const [viewMode, setViewMode] = useState<MarketViewMode>('grid');

  useEffect(() => {
    AsyncStorage.getItem(VIEW_MODE_KEY).then((stored) => {
      if (stored === 'grid' || stored === 'list') setViewMode(stored);
    });
  }, []);

  function toggleViewMode() {
    setViewMode((prev) => {
      const next: MarketViewMode = prev === 'grid' ? 'list' : 'grid';
      AsyncStorage.setItem(VIEW_MODE_KEY, next);
      return next;
    });
  }

  // `guest` e fix pe durata montării (rute diferite = instanțe diferite), deci alegerea
  // hook-ului nu schimbă niciodată ordinea hook-urilor; ambele au aceeași semnătură.
  const useListings = guest ? useGuestMarketListings : useMarketListings;
  const { listings, covers, loading, loadingMore, hasMore, refresh, loadMore } =
    useListings(session?.user.id, {
      query,
      category: category === 'all' ? null : category,
      sort,
      mine: guest ? false : mine,
    });

  // Datele pot fi editate pe ecranele push-uite (detaliu/editare) → refresh la focus.
  // Tot la focus (6 oct): push-urile „anunț nou pe Market" dispar din bara de notificări —
  // userul are lista în față, deci n-au ce să mai anunțe (ca celulele de chat la citire).
  useFocusEffect(
    useCallback(() => {
      refresh();
      if (!guest) void dismissNotificationsOfType('listing');
    }, [refresh, guest]),
  );

  const [pullRefreshing, setPullRefreshing] = useState(false);
  const onPullRefresh = useCallback(async () => {
    setPullRefreshing(true);
    await refresh();
    setPullRefreshing(false);
  }, [refresh]);

  // Sheet tematizat în locul fostului Alert.alert nativ (nestilizabil, fără
  // închidere la tap în afară) — decizie 5 aug, la cererea userului.
  const [sortOpen, setSortOpen] = useState(false);
  const sortActions: SheetAction[] = [
    {
      label: t('market.sortRecent'),
      icon: 'schedule',
      selected: sort === 'recent',
      onPress: () => setSort('recent'),
    },
    {
      label: t('market.sortPriceAsc'),
      icon: 'arrow-upward',
      selected: sort === 'price_asc',
      onPress: () => setSort('price_asc'),
    },
    {
      label: t('market.sortPriceDesc'),
      icon: 'arrow-downward',
      selected: sort === 'price_desc',
      onPress: () => setSort('price_desc'),
    },
  ];

  function openSortMenu() {
    setSortOpen(true);
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

      {/* Rândul de control (design 26 iul): segmented „Toate / Ale mele" + butoane
          rotunde de sortare și de comutare grilă/listă. Categoriile au rândul lor. */}
      <View style={styles.controlRow}>
        {/* Oaspetele n-are „Ale mele” — segmentul lipsește, butoanele rămân în dreapta. */}
        {guest ? <View /> : (
        <View style={[styles.segmented, { backgroundColor: theme.backgroundElement }, Shadows.chip]}>
          {([false, true] as const).map((m) => (
            <Pressable
              key={String(m)}
              onPress={() => setMine(m)}
              hitSlop={{ top: 8, bottom: 8, left: 2, right: 2 }}
              accessibilityRole="button"
              accessibilityState={{ selected: mine === m }}
              style={[styles.segment, mine === m && { backgroundColor: theme.brand }]}>
              <ThemedText
                style={[
                  styles.segmentLabel,
                  { color: mine === m ? '#FFFFFF' : theme.textSecondary },
                ]}
                maxFontSizeMultiplier={1.2}>
                {m ? t('market.tabMine') : t('market.tabAll')}
              </ThemedText>
            </Pressable>
          ))}
        </View>
        )}

        <View style={styles.controlButtons}>
          <Pressable
            onPress={openSortMenu}
            hitSlop={8}
            accessibilityLabel={t('market.sortTitle')}
            style={[styles.roundBtn, { backgroundColor: theme.backgroundElement }, Shadows.chip]}>
            <Feather
              name="sliders"
              size={16}
              color={sort !== 'recent' ? theme.brand : theme.textSecondary}
            />
          </Pressable>
          <Pressable
            onPress={toggleViewMode}
            hitSlop={8}
            accessibilityLabel={t('market.toggleView')}
            style={[styles.roundBtn, { backgroundColor: theme.backgroundElement }, Shadows.chip]}>
            {/* Iconița arată vizualizarea CURENTĂ, pe accent (spec 26 iul). */}
            <Feather
              name={viewMode === 'grid' ? 'grid' : 'list'}
              size={16}
              color={theme.brand}
            />
          </Pressable>
        </View>
      </View>

      {/* Chips: DOAR categoriile — independente de segmentul Toate/Ale mele.
          removeClippedSubviews={false}: pe Android, clipping-ul agresiv al
          ScrollView-ului orizontal poate „pierde" textele chip-urilor după o
          re-randare (raportat de tester: etichetele dispăreau la comutarea
          filtrelor) — dezactivat explicit. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        removeClippedSubviews={false}
        style={styles.chipsScroll}
        contentContainerStyle={styles.chipsRow}>
        {chip('all', t('market.categoryAll'), null, category === 'all', () => setCategory('all'))}
        {MARKET_CATEGORIES.map((c) =>
          chip(c, t(`market.categories.${c}`), null, category === c, () => setCategory(c)),
        )}
      </ScrollView>

      <FlatList
        // Schimbarea lui numColumns cere remount → key pe aspect (limitare FlatList).
        key={viewMode}
        data={listings}
        keyExtractor={(item) => item.id}
        numColumns={viewMode === 'grid' ? 2 : 1}
        columnWrapperStyle={viewMode === 'grid' ? styles.columnWrapper : undefined}
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
            horizontal={viewMode === 'list'}
            onPress={() =>
              // 25 oct 2026: oaspetele nu vede detaliile din Market; după cont revine pe anunț.
              guest
                ? requireAccount('viewListing', `/(guest)/market/${item.id}`)
                : router.push({ pathname: `${base}/[id]`, params: { id: item.id } } as never)
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
        onPress={() => {
          if (guest) {
            requireAccount('marketPublish');
            return;
          }
          router.push(`${base}/new` as never);
        }}>
        <LinearGradient
          colors={HeaderGradient[scheme]}
          start={HeaderGradientDirection.start}
          end={HeaderGradientDirection.end}
          style={styles.fabGradient}>
          <MaterialIcons name="add" size={30} color="#fff" />
        </LinearGradient>
      </Pressable>

      <ActionSheet
        visible={sortOpen}
        title={t('market.sortTitle')}
        actions={sortActions}
        onClose={() => setSortOpen(false)}
      />
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
  // Rândul de control (26 iul): segmented + butoane rotunde 36 (touch extins prin hitSlop).
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingTop: 14,
  },
  segmented: {
    flexDirection: 'row',
    borderRadius: Radius.badge,
    padding: 3,
  },
  segment: {
    borderRadius: Radius.badge,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  segmentLabel: { fontSize: 13, fontWeight: '600', lineHeight: 18 },
  controlButtons: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  roundBtn: {
    width: 36,
    height: 36,
    borderRadius: Radius.circle,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // flexShrink: 0 e FIX-ul bug-ului „chips-urile se turtesc la «Toate»" (7 aug):
  // ScrollView-ul RN are implicit flexShrink:1, deci când FlatList-ul de sub el
  // are conținut mult (Toate, nu Ale mele), coloana flex îl strângea pe verticală
  // — chips înguste sus/jos, iar la tester textul dispărea complet. flexGrow:0
  // singur nu împiedica strângerea.
  chipsScroll: { flexGrow: 0, flexShrink: 0 },
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
  // flexShrink 0: textul nu are voie să colapseze la lățime 0 la re-măsurare
  // (al doilea mecanism cunoscut al „textelor dispărute" pe Android).
  chipLabel: { fontSize: 13, fontWeight: '600', lineHeight: 18, flexShrink: 0 },
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
