import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useSubmitGuard } from '@/hooks/use-submit-guard';
import { useTermsStatus } from '@/hooks/use-terms-status';
import { useTheme } from '@/hooks/use-theme';
import { exportMyData } from '@/lib/export-data';
import { TERMS_VERSION, acceptTerms } from '@/lib/terms';

const TERMS_ROUTE = '/(auth)/terms';
const PRIVACY_ROUTE = '/(auth)/privacy';

/**
 * „Continuând, accepți [Termenii] și [Politica]” (8.2, C8.2) — sub butoanele de înscriere /
 * conectare și pe alegerea rolului. Linkurile sunt `Text` imbricate, ca propoziția să se rupă
 * natural pe ecrane înguste (și în germană); duc la ecranele din (auth), accesibile fără sesiune.
 */
export function ConsentNotice({ style }: { style?: StyleProp<TextStyle> }) {
  const { t } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const terms = t('consent.termsLink');
  const privacy = t('consent.privacyLink');
  const full = t('consent.continueAccept', { terms, privacy });
  const linkStyle = [styles.inlineLink, { color: theme.brand }];

  // Propoziția tradusă e tăiată în jurul celor două etichete; dacă o traducere le-ar scoate,
  // rămâne textul simplu + linkurile separat (nu pierdem accesul la texte).
  const ti = full.indexOf(terms);
  const pi = ti >= 0 ? full.indexOf(privacy, ti + terms.length) : -1;

  const termsLink = (
    <Text
      style={linkStyle}
      accessibilityRole="link"
      onPress={() => router.push(TERMS_ROUTE as never)}>
      {terms}
    </Text>
  );
  const privacyLink = (
    <Text
      style={linkStyle}
      accessibilityRole="link"
      onPress={() => router.push(PRIVACY_ROUTE as never)}>
      {privacy}
    </Text>
  );

  return (
    <ThemedText type="small" themeColor="textSecondary" style={[styles.consent, style]}>
      {ti >= 0 && pi >= 0 ? (
        <>
          {full.slice(0, ti)}
          {termsLink}
          {full.slice(ti + terms.length, pi)}
          {privacyLink}
          {full.slice(pi + privacy.length)}
        </>
      ) : (
        <>
          {full} {termsLink} · {privacyLink}
        </>
      )}
    </ThemedText>
  );
}

/** Caseta obligatorie „Confirm că am cel puțin 18 ani…” (8.2, C8.2). */
export function AgeConfirmCheckbox({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <Pressable
      style={styles.checkRow}
      onPress={() => onChange(!checked)}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}>
      <MaterialIcons
        name={checked ? 'check-box' : 'check-box-outline-blank'}
        size={24}
        color={checked ? theme.brand : theme.textSecondary}
      />
      <ThemedText type="small" style={styles.checkText}>
        {t('consent.ageCheckbox')}
      </ThemedText>
    </Pressable>
  );
}

/**
 * Poarta „Termenii s-au actualizat” (1.1, faza 8.2 — C8.2): garda din `_layout.tsx` ține aici
 * orice cont cu sesiune + profil care n-a acceptat `TERMS_VERSION`. Fără „Mai târziu” (D8.3), dar
 * cu 4 ieșiri mereu vizibile: textele (Termeni / Politică), Deconectare, Descarcă datele mele,
 * Șterge contul. După „Am citit și accept” poarta se ridică local, iar garda duce omul mai departe.
 */
