import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useBack } from '@/hooks/use-back';

import { StatusBadge } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import {
  fetchAnnouncementById,
  fetchApplicationsForAnnouncement,
  acceptApplication,
  rejectApplication,
  resolveAnnouncement,
  cancelAnnouncement,
  type AnnouncementWithMechanic,
  type ApplicationWithMechanic,
} from '@/hooks/use-announcements';
import type { PriceType } from '@/types/database';

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString('ro-RO', {
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
  onAccept,
  onReject,
}: {
  app: ApplicationWithMechanic;
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
        <MaterialIcons name="person" size={16} color="#208AEF" />
        <ThemedText type="smallBold" style={styles.applicantName}>
          {app.mechanic.full_name}
        </ThemedText>
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
  const { t } = useTranslation();
  const router = useRouter();
  const goBack = useBack('/(driver)/announcements');
  const insets = useSafeAreaInsets();
  const [announcement, setAnnouncement] = useState<AnnouncementWithMechanic | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');
  const [applications, setApplications] = useState<ApplicationWithMechanic[]>([]);

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
    <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={goBack} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={24} color="#60646C" />
        </Pressable>
        <ThemedText type="subtitle" style={styles.title}>{t('driver.announcements.detailTitle')}</ThemedText>
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
            <ThemedText type="smallBold">{t('driver.announcements.sectionLocation')}</ThemedText>
          </View>
          <ThemedText>{announcement.location}</ThemedText>
        </ThemedView>

        {truckInfo ? (
          <ThemedView type="backgroundElement" style={styles.section}>
            <View style={styles.sectionHeader}>
              <MaterialIcons name="local-shipping" size={16} color="#208AEF" />
              <ThemedText type="smallBold">{t('truck.sectionTitle')}</ThemedText>
            </View>
            <ThemedText>{truckInfo}</ThemedText>
          </ThemedView>
        ) : null}

        <ThemedView type="backgroundElement" style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="build" size={16} color="#208AEF" />
            <ThemedText type="smallBold">{t('driver.announcements.sectionDescription')}</ThemedText>
          </View>
          <ThemedText style={styles.descriptionText}>{announcement.description}</ThemedText>
        </ThemedView>

        {announcement.status === 'accepted' && announcement.mechanic ? (
          <ThemedView type="backgroundElement" style={styles.section}>
            <View style={styles.sectionHeader}>
              <MaterialIcons name="person" size={16} color="#f59e0b" />
              <ThemedText type="smallBold">{t('driver.announcements.sectionMechanic')}</ThemedText>
            </View>
            <ThemedText>{announcement.mechanic.full_name}</ThemedText>
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
          <ThemedText themeColor="textSecondary" style={styles.hint}>
            {t('driver.announcements.hintResolved')}
          </ThemedText>
        ) : null}

        {announcement.status === 'cancelled' ? (
          <ThemedText themeColor="textSecondary" style={styles.hint}>
            {t('driver.announcements.hintCancelled')}
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
    borderRadius: Spacing.two,
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
});
