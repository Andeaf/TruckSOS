import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import {
  AnnouncementResolvePrompt,
  type AnnouncementResolvePromptProps,
} from '@/components/announcement-resolve-prompt';
import { StatusBadge } from '@/components/ui/status-badge';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Shadows, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTimeAgo } from '@/hooks/use-time-ago';
import type { Announcement } from '@/types/database';

interface AnnouncementCardProps {
  announcement: Announcement;
  onPress: () => void;
  driverName?: string;
  compact?: boolean;
  rejectedByUser?: boolean;
  /** Mecanic (26 iul): am o candidatură ÎN AȘTEPTARE pe anunț → badge „În așteptare"
   * în locul lui „Deschis" (are prioritate și peste „Nou" — evident l-am văzut). */
  appliedByUser?: boolean;
  /** Mecanic: anunț nedeschis încă → „Nou" în loc de status („Deschis"). */
  isNew?: boolean;
  /**
   * Mecanic, cu filtrul de rază activ: distanța până la anunț (km) sau `null`
   * dacă anunțul n-are coordonate („Locație nespecificată"). `undefined` = filtru
   * inactiv, nu se afișează nimic.
   */
  distanceKm?: number | null;
  /** Șofer: câți mecanici așteaptă răspuns pe acest anunț (0 = fără badge). */
  applicantCount?: number;
  selectionMode?: boolean;
  selected?: boolean;
  selectable?: boolean;
  onLongPress?: () => void;
  onToggleSelect?: () => void;
  /**
   * Șofer (4 sept): caseta „Și-a găsit anunțul rezolvarea?" — prezentă = se randează
   * în card, sub metadate, iar cardul primește conturul chihlimbar. Ignorată în
   * modul de selecție (cardul are alt contur și alt sens la apăsare).
   */
  resolvePrompt?: AnnouncementResolvePromptProps;
}

