import { StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

/**
 * „4.3 ★ (12)" — media denormalizată de pe `profiles` (PLAN_FAZA9.md §5).
 * Câmp „gratis": vine cu profilul deja adus, fără query în plus.
 * Fără evaluări → text discret, nu „0.0 ★".
 */

interface RatingBadgeProps {
  avg: number;
  count: number;
}

const STAR_COLOR = '#f59e0b';

export function RatingBadge({ avg, count }: RatingBadgeProps) {
  const { t } = useTranslation();

  if (count === 0) {
    return (
      <ThemedText themeColor="textSecondary" type="small">
        {t('rating.noRatings')}
      </ThemedText>
    );
  }

  return (
    <View style={styles.row}>
      <MaterialIcons name="star" size={14} color={STAR_COLOR} />
      <ThemedText type="smallBold">{avg.toFixed(1)}</ThemedText>
      <ThemedText themeColor="textSecondary" type="small">
        ({count})
      </ThemedText>
    </View>
  );
}

/** Rând de 5 stele (read-only), pt. un review individual. */
export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <View style={styles.stars}>
      {[1, 2, 3, 4, 5].map((i) => (
        <MaterialIcons
          key={i}
          name={i <= value ? 'star' : 'star-border'}
          size={size}
          color={STAR_COLOR}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  stars: { flexDirection: 'row', gap: 1 },
});
