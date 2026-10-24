import { Pressable, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/components/avatar';
import { RatingBadge } from '@/components/rating-badge';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { MechanicSearchResult } from '@/hooks/use-mechanic-search';

/**
 * Cardul de mecanic (PLAN_FAZA13.md §3.0) — extras din ecranul de căutare ca să
 * servească și rezultatele, și favoriții, și istoricul. Tot cardul navighează la
 * profil; steaua și X-ul sunt Pressable-uri IMBRICATE, deci tap-ul pe ele NU navighează.
 */

interface MechanicCardProps {
  mechanic: MechanicSearchResult;
  avatarUrl?: string;
  onPress: () => void;
  /** Steaua albastră (brand): plină = favorit. Fără `onToggleFavorite` → chevron, ca înainte. */
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  /** Istoric: X în colțul dreapta-sus care șterge intrarea (fără confirmare). */
  onRemove?: () => void;
}

export function MechanicCard({
  mechanic,
  avatarUrl,
  onPress,
  isFavorite = false,
  onToggleFavorite,
  onRemove,
}: MechanicCardProps) {
  const theme = useTheme();
  const { t } = useTranslation();

  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView type="backgroundElement" style={styles.card}>
        <Avatar url={avatarUrl} name={mechanic.full_name} size={44} userId={mechanic.id} />
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

        {onToggleFavorite ? (
          <Pressable
            onPress={onToggleFavorite}
            hitSlop={12}
            accessibilityLabel={t('favorites.toggle')}>
            <MaterialIcons
              name={isFavorite ? 'star' : 'star-outline'}
              size={24}
              color={theme.brand}
            />
          </Pressable>
        ) : (
          <MaterialIcons name="chevron-right" size={22} color={theme.textSecondary} />
        )}

        {onRemove ? (
          <Pressable
            onPress={onRemove}
            hitSlop={10}
            style={styles.remove}
            accessibilityLabel={t('search.historyRemove')}>
            <MaterialIcons name="close" size={16} color={theme.textSecondary} />
          </Pressable>
        ) : null}
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
  remove: {
    position: 'absolute',
    top: Spacing.one,
    right: Spacing.one,
    padding: Spacing.half,
  },
  pressed: { opacity: 0.7 },
});
