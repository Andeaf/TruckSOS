import { useCallback, useMemo } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/empty-state';
import { MechanicCard } from '@/components/mechanic-card';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useBack } from '@/hooks/use-back';
import { useFavorites } from '@/hooks/use-favorites';
import { useSignedUrls } from '@/hooks/use-signed-urls';
import { useTheme } from '@/hooks/use-theme';

/**
 * Lista dedicată de mecanici favoriți (PLAN_FAZA13.md §3.5, ajustat: mutată din
 * secțiunea căutării într-un ecran propriu, accesat din butonul-stea al header-ului
 * de căutare). Toggle-ul steaua îl scoate din listă optimist (vezi `useFavorites`).
 */
export default function DriverFavoritesScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const goBack = useBack('/(driver)/search');
  const { favoriteIds, favorites, loading, toggleFavorite, refresh } = useFavorites();

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  const avatarPaths = useMemo(
    () => favorites.map((m) => m.avatar_path).filter((p): p is string => !!p),
    [favorites]
  );
  const avatarUrls = useSignedUrls(avatarPaths);

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
      <ScreenHeader title={t('favorites.sectionTitle')} onBack={goBack} />

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.brand} />
        </View>
      ) : (
        <FlatList
          data={favorites}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <EmptyState
              icon="star-outline"
              title={t('favorites.emptyTitle')}
              description={t('favorites.emptyDescription')}
            />
          }
          renderItem={({ item }) => (
            <MechanicCard
              mechanic={item}
              avatarUrl={item.avatar_path ? avatarUrls[item.avatar_path] : undefined}
              isFavorite={favoriteIds.has(item.id)}
              onToggleFavorite={() => toggleFavorite(item.id)}
              onPress={() => openProfile(item.id)}
            />
          )}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: {
    flexGrow: 1,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
  },
  separator: { height: Spacing.two },
});
