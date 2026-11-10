import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useBack } from '@/hooks/use-back';
import { ApplyBottomSheet } from '@/components/apply-bottom-sheet';
import { Avatar } from '@/components/avatar';
import { MiniMap } from '@/components/mini-map';
import { Button } from '@/components/ui/button';
import { PhotoGallery } from '@/components/photo-gallery';
import { ReportSheet } from '@/components/report-sheet';
import { ScreenHeader } from '@/components/screen-header';
import { IconButton } from '@/components/ui/icon-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { UserPickerSheet } from '@/components/user-picker-sheet';
import { Radius, Spacing } from '@/constants/theme';
import {
  fetchOpenAnnouncementById,
  fetchMyApplicationForAnnouncement,
  recordAnnouncementView,
  type AnnouncementWithDriver,
} from '@/hooks/use-announcements';
import { startDirectConversation } from '@/hooks/use-chat';
import { useTheme } from '@/hooks/use-theme';
import { useAnnouncementPhotos } from '@/hooks/use-announcement-photos';
import { useAnnouncementTranslation } from '@/hooks/use-announcement-translation';
import { markAnnouncementViewed } from '@/hooks/use-viewed-announcements';
import { useAuth } from '@/hooks/use-auth';
import { approxCoordinate, useAdminMechanicMask } from '@/hooks/use-admin-mask';
import { useSignedUrl } from '@/hooks/use-signed-urls';
import { openInGoogleMaps, openInMaps } from '@/lib/location';
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
          &quot;{application.message}&quot;
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
  const router = useRouter();
  const theme = useTheme();
  // Faza 19.6: share — trimite anunțul unui alt utilizator (card pe primul mesaj).
  const [shareOpen, setShareOpen] = useState(false);
  // Faza 8.3 (D8.5): „Raportează” pe anunțul de depanare → reports.announcement_id.
  const [reportOpen, setReportOpen] = useState(false);
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
      pathname: '/(mechanic)/conversations/[id]' as never,
      params: { id: conversationId, announcementId: id },
    });
  };
  const insets = useSafeAreaInsets();
  const adminMask = useAdminMechanicMask();

  const [announcement, setAnnouncement] = useState<AnnouncementWithDriver | null>(null);
  const [myApplication, setMyApplication] = useState<Application | null>(null);
  const [loading, setLoading] = useState(true);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [resubmitMode, setResubmitMode] = useState(false);
  const { photos } = useAnnouncementPhotos(id);
  const driverAvatarUrl = useSignedUrl(announcement?.driver?.avatar_path);
  // 1.1 (H3): „Tradu” pe descriere.
  const translation = useAnnouncementTranslation(announcement);
  const handleTranslate = () => {
    // 1.1 (B): oaspeții primesc pop-upul de cont aici
    translation.translate();
  };

  // Contact direct cu autorul anunțului (2 sept). Refolosește exact conducta de la
  // share: conversație directă + `announcementId` pe rută, care face ca PRIMUL mesaj
  // să poarte cardul anunțului — destinatarul vede din prima despre ce e vorba
  // (comportamentul introdus la Market în Faza 19.4). Diferența față de share e doar
  // destinatarul: autorul anunțului, nu un terț ales din picker.
  const [contacting, setContacting] = useState(false);
  const handleContactAuthor = async () => {
    // Autorul poate fi șofer SAU mecanic — mecanicii își postează propriile anunțuri
    // în aceeași tabelă (coloana se numește `driver_id` din motive istorice).
    const authorId = announcement?.driver_id;
    if (contacting || !authorId) return;
    setContacting(true);
    const { conversationId, error } = await startDirectConversation(authorId);
    setContacting(false);
    if (error === 'blocked_by_you') {
      Alert.alert(t('newConversation.blockedTitle'), t('newConversation.blockedBody'));
      return;
    }
    if (error || !conversationId) {
      Alert.alert(t('common.error'));
      return;
    }
    router.push({
      pathname: '/(mechanic)/conversations/[id]' as never,
      params: { id: conversationId, announcementId: id },
    });
  };

  const userId = session?.user.id;
  // 1.1: detaliul se reîncarcă la FIECARE focus (întoarcerea din chat, din candidatură, din
  // notificare) și la pull-to-refresh — statusul candidaturii/acceptarea apar fără ieșire din
  // ecran. Ales în locul Realtime (mai ieftin, fără abonamente noi): sunt aceleași două cereri
  // de până acum, doar repetate. Primul load arată spinner-ul pe tot ecranul; reîncărcările nu.
  const [refreshing, setRefreshing] = useState(false);
  // Încărcarea în zbor (id + promisiune): focus + pull-to-refresh + onSuccess nu dublează
  // cererile. O cerere venită între timp NU se aruncă: răspunsul în zbor poate fi plecat
  // ÎNAINTE de schimbare (ex. candidatura abia trimisă → ar aduce încă „Candidează”), deci
  // `pendingReloadRef` repornește încărcarea o dată după el, iar apelantul o așteaptă.
  const inFlightRef = useRef<{ id: string; promise: Promise<void> } | null>(null);
  const pendingReloadRef = useRef(false);
  // id-ul deja afișat (reîncărcare „tăcută”) și cel redirecționat (anunțul propriu).
  const loadedIdRef = useRef<string | null>(null);
  const redirectedIdRef = useRef<string | null>(null);

  const load = useCallback((): Promise<void> => {
    if (!id) {
      setLoading(false);
      return Promise.resolve();
    }
    if (redirectedIdRef.current === id) return Promise.resolve();
    if (inFlightRef.current?.id === id) {
      pendingReloadRef.current = true;
      return inFlightRef.current.promise;
    }
    pendingReloadRef.current = false;
    const promise = (async () => {
      try {
        do {
          pendingReloadRef.current = false;
          const silent = loadedIdRef.current === id;
          if (!silent) setLoading(true);
          const [ann, app] = await Promise.all([
            fetchOpenAnnouncementById(id),
            fetchMyApplicationForAnnouncement(id),
          ]);
          // Anunțul PROPRIU (mecanicii pot posta, 5 aug — ex. deschis dintr-un share): vederea
          // de candidat n-are sens pe el → sări la detaliul de proprietar (o singură dată).
          if (ann && userId && ann.driver_id === userId) {
            redirectedIdRef.current = id;
            router.replace({
              pathname: '/(mechanic)/feed/mine/[id]' as never,
              params: { id },
            });
            return;
          }
          // Cererea nu întoarce eroarea (null și pe rețea slabă): la o reîncărcare păstrăm ce
          // e pe ecran, în loc să afișăm „indisponibil” din cauza unei erori trecătoare.
          if (ann || !silent) {
            setAnnouncement(ann);
            setMyApplication(app);
          }
          loadedIdRef.current = id;
        } while (pendingReloadRef.current);
      } finally {
        if (inFlightRef.current?.id === id) inFlightRef.current = null;
        setLoading(false);
      }
    })();
    inFlightRef.current = { id, promise };
    return promise;
  }, [id, userId, router]);

  // Focusul vine și la montare → înlocuiește vechiul useEffect pe [id] (fără cerere dublă).
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  // Deschiderea detaliului = anunțul nu mai e „Nou" în feed.
  useEffect(() => {
    if (session?.user.id && id) markAnnouncementViewed(session.user.id, id);
  }, [session?.user.id, id]);

  // Vizualizarea pentru admin (24 sept) — doar după ce anunțul chiar s-a afișat.
  useEffect(() => {
    if (announcement?.id) recordAnnouncementView(announcement.id);
  }, [announcement?.id]);

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
  // Admin „ca mecanic” (1.1): ce vede un mecanic care NU e cel acceptat — fără plăcuță/VIN,
  // poziția la ~1 km. Mască client-side, doar pentru teste (vezi use-admin-mask).
  const masked = adminMask && announcement.mechanic_id !== userId;
  const plateNumber = masked ? null : announcement.plate_number;
  const chassisNumber = masked ? null : announcement.chassis_number;
  const latitude = masked ? approxCoordinate(announcement.latitude) : announcement.latitude;
  const longitude = masked ? approxCoordinate(announcement.longitude) : announcement.longitude;

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader
        title={t('mechanic.feed.detailTitle')}
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
            {/* Faza 8.3 (D8.5): aici vede mecanicul anunțurile ALTORA (feed, hartă, push) — locul firesc al
                butonului „Raportează”; anunțul propriu e redirecționat la detaliul de proprietar. */}
            {session && announcement.driver_id !== userId ? (
              <IconButton
                label={t('a11y.report')}
                onPress={() => setReportOpen(true)}
                hitSlop={12}
                icon={<MaterialIcons name="flag" size={22} color={theme.onHeader} />}
              />
            ) : null}
          </View>
        }
      />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onPullRefresh}
            tintColor={theme.brand}
            colors={[theme.brand]}
          />
        }>
        <ThemedText themeColor="textSecondary" type="small" style={styles.date}>
          {formatDate(announcement.created_at, i18n.language)}
        </ThemedText>

        {announcement.driver ? (
          <ThemedView type="backgroundElement" style={styles.section}>
            <View style={styles.sectionHeader}>
              <MaterialIcons name="person" size={16} color="#22c55e" />
              <ThemedText type="smallBold">{t('mechanic.feed.sectionDriver')}</ThemedText>
            </View>
            {announcement.driver.deleted_at ? (
              <View style={styles.personRow}>
                <Avatar url={driverAvatarUrl} name={announcement.driver.full_name} size={36} userId={announcement.driver_id} />
                <ThemedText>{announcement.driver.full_name}</ThemedText>
              </View>
            ) : (
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: '/(mechanic)/public-profile/[id]',
                    params: { id: announcement.driver_id },
                  } as never)
                }
                accessibilityRole="button"
                accessibilityHint={t('common.openProfile')}
                style={({ pressed }) => [styles.personRow, pressed && { opacity: 0.7 }]}>
                <Avatar url={driverAvatarUrl} name={announcement.driver.full_name} size={36} userId={announcement.driver_id} />
                <ThemedText>{announcement.driver.full_name}</ThemedText>
              </Pressable>
            )}
          </ThemedView>
        ) : null}

        <ThemedView type="backgroundElement" style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="location-on" size={16} color="#22c55e" />
            <ThemedText type="smallBold">{t('mechanic.feed.sectionLocation')}</ThemedText>
          </View>
          {/* 15 sept: textele detaliului sunt selectabile — locația scrisă doar ca text
              se copiază în Google Maps / Waze. */}
          <ThemedText selectable>{announcement.location}</ThemedText>
          {latitude != null && longitude != null ? (
            <>
              <MiniMap latitude={latitude} longitude={longitude} />
              {/* iOS: două butoane EGALE, unul lângă altul (Apple + Google Maps —
                  mulți nu folosesc Apple Maps). Android: doar Google, ca înainte. */}
              <View style={styles.mapsButtonsRow}>
                <Pressable
                  onPress={() => openInMaps(latitude, longitude)}
                  style={({ pressed }) => [
                    styles.mapsButton,
                    Platform.OS === 'ios' && styles.mapsButtonHalf,
                    pressed && styles.pressed,
                  ]}
                  hitSlop={8}>
                  <MaterialIcons name="directions" size={16} color="#22c55e" />
                  <ThemedText style={styles.mapsButtonText} numberOfLines={1} adjustsFontSizeToFit>
                    {t(
                      Platform.OS === 'ios'
                        ? 'mechanic.feed.openInMapsIos'
                        : 'mechanic.feed.openInMaps',
                    )}
                  </ThemedText>
                </Pressable>
                {Platform.OS === 'ios' ? (
                  <Pressable
                    onPress={() =>
                      openInGoogleMaps(latitude, longitude)
                    }
                    style={({ pressed }) => [
                      styles.mapsButton,
                      styles.mapsButtonHalf,
                      pressed && styles.pressed,
                    ]}
                    hitSlop={8}>
                    <MaterialIcons name="directions" size={16} color="#22c55e" />
                    <ThemedText style={styles.mapsButtonText} numberOfLines={1} adjustsFontSizeToFit>
                      {t('mechanic.feed.openInMaps')}
                    </ThemedText>
                  </Pressable>
                ) : null}
              </View>
            </>
          ) : null}
        </ThemedView>

        {truckInfo || plateNumber || chassisNumber ? (
          <ThemedView type="backgroundElement" style={styles.section}>
            <View style={styles.sectionHeader}>
              <MaterialIcons name="local-shipping" size={16} color="#22c55e" />
              <ThemedText type="smallBold">{t('truck.sectionTitle')}</ThemedText>
            </View>
            {truckInfo ? <ThemedText selectable>{truckInfo}</ThemedText> : null}
            {plateNumber ? (
              <ThemedText themeColor="textSecondary" type="small" selectable>
                {t('truck.plateLabel')}: {plateNumber}
              </ThemedText>
            ) : null}
            {chassisNumber ? (
              <ThemedText themeColor="textSecondary" type="small" selectable>
                {t('truck.chassisLabel')}: {chassisNumber}
              </ThemedText>
            ) : null}
          </ThemedView>
        ) : null}

        <ThemedView type="backgroundElement" style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="build" size={16} color="#22c55e" />
            <ThemedText type="smallBold">{t('mechanic.feed.sectionDescription')}</ThemedText>
          </View>
          <ThemedText style={styles.descriptionText} selectable>
            {translation.translated && !translation.translated.sameLanguage && translation.showingTranslation
              ? translation.translated.text
              : announcement.description}
          </ThemedText>
          {translation.translated && !translation.translated.sameLanguage ? (
            <View style={styles.translateRow}>
              {translation.showingTranslation ? (
                <ThemedText themeColor="textSecondary" type="small">
                  {t('common.translate.autoLabel')} ·
                </ThemedText>
              ) : null}
              <Pressable onPress={translation.toggle} hitSlop={8} accessibilityRole="button">
                <ThemedText type="small" style={[styles.translateLink, { color: theme.brand }]}>
                  {t(
                    translation.showingTranslation
                      ? 'common.translate.showOriginal'
                      : 'common.translate.showTranslation',
                  )}
                </ThemedText>
              </Pressable>
            </View>
          ) : translation.canTranslate ? (
            <>
              <Pressable
                onPress={handleTranslate}
                disabled={translation.loading}
                hitSlop={8}
                accessibilityRole="button"
                style={({ pressed }) => [styles.translateButton, pressed && styles.pressed]}>
                {translation.loading ? (
                  <ActivityIndicator size="small" color={theme.brand} />
                ) : (
                  <MaterialIcons name="translate" size={16} color={theme.brand} />
                )}
                <ThemedText type="small" style={[styles.translateLink, { color: theme.brand }]}>
                  {t('common.translate.button')}
                </ThemedText>
              </Pressable>
              {translation.error ? (
                <ThemedText type="small" style={styles.translateError}>
                  {t(translation.error)}
                </ThemedText>
              ) : null}
            </>
          ) : null}
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
            <Button
              title={t('mechanic.apply.buttonContact')}
              variant="success"
              loading={contacting}
              onPress={handleContactAuthor}
            />
            <ThemedText themeColor="textSecondary" style={styles.hint}>
              {t('mechanic.apply.interestedHint')} {t('mechanic.apply.contactHint')}
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

      {shareOpen ? (
        <UserPickerSheet
          visible
          title={t('attach.shareTitle')}
          onClose={() => setShareOpen(false)}
          onPick={(user) => handleShareTo(user.id)}
        />
      ) : null}

      {/* Faza 8.3 (D8.5): raport pe anunțul de depanare (snapshot = descrierea, prima poză). */}
      <ReportSheet
        visible={reportOpen}
        reportedUserId={announcement.driver_id}
        announcementId={announcement.id}
        contentSnapshot={announcement.description}
        imagePathSnapshot={photos[0]?.storage_path ?? null}
        onClose={() => setReportOpen(false)}
        onSubmitted={() => {
          setReportOpen(false);
          Alert.alert(t('report.submittedTitle'), t('report.submitted'));
        }}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.four },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
  },
  takenTitle: { fontSize: 22, lineHeight: 30, textAlign: 'center' },
  takenDesc: { textAlign: 'center', lineHeight: 22 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
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
  translateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    alignSelf: 'flex-start',
  },
  translateRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.one },
  translateLink: { fontWeight: '600' },
  translateError: { color: '#ef4444' },
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
  mapsButtonsRow: { flexDirection: 'row', gap: Spacing.two },
  mapsButtonHalf: { flex: 1, alignSelf: 'auto', justifyContent: 'center' },
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
