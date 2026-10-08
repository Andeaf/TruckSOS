import { useRef } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useUpdatePrompt } from '@/hooks/use-update-prompt';

/**
 * Mesajul „Versiune nouă disponibilă" (17 sept 2026): bottom sheet în stilul celorlalte
 * (handle, colțuri `Radius.card`, fundal `backgroundElement`), montat o dată în layout-ul
 * rădăcină, peste orice ecran. Logica (când, cât de des, ce link) e în useUpdatePrompt.
 * „Mai târziu" = închiderea cerută (la fel tap pe fundal / back pe Android);
 * „Actualizează" = fișa din magazin. Pe web nu apare niciodată (hook-ul nu produce nimic).
 */
export function UpdatePrompt({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { update, dismiss, openStore } = useUpdatePrompt(enabled);

  // Conținutul rămâne cât durează animația de închidere (update devine null instant).
  const lastShown = useRef(update);
  if (update) lastShown.current = update;
  const shown = update ?? lastShown.current;
  if (!shown) return null;

  const laterLabel = t('updatePrompt.later');

  return (
    <Modal
      visible={!!update}
      transparent
      animationType="slide"
      onRequestClose={dismiss}
      statusBarTranslucent>
      <View style={styles.wrapper}>
        <Pressable
          style={styles.backdrop}
          onPress={dismiss}
          accessibilityRole="button"
          accessibilityLabel={laterLabel}
        />
        <View
          style={[
            styles.sheet,
            { backgroundColor: theme.backgroundElement },
            // iOS: home indicator — același pattern ca RatingSheet / ActionSheet.
            Platform.OS === 'ios' && { paddingBottom: insets.bottom + Spacing.three },
          ]}>
          <View style={[styles.handle, { backgroundColor: theme.backgroundSelected }]} />

          <View style={[styles.iconWrap, { backgroundColor: theme.brandSoft }]}>
            <Feather name="download-cloud" size={26} color={theme.brand} />
          </View>

          <ThemedText style={styles.title} maxFontSizeMultiplier={1.3}>
            {t('updatePrompt.title')}
          </ThemedText>
          <ThemedText
            type="small"
            themeColor="textSecondary"
            style={styles.body}
            maxFontSizeMultiplier={1.3}>
            {t('updatePrompt.body', { version: shown.version })}
          </ThemedText>

          <View style={styles.actions}>
            <View style={styles.action}>
              <Button title={laterLabel} variant="secondary" onPress={dismiss} />
            </View>
            <View style={styles.action}>
              <Button title={t('updatePrompt.update')} onPress={() => void openStore()} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
    alignItems: 'center',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: Radius.badge,
    alignSelf: 'center',
    marginTop: Spacing.two,
    marginBottom: Spacing.three,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: Radius.circle,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.three,
  },
  title: { fontSize: 18, lineHeight: 24, fontWeight: '700', textAlign: 'center' },
  body: { textAlign: 'center', marginTop: Spacing.two },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.four,
    alignSelf: 'stretch',
  },
  action: { flex: 1 },
});
