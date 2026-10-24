import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { clearAnnouncementDraft } from '@/lib/announcement-draft';

/**
 * 1.1 (B3): bannerul „Ai un anunț nepublicat” — apare deasupra listei de anunțuri când
 * există un draft salvat (oaspete: `useAuth().hasDraft`; cont: `pendingDraft`). Tap →
 * formularul, care se precompletează din draft. `discardable` adaugă „x”: șterge draftul
 * (cu confirmare) — altfel ar rămâne 7 zile și s-ar precompleta la fiecare anunț nou.
 */
export function AnnouncementDraftBanner({
  onPress,
  discardable = false,
}: {
  onPress: () => void;
  discardable?: boolean;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  const discard = () => {
    Alert.alert(t('guest.draftDiscard'), t('guest.draftDiscardConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('guest.draftDiscard'), style: 'destructive', onPress: () => void clearAnnouncementDraft() },
    ]);
  };

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.banner,
        { backgroundColor: theme.brandSoft, borderColor: theme.brand },
        pressed && styles.pressed,
      ]}>
      <MaterialIcons name="edit-note" size={22} color={theme.brand} />
      <View style={styles.texts}>
        <ThemedText type="smallBold" style={{ color: theme.brand }}>
          {t('guest.draftBanner')}
        </ThemedText>
      </View>
      {discardable ? (
        <Pressable
          onPress={discard}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('guest.draftDiscard')}>
          <MaterialIcons name="close" size={20} color={theme.brand} />
        </Pressable>
      ) : (
        <MaterialIcons name="chevron-right" size={22} color={theme.brand} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: 18,
    marginTop: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.card,
    borderWidth: 1,
  },
  texts: { flex: 1, gap: 2 },
  pressed: { opacity: 0.8 },
});
