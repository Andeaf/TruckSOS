import { StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
}

export function Input({ label, error, style, ...rest }: InputProps) {
  // `useTheme` (nu `useColorScheme`): culorile trebuie să urmeze preferința din
  // Setări, nu tema sistemului — altfel câmpurile rămân negre pe temă deschisă.
  const colors = useTheme();

  return (
    <View style={styles.container}>
      {label ? <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text> : null}
      <TextInput
        style={[
          styles.input,
          {
            color: colors.text,
            backgroundColor: colors.backgroundElement,
            borderColor: error ? '#ef4444' : colors.backgroundSelected,
          },
          style,
        ]}
        placeholderTextColor={colors.textSecondary}
        autoCapitalize="none"
        {...rest}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.one,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
  },
  input: {
    height: 50,
    borderRadius: Radius.control,
    borderWidth: 1.5,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  error: {
    color: '#ef4444',
    fontSize: 12,
  },
});
