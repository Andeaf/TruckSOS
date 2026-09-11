import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Shadows, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useSettings, type AdminViewAs } from '@/hooks/use-settings';
import { useTheme } from '@/hooks/use-theme';
import { useWideLayout } from '@/components/web-sidebar';
import { fetchDashboardStats, type DashboardStats } from '@/hooks/use-admin';
import { StatsChartModal, type StatsChartKind } from '@/components/admin/stats-chart-modal';

/** Roșul/ambra din design-ul 10b — folosite doar ca accente pe valori. */
const DANGER = '#D64545';
const AMBER = '#C98A1B';

export default function AdminDashboard() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { signOut } = useAuth();
  const { setAdminViewAs } = useSettings();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  // Graficele (11 sept): tap pe orice card de utilizatori/anunțuri deschide modalul.
  const [chart, setChart] = useState<StatsChartKind | null>(null);
  const chartModal = <StatsChartModal kind={chart} onClose={() => setChart(null)} />;
  // Design 10b: pe web lat, statisticile devin carduri pe grilă; pe telefon
  // rămâne lista pe secțiuni. Logout-ul e în sidebar, deci fără ScreenHeader.
  const wide = useWideLayout();

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

  if (wide) {
    return (
      <ThemedView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={w.scroll}>
          <ThemedText style={w.pageTitle}>{t('admin.dashboard.title')}</ThemedText>

          <View style={w.section}>
            <ThemedText themeColor="textTertiary" style={w.sectionLabel}>
              {t('admin.dashboard.sectionUsers')}
            </ThemedText>
            <View style={w.grid}>
              <MiniStat label={t('admin.dashboard.usersTotal')} value={stats?.users_total} onPress={() => setChart('users')} />
              <MiniStat label={t('admin.dashboard.drivers')} value={stats?.users_drivers} onPress={() => setChart('users')} />
              <MiniStat label={t('admin.dashboard.mechanics')} value={stats?.users_mechanics} onPress={() => setChart('users')} />
              <MiniStat label={t('admin.dashboard.banned')} value={stats?.users_banned} color={DANGER} onPress={() => setChart('users')} />
              <MiniStat label={t('admin.dashboard.new7d')} value={stats?.users_new_7d} color={theme.price} onPress={() => setChart('users')} />
              <MiniStat label={t('admin.dashboard.new30d')} value={stats?.users_new_30d} color={theme.price} onPress={() => setChart('users')} />
            </View>
          </View>

          <View style={w.section}>
            <ThemedText themeColor="textTertiary" style={w.sectionLabel}>
              {t('admin.dashboard.sectionAnnouncements')}
            </ThemedText>
            <View style={w.grid}>
              <IconStat
                icon="file-text"
                tileBg={theme.brandSoft}
                tileColor={theme.brand}
                label={t('admin.dashboard.annOpen')}
                onPress={() => setChart('announcements')}
                value={stats?.ann_open}
              />
              <IconStat
                icon="check"
                tileBg={theme.brandSoft}
                tileColor={theme.brand}
                label={t('admin.dashboard.annAccepted')}
                onPress={() => setChart('announcements')}
                value={stats?.ann_accepted}
              />
              <IconStat
                icon="check-circle"
                tileBg={theme.successBg}
                tileColor={theme.successText}
                label={t('admin.dashboard.annResolved')}
                onPress={() => setChart('announcements')}
                value={stats?.ann_resolved}
              />
              <IconStat
                icon="x"
                tileBg="rgba(214,69,69,0.12)"
                tileColor={DANGER}
                label={t('admin.dashboard.annCancelled')}
                onPress={() => setChart('announcements')}
                value={stats?.ann_cancelled}
              />
            </View>
          </View>

          <View style={w.section}>
            <ThemedText themeColor="textTertiary" style={w.sectionLabel}>
              {t('admin.dashboard.sectionActivity')}
            </ThemedText>
            <View style={w.grid}>
              <IconStat
                icon="flag"
                tileBg="rgba(232,160,32,0.16)"
                tileColor={AMBER}
                label={t('admin.dashboard.reportsPending')}
                value={stats?.reports_pending}
              />
              <IconStat
                icon="message-circle"
                tileBg={theme.brandSoft}
                tileColor={theme.brand}
                label={t('admin.dashboard.conversations')}
                value={stats?.conversations}
              />
              <IconStat
                icon="message-square"
                tileBg={theme.brandSoft}
                tileColor={theme.brand}
                label={t('admin.dashboard.messages')}
                value={stats?.messages}
              />
            </View>
          </View>

          <View style={w.section}>
            <ThemedText themeColor="textTertiary" style={w.sectionLabel}>
              {t('admin.dashboard.sectionUserMode')}
            </ThemedText>
            <View style={w.userModeRow}>
              <View style={w.userModeButton}>
                <Button
                  title={t('admin.dashboard.enterAsDriver')}
                  onPress={() => enterAs('driver')}
                  variant="secondary"
                />
              </View>
              <View style={w.userModeButton}>
                <Button
                  title={t('admin.dashboard.enterAsMechanic')}
                  onPress={() => enterAs('mechanic')}
                  variant="secondary"
                />
              </View>
            </View>
          </View>
        </ScrollView>
        {chartModal}
      </ThemedView>
    );
  }

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
          <Stat label={t('admin.dashboard.usersTotal')} value={stats?.users_total} onPress={() => setChart('users')} />
          <Stat label={t('admin.dashboard.drivers')} value={stats?.users_drivers} onPress={() => setChart('users')} />
          <Stat label={t('admin.dashboard.mechanics')} value={stats?.users_mechanics} onPress={() => setChart('users')} />
          <Stat label={t('admin.dashboard.banned')} value={stats?.users_banned} onPress={() => setChart('users')} />
          <Stat label={t('admin.dashboard.new7d')} value={stats?.users_new_7d} onPress={() => setChart('users')} />
          <Stat label={t('admin.dashboard.new30d')} value={stats?.users_new_30d} onPress={() => setChart('users')} />
        </Section>

        <Section title={t('admin.dashboard.sectionAnnouncements')}>
          <Stat label={t('admin.dashboard.annOpen')} value={stats?.ann_open} onPress={() => setChart('announcements')} />
          <Stat label={t('admin.dashboard.annAccepted')} value={stats?.ann_accepted} onPress={() => setChart('announcements')} />
          <Stat label={t('admin.dashboard.annResolved')} value={stats?.ann_resolved} onPress={() => setChart('announcements')} />
          <Stat label={t('admin.dashboard.annCancelled')} value={stats?.ann_cancelled} onPress={() => setChart('announcements')} />
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
      {chartModal}
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

