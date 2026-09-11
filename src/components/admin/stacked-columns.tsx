import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
}

export interface ChartBucket {
  key: string;
  label: string;
  values: Record<string, number>;
}

interface Props {
  series: ChartSeries[];
  buckets: ChartBucket[];
  /** Înălțimea zonei de desen (fără etichetele de pe axa X). */
  height?: number;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  /** Eticheta de pe axa X apare la fiecare N coloane (ultima coloană are mereu etichetă). */
  labelEvery: number;
  a11yLabel: (bucket: ChartBucket, total: number) => string;
}

const BAR_MAX_WIDTH = 24;
const SEGMENT_GAP = 2;
const AXIS_GUTTER = 34;
/** Loc deasupra celei mai înalte coloane pentru eticheta de valoare. */
const CAP_ROOM = 14;
const AXIS_LABEL_WIDTH = 56;

/**
 * Plafon „rotund" pentru axa Y, cât mai aproape de maxim (coloana cea mai înaltă să
 * umple graficul), ales astfel încât și jumătatea lui (linia din mijloc) să fie întreagă.
 */
function niceCeil(max: number): number {
  if (max <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const steps = pow >= 100 ? [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10] : pow === 10 ? [1, 2, 4, 6, 8, 10] : [2, 4, 6, 8, 10];
  for (const m of steps) {
    if (max <= m * pow) return m * pow;
  }
  return 10 * pow;
}

function totalOf(bucket: ChartBucket): number {
  return Object.values(bucket.values).reduce((s, v) => s + v, 0);
}

/**
 * Coloane stivuite desenate din View-uri (fără dependențe native — merge identic pe
 * web, Android și iOS). Regulile din ghidul de vizualizare: mărci subțiri (≤24 px),
 * capăt rotunjit doar sus, spațiu de 2 px între segmente, etichete de valoare DOAR pe
 * coloana selectată (sau pe cea mai înaltă), text în culorile temei, nu ale seriei.
 */
export function StackedColumns({
  series,
  buckets,
  height = 170,
  selectedKey,
  onSelect,
  labelEvery,
  a11yLabel,
}: Props) {
  const theme = useTheme();
  const totals = buckets.map(totalOf);
  const maxTotal = Math.max(0, ...totals);
  const yMax = niceCeil(maxTotal);
  const ticks = [yMax, yMax / 2, 0];
  const tallestIndex = maxTotal > 0 ? totals.indexOf(maxTotal) : -1;
  const hasSelection = selectedKey !== null;
  const plotHeight = height - CAP_ROOM;

  return (
    <View>
      <View style={[styles.plot, { height }]}>
        {/* Linii de ghidaj + valorile lor (recesive, în culorile temei). */}
        {ticks.map((tick) => {
          const top = height - (tick / yMax) * plotHeight;
          return (
            <View key={tick} pointerEvents="none" style={[styles.gridRow, { top }]}>
              <ThemedText themeColor="textTertiary" style={styles.tickLabel}>
                {Number.isInteger(tick) ? tick : tick.toFixed(1)}
              </ThemedText>
              <View style={[styles.gridLine, { backgroundColor: theme.separator }]} />
            </View>
          );
        })}

        <View style={[styles.columns, { marginLeft: AXIS_GUTTER, height }]}>
          {buckets.map((bucket, i) => {
            const total = totals[i];
            const isSelected = bucket.key === selectedKey;
            const showValue = total > 0 && (isSelected || (!hasSelection && i === tallestIndex));
            const dimmed = hasSelection && !isSelected;
            // Segmentele de jos în sus, în ordinea seriilor; ultimul nenul primește colțurile.
            const segments = series
              .map((s) => ({ s, value: bucket.values[s.key] ?? 0 }))
              .filter(({ value }) => value > 0);
            return (
              <Pressable
                key={bucket.key}
                onPress={() => onSelect(isSelected ? null : bucket.key)}
                accessibilityRole="button"
                accessibilityLabel={a11yLabel(bucket, total)}
                accessibilityState={{ selected: isSelected }}
                style={styles.column}>
                {showValue ? (
                  <ThemedText
                    themeColor={isSelected ? 'text' : 'textSecondary'}
                    style={styles.capLabel}
                    numberOfLines={1}>
                    {total}
                  </ThemedText>
                ) : null}
                <View style={[styles.bar, dimmed && styles.barDimmed]}>
                  {segments
                    .slice()
                    .reverse()
                    .map(({ s, value }, idx) => {
                      const px = Math.max(2, Math.round((value / yMax) * plotHeight));
                      const isTop = idx === 0;
                      return (
                        <View
                          key={s.key}
                          style={[
                            styles.segment,
                            {
                              height: px,
                              backgroundColor: s.color,
                              marginTop: isTop ? 0 : SEGMENT_GAP,
                            },
                            isTop && styles.segmentTop,
                          ]}
                        />
                      );
                    })}
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Etichetele axei X sunt poziționate absolut, centrate pe coloana lor: sloturile
          sunt mai înguste decât textul (30 de zile pe telefon ≈ 10 px), deci în flux
          s-ar trunchia cu „…". */}
      <View style={[styles.axis, { marginLeft: AXIS_GUTTER }]}>
        {buckets.map((bucket, i) =>
          (i + 1) % labelEvery === 0 ? (
            <ThemedText
              key={bucket.key}
              themeColor={bucket.key === selectedKey ? 'text' : 'textTertiary'}
              style={[styles.axisLabel, { left: `${((i + 0.5) / buckets.length) * 100}%` }]}
              numberOfLines={1}>
              {bucket.label}
            </ThemedText>
          ) : null
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  plot: { position: 'relative' },
  gridRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  tickLabel: { width: AXIS_GUTTER - 6, fontSize: 10, lineHeight: 12, textAlign: 'right' },
  gridLine: { flex: 1, height: 1, marginLeft: 6 },
  columns: { flexDirection: 'row', alignItems: 'flex-end' },
  column: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' },
  // Eticheta de pe vârf e mai lată decât coloana (iese simetric în părți, fără trunchiere).
  capLabel: {
    width: AXIS_LABEL_WIDTH,
    textAlign: 'center',
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '700',
    marginBottom: 2,
  },
  bar: { width: '62%', maxWidth: BAR_MAX_WIDTH, alignItems: 'stretch' },
  barDimmed: { opacity: 0.45 },
  segment: { width: '100%' },
  segmentTop: { borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  axis: { position: 'relative', height: 14, marginTop: 6 },
  axisLabel: {
    position: 'absolute',
    top: 0,
    width: AXIS_LABEL_WIDTH,
    marginLeft: -AXIS_LABEL_WIDTH / 2,
    textAlign: 'center',
    fontSize: 10,
    lineHeight: 12,
  },
});
