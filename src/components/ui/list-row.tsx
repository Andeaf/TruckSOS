import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Rând de listă: iconiță + etichetă (+ valoare) + chevron. Baza ecranelor de profil/setări. */
export interface ListRowProps {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  /** Text discret în dreapta (ex. limba aleasă). */
  value?: string;
  onPress?: () => void;
  /** Roșu, fără chevron — pentru deconectare. */
  destructive?: boolean;
  /** `false` = rând informativ, fără chevron și fără apăsare (ex. „Conectat cu Google”). */
  chevron?: boolean;
}

export function ListRow({ icon, label, value, onPress, destructive, chevron = true }: ListRowProps) {
  const theme = useTheme();
  const color = destructive ? '#ef4444' : theme.text;

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView type="backgroundElement" style={styles.row}>
        <MaterialIcons name={icon} size={20} color={destructive ? '#ef4444' : theme.brand} />
        <ThemedText style={[styles.label, { color }]}>{label}</ThemedText>
        {value ? (
          <ThemedText themeColor="textSecondary" type="small">
            {value}
          </ThemedText>
        ) : null}
        {destructive || !chevron ? null : (
          <MaterialIcons name="chevron-right" size={20} color={theme.textSecondary} />
        )}
      </ThemedView>
    </Pressable>
  );
}

/** Rând cu comutator (ex. notificări pornite/oprite). Fără chevron: nu navighează nicăieri. */
export function SwitchRow({
  icon,
  label,
  value,
  onValueChange,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
}) {
  const theme = useTheme();

  return (
    <ThemedView type="backgroundElement" style={styles.row}>
      <MaterialIcons name={icon} size={20} color={theme.brand} />
      <ThemedText style={styles.label}>{label}</ThemedText>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ true: theme.brand, false: theme.backgroundSelected }}
      />
    </ThemedView>
  );
}

/** Etichetă mică de secțiune, deasupra unui grup de rânduri. */
export function SectionLabel({ children }: { children: string }) {
  return (
    <ThemedText themeColor="textSecondary" type="small" style={styles.sectionLabel}>
      {children.toUpperCase()}
    </ThemedText>
  );
}

/** Grup de rânduri lipite, cu un mic spațiu între ele. */
export function RowGroup({ children }: { children: React.ReactNode }) {
  return <View style={styles.group}>{children}</View>;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.card,
  },
  label: { flex: 1, fontSize: 15 },
  sectionLabel: { letterSpacing: 0.5, marginTop: Spacing.two },
  group: { gap: 2 },
  pressed: { opacity: 0.7 },
});
