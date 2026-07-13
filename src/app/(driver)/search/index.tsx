import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/empty-state';
import { Input } from '@/components/ui/input';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { RatingBadge } from '@/components/rating-badge';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  SEARCH_MIN_LENGTH,
  useMechanicSearch,
  type MechanicSearchResult,
} from '@/hooks/use-mechanic-search';

function MechanicResultCard({
  mechanic,
  onPress,
}: {
  mechanic: MechanicSearchResult;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView type="backgroundElement" style={styles.card}>
        <View style={styles.cardContent}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {mechanic.full_name}
          </ThemedText>
          {mechanic.specialization ? (
            <View style={styles.detailRow}>
              <MaterialIcons name="build" size={12} color={theme.textSecondary} />
              <ThemedText themeColor="textSecondary" type="small" numberOfLines={1} style={styles.detailText}>
                {mechanic.specialization}
              </ThemedText>
            </View>
          ) : null}
          {mechanic.activity_zone ? (
            <View style={styles.detailRow}>
              <MaterialIcons name="place" size={12} color={theme.textSecondary} />
              <ThemedText themeColor="textSecondary" type="small" numberOfLines={1} style={styles.detailText}>
                {mechanic.activity_zone}
              </ThemedText>
            </View>
          ) : null}
          <RatingBadge avg={mechanic.rating_avg} count={mechanic.rating_count} />
        </View>
        <MaterialIcons name="chevron-right" size={22} color={theme.textSecondary} />
      </ThemedView>
    </Pressable>
  );
}

export default function DriverSearchScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const { results, loading } = useMechanicSearch(query);

  const queryActive = query.trim().length >= SEARCH_MIN_LENGTH;

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t('search.title')} />

      <View style={styles.searchBar}>
        <Input
          value={query}
          onChangeText={setQuery}
          placeholder={t('search.placeholder')}
          autoFocus
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      {!queryActive ? (
        <EmptyState
          icon="search"
          title={t('search.emptyTitle')}
          description={t('search.emptyDescription', { min: SEARCH_MIN_LENGTH })}
        />
      ) : loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#208AEF" />
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <MechanicResultCard
              mechanic={item}
              onPress={() =>
                router.push({
                  pathname: '/(driver)/mechanic-profile/[id]' as never,
                  params: { id: item.id },
                })
              }
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
  card: {
    borderRadius: Radius.card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
  },
  cardContent: { flex: 1, gap: 3 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  detailText: { flex: 1 },
  pressed: { opacity: 0.7 },
});
