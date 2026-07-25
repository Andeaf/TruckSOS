import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
}

export function Input({ label, error, style, secureTextEntry, ...rest }: InputProps) {
  // `useTheme` (nu `useColorScheme`): culorile trebuie să urmeze preferința din
  // Setări, nu tema sistemului — altfel câmpurile rămân negre pe temă deschisă.
  const colors = useTheme();
  // Câmpurile secure primesc automat un „ochi" de afișare/ascundere a parolei.
  const [hidden, setHidden] = useState(true);

  return (
    <View style={styles.container}>
      {label ? <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text> : null}
      <View>
        <TextInput
          style={[
            styles.input,
            {
              color: colors.text,
              backgroundColor: colors.backgroundElement,
              borderColor: error ? '#ef4444' : colors.backgroundSelected,
            },
            secureTextEntry && styles.inputSecure,
            style,
          ]}
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="none"
          secureTextEntry={secureTextEntry && hidden}
          {...rest}
        />
        {secureTextEntry ? (
          <Pressable
            style={styles.eye}
            hitSlop={8}
            onPress={() => setHidden((h) => !h)}
            accessibilityRole="button">
            <MaterialIcons
              name={hidden ? 'visibility' : 'visibility-off'}
              size={22}
              color={colors.textSecondary}
            />
          </Pressable>
        ) : null}
      </View>
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
  inputSecure: {
    paddingRight: 48,
  },
  eye: {
    position: 'absolute',
    right: Spacing.three,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  error: {
    color: '#ef4444',
    fontSize: 12,
  },
});
