import { useEffect, useRef, useState } from 'react';
import {
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Link } from 'expo-router';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import type { AuthError } from '@supabase/supabase-js';

import { Button } from '@/components/ui/button';
import { NetworkTroubleshoot } from '@/components/network-troubleshoot';
import { Input } from '@/components/ui/input';
import { SocialSignIn } from '@/components/social-sign-in';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useSubmitGuard } from '@/hooks/use-submit-guard';
import { useNetworkDiagnosis } from '@/hooks/use-network-diagnosis';
import { setAuthEntry } from '@/lib/auth-entry';
import { translateAuthError } from '@/lib/auth-errors';
import { MIN_PASSWORD_LENGTH } from '@/lib/auth-rules';
import { getCaptchaToken } from '@/lib/captcha';
import { supabase } from '@/lib/supabase';

/**
 * Codul respins ca „expirat sau invalid" (1.1, Faza C): codul și linkul din e-mail sunt
 * același token, deci după un tap pe link codul tastat dă exact eroarea asta. Serverele
 * noi trimit `otp_expired` („Token has expired or is invalid"); fără cod, după mesaj.
 */
function isOtpExpiredOrInvalid(err: AuthError): boolean {
  if (err.code) return err.code === 'otp_expired';
  return /expired|invalid/i.test(err.message);
}

