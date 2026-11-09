import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsFocused } from '@react-navigation/native';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { usePushPermissionRequest } from '@/hooks/use-push-permission-request';
import { useTheme } from '@/hooks/use-theme';

/**
 * 7.10 (decizia lui David, 9 nov 2026): foaia se arată DOAR conturilor create după aplicarea migrării
 * 20261109000200 pe producție. Conturile de dinainte au avut push-ul Market pornit implicit — dacă azi e oprit,
 * utilizatorul a ales singur din Setări și a spus deja „nu”. Valoarea se setează la aplicarea fazei 6 (documentul de
 * aplicare, pasul „constanta 7.10”) ÎNAINTE de build-ul 1.1; până atunci e în viitor → foaia nu apare nimănui
 * (fail closed). Comparația e pe instant (Date.parse), nu pe text.
 */
export const MARKET_PUSH_OPTIN_SINCE = '2026-12-31T23:59:59Z';

function createdAfterOptInMigration(createdAt: string | null | undefined): boolean {
  if (!createdAt) return false;
  const t = Date.parse(createdAt);
  return Number.isFinite(t) && t >= Date.parse(MARKET_PUSH_OPTIN_SINCE);
}

/** O singură întrebare per cont, pe instalarea asta (cheia rămâne și după logout). Scrisă și de comutatorul
 *  „Notificări Market” din Setări: cine a ales singur nu mai e întrebat. */
export function marketPushPromptKey(userId: string): string {
  return `marketPushPrompt:${userId}`;
}
const promptKey = marketPushPromptKey;

/**
 * Pe iOS, un dialog de sistem cerut în timpul animației de închidere a unui Modal („slide”) poate
 * fi pierdut — aceeași precauție ca MODAL_CLOSE_DELAY_MS din use-push-permission-request.
 */
const MODAL_CLOSE_DELAY_MS = 700;

/**
 * Opt-in pentru notificările Market (1.1, 7.10). Din migrarea 20261109000200 conturile noi pornesc
 * cu `market_push_enabled = false`; la prima deschidere a Market-ului pe cont, foaia întreabă o
 * singură dată: „Da, anunță-mă” → `market_push_enabled = true` + dialogul sistemului (aceleași
 * gărzi ca peste tot: web / Expo Go / permisiune deja decisă → fără dialog); „Nu acum” (la fel tap
 * pe fundal / back pe Android) → nimic, comutatorul rămâne în Setări. Cheia se scrie în ambele
 * cazuri. Conturile cu push Market pornit (toate cele vechi, cu default-ul de azi) n-o văd;
 * oaspeții nici atât (fără profil). Șablonul vizual: `account-gate-sheet.tsx`.
 */
export function MarketPushOptInSheet({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session, profile, updateProfile } = useAuth();
  const { request } = usePushPermissionRequest();
  const userId = session?.user.id ?? null;
  // Doar profilul contului curent (la schimbarea contului profilul vechi poate rămâne un moment).
  const marketPushOff =
    profile != null &&
    profile.id === userId &&
    profile.market_push_enabled === false &&
    createdAfterOptInMigration(profile.created_at);
  const [visible, setVisible] = useState(false);
  // Contul pentru care foaia a fost deja arătată în montarea asta: actualizarea optimistă a
  // profilului sau un refetch nu o redeschid.
  const shownForRef = useRef<string | null>(null);
  // Doar cât ecranul Market e în față (review 9 nov): tab-ul rămâne montat după prima vizită, iar
  // oprirea comutatorului din Setări ar fi deschis foaia peste Setări.
  const isFocused = useIsFocused();

  useEffect(() => {
    if (!enabled || !isFocused || !userId || !marketPushOff) return;
    if (shownForRef.current === userId) return;
    let active = true;
    AsyncStorage.getItem(promptKey(userId))
      .then((stored) => {
        if (!active || stored) return;
        shownForRef.current = userId;
        setVisible(true);
      })
      .catch(() => {
        // Fără memorie locală nu întrebăm (am risca să întrebăm la fiecare deschidere).
      });
    return () => {
      active = false;
    };
  }, [enabled, isFocused, userId, marketPushOff]);

  function remember(uid: string, answer: 'accepted' | 'declined') {
    AsyncStorage.setItem(promptKey(uid), answer).catch(() => {
      // Fără memorie locală foaia poate reveni la o montare viitoare — acceptabil.
    });
  }

  function handleLater() {
    setVisible(false);
    if (userId) remember(userId, 'declined');
  }

  async function handleAccept() {
    setVisible(false);
    if (!userId) return;
    remember(userId, 'accepted');
    // Pe eroare, refetch-ul din updateProfile readuce valoarea reală (comutatorul din Setări rămâne).
    const error = await updateProfile({ market_push_enabled: true });
    if (error) {
      console.warn('[market] opt-in push nesalvat:', error);
      return;
    }
    setTimeout(
      () => request('market-opt-in'),
      Platform.OS === 'ios' ? MODAL_CLOSE_DELAY_MS : 0,
    );
  }

  const laterLabel = t('market.pushOptIn.later');

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleLater}
      statusBarTranslucent
      navigationBarTranslucent>
      <View style={styles.wrapper}>
        <Pressable
          style={styles.backdrop}
          onPress={handleLater}
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
            {t('market.pushOptIn.title')}
          </ThemedText>
          <ThemedText
            type="small"
            themeColor="textSecondary"
            style={styles.body}
            maxFontSizeMultiplier={1.3}>
            {t('market.pushOptIn.body')}
          </ThemedText>

          <View style={styles.actions}>
            <Button title={t('market.pushOptIn.accept')} onPress={() => void handleAccept()} />
            <Pressable
              onPress={handleLater}
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
