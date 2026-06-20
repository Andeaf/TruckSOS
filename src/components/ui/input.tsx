import { StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';
import { useColorScheme } from 'react-native';

import { Colors, Spacing } from '@/constants/theme';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
}

export function Input({ label, error, style, ...rest }: InputProps) {
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];

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
    borderRadius: Spacing.two,
    borderWidth: 1.5,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  error: {
    color: '#ef4444',
    fontSize: 12,
  },
});
