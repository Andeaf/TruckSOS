import { type Ref, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  /** Câmp obligatoriu — adaugă „*" roșu după etichetă (convenția din toată aplicația). */
  required?: boolean;
  /** React 19: `ref` e prop obișnuit; ajunge la TextInput (focus pe câmpul următor). */
  ref?: Ref<TextInput>;
}

/**
 * Asteriscul de câmp obligatoriu, pentru etichetele care NU trec prin <Input>
 * (sheet-urile cu TextInput propriu, titluri de secțiune). Se pune ÎN interiorul
 * textului etichetei ca să curgă pe același rând.
 */
export function RequiredMark() {
  return <Text style={styles.requiredMark}> *</Text>;
}

export function Input({ label, error, required, style, secureTextEntry, ref, ...rest }: InputProps) {
  // `useTheme` (nu `useColorScheme`): culorile trebuie să urmeze preferința din
  // Setări, nu tema sistemului — altfel câmpurile rămân negre pe temă deschisă.
  const colors = useTheme();
  const { t } = useTranslation();
  // Câmpurile secure primesc automat un „ochi" de afișare/ascundere a parolei.
  const [hidden, setHidden] = useState(true);

  return (
    <View style={styles.container}>
      {label ? (
        <Text style={[styles.label, { color: colors.textSecondary }]}>
          {label}
          {required ? <RequiredMark /> : null}
        </Text>
      ) : null}
      <View>
        <TextInput
          ref={ref}
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
            accessibilityRole="button"
            accessibilityLabel={hidden ? t('a11y.showPassword') : t('a11y.hidePassword')}>
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
  requiredMark: {
    color: '#ef4444',
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
