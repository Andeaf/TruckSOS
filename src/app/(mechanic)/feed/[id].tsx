import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useBack } from '@/hooks/use-back';
import { ApplyBottomSheet } from '@/components/apply-bottom-sheet';
import { Button } from '@/components/ui/button';
import { PhotoGallery } from '@/components/photo-gallery';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import {
  fetchOpenAnnouncementById,
  fetchMyApplicationForAnnouncement,
  type AnnouncementWithDriver,
} from '@/hooks/use-announcements';
import { useAnnouncementPhotos } from '@/hooks/use-announcement-photos';
import { markAnnouncementViewed } from '@/hooks/use-viewed-announcements';
import { useAuth } from '@/hooks/use-auth';
import { openInGoogleMaps } from '@/lib/location';
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
  const { session } = useAuth();
  const goBack = useBack('/(mechanic)/feed');
  const insets = useSafeAreaInsets();

  const [announcement, setAnnouncement] = useState<AnnouncementWithDriver | null>(null);
  const [myApplication, setMyApplication] = useState<Application | null>(null);
  const [loading, setLoading] = useState(true);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [resubmitMode, setResubmitMode] = useState(false);
  const { photos } = useAnnouncementPhotos(id);

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

  // Deschiderea detaliului = anunțul nu mai e „Nou" în feed.
  useEffect(() => {
    if (session?.user.id && id) markAnnouncementViewed(session.user.id, id);
  }, [session?.user.id, id]);

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
    <ThemedView style={styles.container}>
      <ScreenHeader title={t('mechanic.feed.detailTitle')} onBack={goBack} />

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
          {announcement.latitude != null && announcement.longitude != null ? (
            <>
              <ThemedText themeColor="textSecondary" type="small">
                {announcement.latitude}, {announcement.longitude}
              </ThemedText>
              <Pressable
                onPress={() => openInGoogleMaps(announcement.latitude!, announcement.longitude!)}
                style={({ pressed }) => [styles.mapsButton, pressed && styles.pressed]}
                hitSlop={8}>
                <MaterialIcons name="directions" size={16} color="#22c55e" />
                <ThemedText style={styles.mapsButtonText}>
                  {t('mechanic.feed.openInMaps')}
                </ThemedText>
              </Pressable>
            </>
          ) : null}
        </ThemedView>

        {truckInfo || announcement.plate_number ? (
          <ThemedView type="backgroundElement" style={styles.section}>
            <View style={styles.sectionHeader}>
              <MaterialIcons name="local-shipping" size={16} color="#22c55e" />
              <ThemedText type="smallBold">{t('truck.sectionTitle')}</ThemedText>
            </View>
            {truckInfo ? <ThemedText>{truckInfo}</ThemedText> : null}
            {announcement.plate_number ? (
              <ThemedText themeColor="textSecondary" type="small">
                {t('truck.plateLabel')}: {announcement.plate_number}
              </ThemedText>
            ) : null}
          </ThemedView>
        ) : null}

        <ThemedView type="backgroundElement" style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="build" size={16} color="#22c55e" />
            <ThemedText type="smallBold">{t('mechanic.feed.sectionDescription')}</ThemedText>
          </View>
          <ThemedText style={styles.descriptionText}>{announcement.description}</ThemedText>
        </ThemedView>

        {photos.length > 0 ? (
          <ThemedView type="backgroundElement" style={styles.section}>
            <View style={styles.sectionHeader}>
              <MaterialIcons name="photo-library" size={16} color="#22c55e" />
              <ThemedText type="smallBold">{t('photos.sectionTitle')}</ThemedText>
              <ThemedText themeColor="textSecondary" type="small">
                ({photos.length})
              </ThemedText>
            </View>
            <PhotoGallery photos={photos} />
          </ThemedView>
        ) : null}

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
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  date: { textAlign: 'right' },
  section: {
    borderRadius: Radius.card,
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
  mapsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    alignSelf: 'flex-start',
    marginTop: Spacing.one,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.control,
    borderWidth: 1.5,
    borderColor: '#22c55e',
  },
  mapsButtonText: { color: '#22c55e', fontSize: 14, fontWeight: '600' },
  statusCard: {
    borderRadius: Radius.card,
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
    borderRadius: Radius.control,
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
