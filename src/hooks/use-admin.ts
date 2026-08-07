import { supabase } from '@/lib/supabase';
import type { ReportReason, ReportStatus } from '@/types/database';

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

async function rpcData<T>(fn: string, args: Record<string, unknown>, fallback: T): Promise<Result<T>> {
  const { data, error } = await supabase.rpc(fn, args as never);
  if (error) return { data: fallback, error: error.message };
  return { data: (data as T) ?? fallback, error: null };
}

async function rpcVoid(fn: string, args: Record<string, unknown>): Promise<string | null> {
  const { error } = await supabase.rpc(fn, args as never);
  return error?.message ?? null;
}

// ── Dashboard ────────────────────────────────────────────────────────────────
export function fetchDashboardStats() {
  return rpcData<DashboardStats | null>('admin_dashboard_stats', {}, null);
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
