import i18n from '@/i18n';
import { translateDbError } from '@/lib/db-errors';
import { supabase } from '@/lib/supabase';

/**
 * Raportare (Faza 14.5). Un raport poate fi pe un MESAJ (cu snapshot al conținutului,
 * ca dovada să nu se evapore dacă autorul șterge mesajul) sau pe un UTILIZATOR
 * (message_id null). RLS: inserezi doar propriile rapoarte; nu vezi rapoartele altora
 * și nici pe cele făcute împotriva ta. Statusul îl schimbă adminul din Studio.
 */

export type ReportReason =
  | 'spam'
  | 'harassment'
  | 'inappropriate'
  | 'scam'
  | 'other'
  | 'illegal'
  | 'rights'
  | 'personal_data'
  | 'sexual_violent';

/** Motivele din foaia din app (ordinea de afișare). Cele 4 motive DSA noi (faza 8.3: illegal, rights,
 *  personal_data, sexual_violent) sunt acceptate de server și apar și aici, ca pe pagina publică. */
export const REPORT_REASONS: ReportReason[] = [
  'spam',
  'scam',
  'illegal',
  'harassment',
  'inappropriate',
  'personal_data',
  'sexual_violent',
  'rights',
  'other',
];

export interface SubmitReportParams {
  reportedUserId: string;
  messageId?: string | null;
  messageTable?: 'messages' | 'channel_messages' | null;
  /** Faza 19: raport pe un anunț de market (a treia formă de țintă). */
  listingId?: string | null;
  /** Faza 8.3 (D8.5): raport pe un anunț de depanare (`reports.announcement_id`, SET NULL la ștergere). */
  announcementId?: string | null;
  reason: ReportReason;
  details?: string | null;
  contentSnapshot?: string | null;
  imagePathSnapshot?: string | null;
}

/** `duplicate` = deja ai raportat acest mesaj (unique 23505) → mesaj prietenos, nu eroare. */
export async function submitReport(
  params: SubmitReportParams
): Promise<{ error: string | null; duplicate: boolean }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) return { error: i18n.t('common.noSession'), duplicate: false };

  const { error } = await supabase.from('reports').insert({
    reporter_id: session.user.id,
    reported_user_id: params.reportedUserId,
    message_id: params.messageId ?? null,
    message_table: params.messageTable ?? null,
    listing_id: params.listingId ?? null,
    announcement_id: params.announcementId ?? null,
    reason: params.reason,
    details: params.details?.trim() || null,
    content_snapshot: params.contentSnapshot ?? null,
    image_path_snapshot: params.imagePathSnapshot ?? null,
  } as never);

  if (error) {
    const duplicate = (error as { code?: string }).code === '23505';
    return { error: translateDbError(error), duplicate };
  }
  return { error: null, duplicate: false };
}
