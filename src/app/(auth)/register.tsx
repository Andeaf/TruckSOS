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

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';

export default function RegisterScreen() {
  const { signUp } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  async function handleSignUp() {
    if (!fullName.trim() || !email.trim() || !password) {
      setError('Completează toate câmpurile.');
      return;
    }
    if (password.length < 6) {
      setError('Parola trebuie să aibă cel puțin 6 caractere.');
      return;
    }
    setLoading(true);
    setError('');
    const err = await signUp(email.trim(), password, fullName.trim());
    setLoading(false);
    if (err) {
      setError(err);
    } else {
      // Dacă sesiunea nu apare în 2s, înseamnă că e nevoie de confirmare email
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
            <ThemedText type="title">TruckSOS</ThemedText>
            <ThemedText themeColor="textSecondary">Creează-ți contul</ThemedText>
          </View>

          {emailSent ? (
            <View style={styles.emailSentBox}>
              <ThemedText type="subtitle" style={styles.emailSentTitle}>Verifică email-ul</ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.emailSentDesc}>
                Am trimis un link de confirmare la{'\n'}
                <ThemedText style={styles.emailBold}>{email}</ThemedText>
                {'\n\n'}Apasă linkul din email, apoi întoarce-te și autentifică-te.
              </ThemedText>
              <Link href="/(auth)/login" asChild>
                <Pressable>
                  <ThemedText style={styles.link}>Mergi la autentificare</ThemedText>
                </Pressable>
              </Link>
            </View>
          ) : null}

          <View style={[styles.form, emailSent && styles.hidden]}>
            <Input
              label="Nume complet"
              value={fullName}
              onChangeText={setFullName}
              placeholder="Ion Popescu"
              autoCapitalize="words"
              autoComplete="name"
            />
            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="email@exemplu.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />
            <Input
              label="Parolă"
              value={password}
              onChangeText={setPassword}
              placeholder="Minim 6 caractere"
              secureTextEntry
            />

            {error ? (
              <ThemedText style={styles.error}>{error}</ThemedText>
            ) : null}

            <Button title="Înregistrează-te" onPress={handleSignUp} loading={loading} />
          </View>

          <View style={styles.footer}>
            <ThemedText themeColor="textSecondary">Ai deja cont?</ThemedText>
            <Link href="/(auth)/login" asChild>
              <Pressable>
                <ThemedText style={styles.link}>Autentifică-te</ThemedText>
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
  link: { color: '#208AEF', fontWeight: '600', fontSize: 16 },
  hidden: { display: 'none' },
  emailSentBox: {
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.four,
  },
  emailSentTitle: { fontSize: 24, lineHeight: 32 },
  emailSentDesc: { textAlign: 'center', lineHeight: 22 },
  emailBold: { fontWeight: '700', color: '#208AEF' },
});
