import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/components/avatar';
import { MiniMap } from '@/components/mini-map';
import { PhotoGallery } from '@/components/photo-gallery';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { Radius, Spacing } from '@/constants/theme';
import { useAccountGate } from '@/hooks/use-account-gate';
import { useBack } from '@/hooks/use-back';
import {
  fetchGuestAnnouncement,
  fetchGuestAnnouncementPhotos,
  type GuestAnnouncementDetail as Detail,
  type GuestDataError,
} from '@/hooks/use-guest-data';
import { useSignedUrl } from '@/hooks/use-signed-urls';
import { useTheme } from '@/hooks/use-theme';
import type { GuestAnnouncement } from '@/types/database';

const LOCALE_MAP: Record<string, string> = { ro: 'ro-RO', en: 'en-GB', de: 'de-DE' };

function formatDate(dateStr: string, language: string) {
  return new Date(dateStr).toLocaleString(LOCALE_MAP[language] ?? 'ro-RO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTruck(a: GuestAnnouncement): string | null {
  const parts = [
    a.truck_make,
    a.truck_model,
    a.truck_year != null ? String(a.truck_year) : null,
  ].filter(Boolean) as string[];
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * 1.1 (B3): detaliul unui anunț deschis pentru OASPEȚI. Ecran separat de
 * `(mechanic)/feed/[id].tsx` (acolo: candidatura proprie, share, vizualizări pentru
 * admin, „văzut” local, traducere reală) — aici doar ce expune `guest_announcements`:
 * fără plăcuță/VIN, poziția rotunjită la ~1 km. Acțiunile cer cont (pop-up, B2).
 * Fără `record_announcement_view` și fără `markAnnouncementViewed`.
 */
export function GuestAnnouncementDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const goBack = useBack('/(guest)/announcements');
  const { requireAccount } = useAccountGate();

  const [detail, setDetail] = useState<Detail | null>(null);
  const [photos, setPhotos] = useState<{ id: string; url: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<GuestDataError | null>(null);
  const driverAvatarUrl = useSignedUrl(detail?.driver?.avatar_path);

  // Reîncărcare la focus (fără Realtime): anunțul poate fi preluat între timp.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const [d, p] = await Promise.all([
          fetchGuestAnnouncement(id ?? ''),
          fetchGuestAnnouncementPhotos(id ?? ''),
        ]);
        if (!active) return;
        // Rețea picată la o reîncărcare: păstrăm ce era deja pe ecran.
        if (!d.error) setDetail(d.data);
        if (!p.error) setPhotos(p.data);
        setError(d.error);
        setLoading(false);
      })();
      return () => {
        active = false;
      };
    }, [id]),
  );

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <ScreenHeader title={t('mechanic.feed.detailTitle')} onBack={goBack} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.brand} />
        </View>
      </ThemedView>
    );
  }

  if (!detail) {
    // Fără view-urile B1 pe server („unavailable”) sau cu rețeaua picată: eroare de încărcare, nu „anunț preluat”.
    const failed = error === 'failed' || error === 'unavailable';
    return (
      <ThemedView style={styles.container}>
        <ScreenHeader title={t('mechanic.feed.detailTitle')} onBack={goBack} />
        <View style={styles.centered}>
          <MaterialIcons
            name={failed ? 'cloud-off' : 'check-circle'}
            size={52}
            color={failed ? theme.textSecondary : '#22c55e'}
          />
          <ThemedText type="subtitle" style={styles.takenTitle}>
            {failed ? t('guest.loadErrorTitle') : t('mechanic.feed.unavailableTitle')}
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.takenDesc}>
            {failed ? t('guest.loadErrorDescription') : t('mechanic.feed.unavailableDescription')}
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  const { announcement, driver } = detail;
  const truckInfo = formatTruck(announcement);
  const lat = announcement.lat_approx != null ? Number(announcement.lat_approx) : null;
  const lng = announcement.lng_approx != null ? Number(announcement.lng_approx) : null;
  const coords =
    lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)
      ? { latitude: lat, longitude: lng }
      : null;
  // Profilul unui transportator nu stă în tab-ul Mecanici → autorul e apăsabil doar dacă e mecanic.
  const authorIsMechanic = driver?.role === 'mechanic';

  const authorRow = (
    <>
      <Avatar
        url={driverAvatarUrl}
        name={driver?.full_name}
        size={36}
        userId={announcement.driver_id}
      />
      <ThemedText>{driver?.full_name || t('common.defaultUser')}</ThemedText>
    </>
  );

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t('mechanic.feed.detailTitle')} onBack={goBack} />

      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText themeColor="textSecondary" type="small" style={styles.date}>
          {formatDate(announcement.created_at, i18n.language)}
        </ThemedText>

        <ThemedView type="backgroundElement" style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="person" size={16} color="#22c55e" />
            <ThemedText type="smallBold">{t('mechanic.feed.sectionDriver')}</ThemedText>
          </View>
          {authorIsMechanic ? (
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/(guest)/mechanics/[id]',
                  params: { id: announcement.driver_id },
                } as never)
              }
              accessibilityRole="button"
              accessibilityHint={t('common.openProfile')}
              style={({ pressed }) => [styles.personRow, pressed && styles.pressed]}>
              {authorRow}
            </Pressable>
          ) : (
            <View style={styles.personRow}>{authorRow}</View>
          )}
        </ThemedView>

        <ThemedView type="backgroundElement" style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="location-on" size={16} color="#22c55e" />
            <ThemedText type="smallBold">{t('mechanic.feed.sectionLocation')}</ThemedText>
          </View>
          <ThemedText selectable>{announcement.location}</ThemedText>
          {coords ? (
            <>
              <MiniMap latitude={coords.latitude} longitude={coords.longitude} />
              <ThemedText themeColor="textSecondary" type="small">
                {t('guest.approxLocation')}
              </ThemedText>
            </>
          ) : null}
        </ThemedView>

        {truckInfo ? (
          <ThemedView type="backgroundElement" style={styles.section}>
            <View style={styles.sectionHeader}>
              <MaterialIcons name="local-shipping" size={16} color="#22c55e" />
              <ThemedText type="smallBold">{t('truck.sectionTitle')}</ThemedText>
            </View>
            <ThemedText selectable>{truckInfo}</ThemedText>
          </ThemedView>
        ) : null}

        <ThemedView type="backgroundElement" style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="build" size={16} color="#22c55e" />
            <ThemedText type="smallBold">{t('mechanic.feed.sectionDescription')}</ThemedText>
          </View>
          <ThemedText style={styles.descriptionText} selectable>
            {announcement.description}
          </ThemedText>
          {/* D9: traducerea cere cont (rate limit per utilizator) → pop-up. */}
          <Pressable
            onPress={() => requireAccount('translate')}
            hitSlop={8}
            accessibilityRole="button"
            style={({ pressed }) => [styles.translateButton, pressed && styles.pressed]}>
            <MaterialIcons name="translate" size={16} color={theme.brand} />
            <ThemedText type="small" style={[styles.translateLink, { color: theme.brand }]}>
              {t('common.translate.button')}
            </ThemedText>
          </Pressable>
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

        <Button
          title={t('mechanic.apply.buttonInterested')}
          onPress={() => requireAccount('apply')}
        />
        <Button
          title={t('mechanic.apply.buttonContact')}
          variant="success"
          onPress={() => requireAccount('contact')}
        />
        <ThemedText themeColor="textSecondary" style={styles.hint}>
          {t('guest.actionsHint')}
        </ThemedText>
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
  personRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  content: { padding: Spacing.four, gap: Spacing.three },
  date: { textAlign: 'right' },
  section: { borderRadius: Radius.card, padding: Spacing.three, gap: Spacing.two },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  descriptionText: { lineHeight: 24 },
  translateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    alignSelf: 'flex-start',
  },
  translateLink: { fontWeight: '600' },
  hint: { textAlign: 'center', fontSize: 14, lineHeight: 20 },
  pressed: { opacity: 0.7 },
});
