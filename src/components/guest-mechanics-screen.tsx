import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/empty-state';
import { MechanicCard } from '@/components/mechanic-card';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedView } from '@/components/themed-view';
import { Input } from '@/components/ui/input';
import { Spacing } from '@/constants/theme';
import { useAccountGate } from '@/hooks/use-account-gate';
import { fetchGuestMechanics, type GuestDataError } from '@/hooks/use-guest-data';
import { SEARCH_MIN_LENGTH } from '@/hooks/use-mechanic-search';
import { useSignedUrls } from '@/hooks/use-signed-urls';
import { useTheme } from '@/hooks/use-theme';
import { getGuestFavorites, toggleGuestFavorite } from '@/lib/guest-favorites';
import type { GuestProfile } from '@/types/database';

const DEBOUNCE_MS = 300;

/**
 * 1.1 (B3): tab-ul Mecanici al OASPETELUI — directorul (alfabetic, max 200) și căutarea
 * după nume (RPC `guest_search_mechanics`), cu `MechanicCard`. Favoritele stau LOCAL
 * (AsyncStorage, B2) și se mută în cont la primul login (D5).
 */
export function GuestMechanicsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { requireAccount } = useAccountGate();
  const [query, setQuery] = useState('');
  const [mechanics, setMechanics] = useState<GuestProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<GuestDataError | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  // Ultima cerere câștigă: un răspuns întârziat al unei căutări vechi nu suprascrie lista.
  const requestRef = useRef(0);

  const trimmed = query.trim();
  // Sub pragul de căutare arătăm directorul complet (ca la transportator).
  const effectiveQuery = trimmed.length >= SEARCH_MIN_LENGTH ? trimmed : '';

  const load = useCallback(async (q: string) => {
    const requestId = ++requestRef.current;
    setLoading(true);
    const result = await fetchGuestMechanics(q);
    if (requestId !== requestRef.current) return;
    if (!result.error || result.error === 'unavailable') setMechanics(result.data);
    setError(result.error);
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => load(effectiveQuery), effectiveQuery ? DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [effectiveQuery, load]);

  useFocusEffect(
    useCallback(() => {
      getGuestFavorites().then((ids) => setFavoriteIds(new Set(ids)));
    }, []),
  );

  const [pullRefreshing, setPullRefreshing] = useState(false);
  const onPullRefresh = useCallback(async () => {
    setPullRefreshing(true);
    await load(effectiveQuery);
    setPullRefreshing(false);
  }, [load, effectiveQuery]);

  const handleToggleFavorite = useCallback(async (mechanicId: string) => {
    const ids = await toggleGuestFavorite(mechanicId);
    setFavoriteIds(new Set(ids));
  }, []);

  const avatarPaths = useMemo(
    () => mechanics.map((m) => m.avatar_path).filter((p): p is string => !!p),
    [mechanics],
  );
  const avatarUrls = useSignedUrls(avatarPaths);

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t('guest.mechanics.title')} profileButton />

      <View style={styles.searchBar}>
        <Input
          value={query}
          onChangeText={setQuery}
          placeholder={t('search.placeholder')}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      {loading && mechanics.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.brand} />
        </View>
      ) : (
        <FlatList
          data={mechanics}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          keyboardShouldPersistTaps="handled"
          refreshing={pullRefreshing}
          onRefresh={onPullRefresh}
          renderItem={({ item }) => (
            <MechanicCard
              mechanic={item}
              avatarUrl={item.avatar_path ? avatarUrls[item.avatar_path] : undefined}
              isFavorite={favoriteIds.has(item.id)}
              onToggleFavorite={() => handleToggleFavorite(item.id)}
              // 25 oct 2026: profilul se vede doar cu cont; după cont revine pe el (/p/<id>).
              onPress={() => requireAccount('viewProfile', `/(guest)/mechanics/${item.id}`)}
            />
          )}
          ListEmptyComponent={
            error ? (
              <EmptyState
                icon="cloud-off"
                title={t('guest.loadErrorTitle')}
                description={t('guest.loadErrorDescription')}
              />
            ) : effectiveQuery ? (
              <EmptyState
                icon="search-off"
                title={t('search.noResultsTitle')}
                description={t('search.noResultsDescription')}
              />
            ) : (
              <EmptyState
                icon="engineering"
                title={t('guest.mechanics.emptyTitle')}
                description={t('guest.mechanics.emptyDescription')}
              />
            )
          }
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchBar: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.three,
  },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: {
    flexGrow: 1,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
  },
  separator: { height: Spacing.two },
});
