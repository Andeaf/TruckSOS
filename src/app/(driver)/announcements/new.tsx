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

export default function NewAnnouncementScreen() {
  const { session } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();
  const goBack = useBack('/(driver)/announcements');
  const insets = useSafeAreaInsets();
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit() {
    if (!description.trim()) { setError(t('driver.announcements.errorDescription')); return; }
    if (!location.trim()) { setError(t('driver.announcements.errorLocation')); return; }
    if (!session) return;

    setLoading(true);
    setError('');
    const err = await createAnnouncement(session.user.id, description.trim(), location.trim());
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
  error: { color: '#ef4444', fontSize: 14 },
});
