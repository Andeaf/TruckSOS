import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Radius, Spacing } from '@/constants/theme';
import { useBack } from '@/hooks/use-back';
import { useSubmitGuard } from '@/hooks/use-submit-guard';
import { useTheme } from '@/hooks/use-theme';
import { captchaConfigured, getCaptchaToken } from '@/lib/captcha';

/**
 * Sesizare FĂRĂ cont (faza 8.3, DSA art. 16) — trucksos.net/report, aceeași rută pe web și în app (oaspeți).
 * Formularul trimite la Edge Function-ul `report-public` (fără sesiune): tipul conținutului, identificatorul (uuid
 * sau link din app), motivul, explicația, e-mailul obligatoriu (confirmare + decizie, trimise manual de admin — D8.4),
 * declarația de bună-credință (DSA 16(2)(d)) și tokenul Turnstile (`getCaptchaToken`: web direct, nativ prin CaptchaHost).
 * Utilizatorii cu cont raportează din aplicație (ReportSheet); pagina rămâne pentru oricine altcineva.
 * Garda din `_layout.tsx` exceptează segmentul `report` (ca `p` / `auth`).
 */

/** Fără mesajele private: doar participanții le pot raporta, din aplicație (review 9 nov). */
const TARGET_TYPES = ['announcement', 'listing', 'channel_message', 'user'] as const;
type TargetType = (typeof TARGET_TYPES)[number];
const REASONS = ['spam', 'scam', 'illegal', 'harassment', 'personal_data', 'sexual_violent', 'rights', 'other'] as const;
type Reason = (typeof REASONS)[number];
const DETAILS_MAX = 2000;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ENDPOINT = `${process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''}/functions/v1/report-public`;
const REQUEST_TIMEOUT_MS = 15000;

/** Uuid-ul din ce a lipit omul: id gol, link `/p/<id>`, `/market/<id>`, `?id=<id>` etc. */
export function extractTargetId(raw: string): string | null {
  const m = UUID_RE.exec(raw.trim());
  return m ? m[0].toLowerCase() : null;
}

function isTargetType(v: unknown): v is TargetType {
  return typeof v === 'string' && (TARGET_TYPES as readonly string[]).includes(v);
}

type Outcome = 'idle' | 'sent';

