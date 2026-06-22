import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useBack } from '@/hooks/use-back';

import { Button } from '@/components/ui/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import {
  acceptAnnouncement,
  fetchOpenAnnouncementById,
  type AnnouncementWithDriver,
} from '@/hooks/use-announcements';
import { supabase } from '@/lib/supabase';

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString('ro-RO', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function MechanicAnnouncementDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const goBack = useBack('/(mechanic)/feed');
  const insets = useSafeAreaInsets();
  const [announcement, setAnnouncement] = useState<AnnouncementWithDriver | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await fetchOpenAnnouncementById(id);
        setAnnouncement(data);
      } catch {
        setAnnouncement(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  async function handleAccept() {
    setAccepting(true);
    setError('');
    const err = await acceptAnnouncement(id);
    if (err) {
      setError(t('mechanic.feed.errorAlreadyAccepted'));
      setAccepting(false);
      return;
    }
    // Găsim conversația creată de RPC și navigăm direct în chat
    const { data } = await supabase
      .from('conversations')
      .select('id')
      .eq('announcement_id', id)
      .single();
    if (data?.id) {
      router.replace({
        pathname: '/(mechanic)/conversations/[id]' as never,
        params: { id: data.id },
      });
    } else {
      router.replace('/(mechanic)/conversations');
    }
  }

  if (loading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator size="large" color="#22c55e" />
      </ThemedView>
    );
  }

  if (!announcement) {
    return (
      <ThemedView style={[styles.centered, { paddingTop: insets.top }]}>
        <MaterialIcons name="check-circle" size={52} color="#22c55e" />
        <ThemedText type="subtitle" style={styles.takenTitle}>
          {t('mechanic.feed.unavailableTitle')}
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.takenDesc}>
          {t('mechanic.feed.unavailableDescription')}
        </ThemedText>
        <Pressable onPress={goBack} hitSlop={12}>
          <ThemedText themeColor="textSecondary" type="small">{t('mechanic.feed.backToFeed')}</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  const alreadyTaken = announcement.status !== 'open';

  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={goBack} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={24} color="#60646C" />
        </Pressable>
        <ThemedText type="subtitle" style={styles.title}>{t('mechanic.feed.detailTitle')}</ThemedText>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText themeColor="textSecondary" type="small" style={styles.date}>
          {formatDate(announcement.created_at)}
        </ThemedText>

        {announcement.driver ? (
          <ThemedView type="backgroundElement" style={styles.section}>
            <View style={styles.sectionHeader}>
              <MaterialIcons name="person" size={16} color="#22c55e" />
              <ThemedText type="smallBold">{t('mechanic.feed.sectionDriver')}</ThemedText>
            </View>
            <ThemedText>{announcement.driver.full_name}</ThemedText>
          </ThemedView>
        ) : null}

        <ThemedView type="backgroundElement" style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="location-on" size={16} color="#22c55e" />
            <ThemedText type="smallBold">{t('mechanic.feed.sectionLocation')}</ThemedText>
          </View>
          <ThemedText>{announcement.location}</ThemedText>
        </ThemedView>

        <ThemedView type="backgroundElement" style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="build" size={16} color="#22c55e" />
            <ThemedText type="smallBold">{t('mechanic.feed.sectionDescription')}</ThemedText>
          </View>
          <ThemedText style={styles.descriptionText}>{announcement.description}</ThemedText>
        </ThemedView>

        {alreadyTaken ? (
          <ThemedText themeColor="textSecondary" style={styles.hint}>
            {t('mechanic.feed.alreadyTakenHint')}
          </ThemedText>
        ) : (
          <>
            {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}
            <Button
              title={t('mechanic.feed.acceptButton')}
              onPress={handleAccept}
              loading={accepting}
            />
            <ThemedText themeColor="textSecondary" style={styles.hint}>
              {t('mechanic.feed.acceptHint')}
            </ThemedText>
          </>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
  },
  takenTitle: { fontSize: 22, lineHeight: 30, textAlign: 'center' },
  takenDesc: { textAlign: 'center', lineHeight: 22 },
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
  date: { textAlign: 'right' },
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
  descriptionText: { lineHeight: 24 },
  error: { color: '#ef4444', fontSize: 14 },
  hint: { textAlign: 'center', fontSize: 14, lineHeight: 20 },
});
