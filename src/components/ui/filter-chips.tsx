import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Radius, Shadows } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Rândul de pastile de filtrare de sub antet (redesign 22 iul 2026): pastila
 * activă e plină (navy, text alb), cele inactive albe cu umbră discretă.
 * Dimensiunile (13px/600, padding 7×16, gap 8, rând 14px 22px 4px) sunt cele
 * exacte din design. Touch target-ul de 44px e asigurat prin hitSlop.
 */

export interface FilterChipOption<K extends string> {
  key: K;
  label: string;
}

export function FilterChips<K extends string>({
  options,
  value,
  onChange,
}: {
  options: FilterChipOption<K>[];
  value: K;
  onChange: (key: K) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <Pressable
            key={opt.key}
            onPress={() => onChange(opt.key)}
            hitSlop={{ top: 8, bottom: 8, left: 2, right: 2 }}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[
              styles.chip,
              active
                ? { backgroundColor: theme.brand }
                : { backgroundColor: theme.backgroundElement, ...Shadows.chip },
            ]}>
            <Text
              style={[styles.label, { color: active ? '#FFFFFF' : theme.textSecondary }]}
              maxFontSizeMultiplier={1.2}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    // 4 pastile (filtrul „Acceptate", 5 aug) nu mai încap garantat pe o linie
    // pe ecrane înguste / în germană — fără wrap, ultima s-ar tăia mut.
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 22,
    paddingTop: 14,
    paddingBottom: 4,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: Radius.badge,
  },
  label: { fontSize: 13, fontWeight: '600' },
});
