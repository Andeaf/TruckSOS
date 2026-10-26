import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { NetworkTroubleshoot } from '@/components/network-troubleshoot';
import { useNetworkDiagnosis } from '@/hooks/use-network-diagnosis';
import { Input } from '@/components/ui/input';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { translateAuthError } from '@/lib/auth-errors';
import { MIN_PASSWORD_LENGTH } from '@/lib/auth-rules';
import { getCaptchaToken } from '@/lib/captcha';
import { supabase } from '@/lib/supabase';

/**
 * Resetare parolă prin cod de 6 cifre (fără deep links — merge identic în Expo Go
 * și în build-urile de store). Pasul 1: emailul → `resetPasswordForEmail` trimite
 * codul (template-ul „Reset Password" trebuie să conțină {{ .Token }}). Pasul 2:
 * cod + parolă nouă → `verifyOtp(recovery)` deschide sesiunea, `updateUser` schimbă
 * parola, iar nav guard-ul duce userul direct în aplicație, deja autentificat.
 */
export default function ForgotPasswordScreen() {
  const { t } = useTranslation();
  const { diagnosis, inspect } = useNetworkDiagnosis();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (cooldown === 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function sendCode() {
    const mail = email.trim();
    if (!mail) {
      setError(t('auth.forgot.errorEmail'));
      return;
    }
    setLoading(true);
    setError('');
    // Captcha (1.8): tokenul pleacă doar când e configurat; serverul îl cere doar cu Turnstile pornit.
    const captchaToken = await getCaptchaToken();
    const { error: err } = await supabase.auth.resetPasswordForEmail(
      mail,
      captchaToken ? { captchaToken } : undefined,
    );
    setLoading(false);
    inspect(err, 'reset_request');
    if (err) {
      setError(translateAuthError(err) ?? '');
      return;
    }
    // Retrimiterea invalidează codul din emailul anterior (Supabase ține un singur
    // token de recovery). Anunțăm explicit, ca userul să nu-l mai folosească pe cel vechi.
    setResent(step === 'code');
    setStep('code');
    setCooldown(60);
  }

  async function handleReset() {
    if (code.trim().length !== 6) {
      setError(t('auth.otp.errorCode'));
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
    setResent(false);
    const { error: verifyErr } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'recovery',
    });
    inspect(verifyErr, 'verify_recovery');
    if (verifyErr) {
      setLoading(false);
      setError(translateAuthError(verifyErr) ?? '');
      return;
    }
    // verifyOtp a deschis sesiunea → guard-ul poate demonta ecranul oricând de aici
    // încolo, deci raportăm prin Alert (global), nu prin state local.
    const { error: updateErr } = await supabase.auth.updateUser({ password });
    if (updateErr) {
      setLoading(false);
      Alert.alert(t('auth.forgot.updateErrorTitle'), translateAuthError(updateErr) ?? '');
      return;
    }
    // 26 oct 2026 (AUDIT #14): resetarea parolei e exact momentul în care un dispozitiv străin
    // trebuie scos — Supabase nu invalidează singur celelalte sesiuni. `others` păstrează
    // sesiunea deschisă chiar acum de verifyOtp. Eșecul nu anulează parola deja schimbată.
    const { error: othersErr } = await supabase.auth.signOut({ scope: 'others' });
    setLoading(false);
    Alert.alert(
      t('auth.forgot.successTitle'),
      othersErr ? t('auth.forgot.successBodyOthersFailed') : t('auth.forgot.successBody'),
    );
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
            <ThemedText type="title">{t('auth.appName')}</ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.subtitle}>
              {step === 'email' ? t('auth.forgot.subtitle') : t('auth.forgot.codeSentBody', { email: email.trim() })}
            </ThemedText>
          </View>

          {step === 'email' ? (
            <View style={styles.form}>
              <Input
                label={t('auth.login.emailLabel')}
                value={email}
                onChangeText={setEmail}
                placeholder={t('auth.login.emailPlaceholder')}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                required
              />

              {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}

              <NetworkTroubleshoot diagnosis={diagnosis} />

              <Button title={t('auth.forgot.sendButton')} onPress={sendCode} loading={loading} />
            </View>
          ) : (
            <View style={styles.form}>
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
              <Input
                label={t('auth.forgot.newPasswordLabel')}
                value={password}
                onChangeText={setPassword}
                placeholder={t('auth.register.passwordPlaceholder')}
                secureTextEntry
                required
              />
              <Input
                label={t('auth.forgot.confirmPasswordLabel')}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder={t('auth.register.passwordPlaceholder')}
                secureTextEntry
                required
              />

              {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}

              <NetworkTroubleshoot diagnosis={diagnosis} />
              {!error && resent ? (
                <ThemedText style={styles.notice}>{t('auth.otp.resentNotice')}</ThemedText>
              ) : null}

              <Button title={t('auth.forgot.resetButton')} onPress={handleReset} loading={loading} />

              <Pressable onPress={sendCode} disabled={cooldown > 0}>
                <ThemedText
                  style={[styles.link, styles.centered, cooldown > 0 && styles.dimmed]}>
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
            </View>
          )}

          <View style={styles.footer}>
            <Link href="/(auth)/login" asChild>
              <Pressable>
                <ThemedText style={styles.link}>{t('auth.forgot.backToLogin')}</ThemedText>
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
  subtitle: { textAlign: 'center', lineHeight: 22 },
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
  centered: { textAlign: 'center' },
  dimmed: { opacity: 0.5 },
  spamHint: { fontSize: 13, textAlign: 'center' },
});
