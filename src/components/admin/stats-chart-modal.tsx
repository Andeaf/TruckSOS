import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { StackedColumns, type ChartBucket, type ChartSeries } from '@/components/admin/stacked-columns';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import {
  fetchAnnouncementsSeries,
  fetchUsersSeries,
  type AnnouncementSeriesRow,
  type ProfileSeriesRow,
} from '@/hooks/use-admin';
import { useResolvedScheme } from '@/hooks/use-settings';
import { useTheme } from '@/hooks/use-theme';

export type StatsChartKind = 'users' | 'announcements';
type Period = '30d' | '12w' | '12m';

const PERIODS: Period[] = ['30d', '12w', '12m'];
const DAY_MS = 86_400_000;

/**
 * Paleta graficelor — sloturile 1–3 din paleta de referință a ghidului de vizualizare,
 * validate cu scriptul lui (bandă de luminozitate, separare pentru daltonism, contrast)
 * pe suprafețele temei: albastrul de brand (#0E3A7D) pică testul de luminozitate ca
 * marcă de date, deci graficul folosește pașii validați, iar restul UI-ului tokenii temei.
 */
const PALETTE = {
  light: { blue: '#2a78d6', orange: '#eb6834', green: '#1baf7a' },
  dark: { blue: '#3987e5', orange: '#d95926', green: '#199e70' },
} as const;

