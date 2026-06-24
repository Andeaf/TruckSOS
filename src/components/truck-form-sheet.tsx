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

import { Button } from '@/components/ui/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Truck } from '@/types/database';

const CURRENT_YEAR = new Date().getFullYear();

interface TruckFormSheetProps {
  visible: boolean;
  initialData?: Pick<Truck, 'id' | 'make' | 'model' | 'year' | 'nickname'>;
  onSave: (data: { make: string; model: string; year: number; nickname: string | null }) => Promise<void>;
  onClose: () => void;
}

export function TruckFormSheet({ visible, initialData, onSave, onClose }: TruckFormSheetProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [yearStr, setYearStr] = useState('');
  const [nickname, setNickname] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible) {
      setMake(initialData?.make ?? '');
      setModel(initialData?.model ?? '');
      setYearStr(initialData?.year ? String(initialData.year) : '');
      setNickname(initialData?.nickname ?? '');
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
    await onSave({ make: make.trim(), model: model.trim(), year, nickname: nickname.trim() || null });
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
        <View style={[styles.sheet, { backgroundColor: theme.backgroundElement }]}>
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
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: Spacing.six },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: Spacing.two, marginBottom: Spacing.one },
  content: { padding: Spacing.four, gap: Spacing.three },
  title: { fontSize: 20, lineHeight: 28 },
  label: { marginBottom: Spacing.one },
  fieldBlock: { gap: Spacing.one },
  input: {
    borderWidth: 1.5,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  error: { color: '#ef4444', fontSize: 14 },
});