export function AnnouncementCard({ announcement, onPress, driverName, compact = false, rejectedByUser = false, appliedByUser = false, isNew = false, distanceKm, applicantCount = 0, selectionMode, selected, selectable = true, onLongPress, onToggleSelect, resolvePrompt }: AnnouncementCardProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const promptVisible = resolvePrompt !== undefined && !selectionMode;
  // 6 oct: același formator ca restul listelor (copia locală de aici rămăsese în urmă).
  const timeAgo = useTimeAgo();

  if (compact) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
        <ThemedView type="backgroundElement" style={styles.compactCard}>
          <View style={styles.compactMain}>
            <MaterialIcons name="location-on" size={13} color={theme.textSecondary} />
            <ThemedText type="small" numberOfLines={1} style={styles.compactLocation}>
              {announcement.location}
            </ThemedText>
          </View>
          <View style={styles.compactRight}>
            {distanceKm === null ? (
              <MaterialIcons name="location-off" size={12} color={theme.textSecondary} />
            ) : null}
            {announcement.truck_make ? (
              <View style={styles.compactTruck}>
                <MaterialIcons name="local-shipping" size={12} color={theme.textSecondary} />
                <ThemedText themeColor="textSecondary" type="small" numberOfLines={1} style={styles.compactTruckText}>
                  {announcement.truck_make}
                </ThemedText>
              </View>
            ) : null}
            <ThemedText themeColor="textSecondary" type="small" numberOfLines={1} style={styles.compactTime}>
              {timeAgo(announcement.created_at)}
            </ThemedText>
          </View>
        </ThemedView>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={selectionMode ? (selectable ? onToggleSelect : undefined) : onPress}
      onLongPress={selectionMode ? undefined : onLongPress}
      style={({ pressed }) => [
        pressed && !selectionMode && styles.pressed,
        selectionMode && !selectable && styles.dimmed,
      ]}>
      <ThemedView
        type="backgroundElement"
        style={[styles.card, promptVisible && styles.cardPrompted, selected && styles.cardSelected]}>
        <View style={styles.cardRow}>
          {selectionMode && selectable ? (
            <MaterialIcons
              name={selected ? 'check-box' : 'check-box-outline-blank'}
              size={20}
              color={selected ? '#22c55e' : theme.textSecondary}
            />
          ) : null}
          <View style={styles.cardContent}>
            <View style={styles.header}>
              <View style={styles.locationRow}>
                <MaterialIcons name="location-pin" size={16} color={theme.brand} />
                <ThemedText type="smallBold" style={styles.location} numberOfLines={1}>
                  {announcement.location}
                </ThemedText>
              </View>
              {rejectedByUser ? (
                <View style={styles.rejectedBadge}>
                  <Text style={styles.rejectedBadgeText}>
                    {t('mechanic.applications.status_rejected')}
                  </Text>
                </View>
              ) : appliedByUser ? (
                <StatusBadge status="pending" />
              ) : isNew ? (
                <View style={styles.newBadge}>
                  <Text style={styles.newBadgeText}>{t('status.new')}</Text>
                </View>
              ) : (
                <StatusBadge status={announcement.status} />
              )}
            </View>

            <ThemedText themeColor="textSecondary" numberOfLines={2} style={styles.description}>
              {announcement.description}
            </ThemedText>

            <View style={styles.footer}>
              {driverName ? (
                <View style={styles.driverRow}>
                  <MaterialIcons name="person" size={12} color={theme.textTertiary} />
                  <ThemedText themeColor="textTertiary" type="small" style={styles.driverName}>
                    {driverName}
                  </ThemedText>
                </View>
              ) : null}
              <ThemedText themeColor="textTertiary" type="small" numberOfLines={1} style={styles.time}>
                {timeAgo(announcement.created_at)}
              </ThemedText>
            </View>

            {distanceKm !== undefined ? (
              <View style={styles.distanceRow}>
                <MaterialIcons
                  name={distanceKm == null ? 'location-off' : 'near-me'}
                  size={12}
                  color={theme.textSecondary}
                />
                <ThemedText themeColor="textSecondary" type="small">
                  {distanceKm == null
                    ? t('radiusFilter.noLocation')
                    : t('radiusFilter.distance', { km: Math.round(distanceKm) })}
                </ThemedText>
              </View>
            ) : null}

            {/* Șofer: mecanici care așteaptă răspuns. Plin, nu conturat — trebuie
                să sară în ochi, e singurul lucru de pe card care cere o acțiune. */}
            {applicantCount > 0 && !selectionMode ? (
              <View style={styles.applicantsRow}>
                <View style={styles.applicantsBadge}>
                  <MaterialIcons name="engineering" size={14} color="#ffffff" />
                  <Text style={styles.applicantsText}>
                    {applicantCount === 1
                      ? t('driver.announcements.applicantsBadgeOne')
                      : t('driver.announcements.applicantsBadge', { count: applicantCount })}
                  </Text>
                </View>
              </View>
            ) : null}

            {promptVisible && resolvePrompt ? <AnnouncementResolvePrompt {...resolvePrompt} /> : null}
          </View>
        </View>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Dimensiunile exacte din design: padding 16×18, titlu 16/700, descriere 14,
  // timestamp 12/600; gap 6 + marginTop 4 = cei 10px dintre descriere și timp.
  card: {
    borderRadius: Radius.card,
    paddingVertical: Spacing.three,
    paddingHorizontal: 18,
    gap: 6,
    ...Shadows.card,
  },
  // Cardul cu caseta „rezolvat?" (design 12c): contur chihlimbar + umbră un pic mai
  // pronunțată — `0 10px 26px rgba(20,40,80,.12)`, mapată ca Shadows.card.
  cardPrompted: {
    borderWidth: 1.5,
    borderColor: '#f0c471',
    shadowColor: '#142850',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 26,
    elevation: 5,
  },
  cardSelected: { borderWidth: 1.5, borderColor: '#22c55e' },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  // gap-ul dintre rândurile cardului stă AICI (cardRow are un singur copil,
  // un gap pe `card` n-ar avea niciun efect).
  cardContent: { flex: 1, gap: 6 },
  dimmed: { opacity: 0.4 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.two,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  location: { flex: 1, fontSize: 16, fontWeight: '700', lineHeight: 21 },
  description: { fontSize: 14, lineHeight: 20 },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  driverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  driverName: { fontSize: 12, fontWeight: '600' },
  time: { flexShrink: 0, fontSize: 12, fontWeight: '600' },
  distanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: Spacing.one,
  },

  // Compact card
  compactCard: {
    borderRadius: Radius.card,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  compactMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
  },
  compactLocation: { flex: 1 },
  compactRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexShrink: 0,
  },
  compactTruck: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  compactTruckText: { maxWidth: 80 },
  compactTime: { flexShrink: 0 },

  applicantsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: Spacing.one,
  },
  applicantsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.badge,
    backgroundColor: '#f59e0b',
  },
  applicantsText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ffffff',
  },
  newBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.badge,
    backgroundColor: '#22c55e1A',
  },
  newBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#22c55e',
  },
  rejectedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.badge,
    backgroundColor: '#ef44441A',
  },
  rejectedBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ef4444',
  },
  pressed: { opacity: 0.7 },
});
