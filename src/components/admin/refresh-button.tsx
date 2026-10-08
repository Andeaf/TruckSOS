import { Pressable, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/hooks/use-theme';

/**
 * Butonul „Reîncarcă" al ecranelor admin (15 sept 2026). Completează pull-to-refresh-ul
 * listelor: pe telefon stă în antetul colorat (alb, `onHeader`), pe web lat lângă titlul
 * paginii — acolo nu există gestul de tragere, iar F5 reîncarcă toată aplicația.
 */
export function AdminRefreshButton({
  onPress,
  onHeader = false,
}: {
  onPress: () => void;
  /** În banda colorată a antetului (iconiță albă) vs. în pagină (culoarea secundară). */
  onHeader?: boolean;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={t('admin.common.refresh')}
      style={({ pressed }) => (pressed ? styles.pressed : null)}>
      <MaterialIcons name="refresh" size={24} color={onHeader ? theme.onHeader : theme.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.6 },
});
