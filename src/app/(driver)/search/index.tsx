import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/empty-state';
import { Input } from '@/components/ui/input';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
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
          {/* Slot rating: se completează în Faza 9 — până atunci nu se afișează nimic */}
        </View>
        <MaterialIcons name="chevron-right" size={22} color={theme.textSecondary} />
      </ThemedView>
    </Pressable>
  );
}

export default function DriverSearchScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const { results, loading } = useMechanicSearch(query);

  const queryActive = query.trim().length >= SEARCH_MIN_LENGTH;

  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <ThemedText type="subtitle">{t('search.title')}</ThemedText>
      </View>

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
  header: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  searchBar: {
    paddingHorizontal: Spacing.four,
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
