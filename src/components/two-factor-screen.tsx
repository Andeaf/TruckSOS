import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import * as Clipboard from 'expo-clipboard';
import { WebView } from 'react-native-webview';
import { useTranslation } from 'react-i18next';
import type { Factor } from '@supabase/supabase-js';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ListRow, RowGroup } from '@/components/ui/list-row';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Toast } from '@/components/toast';
import { Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useBack } from '@/hooks/use-back';
import { useSubmitGuard } from '@/hooks/use-submit-guard';
import {
  MFA_ISSUER,
  formatSecret,
  qrSvgDataUrl,
  qrSvgMarkup,
  translateMfaError,
} from '@/lib/mfa';
import { supabase } from '@/lib/supabase';

/** Locale explicit: altfel formatul urmează regiunea dispozitivului, nu limba aplicației. */
const LOCALE_MAP: Record<string, string> = { ro: 'ro-RO', en: 'en-GB', de: 'de-DE' };

const QR_SIZE = 220;

type Pending = { factorId: string; qrCode: string; secret: string };

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'off' }
  | { kind: 'enrolling'; pending: Pending }
  | { kind: 'on'; factors: Factor[] };

/**
 * „Autentificare în doi pași” (TOTP) — doar pentru conturile admin (PLAN_1.1_FIX 4.4), comun
 * ambelor grupuri de rute prin route subțiri, ca schimbarea parolei.
 *
 * Fluxul: „Activează” → `mfa.enroll` (factor `unverified`) → QR + secretul → codul de 6 cifre →
 * `mfa.challenge` + `mfa.verify` (sesiunea devine aal2, factorul `verified`). Un factor rămas
 * neverificat (anulare, ieșire din ecran, aplicație închisă la jumătate) se șterge: la anulare, la
 * ieșirea din ecran și, ca plasă, înaintea fiecărei înrolări noi.
 */
