import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
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
import { UserPickerSheet } from '@/components/user-picker-sheet';
import { Radius, Spacing } from '@/constants/theme';
import { displayName } from '@/lib/display-name';
import { useAnnouncementPhotos } from '@/hooks/use-announcement-photos';
import { useAuth } from '@/hooks/use-auth';
import { startDirectConversation } from '@/hooks/use-chat';
import { useMyRatingFor } from '@/hooks/use-ratings';
import { useSignedUrls } from '@/hooks/use-signed-urls';
import {
  fetchAnnouncementById,
  fetchApplicationsForAnnouncement,
  acceptApplication,
  rejectApplication,
  resolveAnnouncement,
  resolveOpenAnnouncement,
  cancelAnnouncement,
  deleteAnnouncement,
  type AnnouncementWithMechanic,
  type ApplicationWithMechanic,
} from '@/hooks/use-announcements';
import type { PriceType } from '@/types/database';
import { openInGoogleMaps, openInMaps } from '@/lib/location';

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
  profilePath,
  onAccept,
  onReject,
}: {
  app: ApplicationWithMechanic;
  avatarUrl?: string;
  /** Ruta de profil public a candidatului — diferă după rolul privitorului. */
  profilePath: string;
  onAccept: (appId: string) => Promise<void>;
  onReject: (appId: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
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
    <ThemedView type="background" style={[styles.applicantCard, { borderColor: `${theme.brand}22` }]}>
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
          &quot;{app.message}&quot;
        </ThemedText>
      ) : null}
      <Pressable
        onPress={() =>
          router.push({
            pathname: profilePath as never,
            params: { id: app.mechanic.id },
          })
        }
        style={styles.profileLink}>
        <MaterialIcons name="open-in-new" size={13} color={theme.brand} />
        <ThemedText type="small" themeColor="brand">
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

/**
 * Detaliul de anunț cu acțiunile de PROPRIETAR — partajat între roluri (5 aug):
 * șoferul îl are sub tabul Anunțuri, mecanicul sub „Ale mele". Diferă doar rutele
 * (conversații, profil candidat); acțiunile rămân gardate de isOwner.
 */
