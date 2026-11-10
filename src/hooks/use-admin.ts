import { translateDbError } from '@/lib/db-errors';
import { supabase } from '@/lib/supabase';
import type { AnnouncementStatus, ReportReason, ReportStatus } from '@/types/database';
import type { Database } from '@/types/database-overrides';

/**
 * Stratul de date admin (Faza 16). Toate trec prin RPC-uri SECURITY DEFINER care încep cu
 * `IF NOT is_admin() THEN RAISE 'not_admin'` — deci un cont normal nu poate executa nimic
 * de aici, nici cunoscând endpoint-ul. Cast `as never` = convenția repo pentru rpc tipat.
 */

export interface AdminReport {
  id: string;
  reason: ReportReason;
  details: string | null;
  content_snapshot: string | null;
  image_path_snapshot: string | null;
  message_id: string | null;
  message_table: 'messages' | 'channel_messages' | null;
  status: ReportStatus;
  created_at: string;
  reporter_id: string;
  reporter_name: string | null;
  reported_user_id: string;
  reported_name: string | null;
  reported_banned_at: string | null;
}

export interface AdminUserRow {
  id: string;
  full_name: string;
  role: string;
  avatar_path: string | null;
  deleted_at: string | null;
  banned_at: string | null;
  banned_until: string | null;
  email: string | null;
}

export interface AdminUserDetail extends AdminUserRow {
  specialization: string | null;
  activity_zone: string | null;
  company_name: string | null;
  contact_email: string | null;
  /** Faza 18.1: prezente în admin_user_detail (phone — necesar formularului F18.5). */
  address: string | null;
  vat_number: string | null;
  phone: string | null;
  rating_avg: number;
  rating_count: number;
  ban_reason: string | null;
  registered_at: string;
  announcements_count: number;
  applications_count: number;
  reports_received: number;
  reports_made: number;
}

export interface AdminAnnouncement {
  id: string;
  description: string;
  location: string;
  status: string;
  created_at: string;
  driver_id: string;
  driver_name: string | null;
  photo_count: number;
  /** 24 sept: utilizatori diferiți care au deschis detaliul (fără autor și admini).
   *  Lipsește cât timp migrarea 20260924_announcement_views nu e rulată. */
  view_count?: number;
}

/** Faza 19: anunț de market în moderare (admin_list_recent_listings). */
export interface AdminListing {
  id: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  category: string;
  status: string;
  created_at: string;
  seller_id: string;
  seller_name: string | null;
  photo_count: number;
}

export interface AdminReview {
  id: string;
  stars: number;
  comment: string | null;
  created_at: string;
  mechanic_id: string;
  mechanic_name: string | null;
  driver_id: string;
  driver_name: string | null;
}

export interface AdminChannelMessage {
  id: string;
  content: string;
  image_path: string | null;
  deleted_at: string | null;
  deleted_by_admin: boolean;
  created_at: string;
  sender_id: string;
  sender_name: string | null;
}

export interface AdminContextMessage {
  id: string;
  sender_id: string;
  content: string;
  image_path: string | null;
  deleted_at: string | null;
  deleted_by_admin: boolean;
  created_at: string;
}

/** 7 aug: „Vezi conversația" la rapoartele pe utilizator (admin_report_conversation). */
export interface AdminReportConversation {
  conversation_id: string;
  kind: 'announcement' | 'market' | 'direct';
  created_at: string;
  messages: (AdminContextMessage & { file_name: string | null })[];
}

export interface DashboardStats {
  users_total: number;
  users_drivers: number;
  users_mechanics: number;
  users_banned: number;
  users_new_7d: number;
  users_new_30d: number;
  ann_open: number;
  ann_accepted: number;
  ann_resolved: number;
  ann_cancelled: number;
  reports_pending: number;
  conversations: number;
  messages: number;
}

type Result<T> = { data: T; error: string | null };

type RpcName = keyof Database['public']['Functions'];

async function rpcData<T>(fn: RpcName, args: Record<string, unknown>, fallback: T): Promise<Result<T>> {
  const { data, error } = await supabase.rpc(fn, args as never);
  if (error) return { data: fallback, error: translateDbError(error) };
  return { data: (data as T) ?? fallback, error: null };
}

async function rpcVoid(fn: RpcName, args: Record<string, unknown>): Promise<string | null> {
  const { error } = await supabase.rpc(fn, args as never);
  return translateDbError(error);
}

// ── Dashboard ────────────────────────────────────────────────────────────────
export function fetchDashboardStats() {
  return rpcData<DashboardStats | null>('admin_dashboard_stats', {}, null);
}

