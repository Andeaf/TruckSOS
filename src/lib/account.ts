import { supabase } from '@/lib/supabase';

/**
 * Ștergerea contului (Faza 15). Apelează Edge Function-ul `delete-account` care:
 * 1. rulează purge_user_data() (ca auth.uid() → imposibil să ștergi alt cont),
 * 2. șterge obiectele Storage întoarse (service_role),
 * 3. șterge auth.users (service_role) — profilul rămâne piatră-funerară.
 *
 * NU folosim supabase.functions.invoke: acela trece prin fetch-ul cu timeout de 10s din
 * `supabase.ts`, care ar pica pe conturi cu multe poze. Facem fetch direct cu 60s.
 *
 * @returns null la succes; un cod/mesaj de eroare altfel.
 */
export async function deleteAccount(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return 'no_session';

  const base = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !anon) return 'config_missing';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(`${base}/functions/v1/delete-account`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: anon,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return body.error ?? `http_${res.status}`;
    }
    return null;
  } catch {
    return 'network_error';
  } finally {
    clearTimeout(timer);
  }
}
