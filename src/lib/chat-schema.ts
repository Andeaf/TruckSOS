import { supabase } from '@/lib/supabase';
import type { MessageMention } from '@/types/database';

export type { MessageMention };

/**
 * Fragmentul de embed pentru citat.
 *
 * ⚠️ Direcția self-join-ului (bug „Mesaj indisponibil", reparat 7 aug): forma veche
 * `reply_to:<tabel>!reply_to_id(...)` era rezolvată de PostgREST ca ONE-TO-MANY
 * INVERS — „mesajele care-mi răspund MIE" (aproape mereu `[]`), nu mesajul citat.
 * Verificat pe API-ul live: related-order pe embed-ul vechi răspundea PGRST118
 * „do not form a many-to-one relationship", deci orice reply venea fără citat la
 * încărcare ȘI la trimitere (doar calea Realtime era corectă — fetchReplyEmbed
 * interoghează direct după id). Embed-ul pe NUMELE COLOANEI FK (`reply_to_id`)
 * forțează direcția many-to-one (obiect/null, nu array); coloana se numește la fel
 * pe `messages` și `channel_messages`, deci fragmentul nu mai depinde de tabel.
 */
/**
 * Coloanele citatului. Contextele atașate (10 sept): un mesaj doar-card
 * (recomandare de persoană / anunț din Market / anunț de depanare) are content=''
 * — fără id-urile + embed-urile lor, citatul unei recomandări era complet GOL
 * (bug raportat de user). Embed-urile pe FK-uri din interiorul self-join-ului
 * sunt permise de PostgREST; sender/mechanic arată amândouă spre profiles, dar
 * cu hint-uri de coloană diferite, ca în CHANNEL_ATTACH_EMBEDS.
 */
const REPLY_COLUMNS =
  'id,content,image_path,file_name,file_path,file_duration,sender_id,deleted_at,' +
  'recommended_mechanic_id,listing_id,announcement_id,' +
  'sender:profiles!sender_id(full_name),' +
  'mechanic:profiles!recommended_mechanic_id(full_name,deleted_at,role),' +
  'listing:market_listings!listing_id(title),' +
  'announcement:announcements!announcement_id(location)';

export function replyEmbed(): string {
  // file_name (23 aug): citatul unui mesaj-fișier/video era GOL fără el —
  // content='' și image_path=null la astfel de mesaje. file_path (24 aug):
  // sursa miniaturii video din citat (URL semnat → thumbnail pe device).
  return `, reply_to:reply_to_id(${REPLY_COLUMNS})`;
}

/** Forma rândului întors de embed-ul `reply_to` (vezi replyEmbed). */
export type ReplyEmbedRow = {
  id: string;
  content: string;
  image_path: string | null;
  file_name: string | null;
  file_path: string | null;
  /** Secunde; null la fișiere non-video și la mesajele dinainte de 24 aug. */
  file_duration: number | null;
  sender_id: string;
  deleted_at: string | null;
  sender?: { full_name: string } | null;
  /** Contextele atașate mesajului citat (10 sept) — id + embed-ul minim pentru snippet.
   * Embed-ul poate fi null cu id-ul prezent (RLS / rând dispărut) → etichetă generică. */
  recommended_mechanic_id?: string | null;
  listing_id?: string | null;
  announcement_id?: string | null;
  mechanic?: { full_name: string; deleted_at: string | null; role?: string } | null;
  listing?: { title: string } | null;
  announcement?: { location: string } | null;
};

/**
 * Hidratează citatul unui mesaj sosit prin Realtime: payload-ul postgres_changes
 * e rândul brut (doar `reply_to_id`, fără embed-uri) — fără fetch-ul ăsta,
 * destinatarii vedeau „Mesaj indisponibil" deși originalul există. `null` înseamnă
 * chiar indisponibil (șters definitiv sau invizibil prin RLS), exact semantica
 * embed-ului gol din selecturi.
 */
export async function fetchReplyEmbed(
  table: 'messages' | 'channel_messages',
  replyToId: string
): Promise<ReplyEmbedRow | null> {
  const { data } = await supabase
    .from(table)
    .select(REPLY_COLUMNS)
    .eq('id', replyToId)
    .maybeSingle();
  return (data as unknown as ReplyEmbedRow) ?? null;
}
