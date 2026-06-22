import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useBack } from '@/hooks/use-back';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { createAnnouncement } from '@/hooks/use-announcements';

const CURRENT_YEAR = new Date().getFullYear();

export default function NewAnnouncementScreen() {
  const { session } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();
  const goBack = useBack('/(driver)/announcements');
  const insets = useSafeAreaInsets();

  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [truckSectionOpen, setTruckSectionOpen] = useState(false);
  const [truckMake, setTruckMake] = useState('');
  const [truckModel, setTruckModel] = useState('');
  const [truckYearStr, setTruckYearStr] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit() {
    if (!description.trim()) { setError(t('driver.announcements.errorDescription')); return; }
    if (!location.trim()) { setError(t('driver.announcements.errorLocation')); return; }
    if (!session) return;

    let truckYear: number | null = null;
    if (truckYearStr.trim()) {
      const parsed = parseInt(truckYearStr.trim(), 10);
      if (isNaN(parsed) || parsed < 1950 || parsed > CURRENT_YEAR) {
        setError(t('truck.yearError', { maxYear: CURRENT_YEAR }));
        return;
      }
      truckYear = parsed;
    }

    setLoading(true);
    setError('');
    const err = await createAnnouncement(
      session.user.id,
      description.trim(),
      location.trim(),
      truckMake.trim() || undefined,
      truckModel.trim() || undefined,
      truckYear,
    );
    setLoading(false);

    if (err) { setError(err); return; }
    goBack();
  }

  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={goBack} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={24} color="#60646C" />
        </Pressable>
        <ThemedText type="subtitle" style={styles.title}>{t('driver.announcements.newTitle')}</ThemedText>
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={styles.form}
          keyboardShouldPersistTaps="handled">

          <Input
            label={t('driver.announcements.locationLabel')}
            value={location}
            onChangeText={setLocation}
            placeholder={t('driver.announcements.locationPlaceholder')}
            autoCapitalize="sentences"
          />

          <Input
            label={t('driver.announcements.descriptionLabel')}
            value={description}
            onChangeText={setDescription}
            placeholder={t('driver.announcements.descriptionPlaceholder')}
            autoCapitalize="sentences"
            multiline
            numberOfLines={5}
            style={styles.textarea}
          />

          <Pressable
            onPress={() => setTruckSectionOpen((v) => !v)}
            style={styles.truckToggle}
            hitSlop={8}>
            <ThemedText themeColor="textSecondary" type="small">
              {truckSectionOpen
                ? t('truck.sectionToggleHide')
                : t('truck.sectionToggleAdd')}
            </ThemedText>
            <MaterialIcons
              name={truckSectionOpen ? 'expand-less' : 'expand-more'}
              size={18}
              color="#60646C"
            />
          </Pressable>

          {truckSectionOpen ? (
            <View style={styles.truckSection}>
              <Input
                label={t('truck.makeLabel')}
                value={truckMake}
                onChangeText={setTruckMake}
                placeholder={t('truck.makePlaceholder')}
                autoCapitalize="words"
              />
              <Input
                label={t('truck.modelLabel')}
                value={truckModel}
                onChangeText={setTruckModel}
                placeholder={t('truck.modelPlaceholder')}
                autoCapitalize="characters"
              />
              <Input
                label={t('truck.yearLabel')}
                value={truckYearStr}
                onChangeText={setTruckYearStr}
                placeholder={t('truck.yearPlaceholder')}
                keyboardType="number-pad"
                maxLength={4}
              />
            </View>
          ) : null}

          {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}

          <Button title={t('driver.announcements.submitButton')} onPress={handleSubmit} loading={loading} />
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  title: { fontSize: 22, lineHeight: 30 },
  form: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  textarea: {
    height: 120,
    textAlignVertical: 'top',
    paddingTop: Spacing.two,
  },
  truckToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    alignSelf: 'flex-start',
  },
  truckSection: {
    gap: Spacing.three,
  },
  error: { color: '#ef4444', fontSize: 14 },
});
