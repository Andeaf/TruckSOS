import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/empty-state';
import { Input } from '@/components/ui/input';
import { MechanicCard } from '@/components/mechanic-card';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useFavorites } from '@/hooks/use-favorites';
import { useSearchHistory } from '@/hooks/use-search-history';
import { useSignedUrls } from '@/hooks/use-signed-urls';
import { useTheme } from '@/hooks/use-theme';
import {
  SEARCH_MIN_LENGTH,
  useAllMechanics,
  useMechanicSearch,
  type MechanicSearchResult,
} from '@/hooks/use-mechanic-search';

/** Starea de repaus (fără căutare activă): istoricul + directorul alfabetic,
 * într-o singură listă virtualizată (rânduri mixte, discriminate prin `kind`). */
type IdleRow =
  | { key: string; kind: 'mechanic'; source: 'history' | 'all'; m: MechanicSearchResult }
  | { key: string; kind: 'allHeader' };

export default function DriverSearchScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const { results, loading } = useMechanicSearch(query);
  // Favoriții au ecran propriu (butonul-stea din header); aici păstrăm doar setul de
  // id-uri, pentru starea plină/contur a stelelor de pe carduri.
  const { favoriteIds, toggleFavorite, refresh: refreshFavorites } = useFavorites();
  const { history, recordSearch, removeEntry, refresh: refreshHistory } = useSearchHistory();
  // 5 aug: „Toți mecanicii" alfabetic, sub căutările recente (cerința userului).
  const { mechanics: allMechanics } = useAllMechanics();

  useFocusEffect(
    useCallback(() => {
      refreshFavorites();
      refreshHistory();
    }, [refreshFavorites, refreshHistory])
  );

  // Un singur apel batch de URL-uri semnate pentru avatarele de pe ecran
  // (rezultate + istoric + director), indiferent ce stare e vizibilă.
  const avatarPaths = useMemo(
    () =>
      [...results, ...history, ...allMechanics]
        .map((m) => m.avatar_path)
        .filter((p): p is string => !!p),
    [results, history, allMechanics]
  );
  const avatarUrls = useSignedUrls(avatarPaths);

  const idleRows = useMemo<IdleRow[]>(() => {
    const rows: IdleRow[] = [];
    for (const m of history) rows.push({ key: `h-${m.id}`, kind: 'mechanic', source: 'history', m });
    if (allMechanics.length > 0) {
      rows.push({ key: 'all-header', kind: 'allHeader' });
      for (const m of allMechanics) rows.push({ key: `a-${m.id}`, kind: 'mechanic', source: 'all', m });
    }
    return rows;
  }, [history, allMechanics]);

  const queryActive = query.trim().length >= SEARCH_MIN_LENGTH;

  const openProfile = useCallback(
    (mechanicId: string) => {
      router.push({
        pathname: '/(driver)/mechanic-profile/[id]' as never,
        params: { id: mechanicId },
      });
    },
    [router]
  );

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader
        title={t('search.title')}
        profileButton
        right={
          <Pressable
            onPress={() => router.push('/(driver)/search/favorites' as never)}
            hitSlop={12}
            accessibilityLabel={t('favorites.openList')}>
            <MaterialIcons name="star" size={24} color={theme.onHeader} />
          </Pressable>
        }
      />

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

      {!queryActive ? (
        idleRows.length > 0 ? (
          <FlatList
            data={idleRows}
            keyExtractor={(item) => item.key}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              history.length > 0 ? (
                <View style={styles.sectionHeader}>
                  <MaterialIcons name="history" size={14} color={theme.textSecondary} />
                  <ThemedText themeColor="textSecondary" type="smallBold">
                    {t('search.historyTitle')}
                  </ThemedText>
                </View>
              ) : null
            }
            renderItem={({ item }) =>
              item.kind === 'allHeader' ? (
                <View style={[styles.sectionHeader, history.length > 0 && styles.allHeaderSpacing]}>
                  <MaterialIcons name="engineering" size={14} color={theme.textSecondary} />
                  <ThemedText themeColor="textSecondary" type="smallBold">
                    {t('search.allMechanicsTitle')}
                  </ThemedText>
                </View>
              ) : (
                <MechanicCard
                  mechanic={item.m}
                  avatarUrl={item.m.avatar_path ? avatarUrls[item.m.avatar_path] : undefined}
                  isFavorite={favoriteIds.has(item.m.id)}
                  onToggleFavorite={() => toggleFavorite(item.m.id)}
                  onRemove={item.source === 'history' ? () => removeEntry(item.m.id) : undefined}
                  onPress={() => openProfile(item.m.id)}
                />
              )
            }
          />
        ) : (
          <EmptyState
            icon="search"
            title={t('search.emptyTitle')}
            description={t('search.emptyDescription', { min: SEARCH_MIN_LENGTH })}
          />
        )
      ) : loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.brand} />
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <MechanicCard
              mechanic={item}
              avatarUrl={item.avatar_path ? avatarUrls[item.avatar_path] : undefined}
              isFavorite={favoriteIds.has(item.id)}
              onToggleFavorite={() => toggleFavorite(item.id)}
              onPress={() => {
                // Cerința e „accesat DIN CĂUTARE": doar rezultatele înregistrează
                // istoric, nu și tap-urile pe carduri de favorit/istoric.
                recordSearch(item.id);
                openProfile(item.id);
              }}
            />
          )}
          ListEmptyComponent={
            <EmptyState
              icon="search-off"
              title={t('search.noResultsTitle')}
              description={t('search.noResultsDescription')}
            />
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
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingBottom: Spacing.two,
  },
  // Spațiu de respiro între finalul istoricului și titlul directorului.
  allHeaderSpacing: { paddingTop: Spacing.three },
});
