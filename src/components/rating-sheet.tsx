import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { upsertRating } from '@/hooks/use-ratings';

/**
 * Bottom sheet de evaluare (PLAN_FAZA9.md §8): 5 stele + comentariu opțional.
 * Upsert pe (mechanic_id, driver_id) → a doua oară actualizează, nu dublează.
 * Se deschide din Istoric (locul principal) și din profilul mecanicului.
 */

interface RatingSheetProps {
  visible: boolean;
  mechanicId: string;
  mechanicName: string;
  driverId: string;
  /** Rating-ul existent, dacă șoferul a mai evaluat mecanicul (pre-completare). */
  initialStars?: number;
  initialComment?: string | null;
  onClose: () => void;
  onSaved: () => void;
}

export function RatingSheet({
  visible,
  mechanicId,
  mechanicName,
  driverId,
  initialStars,
  initialComment,
  onClose,
  onSaved,
}: RatingSheetProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible) {
      setStars(initialStars ?? 0);
      setComment(initialComment ?? '');
      setError('');
    }
  }, [visible, initialStars, initialComment]);

  async function handleSave() {
    if (stars < 1) {
      setError(t('rating.errorStarsRequired'));
      return;
    }
    setLoading(true);
    setError('');
    const err = await upsertRating(mechanicId, driverId, stars, comment.trim() || null);
    setLoading(false);
    if (err) {
      // RLS respinge dacă nu există anunț `resolved` comun — mesaj explicit, nu generic.
      setError(t('rating.errorNotAllowed'));
      return;
    }
    onSaved();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent>
      <KeyboardAvoidingView
        style={styles.wrapper}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: theme.backgroundElement }]}>
          <View style={[styles.handle, { backgroundColor: theme.backgroundSelected }]} />

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <ThemedText type="subtitle" style={styles.title}>
              {initialStars ? t('rating.sheetTitleEdit') : t('rating.sheetTitle')}
            </ThemedText>
            <ThemedText themeColor="textSecondary" type="small" style={styles.subtitle}>
              {mechanicName}
            </ThemedText>

            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map((i) => (
                <Pressable key={i} onPress={() => setStars(i)} hitSlop={6}>
                  <MaterialIcons
                    name={i <= stars ? 'star' : 'star-border'}
                    size={40}
                    color={i <= stars ? '#f59e0b' : theme.textSecondary}
                  />
                </Pressable>
              ))}
            </View>

            <ThemedText type="smallBold" style={styles.label}>
              {t('rating.commentLabel')}
            </ThemedText>
            <TextInput
              style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
              value={comment}
              onChangeText={setComment}
              placeholder={t('rating.commentPlaceholder')}
              placeholderTextColor={theme.textSecondary}
              multiline
              maxLength={500}
            />
            <ThemedText themeColor="textSecondary" type="small">
              {t('rating.anonymousHint')}
            </ThemedText>

            {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}

            <Button title={t('rating.saveButton')} onPress={handleSave} loading={loading} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    maxHeight: '85%',
    paddingBottom: Spacing.four,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: Radius.badge,
    alignSelf: 'center',
    marginTop: Spacing.two,
  },
  content: {
    padding: Spacing.four,
    gap: Spacing.two,
  },
  title: { textAlign: 'center' },
  subtitle: { textAlign: 'center', marginBottom: Spacing.two },
  starsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
  label: { marginTop: Spacing.one },
  input: {
    borderRadius: Radius.control,
    padding: Spacing.three,
    fontSize: 15,
    minHeight: 90,
    textAlignVertical: 'top',
  },
  error: { color: '#ef4444', fontSize: 14 },
});
