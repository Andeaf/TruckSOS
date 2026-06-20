import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { Spacing } from '@/constants/theme';

interface ButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
}

export function Button({
  title,
  onPress,
  loading = false,
  disabled = false,
  variant = 'primary',
}: ButtonProps) {
  const isPrimary = variant === 'primary';
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        isPrimary ? styles.primary : styles.secondary,
        (pressed || isDisabled) && styles.dimmed,
      ]}>
      {loading ? (
        <ActivityIndicator color={isPrimary ? '#fff' : '#208AEF'} />
      ) : (
        <Text style={[styles.label, !isPrimary && styles.labelSecondary]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 50,
    borderRadius: Spacing.two,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
  },
  primary: {
    backgroundColor: '#208AEF',
  },
  secondary: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: '#208AEF',
  },
  dimmed: {
    opacity: 0.55,
  },
  label: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  labelSecondary: {
    color: '#208AEF',
  },
});