export function TwoFactorScreen({ backPath }: { backPath: string }) {
  const { t, i18n } = useTranslation();
  // Rândul din Setări apare doar la admini; ecranul poate fi atins și prin link direct, deci verificăm și aici.
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const goBack = useBack(backPath);
  const guard = useSubmitGuard();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [qrFailed, setQrFailed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const hideToast = useCallback(() => setToast(null), []);
  // Factorul neverificat al înrolării în curs, citibil din cleanup-ul de la demontare.
  const pendingIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    // listFactors citește userul de pe server (getUser), deci vede și factorii adăugați de pe
    // alt dispozitiv; `totp` conține doar factorii verificați.
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error || !data) {
      setState({ kind: 'error', message: translateMfaError(error) ?? t('twoFactor.genericError') });
      return;
    }
    setState(data.totp.length > 0 ? { kind: 'on', factors: data.totp } : { kind: 'off' });
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Ieșire din ecran în mijlocul înrolării → factorul neverificat nu rămâne pe cont.
  useEffect(
    () => () => {
      const id = pendingIdRef.current;
      if (id) void supabase.auth.mfa.unenroll({ factorId: id });
    },
    [],
  );

  async function handleEnable() {
    setBusy(true);
    // Plasă: factori neverificați rămași de la o încercare întreruptă (aplicație închisă,
    // rețea picată) — altfel ar ocupa locuri și ar putea bloca o înrolare nouă.
    const { data: list } = await supabase.auth.mfa.listFactors();
    for (const f of list?.all ?? []) {
      if (f.factor_type === 'totp' && f.status === 'unverified') {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
    }

    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `${MFA_ISSUER} ${Date.now()}`,
      issuer: MFA_ISSUER,
    });
    setBusy(false);
    if (error || !data) {
      Alert.alert(t('common.error'), translateMfaError(error) ?? t('twoFactor.genericError'));
      return;
    }
    pendingIdRef.current = data.id;
    setCode('');
    setCodeError(undefined);
    setQrFailed(false);
    setState({
      kind: 'enrolling',
      pending: { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret },
    });
  }

  async function handleVerify(pending: Pending) {
    const clean = code.replace(/\s/g, '');
    if (!/^\d{6}$/.test(clean)) {
      setCodeError(t('twoFactor.codeInvalid'));
      return;
    }
    setCodeError(undefined);
    setBusy(true);
    const { data: challenge, error: challengeErr } = await supabase.auth.mfa.challenge({
      factorId: pending.factorId,
    });
    if (challengeErr || !challenge) {
      setBusy(false);
      setCodeError(translateMfaError(challengeErr) ?? t('twoFactor.genericError'));
      return;
    }
    // Cât rulează verify, ieșirea din ecran nu mai șterge factorul: dacă verify reușește între
    // timp, ar fi șters exact factorul tocmai activat. Pe eșec îl punem la loc.
    pendingIdRef.current = null;
    // Reușita salvează sesiunea aal2 și emite MFA_CHALLENGE_VERIFIED → use-auth o preia.
    const { error } = await supabase.auth.mfa.verify({
      factorId: pending.factorId,
      challengeId: challenge.id,
      code: clean,
    });
    setBusy(false);
    if (error) {
      pendingIdRef.current = pending.factorId;
      setCodeError(translateMfaError(error) ?? t('twoFactor.genericError'));
      return;
    }
    setCode('');
    Alert.alert(t('twoFactor.enabledTitle'), t('twoFactor.enabledBody'));
    await load();
  }

  async function handleCancelEnroll(pending: Pending) {
    setBusy(true);
    pendingIdRef.current = null;
    // Best-effort: dacă pică pe rețea, plasa din handleEnable îl șterge data viitoare.
    await supabase.auth.mfa.unenroll({ factorId: pending.factorId });
    setBusy(false);
    setCode('');
    setCodeError(undefined);
    setState({ kind: 'off' });
  }

  function confirmDisable(factors: Factor[]) {
    Alert.alert(t('twoFactor.disableConfirmTitle'), t('twoFactor.disableConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('twoFactor.disable'),
        style: 'destructive',
        onPress: () => void guard(() => runDisable(factors)),
      },
    ]);
  }

  async function runDisable(factors: Factor[]) {
    setBusy(true);
    for (const f of factors) {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: f.id });
      if (error) {
        setBusy(false);
        Alert.alert(t('common.error'), translateMfaError(error) ?? t('twoFactor.genericError'));
        await load();
        return;
      }
    }
    // Recomandarea Supabase după unenroll: sesiune nouă, cu lista de factori actualizată.
    // Best-effort — pe rețea slabă rămâne sesiunea curentă (tot aal2, deci fără ecran de cod).
    await supabase.auth.refreshSession().catch(() => undefined);
    setBusy(false);
    await load();
  }

  async function copySecret(secret: string) {
    try {
      await Clipboard.setStringAsync(secret);
      setToast(t('twoFactor.secretCopied'));
    } catch {
      // Clipboard indisponibil: secretul rămâne afișat și selectabil.
    }
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(LOCALE_MAP[i18n.language] ?? 'ro-RO');
  }

  function renderBody() {
    if (state.kind === 'loading') {
      return <ActivityIndicator style={styles.spinner} />;
    }

    if (state.kind === 'error') {
      return (
        <>
          <ThemedText style={styles.error}>{state.message}</ThemedText>
          <Button title={t('twoFactor.retry')} variant="secondary" onPress={() => void load()} />
        </>
      );
    }

    if (state.kind === 'off') {
      return (
        <>
          <ThemedText themeColor="textSecondary">{t('twoFactor.description')}</ThemedText>
          <ThemedText themeColor="textSecondary" type="small">
            {t('twoFactor.appHint')}
          </ThemedText>
          {isAdmin ? (
            <Button
              title={t('twoFactor.enable')}
              onPress={() => void guard(handleEnable)}
              loading={busy}
            />
          ) : null}
        </>
      );
    }

    if (state.kind === 'enrolling') {
      const { pending } = state;
      return (
        <>
          <ThemedText themeColor="textSecondary">{t('twoFactor.scanQr')}</ThemedText>
          {!qrFailed ? (
            <View style={styles.qrBox}>
              <QrCode qrCode={pending.qrCode} label={t('twoFactor.scanQr')} onError={() => setQrFailed(true)} />
            </View>
          ) : null}

          <ThemedText themeColor="textSecondary" type="small">
            {t('twoFactor.secretLabel')}
          </ThemedText>
          <ThemedView type="backgroundElement" style={styles.secretBox}>
            <ThemedText selectable style={styles.secret}>
              {formatSecret(pending.secret)}
            </ThemedText>
          </ThemedView>
          <Button
            title={t('twoFactor.copySecret')}
            variant="secondary"
            onPress={() => void copySecret(pending.secret)}
          />

          <Input
            label={t('twoFactor.enterCode')}
            value={code}
            onChangeText={(v) => {
              setCode(v);
              if (codeError) setCodeError(undefined);
            }}
            placeholder="123456"
            keyboardType="number-pad"
            maxLength={6}
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            error={codeError}
            required
          />
          <Button
            title={t('twoFactor.confirm')}
            onPress={() => void guard(() => handleVerify(pending))}
            loading={busy}
          />
          <Button
            title={t('common.cancel')}
            variant="secondary"
            onPress={() => void guard(() => handleCancelEnroll(pending))}
            disabled={busy}
          />
        </>
      );
    }

    // state.kind === 'on'
    return (
      <>
        <ThemedText themeColor="textSecondary">{t('twoFactor.activeDescription')}</ThemedText>
        <RowGroup>
          {state.factors.map((f) => (
            <ListRow
              key={f.id}
              icon="verified-user"
              label={t('twoFactor.factorLabel')}
              value={t('twoFactor.activeSince', { date: formatDate(f.created_at) })}
              chevron={false}
            />
          ))}
        </RowGroup>
        <Button
          title={t('twoFactor.disable')}
          variant="danger"
          onPress={() => confirmDisable(state.factors)}
          loading={busy}
        />
      </>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t('twoFactor.title')} onBack={goBack} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {renderBody()}
        </ScrollView>
      </KeyboardAvoidingView>
      <Toast message={toast} onHide={hideToast} />
    </ThemedView>
  );
}

