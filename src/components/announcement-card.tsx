import { Pressable, StyleSheet, View } from 'react-native';
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
}

export function AnnouncementCard({ announcement, onPress, driverName }: AnnouncementCardProps) {
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

  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView type="backgroundElement" style={styles.card}>
        <View style={styles.header}>
          <View style={styles.locationRow}>
            <MaterialIcons name="location-on" size={14} color={theme.textSecondary} />
            <ThemedText type="smallBold" style={styles.location} numberOfLines={1}>
              {announcement.location}
            </ThemedText>
          </View>
          <StatusBadge status={announcement.status} />
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
          <ThemedText themeColor="textSecondary" type="small">
            {timeAgo(announcement.created_at)}
          </ThemedText>
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
  location: {
    flex: 1,
  },
  description: {
    lineHeight: 20,
  },
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
  driverName: {
    fontSize: 12,
  },
  pressed: {
    opacity: 0.7,
  },
});
