import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useSettings, type AdminViewAs } from '@/hooks/use-settings';
import { useTheme } from '@/hooks/use-theme';
import { fetchDashboardStats, type DashboardStats } from '@/hooks/use-admin';

export default function AdminDashboard() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { signOut } = useAuth();
  const { setAdminViewAs } = useSettings();
  const [stats, setStats] = useState<DashboardStats | null>(null);

  function enterAs(mode: Exclude<AdminViewAs, 'admin'>) {
    setAdminViewAs(mode);
    router.replace(mode === 'driver' ? '/(driver)/announcements' : '/(mechanic)/feed');
  }

  useFocusEffect(
    useCallback(() => {
      let active = true;
      fetchDashboardStats().then(({ data }) => {
        if (active && data) setStats(data);
      });
      return () => {
        active = false;
      };
    }, [])
  );

  return (
    <ThemedView style={{ flex: 1 }}>
      <ScreenHeader
        title={t('admin.dashboard.title')}
        right={
          <Pressable onPress={signOut} hitSlop={12} accessibilityLabel={t('admin.logout')}>
            <MaterialIcons name="logout" size={24} color={theme.onHeader} />
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Section title={t('admin.dashboard.sectionUsers')}>
          <Stat label={t('admin.dashboard.usersTotal')} value={stats?.users_total} />
          <Stat label={t('admin.dashboard.drivers')} value={stats?.users_drivers} />
          <Stat label={t('admin.dashboard.mechanics')} value={stats?.users_mechanics} />
          <Stat label={t('admin.dashboard.banned')} value={stats?.users_banned} />
          <Stat label={t('admin.dashboard.new7d')} value={stats?.users_new_7d} />
          <Stat label={t('admin.dashboard.new30d')} value={stats?.users_new_30d} />
        </Section>

        <Section title={t('admin.dashboard.sectionAnnouncements')}>
          <Stat label={t('admin.dashboard.annOpen')} value={stats?.ann_open} />
          <Stat label={t('admin.dashboard.annAccepted')} value={stats?.ann_accepted} />
          <Stat label={t('admin.dashboard.annResolved')} value={stats?.ann_resolved} />
          <Stat label={t('admin.dashboard.annCancelled')} value={stats?.ann_cancelled} />
        </Section>

        <Section title={t('admin.dashboard.sectionActivity')}>
          <Stat label={t('admin.dashboard.reportsPending')} value={stats?.reports_pending} highlight />
          <Stat label={t('admin.dashboard.conversations')} value={stats?.conversations} />
          <Stat label={t('admin.dashboard.messages')} value={stats?.messages} />
        </Section>

        <View style={styles.userMode}>
          <ThemedText themeColor="textSecondary" type="small" style={styles.sectionTitle}>
            {t('admin.dashboard.sectionUserMode')}
          </ThemedText>
          <Button
            title={t('admin.dashboard.enterAsDriver')}
            onPress={() => enterAs('driver')}
            variant="secondary"
          />
          <Button
            title={t('admin.dashboard.enterAsMechanic')}
            onPress={() => enterAs('mechanic')}
            variant="secondary"
          />
        </View>
      </ScrollView>
    </ThemedView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <ThemedText themeColor="textSecondary" type="small" style={styles.sectionTitle}>
        {title}
      </ThemedText>
      <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>{children}</View>
    </View>
  );
}

function Stat({ label, value, highlight }: { label: string; value?: number; highlight?: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.row, { borderColor: theme.background }]}>
      <ThemedText>{label}</ThemedText>
      <ThemedText style={[styles.value, highlight && value ? { color: '#ef4444' } : null]}>
        {value ?? '—'}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: Spacing.three, gap: Spacing.four },
  userMode: { gap: Spacing.two },
  section: { gap: Spacing.two },
  sectionTitle: { textTransform: 'uppercase', letterSpacing: 0.5 },
  card: { borderRadius: Radius.card, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  value: { fontWeight: '700', fontSize: 16 },
});
