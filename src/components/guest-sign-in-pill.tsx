import { Pressable, StyleSheet, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Radius, Spacing } from '@/constants/theme';
import { useAccountGate } from '@/hooks/use-account-gate';
import { useTheme } from '@/hooks/use-theme';

/**
 * 1.1 (B3): pastila „Intră în cont” din antetul ecranelor de oaspete — ia locul
 * butonului-avatar (oaspetele n-are profil). Tap → pop-upul de cont (B2).
 * Randată DOAR în grupul `(guest)` (vezi `HeaderProfileButton`).
 */
export function GuestSignInPill() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { requireAccount } = useAccountGate();

  return (
    <Pressable
      onPress={() => requireAccount('generic')}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={t('guest.signIn')}
      style={({ pressed }) => [styles.pill, pressed && styles.pressed]}>
      <Feather name="log-in" size={14} color={theme.onHeader} />
      <Text
        style={[styles.label, { color: theme.onHeader }]}
        numberOfLines={1}
        maxFontSizeMultiplier={1.2}>
        {t('guest.signIn')}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Același voal alb translucid ca search pill-ul din antetul Market.
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Radius.badge,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  label: { fontSize: 13, fontWeight: '700' },
  pressed: { opacity: 0.8 },
});
