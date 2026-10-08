import { useCallback, useRef, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { AdminRefreshButton } from '@/components/admin/refresh-button';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Shadows, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useWideLayout } from '@/components/web-sidebar';
import {
  adminDeleteMessage,
  fetchReportContext,
  fetchReportConversation,
  fetchReports,
  updateReportStatus,
  type AdminContextMessage,
  type AdminReport,
  type AdminReportConversation,
} from '@/hooks/use-admin';
import type { ReportStatus } from '@/types/database';

const FILTERS: (ReportStatus | 'all')[] = ['pending', 'reviewed', 'dismissed', 'all'];

/** Locale explicit: altfel formatul urmează regiunea dispozitivului, nu limba aplicației. */
const LOCALE_MAP: Record<string, string> = { ro: 'ro-RO', en: 'en-GB', de: 'de-DE' };

export default function AdminReports() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  // Design 10e: pe web lat — titlu în pagină, filtre pe pastile în stilul
  // aplicației (activ = navy plin) și empty state pozitiv.
  const wide = useWideLayout();
  const [filter, setFilter] = useState<ReportStatus | 'all'>('pending');
  const [reports, setReports] = useState<AdminReport[]>([]);
  // F18.6: pe lângă mesaje ținem și id-ul mesajului RAPORTAT — cu fereastra 25+25
  // el nu mai e reperabil vizual fără evidențiere + scroll pe poziție.
  const [context, setContext] = useState<{
    messages: AdminContextMessage[];
    reportedId: string;
  } | null>(null);
  // 7 aug: conversația raportor↔raportat, la rapoartele pe utilizator.
  const [conv, setConv] = useState<{
    report: AdminReport;
    conversations: AdminReportConversation[];
  } | null>(null);

  const load = useCallback(
    (f: ReportStatus | 'all') => fetchReports(f).then(({ data }) => setReports(data)),
    []
  );

  useFocusEffect(
    useCallback(() => {
      load(filter);
    }, [filter, load])
  );

  // Reîncărcare la cerere (15 sept): spinner-ul DOAR la gestul de tragere; butonul
  // din antet reîncarcă silențios (vezi nota din Conținut).
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const onPullRefresh = useCallback(async () => {
    setPullRefreshing(true);
    await load(filter);
    setPullRefreshing(false);
  }, [load, filter]);

  function setStatus(r: AdminReport, status: ReportStatus) {
    updateReportStatus(r.id, status).then((err) => {
      if (err) Alert.alert(t('admin.common.error'), err);
      else load(filter);
    });
  }

  function deleteMessage(r: AdminReport) {
    if (!r.message_id || !r.message_table) return;
    Alert.alert(t('admin.reports.actionDeleteMsg'), t('admin.reports.deleteMsgConfirm'), [
      { text: t('admin.common.cancel'), style: 'cancel' },
      {
        text: t('admin.common.delete'),
        style: 'destructive',
        onPress: () =>
          adminDeleteMessage(r.message_table!, r.message_id!).then((err) => {
            if (err) Alert.alert(t('admin.common.error'), err);
            else load(filter);
          }),
      },
    ]);
  }

  function viewContext(r: AdminReport) {
    if (!r.message_id || !r.message_table) return;
    fetchReportContext(r.message_table, r.message_id).then(({ data, error }) => {
      if (error) Alert.alert(t('admin.common.error'), error);
      else setContext({ messages: data, reportedId: r.message_id! });
    });
  }

  function viewConversation(r: AdminReport) {
    fetchReportConversation(r.id).then(({ data, error }) => {
      if (error) Alert.alert(t('admin.common.error'), error);
      else if (data.length === 0) Alert.alert(t('admin.reports.noConversation'));
      else setConv({ report: r, conversations: data });
    });
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      {wide ? (
        <View style={w.titleRow}>
          <ThemedText style={w.pageTitle}>{t('admin.reports.title')}</ThemedText>
          <AdminRefreshButton onPress={() => load(filter)} />
        </View>
      ) : (
        <ScreenHeader
          title={t('admin.reports.title')}
          right={<AdminRefreshButton onPress={() => load(filter)} onHeader />}
        />
      )}

      <View style={[styles.filters, wide && w.filters]}>
        {FILTERS.map((f) => {
          const active = f === filter;
          if (wide) {
            return (
              <Pressable
                key={f}
                onPress={() => setFilter(f)}
                style={[
                  w.chip,
                  active
                    ? { backgroundColor: theme.primary }
                    : [{ backgroundColor: theme.backgroundElement }, Shadows.chip],
                ]}>
                <ThemedText
                  type="small"
                  style={[w.chipText, active && { color: '#FFFFFF' }]}
                  themeColor={active ? undefined : 'textSecondary'}>
                  {t(`admin.reports.filter_${f}`)}
                </ThemedText>
              </Pressable>
            );
          }
          return (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              style={[
                styles.chip,
                { borderColor: active ? '#6366f1' : theme.textSecondary },
                active && { backgroundColor: '#6366f1' },
              ]}>
              <ThemedText
                type="small"
                style={active ? styles.chipTextActive : undefined}
                themeColor={active ? undefined : 'textSecondary'}>
                {t(`admin.reports.filter_${f}`)}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>

      <FlatList
        data={reports}
        keyExtractor={(r) => r.id}
        refreshing={pullRefreshing}
        onRefresh={onPullRefresh}
        contentContainerStyle={[styles.list, wide && w.list]}
        ListEmptyComponent={
          wide ? (
            <View style={w.emptyWrap}>
              <View style={[w.emptyIcon, { backgroundColor: theme.successBg }]}>
                <Feather name="check" size={30} color={theme.successText} />
              </View>
              <ThemedText style={w.emptyTitle}>
                {filter === 'pending' ? t('admin.reports.emptyTitlePending') : t('admin.reports.empty')}
              </ThemedText>
              <ThemedText themeColor="textTertiary" style={w.emptyHint}>
                {t('admin.reports.emptyHint')}
              </ThemedText>
            </View>
          ) : (
            <ThemedText themeColor="textSecondary" style={styles.empty}>
              {t('admin.reports.empty')}
            </ThemedText>
          )
        }
        renderItem={({ item }) => (
          <ReportCard
            report={item}
            onReview={() => setStatus(item, 'reviewed')}
            onDismiss={() => setStatus(item, 'dismissed')}
            onDeleteMsg={() => deleteMessage(item)}
            onContext={() => viewContext(item)}
            onConversation={() => viewConversation(item)}
            onUser={() => router.push({ pathname: '/(admin)/users', params: { uid: item.reported_user_id } })}
          />
        )}
      />

      <ContextModal context={context} onClose={() => setContext(null)} />
      <ConversationModal data={conv} onClose={() => setConv(null)} />
    </ThemedView>
  );
}

function ReportCard({
  report,
  onReview,
  onDismiss,
  onDeleteMsg,
  onContext,
  onConversation,
  onUser,
}: {
  report: AdminReport;
  onReview: () => void;
  onDismiss: () => void;
  onDeleteMsg: () => void;
  onContext: () => void;
  onConversation: () => void;
  onUser: () => void;
}) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const isMessage = !!report.message_id;

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
      <View style={styles.cardHead}>
        <ThemedText style={styles.reason}>{t(`admin.reports.reason_${report.reason}`)}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {new Date(report.created_at).toLocaleDateString(LOCALE_MAP[i18n.language] ?? 'ro-RO')}
        </ThemedText>
      </View>

      <ThemedText type="small" themeColor="textSecondary">
        {t('admin.reports.reporter')}: {report.reporter_name ?? '—'} → {report.reported_name ?? '—'}
      </ThemedText>

      {report.details ? <ThemedText style={styles.details}>{report.details}</ThemedText> : null}

      {report.content_snapshot ? (
        <View style={[styles.snapshot, { borderColor: theme.textSecondary }]}>
          <ThemedText type="small">“{report.content_snapshot}”</ThemedText>
        </View>
      ) : null}
      {report.image_path_snapshot ? (
        <ThemedText type="small" themeColor="textSecondary">
          📎 {t('admin.reports.hasImage')}
        </ThemedText>
      ) : null}

      <View style={styles.actions}>
        {report.status !== 'reviewed' ? (
          <ActionBtn label={t('admin.reports.actionReview')} onPress={onReview} />
        ) : null}
        {report.status !== 'dismissed' ? (
          <ActionBtn label={t('admin.reports.actionDismiss')} onPress={onDismiss} />
        ) : null}
        {isMessage ? (
          <>
            <ActionBtn label={t('admin.reports.actionViewContext')} onPress={onContext} />
            <ActionBtn label={t('admin.reports.actionDeleteMsg')} onPress={onDeleteMsg} danger />
          </>
        ) : (
          // Raport pe UTILIZATOR: fără mesaj de ancorat → conversația raportor↔raportat
          // (RPC mărginit + auditat; principiul din privacy policy §5).
          <ActionBtn label={t('admin.reports.actionViewConversation')} onPress={onConversation} />
        )}
        <ActionBtn label={t('admin.reports.actionViewUser')} onPress={onUser} />
      </View>
    </View>
  );
}

function ActionBtn({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.actionBtn, { borderColor: danger ? '#ef4444' : '#6366f1' }]}>
      <ThemedText type="small" style={{ color: danger ? '#ef4444' : theme.text }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function ContextModal({
  context,
  onClose,
}: {
  context: { messages: AdminContextMessage[]; reportedId: string } | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  // F18.6: fereastra e acum 25+25 → lista devine scrollabilă, mesajul raportat e
  // evidențiat și scroll-ul pornește centrat pe el (onLayout ne dă y-ul lui).
  const scrollRef = useRef<ScrollView>(null);
  const messages = context?.messages ?? null;
  return (
    <Modal visible={context !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.modal, { backgroundColor: theme.background }]} onPress={() => {}}>
          <ThemedText type="subtitle" style={styles.modalTitle}>
            {t('admin.reports.contextTitle')}
          </ThemedText>
          {messages && messages.length > 0 ? (
            <ScrollView ref={scrollRef} style={styles.ctxScroll}>
              {messages.map((m) => {
                const isReported = m.id === context?.reportedId;
                return (
                  <View
                    key={m.id}
                    onLayout={
                      isReported
                        ? (e) => {
                            const y = e.nativeEvent.layout.y;
                            scrollRef.current?.scrollTo({ y: Math.max(y - 120, 0), animated: false });
                          }
                        : undefined
                    }
                    style={[
                      styles.ctxRow,
                      { borderColor: theme.backgroundElement },
                      isReported && styles.ctxRowReported,
                    ]}>
                    <ThemedText type="small" themeColor="textSecondary">
                      {new Date(m.created_at).toLocaleTimeString(LOCALE_MAP[i18n.language] ?? 'ro-RO')}
                    </ThemedText>
                    <ThemedText>
                      {m.deleted_at
                        ? `[${t('chat.deletedMessage')}]`
                        : m.image_path
                          ? `[${t('chat.photo')}]`
                          : m.content}
                    </ThemedText>
                  </View>
                );
              })}
            </ScrollView>
          ) : (
            <ThemedText themeColor="textSecondary">{t('admin.reports.contextEmpty')}</ThemedText>
          )}
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <ThemedText style={{ color: '#6366f1' }}>{t('admin.common.close')}</ThemedText>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * Conversațiile raportor↔raportat (7 aug): secțiune per conversație (tip + dată),
 * mesajele RAPORTATULUI evidențiate cu tenta indigo (pe ele se uită adminul).
 */
function ConversationModal({
  data,
  onClose,
}: {
  data: { report: AdminReport; conversations: AdminReportConversation[] } | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const locale = LOCALE_MAP[i18n.language] ?? 'ro-RO';
  return (
    <Modal visible={data !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.modal, { backgroundColor: theme.background }]} onPress={() => {}}>
          <ThemedText type="subtitle" style={styles.modalTitle}>
            {t('admin.reports.conversationTitle')}
          </ThemedText>
          {data ? (
            <ScrollView style={styles.ctxScroll}>
              {data.conversations.map((c) => (
                <View key={c.conversation_id} style={styles.convSection}>
                  <ThemedText type="smallBold" style={styles.convHead}>
                    {t(`admin.reports.convKind_${c.kind}`)} ·{' '}
                    {new Date(c.created_at).toLocaleDateString(locale)}
                  </ThemedText>
                  {c.messages.map((m) => {
                    const isReported = m.sender_id === data.report.reported_user_id;
                    const senderName = isReported
                      ? data.report.reported_name
                      : data.report.reporter_name;
                    return (
                      <View
                        key={m.id}
                        style={[
                          styles.ctxRow,
                          { borderColor: theme.backgroundElement },
                          isReported && styles.ctxRowReported,
                        ]}>
                        <ThemedText type="small" themeColor="textSecondary">
                          {senderName ?? '—'} · {new Date(m.created_at).toLocaleString(locale)}
                        </ThemedText>
                        <ThemedText>
                          {m.deleted_at
                            ? `[${t('chat.deletedMessage')}]`
                            : m.image_path
                              ? `[${t('chat.photo')}]`
                              : m.file_name
                                ? `📎 ${m.file_name}`
                                : m.content || t('admin.reports.attachmentOnly')}
                        </ThemedText>
                      </View>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          ) : null}
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <ThemedText style={{ color: '#6366f1' }}>{t('admin.common.close')}</ThemedText>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', gap: Spacing.two, padding: Spacing.three, flexWrap: 'wrap' },
  chip: { paddingVertical: Spacing.one, paddingHorizontal: Spacing.three, borderRadius: Radius.badge, borderWidth: 1 },
  chipTextActive: { color: '#fff' },
  list: { padding: Spacing.three, gap: Spacing.three, flexGrow: 1 },
  empty: { textAlign: 'center', marginTop: Spacing.five },
  card: { borderRadius: Radius.card, padding: Spacing.three, gap: Spacing.two },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  reason: { fontWeight: '700', textTransform: 'capitalize' },
  details: { marginTop: Spacing.one },
  snapshot: { borderLeftWidth: 3, paddingLeft: Spacing.two, paddingVertical: Spacing.one },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.two },
  actionBtn: { borderWidth: 1, borderRadius: Radius.control, paddingVertical: Spacing.one, paddingHorizontal: Spacing.two },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: Spacing.four },
  modal: { borderRadius: Radius.card, padding: Spacing.four, gap: Spacing.two, maxHeight: '80%' },
  modalTitle: { marginBottom: Spacing.two },
  ctxRow: { gap: 2, paddingVertical: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth },
  ctxScroll: { flexGrow: 0 },
  // Evidențierea mesajului raportat: tentă indigo (accentul admin) + bară laterală.
  ctxRowReported: {
    backgroundColor: '#6366f11A',
    borderLeftWidth: 3,
    borderLeftColor: '#6366f1',
    paddingLeft: Spacing.two,
  },
  closeBtn: { alignSelf: 'flex-end', marginTop: Spacing.two, padding: Spacing.two },
  convSection: { marginBottom: Spacing.three },
  convHead: { marginBottom: Spacing.one, textTransform: 'uppercase', letterSpacing: 0.5 },
});

/** Stilurile variantei late (design 10e). */
const w = StyleSheet.create({
  // Titlul + butonul „Reîncarcă" pe același rând (15 sept); layout-ul de pagină
  // (padding/lățime) s-a mutat de pe text pe rând.
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    paddingTop: 24,
    maxWidth: 1060,
    width: '100%',
    alignSelf: 'center',
  },
  pageTitle: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.4,
    lineHeight: 32,
  },
  filters: {
    paddingHorizontal: 28,
    paddingTop: 16,
    gap: 8,
    maxWidth: 1060,
    width: '100%',
    alignSelf: 'center',
  },
  chip: { borderRadius: 999, paddingVertical: 7, paddingHorizontal: 16 },
  chipText: { fontSize: 13, fontWeight: '600' },
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
