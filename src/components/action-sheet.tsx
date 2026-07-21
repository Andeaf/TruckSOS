import { useRef } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Bottom sheet cu acțiuni — înlocuiește `Alert.alert` cu listă de butoane.
 * Motiv: pe Android, `Alert` afișează CEL MULT 3 butoane, iar al patrulea (de obicei
 * „Anulează") e tăiat tăcut → utilizatorul rămâne fără cale de ieșire.
 *
 * Aici ieșirea e garantată în trei feluri: butonul X, tap pe fundal și butonul
 * fizic de back (`onRequestClose`).
 */

export interface SheetAction {
  label: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  destructive?: boolean;
  onPress: () => void;
}

interface ActionSheetProps {
  visible: boolean;
  title: string;
  actions: SheetAction[];
  onClose: () => void;
}

export function ActionSheet({ visible, title, actions, onClose }: ActionSheetProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const pendingRef = useRef<(() => void) | null>(null);

  // Închidem întâi sheet-ul, apoi rulăm acțiunea: pickerul de poze deschide un ecran
  // nativ, iar un modal încă vizibil dedesubt îl poate bloca pe Android.
  // Pe iOS nu e suficient: un view controller (pickerul) NU se poate prezenta cât timp
  // Modalul încă rulează animația de închidere — acțiunea pornea în gol (verificat pe
  // iPhone real la avatar). Amânăm până la `onDismiss` (prop declanșat doar pe iOS).
  function run(action: SheetAction) {
    if (Platform.OS === 'ios') {
      pendingRef.current = action.onPress;
      onClose();
      return;
    }
    onClose();
    action.onPress();
  }

  function handleDismiss() {
    const pending = pendingRef.current;
    pendingRef.current = null;
    pending?.();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      onDismiss={handleDismiss}
      statusBarTranslucent>
      <View style={styles.wrapper}>
        <Pressable style={styles.backdrop} onPress={onClose} />

        {/* Modalul e edge-to-edge (statusBarTranslucent) → ultima acțiune ar cădea sub
            bara de navigație Android dacă n-am adăuga inset-ul de jos. */}
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.backgroundElement,
              paddingBottom: insets.bottom + Spacing.three,
            },
          ]}>
          <View style={styles.header}>
            <ThemedText type="smallBold">{title}</ThemedText>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel={t('photos.close')}>
              <MaterialIcons name="close" size={22} color={theme.textSecondary} />
            </Pressable>
          </View>

          {actions.map((action) => (
            <Pressable
              key={action.label}
              onPress={() => run(action)}
              style={({ pressed }) => [
                styles.row,
                pressed && { backgroundColor: theme.backgroundSelected },
              ]}>
              <MaterialIcons
                name={action.icon}
                size={20}
                color={action.destructive ? '#ef4444' : theme.text}
              />
              <ThemedText style={action.destructive ? styles.destructive : undefined}>
                {action.label}
              </ThemedText>
            </Pressable>
          ))}
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
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  destructive: { color: '#ef4444' },
});
