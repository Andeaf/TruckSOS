import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { AdminRefreshButton } from '@/components/admin/refresh-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Shadows, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useWideLayout } from '@/components/web-sidebar';
import {
  adminUpdateProfile,
  banUser,
  fetchUserDetail,
  searchUsers,
  unbanUser,
  type AdminUserDetail,
  type AdminUserRow,
} from '@/hooks/use-admin';
import { isBanned } from '@/lib/ban';
import { isValidPhone, isValidVat, normalizePhone, normalizeVat } from '@/lib/profile-validation';

/** Locale explicit: altfel formatul urmează regiunea dispozitivului, nu limba aplicației. */
const LOCALE_MAP: Record<string, string> = { ro: 'ro-RO', en: 'en-GB', de: 'de-DE' };

export default function AdminUsers() {
  const { t } = useTranslation();
  const theme = useTheme();
  // Design 10d: pe web lat — titlu + căutare constrânsă pe același rând și
  // empty state cu conținut în locul textului simplu.
  const wide = useWideLayout();
  const { uid } = useLocalSearchParams<{ uid?: string }>();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AdminUserRow[]>([]);
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);

  const openDetail = useCallback((id: string) => {
    fetchUserDetail(id).then(({ data }) => setDetail(data));
  }, []);

  // Deschidere din tab-ul Rapoarte („Vezi utilizatorul").
  useEffect(() => {
    if (uid) openDetail(uid);
  }, [uid, openDetail]);

  // Sugestii live: debounce 300ms de la 2 caractere. Flag-ul `active` aruncă
  // răspunsurile sosite după ce query-ul s-a schimbat (out-of-order).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      searchUsers(q).then(({ data }) => {
        if (active) setResults(data);
      });
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  // Reîncărcare la cerere (15 sept): re-rulează căutarea curentă (lista există doar de
  // la 2 caractere). Spinner DOAR la gestul de tragere (vezi nota din Conținut).
  const reload = useCallback(async () => {
    const q = query.trim();
    if (q.length < 2) return;
    const { data } = await searchUsers(q);
    setResults(data);
  }, [query]);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const onPullRefresh = useCallback(async () => {
    setPullRefreshing(true);
    await reload();
    setPullRefreshing(false);
  }, [reload]);

  return (
    <ThemedView style={{ flex: 1 }}>
      {wide ? (
        <View style={w.headRow}>
          <ThemedText style={w.pageTitle}>{t('admin.users.title')}</ThemedText>
          <View style={[w.searchPill, { backgroundColor: theme.backgroundElement }]}>
            <Feather name="search" size={15} color={theme.textTertiary} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('admin.users.searchPlaceholder')}
              placeholderTextColor={theme.textTertiary}
              autoCapitalize="none"
              returnKeyType="search"
              style={[w.searchInput, { color: theme.text }]}
            />
          </View>
          <AdminRefreshButton onPress={reload} />
        </View>
      ) : (
        <>
          <ScreenHeader
            title={t('admin.users.title')}
            right={<AdminRefreshButton onPress={reload} onHeader />}
          />
          <View style={styles.searchRow}>
            <Input
              label={t('admin.users.searchLabel')}
              value={query}
              onChangeText={setQuery}
              placeholder={t('admin.users.searchPlaceholder')}
              autoCapitalize="none"
              returnKeyType="search"
            />
          </View>
        </>
      )}

      <FlatList
        data={results}
        keyExtractor={(u) => u.id}
        refreshing={pullRefreshing}
        onRefresh={onPullRefresh}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.list, wide && w.list]}
        ListEmptyComponent={
          wide ? (
            <View style={w.emptyWrap}>
              <View style={[w.emptyIcon, { backgroundColor: theme.brandSoft }]}>
                <Feather name="search" size={30} color={theme.brand} />
              </View>
              <ThemedText style={w.emptyTitle}>
                {query.trim().length < 2 ? t('admin.users.emptyTitle') : t('admin.users.noResults')}
              </ThemedText>
              {query.trim().length < 2 ? (
                <ThemedText themeColor="textTertiary" style={w.emptyHint}>
                  {t('admin.users.emptyHint')}
                </ThemedText>
              ) : null}
            </View>
          ) : (
            <ThemedText themeColor="textSecondary" style={styles.empty}>
              {query.trim().length < 2 ? t('admin.users.empty') : t('admin.users.noResults')}
            </ThemedText>
          )
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => openDetail(item.id)}>
            <UserRow user={item} />
          </Pressable>
        )}
      />

      <UserDetailModal
        detail={detail}
        onClose={() => setDetail(null)}
        onChanged={() => detail && openDetail(detail.id)}
      />
    </ThemedView>
  );
}

