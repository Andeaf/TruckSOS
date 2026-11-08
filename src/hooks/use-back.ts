import { useCallback } from 'react';
import { BackHandler, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect, useRouter } from 'expo-router';

/** Ecranul a fost deschis dintr-un chat (conversație directă sau canal): grupul de rute,
 * tipul chatului și id-ul lui. */
export interface ReturnToConversation {
  group: 'driver' | 'mechanic';
  kind: 'conversation' | 'channel';
  conversationId: string;
}

/**
 * Back-ul din antet: urcă în istoric, iar fără istoric `replace(fallback)`.
 *
 * `returnTo` (1.1): profilurile (`mechanic-profile`, `public-profile`) sunt tab-uri ASCUNSE,
 * surori cu `conversations`, iar Tabs-ul are `backBehavior="initialRoute"` — deci din profil
 * `canGoBack()` e true și `router.back()` ducea pe tab-ul de START (Anunțuri / Feed), nu
 * înapoi în chat. Cu `returnTo`, back-ul (antetul și butonul fizic de pe Android) reactivează
 * tab-ul `conversations`, a cărui stivă (conversația deschisă) a rămas neatinsă. Dacă între
 * timp conversația nu mai e în vârful stivei, o deschide din nou.
 */
export function useBack(fallback: string, returnTo?: ReturnToConversation | null) {
  const navigation = useNavigation();
  const router = useRouter();
  const group = returnTo?.group;
  const kind = returnTo?.kind;
  const conversationId = returnTo?.conversationId;

  const goBack = useCallback(() => {
    if (group && kind && conversationId) {
      // Numele rutei din stiva `conversations`: `[id]` (directă) sau `channel/[id]` (canal).
      const routeName = kind === 'channel' ? 'channel/[id]' : '[id]';
      const tabs = navigation.getParent();
      const tab = tabs?.getState()?.routes.find((r) => r.name === 'conversations');
      const stack = tab?.state;
      const top = stack ? stack.routes[stack.index ?? stack.routes.length - 1] : undefined;
      const params = top?.params;
      if (
        tabs &&
        top?.name === routeName &&
        params &&
        'id' in params &&
        params.id === conversationId
      ) {
        // Fără params: TabRouter păstrează starea imbricată (conversația) a tab-ului.
        tabs.navigate('conversations');
      } else {
        router.push({
          pathname: `/(${group})/conversations/${routeName}`,
          params: { id: conversationId },
        } as never);
      }
      return;
    }
    if (navigation.canGoBack()) {
      router.back();
    } else {
      router.replace(fallback as never);
    }
  }, [group, kind, conversationId, navigation, router, fallback]);

  // Android: butonul fizic ar merge tot pe tab-ul de start (backBehavior) → același drum
  // ca antetul. iOS n-are buton fizic (iar profilul e primul ecran din stiva lui, fără swipe).
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android' || !conversationId) return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        goBack();
        return true;
      });
      return () => sub.remove();
    }, [conversationId, goBack])
  );

  return goBack;
}
