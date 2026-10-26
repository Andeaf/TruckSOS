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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSubmitGuard } from '@/hooks/use-submit-guard';
import { REPORT_REASONS, submitReport, type ReportReason } from '@/hooks/use-reports';

/**
 * Bottom sheet de raportare (Faza 14.5): motiv predefinit + detalii opționale.
 * Se deschide din meniul contextual al unui mesaj (raport pe mesaj, cu snapshot) și
 * din profilul public (raport pe utilizator, fără message_id).
 */

interface ReportSheetProps {
  visible: boolean;
  reportedUserId: string;
  messageId?: string | null;
  messageTable?: 'messages' | 'channel_messages' | null;
  /** Faza 19: raport pe un anunț de market (snapshot-ul = titlu+descriere, cover-ul). */
  listingId?: string | null;
  contentSnapshot?: string | null;
  imagePathSnapshot?: string | null;
  onClose: () => void;
  /** Chemat la succes (parintele afișează confirmarea „raport trimis"). */
  onSubmitted: () => void;
}

export function ReportSheet({
  visible,
  reportedUserId,
  messageId,
  messageTable,
  listingId,
  contentSnapshot,
  imagePathSnapshot,
  onClose,
  onSubmitted,
}: ReportSheetProps) {
  const { t } = useTranslation();
  const guard = useSubmitGuard();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible) {
      setReason(null);
      setDetails('');
      setError('');
    }
  }, [visible]);

  async function handleSubmit() {
    if (!reason) {
      setError(t('report.errorReasonRequired'));
      return;
    }
    setLoading(true);
    setError('');
    const { error: err, duplicate } = await submitReport({
      reportedUserId,
      messageId,
      messageTable,
      listingId,
      reason,
      details,
      contentSnapshot,
      imagePathSnapshot,
    });
    setLoading(false);
    if (duplicate) {
      setError(t('report.alreadyReported'));
      return;
    }
    if (err) {
      setError(t('report.errorGeneric'));
      return;
    }
    onSubmitted();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent>
      <KeyboardAvoidingView
        style={styles.wrapper}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            { backgroundColor: theme.backgroundElement },
            // Nativ: home indicator (iOS) / bara de navigare (Android edge-to-edge, SDK 54) — PLAN_1.1 Faza E.
            // Pe web insets.bottom e 0 și foaia păstrează padding-ul static de dinainte.
            Platform.OS !== 'web' && { paddingBottom: insets.bottom + Spacing.three },
          ]}>
          <View style={[styles.handle, { backgroundColor: theme.backgroundSelected }]} />

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <ThemedText type="subtitle" style={styles.title}>
              {t('report.title')}
            </ThemedText>
            <ThemedText themeColor="textSecondary" type="small" style={styles.subtitle}>
              {t('report.subtitle')}
            </ThemedText>

            {REPORT_REASONS.map((r) => {
              const selected = reason === r;
              return (
                <Pressable
                  key={r}
                  onPress={() => setReason(r)}
                  style={[
                    styles.reasonRow,
                    { borderColor: selected ? theme.brand : theme.backgroundSelected },
                    selected && { backgroundColor: theme.backgroundSelected },
                  ]}>
                  <MaterialIcons
                    name={selected ? 'radio-button-checked' : 'radio-button-unchecked'}
                    size={20}
                    color={selected ? theme.brand : theme.textSecondary}
                  />
                  <ThemedText style={styles.reasonLabel}>{t(`report.reason.${r}`)}</ThemedText>
                </Pressable>
              );
            })}

            <TextInput
              style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
              value={details}
              onChangeText={setDetails}
              placeholder={t('report.detailsPlaceholder')}
              placeholderTextColor={theme.textSecondary}
              multiline
              maxLength={500}
            />

            {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}

            <Button title={t('report.submitButton')} onPress={() => void guard(handleSubmit)} loading={loading} />
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
  content: { padding: Spacing.four, gap: Spacing.two },
  title: { textAlign: 'center' },
  subtitle: { textAlign: 'center', marginBottom: Spacing.two },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.control,
    borderWidth: 1.5,
  },
  reasonLabel: { flex: 1 },
  input: {
    borderRadius: Radius.control,
    padding: Spacing.three,
    fontSize: 15,
    minHeight: 80,
    textAlignVertical: 'top',
    marginTop: Spacing.one,
  },
  error: { color: '#ef4444', fontSize: 14 },
});
