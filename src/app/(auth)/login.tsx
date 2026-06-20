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

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSignIn() {
    if (!email.trim() || !password) {
      setError('Completează email-ul și parola.');
      return;
    }
    setLoading(true);
    setError('');
    const err = await signIn(email.trim(), password);
    if (err) setError(err);
    setLoading(false);
    // Redirecționarea e gestionată de _layout.tsx pe baza sesiunii
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
            <ThemedText themeColor="textSecondary">Autentifică-te în cont</ThemedText>
          </View>

          <View style={styles.form}>
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
              placeholder="••••••••"
              secureTextEntry
            />

            {error ? (
              <ThemedText style={styles.error}>{error}</ThemedText>
            ) : null}

            <Button title="Autentifică-te" onPress={handleSignIn} loading={loading} />
          </View>

          <View style={styles.footer}>
            <ThemedText themeColor="textSecondary">Nu ai cont?</ThemedText>
            <Link href="/(auth)/register" asChild>
              <Pressable>
                <ThemedText style={styles.link}>Înregistrează-te</ThemedText>
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
});
