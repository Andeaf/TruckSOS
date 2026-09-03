import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface ButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  /** `success` = verde plin, aceeași înălțime ca `primary` (buton de contact pe anunț). */
  variant?: 'primary' | 'secondary' | 'danger' | 'success';
}

export function Button({
  title,
  onPress,
  loading = false,
  disabled = false,
  variant = 'primary',
}: ButtonProps) {
  const theme = useTheme();
  const isDisabled = disabled || loading;

  function variantStyle() {
    if (variant === 'danger') return styles.danger;
    if (variant === 'success') return { backgroundColor: theme.successSolid };
    if (variant === 'secondary')
      return { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: theme.brand };
    return { backgroundColor: theme.primary };
  }

  function indicatorColor() {
    if (variant === 'secondary') return theme.brand;
    return '#fff';
  }

  function labelStyle() {
    if (variant === 'secondary') return { color: theme.brand };
    return undefined;
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        variantStyle(),
        (pressed || isDisabled) && styles.dimmed,
      ]}>
      {loading ? (
        <ActivityIndicator color={indicatorColor()} />
      ) : (
        <Text style={[styles.label, labelStyle()]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 50,
    borderRadius: Radius.control,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
  },
  danger: {
    backgroundColor: '#ef4444',
  },
  dimmed: {
    opacity: 0.55,
  },
  label: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
