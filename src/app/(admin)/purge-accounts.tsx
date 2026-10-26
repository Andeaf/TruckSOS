import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useWideLayout } from '@/components/web-sidebar';
import { Radius, Spacing } from '@/constants/theme';
import { purgeAccountsDryRun, type PurgeCandidate } from '@/hooks/use-admin';
import { useSubmitGuard } from '@/hooks/use-submit-guard';
import { useTheme } from '@/hooks/use-theme';

/**
 * Curățare după un val de conturi-bot (RPC admin_purge_accounts, migrarea
 * 20261031000100_hygiene_limits §8). DOAR DRY-RUN până la faza 11 (decizia lui David,
 * 26 oct 2026): serverul refuză ștergerea reală (`purge_disabled_until_phase_11`), iar ecranul
 * doar numără și listează conturile care AR FI șterse (criteriu, înscriere, ultima activitate, rol).
 *
 * Datele sunt zile UTC (AAAA-LL-ZZ), iar „Până la” e exclusiv — la fel ca serverul
 * (`created_at >= p_from AND created_at < p_to`). Validarea din client oglindește
 * regulile serverului, ca `bad_interval` să nu apară: p_to ≤ acum − 24 h, p_from < p_to,
 * p_to − p_from ≤ 31 zile. Zilele în UTC (nu locale) țin p_to sub pragul de 24 h și
 * între miezul nopții local și ora 03:00 (România e UTC+2/+3).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SPAN_MS = 31 * DAY_MS;

/** Ziua UTC a unui moment, ca AAAA-LL-ZZ. */
function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** AAAA-LL-ZZ → miezul nopții UTC al zilei; null dacă formatul sau data nu sunt valide (ex. 2026-02-31). */
function parseUtcDay(text: string): Date | null {
  const value = text.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return utcDay(date.getTime()) === value ? date : null;
}

/** Cea mai târzie zi acceptată pentru „Până la”: ziua UTC de acum 24 h (miezul ei e ≥ 24 h în urmă). */
function latestToDay(): string {
  return utcDay(Date.now() - DAY_MS);
}

