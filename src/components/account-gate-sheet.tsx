import { useRef } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { usePathname, useRouter, useSegments } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useAccountGateSheet } from '@/hooks/use-account-gate';
import { useTheme } from '@/hooks/use-theme';
import { setPendingLink } from '@/lib/pending-link';

/**
 * Foaia „Ai nevoie de un cont" (1.1, Faza B2) — șablonul `update-prompt.tsx` (handle,
 * colțuri `Radius.card`, iconiță în cerc `brandSoft`), montată o dată în layout-ul
 * rădăcină. O deschide `useAccountGate().requireAccount(motiv)` când un oaspete încearcă
 * o acțiune care cere cont. „Creează cont" / „Am deja cont" țin minte ecranul curent
 * (linkul amânat, persistent) ca după cont omul să revină unde era; „Mai târziu" (la fel
 * tap pe fundal / back pe Android) doar închide.
 */
export function AccountGateSheet() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const segments = useSegments() as string[];
  const { reason, close } = useAccountGateSheet();

  // Conținutul rămâne cât durează animația de închidere (reason devine null instant).
  const lastShown = useRef(reason);
  if (reason) lastShown.current = reason;
  const shown = reason ?? lastShown.current;
  if (!shown) return null;

  /**
   * Calea CU grupul (`/(guest)/market/<id>`): fără el URL-ul e ambiguu (aceeași cale
   * există în (driver)/(mechanic)/(guest)), iar garda o traduce pentru rolul contului
   * (`resolvePendingLink`). Din ecranele de autentificare nu ținem nimic minte.
   */
  function rememberCurrentScreen() {
    const group = segments[0];
    if (group === '(auth)') return;
    const isGroup = !!group && group.startsWith('(') && group.endsWith(')');
    const path = isGroup ? `/${group}${pathname === '/' ? '' : pathname}` : pathname;
    if (path) setPendingLink(path);
  }

  function goTo(target: '/(auth)/register' | '/(auth)/login') {
    rememberCurrentScreen();
    close();
    router.push(target);
  }

  const laterLabel = t('accountGate.later');

  return (
    <Modal
      visible={!!reason}
      transparent
      animationType="slide"
      onRequestClose={close}
      statusBarTranslucent
      navigationBarTranslucent>
      <View style={styles.wrapper}>
        <Pressable
          style={styles.backdrop}
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel={laterLabel}
        />
        <View
          style={[
            styles.sheet,
            { backgroundColor: theme.backgroundElement },
            // Nativ: home indicator (iOS) / bara de navigare (Android edge-to-edge, SDK 54) — PLAN_1.1 Faza E.
            Platform.OS !== 'web' && { paddingBottom: insets.bottom + Spacing.three },
          ]}>
          <View style={[styles.handle, { backgroundColor: theme.backgroundSelected }]} />

          <View style={[styles.iconWrap, { backgroundColor: theme.brandSoft }]}>
            <Feather name="user-plus" size={26} color={theme.brand} />
          </View>

          <ThemedText style={styles.title} maxFontSizeMultiplier={1.3}>
            {t('accountGate.title')}
          </ThemedText>
          <ThemedText
            type="small"
            themeColor="textSecondary"
            style={styles.body}
            maxFontSizeMultiplier={1.3}>
            {t(`accountGate.reason.${shown}`)}
          </ThemedText>

          <View style={styles.actions}>
            <Button title={t('accountGate.create')} onPress={() => goTo('/(auth)/register')} />
            <Button
              title={t('accountGate.haveAccount')}
              variant="secondary"
              onPress={() => goTo('/(auth)/login')}
            />
            <Pressable
              onPress={close}
              style={styles.later}
              accessibilityRole="button"
              hitSlop={8}>
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
  actions: {
    gap: Spacing.two,
    marginTop: Spacing.four,
    alignSelf: 'stretch',
  },
  later: { alignSelf: 'center', paddingVertical: Spacing.two },
  laterText: { fontWeight: '600' },
});
