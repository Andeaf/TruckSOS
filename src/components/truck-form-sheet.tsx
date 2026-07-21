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
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Truck } from '@/types/database';

const CURRENT_YEAR = new Date().getFullYear();

interface TruckFormSheetProps {
  visible: boolean;
  initialData?: Pick<Truck, 'id' | 'make' | 'model' | 'year' | 'nickname' | 'plate_number'>;
  onSave: (data: {
    make: string;
    model: string;
    year: number;
    nickname: string | null;
    plate_number: string | null;
  }) => Promise<void>;
  onClose: () => void;
}

export function TruckFormSheet({ visible, initialData, onSave, onClose }: TruckFormSheetProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [yearStr, setYearStr] = useState('');
  const [nickname, setNickname] = useState('');
  const [plateNumber, setPlateNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible) {
      setMake(initialData?.make ?? '');
      setModel(initialData?.model ?? '');
      setYearStr(initialData?.year ? String(initialData.year) : '');
      setNickname(initialData?.nickname ?? '');
      setPlateNumber(initialData?.plate_number ?? '');
      setError('');
    }
  }, [visible, initialData]);

  async function handleSave() {
    if (!make.trim()) { setError(t('truck.errorMakeRequired')); return; }
    if (!model.trim()) { setError(t('truck.errorModelRequired')); return; }
    const year = parseInt(yearStr, 10);
    if (!yearStr || isNaN(year) || year < 1950 || year > CURRENT_YEAR) {
      setError(t('truck.yearError', { maxYear: CURRENT_YEAR }));
      return;
    }
    setLoading(true);
    setError('');
    await onSave({
      make: make.trim(),
      model: model.trim(),
      year,
      nickname: nickname.trim() || null,
      plate_number: plateNumber.trim().toUpperCase() || null,
    });
    setLoading(false);
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
        <View
          style={[
            styles.sheet,
            { backgroundColor: theme.backgroundElement },
            // iOS: home indicator — pattern-ul ActionSheet (PLAN_FAZA17.md L2); Android neatins.
            Platform.OS === 'ios' && { paddingBottom: insets.bottom + Spacing.three },
          ]}>
          <View style={[styles.handle, { backgroundColor: theme.backgroundSelected }]} />
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <ThemedText type="subtitle" style={styles.title}>
              {initialData ? t('truck.editSheetTitle') : t('truck.addSheetTitle')}
            </ThemedText>

            <View style={styles.fieldBlock}>
              <ThemedText type="smallBold" style={styles.label}>{t('truck.makeLabel')}</ThemedText>
              <TextInput
                style={[styles.input, { color: theme.text, backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}
                value={make}
                onChangeText={setMake}
                placeholder={t('truck.makePlaceholder')}
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="words"
              />
            </View>

            <View style={styles.fieldBlock}>
              <ThemedText type="smallBold" style={styles.label}>{t('truck.modelLabel')}</ThemedText>
              <TextInput
                style={[styles.input, { color: theme.text, backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}
                value={model}
                onChangeText={setModel}
                placeholder={t('truck.modelPlaceholder')}
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="words"
              />
            </View>

            <View style={styles.fieldBlock}>
              <ThemedText type="smallBold" style={styles.label}>{t('truck.yearLabel')}</ThemedText>
              <TextInput
                style={[styles.input, { color: theme.text, backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}
                value={yearStr}
                onChangeText={setYearStr}
                placeholder={t('truck.yearPlaceholder')}
                placeholderTextColor={theme.textSecondary}
                keyboardType="number-pad"
              />
            </View>

            <View style={styles.fieldBlock}>
              <ThemedText type="smallBold" style={styles.label}>{t('truck.nicknameLabel')}</ThemedText>
              <TextInput
                style={[styles.input, { color: theme.text, backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}
                value={nickname}
                onChangeText={setNickname}
                placeholder={t('truck.nicknamePlaceholder')}
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="sentences"
              />
            </View>

            <View style={styles.fieldBlock}>
              <ThemedText type="smallBold" style={styles.label}>{t('truck.plateLabel')}</ThemedText>
              <TextInput
                style={[styles.input, { color: theme.text, backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}
                value={plateNumber}
                onChangeText={setPlateNumber}
                placeholder={t('truck.platePlaceholder')}
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={12}
              />
            </View>

            {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}

            <Button title={t('profile.saveButton')} onPress={handleSave} loading={loading} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { borderTopLeftRadius: Radius.card, borderTopRightRadius: Radius.card, paddingBottom: Spacing.six },
  handle: { width: 40, height: 4, borderRadius: Radius.circle, alignSelf: 'center', marginTop: Spacing.two, marginBottom: Spacing.one },
  content: { padding: Spacing.four, gap: Spacing.three },
  title: { fontSize: 20, lineHeight: 28 },
  label: { marginBottom: Spacing.one },
  fieldBlock: { gap: Spacing.one },
  input: {
    borderWidth: 1.5,
    borderRadius: Radius.control,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  error: { color: '#ef4444', fontSize: 14 },
});
