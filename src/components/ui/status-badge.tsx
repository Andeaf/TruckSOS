import { StyleSheet, Text, View } from 'react-native';

import type { AnnouncementStatus } from '@/types/database';

const CONFIG: Record<AnnouncementStatus, { label: string; color: string; bg: string }> = {
  open:     { label: 'Deschis',  color: '#208AEF', bg: '#208AEF1A' },
  accepted: { label: 'Acceptat', color: '#f59e0b', bg: '#f59e0b1A' },
  resolved: { label: 'Rezolvat', color: '#22c55e', bg: '#22c55e1A' },
};

export function StatusBadge({ status }: { status: AnnouncementStatus }) {
  const { label, color, bg } = CONFIG[status];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.label, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
  },
});
