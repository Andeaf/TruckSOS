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
import { SEARCH_MIN_LENGTH, useMechanicSearch } from '@/hooks/use-mechanic-search';

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

  useFocusEffect(
    useCallback(() => {
      refreshFavorites();
      refreshHistory();
    }, [refreshFavorites, refreshHistory])
  );

  // Un singur apel batch de URL-uri semnate pentru avatarele de pe ecran
  // (rezultate + istoric), indiferent ce stare e vizibilă.
  const avatarPaths = useMemo(
    () =>
      [...results, ...history]
        .map((m) => m.avatar_path)
        .filter((p): p is string => !!p),
    [results, history]
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
        history.length > 0 ? (
          <FlatList
            data={history}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              <View style={styles.sectionHeader}>
                <MaterialIcons name="history" size={14} color={theme.textSecondary} />
                <ThemedText themeColor="textSecondary" type="smallBold">
                  {t('search.historyTitle')}
                </ThemedText>
              </View>
            }
            renderItem={({ item }) => (
              <MechanicCard
                mechanic={item}
                avatarUrl={item.avatar_path ? avatarUrls[item.avatar_path] : undefined}
                isFavorite={favoriteIds.has(item.id)}
                onToggleFavorite={() => toggleFavorite(item.id)}
                onRemove={() => removeEntry(item.id)}
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
    paddingBottom: Spacing.two,
  },
});