export function TermsUpdateScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const { session, signOut } = useAuth();
  const { markAccepted } = useTermsStatus();
  const guard = useSubmitGuard();
  const exportGuard = useSubmitGuard();
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportDone, setExportDone] = useState(false);
  const [error, setError] = useState('');

  // Fără sesiune (Deconectare de aici, sau link direct pe web) garda nu părăsește singură grupul
  // (auth) — ca la two-factor: mergem noi la login.
  useEffect(() => {
    if (!session) router.replace('/(auth)/login' as never);
  }, [session, router]);

  async function handleAccept() {
    if (!ageConfirmed) {
      setError(t('consent.ageRequired'));
      return;
    }
    setError('');
    setAccepting(true);
    const err = await acceptTerms('update');
    if (err) {
      setAccepting(false);
      setError(err);
      return;
    }
    // Garda vede `needsAcceptance` false și duce omul pe ecranul de start (ecranul se demontează).
    markAccepted();
  }

  async function handleSignOut() {
    setSigningOut(true);
    await signOut();
    setSigningOut(false);
  }

  function handleExport() {
    void exportGuard(async () => {
      setExporting(true);
      setExportDone(false);
      const { error: exportError } = await exportMyData();
      setExporting(false);
      if (exportError) {
        Alert.alert(t('common.error'), exportError);
        return;
      }
      setExportDone(true);
    });
  }

  const busy = accepting || signingOut;

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.inner}>
          <View style={styles.header}>
            <MaterialIcons name="policy" size={56} color={theme.brand} />
            <ThemedText type="subtitle" style={styles.centered}>
              {t('consent.updatedTitle')}
            </ThemedText>
          </View>

          <ThemedText themeColor="textSecondary" style={styles.body}>
            {t('consent.updatedBody', { version: TERMS_VERSION })}
          </ThemedText>

          <View style={styles.readRow}>
            <Pressable
              onPress={() => router.push(TERMS_ROUTE as never)}
              accessibilityRole="link"
              hitSlop={6}>
              <ThemedText style={[styles.linkText, { color: theme.brand }]}>
                {t('consent.readTerms')}
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={() => router.push(PRIVACY_ROUTE as never)}
              accessibilityRole="link"
              hitSlop={6}>
              <ThemedText style={[styles.linkText, { color: theme.brand }]}>
                {t('consent.readPrivacy')}
              </ThemedText>
            </Pressable>
          </View>

          <AgeConfirmCheckbox
            checked={ageConfirmed}
            onChange={(next) => {
              setAgeConfirmed(next);
              if (next && error) setError('');
            }}
            disabled={busy}
          />

          <Button
            title={t('consent.updatedAccept')}
            onPress={() => void guard(handleAccept)}
            loading={accepting}
            disabled={!ageConfirmed || signingOut}
          />
          {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}

          {/* Ieșirile mereu vizibile (C8.2). */}
          <View style={[styles.exits, { borderTopColor: theme.backgroundSelected }]}>
            <Pressable
              onPress={handleExport}
              disabled={exporting || busy}
              accessibilityRole="button"
              style={styles.exitRow}
              hitSlop={6}>
              {exporting ? (
                <ActivityIndicator size="small" color={theme.brand} />
              ) : (
                <MaterialIcons name="download" size={20} color={theme.brand} />
              )}
              <ThemedText style={[styles.linkText, { color: theme.brand }]}>
                {exporting ? t('settings.exportLoading') : t('consent.exportData')}
              </ThemedText>
            </Pressable>
            {exportDone ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
                {t('consent.exportDone')}
              </ThemedText>
            ) : null}
            <Pressable
              onPress={() => router.push('/(auth)/delete-account' as never)}
              disabled={busy}
              accessibilityRole="button"
              style={styles.exitRow}
              hitSlop={6}>
              <MaterialIcons name="delete-forever" size={20} color="#ef4444" />
              <ThemedText style={[styles.linkText, styles.danger]}>
                {t('consent.deleteAccount')}
              </ThemedText>
            </Pressable>
            <Button
              title={t('consent.signOut')}
              variant="secondary"
              onPress={() => void guard(handleSignOut)}
              loading={signingOut}
              disabled={accepting}
            />
          </View>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: Spacing.four },
  // Pe web lat conținutul rămâne o coloană lizibilă, centrată.
  inner: { width: '100%', maxWidth: 520, alignSelf: 'center', gap: Spacing.three },
  header: { alignItems: 'center', gap: Spacing.two, marginBottom: Spacing.one },
  centered: { textAlign: 'center' },
  body: { textAlign: 'center', lineHeight: 22 },
  readRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    columnGap: Spacing.four,
    rowGap: Spacing.two,
  },
  linkText: { fontWeight: '600', fontSize: 15 },
  danger: { color: '#ef4444' },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  checkText: { flex: 1, lineHeight: 20 },
  error: { color: '#ef4444', textAlign: 'center', fontSize: 14 },
  exits: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: Spacing.two,
    paddingTop: Spacing.three,
    gap: Spacing.three,
  },
  exitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  consent: { textAlign: 'center', lineHeight: 20 },
  inlineLink: { fontWeight: '600', textDecorationLine: 'underline' },
});
