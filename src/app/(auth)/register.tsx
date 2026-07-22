import { useState } from 'react';
import {
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
import { Input } from '@/components/ui/input';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';

export default function RegisterScreen() {
  const { signUp } = useAuth();
  const { t } = useTranslation();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  async function handleSignUp() {
    if (!fullName.trim() || !email.trim() || !password) {
      setError(t('auth.register.errorEmpty'));
      return;
    }
    if (password.length < 6) {
      setError(t('auth.register.errorPasswordLength'));
      return;
    }
    setLoading(true);
    setError('');
    const err = await signUp(email.trim(), password, fullName.trim());
    setLoading(false);
    if (err) {
      setError(err);
    } else {
      setTimeout(() => setEmailSent(true), 2000);
    }
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
            <ThemedText themeColor="textSecondary">{t('auth.register.subtitle')}</ThemedText>
          </View>

          {emailSent ? (
            <View style={styles.emailSentBox}>
              <ThemedText type="subtitle" style={styles.emailSentTitle}>
                {t('auth.register.verifyEmailTitle')}
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.emailSentDesc}>
                {t('auth.register.verifyEmailMessage', { email })}
              </ThemedText>
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
            />
            <Input
              label={t('auth.register.emailLabel')}
              value={email}
              onChangeText={setEmail}
              placeholder={t('auth.register.emailPlaceholder')}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />
            <Input
              label={t('auth.register.passwordLabel')}
              value={password}
              onChangeText={setPassword}
              placeholder={t('auth.register.passwordPlaceholder')}
              secureTextEntry
            />

            {error ? (
              <ThemedText style={styles.error}>{error}</ThemedText>
            ) : null}

            <Button title={t('auth.register.button')} onPress={handleSignUp} loading={loading} />
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
  form: { gap: Spacing.three },
  error: { color: '#ef4444', textAlign: 'center', fontSize: 14 },
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
});