// ── Erori client + sănătate (faza 9.1 / 9.4) ─────────────────────────────────
// RPC-urile vin cu migrările 20261111000100 (admin_client_errors) și 20261111000300 (admin_health);
// cât nu sunt pe server (PGRST202) sau la orice altă eroare → `null` = cardul nu apare. Fără Alert,
// fără reîncercări: le reîncarcă butonul / pull-to-refresh-ul panoului.
export interface ClientErrorTypeCount {
  error_type: string;
  count: number;
  users: number;
  last_at: string;
}

export interface ClientErrorItem {
  id: number;
  created_at: string;
  app_build: string | null;
  platform: string;
  os_version: string | null;
  screen: string | null;
  error_type: string;
  message: string | null;
  stack: string | null;
  user_hash: string;
}

export interface ClientErrorsSummary {
  since: string;
  total: number;
  users: number;
  by_type: ClientErrorTypeCount[];
  items: ClientErrorItem[];
}

export interface AdminHealthPush {
  queued: number;
  sending: number;
  sent_1h: number;
  sent_24h: number;
  failed_24h: number;
  oldest_queued_at: string | null;
  receipt_errors_24h: number;
  channel_events_pending: number;
  http_401_6h: number;
  http_errors_6h: number;
  expired_48h: number;
}

export interface AdminHealthCronFailure {
  jobname: string;
  failures: number;
  last_at: string | null;
  last_message: string | null;
}

/** Fiecare secțiune poate lipsi sau fi `null`; la o eroare pe secțiune serverul pune `<secțiune>_error`. */
export interface AdminHealth {
  generated_at?: string;
  push?: AdminHealthPush | null;
  storage_gc?: { queued: number; oldest_at: string | null; stale_48h: number } | null;
  retention_last?: { status: string | null; end_time: string | null; message: string | null } | null;
  cron_failed_24h?: AdminHealthCronFailure[] | null;
  client_errors?: { h24: number; d7: number } | null;
  public_reports_pending?: number | null;
  [key: `${string}_error`]: string | undefined;
}

export async function fetchClientErrors(hours = 168, limit = 200): Promise<ClientErrorsSummary | null> {
  try {
    const { data, error } = await rpcData<ClientErrorsSummary | null>(
      'admin_client_errors',
      { p_hours: hours, p_limit: limit },
      null
    );
    return error ? null : data;
  } catch {
    return null;
  }
}

export async function fetchAdminHealth(): Promise<AdminHealth | null> {
  try {
    const { data, error } = await rpcData<AdminHealth | null>('admin_health', {}, null);
    return error ? null : data;
  } catch {
    return null;
  }
}

// ── Rapoarte ─────────────────────────────────────────────────────────────────
export function fetchReports(status: ReportStatus | 'all' = 'pending') {
  return rpcData<AdminReport[]>('admin_list_reports', { p_status: status }, []);
}

export function fetchPendingReportsCount() {
  return rpcData<number>('admin_pending_reports_count', {}, 0);
}

export function updateReportStatus(id: string, status: ReportStatus) {
  return rpcVoid('admin_update_report_status', { p_id: id, p_status: status });
}

export function adminDeleteMessage(table: 'messages' | 'channel_messages', id: string) {
  return rpcVoid('admin_delete_message', { p_table: table, p_id: id });
}

export function fetchReportContext(table: 'messages' | 'channel_messages', messageId: string) {
  return rpcData<AdminContextMessage[]>('admin_report_context', {
    p_table: table,
    p_message_id: messageId,
  }, []);
}

/** Conversațiile DINTRE raportor și raportat (rapoarte pe utilizator) — acces
 *  mărginit (≤50 mesaje/conversație), condiționat de raport, auditat server-side. */
export function fetchReportConversation(reportId: string) {
  return rpcData<AdminReportConversation[]>('admin_report_conversation', {
    p_report_id: reportId,
  }, []);
}

// ── Utilizatori ──────────────────────────────────────────────────────────────
export function searchUsers(query: string) {
  return rpcData<AdminUserRow[]>('admin_search_users', { p_query: query }, []);
}

export function fetchUserDetail(uid: string) {
  return rpcData<AdminUserDetail | null>('admin_user_detail', { p_uid: uid }, null);
}

export function banUser(uid: string, reason: string, until: string | null) {
  return rpcVoid('admin_ban_user', { p_uid: uid, p_reason: reason, p_until: until });
}

export function unbanUser(uid: string) {
  return rpcVoid('admin_unban_user', { p_uid: uid });
}

/** Faza 18.5: câmpurile editabile de admin — whitelist-ul e impus și SERVER-side. */
export interface AdminProfileFields {
  full_name?: string;
  phone?: string | null;
  address?: string | null;
  vat_number?: string | null;
  specialization?: string | null;
  activity_zone?: string | null;
  company_name?: string | null;
  contact_email?: string | null;
}

export function adminUpdateProfile(uid: string, fields: AdminProfileFields) {
  return rpcVoid('admin_update_profile', { p_uid: uid, p_fields: fields });
}

