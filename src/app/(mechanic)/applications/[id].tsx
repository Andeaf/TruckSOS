import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { ApplyBottomSheet } from '@/components/apply-bottom-sheet';
import { Avatar } from '@/components/avatar';
import { MiniMap } from '@/components/mini-map';
import { PhotoGallery } from '@/components/photo-gallery';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useSignedUrl } from '@/hooks/use-signed-urls';
import { useTheme } from '@/hooks/use-theme';
import {
  useApplication,
  withdrawApplication,
  dismissApplication,
} from '@/hooks/use-announcements';
import { useAnnouncementPhotos } from '@/hooks/use-announcement-photos';
import type { ApplicationStatus, PriceType } from '@/types/database';
import { openInGoogleMaps, openInMaps } from '@/lib/location';

const STATUS_COLORS: Record<ApplicationStatus, { color: string; bg: string }> = {
  pending:  { color: '#f59e0b', bg: '#f59e0b1A' },
  accepted: { color: '#22c55e', bg: '#22c55e1A' },
  rejected: { color: '#ef4444', bg: '#ef44441A' },
};

function StatusBadge({ status }: { status: ApplicationStatus }) {
  const { t } = useTranslation();
  const { color, bg } = STATUS_COLORS[status];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeLabel, { color }]}>
        {t(`mechanic.applications.status_${status}`)}
      </Text>
    </View>
  );
}

function priceLabel(priceType: PriceType, amount: number, currency: string, t: (k: string) => string) {
  const typeLabel = priceType === 'fixed'
    ? t('mechanic.apply.priceTypeFixed')
    : t('mechanic.apply.priceTypeHourly');
  return `${amount} ${currency} · ${typeLabel}`;
}

function SectionTitle({ label }: { label: string }) {
  return <ThemedText type="smallBold" style={styles.sectionTitle}>{label}</ThemedText>;
}

function InfoRow({ icon, text }: { icon: React.ComponentProps<typeof MaterialIcons>['name']; text: string }) {
  const theme = useTheme();
  return (
    <View style={styles.infoRow}>
      <MaterialIcons name={icon} size={14} color={theme.textSecondary} />
      {/* 15 sept: selectabil — locația/șasiul se copiază (ex. în Google Maps / Waze). */}
      <ThemedText themeColor="textSecondary" type="small" style={styles.infoText} selectable>
        {text}
      </ThemedText>
    </View>
  );
}

