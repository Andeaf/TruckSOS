import { useState } from 'react';
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

import { Button } from '@/components/ui/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { SUPPORTED_CURRENCIES, DEFAULT_CURRENCY } from '@/constants/currencies';
import { applyToAnnouncement } from '@/hooks/use-announcements';
import type { PriceType } from '@/types/database';

interface ApplyBottomSheetProps {
  visible: boolean;
  announcementId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function ApplyBottomSheet({
  visible,
  announcementId,
  onClose,
  onSuccess,
}: ApplyBottomSheetProps) {
  const { t } = useTranslation();
  const [priceType, setPriceType] = useState<PriceType>('fixed');
  const [priceAmount, setPriceAmount] = useState('');
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY.code);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
    const err = await applyToAnnouncement(
      announcementId,
      priceType,
      amount,
      currency,
      message.trim() || null,
    );
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
      statusBarTranslucent>
      <KeyboardAvoidingView
        style={styles.wrapper}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.backdrop} onPress={handleClose} />
        <View style={styles.sheet}>
          {/* Handle */}
          <View style={styles.handle} />

          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}>
            <ThemedText type="subtitle" style={styles.sheetTitle}>
              {t('mechanic.apply.sheetTitle')}
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
              </ThemedText>
              <View style={styles.amountRow}>
                <TextInput
                  style={styles.amountInput}
                  value={priceAmount}
                  onChangeText={setPriceAmount}
                  placeholder={t('mechanic.apply.priceAmountPlaceholder')}
                  placeholderTextColor="#9ca3af"
                  keyboardType="decimal-pad"
                />
                {/* Selector monedă */}
                <View style={styles.currencyRow}>
                  {SUPPORTED_CURRENCIES.map((c) => (
                    <Pressable
                      key={c.code}
                      style={[
                        styles.currencyChip,
                        currency === c.code && styles.currencyChipActive,
                      ]}
                      onPress={() => setCurrency(c.code)}>
                      <ThemedText
                        style={[
                          styles.currencyLabel,
                          currency === c.code && styles.currencyLabelActive,
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
                style={[styles.amountInput, styles.messageInput]}
                value={message}
                onChangeText={setMessage}
                placeholder={t('mechanic.apply.messagePlaceholder')}
                placeholderTextColor="#9ca3af"
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>

            {error ? (
              <ThemedText style={styles.error}>{error}</ThemedText>
            ) : null}

            <Button
              title={t('mechanic.apply.submitButton')}
              onPress={handleSubmit}
              loading={loading}
            />
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
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: Spacing.six,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#d1d5db',
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
    borderRadius: Spacing.two,
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
    borderColor: '#d1d5db',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
    color: '#000',
  },
  currencyRow: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  currencyChip: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: 1.5,
    borderColor: '#d1d5db',
  },
  currencyChipActive: {
    borderColor: '#22c55e',
    backgroundColor: '#f0fdf4',
  },
  currencyLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6b7280',
  },
  currencyLabelActive: {
    color: '#22c55e',
  },
  messageInput: {
    height: 80,
    paddingTop: Spacing.two,
  },
  error: {
    color: '#ef4444',
    fontSize: 14,
  },
});