export function PublicReportScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const guard = useSubmitGuard();
  const goBack = useBack('/');
  const params = useLocalSearchParams<{ type?: string; id?: string }>();
  const [type, setType] = useState<TargetType>(isTargetType(params.type) ? params.type : 'announcement');
  const [target, setTarget] = useState(typeof params.id === 'string' ? params.id : '');
  const [reason, setReason] = useState<Reason | null>(null);
  const [details, setDetails] = useState('');
  const [email, setEmail] = useState('');
  const [declared, setDeclared] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState<Outcome>('idle');

  const targetId = useMemo(() => extractTargetId(target), [target]);

  async function handleSubmit() {
    setError('');
    if (!targetId) return setError(t('publicReport.errorTarget'));
    if (!reason) return setError(t('report.errorReasonRequired'));
    if (!EMAIL_RE.test(email.trim())) return setError(t('publicReport.errorEmail'));
    if (!declared) return setError(t('publicReport.errorDeclaration'));
    if (!captchaConfigured()) return setError(t('publicReport.errorCaptcha'));
    setLoading(true);
    // Fără timeout, pe o rețea care atârnă butonul ar rămâne în „loading” la nesfârșit (review 10 nov).
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
    try {
      const token = await getCaptchaToken();
      if (!token) {
        setError(t('publicReport.errorCaptcha'));
        return;
      }
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        signal: abort.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token,
          type,
          id: targetId,
          reason,
          details: details.trim() || null,
          email: email.trim(),
          declaration: true,
          lang: i18n.language,
        }),
      });
      if (res.ok) {
        setOutcome('sent');
        return;
      }
      if (res.status === 429) setError(t('publicReport.errorRateLimited'));
      else if (res.status === 404) setError(t('publicReport.errorNotFound'));
      else if (res.status === 403) setError(t('publicReport.errorCaptcha'));
      else setError(t('report.errorGeneric'));
    } catch {
      setError(t('report.errorGeneric'));
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }

  if (outcome === 'sent') {
    return (
      <ThemedView style={styles.container}>
        <ScreenHeader title={t('publicReport.title')} onBack={goBack} />
        <View style={styles.done}>
          <MaterialIcons name="check-circle" size={56} color={theme.successText} />
          <ThemedText type="subtitle" style={styles.center}>
            {t('report.submittedTitle')}
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.center}>
            {t('publicReport.sent', { email: email.trim() })}
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t('publicReport.title')} onBack={goBack} />
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <ThemedText themeColor="textSecondary">{t('publicReport.intro')}</ThemedText>
          <ThemedText themeColor="textSecondary" type="small">
            {t('publicReport.timeline')}
          </ThemedText>

          <ThemedText type="smallBold" style={styles.label}>
            {t('publicReport.typeLabel')}
          </ThemedText>
          <View style={styles.chips}>
            {TARGET_TYPES.map((v) => {
              const active = v === type;
              return (
                <Pressable
                  key={v}
                  onPress={() => setType(v)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  style={[
                    styles.chip,
                    { borderColor: active ? theme.brand : theme.backgroundSelected },
                    active && { backgroundColor: theme.backgroundSelected },
                  ]}>
                  <ThemedText type="small">{t(`publicReport.type.${v}`)}</ThemedText>
                </Pressable>
              );
            })}
          </View>

          <Input
            label={t('publicReport.targetLabel')}
            value={target}
            onChangeText={setTarget}
            placeholder={t('publicReport.targetPlaceholder')}
            autoCapitalize="none"
            autoCorrect={false}
            required
          />
          <ThemedText themeColor="textSecondary" type="small">
            {t('publicReport.targetHint')}
          </ThemedText>

          <ThemedText type="smallBold" style={styles.label}>
            {t('publicReport.reasonLabel')}
          </ThemedText>
          {REASONS.map((r) => {
            const selected = reason === r;
            return (
              <Pressable
                key={r}
                onPress={() => setReason(r)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={[
                  styles.reasonRow,
                  { borderColor: selected ? theme.brand : theme.backgroundSelected },
                  selected && { backgroundColor: theme.backgroundSelected },
                ]}>
                <MaterialIcons
                  name={selected ? 'radio-button-checked' : 'radio-button-unchecked'}
                  size={20}
                  color={selected ? theme.brand : theme.textSecondary}
                />
                <ThemedText style={styles.reasonLabel}>{t(`report.reason.${r}`)}</ThemedText>
              </Pressable>
            );
          })}

          <Input
            label={t('publicReport.detailsLabel')}
            value={details}
            onChangeText={setDetails}
            placeholder={t('report.detailsPlaceholder')}
            multiline
            maxLength={DETAILS_MAX}
            style={styles.details}
          />
          <Input
            label={t('publicReport.emailLabel')}
            value={email}
            onChangeText={setEmail}
            placeholder={t('publicReport.emailPlaceholder')}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            required
          />

          <Pressable
            onPress={() => setDeclared((v) => !v)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: declared }}
            style={styles.checkRow}>
            <MaterialIcons
              name={declared ? 'check-box' : 'check-box-outline-blank'}
              size={24}
              color={declared ? theme.brand : theme.textSecondary}
            />
            <ThemedText style={styles.checkLabel}>{t('publicReport.declaration')}</ThemedText>
          </Pressable>

          <ThemedText themeColor="textSecondary" type="small">
            {t('publicReport.privacyNote')}
          </ThemedText>

          {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}
          <Button title={t('publicReport.submit')} onPress={() => void guard(handleSubmit)} loading={loading} />
          <ThemedText themeColor="textTertiary" type="small" style={styles.center}>
            {t('publicReport.emailAlternative')}
          </ThemedText>
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.two, maxWidth: 720, width: '100%', alignSelf: 'center' },
  label: { marginTop: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { paddingVertical: Spacing.one, paddingHorizontal: Spacing.three, borderRadius: Radius.badge, borderWidth: 1.5 },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.control,
    borderWidth: 1.5,
  },
  reasonLabel: { flex: 1 },
  details: { minHeight: 96, textAlignVertical: 'top' },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, marginTop: Spacing.two },
  checkLabel: { flex: 1, lineHeight: 22 },
  error: { color: '#ef4444', fontSize: 14 },
  done: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.five },
  center: { textAlign: 'center' },
});