/**
 * Codul QR (SVG). Pe telefon îl randăm într-un WebView local: expo-image pe Android citește
 * data URL-urile doar ca base64 și nu are decodor SVG pe calea asta, iar varianta „utf-8” de la
 * Supabase nici nu e base64. Pe web e un data URL base64 obișnuit.
 */
function QrCode({ qrCode, label, onError }: { qrCode: string; label: string; onError: () => void }) {
  const svg = qrSvgMarkup(qrCode);
  const dataUrl = Platform.OS === 'web' ? qrSvgDataUrl(qrCode) : null;

  useEffect(() => {
    if (!svg || (Platform.OS === 'web' && !dataUrl)) onError();
  }, [svg, dataUrl, onError]);

  if (!svg) return null;

  if (Platform.OS === 'web') {
    if (!dataUrl) return null;
    return (
      <Image
        source={{ uri: dataUrl }}
        style={styles.qr}
        contentFit="contain"
        onError={onError}
        accessibilityLabel={label}
        accessibilityIgnoresInvertColors
      />
    );
  }

  const html =
    '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>html,body{margin:0;padding:0;height:100%;background:#fff;overflow:hidden}' +
    'body{display:flex;align-items:center;justify-content:center}' +
    'svg{width:100%;height:100%;display:block}</style></head>' +
    `<body>${svg}</body></html>`;

  return (
    <WebView
      source={{ html }}
      style={styles.qr}
      // Conținut local, fără JS; orice încercare de navigare (un <a> într-un SVG) e refuzată (review 1 nov).
      originWhitelist={['about:blank']}
      onShouldStartLoadWithRequest={(r) => r.url === 'about:blank'}
      accessibilityLabel={label}
      javaScriptEnabled={false}
      scrollEnabled={false}
      bounces={false}
      overScrollMode="never"
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      onError={onError}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.three },
  spinner: { marginTop: Spacing.five },
  error: { color: '#ef4444', textAlign: 'center', fontSize: 14 },
  // Fundal alb indiferent de temă: scanerele citesc mai sigur QR-ul negru pe alb.
  qrBox: {
    alignSelf: 'center',
    padding: Spacing.two,
    borderRadius: Radius.control,
    backgroundColor: '#FFFFFF',
  },
  qr: { width: QR_SIZE, height: QR_SIZE, backgroundColor: '#FFFFFF' },
  secretBox: { padding: Spacing.three, borderRadius: Radius.control },
  secret: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), letterSpacing: 1 },
});
