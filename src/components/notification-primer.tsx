import { useRef } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useNotificationPrimerSheet } from '@/hooks/use-notification-primer';
import { useTheme } from '@/hooks/use-theme';

/**
 * Foaia „Află imediat când…” (1.1, 7.6 — AUDIT E.21), în șablonul `account-gate-sheet.tsx`
 * (handle, colțuri `Radius.card`, iconiță în cerc `brandSoft`), montată o dată în layout-ul
 * rădăcină. Logica (când, cât de des) e în useNotificationPrimer. „Continuă” → dialogul de
 * sistem (etichetă neutră: ghidul Apple 5.1.1(iv) nu acceptă „Permite” înaintea dialogului);
 * „Mai târziu” (la fel tap pe fundal / back pe Android) → pauză 7 zile.
 */
export function NotificationPrimer() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const { reason, allow, later } = useNotificationPrimerSheet();

  // Conținutul rămâne cât durează animația de închidere (reason devine null instant).
  const lastShown = useRef(reason);
  if (reason) lastShown.current = reason;
  const shown = reason ?? lastShown.current;
  if (!shown) return null;

  // Oferta o trimite doar mecanicul; altfel rolul din profil (adminul în modul șofer/mecanic
  // are rolul `admin` → textul de șofer, care se potrivește și lui).
  const mechanic = shown === 'application-sent' || profile?.role === 'mechanic';
  const benefits = mechanic
    ? [
        { icon: 'near-me' as const, text: t('permissions.notifMechanicNearby') },
        { icon: 'chat-bubble-outline' as const, text: t('permissions.notifMechanicMessages') },
      ]
    : [
        { icon: 'local-offer' as const, text: t('permissions.notifDriverOffers') },
        { icon: 'chat-bubble-outline' as const, text: t('permissions.notifDriverMessages') },
      ];
  const laterLabel = t('permissions.later');

  return (
    <Modal
      visible={!!reason}
      transparent
      animationType="slide"
      onRequestClose={later}
      statusBarTranslucent
      navigationBarTranslucent>
      <View style={styles.wrapper}>
        <Pressable
          style={styles.backdrop}
          onPress={later}
          accessibilityRole="button"
          accessibilityLabel={laterLabel}
        />
        <View
          style={[
            styles.sheet,
            { backgroundColor: theme.backgroundElement },
            // Nativ: home indicator (iOS) / bara de navigare (Android edge-to-edge, SDK 54).
            Platform.OS !== 'web' && { paddingBottom: insets.bottom + Spacing.three },
          ]}>
          <View style={[styles.handle, { backgroundColor: theme.backgroundSelected }]} />

          <View style={[styles.iconWrap, { backgroundColor: theme.brandSoft }]}>
            <Feather name="bell" size={26} color={theme.brand} />
          </View>

          <ThemedText style={styles.title} maxFontSizeMultiplier={1.3}>
            {t('permissions.notifTitle')}
          </ThemedText>
          <ThemedText
            type="small"
            themeColor="textSecondary"
            style={styles.body}
            maxFontSizeMultiplier={1.3}>
            {t(mechanic ? 'permissions.notifBodyMechanic' : 'permissions.notifBodyDriver')}
          </ThemedText>

          <View style={styles.benefits}>
            {benefits.map((b) => (
              <View key={b.icon + b.text} style={styles.benefitRow}>
                <MaterialIcons name={b.icon} size={18} color={theme.brand} />
                <ThemedText style={styles.benefitText} maxFontSizeMultiplier={1.3}>
                  {b.text}
                </ThemedText>
              </View>
            ))}
          </View>

          <ThemedText
            type="small"
            themeColor="textSecondary"
            style={styles.hint}
            maxFontSizeMultiplier={1.3}>
            {t('permissions.notifHint')}
          </ThemedText>

          <View style={styles.actions}>
            <Button title={t('permissions.allow')} onPress={allow} />
            <Pressable onPress={later} style={styles.later} accessibilityRole="button" hitSlop={8}>
              <ThemedText themeColor="textSecondary" style={styles.laterText} maxFontSizeMultiplier={1.3}>
                {laterLabel}
              </ThemedText>
            </Pressable>
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
  benefits: { alignSelf: 'stretch', gap: Spacing.two, marginTop: Spacing.three },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  benefitText: { flex: 1 },
  hint: { textAlign: 'center', marginTop: Spacing.three },
  actions: {
    gap: Spacing.two,
    marginTop: Spacing.four,
    alignSelf: 'stretch',
  },
  later: { alignSelf: 'center', paddingVertical: Spacing.two },
  laterText: { fontWeight: '600' },
});
