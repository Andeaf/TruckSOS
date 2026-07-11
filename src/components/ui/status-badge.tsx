import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Radius } from '@/constants/theme';
import type { AnnouncementStatus } from '@/types/database';

const COLORS: Record<AnnouncementStatus, { color: string; bg: string }> = {
  open:      { color: '#208AEF', bg: '#208AEF1A' },
  accepted:  { color: '#f59e0b', bg: '#f59e0b1A' },
  resolved:  { color: '#22c55e', bg: '#22c55e1A' },
  cancelled: { color: '#6b7280', bg: '#6b72801A' },
};

export function StatusBadge({ status }: { status: AnnouncementStatus }) {
  const { t } = useTranslation();
  const { color, bg } = COLORS[status];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.label, { color }]}>{t(`status.${status}`)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: Radius.badge,
    alignSelf: 'flex-start',
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
  },
});
