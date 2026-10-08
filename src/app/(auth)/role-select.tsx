import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { isValidPhone, isValidVat, normalizePhone, normalizeVat } from '@/lib/profile-validation';

type PickedRole = 'driver' | 'mechanic';

const ROLE_META: Record<PickedRole, { color: string; icon: 'local-shipping' | 'build' }> = {
  driver: { color: '#164F9E', icon: 'local-shipping' },
  mechanic: { color: '#22c55e', icon: 'build' },
};

/**
 * Alegerea rolului + pasul de date obligatorii (Faza 18.4), în ACELAȘI ecran:
 * profilul se creează abia după ce datele cerute rolului sunt completate —
 * telefon la ambele roluri; adresă + TVA doar la mecanici (prestatori).
 * Fără ecran nou: cardurile aleg rolul, apoi apare formularul (varianta preferată
 * din PLAN_FAZA18 §4.2/§9.4).
 */
export default function RoleSelectScreen() {
  const { createProfile, session } = useAuth();
  const { t } = useTranslation();
  const theme = useTheme();
  const [role, setRole] = useState<PickedRole | null>(null);
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [vatNumber, setVatNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Numele din metadata: pus la înregistrare sau de Google (`full_name`/`name`). Apple îl
  // poate ascunde (6 oct) → când lipsește, îl cerem aici; câmpul apare DOAR în cazul ăsta.
  const userMeta = session?.user.user_metadata ?? {};
  const metaName = (
    (userMeta.full_name as string | undefined) ??
    (userMeta.name as string | undefined) ??
    ''
  ).trim();
  const [fullName, setFullName] = useState(metaName);
  const name = metaName ? metaName.split(' ')[0] : t('common.defaultUser');

  async function handleContinue() {
    if (!role) return;
    if (!metaName && !fullName.trim()) {
      setError(t('auth.register.errorEmpty'));
      return;
    }
    if (!phone.trim()) {
      setError(t('profile.errorPhoneRequired'));
      return;
    }
    if (!isValidPhone(phone)) {
      setError(t('profile.errorPhoneInvalid'));
      return;
    }
    // 2 sept 2026: adresa și TVA/CUI sunt OPȚIONALE și la mecanici — mulți lucrează
    // fără formă juridică și rămâneau blocați la înregistrare. Doar telefonul e
    // obligatoriu (contactul e funcția centrală a aplicației). Formatul TVA se
    // verifică în continuare oriunde e completat.
    const vat = normalizeVat(vatNumber);
    if (vat && !isValidVat(vatNumber)) {
      setError(t('profile.errorVatInvalid'));
      return;
    }

    setLoading(true);
    setError('');
    const err = await createProfile(role, {
      phone: normalizePhone(phone),
      address: address.trim() || null,
      vat_number: vat || null,
      full_name: metaName ? null : fullName.trim(),
    });
    if (err) {
      setError(err);
      setLoading(false);
    }
    // Pe succes, _layout.tsx redirecționează automat la home-ul rolului
  }

  function renderRoleCard(cardRole: PickedRole) {
    const meta = ROLE_META[cardRole];
    return (
      <Pressable
        style={({ pressed }) => [
          styles.card,
          { borderColor: meta.color, backgroundColor: theme.backgroundElement },
          pressed && styles.cardPressed,
        ]}
        onPress={() => {
          setRole(cardRole);
          setError('');
        }}
        disabled={loading}>
        <MaterialIcons name={meta.icon} size={48} color={meta.color} />
        <ThemedText type="subtitle" style={styles.cardTitle}>
          {t(`auth.roleSelect.${cardRole}Title`)}
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.cardDesc}>
          {t(`auth.roleSelect.${cardRole}Description`)}
        </ThemedText>
      </Pressable>
    );
  }

  // Pasul 1: alegerea rolului (cardurile de dinainte, dar aleg — nu creează).
  if (!role) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.header}>
          <ThemedText type="title">{t('auth.roleSelect.title')}</ThemedText>
          <ThemedText type="title">{name}!</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.subtitle}>
            {t('auth.roleSelect.subtitle')}
          </ThemedText>
        </View>

        <View style={styles.cards}>
          {renderRoleCard('driver')}
          {renderRoleCard('mechanic')}
        </View>
      </ThemedView>
    );
  }

  // Pasul 2: datele obligatorii pentru rolul ales.
  const meta = ROLE_META[role];
  return (
    <ThemedView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={styles.formContent}
          keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <ThemedText type="title">{t('auth.roleSelect.detailsTitle')}</ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.subtitle}>
              {role === 'mechanic'
                ? t('auth.roleSelect.detailsSubtitleMechanic')
                : t('auth.roleSelect.detailsSubtitleDriver')}
            </ThemedText>
          </View>

          {/* Rolul ales, cu ieșire înapoi la pasul 1. */}
          <View style={[styles.roleChip, { backgroundColor: theme.backgroundElement }]}>
            <MaterialIcons name={meta.icon} size={20} color={meta.color} />
            <ThemedText type="smallBold" style={styles.roleChipLabel}>
              {t(`auth.roleSelect.${role}Title`)}
            </ThemedText>
            <Pressable onPress={() => setRole(null)} disabled={loading} hitSlop={8}>
              <ThemedText type="small" style={{ color: meta.color, fontWeight: '700' }}>
                {t('auth.roleSelect.changeRole')}
              </ThemedText>
            </Pressable>
          </View>

          {!metaName ? (
            <Input
              label={t('auth.register.nameLabel')}
              value={fullName}
              onChangeText={setFullName}
              placeholder={t('auth.register.namePlaceholder')}
              autoCapitalize="words"
              autoComplete="name"
              required
            />
          ) : null}

          <Input
            label={t('profile.phoneLabel')}
            value={phone}
            onChangeText={setPhone}
            placeholder={t('profile.phonePlaceholder')}
            keyboardType="phone-pad"
            required
          />

          {role === 'mechanic' ? (
            <>
              <Input
                label={t('profile.addressLabel')}
                value={address}
                onChangeText={setAddress}
                placeholder={t('profile.addressPlaceholder')}
                autoCapitalize="sentences"
              />
              <Input
                label={t('profile.vatLabel')}
                value={vatNumber}
                onChangeText={setVatNumber}
                placeholder={t('profile.vatPlaceholder')}
                autoCapitalize="characters"
                autoCorrect={false}
              />
              <ThemedText themeColor="textSecondary" type="small">
                {t('auth.roleSelect.mechanicFieldsHint')}
              </ThemedText>
            </>
          ) : null}

          {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}

          <Button
            title={t('auth.roleSelect.continueButton')}
            onPress={handleContinue}
            loading={loading}
          />

          <ThemedText themeColor="textSecondary" type="small" style={styles.requiredNote}>
            {t('common.requiredNote')}
          </ThemedText>
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.five,
  },
  flex: { flex: 1 },
  header: {
    alignItems: 'center',
    gap: Spacing.one,
  },
  subtitle: {
    textAlign: 'center',
    marginTop: Spacing.two,
  },
  cards: { gap: Spacing.three },
  card: {
    borderRadius: Radius.card,
    borderWidth: 2,
    padding: Spacing.four,
    alignItems: 'center',
    gap: Spacing.two,
  },
  cardPressed: { opacity: 0.65 },
  cardTitle: { fontSize: 24, lineHeight: 32 },
  cardDesc: { textAlign: 'center', fontSize: 14 },
  formContent: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.four,
  },
  roleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.card,
  },
  roleChipLabel: { flex: 1 },
  error: { color: '#ef4444', textAlign: 'center' },
  requiredNote: { textAlign: 'center' },
});
