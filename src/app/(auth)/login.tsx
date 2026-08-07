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

export default function LoginScreen() {
  const { signIn } = useAuth();
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSignIn() {
    if (!email.trim() || !password) {
      setError(t('auth.login.errorEmpty'));
      return;
    }
    setLoading(true);
    setError('');
    const err = await signIn(email.trim(), password);
    if (err) setError(err);
    setLoading(false);
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
            <ThemedText themeColor="textSecondary">{t('auth.login.subtitle')}</ThemedText>
          </View>

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
            <Input
              label={t('auth.login.passwordLabel')}
              value={password}
              onChangeText={setPassword}
              placeholder={t('auth.login.passwordPlaceholder')}
              secureTextEntry
              required
            />

            <Link href="/(auth)/forgot-password" asChild>
              <Pressable style={styles.forgotWrap}>
                <ThemedText style={styles.forgotLink}>{t('auth.login.forgotPassword')}</ThemedText>
              </Pressable>
            </Link>

            {error ? (
              <ThemedText style={styles.error}>{error}</ThemedText>
            ) : null}

            <Button title={t('auth.login.button')} onPress={handleSignIn} loading={loading} />
          </View>

          <View style={styles.footer}>
            <ThemedText themeColor="textSecondary">{t('auth.login.noAccount')}</ThemedText>
            <Link href="/(auth)/register" asChild>
              <Pressable>
                <ThemedText style={styles.link}>{t('auth.login.registerLink')}</ThemedText>
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
  forgotWrap: { alignSelf: 'flex-end' },
  forgotLink: { color: '#0E3A7D', fontWeight: '600', fontSize: 14 },
});