export default function RegisterScreen() {
  const { signUp, signIn } = useAuth();
  const { t } = useTranslation();
  const guard = useSubmitGuard();
  const { diagnosis, inspect } = useNetworkDiagnosis();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [resent, setResent] = useState(false);
  const [linkLoading, setLinkLoading] = useState(false);

  // 1.1, Faza C: contul poate fi activat și din linkul din e-mail (în browser sau, pe
  // Android, direct în aplicație). Datele formularului rămân în state pe pasul de cod,
  // deci ne putem conecta cu parola fără ca omul s-o mai tasteze.
  const silentAttempt = useRef(false);
  const latest = useRef({ emailSent, email, password, signIn });
  useEffect(() => {
    latest.current = { emailSent, email, password, signIn };
  });

  // (c) Revenire în prim-plan pe pasul de cod (de obicei din aplicația de mail / browser,
  // după tap pe link): o încercare tăcută de conectare per revenire. Dacă linkul n-a fost
  // apăsat, eșuează cu „email neconfirmat" și nu afișăm nimic — codul se poate tasta în
  // continuare. Pe web, AppState urmează vizibilitatea filei.
  useEffect(() => {
    let previous = AppState.currentState;
    const sub = AppState.addEventListener('change', (next) => {
      const cameBack = previous !== 'active' && next === 'active';
      previous = next;
      if (!cameBack) return;
      const { emailSent: onCodeStep, email: mail, password: pass, signIn: doSignIn } =
        latest.current;
      if (!onCodeStep || !mail.trim() || !pass || silentAttempt.current) return;
      silentAttempt.current = true;
      void doSignIn(mail.trim(), pass).finally(() => {
        silentAttempt.current = false;
      });
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (cooldown === 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function handleSignUp() {
    if (!fullName.trim() || !email.trim() || !password || !confirmPassword) {
      setError(t('auth.register.errorEmpty'));
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('auth.register.errorPasswordLength'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('auth.register.errorPasswordMismatch'));
      return;
    }
    setLoading(true);
    setError('');
    const result = await signUp(email.trim(), password, fullName.trim());
    setLoading(false);
    inspect(result.error, 'register');
    if (result.error) {
      setError(result.error);
    } else if (result.needsConfirmation) {
      setEmailSent(true);
      setCooldown(60);
    }
    // Fără needsConfirmation înseamnă că sesiunea există deja (confirmarea e
    // dezactivată în Supabase) → nav guard-ul navighează singur mai departe.
  }

  // Codul de confirmare deschide sesiunea → guard-ul duce userul la alegerea rolului.
  async function handleVerify() {
    if (code.trim().length !== 6) {
      setError(t('auth.otp.errorCode'));
      return;
    }
    setLoading(true);
    setError('');
    setResent(false);
    // Reafirmăm intenția de înregistrare: app-ul putea fi repornit între înscriere și cod.
    await setAuthEntry('signup');
    const { error: err } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'signup',
    });
    // (d) Codul „expirat/invalid" poate însemna că linkul din e-mail a consumat deja
    // tokenul: contul e activ, deci parola din formular ne conectează. Abia dacă și asta
    // pică arătăm eroarea codului.
    if (err && isOtpExpiredOrInvalid(err) && password) {
      const fallbackErr = await signIn(email.trim(), password);
      if (!fallbackErr) {
        setLoading(false);
        return; // sesiune deschisă → garda duce la alegerea rolului
      }
    }
    setLoading(false);
    inspect(err, 'verify_signup');
    if (err) setError(translateAuthError(err) ?? '');
  }

  // (b) „Am confirmat prin link": conectare cu parola din formular; eroarea (de ex.
  // „email neconfirmat" dacă linkul n-a fost apăsat) e cea tradusă de signIn.
  async function handleConfirmedByLink() {
    setLinkLoading(true);
    setError('');
    setResent(false);
    const err = await signIn(email.trim(), password);
    setLinkLoading(false);
    inspect(err, 'login');
    if (err) setError(err);
  }

  async function handleResend() {
    setError('');
    const captchaToken = await getCaptchaToken();
    const { error: err } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim(),
      ...(captchaToken ? { options: { captchaToken } } : {}),
    });
    inspect(err, 'resend_signup');
    if (err) {
      setError(translateAuthError(err) ?? '');
      return;
    }
    // Supabase invalidează codul vechi la retrimitere. Spunem explicit, altfel
    // userul introduce codul din primul email (sosit târziu) și primește „expirat”.
    setResent(true);
    setCooldown(60);
  }

  return (
    <ThemedView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Image source={require('@/assets/images/icon.png')} style={styles.logo} />
            <ThemedText type="title">{t('auth.appName')}</ThemedText>
            <ThemedText themeColor="textSecondary">{t('auth.register.subtitle')}</ThemedText>
          </View>

          {emailSent ? (
            <View style={styles.emailSentBox}>
              <ThemedText type="subtitle" style={styles.emailSentTitle}>
                {t('auth.register.verifyEmailTitle')}
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.emailSentDesc}>
                {t('auth.register.verifyEmailMessage', { email: email.trim() })}
              </ThemedText>

              <View style={styles.codeForm}>
                <Input
                  label={t('auth.otp.codeLabel')}
                  value={code}
                  onChangeText={setCode}
                  placeholder={t('auth.otp.codePlaceholder')}
                  keyboardType="number-pad"
                  maxLength={6}
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  required
                />

                <ThemedText themeColor="textSecondary" style={styles.linkHint}>
                  {t('auth.otp.linkHint')}
                </ThemedText>

                {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}

                <NetworkTroubleshoot diagnosis={diagnosis} />
                {!error && resent ? (
                  <ThemedText style={styles.notice}>{t('auth.otp.resentNotice')}</ThemedText>
                ) : null}

                <Button
                  title={t('auth.register.verifyButton')}
                  onPress={() => void guard(handleVerify)}
                  loading={loading}
                  disabled={linkLoading}
                />
                <Button
                  variant="secondary"
                  title={t('auth.otp.confirmedByLink')}
                  onPress={() => void guard(handleConfirmedByLink)}
                  loading={linkLoading}
                  disabled={loading}
                />
              </View>

              <Pressable onPress={handleResend} disabled={cooldown > 0}>
                <ThemedText style={[styles.link, cooldown > 0 && styles.dimmed]}>
                  {cooldown > 0
                    ? t('auth.otp.resendCooldown', { s: cooldown })
                    : t('auth.otp.resend')}
                </ThemedText>
              </Pressable>

              <ThemedText themeColor="textSecondary" style={styles.spamHint}>
                {t('auth.otp.validityHint')}
                {'\n'}
                {t('auth.otp.spamHint')}
              </ThemedText>

              {/* Email greșit? Înapoi la formular cu câmpurile păstrate (e doar
                  ascuns cu display:none), fără reluarea înregistrării de la zero. */}
              <Pressable
                onPress={() => {
                  setEmailSent(false);
                  setCode('');
                  setError('');
                  setResent(false);
                }}>
                <ThemedText style={styles.link}>{t('auth.otp.changeEmail')}</ThemedText>
              </Pressable>

              <Link href="/(auth)/login" asChild>
                <Pressable>
                  <ThemedText style={styles.link}>{t('auth.register.goToLogin')}</ThemedText>
                </Pressable>
              </Link>
            </View>
          ) : null}

          <View style={[styles.form, emailSent && styles.hidden]}>
            <Input
              label={t('auth.register.nameLabel')}
              value={fullName}
              onChangeText={setFullName}
              placeholder={t('auth.register.namePlaceholder')}
              autoCapitalize="words"
              autoComplete="name"
              required
            />
            <Input
              label={t('auth.register.emailLabel')}
              value={email}
              onChangeText={setEmail}
              placeholder={t('auth.register.emailPlaceholder')}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              required
            />
            <Input
              label={t('auth.register.passwordLabel')}
              value={password}
              onChangeText={setPassword}
              placeholder={t('auth.register.passwordPlaceholder')}
              secureTextEntry
              required
            />
            <Input
              label={t('auth.register.confirmPasswordLabel')}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder={t('auth.register.passwordPlaceholder')}
              secureTextEntry
              required
            />

            {error ? (
              <>
                <ThemedText style={styles.error}>{error}</ThemedText>
                <NetworkTroubleshoot diagnosis={diagnosis} />
              </>
            ) : null}

            <Button title={t('auth.register.button')} onPress={() => void guard(handleSignUp)} loading={loading} />

            <ThemedText themeColor="textSecondary" style={styles.requiredNote}>
              {t('common.requiredNote')}
            </ThemedText>

            {/* 6 oct: cont nou direct cu Google/Apple — fără parolă și fără cod pe email
                (emailul vine verificat de furnizor); rolul și telefonul se cer apoi. */}
            <SocialSignIn origin="register" />
          </View>

          <View style={styles.footer}>
            <ThemedText themeColor="textSecondary">{t('auth.register.hasAccount')}</ThemedText>
            <Link href="/(auth)/login" asChild>
              <Pressable>
                <ThemedText style={styles.link}>{t('auth.register.loginLink')}</ThemedText>
              </Pressable>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.five,
  },
  header: { alignItems: 'center', gap: Spacing.two },
  logo: { width: 64, height: 64, borderRadius: 14, marginBottom: Spacing.one },
  form: { gap: Spacing.three },
  error: { color: '#ef4444', textAlign: 'center', fontSize: 14 },
  notice: { color: '#0E3A7D', textAlign: 'center', fontSize: 14 },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.one,
  },
  link: { color: '#0E3A7D', fontWeight: '600', fontSize: 16 },
  hidden: { display: 'none' },
  emailSentBox: {
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.four,
  },
  emailSentTitle: { fontSize: 24, lineHeight: 32 },
  emailSentDesc: { textAlign: 'center', lineHeight: 22 },
  emailBold: { fontWeight: '700', color: '#0E3A7D' },
  codeForm: { alignSelf: 'stretch', gap: Spacing.three },
  dimmed: { opacity: 0.5 },
  spamHint: { fontSize: 13, textAlign: 'center' },
  linkHint: { fontSize: 13, textAlign: 'center' },
  requiredNote: { fontSize: 13, textAlign: 'center' },
});
