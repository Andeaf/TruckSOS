import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useSubmitGuard } from '@/hooks/use-submit-guard';
import { translateMfaError, verifiedTotpFactors } from '@/lib/mfa';
import { supabase } from '@/lib/supabase';

/**
 * Codul din aplicația de autentificare, cerut după login când contul are autentificarea în doi
 * pași activă și sesiunea e încă aal1 (PLAN_1.1_FIX 4.4). Garda din `_layout.tsx` ține omul aici
 * până la cod corect sau deconectare; la reușită `mfa.verify` salvează sesiunea aal2, use-auth o
 * preia din MFA_CHALLENGE_VERIFIED, iar garda îl duce mai departe ca după un login obișnuit.
 */
export default function TwoFactorVerifyScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session, signOut } = useAuth();
  const guard = useSubmitGuard();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function handleVerify() {
    const clean = code.replace(/\s/g, '');
    if (!/^\d{6}$/.test(clean)) {
      setError(t('twoFactor.codeInvalid'));
      return;
    }
    setError('');
    setLoading(true);

    // Factorul vine din sesiune (aceeași listă care a declanșat ecranul); dacă lipsește,
    // îl cerem serverului.
    let factorId = verifiedTotpFactors(session)[0]?.id;
    if (!factorId) {
      const { data, error: listErr } = await supabase.auth.mfa.listFactors();
      if (listErr) {
        setLoading(false);
        setError(translateMfaError(listErr) ?? t('twoFactor.genericError'));
        return;
      }
      factorId = data?.totp[0]?.id;
    }
    if (!factorId) {
      setLoading(false);
      setError(t('twoFactor.genericError'));
      return;
    }

    const { error: verifyErr } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code: clean,
    });
    if (verifyErr?.code === 'mfa_factor_not_found') {
      // Factorul a fost dezactivat de pe alt dispozitiv, dar sesiunea de aici încă îl listează:
      // o sesiune reîmprospătată aduce lista actuală de factori, iar garda ridică ecranul singură.
      await supabase.auth.refreshSession().catch(() => undefined);
    }
    setLoading(false);
    if (verifyErr) {
      setError(translateMfaError(verifyErr) ?? t('twoFactor.genericError'));
      return;
    }
    setCode('');
  }

  async function handleSignOut() {
    setSigningOut(true);
    await signOut();
    setSigningOut(false);
    // Garda nu părăsește singură grupul (auth) când sesiunea dispare (review 1 nov): mergem noi la login.
    router.replace('/(auth)/login' as never);
  }

  return (
    <ThemedView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <MaterialIcons name="security" size={56} color="#164F9E" />
            <ThemedText type="subtitle" style={styles.centered}>
              {t('twoFactor.title')}
            </ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.centered}>
              {t('twoFactor.loginPrompt')}
            </ThemedText>
          </View>

          <Input
            label={t('twoFactor.enterCode')}
            value={code}
            onChangeText={(v) => {
              setCode(v);
              if (error) setError('');
            }}
            placeholder="123456"
            keyboardType="number-pad"
            maxLength={6}
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            autoFocus
            required
            error={error || undefined}
          />

          <Button
            title={t('twoFactor.confirm')}
            onPress={() => void guard(handleVerify)}
            loading={loading}
          />
          <Button
            title={t('twoFactor.signOut')}
            variant="secondary"
            onPress={() => void guard(handleSignOut)}
            loading={signingOut}
            disabled={loading}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: Spacing.four, gap: Spacing.three },
  header: { alignItems: 'center', gap: Spacing.two, marginBottom: Spacing.two },
  centered: { textAlign: 'center' },
  error: { color: '#ef4444', textAlign: 'center', fontSize: 14 },
});
