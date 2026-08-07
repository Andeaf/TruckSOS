import { useCallback } from 'react';
import { Alert, BackHandler, Platform } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

/**
 * Pe tab-ul de START (Anunțuri la șofer, Harta la mecanic) back-ul fizic nu mai
 * are unde să urce — întrebăm dacă utilizatorul chiar vrea să închidă aplicația
 * (cerere 7 aug: „de oriunde, back mă duce spre anunțuri; de acolo, mă întreabă").
 * Doar Android: iOS n-are buton de back, iar pe web decide browserul.
 */
export function useExitConfirm() {
  const { t } = useTranslation();
  const navigation = useNavigation();

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        // Mai există ceva de derulat înapoi (ecran în stivă) → navigarea se ocupă.
        if (navigation.canGoBack()) return false;
        Alert.alert(t('common.exitTitle'), t('common.exitMessage'), [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('common.exitConfirm'), onPress: () => BackHandler.exitApp() },
        ]);
        return true; // consumăm evenimentul — altfel Android închide direct
      });
      return () => sub.remove();
    }, [t, navigation])
  );
}