function Stat({
  label,
  value,
  highlight,
  onPress,
}: {
  label: string;
  value?: number;
  highlight?: boolean;
  onPress?: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [
        styles.row,
        { borderColor: theme.background },
        pressed && onPress ? styles.pressed : null,
      ]}>
      <ThemedText>{label}</ThemedText>
      <View style={styles.valueWrap}>
        <ThemedText style={[styles.value, highlight && value ? { color: '#ef4444' } : null]}>
          {value ?? '—'}
        </ThemedText>
        {onPress ? <Feather name="bar-chart-2" size={16} color={theme.textTertiary} /> : null}
      </View>
    </Pressable>
  );
}

/** Card mic de statistică (grila „Utilizatori" din 10b): valoare mare + etichetă. */
function MiniStat({
  label,
  value,
  color,
  onPress,
}: {
  label: string;
  value?: number;
  color?: string;
  onPress?: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [
        w.card,
        w.miniCard,
        { backgroundColor: theme.backgroundElement },
        pressed && onPress ? styles.pressed : null,
      ]}>
      <ThemedText style={[w.miniValue, color ? { color } : null]}>{value ?? '—'}</ThemedText>
      <ThemedText themeColor="textTertiary" style={w.cardLabel}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/** Card cu pastilă de iconiță (grilele „Anunțuri"/„Activitate" din 10b). */
function IconStat({
  icon,
  tileBg,
  tileColor,
  label,
  value,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  tileBg: string;
  tileColor: string;
  label: string;
  value?: number;
  onPress?: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [
        w.card,
        w.iconCard,
        { backgroundColor: theme.backgroundElement },
        pressed && onPress ? styles.pressed : null,
      ]}>
      <View style={[w.iconTile, { backgroundColor: tileBg }]}>
        <Feather name={icon} size={19} color={tileColor} />
      </View>
      <View style={{ minWidth: 0 }}>
        <ThemedText style={w.iconValue}>{value ?? '—'}</ThemedText>
        <ThemedText themeColor="textTertiary" style={w.cardLabel} numberOfLines={1}>
          {label}
        </ThemedText>
      </View>
    </Pressable>
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
  valueWrap: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  pressed: { opacity: 0.8 },
});

/** Stilurile variantei late (design 10b). */
const w = StyleSheet.create({
  scroll: { padding: 28, paddingTop: 24, gap: 20, maxWidth: 1060, width: '100%', alignSelf: 'center' },
  pageTitle: { fontSize: 26, fontWeight: '800', letterSpacing: -0.4, lineHeight: 32 },
  section: { gap: 10 },
  sectionLabel: { fontSize: 12, fontWeight: '800', letterSpacing: 1.4, textTransform: 'uppercase' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: { borderRadius: 14, ...Shadows.card },
  miniCard: { flexGrow: 1, flexBasis: 140, paddingVertical: 14, paddingHorizontal: 16 },
  miniValue: { fontSize: 26, fontWeight: '800', lineHeight: 32 },
  cardLabel: { fontSize: 12, fontWeight: '700', marginTop: 2 },
  iconCard: {
    flexGrow: 1,
    flexBasis: 220,
    paddingVertical: 16,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  iconTile: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconValue: { fontSize: 24, fontWeight: '800', lineHeight: 30 },
  userModeRow: { flexDirection: 'row', gap: 12, maxWidth: 520 },
  userModeButton: { flex: 1 },
});
