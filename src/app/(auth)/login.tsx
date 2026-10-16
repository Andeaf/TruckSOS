import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Link } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
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
import { useWideLayout } from '@/components/web-sidebar';

export default function LoginScreen() {
  const { signIn } = useAuth();
  const { t } = useTranslation();
  const { diagnosis, inspect } = useNetworkDiagnosis();
  // Design 10a: pe web lat, ecranul devine split — panou de brand la stânga,
  // formular constrâns la dreapta. Pe telefon rămâne exact varianta veche.
  const wide = useWideLayout();
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
    inspect(err, 'login');
    if (err) setError(err);
    setLoading(false);
  }

  const form = (
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

      {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}

      <NetworkTroubleshoot diagnosis={diagnosis} />

      <Button title={t('auth.login.button')} onPress={handleSignIn} loading={loading} />

      {/* 6 oct: Google (+ Apple pe iOS) — se randează doar când furnizorii sunt disponibili. */}
      <SocialSignIn />
    </View>
  );

  const footer = (
    <View style={styles.footer}>
      <ThemedText themeColor="textSecondary">{t('auth.login.noAccount')}</ThemedText>
      <Link href="/(auth)/register" asChild>
        <Pressable>
          <ThemedText style={styles.link}>{t('auth.login.registerLink')}</ThemedText>
        </Pressable>
      </Link>
    </View>
  );

  if (wide) {
    return (
      <ThemedView style={styles.wideContainer}>
        <LinearGradient
          colors={['#164F9E', '#0B1F3D']}
          start={{ x: 0.7, y: 0 }}
          end={{ x: 0.25, y: 1 }}
          style={styles.hero}>
          <View style={styles.heroBrand}>
            <Image source={require('@/assets/images/icon.png')} style={styles.heroBrandMark} />
            <Text style={styles.heroBrandName}>{t('auth.appName')}</Text>
          </View>
          <View style={styles.heroBody}>
            <Text style={styles.heroHeadline}>{t('auth.hero.headline')}</Text>
            <Text style={styles.heroDescription}>{t('auth.hero.description')}</Text>
            <View style={styles.heroBullets}>
              {(['bullet1', 'bullet2', 'bullet3'] as const).map((key) => (
                <View key={key} style={styles.heroBullet}>
                  <Feather name="check" size={16} color="#FFFFFF" />
                  <Text style={styles.heroBulletText}>{t(`auth.hero.${key}`)}</Text>
                </View>
              ))}
            </View>
          </View>
          <Text style={styles.heroCopyright}>
            © {new Date().getFullYear()} {t('auth.appName')}
          </Text>
        </LinearGradient>

        <ScrollView
          style={styles.widePane}
          contentContainerStyle={styles.widePaneScroll}
          keyboardShouldPersistTaps="handled">
          <View style={styles.wideForm}>
            <ThemedText style={styles.wideTitle}>{t('auth.login.title')}</ThemedText>
            <ThemedText themeColor="textTertiary" style={styles.wideSubtitle}>
              {t('auth.login.subtitle')}
            </ThemedText>
            <View style={styles.wideFormFields}>{form}</View>
            {footer}
          </View>
        </ScrollView>
      </ThemedView>
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
            <Image source={require('@/assets/images/icon.png')} style={styles.logo} />
            <ThemedText type="title">{t('auth.appName')}</ThemedText>
            <ThemedText themeColor="textSecondary">{t('auth.login.subtitle')}</ThemedText>
          </View>

          {form}

          {footer}
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
  logo: { width: 72, height: 72, borderRadius: 16, marginBottom: Spacing.one },
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

  // Design 10a — split pe web lat.
  wideContainer: { flex: 1, flexDirection: 'row' },
  hero: { width: '46%', padding: 48 },
  heroBrand: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  // Iconița reală a aplicației; chenarul subțire o desprinde de gradientul navy,
  // aproape identic cu fundalul iconiței.
  heroBrandMark: {
    width: 42,
    height: 42,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  heroBrandName: { color: '#FFFFFF', fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  heroBody: { marginTop: 'auto' },
  heroHeadline: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -0.6,
    lineHeight: 39,
    maxWidth: 400,
  },
  heroDescription: {
    color: '#FFFFFF',
    opacity: 0.75,
    fontSize: 15,
    lineHeight: 23,
    marginTop: 14,
    maxWidth: 420,
  },
  heroBullets: { gap: 12, marginTop: 28 },
  heroBullet: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroBulletText: { color: '#FFFFFF', opacity: 0.85, fontSize: 14, fontWeight: '600' },
  heroCopyright: { color: '#FFFFFF', opacity: 0.5, fontSize: 12, fontWeight: '600', marginTop: 'auto' },
  widePane: { flex: 1 },
  widePaneScroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.five },
  wideForm: { width: 400 },
  wideTitle: { fontSize: 26, fontWeight: '800', letterSpacing: -0.4, lineHeight: 32 },
  wideSubtitle: { fontSize: 14, fontWeight: '600', marginTop: 4 },
  wideFormFields: { marginTop: 28, marginBottom: 18 },
});