export function AnnouncementDetailScreen({ role }: { role: 'driver' | 'mechanic' }) {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const goBack = useBack(role === 'driver' ? '/(driver)/announcements' : '/(mechanic)/feed');
  const convBase = role === 'driver' ? '/(driver)/conversations' : '/(mechanic)/conversations';
  const applicantProfilePath =
    role === 'driver' ? '/(driver)/mechanic-profile/[id]' : '/(mechanic)/public-profile/[id]';
  // Faza 19.6: share — trimite anunțul unui alt utilizator (card pe primul mesaj).
  const [shareOpen, setShareOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const handleShareTo = async (targetId: string) => {
    if (sharing) return;
    setSharing(true);
    const { conversationId, error } = await startDirectConversation(targetId);
    setSharing(false);
    setShareOpen(false);
    if (error === 'blocked_by_you') {
      Alert.alert(t('newConversation.blockedTitle'), t('newConversation.blockedBody'));
      return;
    }
    if (error || !conversationId) {
      Alert.alert(t('common.error'));
      return;
    }
    router.push({
      pathname: `${convBase}/[id]` as never,
      params: { id: conversationId, announcementId: id },
    });
  };
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
        pathname: `${convBase}/[id]` as never,
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
    // `open` → RPC-ul din migrarea 20260904 (RLS permite doar accepted → resolved
    // prin UPDATE direct; RPC-ul respinge și candidaturile pending, atomic).
    // `accepted` → drumul vechi, neschimbat.
    const err =
      announcement?.status === 'open'
        ? await resolveOpenAnnouncement(id)
        : await resolveAnnouncement(id);
    if (err) { setError(t('driver.announcements.errorResolve')); setResolving(false); return; }
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
        <ActivityIndicator size="large" color={theme.brand} />
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
  // Acțiunile de proprietar doar pe anunțul PROPRIU: adminul (RLS is_admin())
  // poate deschide și anunțurile altora (ex. distribuite în chat) — acolo ecranul
  // e read-only; RLS-ul de UPDATE/DELETE oricum ar fi refuzat tăcut acțiunile.
  const isOwner = announcement.driver_id === session?.user.id;

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader
        title={t('driver.announcements.detailTitle')}
        onBack={goBack}
        right={
          <View style={styles.headerActions}>
            {/* Faza 19.6: share — trimite anunțul unui mecanic sau șofer. */}
            <Pressable
              onPress={() => setShareOpen(true)}
              hitSlop={12}
              accessibilityLabel={t('attach.shareTitle')}>
              <MaterialIcons name="share" size={22} color={theme.onHeader} />
            </Pressable>
            {isOwner && announcement.status !== 'accepted' ? (
              <Pressable onPress={handleDeletePress} hitSlop={12} disabled={deleting}>
                <MaterialIcons name="delete" size={22} color={theme.onHeader} />
              </Pressable>
            ) : null}
          </View>
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
            <MaterialIcons name="location-on" size={16} color={theme.brand} />
            <ThemedText type="smallBold">{t('driver.announcements.sectionLocation')}</ThemedText>
          </View>
          <ThemedText>{announcement.location}</ThemedText>
          {announcement.latitude != null && announcement.longitude != null ? (
            <>
              <MiniMap latitude={announcement.latitude} longitude={announcement.longitude} />
              {/* iOS: două butoane EGALE, unul lângă altul (Apple + Google Maps —
                  mulți nu folosesc Apple Maps). Android: doar Google, ca înainte. */}
              <View style={styles.mapsButtonsRow}>
                <Pressable
                  onPress={() => openInMaps(announcement.latitude!, announcement.longitude!)}
                  style={({ pressed }) => [
                    styles.mapsButton,
                    { borderColor: theme.brand },
                    Platform.OS === 'ios' && styles.mapsButtonHalf,
                    pressed && styles.pressed,
                  ]}
                  hitSlop={8}>
                  <MaterialIcons name="directions" size={16} color={theme.brand} />
                  <ThemedText
                    style={[styles.mapsButtonText, { color: theme.brand }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit>
                    {t(
                      Platform.OS === 'ios'
                        ? 'driver.announcements.openInMapsIos'
                        : 'driver.announcements.openInMaps',
                    )}
                  </ThemedText>
                </Pressable>
                {Platform.OS === 'ios' ? (
                  <Pressable
                    onPress={() =>
                      openInGoogleMaps(announcement.latitude!, announcement.longitude!)
                    }
                    style={({ pressed }) => [
                      styles.mapsButton,
                      { borderColor: theme.brand },
                      styles.mapsButtonHalf,
                      pressed && styles.pressed,
                    ]}
                    hitSlop={8}>
                    <MaterialIcons name="directions" size={16} color={theme.brand} />
                    <ThemedText
                      style={[styles.mapsButtonText, { color: theme.brand }]}
                      numberOfLines={1}
                      adjustsFontSizeToFit>
                      {t('driver.announcements.openInMaps')}
                    </ThemedText>
                  </Pressable>
                ) : null}
              </View>
            </>
          ) : null}
        </ThemedView>

        {truckInfo || announcement.plate_number || announcement.chassis_number ? (
          <ThemedView type="backgroundElement" style={styles.section}>
            <View style={styles.sectionHeader}>
              <MaterialIcons name="local-shipping" size={16} color={theme.brand} />
              <ThemedText type="smallBold">{t('truck.sectionTitle')}</ThemedText>
            </View>
            {truckInfo ? <ThemedText>{truckInfo}</ThemedText> : null}
            {announcement.plate_number ? (
              <ThemedText themeColor="textSecondary" type="small">
                {t('truck.plateLabel')}: {announcement.plate_number}
              </ThemedText>
            ) : null}
            {announcement.chassis_number ? (
              <ThemedText themeColor="textSecondary" type="small">
                {t('truck.chassisLabel')}: {announcement.chassis_number}
              </ThemedText>
            ) : null}
          </ThemedView>
        ) : null}

        <ThemedView type="backgroundElement" style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="build" size={16} color={theme.brand} />
            <ThemedText type="smallBold">{t('driver.announcements.sectionDescription')}</ThemedText>
          </View>
          <ThemedText style={styles.descriptionText}>{announcement.description}</ThemedText>
        </ThemedView>

        {photos.length > 0 ? (
          <ThemedView type="backgroundElement" style={styles.section}>
            <View style={styles.sectionHeader}>
              <MaterialIcons name="photo-library" size={16} color={theme.brand} />
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
                name={displayName(announcement.mechanic, t)}
                size={36}
              />
              <ThemedText>{displayName(announcement.mechanic, t)}</ThemedText>
            </View>
          </ThemedView>
        ) : null}

        {isOwner && announcement.status === 'open' ? (
          <ThemedView type="backgroundElement" style={styles.section}>
            <View style={styles.sectionHeader}>
              <MaterialIcons name="people" size={16} color={theme.brand} />
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
                  profilePath={applicantProfilePath}
                  onAccept={handleAcceptApplicant}
                  onReject={handleRejectApplicant}
                />
              ))
            )}
          </ThemedView>
        ) : null}

        {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}

        {isOwner && announcement.status === 'accepted' ? (
          <Button
            title={t('driver.announcements.resolveButton')}
            onPress={handleResolve}
            loading={resolving}
            variant="success"
          />
        ) : null}

        {isOwner && announcement.status === 'open' ? (
          <>
            <ThemedText themeColor="textSecondary" style={styles.hint}>
              {t('driver.announcements.hintOpen')}
            </ThemedText>
            {/* 5 sept 2026: „rezolvat" și pe anunț ÎNCĂ deschis (problema rezolvată în
                afara aplicației) — merge prin RPC, vezi handleResolve. */}
            <Button
              title={t('driver.announcements.resolveButton')}
              onPress={handleResolve}
              loading={resolving}
              disabled={cancelling}
              variant="success"
            />
            <Button
              title={t('driver.announcements.cancelButton')}
              onPress={handleCancelPress}
              loading={cancelling}
              variant="danger"
            />
          </>
        ) : null}

        {isOwner && announcement.status === 'resolved' ? (
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
            {/* Hint-ul pomenește Istoricul — ecran pe care doar șoferul îl are. */}
            {role === 'driver' ? (
              <ThemedText themeColor="textSecondary" style={styles.hint}>
                {t(
                  announcement.mechanic_id
                    ? 'driver.announcements.hintResolved'
                    : 'driver.announcements.hintResolvedNoMechanic'
                )}
              </ThemedText>
            ) : null}
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
          mechanicName={displayName(announcement.mechanic, t)}
          driverId={session.user.id}
          initialStars={myRating?.stars}
          initialComment={myRating?.comment}
          onClose={() => setRatingVisible(false)}
          onSaved={() => { setRatingVisible(false); refreshMyRating(); }}
        />
      ) : null}

      {shareOpen ? (
        <UserPickerSheet
          visible
          title={t('attach.shareTitle')}
          onClose={() => setShareOpen(false)}
          onPick={(user) => handleShareTo(user.id)}
        />
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.four },
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
    // borderColor vine inline din theme.brand (temă light/dark).
  },
  mapsButtonText: { fontSize: 14, fontWeight: '600' },
  mapsButtonsRow: { flexDirection: 'row', gap: Spacing.two },
  mapsButtonHalf: { flex: 1, alignSelf: 'auto', justifyContent: 'center' },
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
    // borderColor vine inline (theme.brand + '22').
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
