import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
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
import { purgeAccounts } from '@/hooks/use-admin';
import { useSubmitGuard } from '@/hooks/use-submit-guard';
import { useTheme } from '@/hooks/use-theme';

/**
 * Curățare după un val de conturi-bot (RPC admin_purge_accounts, migrarea
 * 20261031000100_hygiene_limits §8). Întâi „Numără” (dry run), apoi ștergerea, cu
 * confirmare explicită, pe EXACT intervalul numărat.
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

interface Counted {
  from: Date;
  to: Date;
  count: number;
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
  const [deleted, setDeleted] = useState<number | null>(null);
  const [busy, setBusy] = useState<'count' | 'delete' | null>(null);

  function goBack() {
    // Pe web, după reîncărcarea paginii, istoricul e gol.
    if (router.canGoBack()) router.back();
    else router.replace('/(admin)/dashboard' as never);
  }

  /** Orice schimbare de dată invalidează numărătoarea: ștergerea trebuie să vizeze intervalul numărat. */
  function resetOutcome() {
    setCounted(null);
    setDeleted(null);
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
    setBusy('count');
    const { data, error: err } = await purgeAccounts(range.from, range.to, true);
    setBusy(null);
    if (err) setError(err);
    else if (data) setCounted({ ...range, count: data.count });
  }

  /** Confirmarea e așteptată ÎN handler-ul protejat, deci un al doilea tap cât e deschis dialogul iese imediat. */
  function confirmDelete(count: number): Promise<boolean> {
    return new Promise((resolve) => {
      Alert.alert(
        t('admin.purge.confirmTitle'),
        t('admin.purge.confirmBody', { count }),
        [
          { text: t('admin.common.cancel'), style: 'cancel', onPress: () => resolve(false) },
          { text: t('admin.common.delete'), style: 'destructive', onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) }
      );
    });
  }

  async function handleDelete() {
    if (!counted || counted.count <= 0) return;
    const ok = await confirmDelete(counted.count);
    if (!ok) return;
    setError(null);
    setBusy('delete');
    const { data, error: err } = await purgeAccounts(counted.from, counted.to, false);
    setBusy(null);
    if (err) {
      setError(err);
      return;
    }
    // Numărul real întors de server (poate diferi de numărătoare dacă între timp un cont a devenit activ).
    setCounted(null);
    setDeleted(data?.count ?? 0);
  }

  const content = (
    <ScrollView
      contentContainerStyle={[styles.scroll, wide && w.scroll]}
      keyboardShouldPersistTaps="handled">
      <ThemedText themeColor="textSecondary">{t('admin.purge.intro')}</ThemedText>

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
          loading={busy === 'count'}
          disabled={busy !== null}
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
          {counted.count > 0 ? (
            <Button
              title={t('admin.purge.deleteButton', { count: counted.count })}
              onPress={() => void guard(handleDelete)}
              variant="danger"
              loading={busy === 'delete'}
              disabled={busy !== null}
            />
          ) : null}
        </View>
      ) : null}

      {deleted !== null ? (
        <View style={[styles.notice, { backgroundColor: theme.successBg }]}>
          <Feather name="check-circle" size={18} color={theme.successText} />
          <ThemedText themeColor="successText" style={styles.noticeText}>
            {t('admin.purge.deleted', { count: deleted })}
          </ThemedText>
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
