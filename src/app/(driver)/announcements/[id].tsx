import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useBack } from '@/hooks/use-back';
import { useTheme } from '@/hooks/use-theme';

import { StatusBadge } from '@/components/ui/status-badge';
import { Avatar } from '@/components/avatar';
import { MiniMap } from '@/components/mini-map';
import { Button } from '@/components/ui/button';
import { PhotoGallery } from '@/components/photo-gallery';
import { RatingBadge } from '@/components/rating-badge';
import { RatingSheet } from '@/components/rating-sheet';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useAnnouncementPhotos } from '@/hooks/use-announcement-photos';
import { useAuth } from '@/hooks/use-auth';
import { useMyRatingFor } from '@/hooks/use-ratings';
import { useSignedUrls } from '@/hooks/use-signed-urls';
import {
  fetchAnnouncementById,
  fetchApplicationsForAnnouncement,
  acceptApplication,
  rejectApplication,
  resolveAnnouncement,
  cancelAnnouncement,
  deleteAnnouncement,
  type AnnouncementWithMechanic,
  type ApplicationWithMechanic,
} from '@/hooks/use-announcements';
import type { PriceType } from '@/types/database';
import { openInGoogleMaps } from '@/lib/location';

const LOCALE_MAP: Record<string, string> = { ro: 'ro-RO', en: 'en-GB', de: 'de-DE' };

