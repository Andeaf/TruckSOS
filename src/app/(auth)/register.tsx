import { useEffect, useState } from 'react';
import {
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

import { Button } from '@/components/ui/button';
import { NetworkTroubleshoot } from '@/components/network-troubleshoot';
import { Input } from '@/components/ui/input';
import { SocialSignIn } from '@/components/social-sign-in';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useNetworkDiagnosis } from '@/hooks/use-network-diagnosis';
import { translateAuthError } from '@/lib/auth-errors';
import { supabase } from '@/lib/supabase';

export default function RegisterScreen() {
  const { signUp } = useAuth();
  const { t } = useTranslation();
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
    if (password.length < 6) {
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
    const { error: err } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'signup',
    });
    setLoading(false);
    inspect(err, 'verify_signup');
    if (err) setError(translateAuthError(err) ?? '');
  }

  async function handleResend() {
    setError('');
    const { error: err } = await supabase.auth.resend({ type: 'signup', email: email.trim() });
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

                {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}

                <NetworkTroubleshoot diagnosis={diagnosis} />
                {!error && resent ? (
                  <ThemedText style={styles.notice}>{t('auth.otp.resentNotice')}</ThemedText>
                ) : null}

                <Button
                  title={t('auth.register.verifyButton')}
                  onPress={handleVerify}
                  loading={loading}
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

            <Button title={t('auth.register.button')} onPress={handleSignUp} loading={loading} />

            <ThemedText themeColor="textSecondary" style={styles.requiredNote}>
              {t('common.requiredNote')}
            </ThemedText>

            {/* 6 oct: cont nou direct cu Google/Apple — fără parolă și fără cod pe email
                (emailul vine verificat de furnizor); rolul și telefonul se cer apoi. */}
            <SocialSignIn />
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
  requiredNote: { fontSize: 13, textAlign: 'center' },
});
