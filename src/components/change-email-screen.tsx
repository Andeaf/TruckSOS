import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useBack } from '@/hooks/use-back';
import { useTheme } from '@/hooks/use-theme';
import { translateAuthError } from '@/lib/auth-errors';
import { supabase } from '@/lib/supabase';

/**
 * Schimbarea emailului de AUTENTIFICARE (nu a contact_email-ului public din profil).
 * Pasul 1: adresa nouă + parola curentă (re-verificată — schimbarea emailului
 * echivalează cu preluarea contului). Pasul 2: codul de 6 cifre primit pe adresa
 * NOUĂ → `verifyOtp(email_change)`. Cere „Secure email change" DEZACTIVAT în
 * Supabase (altfel s-ar trimite câte un cod pe ambele adrese).
 */
export function ChangeEmailScreen({ backPath }: { backPath: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const goBack = useBack(backPath);
  const { session } = useAuth();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const currentEmail = session?.user.email ?? '';

  useEffect(() => {
    if (cooldown === 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function handleSendCode() {
    setError(undefined);
    const mail = newEmail.trim().toLowerCase();
    if (!mail || !password) {
      setError(t('settings.changeEmailScreen.errorEmpty'));
      return;
    }
    if (mail === currentEmail.toLowerCase()) {
      setError(t('settings.changeEmailScreen.errorSame'));
      return;
    }

    setLoading(true);
    const { error: authErr } = await supabase.auth.signInWithPassword({
      email: currentEmail,
      password,
    });
    if (authErr) {
      setLoading(false);
      setError(t('settings.changeEmailScreen.errorWrongPassword'));
      return;
    }
    const { error: updateErr } = await supabase.auth.updateUser({ email: mail });
    setLoading(false);
    if (updateErr) {
      setError(translateAuthError(updateErr) ?? undefined);
      return;
    }
    setStep('code');
    setCooldown(60);
  }

  async function handleVerify() {
    setError(undefined);
    if (code.trim().length !== 6) {
      setError(t('auth.otp.errorCode'));
      return;
    }
    setLoading(true);
    const { error: verifyErr } = await supabase.auth.verifyOtp({
      email: newEmail.trim().toLowerCase(),
      token: code.trim(),
      type: 'email_change',
    });
    setLoading(false);
    if (verifyErr) {
      setError(translateAuthError(verifyErr) ?? undefined);
      return;
    }
    Alert.alert(
      t('settings.changeEmailScreen.successTitle'),
      t('settings.changeEmailScreen.successBody'),
      [{ text: 'OK', onPress: goBack }],
    );
  }

  async function handleResend() {
    setError(undefined);
    const { error: err } = await supabase.auth.resend({
      type: 'email_change',
      email: newEmail.trim().toLowerCase(),
    });
    if (err) setError(translateAuthError(err) ?? undefined);
    else setCooldown(60);
  }

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t('settings.changeEmailScreen.title')} onBack={goBack} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {step === 'email' ? (
            <>
              <ThemedText themeColor="textSecondary" type="small">
                {t('settings.changeEmailScreen.explainBody', { email: currentEmail })}
              </ThemedText>

              <Input
                label={t('settings.changeEmailScreen.newEmailLabel')}
                value={newEmail}
                onChangeText={setNewEmail}
                placeholder={t('auth.login.emailPlaceholder')}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                required
              />
              <Input
                label={t('settings.changeEmailScreen.passwordLabel')}
                value={password}
                onChangeText={setPassword}
                placeholder={t('auth.login.passwordPlaceholder')}
                secureTextEntry
                error={error}
                required
              />

              <Button
                title={t('settings.changeEmailScreen.sendButton')}
                onPress={handleSendCode}
                loading={loading}
              />
            </>
          ) : (
            <>
              <ThemedText themeColor="textSecondary" type="small">
                {t('settings.changeEmailScreen.codeSentBody', { email: newEmail.trim() })}
              </ThemedText>

              <Input
                label={t('auth.otp.codeLabel')}
                value={code}
                onChangeText={setCode}
                placeholder={t('auth.otp.codePlaceholder')}
                keyboardType="number-pad"
                maxLength={6}
                error={error}
                required
              />

              <Button
                title={t('settings.changeEmailScreen.submit')}
                onPress={handleVerify}
                loading={loading}
              />

              <Pressable onPress={handleResend} disabled={cooldown > 0}>
                <ThemedText
                  style={[styles.link, { color: theme.brand }, cooldown > 0 && styles.dimmed]}>
                  {cooldown > 0
                    ? t('auth.otp.resendCooldown', { s: cooldown })
                    : t('auth.otp.resend')}
                </ThemedText>
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.three },
  link: { fontWeight: '600', fontSize: 16, textAlign: 'center' },
  dimmed: { opacity: 0.5 },
});
