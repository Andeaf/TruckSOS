import { supabase } from '@/lib/supabase';

/**
 * Detecție de capabilitate pentru schema Faza 14 (coloane reply_to_id/deleted_at/
 * edited_at pe mesaje). Migrațiile sunt ADITIVE și se rulează manual în Supabase
 * Studio; până atunci codul trebuie să funcționeze cu schema veche — altfel embed-ul
 * `reply_to` și coloanele noi ar face ORICE încărcare/trimitere de mesaj să eșueze (400).
 *
 * Probăm o singură dată (rezultat cache-uit pe sesiune) o coloană nouă. Pesimist la
 * eroare: dacă proba eșuează, folosim query-urile „vechi" care merg mereu.
 *
 * NOTĂ: după ce rulezi migrațiile, repornește aplicația ca `cached` să se re-evalueze.
 */

let cached: boolean | null = null;
let inflight: Promise<boolean> | null = null;

export async function hasChatV14(): Promise<boolean> {
  if (cached !== null) return cached;
  if (!inflight) {
    inflight = (async () => {
      const { error } = await supabase.from('messages').select('reply_to_id').limit(1);
      // 42703 = „column does not exist" → schema veche. Orice altă eroare: la fel, pesimist.
      cached = !error;
      inflight = null;
      return cached;
    })();
  }
  return inflight;
}

/**
 * Fragmentul de embed pentru citat, doar dacă schema îl suportă.
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
export function replyEmbed(): string {
  // file_name (23 aug): citatul unui mesaj-fișier/video era GOL fără el —
  // content='' și image_path=null la astfel de mesaje. file_path (24 aug):
  // sursa miniaturii video din citat (URL semnat → thumbnail pe device).
  return ', reply_to:reply_to_id(id,content,image_path,file_name,file_path,file_duration,sender_id,deleted_at,sender:profiles!sender_id(full_name))';
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
    .select('id,content,image_path,file_name,file_path,file_duration,sender_id,deleted_at,sender:profiles!sender_id(full_name)')
    .eq('id', replyToId)
    .maybeSingle();
  return (data as unknown as ReplyEmbedRow) ?? null;
}
