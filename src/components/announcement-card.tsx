import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { StatusBadge } from '@/components/ui/status-badge';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Announcement } from '@/types/database';

interface AnnouncementCardProps {
  announcement: Announcement;
  onPress: () => void;
  driverName?: string;
  compact?: boolean;
  rejectedByUser?: boolean;
  selectionMode?: boolean;
  selected?: boolean;
  selectable?: boolean;
  onLongPress?: () => void;
  onToggleSelect?: () => void;
}

export function AnnouncementCard({ announcement, onPress, driverName, compact = false, rejectedByUser = false, selectionMode, selected, selectable = true, onLongPress, onToggleSelect }: AnnouncementCardProps) {
  const theme = useTheme();
  const { t } = useTranslation();

  function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t('common.timeNow');
    if (mins < 60) return t('common.timeMinsAgo', { count: mins });
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t('common.timeHoursAgo', { count: hrs });
    return t('common.timeDaysAgo', { count: Math.floor(hrs / 24) });
  }

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
      <ThemedView type="backgroundElement" style={[styles.card, selected && styles.cardSelected]}>
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
                <MaterialIcons name="location-on" size={14} color={theme.textSecondary} />
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
                  <MaterialIcons name="person" size={12} color={theme.textSecondary} />
                  <ThemedText themeColor="textSecondary" type="small" style={styles.driverName}>
                    {driverName}
                  </ThemedText>
                </View>
              ) : null}
              <ThemedText themeColor="textSecondary" type="small" numberOfLines={1} style={styles.time}>
                {timeAgo(announcement.created_at)}
              </ThemedText>
            </View>
          </View>
        </View>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  cardSelected: { borderWidth: 1.5, borderColor: '#22c55e' },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  cardContent: { flex: 1 },
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
    gap: 4,
    flex: 1,
  },
  location: { flex: 1 },
  description: { lineHeight: 20 },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  driverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  driverName: { fontSize: 12 },
  time: { flexShrink: 0 },

  // Compact card
  compactCard: {
    borderRadius: Spacing.two,
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

  rejectedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    backgroundColor: '#ef44441A',
  },
  rejectedBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ef4444',
  },
  pressed: { opacity: 0.7 },
});
