import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { AdminRefreshButton } from '@/components/admin/refresh-button';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useWideLayout } from '@/components/web-sidebar';
import { Radius, Spacing } from '@/constants/theme';
import { fetchClientErrors, type ClientErrorItem } from '@/hooks/use-admin';
import { useTheme } from '@/hooks/use-theme';

/**
 * Erorile client din ultimele 7 zile (1.1, faza 9.1; RPC admin_client_errors, migrarea 20261111000100).
 * Textul e deja curățat la trimitere și la server (fără e-mailuri, id-uri, telefoane, tokenuri); despre
 * utilizator există doar `user_hash` (nu se afișează). Stiva se deschide la apăsare și e selectabilă,
 * pentru `metro-symbolicate` cu sourcemap-ul build-ului. Deschis din cardul „Erori client” al Panoului.
 */

const LOCALE_MAP: Record<string, string> = { ro: 'ro-RO', en: 'en-GB', de: 'de-DE' };

export default function AdminClientErrors() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const wide = useWideLayout();
  const [items, setItems] = useState<ClientErrorItem[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [pullRefreshing, setPullRefreshing] = useState(false);

  const load = useCallback(async () => {
    const data = await fetchClientErrors();
    if (data) {
      setItems(data.items ?? []);
      setUnavailable(false);
    } else {
      setUnavailable(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const onPullRefresh = useCallback(async () => {
    setPullRefreshing(true);
    await load();
    setPullRefreshing(false);
  }, [load]);

  function goBack() {
    // Pe web, după reîncărcarea paginii, istoricul e gol.
    if (router.canGoBack()) router.back();
    else router.replace('/(admin)/dashboard' as never);
  }

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function fmtDate(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(LOCALE_MAP[i18n.language] ?? 'ro-RO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function renderItem({ item }: { item: ClientErrorItem }) {
    const open = expanded.has(item.id);
    const hasStack = !!item.stack;
    return (
      <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        <View style={styles.headRow}>
          <ThemedText style={styles.type} numberOfLines={2}>
            {item.error_type}
          </ThemedText>
          <ThemedText type="small" themeColor="textTertiary">
            {fmtDate(item.created_at)}
          </ThemedText>
        </View>
        <ThemedText type="small" themeColor="textSecondary" selectable>
          {t('admin.clientErrors.screen', { screen: item.screen ?? '—' })}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {t('admin.clientErrors.meta', {
            platform: item.platform,
            os: item.os_version ?? '—',
            build: item.app_build ?? '—',
          })}
        </ThemedText>
        {item.message ? <ThemedText selectable>{item.message}</ThemedText> : null}
        {hasStack ? (
          <Pressable
            onPress={() => toggle(item.id)}
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            accessibilityLabel={open ? t('admin.clientErrors.hideStack') : t('admin.clientErrors.showStack')}
            hitSlop={8}
            style={styles.stackToggle}>
            <Feather name={open ? 'chevron-up' : 'chevron-down'} size={16} color={theme.brand} />
            <ThemedText type="small" themeColor="brand">
              {open ? t('admin.clientErrors.hideStack') : t('admin.clientErrors.showStack')}
            </ThemedText>
          </Pressable>
        ) : null}
        {open && item.stack ? (
          <View style={[styles.stackBox, { backgroundColor: theme.neutralBg }]}>
            <ThemedText type="code" selectable style={styles.stackText}>
              {item.stack}
            </ThemedText>
          </View>
        ) : null}
      </View>
    );
  }

  const empty =
    items === null && !unavailable ? null : (
      <ThemedText themeColor="textSecondary" style={styles.empty}>
        {unavailable ? t('admin.clientErrors.unavailable') : t('admin.clientErrors.empty')}
      </ThemedText>
    );

  return (
    <ThemedView style={{ flex: 1 }}>
      {wide ? (
        <View style={w.headRow}>
          <Pressable
            onPress={goBack}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('admin.clientErrors.back')}>
            <Feather name="arrow-left" size={22} color={theme.text} />
          </Pressable>
          <ThemedText style={w.pageTitle}>{t('admin.clientErrors.listTitle')}</ThemedText>
          <View style={{ flex: 1 }} />
          <AdminRefreshButton onPress={() => void load()} />
        </View>
      ) : (
        <ScreenHeader
          title={t('admin.clientErrors.listTitle')}
          onBack={goBack}
          right={<AdminRefreshButton onPress={() => void load()} onHeader />}
        />
      )}
      <FlatList
        data={unavailable ? [] : (items ?? [])}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        extraData={expanded}
        ListEmptyComponent={empty}
        contentContainerStyle={[styles.list, wide && w.list]}
        refreshControl={
          <RefreshControl
            refreshing={pullRefreshing}
            onRefresh={onPullRefresh}
            tintColor={theme.brand}
            colors={[theme.brand]}
          />
        }
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing.three, gap: Spacing.three },
  card: { borderRadius: Radius.card, padding: Spacing.three, gap: Spacing.one },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: Spacing.two },
  type: { fontWeight: '700', flexShrink: 1 },
  stackToggle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.one },
  stackBox: { borderRadius: Radius.control, padding: Spacing.two },
  stackText: { fontSize: 12, lineHeight: 16 },
  empty: { textAlign: 'center', paddingVertical: Spacing.five },
});

/** Stilurile variantei late (ca în Curățare conturi). */
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
  list: { maxWidth: 1060, width: '100%', alignSelf: 'center', paddingHorizontal: 28 },
});
