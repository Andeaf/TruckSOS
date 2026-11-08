import { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Cardul „Activează locația pentru distanțe” (1.1, 7.6 — AUDIT #34): în loc ca harta și
 * filtrul de rază să ceară permisiunea singure, la deschidere, explicăm întâi la ce folosește;
 * dialogul de sistem apare abia la apăsarea butonului (`onEnable`). Îl arată feed-ul și harta
 * mecanicului doar cât timp permisiunea se mai poate cere (`locationPermission === 'askable'`).
 * `floating`: umbră, pentru așezarea peste hartă.
 */
export function LocationPrimerCard({
  onEnable,
  floating = false,
  style,
}: {
  onEnable: () => Promise<unknown>;
  floating?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [busy, setBusy] = useState(false);

  async function handlePress() {
    if (busy) return;
    setBusy(true);
    try {
      await onEnable();
    } finally {
      setBusy(false);
    }
  }

  return (
    <ThemedView
      type="backgroundElement"
      style={[styles.card, floating && styles.floating, style]}>
      <View style={styles.row}>
        <View style={[styles.iconWrap, { backgroundColor: theme.brandSoft }]}>
          <MaterialIcons name="my-location" size={18} color={theme.brand} />
        </View>
        <View style={styles.texts}>
          <ThemedText type="smallBold" maxFontSizeMultiplier={1.3}>
            {t('permissions.locationTitle')}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" maxFontSizeMultiplier={1.3}>
            {t('permissions.locationBody')}
          </ThemedText>
        </View>
      </View>
      <Pressable
        onPress={() => void handlePress()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityState={{ disabled: busy, busy }}
        style={({ pressed }) => [
          styles.action,
          { backgroundColor: theme.brand },
          (pressed || busy) && styles.dimmed,
        ]}>
        {busy ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.actionLabel} maxFontSizeMultiplier={1.3}>
            {t('permissions.enableLocation')}
          </Text>
        )}
      </Pressable>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    padding: Spacing.three,
    borderRadius: Radius.card,
    gap: Spacing.two,
  },
  floating: {
    // Umbra ține cardul lizibil peste orice zonă a hărții (ca bulele de pe hartă).
    ...Platform.select({
      android: { elevation: 3 },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.2,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 },
      },
    }),
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: Radius.circle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texts: { flex: 1, gap: 2 },
  action: {
    alignSelf: 'flex-end',
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.control,
  },
  actionLabel: { color: '#fff', fontSize: 14, fontWeight: '600' },
  dimmed: { opacity: 0.7 },
});
