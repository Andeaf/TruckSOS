import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, SectionList, StyleSheet, View } from 'react-native';
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
  useMechanicSearch,
  type MechanicSearchResult,
} from '@/hooks/use-mechanic-search';

/**
 * Secțiunile stării goale (PLAN_FAZA13.md §3.1): Favoriți sus, Recente jos, fără
 * dedup între ele — un mecanic poate apărea în ambele, deci cheia de listă poartă
 * prefixul secțiunii (id-ul singur s-ar ciocni între secțiuni).
 */
type EmptyItem = MechanicSearchResult & { listKey: string };
type EmptySection = {
  key: 'favorites' | 'history';
  title: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  data: EmptyItem[];
};

export default function DriverSearchScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const { results, loading } = useMechanicSearch(query);
  const { favoriteIds, favorites, toggleFavorite, refresh: refreshFavorites } = useFavorites();
  const { history, recordSearch, removeEntry, refresh: refreshHistory } = useSearchHistory();

  useFocusEffect(
    useCallback(() => {
      refreshFavorites();
      refreshHistory();
    }, [refreshFavorites, refreshHistory])
  );

  // Un singur apel batch de URL-uri semnate pentru TOATE avatarele de pe ecran
  // (rezultate + favoriți + istoric), indiferent ce stare e vizibilă.
  const avatarPaths = useMemo(
    () =>
      [...results, ...favorites, ...history]
        .map((m) => m.avatar_path)
        .filter((p): p is string => !!p),
    [results, favorites, history]
  );
  const avatarUrls = useSignedUrls(avatarPaths);

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

  const emptySections = useMemo<EmptySection[]>(() => {
    const sections: EmptySection[] = [];
    if (favorites.length > 0) {
      sections.push({
        key: 'favorites',
        title: t('favorites.sectionTitle'),
        icon: 'star',
        data: favorites.map((m) => ({ ...m, listKey: `fav-${m.id}` })),
      });
    }
    if (history.length > 0) {
      sections.push({
        key: 'history',
        title: t('search.historyTitle'),
        icon: 'history',
        data: history.map((m) => ({ ...m, listKey: `hist-${m.id}` })),
      });
    }
    return sections;
  }, [favorites, history, t]);

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t('search.title')} />

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
        emptySections.length > 0 ? (
          <SectionList
            sections={emptySections}
            keyExtractor={(item) => item.listKey}
            contentContainerStyle={styles.list}
            stickySectionHeadersEnabled={false}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            SectionSeparatorComponent={() => <View style={styles.separator} />}
            keyboardShouldPersistTaps="handled"
            renderSectionHeader={({ section }) => (
              <View style={styles.sectionHeader}>
                <MaterialIcons name={section.icon} size={14} color={theme.textSecondary} />
                <ThemedText themeColor="textSecondary" type="smallBold">
                  {section.title}
                </ThemedText>
              </View>
            )}
            renderItem={({ item, section }) => (
              <MechanicCard
                mechanic={item}
                avatarUrl={item.avatar_path ? avatarUrls[item.avatar_path] : undefined}
                isFavorite={favoriteIds.has(item.id)}
                onToggleFavorite={() => toggleFavorite(item.id)}
                onRemove={section.key === 'history' ? () => removeEntry(item.id) : undefined}
                onPress={() => openProfile(item.id)}
              />
            )}
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
    paddingBottom: Spacing.one,
  },
});