export default function ApplicationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { application: item, loading, refresh } = useApplication(id);
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [sheetVisible, setSheetVisible] = useState(false);
  // `id` din rută e al APLICAȚIEI; anunțul (deci pozele) se știe abia după load.
  const { photos } = useAnnouncementPhotos(item?.announcement?.id ?? '');
  const driverAvatarUrl = useSignedUrl(item?.announcement?.driver?.avatar_path);

  if (loading) {
    return (
      <ThemedView style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator color={theme.textSecondary} />
      </ThemedView>
    );
  }

  if (!item || !item.announcement) {
    return (
      <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={24} color={theme.textSecondary} />
        </Pressable>
      </ThemedView>
    );
  }

  const { announcement } = item;
  const conversationId = announcement.conversations?.[0]?.id ?? null;
  const isResubmittable = item.status === 'rejected' && announcement.status === 'open';
  const isDismissable = !isResubmittable && (item.status === 'rejected' || announcement.status === 'cancelled');

  const truckLine = announcement.truck_make || announcement.truck_model
    ? [announcement.truck_make, announcement.truck_model, announcement.truck_year].filter(Boolean).join(' ')
    : null;

  function handleWithdraw() {
    Alert.alert(
      t('mechanic.applications.withdrawConfirmTitle'),
      t('mechanic.applications.withdrawConfirmMessage'),
      [
        { text: t('driver.announcements.cancelConfirmCancel'), style: 'cancel' },
        {
          text: t('mechanic.applications.withdrawConfirmOk'),
          style: 'destructive',
          onPress: async () => {
            await withdrawApplication(item!.id);
            router.back();
          },
        },
      ]
    );
  }

  function handleDismiss() {
    Alert.alert(
      t('mechanic.applications.dismissConfirmTitle'),
      undefined,
      [
        { text: t('driver.announcements.cancelConfirmCancel'), style: 'cancel' },
        {
          text: t('mechanic.applications.dismissConfirmOk'),
          style: 'destructive',
          onPress: async () => {
            const err = await dismissApplication(item!.id);
            if (err) Alert.alert(t('common.error'), err);
            else router.back();
          },
        },
      ]
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader
        title={t('mechanic.applications.detailTitle')}
        onBack={() => router.back()}
        right={<StatusBadge status={item.status} />}
      />

      <ScrollView contentContainerStyle={styles.content}>
        <SectionTitle label={t('mechanic.applications.sectionAnnouncement')} />
        <ThemedView type="backgroundElement" style={styles.section}>
          <View style={styles.personRow}>
            <Avatar
              url={driverAvatarUrl}
              name={announcement.driver?.full_name}
              size={36}
            />
            <ThemedText>{announcement.driver?.full_name ?? t('common.defaultUser')}</ThemedText>
          </View>
          <InfoRow icon="location-on" text={announcement.location} />
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
                      openInGoogleMaps(announcement.latitude!, announcement.longitude!)
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
          <ThemedText themeColor="textSecondary" type="small" style={styles.description} selectable>
            {announcement.description}
          </ThemedText>
          {truckLine ? <InfoRow icon="local-shipping" text={truckLine} /> : null}
          {announcement.chassis_number ? (
            <InfoRow icon="tag" text={`${t('truck.chassisLabel')}: ${announcement.chassis_number}`} />
          ) : null}
        </ThemedView>

        {photos.length > 0 ? (
          <>
            <SectionTitle label={t('photos.sectionTitle')} />
            <ThemedView type="backgroundElement" style={styles.section}>
              <PhotoGallery photos={photos} />
            </ThemedView>
          </>
        ) : null}

        <SectionTitle label={t('mechanic.applications.sectionOffer')} />
        <ThemedView type="backgroundElement" style={styles.section}>
          <ThemedText type="smallBold" style={styles.price}>
            {priceLabel(item.price_type, item.price_amount, item.currency, t)}
          </ThemedText>
          {item.message ? (
            <ThemedText themeColor="textSecondary" type="small" style={styles.offerMessage}>
              &quot;{item.message}&quot;
            </ThemedText>
          ) : null}
        </ThemedView>

        <View style={styles.actions}>
          {item.status === 'accepted' && conversationId ? (
            <Pressable
              onPress={() => router.push({ pathname: '/(mechanic)/conversations/[id]' as never, params: { id: conversationId } })}
              style={({ pressed }) => [styles.chatButton, pressed && styles.pressed]}>
              <MaterialIcons name="chat" size={16} color="#22c55e" />
              <Text style={styles.chatButtonText}>{t('mechanic.applications.goToChat')}</Text>
            </Pressable>
          ) : null}

          {isResubmittable ? (
            <Pressable
              onPress={() => setSheetVisible(true)}
              style={({ pressed }) => [styles.resubmitButton, pressed && styles.pressed]}>
              <Text style={styles.resubmitButtonText}>{t('mechanic.apply.resubmitSheetTitle')}</Text>
            </Pressable>
          ) : null}

          {item.status === 'pending' ? (
            <Pressable
              onPress={handleWithdraw}
              style={({ pressed }) => [styles.withdrawButton, pressed && styles.pressed]}>
              <Text style={styles.withdrawButtonText}>{t('mechanic.applications.withdrawButton')}</Text>
            </Pressable>
          ) : null}

          {isDismissable ? (
            <Pressable
              onPress={handleDismiss}
              style={({ pressed }) => [styles.withdrawButton, pressed && styles.pressed]}>
              <Text style={styles.withdrawButtonText}>{t('mechanic.applications.dismissButton')}</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>

      <ApplyBottomSheet
        visible={sheetVisible}
        announcementId={announcement.id}
        onClose={() => setSheetVisible(false)}
        onSuccess={() => { setSheetVisible(false); refresh(); }}
        applicationId={item.id}
        initialData={{
          priceType: item.price_type,
          priceAmount: item.price_amount,
          currency: item.currency,
          message: item.message || '',
        }}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { justifyContent: 'center', alignItems: 'center' },
  backButton: { padding: 4 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.six,
    gap: Spacing.two,
  },
  sectionTitle: {
    marginTop: Spacing.two,
    marginBottom: Spacing.one,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontSize: 11,
  },
  section: {
    borderRadius: Radius.card,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  infoText: { flex: 1 },
  mapsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    alignSelf: 'flex-start',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.control,
    borderWidth: 1.5,
    borderColor: '#22c55e',
  },
  mapsButtonText: { color: '#22c55e', fontSize: 14, fontWeight: '600' },
  mapsButtonsRow: { flexDirection: 'row', gap: Spacing.two },
  mapsButtonHalf: { flex: 1, alignSelf: 'auto', justifyContent: 'center' },
  description: { lineHeight: 20 },
  price: { color: '#22c55e', fontSize: 15 },
  offerMessage: { fontStyle: 'italic' },
  actions: { gap: Spacing.two, marginTop: Spacing.two },
  chatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    borderRadius: Radius.control,
    backgroundColor: '#22c55e1A',
    borderWidth: 1,
    borderColor: '#22c55e',
  },
  chatButtonText: { fontSize: 15, fontWeight: '600', color: '#22c55e' },
  resubmitButton: {
    paddingVertical: Spacing.three,
    borderRadius: Radius.control,
    backgroundColor: '#22c55e1A',
    borderWidth: 1,
    borderColor: '#22c55e',
    alignItems: 'center',
  },
  resubmitButtonText: { fontSize: 15, fontWeight: '600', color: '#22c55e' },
  withdrawButton: {
    paddingVertical: Spacing.three,
    borderRadius: Radius.control,
    backgroundColor: '#ef44441A',
    alignItems: 'center',
  },
  withdrawButtonText: { fontSize: 15, fontWeight: '600', color: '#ef4444' },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: Radius.badge,
    alignSelf: 'flex-start',
  },
  badgeLabel: { fontSize: 12, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
