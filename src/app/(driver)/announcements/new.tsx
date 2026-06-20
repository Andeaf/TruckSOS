import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { createAnnouncement } from '@/hooks/use-announcements';

export default function NewAnnouncementScreen() {
  const { session } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit() {
    if (!description.trim()) { setError('Descrie problema tehnicã.'); return; }
    if (!location.trim()) { setError('Introdu locația.'); return; }
    if (!session) return;

    setLoading(true);
    setError('');
    const err = await createAnnouncement(session.user.id, description.trim(), location.trim());
    setLoading(false);

    if (err) { setError(err); return; }
    router.back();
  }

  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={24} color="#60646C" />
        </Pressable>
        <ThemedText type="subtitle" style={styles.title}>Anunț nou</ThemedText>
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={styles.form}
          keyboardShouldPersistTaps="handled">

          <Input
            label="Locația actuală"
            value={location}
            onChangeText={setLocation}
            placeholder="ex: DN1, km 45, lângã Ploiești"
            autoCapitalize="sentences"
          />

          <Input
            label="Descrierea problemei"
            value={description}
            onChangeText={setDescription}
            placeholder="ex: Motor nu pornește, fum din motor, roatã spartã..."
            autoCapitalize="sentences"
            multiline
            numberOfLines={5}
            style={styles.textarea}
          />

          {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}

          <Button title="Trimite anunțul" onPress={handleSubmit} loading={loading} />
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