/** Momentul ISO → „AAAA-LL-ZZ HH:MM” în UTC (aceeași bază ca intervalul). */
function fmtUtc(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

interface Counted {
  from: Date;
  to: Date;
  count: number;
  accounts: PurgeCandidate[];
}

export default function AdminPurgeAccounts() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const wide = useWideLayout();
  const guard = useSubmitGuard();

  const [fromText, setFromText] = useState(() => utcDay(Date.now() - 30 * DAY_MS));
  const [toText, setToText] = useState(latestToDay);
  const [fromError, setFromError] = useState<string | undefined>();
  const [toError, setToError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [counted, setCounted] = useState<Counted | null>(null);
  const [busy, setBusy] = useState(false);

  function goBack() {
    // Pe web, după reîncărcarea paginii, istoricul e gol.
    if (router.canGoBack()) router.back();
    else router.replace('/(admin)/dashboard' as never);
  }

  function resetOutcome() {
    setCounted(null);
    setError(null);
  }

  function onFromChange(text: string) {
    setFromText(text);
    setFromError(undefined);
    resetOutcome();
  }

  function onToChange(text: string) {
    setToText(text);
    setToError(undefined);
    resetOutcome();
  }

  /** Validare oglindă a regulilor serverului; întoarce intervalul sau null (cu erorile setate). */
  function validate(): { from: Date; to: Date } | null {
    const from = parseUtcDay(fromText);
    const to = parseUtcDay(toText);
    setFromError(from ? undefined : t('admin.purge.invalidDate'));
    setToError(to ? undefined : t('admin.purge.invalidDate'));
    if (!from || !to) return null;

    const maxTo = latestToDay();
    if (utcDay(to.getTime()) > maxTo) {
      setToError(t('admin.purge.tooRecent', { maxTo }));
      return null;
    }
    if (from.getTime() >= to.getTime()) {
      setError(t('admin.purge.invalidRange'));
      return null;
    }
    if (to.getTime() - from.getTime() > MAX_SPAN_MS) {
      setError(t('admin.purge.tooLong'));
      return null;
    }
    return { from, to };
  }

  async function handleCount() {
    resetOutcome();
    const range = validate();
    if (!range) return;
    setBusy(true);
    const { data, error: err } = await purgeAccountsDryRun(range.from, range.to);
    setBusy(false);
    if (err) setError(err);
    else if (data) setCounted({ ...range, count: data.count, accounts: data.accounts });
  }

  function criterionLabel(code: string): string {
    const key = `admin.purge.criterion.${code}`;
    const text = t(key);
    return text === key ? code : text;
  }

  const content = (
    <ScrollView
      contentContainerStyle={[styles.scroll, wide && w.scroll]}
      keyboardShouldPersistTaps="handled">
      <ThemedText themeColor="textSecondary">{t('admin.purge.intro')}</ThemedText>
      <View style={[styles.notice, { backgroundColor: theme.neutralBg }]}>
        <Feather name="lock" size={18} color={theme.textSecondary} />
        <ThemedText type="small" themeColor="textSecondary" style={styles.noticeText}>
          {t('admin.purge.dryRunNote')}
        </ThemedText>
      </View>

      <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        <View style={[styles.dates, wide && w.dates]}>
          <View style={wide ? w.dateField : undefined}>
            <Input
              label={t('admin.purge.from')}
              value={fromText}
              onChangeText={onFromChange}
              placeholder={t('admin.purge.datePlaceholder')}
              error={fromError}
              autoCorrect={false}
              keyboardType="numbers-and-punctuation"
              maxLength={10}
            />
          </View>
          <View style={wide ? w.dateField : undefined}>
            <Input
              label={t('admin.purge.to')}
              value={toText}
              onChangeText={onToChange}
              placeholder={t('admin.purge.datePlaceholder')}
              error={toError}
              autoCorrect={false}
              keyboardType="numbers-and-punctuation"
              maxLength={10}
            />
          </View>
        </View>
        <ThemedText type="small" themeColor="textTertiary">
          {t('admin.purge.datesHint')}
        </ThemedText>
        <Button
          title={t('admin.purge.count')}
          onPress={() => void guard(handleCount)}
          variant="secondary"
          loading={busy}
          disabled={busy}
        />
      </View>

      {error ? (
        <View style={[styles.notice, { backgroundColor: theme.neutralBg }]}>
          <Feather name="alert-circle" size={18} color={theme.textSecondary} />
          <ThemedText style={styles.noticeText}>{error}</ThemedText>
        </View>
      ) : null}

      {counted ? (
        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText style={styles.resultText}>
            {t('admin.purge.countResult', { count: counted.count })}
          </ThemedText>
          {counted.accounts.map((a) => (
            <View key={a.id} style={[styles.row, { borderTopColor: theme.backgroundSelected }]}>
              <ThemedText style={styles.rowTitle} numberOfLines={1}>
                {a.email ?? a.id}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {criterionLabel(a.criterion)}
              </ThemedText>
              <ThemedText type="small" themeColor="textTertiary">
                {t('admin.purge.rowMeta', {
                  role: a.role ?? t('admin.purge.noProfile'),
                  created: fmtUtc(a.createdAt) ?? '-',
                  lastSignIn: fmtUtc(a.lastSignInAt) ?? t('admin.purge.never'),
                  provider: a.provider ?? '-',
                  confirmed: a.emailConfirmed ? t('admin.purge.confirmed') : t('admin.purge.unconfirmed'),
                })}
              </ThemedText>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );

  return (
    <ThemedView style={{ flex: 1 }}>
      {wide ? (
        <View style={w.headRow}>
          <Pressable
            onPress={goBack}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('admin.purge.back')}>
            <Feather name="arrow-left" size={22} color={theme.text} />
          </Pressable>
          <ThemedText style={w.pageTitle}>{t('admin.purge.title')}</ThemedText>
        </View>
      ) : (
        <ScreenHeader title={t('admin.purge.title')} onBack={goBack} />
      )}
      {content}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: Spacing.three, gap: Spacing.three },
  card: { borderRadius: Radius.card, padding: Spacing.three, gap: Spacing.three },
  dates: { gap: Spacing.two },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.card,
    padding: Spacing.three,
  },
  noticeText: { flex: 1 },
  resultText: { fontWeight: '700', fontSize: 16 },
  row: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.two, gap: 2 },
  rowTitle: { fontWeight: '600' },
});

/** Stilurile variantei late (ca în Utilizatori, design 10d). */
const w = StyleSheet.create({
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 28,
    paddingTop: 24,
    maxWidth: 1060,
    width: '100%',
    alignSelf: 'center',
  },
  pageTitle: { fontSize: 26, fontWeight: '800', letterSpacing: -0.4, lineHeight: 32 },
  scroll: { maxWidth: 1060, width: '100%', alignSelf: 'center', paddingHorizontal: 28 },
  dates: { flexDirection: 'row', gap: 16, maxWidth: 520 },
  dateField: { flex: 1 },
});