// ── Conținut ─────────────────────────────────────────────────────────────────
export function fetchRecentAnnouncements() {
  return rpcData<AdminAnnouncement[]>('admin_list_recent_announcements', {}, []);
}

export function searchAnnouncements(query: string) {
  return rpcData<AdminAnnouncement[]>('admin_search_announcements', { p_query: query }, []);
}

export function adminDeleteAnnouncement(id: string) {
  return rpcVoid('admin_delete_announcement', { p_id: id });
}

export function fetchRecentListings() {
  return rpcData<AdminListing[]>('admin_list_recent_listings', {}, []);
}

export function adminDeleteListing(id: string) {
  return rpcVoid('admin_delete_listing', { p_id: id });
}

export function fetchRecentReviews() {
  return rpcData<AdminReview[]>('admin_list_recent_reviews', {}, []);
}

export function adminDeleteReview(id: string) {
  return rpcVoid('admin_delete_review', { p_id: id });
}

export function fetchChannelMessages() {
  return rpcData<AdminChannelMessage[]>('admin_list_channel_messages', {}, []);
}

// ── Serii pentru graficele din dashboard (11 sept 2026) ─────────────────────
// Citire directă din tabele (nu RPC): RLS-ul de admin permite SELECT pe toate
// anunțurile (politica announcements_select_admin), iar profilurile sunt publice.
// PostgREST plafonează un răspuns la 1000 de rânduri → paginare cu range().
export interface ProfileSeriesRow {
  created_at: string;
  role: 'driver' | 'mechanic';
}

export interface AnnouncementSeriesRow {
  created_at: string;
  status: AnnouncementStatus;
}

const SERIES_PAGE = 1000;

async function fetchPaged<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<{ data: T[]; error: string | null }> {
  const out: T[] = [];
  for (let from = 0; ; from += SERIES_PAGE) {
    const { data, error } = await page(from, from + SERIES_PAGE - 1);
    if (error) return { data: out, error: translateDbError(error) };
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < SERIES_PAGE) break;
  }
  return { data: out, error: null };
}

/** Conturi cu profil (nu șterse), șoferi + mecanici, create de la `since` încoace. */
export function fetchUsersSeries(since: string) {
  return fetchPaged<ProfileSeriesRow>((from, to) =>
    supabase
      .from('profiles')
      .select('created_at, role')
      .is('deleted_at', null)
      .in('role', ['driver', 'mechanic'])
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .range(from, to)
  );
}

/** Anunțuri postate de la `since` încoace, cu starea curentă. */
export function fetchAnnouncementsSeries(since: string) {
  return fetchPaged<AnnouncementSeriesRow>((from, to) =>
    supabase
      .from('announcements')
      .select('created_at, status')
      .gte('created_at', since)
      // 7.2: ciornele nu sunt „anunțuri postate” (dispar în 24 h fără publicare).
      .neq('status', 'draft')
      .order('created_at', { ascending: true })
      .range(from, to)
  );
}

// ── Curățare conturi-bot (migrarea 20261031000100_hygiene_limits, §8) ────────
export interface PurgeCandidate {
  id: string;
  email: string | null;
  role: string | null;
  provider: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  emailConfirmed: boolean;
  /** fara_profil | email_neconfirmat | nelogat_dupa_inscriere | profil_gol_fara_activitate */
  criterion: string;
}

/** Conturile create în [from, to) fără nicio urmă de folosire — DOAR dry-run până la faza 11
 *  (serverul refuză ștergerea cu `purge_disabled_until_phase_11`). Serverul mai cere: admin,
 *  to ≤ acum − 24 h, from < to, interval ≤ 31 zile (altfel `bad_interval`). */
export async function purgeAccountsDryRun(
  from: Date,
  to: Date
): Promise<{ data: { count: number; accounts: PurgeCandidate[] } | null; error: string | null }> {
  const { data, error } = await supabase.rpc('admin_purge_accounts', {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    p_dry_run: true,
  });
  if (error) return { data: null, error: translateDbError(error) };
  // Funcția întoarce jsonb (`Json` în tipurile generate); forma e cea din migrarea 20261031000100 §8.
  const row = data as unknown as {
    count: number;
    accounts: {
      id: string;
      email: string | null;
      role: string | null;
      provider: string | null;
      created_at: string;
      last_sign_in_at: string | null;
      email_confirmed: boolean;
      criterion: string;
    }[];
  } | null;
  if (!row) return { data: null, error: null };
  return {
    data: {
      count: row.count,
      accounts: (row.accounts ?? []).map((a) => ({
        id: a.id,
        email: a.email,
        role: a.role,
        provider: a.provider,
        createdAt: a.created_at,
        lastSignInAt: a.last_sign_in_at,
        emailConfirmed: a.email_confirmed,
        criterion: a.criterion,
      })),
    },
    error: null,
  };
}
