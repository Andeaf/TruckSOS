import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export default function MechanicConversationsScreen() {
  const insets = useSafeAreaInsets();

  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top + Spacing.three }]}>
      <ThemedText type="subtitle">Conversatii</ThemedText>

      {/* Placeholder — implementat în Etapa 6 */}
      <View style={styles.placeholder}>
        <ThemedText themeColor="textSecondary" style={styles.placeholderText}>
          Etapa 6: Conversatiile tale cu soferii vor aparea aici.
        </ThemedText>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: Spacing.four },
  placeholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: { textAlign: 'center' },
});
