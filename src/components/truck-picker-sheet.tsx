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
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { addTruck } from '@/hooks/use-trucks';
import type { Truck } from '@/types/database';

const CURRENT_YEAR = new Date().getFullYear();

interface TruckPickerSheetProps {
  visible: boolean;
  trucks: Truck[];
  driverId: string;
  onSelect: (data: { make: string; model: string; year: number }) => void;
  onRefresh: () => void;
  onClose: () => void;
}

export function TruckPickerSheet({
  visible,
  trucks,
  driverId,
  onSelect,
  onRefresh,
  onClose,
}: TruckPickerSheetProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [addFormOpen, setAddFormOpen] = useState(false);
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [yearStr, setYearStr] = useState('');
  const [nickname, setNickname] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function handleClose() {
    setAddFormOpen(false);
    setMake(''); setModel(''); setYearStr(''); setNickname('');
    setError('');
    onClose();
  }

  function handleSelect(truck: Truck) {
    onSelect({ make: truck.make, model: truck.model, year: truck.year });
    handleClose();
  }

  async function handleAddSave() {
    if (!make.trim()) { setError(t('truck.errorMakeRequired')); return; }
    if (!model.trim()) { setError(t('truck.errorModelRequired')); return; }
    const year = parseInt(yearStr, 10);
    if (!yearStr || isNaN(year) || year < 1950 || year > CURRENT_YEAR) {
      setError(t('truck.yearError', { maxYear: CURRENT_YEAR }));
      return;
    }
    setLoading(true);
    setError('');
    const err = await addTruck({
      driver_id: driverId,
      make: make.trim(),
      model: model.trim(),
      year,
      nickname: nickname.trim() || null,
    });
    setLoading(false);
    if (err) { setError(t('truck.errorSave')); return; }
    onRefresh();
    onSelect({ make: make.trim(), model: model.trim(), year });
    handleClose();
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
        <View style={[styles.sheet, { backgroundColor: theme.backgroundElement }]}>
          <View style={[styles.handle, { backgroundColor: theme.backgroundSelected }]} />
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <ThemedText type="subtitle" style={styles.title}>
              {t('truck.savedTitle')}
            </ThemedText>

            {trucks.map((truck) => (
              <Pressable key={truck.id} onPress={() => handleSelect(truck)}>
                <ThemedView type="backgroundSelected" style={styles.truckRow}>
                  <MaterialIcons name="local-shipping" size={18} color={theme.textSecondary} />
                  <ThemedText style={styles.truckRowText}>
                    {truck.nickname ? `${truck.nickname} — ` : ''}{truck.make} {truck.model} {truck.year}
                  </ThemedText>
                  <MaterialIcons name="chevron-right" size={18} color={theme.textSecondary} />
                </ThemedView>
              </Pressable>
            ))}

            <Pressable
              onPress={() => setAddFormOpen((v) => !v)}
              style={styles.addToggle}
              hitSlop={8}>
              <MaterialIcons
                name={addFormOpen ? 'expand-less' : 'add'}
                size={18}
                color="#208AEF"
              />
              <ThemedText style={styles.addToggleText}>{t('truck.addNewInPicker')}</ThemedText>
            </Pressable>

            {addFormOpen ? (
              <View style={styles.miniForm}>
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
                <Button title={t('truck.addSheetTitle')} onPress={handleAddSave} loading={loading} />
              </View>
            ) : null}
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
  truckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Spacing.two,
    padding: Spacing.three,
  },
  truckRowText: { flex: 1, fontSize: 14 },
  addToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    alignSelf: 'flex-start',
    paddingVertical: Spacing.one,
  },
  addToggleText: { color: '#208AEF', fontSize: 14, fontWeight: '500' },
  miniForm: { gap: Spacing.three },
  fieldBlock: { gap: Spacing.one },
  label: { marginBottom: Spacing.one },
  input: {
    borderWidth: 1.5,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  error: { color: '#ef4444', fontSize: 14 },
});