function UserRow({ user }: { user: AdminUserRow }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const banned = isBanned(user);
  return (
    <View style={[styles.userRow, { backgroundColor: theme.backgroundElement }]}>
      <View style={{ flex: 1 }}>
        <ThemedText style={styles.userName}>{user.full_name || t('common.deletedUser')}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {user.email} · {t(`admin.users.role_${user.role}`)}
        </ThemedText>
      </View>
      {user.deleted_at ? (
        <Badge label={t('admin.users.statusDeleted')} color="#9ca3af" />
      ) : banned ? (
        <Badge label={t('admin.users.statusBanned')} color="#ef4444" />
      ) : (
        <Badge label={t('admin.users.statusActive')} color="#22c55e" />
      )}
    </View>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: color }]}>
      <ThemedText type="small" style={styles.badgeText}>
        {label}
      </ThemedText>
    </View>
  );
}

function UserDetailModal({
  detail,
  onClose,
  onChanged,
}: {
  detail: AdminUserDetail | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const [banOpen, setBanOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const banned = isBanned(detail);

  function doUnban() {
    if (!detail) return;
    unbanUser(detail.id).then((err) => {
      if (err) Alert.alert(t('admin.common.error'), err);
      else onChanged();
    });
  }

  return (
    <Modal visible={detail !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.modal, { backgroundColor: theme.background }]} onPress={() => {}}>
          {detail ? (
            <>
              <ThemedText type="subtitle" style={styles.modalName}>
                {detail.full_name || t('common.deletedUser')}
              </ThemedText>
              <Field label={t('admin.users.email')} value={detail.email} />
              <Field label={t('admin.users.roleLabel')} value={t(`admin.users.role_${detail.role}`)} />
              <Field
                label={t('admin.users.registered')}
                value={new Date(detail.registered_at).toLocaleDateString(
                  LOCALE_MAP[i18n.language] ?? 'ro-RO',
                )}
              />
              <Field
                label={t('admin.users.rating')}
                value={`${detail.rating_avg} (${detail.rating_count})`}
              />
              <Field label={t('admin.users.announcements')} value={String(detail.announcements_count)} />
              <Field label={t('admin.users.applications')} value={String(detail.applications_count)} />
              <Field label={t('admin.users.reportsReceived')} value={String(detail.reports_received)} />
              <Field label={t('admin.users.reportsMade')} value={String(detail.reports_made)} />
              <Field label={t('profile.phoneLabel')} value={detail.phone} />
              <Field label={t('profile.addressLabel')} value={detail.address} />
              <Field label={t('profile.vatLabel')} value={detail.vat_number} />
              {banned ? (
                <Field label={t('admin.users.banReasonLabel')} value={detail.ban_reason} highlight />
              ) : null}

              <View style={styles.detailActions}>
                {/* F18.5: editarea datelor de profil (whitelist server-side). Nu pe conturi șterse. */}
                {detail.deleted_at ? null : (
                  <Button
                    title={t('profile.editTitle')}
                    onPress={() => setEditOpen(true)}
                    variant="secondary"
                  />
                )}
                {banned ? (
                  <Button title={t('admin.users.unban')} onPress={doUnban} variant="secondary" />
                ) : detail.deleted_at ? null : (
                  <Button title={t('admin.users.ban')} onPress={() => setBanOpen(true)} variant="danger" />
                )}
                <Button title={t('admin.common.close')} onPress={onClose} variant="secondary" />
              </View>

              <EditProfileModal
                visible={editOpen}
                detail={detail}
                onClose={() => setEditOpen(false)}
                onDone={() => {
                  setEditOpen(false);
                  onChanged();
                }}
              />

              <BanModal
                visible={banOpen}
                userId={detail.id}
                onClose={() => setBanOpen(false)}
                onDone={() => {
                  setBanOpen(false);
                  onChanged();
                }}
              />
            </>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Field({ label, value, highlight }: { label: string; value?: string | null; highlight?: boolean }) {
  return (
    <View style={styles.field}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText style={highlight ? { color: '#ef4444', fontWeight: '600' } : undefined}>
        {value || '—'}
      </ThemedText>
    </View>
  );
}

function BanModal({
  visible,
  userId,
  onClose,
  onDone,
}: {
  visible: boolean;
  userId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [reason, setReason] = useState('');
  const [days, setDays] = useState<number | null>(null); // null = permanent
  const [saving, setSaving] = useState(false);

  const DURATIONS: { label: string; value: number | null }[] = [
    { label: t('admin.users.banPermanent'), value: null },
    { label: t('admin.users.banDays7'), value: 7 },
    { label: t('admin.users.banDays30'), value: 30 },
  ];

  function submit() {
    if (!reason.trim()) {
      Alert.alert(t('admin.users.banReasonRequired'));
      return;
    }
    setSaving(true);
    const until = days ? new Date(Date.now() + days * 86400000).toISOString() : null;
    banUser(userId, reason.trim(), until).then((err) => {
      setSaving(false);
      if (err) Alert.alert(t('admin.common.error'), err);
      else {
        setReason('');
        setDays(null);
        onDone();
      }
    });
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* Modalul e centrat vertical: pe iOS, fără KAV, tastatura ar acoperi butonul de
          confirmare (PLAN_FAZA17.md K3). KAV-ul e la rădăcina Modalului (y=0) → fără offset. */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.modal, { backgroundColor: theme.background }]} onPress={() => {}}>
          <ThemedText type="subtitle" style={styles.modalName}>
            {t('admin.users.ban')}
          </ThemedText>
          <Input
            label={t('admin.users.banReasonLabel')}
            value={reason}
            onChangeText={setReason}
            placeholder={t('admin.users.banReasonPlaceholder')}
          />
          <ThemedText type="small" themeColor="textSecondary">
            {t('admin.users.banDuration')}
          </ThemedText>
          <View style={styles.durations}>
            {DURATIONS.map((d) => {
              const active = d.value === days;
              return (
                <Pressable
                  key={String(d.value)}
                  onPress={() => setDays(d.value)}
                  style={[
                    styles.chip,
                    { borderColor: active ? '#ef4444' : theme.textSecondary },
                    active && { backgroundColor: '#ef4444' },
                  ]}>
                  <ThemedText type="small" style={active ? { color: '#fff' } : undefined}>
                    {d.label}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
          <Button title={t('admin.users.banConfirm')} onPress={submit} variant="danger" loading={saving} />
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <ThemedText style={{ color: '#6366f1' }}>{t('admin.common.cancel')}</ThemedText>
          </Pressable>
        </Pressable>
      </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * F18.5: formularul admin de editare a profilului. Aceleași validări ca în
 * formularele utilizatorului (profile-validation) — inclusiv obligativitatea pe
 * rol; whitelist-ul e impus ORICUM server-side (admin_update_profile respinge
 * zgomotos orice cheie nepermisă), formularul doar nu-i dă ocazia.
 */
function EditProfileModal({
  visible,
  detail,
  onClose,
  onDone,
}: {
  visible: boolean;
  detail: AdminUserDetail;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const isMechanic = detail.role === 'mechanic';
  const [fullName, setFullName] = useState(detail.full_name ?? '');
  const [phone, setPhone] = useState(detail.phone ?? '');
  const [address, setAddress] = useState(detail.address ?? '');
  const [vatNumber, setVatNumber] = useState(detail.vat_number ?? '');
  const [companyName, setCompanyName] = useState(detail.company_name ?? '');
  const [contactEmail, setContactEmail] = useState(detail.contact_email ?? '');
  const [specialization, setSpecialization] = useState(detail.specialization ?? '');
  const [activityZone, setActivityZone] = useState(detail.activity_zone ?? '');
  const [saving, setSaving] = useState(false);

  function submit() {
    if (!fullName.trim()) {
      Alert.alert(t('profile.errorNameRequired'));
      return;
    }
    if (!phone.trim()) {
      Alert.alert(t('profile.errorPhoneRequired'));
      return;
    }
    if (!isValidPhone(phone)) {
      Alert.alert(t('profile.errorPhoneInvalid'));
      return;
    }
    // Adresă + TVA: OPȚIONALE la toate rolurile (2 sept 2026 — vezi role-select).
    const vat = normalizeVat(vatNumber);
    if (vat && !isValidVat(vatNumber)) {
      Alert.alert(t('profile.errorVatInvalid'));
      return;
    }
    const email = contactEmail.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      Alert.alert(t('profile.errorEmailInvalid'));
      return;
    }

    setSaving(true);
    adminUpdateProfile(detail.id, {
      full_name: fullName.trim(),
      phone: normalizePhone(phone),
      address: address.trim() || null,
      vat_number: vat || null,
      company_name: companyName.trim() || null,
      contact_email: email || null,
      ...(isMechanic
        ? {
            specialization: specialization.trim() || null,
            activity_zone: activityZone.trim() || null,
          }
        : {}),
    }).then((err) => {
      setSaving(false);
      if (err) Alert.alert(t('admin.common.error'), err);
      else onDone();
    });
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* KAV la rădăcina Modalului, ca la BanModal (PLAN_FAZA17.md K3). */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={[styles.modal, { backgroundColor: theme.background }]} onPress={() => {}}>
            <ThemedText type="subtitle" style={styles.modalName}>
              {t('profile.editTitle')}
            </ThemedText>
            <ScrollView
              contentContainerStyle={styles.editForm}
              keyboardShouldPersistTaps="handled">
              <Input label={t('profile.nameLabel')} value={fullName} onChangeText={setFullName} required />
              <Input
                label={t('profile.phoneLabel')}
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                required
              />
              <Input
                label={t('profile.addressLabel')}
                value={address}
                onChangeText={setAddress}
                autoCapitalize="sentences"
              />
              <Input
                label={t('profile.vatLabel')}
                value={vatNumber}
                onChangeText={setVatNumber}
                autoCapitalize="characters"
                autoCorrect={false}
              />
              <Input
                label={t('profile.companyLabel')}
                value={companyName}
                onChangeText={setCompanyName}
                autoCapitalize="words"
              />
              <Input
                label={t('profile.emailLabel')}
                value={contactEmail}
                onChangeText={setContactEmail}
                keyboardType="email-address"
                autoCorrect={false}
              />
              {isMechanic ? (
                <>
                  <Input
                    label={t('profile.specializationLabel')}
                    value={specialization}
                    onChangeText={setSpecialization}
                    autoCapitalize="sentences"
                  />
                  <Input
                    label={t('profile.activityZoneLabel')}
                    value={activityZone}
                    onChangeText={setActivityZone}
                    autoCapitalize="sentences"
                  />
                </>
              ) : null}
              <ThemedText themeColor="textSecondary" type="small" style={styles.requiredNote}>
                {t('common.requiredNote')}
              </ThemedText>
            </ScrollView>
            <Button title={t('profile.saveButton')} onPress={submit} loading={saving} />
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <ThemedText style={{ color: '#6366f1' }}>{t('admin.common.cancel')}</ThemedText>
            </Pressable>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  searchRow: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three, paddingBottom: Spacing.two },
  list: { padding: Spacing.three, gap: Spacing.two, flexGrow: 1 },
  empty: { textAlign: 'center', marginTop: Spacing.five },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.card,
  },
  userName: { fontWeight: '600' },
  badge: { paddingVertical: 2, paddingHorizontal: Spacing.two, borderRadius: Radius.badge },
  badgeText: { color: '#fff', fontSize: 12 },
  flex: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: Spacing.four },
  modal: { borderRadius: Radius.card, padding: Spacing.four, gap: Spacing.two, maxHeight: '85%' },
  modalName: { marginBottom: Spacing.two },
  field: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  detailActions: { gap: Spacing.two, marginTop: Spacing.three },
  durations: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  chip: { paddingVertical: Spacing.one, paddingHorizontal: Spacing.three, borderRadius: Radius.badge, borderWidth: 1 },
  closeBtn: { alignSelf: 'center', marginTop: Spacing.two, padding: Spacing.two },
  editForm: { gap: Spacing.two, paddingBottom: Spacing.two },
  requiredNote: { textAlign: 'center' },
});

/** Stilurile variantei late (design 10d). */
const w = StyleSheet.create({
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 28,
    paddingTop: 24,
    maxWidth: 1060,
    width: '100%',
    alignSelf: 'center',
  },
  pageTitle: { fontSize: 26, fontWeight: '800', letterSpacing: -0.4, lineHeight: 32 },
  searchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 16,
    width: 380,
    ...Shadows.chip,
  },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 5 },
  list: { maxWidth: 1060, width: '100%', alignSelf: 'center', paddingHorizontal: 28 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 120 },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { fontSize: 16, fontWeight: '700' },
  emptyHint: {
    fontSize: 13.5,
    fontWeight: '600',
    textAlign: 'center',
    maxWidth: 340,
    lineHeight: 20,
  },
});