interface Frame {
  starts: Date[];
  indexOf: (d: Date) => number;
  labelOf: (start: Date, i: number) => string;
  labelEvery: number;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Cadrul de timp: începuturile intervalelor, funcția de încadrare și etichetele axei X. */
function buildFrame(period: Period, lang: string, now = new Date()): Frame {
  const short = (d: Date) => d.toLocaleDateString(lang, { day: 'numeric', month: 'short' });
  if (period === '30d') {
    const first = startOfDay(now).getTime() - 29 * DAY_MS;
    const starts = Array.from({ length: 30 }, (_, i) => new Date(first + i * DAY_MS));
    return {
      starts,
      indexOf: (d) => Math.floor((startOfDay(d).getTime() - first) / DAY_MS),
      labelOf: short,
      labelEvery: 5,
    };
  }
  if (period === '12w') {
    const today = startOfDay(now);
    const mondayOffset = (today.getDay() + 6) % 7; // luni = 0
    const first = today.getTime() - mondayOffset * DAY_MS - 11 * 7 * DAY_MS;
    const starts = Array.from({ length: 12 }, (_, i) => new Date(first + i * 7 * DAY_MS));
    return {
      starts,
      indexOf: (d) => Math.floor((startOfDay(d).getTime() - first) / (7 * DAY_MS)),
      labelOf: short,
      labelEvery: 2,
    };
  }
  const firstMonth = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const starts = Array.from(
    { length: 12 },
    (_, i) => new Date(firstMonth.getFullYear(), firstMonth.getMonth() + i, 1)
  );
  return {
    starts,
    indexOf: (d) =>
      (d.getFullYear() - firstMonth.getFullYear()) * 12 + d.getMonth() - firstMonth.getMonth(),
    labelOf: (start, i) =>
      i === 0 || start.getMonth() === 0
        ? start.toLocaleDateString(lang, { month: 'short', year: '2-digit' })
        : start.toLocaleDateString(lang, { month: 'short' }),
    labelEvery: 2,
  };
}

function bucketize<T extends { created_at: string }>(
  rows: T[],
  frame: Frame,
  keyOf: (row: T) => string,
  seriesKeys: string[]
): ChartBucket[] {
  const buckets: ChartBucket[] = frame.starts.map((start, i) => ({
    key: start.toISOString(),
    label: frame.labelOf(start, i),
    values: Object.fromEntries(seriesKeys.map((k) => [k, 0])),
  }));
  for (const row of rows) {
    const idx = frame.indexOf(new Date(row.created_at));
    if (idx < 0 || idx >= buckets.length) continue;
    const k = keyOf(row);
    buckets[idx].values[k] = (buckets[idx].values[k] ?? 0) + 1;
  }
  return buckets;
}

function sumValues(bucket: ChartBucket): number {
  return Object.values(bucket.values).reduce((a, b) => a + b, 0);
}

interface Props {
  kind: StatsChartKind | null;
  onClose: () => void;
}

/**
 * Graficele din dashboard-ul de admin (11 sept 2026): utilizatori noi pe șoferi/mecanici și
 * anunțuri postate pe stări (active/rezolvate/anulate), pe 30 de zile, 12 săptămâni sau
 * 12 luni. Datele se citesc direct din tabele (RLS-ul de admin permite SELECT pe toate
 * anunțurile; profilurile sunt publice) și se grupează în client — volumul e de ordinul
 * sutelor de rânduri, deci nu merită un RPC de agregare.
 */
export function StatsChartModal({ kind, onClose }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const scheme = useResolvedScheme();
  const colors = PALETTE[scheme === 'dark' ? 'dark' : 'light'];
  const [period, setPeriod] = useState<Period>('30d');
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<ProfileSeriesRow[] | null>(null);
  const [announcements, setAnnouncements] = useState<AnnouncementSeriesRow[] | null>(null);

  // La deschidere se reia de la 30 de zile; datele se încarcă o dată pe 12 luni (cel mai
  // larg cadru), iar schimbarea perioadei doar regrupează în client.
  useEffect(() => {
    if (!kind) return;
    let active = true;
    setPeriod('30d');
    setSelected(null);
    setError(null);
    setLoading(true);
    const now = new Date();
    const since = new Date(now.getFullYear(), now.getMonth() - 11, 1).toISOString();
    const load =
      kind === 'users'
        ? fetchUsersSeries(since).then(({ data, error: e }) => {
            if (!active) return;
            setUsers(data);
            setError(e);
          })
        : fetchAnnouncementsSeries(since).then(({ data, error: e }) => {
            if (!active) return;
            setAnnouncements(data);
            setError(e);
          });
    load.finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [kind]);

  const series: ChartSeries[] = useMemo(
    () =>
      kind === 'announcements'
        ? [
            { key: 'active', label: t('admin.dashboard.chart.legendActive'), color: colors.blue },
            { key: 'resolved', label: t('admin.dashboard.chart.legendResolved'), color: colors.green },
            { key: 'cancelled', label: t('admin.dashboard.chart.legendCancelled'), color: colors.orange },
          ]
        : [
            { key: 'driver', label: t('admin.dashboard.chart.legendDrivers'), color: colors.blue },
            { key: 'mechanic', label: t('admin.dashboard.chart.legendMechanics'), color: colors.orange },
          ],
    [kind, colors, t]
  );

  // Etichetele de dată în română, ca restul secțiunii de admin (indiferent de limba aplicației).
  const frame = useMemo(() => buildFrame(period, 'ro'), [period]);

  const buckets: ChartBucket[] = useMemo(() => {
    if (!kind) return [];
    const keys = series.map((s) => s.key);
    if (kind === 'users') {
      return bucketize(users ?? [], frame, (r) => r.role, keys);
    }
    return bucketize(
      announcements ?? [],
      frame,
      (r) => (r.status === 'resolved' || r.status === 'cancelled' ? r.status : 'active'),
      keys
    );
  }, [kind, frame, series, users, announcements]);

  const seriesTotals = series.map((s) => buckets.reduce((sum, b) => sum + (b.values[s.key] ?? 0), 0));
  const total = seriesTotals.reduce((a, b) => a + b, 0);
  const selectedBucket = buckets.find((b) => b.key === selected) ?? null;

  function describe(bucket: ChartBucket, bucketTotal: number): string {
    const v = bucket.values;
    return kind === 'users'
      ? t('admin.dashboard.chart.tooltipUsers', {
          date: bucket.label,
          total: bucketTotal,
          drivers: v.driver ?? 0,
          mechanics: v.mechanic ?? 0,
        })
      : t('admin.dashboard.chart.tooltipAnnouncements', {
          date: bucket.label,
          total: bucketTotal,
          resolved: v.resolved ?? 0,
          cancelled: v.cancelled ?? 0,
          active: v.active ?? 0,
        });
  }

  const title = t(
    kind === 'users' ? 'admin.dashboard.chart.titleUsers' : 'admin.dashboard.chart.titleAnnouncements'
  );
  const totalLabel = t(
    kind === 'users' ? 'admin.dashboard.chart.totalUsers' : 'admin.dashboard.chart.totalAnnouncements'
  );
  const detail = selectedBucket
    ? describe(selectedBucket, sumValues(selectedBucket))
    : !loading && !error && total === 0
      ? t('admin.dashboard.chart.empty')
      : t('admin.dashboard.chart.hint');
  const pending = '…';

  return (
    <Modal visible={kind !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.modal, { backgroundColor: theme.background }]}
          onPress={() => setSelected(null)}>
          <View style={styles.header}>
            <ThemedText type="subtitle" style={styles.title}>
              {title}
            </ThemedText>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel={t('admin.dashboard.chart.close')}>
              <Feather name="x" size={22} color={theme.textSecondary} />
            </Pressable>
          </View>

          <ScrollView bounces={false} contentContainerStyle={styles.body}>
            <View style={styles.periods}>
              {PERIODS.map((p) => {
                const on = p === period;
                return (
                  <Pressable
                    key={p}
                    onPress={() => {
                      setPeriod(p);
                      setSelected(null);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    style={[styles.chip, { backgroundColor: on ? theme.brand : theme.brandSoft }]}>
                    <ThemedText style={[styles.chipText, { color: on ? '#FFFFFF' : theme.brand }]}>
                      {t('admin.dashboard.chart.period_' + p)}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.summary}>
              <ThemedText style={styles.total}>{loading ? pending : total}</ThemedText>
              <ThemedText themeColor="textSecondary" type="small">
                {totalLabel}
              </ThemedText>
            </View>

            <View style={styles.legend}>
              {series.map((s, i) => (
                <View key={s.key} style={styles.legendItem}>
                  <View style={[styles.swatch, { backgroundColor: s.color }]} />
                  <ThemedText themeColor="textSecondary" type="small">
                    {s.label} {'·'} {loading ? pending : seriesTotals[i]}
                  </ThemedText>
                </View>
              ))}
            </View>

            <View style={[styles.chartCard, { backgroundColor: theme.backgroundElement }]}>
              {loading ? (
                <View style={styles.center}>
                  <ActivityIndicator color={theme.brand} />
                </View>
              ) : error ? (
                <View style={styles.center}>
                  <ThemedText themeColor="textSecondary" type="small">
                    {t('admin.dashboard.chart.loadError')}
                  </ThemedText>
                </View>
              ) : (
                <StackedColumns
                  series={series}
                  buckets={buckets}
                  selectedKey={selected}
                  onSelect={setSelected}
                  labelEvery={frame.labelEvery}
                  a11yLabel={describe}
                />
              )}
            </View>

            <ThemedText themeColor={selectedBucket ? 'text' : 'textTertiary'} type="small" style={styles.detail}>
              {detail}
            </ThemedText>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.three,
  },
  modal: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '90%',
    borderRadius: Radius.card,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    marginBottom: Spacing.two,
  },
  title: { flex: 1 },
  body: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.two, gap: Spacing.three },
  periods: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: Radius.badge },
  chipText: { fontSize: 13, fontWeight: '700' },
  summary: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two, flexWrap: 'wrap' },
  total: { fontSize: 28, fontWeight: '800', lineHeight: 34 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  chartCard: { borderRadius: Radius.control, padding: Spacing.three, paddingBottom: Spacing.two },
  center: { height: 190, alignItems: 'center', justifyContent: 'center' },
  detail: { minHeight: 18 },
});
