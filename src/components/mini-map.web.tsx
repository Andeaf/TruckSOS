import { StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Varianta de web: `react-native-maps` nu rulează în browser, iar un import al lui
 * ar rupe bundle-ul web. Metro alege automat acest fișier pe web, deci librăria nici
 * nu ajunge în bundle — arătăm coordonatele ca text, ca înainte de Faza 11.
 */
export function MiniMap({
  latitude,
  longitude,
  height = 160,
}: {
  latitude: number;
  longitude: number;
  height?: number;
}) {
  const theme = useTheme();

  return (
    <ThemedView type="backgroundElement" style={[styles.wrapper, { height }]}>
      <View style={styles.row}>
        <MaterialIcons name="place" size={16} color={theme.textSecondary} />
        <ThemedText themeColor="textSecondary" type="small">
          {latitude}, {longitude}
        </ThemedText>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderRadius: Radius.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
});
