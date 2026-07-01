import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useBack } from '@/hooks/use-back';
import { useTheme } from '@/hooks/use-theme';
import { ApplyBottomSheet } from '@/components/apply-bottom-sheet';
import { Button } from '@/components/ui/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import {
  fetchOpenAnnouncementById,
  fetchMyApplicationForAnnouncement,
  type AnnouncementWithDriver,
} from '@/hooks/use-announcements';
import type { Application } from '@/types/database';

const LOCALE_MAP: Record<string, string> = { ro: 'ro-RO', en: 'en-GB', de: 'de-DE' };

function formatDate(dateStr: string, language: string) {
  return new Date(dateStr).toLocaleString(LOCALE_MAP[language] ?? 'ro-RO', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatTruck(a: AnnouncementWithDriver): string | null {
  const parts = [
    a.truck_make,
    a.truck_model,
    a.truck_year != null ? String(a.truck_year) : null,
  ].filter(Boolean) as string[];
  return parts.length > 0 ? parts.join(' · ') : null;
}

function ApplicationStatusCard({
  application,
  t,
  onResubmit,
}: {
  application: Application;
  t: (k: string) => string;
  onResubmit?: () => void;
}) {
  const statusKey =
    application.status === 'accepted' ? 'mechanic.apply.statusAccepted'
    : application.status === 'rejected' ? 'mechanic.apply.statusRejected'
    : 'mechanic.apply.statusPending';

  const statusColor =
    application.status === 'accepted' ? '#22c55e'
    : application.status === 'rejected' ? '#ef4444'
    : '#f59e0b';

  const priceLabel =
    application.price_type === 'fixed'
      ? t('mechanic.apply.priceTypeFixed')
      : t('mechanic.apply.priceTypeHourly');

  return (
    <ThemedView type="backgroundElement" style={styles.statusCard}>
      <View style={styles.statusRow}>
        <MaterialIcons
          name={
            application.status === 'accepted' ? 'check-circle'
            : application.status === 'rejected' ? 'cancel'
            : 'hourglass-empty'
          }
          size={20}
          color={statusColor}
        />
        <ThemedText style={[styles.statusText, { color: statusColor }]}>
          {t(statusKey)}
        </ThemedText>
      </View>
      <ThemedText themeColor="textSecondary" type="small">
        {priceLabel}: {application.price_amount} {application.currency}
      </ThemedText>
      {application.message ? (
        <ThemedText themeColor="textSecondary" type="small">
          "{application.message}"
        </ThemedText>
      ) : null}
      {onResubmit ? (
        <Pressable
          onPress={onResubmit}
          style={({ pressed }) => [styles.resubmitButton, pressed && styles.pressed]}>
          <ThemedText style={styles.resubmitButtonText}>
            {t('mechanic.apply.resubmitSheetTitle')}
          </ThemedText>
        </Pressable>
      ) : null}
    </ThemedView>
  );
}

export default function MechanicAnnouncementDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const goBack = useBack('/(mechanic)/feed');
  const insets = useSafeAreaInsets();

  const [announcement, setAnnouncement] = useState<AnnouncementWithDriver | null>(null);
  const [myApplication, setMyApplication] = useState<Application | null>(null);
  const [loading, setLoading] = useState(true);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [resubmitMode, setResubmitMode] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [ann, app] = await Promise.all([
        fetchOpenAnnouncementById(id),
        fetchMyApplicationForAnnouncement(id),
      ]);
      setAnnouncement(ann);
      setMyApplication(app);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [id]);

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
          <ThemedText themeColor="textSecondary" type="small">
            {t('mechanic.feed.backToFeed')}
          </ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  const announcementTaken = announcement.status !== 'open';
  const isResubmittable = myApplication?.status === 'rejected' && !announcementTaken;
  const truckInfo = formatTruck(announcement);

  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={goBack} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={24} color={theme.textSecondary} />
        </Pressable>
        <ThemedText type="subtitle" style={styles.title}>
          {t('mechanic.feed.detailTitle')}
        </ThemedText>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText themeColor="textSecondary" type="small" style={styles.date}>
          {formatDate(announcement.created_at, i18n.language)}
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

        {truckInfo ? (
          <ThemedView type="backgroundElement" style={styles.section}>
            <View style={styles.sectionHeader}>
              <MaterialIcons name="local-shipping" size={16} color="#22c55e" />
              <ThemedText type="smallBold">{t('truck.sectionTitle')}</ThemedText>
            </View>
            <ThemedText>{truckInfo}</ThemedText>
          </ThemedView>
        ) : null}

        <ThemedView type="backgroundElement" style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="build" size={16} color="#22c55e" />
            <ThemedText type="smallBold">{t('mechanic.feed.sectionDescription')}</ThemedText>
          </View>
          <ThemedText style={styles.descriptionText}>{announcement.description}</ThemedText>
        </ThemedView>

        {/* Acțiune de jos */}
        {myApplication ? (
          <ApplicationStatusCard
            application={myApplication}
            t={t}
            onResubmit={isResubmittable ? () => { setResubmitMode(true); setSheetVisible(true); } : undefined}
          />
        ) : announcementTaken ? (
          <ThemedText themeColor="textSecondary" style={styles.hint}>
            {t('mechanic.feed.alreadyTakenHint')}
          </ThemedText>
        ) : (
          <>
            <Button
              title={t('mechanic.apply.buttonInterested')}
              onPress={() => { setResubmitMode(false); setSheetVisible(true); }}
            />
            <ThemedText themeColor="textSecondary" style={styles.hint}>
              {t('mechanic.apply.interestedHint')}
            </ThemedText>
          </>
        )}
      </ScrollView>

      <ApplyBottomSheet
        visible={sheetVisible}
        announcementId={id}
        onClose={() => { setSheetVisible(false); setResubmitMode(false); }}
        onSuccess={() => { setSheetVisible(false); setResubmitMode(false); load(); }}
        applicationId={resubmitMode && myApplication ? myApplication.id : undefined}
        initialData={resubmitMode && myApplication ? {
          priceType: myApplication.price_type,
          priceAmount: myApplication.price_amount,
          currency: myApplication.currency,
          message: myApplication.message || '',
        } : undefined}
      />
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
  hint: { textAlign: 'center', fontSize: 14, lineHeight: 20 },
  statusCard: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  statusText: {
    fontSize: 15,
    fontWeight: '600',
  },
  resubmitButton: {
    marginTop: Spacing.one,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    backgroundColor: '#22c55e1A',
    borderWidth: 1,
    borderColor: '#22c55e',
    alignItems: 'center',
  },
  resubmitButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#22c55e',
  },
  pressed: { opacity: 0.7 },
});
