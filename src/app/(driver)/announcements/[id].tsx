import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { StatusBadge } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import {
  fetchAnnouncementById,
  resolveAnnouncement,
  type AnnouncementWithMechanic,
} from '@/hooks/use-announcements';

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString('ro-RO', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function AnnouncementDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [announcement, setAnnouncement] = useState<AnnouncementWithMechanic | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    const data = await fetchAnnouncementById(id);
    setAnnouncement(data);
    setLoading(false);
  }

  useEffect(() => { load(); }, [id]);

  async function handleResolve() {
    setResolving(true);
    const err = await resolveAnnouncement(id);
    if (err) { setError(err); setResolving(false); return; }
    await load();
    setResolving(false);
  }

  if (loading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator size="large" color="#208AEF" />
      </ThemedView>
    );
  }

  if (!announcement) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText themeColor="textSecondary">Anunțul nu a fost găsit.</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={24} color="#60646C" />
        </Pressable>
        <ThemedText type="subtitle" style={styles.title}>Detalii anunț</ThemedText>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.statusRow}>
          <StatusBadge status={announcement.status} />
          <ThemedText themeColor="textSecondary" type="small">
            {formatDate(announcement.created_at)}
          </ThemedText>
        </View>

        <ThemedView type="backgroundElement" style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="location-on" size={16} color="#208AEF" />
            <ThemedText type="smallBold">Locație</ThemedText>
          </View>
          <ThemedText>{announcement.location}</ThemedText>
        </ThemedView>

        <ThemedView type="backgroundElement" style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="build" size={16} color="#208AEF" />
            <ThemedText type="smallBold">Descrierea problemei</ThemedText>
          </View>
          <ThemedText style={styles.descriptionText}>{announcement.description}</ThemedText>
        </ThemedView>

        {announcement.status === 'accepted' && announcement.mechanic ? (
          <ThemedView type="backgroundElement" style={styles.section}>
            <View style={styles.sectionHeader}>
              <MaterialIcons name="person" size={16} color="#f59e0b" />
              <ThemedText type="smallBold">Mecanic asignat</ThemedText>
            </View>
            <ThemedText>{announcement.mechanic.full_name}</ThemedText>
          </ThemedView>
        ) : null}

        {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}

        {announcement.status === 'accepted' ? (
          <Button
            title="Marchează ca rezolvat"
            onPress={handleResolve}
            loading={resolving}
          />
        ) : null}

        {announcement.status === 'open' ? (
          <ThemedText themeColor="textSecondary" style={styles.hint}>
            Anunțul este vizibil mecanicilor disponibili.
          </ThemedText>
        ) : null}

        {announcement.status === 'resolved' ? (
          <ThemedText themeColor="textSecondary" style={styles.hint}>
            Problemă rezolvată. Poți vedea istoricul conversației în tab-ul Conversații.
          </ThemedText>
        ) : null}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  title: { fontSize: 22, lineHeight: 30 },
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  section: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  descriptionText: {
    lineHeight: 24,
  },
  error: { color: '#ef4444', fontSize: 14 },
  hint: { textAlign: 'center', fontSize: 14, lineHeight: 20 },
});
