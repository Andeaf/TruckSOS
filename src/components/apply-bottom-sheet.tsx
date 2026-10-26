import { useState, useEffect } from 'react';
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
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { RequiredMark } from '@/components/ui/input';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { SUPPORTED_CURRENCIES, DEFAULT_CURRENCY } from '@/constants/currencies';
import { useTheme } from '@/hooks/use-theme';
import { useSubmitGuard } from '@/hooks/use-submit-guard';
import { applyToAnnouncement, resubmitApplication } from '@/hooks/use-announcements';
import type { PriceType } from '@/types/database';

interface ApplyBottomSheetProps {
  visible: boolean;
  announcementId: string;
  onClose: () => void;
  onSuccess: () => void;
  applicationId?: string;
  initialData?: {
    priceType: PriceType;
    priceAmount: number;
    currency: string;
    message: string;
  };
}

export function ApplyBottomSheet({
  visible,
  announcementId,
  onClose,
  onSuccess,
  applicationId,
  initialData,
}: ApplyBottomSheetProps) {
  const { t } = useTranslation();
  const guard = useSubmitGuard();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [priceType, setPriceType] = useState<PriceType>('fixed');
  const [priceAmount, setPriceAmount] = useState('');
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY.code);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible && initialData) {
      setPriceType(initialData.priceType);
      setPriceAmount(String(initialData.priceAmount));
      setCurrency(initialData.currency);
      setMessage(initialData.message || '');
    }
    // Intenționat doar `visible`: formularul se repopulează la deschidere, nu la fiecare
    // schimbare a lui `initialData` (ar suprascrie ce tastează utilizatorul).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  function reset() {
    setPriceType('fixed');
    setPriceAmount('');
    setCurrency(DEFAULT_CURRENCY.code);
    setMessage('');
    setError('');
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit() {
    const amount = parseFloat(priceAmount.replace(',', '.'));
    if (!priceAmount.trim() || isNaN(amount) || amount <= 0) {
      setError(t('mechanic.apply.errorAmountRequired'));
      return;
    }

    setLoading(true);
    setError('');
    const err = applicationId
      ? await resubmitApplication(applicationId, priceType, amount, currency, message.trim() || null)
      : await applyToAnnouncement(announcementId, priceType, amount, currency, message.trim() || null);
    setLoading(false);

    if (err) {
      setError(
        err.includes('already') || err.includes('unique')
          ? t('mechanic.apply.errorAlreadyApplied')
          : t('mechanic.apply.errorSubmit'),
      );
      return;
    }

    reset();
    onSuccess();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
      statusBarTranslucent
      navigationBarTranslucent>
      <KeyboardAvoidingView
        style={styles.wrapper}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.backdrop} onPress={handleClose} />
        <View
          style={[
            styles.sheet,
            { backgroundColor: theme.backgroundElement },
            // Nativ: home indicator (iOS) / bara de navigare (Android edge-to-edge, SDK 54) — PLAN_1.1 Faza E.
            // Pe web insets.bottom e 0 și foaia păstrează padding-ul static de dinainte.
            Platform.OS !== 'web' && { paddingBottom: insets.bottom + Spacing.three },
          ]}>
          {/* Handle */}
          <View style={[styles.handle, { backgroundColor: theme.backgroundSelected }]} />

          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}>
            <ThemedText type="subtitle" style={styles.sheetTitle}>
              {applicationId ? t('mechanic.apply.resubmitSheetTitle') : t('mechanic.apply.sheetTitle')}
            </ThemedText>

            {/* Tip preț */}
            <View style={styles.fieldBlock}>
              <ThemedText type="smallBold" style={styles.label}>
                {t('mechanic.apply.priceTypeLabel')}
              </ThemedText>
              <View style={styles.segmented}>
                <Pressable
                  style={[styles.segment, priceType === 'fixed' && styles.segmentActive]}
                  onPress={() => setPriceType('fixed')}>
                  <ThemedText
                    style={[styles.segmentLabel, priceType === 'fixed' && styles.segmentLabelActive]}>
                    {t('mechanic.apply.priceTypeFixed')}
                  </ThemedText>
                </Pressable>
                <Pressable
                  style={[styles.segment, priceType === 'hourly' && styles.segmentActive]}
                  onPress={() => setPriceType('hourly')}>
                  <ThemedText
                    style={[styles.segmentLabel, priceType === 'hourly' && styles.segmentLabelActive]}>
                    {t('mechanic.apply.priceTypeHourly')}
                  </ThemedText>
                </Pressable>
              </View>
            </View>

            {/* Sumă + monedă */}
            <View style={styles.fieldBlock}>
              <ThemedText type="smallBold" style={styles.label}>
                {t('mechanic.apply.priceAmountLabel')}
                <RequiredMark />
              </ThemedText>
              <View style={styles.amountRow}>
                <TextInput
                  style={[
                    styles.amountInput,
                    {
                      color: theme.text,
                      backgroundColor: theme.background,
                      borderColor: theme.backgroundSelected,
                    },
                  ]}
                  value={priceAmount}
                  onChangeText={setPriceAmount}
                  placeholder={t('mechanic.apply.priceAmountPlaceholder')}
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="decimal-pad"
                />
                {/* Selector monedă */}
                <View style={styles.currencyRow}>
                  {SUPPORTED_CURRENCIES.map((c) => (
                    <Pressable
                      key={c.code}
                      style={[
                        styles.currencyChip,
                        { borderColor: currency === c.code ? '#22c55e' : theme.backgroundSelected },
                        currency === c.code && styles.currencyChipActive,
                      ]}
                      onPress={() => setCurrency(c.code)}>
                      <ThemedText
                        style={[
                          styles.currencyLabel,
                          { color: currency === c.code ? '#22c55e' : theme.textSecondary },
                        ]}>
                        {c.symbol} {c.code}
                      </ThemedText>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>

            {/* Mesaj opțional */}
            <View style={styles.fieldBlock}>
              <ThemedText type="smallBold" style={styles.label}>
                {t('mechanic.apply.messageLabel')}
              </ThemedText>
              <TextInput
                style={[
                  styles.amountInput,
                  styles.messageInput,
                  {
                    color: theme.text,
                    backgroundColor: theme.background,
                    borderColor: theme.backgroundSelected,
                  },
                ]}
                value={message}
                onChangeText={setMessage}
                placeholder={t('mechanic.apply.messagePlaceholder')}
                placeholderTextColor={theme.textSecondary}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>

            {error ? (
              <ThemedText style={styles.error}>{error}</ThemedText>
            ) : null}

            <Button
              title={applicationId ? t('mechanic.apply.resubmitButton') : t('mechanic.apply.submitButton')}
              onPress={() => void guard(handleSubmit)}
              loading={loading}
            />

            <ThemedText themeColor="textSecondary" type="small" style={styles.requiredNote}>
              {t('common.requiredNote')}
            </ThemedText>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    paddingBottom: Spacing.six,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: Radius.circle,
    alignSelf: 'center',
    marginTop: Spacing.two,
    marginBottom: Spacing.one,
  },
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  sheetTitle: {
    fontSize: 20,
    lineHeight: 28,
  },
  label: {
    marginBottom: Spacing.one,
  },
  fieldBlock: {
    gap: Spacing.one,
  },
  segmented: {
    flexDirection: 'row',
    borderRadius: Radius.control,
    borderWidth: 1.5,
    borderColor: '#22c55e',
    overflow: 'hidden',
  },
  segment: {
    flex: 1,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
  segmentActive: {
    backgroundColor: '#22c55e',
  },
  segmentLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#22c55e',
  },
  segmentLabelActive: {
    color: '#fff',
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  amountInput: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: Radius.control,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  currencyRow: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  currencyChip: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    borderRadius: Radius.control,
    borderWidth: 1.5,
  },
  currencyChipActive: {
    backgroundColor: '#f0fdf4',
  },
  currencyLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  messageInput: {
    height: 80,
    paddingTop: Spacing.two,
  },
  error: {
    color: '#ef4444',
    fontSize: 14,
  },
  requiredNote: { textAlign: 'center' },
});