function formatDate(dateStr: string, language: string) {
  return new Date(dateStr).toLocaleString(LOCALE_MAP[language] ?? 'ro-RO', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function priceLabel(
  priceType: PriceType,
  amount: number,
  currency: string,
  t: (k: string) => string
) {
  const typeLabel =
    priceType === 'fixed'
      ? t('mechanic.apply.priceTypeFixed')
      : t('mechanic.apply.priceTypeHourly');
  return `${amount} ${currency} · ${typeLabel}`;
}

function ApplicantCard({
  app,
  avatarUrl,
  onAccept,
  onReject,
}: {
  app: ApplicationWithMechanic;
  avatarUrl?: string;
  onAccept: (appId: string) => Promise<void>;
  onReject: (appId: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [accepting, setAccepting] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const busy = accepting || rejecting;

  async function handleAccept() {
    setAccepting(true);
    await onAccept(app.id);
    setAccepting(false);
  }

  async function handleReject() {
    setRejecting(true);
    await onReject(app.id);
    setRejecting(false);
  }

  return (
    <ThemedView type="background" style={styles.applicantCard}>
      <View style={styles.applicantHeader}>
        <Avatar url={avatarUrl} name={app.mechanic.full_name} size={36} />
        <ThemedText type="smallBold" style={styles.applicantName}>
          {app.mechanic.full_name}
        </ThemedText>
        <RatingBadge avg={app.mechanic.rating_avg} count={app.mechanic.rating_count} />
      </View>
      {app.mechanic.specialization ? (
        <ThemedText themeColor="textSecondary" type="small">
          {app.mechanic.specialization}
        </ThemedText>
      ) : null}
      <ThemedText type="smallBold" style={styles.applicantPrice}>
        {priceLabel(app.price_type, app.price_amount, app.currency, t)}
      </ThemedText>
      {app.message ? (
        <ThemedText themeColor="textSecondary" type="small" style={styles.applicantMessage}>
          "{app.message}"
        </ThemedText>
      ) : null}
      <Pressable
        onPress={() =>
          router.push({
            pathname: '/(driver)/mechanic-profile/[id]' as never,
            params: { id: app.mechanic.id },
          })
        }
        style={styles.profileLink}>
        <MaterialIcons name="open-in-new" size={13} color="#208AEF" />
        <ThemedText type="small" style={styles.profileLinkText}>
          {t('driver.announcements.viewProfile')}
        </ThemedText>
      </Pressable>
      <View style={styles.applicantActions}>
        <View style={styles.actionBtn}>
          <Button
            title={t('driver.announcements.rejectApplicant')}
            onPress={handleReject}
            loading={rejecting}
            disabled={busy}
            variant="secondary"
          />
        </View>
        <View style={styles.actionBtn}>
          <Button
            title={t('driver.announcements.chooseApplicant')}
            onPress={handleAccept}
            loading={accepting}
            disabled={busy}
          />
        </View>
      </View>
    </ThemedView>
  );
}

function formatTruck(a: AnnouncementWithMechanic): string | null {
  const parts = [
    a.truck_make,
    a.truck_model,
    a.truck_year != null ? String(a.truck_year) : null,
  ].filter(Boolean) as string[];
  return parts.length > 0 ? parts.join(' · ') : null;
}

export default function AnnouncementDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const goBack = useBack('/(driver)/announcements');
  const [announcement, setAnnouncement] = useState<AnnouncementWithMechanic | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [applications, setApplications] = useState<ApplicationWithMechanic[]>([]);
  const { photos } = useAnnouncementPhotos(id);
  const { session } = useAuth();
  const [ratingVisible, setRatingVisible] = useState(false);
  const { rating: myRating, refresh: refreshMyRating } = useMyRatingFor(
    announcement?.mechanic_id ?? undefined,
    session?.user.id,
  );

  // Avatarele candidaților + al mecanicului acceptat, într-un singur apel batch.
  const avatarPaths = useMemo(
    () =>
      [
        ...applications.map((a) => a.mechanic.avatar_path),
        announcement?.mechanic?.avatar_path ?? null,
      ].filter((p): p is string => !!p),
    [applications, announcement?.mechanic?.avatar_path],
  );
  const avatarUrls = useSignedUrls(avatarPaths);

  async function load() {
    setLoading(true);
    try {
      const data = await fetchAnnouncementById(id);
      setAnnouncement(data);
    } catch {
      setAnnouncement(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [id]);

  useEffect(() => {
    if (announcement?.status === 'open') {
      fetchApplicationsForAnnouncement(id).then(setApplications);
    } else {
      setApplications([]);
    }
  }, [announcement?.status, id]);

  async function handleAcceptApplicant(appId: string) {
    const { conversationId, error: err } = await acceptApplication(appId);
    if (err) { setError(t('driver.announcements.errorAccept')); return; }
    await load();
    if (conversationId) {
      router.push({
        pathname: '/(driver)/conversations/[id]' as never,
        params: { id: conversationId },
      });
    }
  }

  async function handleRejectApplicant(appId: string) {
    const err = await rejectApplication(appId);
    if (err) { setError(t('driver.announcements.errorReject')); return; }
    setApplications((prev) => prev.filter((a) => a.id !== appId));
  }

  async function handleResolve() {
    setResolving(true);
    const err = await resolveAnnouncement(id);
    if (err) { setError(err); setResolving(false); return; }
    await load();
    setResolving(false);
  }

  function handleDeletePress() {
    const isOpen = announcement?.status === 'open';
    Alert.alert(
      t('driver.announcements.deleteConfirmTitle'),
      isOpen
        ? t('driver.announcements.deleteConfirmMessageOpen')
        : t('driver.announcements.deleteConfirmMessage'),
      [
        { text: t('driver.announcements.cancelConfirmCancel'), style: 'cancel' },
        {
          text: t('driver.announcements.deleteConfirmOk'),
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            const err = await deleteAnnouncement(id);
            setDeleting(false);
            if (err) { setError(t('driver.announcements.errorDelete')); return; }
            goBack();
          },
        },
      ]
    );
  }

  function handleCancelPress() {
    Alert.alert(
      t('driver.announcements.cancelConfirmTitle'),
      t('driver.announcements.cancelConfirmMessage'),
      [
        { text: t('driver.announcements.cancelConfirmCancel'), style: 'cancel' },
        {
          text: t('driver.announcements.cancelConfirmOk'),
          style: 'destructive',
          onPress: async () => {
            setCancelling(true);
            const err = await cancelAnnouncement(id);
            setCancelling(false);
            if (err) { setError(t('driver.announcements.errorCancel')); return; }
            goBack();
          },
        },
      ]
    );
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
        <ThemedText themeColor="textSecondary">{t('driver.announcements.notFound')}</ThemedText>
      </ThemedView>
    );
  }

  const truckInfo = formatTruck(announcement);

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader
        title={t('driver.announcements.detailTitle')}
        onBack={goBack}
        right={
          announcement.status !== 'accepted' ? (
            <Pressable onPress={handleDeletePress} hitSlop={12} disabled={deleting}>
              <MaterialIcons name="delete" size={22} color={theme.onHeader} />
            </Pressable>
          ) : null
        }
      />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.statusRow}>
          <StatusBadge status={announcement.status} />
          <ThemedText themeColor="textSecondary" type="small">
            {formatDate(announcement.created_at, i18n.language)}
          </ThemedText>
        </View>

        <ThemedView type="backgroundElement" style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="location-on" size={16} color="#208AEF" />
            <ThemedText type="smallBold">{t('driver.announcements.sectionLocation')}</ThemedText>
          </View>
          <ThemedText>{announcement.location}</ThemedText>
          {announcement.latitude != null && announcement.longitude != null ? (
            <>
              <MiniMap latitude={announcement.latitude} longitude={announcement.longitude} />
              <Pressable
                onPress={() => openInGoogleMaps(announcement.latitude!, announcement.longitude!)}
                style={({ pressed }) => [styles.mapsButton, pressed && styles.pressed]}
                hitSlop={8}>
                <MaterialIcons name="directions" size={16} color="#208AEF" />
                <ThemedText style={styles.mapsButtonText}>
                  {t('driver.announcements.openInMaps')}
                </ThemedText>
              </Pressable>
            </>
          ) : null}
        </ThemedView>

        {truckInfo || announcement.plate_number ? (
          <ThemedView type="backgroundElement" style={styles.section}>
            <View style={styles.sectionHeader}>
              <MaterialIcons name="local-shipping" size={16} color="#208AEF" />
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
            <MaterialIcons name="build" size={16} color="#208AEF" />
            <ThemedText type="smallBold">{t('driver.announcements.sectionDescription')}</ThemedText>
          </View>
          <ThemedText style={styles.descriptionText}>{announcement.description}</ThemedText>
        </ThemedView>

        {photos.length > 0 ? (
          <ThemedView type="backgroundElement" style={styles.section}>
            <View style={styles.sectionHeader}>
              <MaterialIcons name="photo-library" size={16} color="#208AEF" />
              <ThemedText type="smallBold">{t('photos.sectionTitle')}</ThemedText>
              <ThemedText themeColor="textSecondary" type="small">
                ({photos.length})
              </ThemedText>
            </View>
            <PhotoGallery photos={photos} />
          </ThemedView>
        ) : null}

        {(announcement.status === 'accepted' || announcement.status === 'resolved') &&
        announcement.mechanic ? (
          <ThemedView type="backgroundElement" style={styles.section}>
            <View style={styles.sectionHeader}>
              <MaterialIcons name="person" size={16} color="#f59e0b" />
              <ThemedText type="smallBold">{t('driver.announcements.sectionMechanic')}</ThemedText>
            </View>
            <View style={styles.personRow}>
              <Avatar
                url={
                  announcement.mechanic.avatar_path
                    ? avatarUrls[announcement.mechanic.avatar_path]
                    : undefined
                }
                name={announcement.mechanic.full_name}
                size={36}
              />
              <ThemedText>{announcement.mechanic.full_name}</ThemedText>
            </View>
          </ThemedView>
        ) : null}

        {announcement.status === 'open' ? (
          <ThemedView type="backgroundElement" style={styles.section}>
            <View style={styles.sectionHeader}>
              <MaterialIcons name="people" size={16} color="#208AEF" />
              <ThemedText type="smallBold">
                {t('driver.announcements.sectionApplicants')}
              </ThemedText>
              {applications.length > 0 ? (
                <ThemedText themeColor="textSecondary" type="small">
                  ({applications.length})
                </ThemedText>
              ) : null}
            </View>
            {applications.length === 0 ? (
              <ThemedText themeColor="textSecondary" type="small">
                {t('driver.announcements.emptyApplicants')}
              </ThemedText>
            ) : (
              applications.map((app) => (
                <ApplicantCard
                  key={app.id}
                  app={app}
                  avatarUrl={app.mechanic.avatar_path ? avatarUrls[app.mechanic.avatar_path] : undefined}
                  onAccept={handleAcceptApplicant}
                  onReject={handleRejectApplicant}
                />
              ))
            )}
          </ThemedView>
        ) : null}

        {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}

        {announcement.status === 'accepted' ? (
          <Button
            title={t('driver.announcements.resolveButton')}
            onPress={handleResolve}
            loading={resolving}
          />
        ) : null}

        {announcement.status === 'open' ? (
          <>
            <ThemedText themeColor="textSecondary" style={styles.hint}>
              {t('driver.announcements.hintOpen')}
            </ThemedText>
            <Button
              title={t('driver.announcements.cancelButton')}
              onPress={handleCancelPress}
              loading={cancelling}
              variant="danger"
            />
          </>
        ) : null}

        {announcement.status === 'resolved' ? (
          <>
            {/* Evaluarea se poate da și de aici, nu doar din Istoric — aceeași
                condiție ca în RLS: anunț `resolved` cu mecanic asignat. */}
            {announcement.mechanic_id && announcement.mechanic ? (
              <Pressable
                onPress={() => setRatingVisible(true)}
                style={({ pressed }) => [styles.rateButton, pressed && styles.pressed]}>
                <MaterialIcons name="star" size={18} color="#f59e0b" />
                <ThemedText style={styles.rateButtonText}>
                  {myRating ? t('rating.editButton') : t('rating.rateButton')}
                </ThemedText>
              </Pressable>
            ) : null}
            <ThemedText themeColor="textSecondary" style={styles.hint}>
              {t('driver.announcements.hintResolved')}
            </ThemedText>
          </>
        ) : null}

        {announcement.status === 'cancelled' ? (
          <ThemedText themeColor="textSecondary" style={styles.hint}>
            {t('driver.announcements.hintCancelled')}
          </ThemedText>
        ) : null}
      </ScrollView>

      {ratingVisible && session && announcement.mechanic_id && announcement.mechanic ? (
        <RatingSheet
          visible
          mechanicId={announcement.mechanic_id}
          mechanicName={announcement.mechanic.full_name}
          driverId={session.user.id}
          initialStars={myRating?.stars}
          initialComment={myRating?.comment}
          onClose={() => setRatingVisible(false)}
          onSaved={() => { setRatingVisible(false); refreshMyRating(); }}
        />
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
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
    borderRadius: Radius.card,
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
    borderColor: '#208AEF',
  },
  mapsButtonText: { color: '#208AEF', fontSize: 14, fontWeight: '600' },
  rateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    borderRadius: Radius.control,
    borderWidth: 1.5,
    borderColor: '#f59e0b',
  },
  rateButtonText: { color: '#f59e0b', fontSize: 15, fontWeight: '600' },
  error: { color: '#ef4444', fontSize: 14 },
  hint: { textAlign: 'center', fontSize: 14, lineHeight: 20 },
  profileLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    alignSelf: 'flex-start',
  },
  profileLinkText: {
    color: '#208AEF',
  },
  applicantActions: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  actionBtn: { flex: 1 },
  applicantCard: {
    borderRadius: Radius.card,
    padding: Spacing.three,
    gap: Spacing.one,
    borderWidth: 1,
    borderColor: '#208AEF22',
  },
  applicantHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  applicantName: { flex: 1 },
  applicantPrice: { color: '#22c55e' },
  applicantMessage: { fontStyle: 'italic' },
  pressed: { opacity: 0.7 },
});
