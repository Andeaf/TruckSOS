import { useRef } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Faza 19.6: meniul „+" din chat ca GRILĂ de butoane, câte două pe rând (decizia
 * userului, 25 iul) — înlocuiește lista verticală de ActionSheet pentru atașamente.
 *
 * Păstrează EXACT dansul de închidere al ActionSheet-ului: pe iOS un view controller
 * nativ (document pickerul) NU se poate prezenta cât timp Modalul rulează animația
 * de închidere → acțiunea se amână până la `onDismiss` (prop declanșat doar pe iOS).
 */
export interface AttachOption {
  key: string;
  label: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  onPress: () => void;
}

interface AttachSheetProps {
  visible: boolean;
  title: string;
  options: AttachOption[];
  onClose: () => void;
}

export function AttachSheet({ visible, title, options, onClose }: AttachSheetProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const pendingRef = useRef<(() => void) | null>(null);

  function run(option: AttachOption) {
    if (Platform.OS === 'ios') {
      pendingRef.current = option.onPress;
      onClose();
      return;
    }
    onClose();
    option.onPress();
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

          <View style={styles.grid}>
            {options.map((option) => (
              <Pressable
                key={option.key}
                onPress={() => run(option)}
                style={({ pressed }) => [
                  styles.tile,
                  { backgroundColor: theme.background },
                  pressed && { backgroundColor: theme.backgroundSelected },
                ]}>
                <View style={[styles.tileIcon, { backgroundColor: theme.brandSoft }]}>
                  <MaterialIcons name={option.icon} size={24} color={theme.brand} />
                </View>
                <ThemedText type="small" style={styles.tileLabel} numberOfLines={2}>
                  {option.label}
                </ThemedText>
              </Pressable>
            ))}
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
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  tile: {
    width: '48.5%',
    borderRadius: Radius.card,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.two,
    alignItems: 'center',
    gap: Spacing.two,
  },
  tileIcon: {
    width: 46,
    height: 46,
    borderRadius: Radius.circle,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tileLabel: { textAlign: 'center', fontWeight: '600' },
});
