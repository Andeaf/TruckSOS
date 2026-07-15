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

/** Fragmentul de embed pentru citat, doar dacă schema îl suportă. */
export function replyEmbed(table: 'messages' | 'channel_messages'): string {
  return `, reply_to:${table}!reply_to_id(id,content,image_path,sender_id,deleted_at,sender:profiles!sender_id(full_name))`;
}
