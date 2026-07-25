import { supabase } from '@/lib/supabase';

/**
 * Raportare (Faza 14.5). Un raport poate fi pe un MESAJ (cu snapshot al conținutului,
 * ca dovada să nu se evapore dacă autorul șterge mesajul) sau pe un UTILIZATOR
 * (message_id null). RLS: inserezi doar propriile rapoarte; nu vezi rapoartele altora
 * și nici pe cele făcute împotriva ta. Statusul îl schimbă adminul din Studio.
 */

export type ReportReason = 'spam' | 'harassment' | 'inappropriate' | 'scam' | 'other';

export const REPORT_REASONS: ReportReason[] = [
  'spam',
  'harassment',
  'inappropriate',
  'scam',
  'other',
];

export interface SubmitReportParams {
  reportedUserId: string;
  messageId?: string | null;
  messageTable?: 'messages' | 'channel_messages' | null;
  /** Faza 19: raport pe un anunț de market (a treia formă de țintă). */
  listingId?: string | null;
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
  if (!session?.user) return { error: 'no_session', duplicate: false };

  const { error } = await supabase.from('reports').insert({
    reporter_id: session.user.id,
    reported_user_id: params.reportedUserId,
    message_id: params.messageId ?? null,
    message_table: params.messageTable ?? null,
    listing_id: params.listingId ?? null,
    reason: params.reason,
    details: params.details?.trim() || null,
    content_snapshot: params.contentSnapshot ?? null,
    image_path_snapshot: params.imagePathSnapshot ?? null,
  } as never);

  if (error) {
    const duplicate = (error as { code?: string }).code === '23505';
    return { error: error.message, duplicate };
  }
  return { error: null, duplicate: false };
}
