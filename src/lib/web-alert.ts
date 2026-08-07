import { Alert, Platform, type AlertButton } from 'react-native';

/**
 * Shim pentru WEB (7 aug): în react-native-web, `Alert.alert` e un NO-OP — orice
 * eroare sau confirmare afișată prin Alert era complet invizibilă în browser
 * (descoperit la verificarea variantei web: un login eșuat nu arăta nimic).
 * Mapăm pe dialogurile native ale browserului:
 *   - fără butoane / un singur buton → window.alert (+ onPress-ul butonului);
 *   - două+ butoane → window.confirm: OK = primul buton non-cancel, Cancel = cel
 *     cu style 'cancel'. Cazurile cu 3 butoane degradează la OK/Cancel — acceptabil
 *     pentru v1 web; pe nativ nimic nu se schimbă (modulul nu face nimic acolo).
 * Importat pentru efect secundar în src/app/_layout.tsx.
 */
if (Platform.OS === 'web') {
  Alert.alert = (title: string, message?: string, buttons?: AlertButton[]) => {
    const text = [title, message].filter(Boolean).join('\n\n');
    if (!buttons || buttons.length <= 1) {
      window.alert(text);
      buttons?.[0]?.onPress?.();
      return;
    }
    const confirmBtn = buttons.find((b) => b.style !== 'cancel');
    const cancelBtn = buttons.find((b) => b.style === 'cancel');
    if (window.confirm(text)) confirmBtn?.onPress?.();
    else cancelBtn?.onPress?.();
  };
}

export {};
