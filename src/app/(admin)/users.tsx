import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  banUser,
  fetchUserDetail,
  searchUsers,
  unbanUser,
  type AdminUserDetail,
  type AdminUserRow,
} from '@/hooks/use-admin';
import { isBanned } from '@/lib/ban';

/** Locale explicit: altfel formatul urmează regiunea dispozitivului, nu limba aplicației. */
const LOCALE_MAP: Record<string, string> = { ro: 'ro-RO', en: 'en-GB', de: 'de-DE' };

export default function AdminUsers() {
  const { t } = useTranslation();
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

  return (
    <ThemedView style={{ flex: 1 }}>
      <ScreenHeader title={t('admin.users.title')} />

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

      <FlatList
        data={results}
        keyExtractor={(u) => u.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <ThemedText themeColor="textSecondary" style={styles.empty}>
            {query.trim().length < 2 ? t('admin.users.empty') : t('admin.users.noResults')}
          </ThemedText>
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
              {banned ? (
                <Field label={t('admin.users.banReasonLabel')} value={detail.ban_reason} highlight />
              ) : null}

              <View style={styles.detailActions}>
                {banned ? (
                  <Button title={t('admin.users.unban')} onPress={doUnban} variant="secondary" />
                ) : detail.deleted_at ? null : (
                  <Button title={t('admin.users.ban')} onPress={() => setBanOpen(true)} variant="danger" />
                )}
                <Button title={t('admin.common.close')} onPress={onClose} variant="secondary" />
              </View>

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
});
