// PLAN_1.1, Faza H2 — Edge Function `translate-announcement`
// Traduce LA CERERE descrierea unui anunț în limba aplicației (ro / en / de). Rulează pe Deno.
//
// Contract: POST { announcement_id: uuid, target_lang: 'ro'|'en'|'de' }
//   200 → { text: string | null, source_lang: string, same_language: boolean, cached: boolean }
//   401 invalid_token · 400 bad_request · 404 not_found · 429 rate_limited (+ retry_after_seconds)
//   502 provider_error · 500 server_error
//
// Flux:
//   1. verifică JWT-ul apelantului → uid DIN JWT (niciodată din body)
//   2. validează body-ul (uuid + limbă permisă)
//   3. citește anunțul CA UTILIZATORUL (userClient → RLS): un cont care nu vede anunțul în app nu-l
//      poate nici traduce, iar funcția nu devine o ușă laterală spre anunțuri ascunse (service_role
//      ar ocoli RLS-ul). Lipsă = 404, fără să dezvăluie dacă anunțul există.
//   4. limba sursă deja DETECTATĂ = limba cerută → same_language, fără cotă
//   5. cache în announcement_translations (service_role) → răspunde fără cotă
//   6. rate limit pe translation_requests (service_role): 20 / oră, 100 / 24 h per utilizator;
//      rândul se inserează ÎNAINTE de apelul la Google (o încercare eșuată tot consumă)
//   7. Google Cloud Translation v2, fără `source` (ca să primim detectedSourceLanguage), timeout 10 s
//   8. limba detectată = limba cerută → marchează anunțul (source_lang + source_lang_detected), nu
//      stochează text; butonul „Tradu” dispare pentru toți utilizatorii acelei limbi
//   9. altfel upsert în announcement_translations + același UPDATE pe anunț → răspunde cu textul
//  10. eroare la Google → 502, nimic în cache
//
// Cost: Translation v2 are 500 000 caractere / lună gratuite; descrierea are max 4000 de caractere.
// Plafonul real de cheltuială e cota zilnică pusă în Google Cloud Console (obligatorie înainte de
// deploy, review D8); rate limit-ul de aici doar împiedică un singur cont să o consume.
// Limita e „cel mult o dată”, nu strictă: două cereri simultane ale aceluiași cont pot trece
// amândouă de verificare (depășire de 1-2 cereri, acceptabil).
//
// Secrete: GOOGLE_TRANSLATE_API_KEY (setat manual: `supabase secrets set`), restricționat la
// Cloud Translation API.
// Env-uri AUTO-injectate de Supabase: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ALLOWED_LANGS = ['ro', 'en', 'de'] as const;
type TargetLang = (typeof ALLOWED_LANGS)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HOUR_LIMIT = 20;
const DAY_LIMIT = 100;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const GOOGLE_TIMEOUT_MS = 10_000;
const PROVIDER = 'google-translate-v2';
const UNKNOWN_LANG = 'und';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function isTargetLang(v: unknown): v is TargetLang {
  return typeof v === 'string' && (ALLOWED_LANGS as readonly string[]).includes(v);
}

// Defensiv: cu format=text Google nu ar trebui să întoarcă entități, dar uneori o face.
// &amp; ultima, ca „&amp;lt;” să rămână „&lt;” (text literal), nu „<”.
function decodeBasicEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

// „pt-BR” → „pt”, „zh-CN” → „zh”; orice altceva decât două litere = necunoscut.
function normalizeLang(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const code = v.trim().slice(0, 2).toLowerCase();
  return /^[a-z]{2}$/.test(code) ? code : null;
}

type GoogleResult =
  | { ok: true; text: string; detected: string | null }
  | { ok: false; reason: string };

async function googleTranslate(apiKey: string, q: string, target: TargetLang): Promise<GoogleResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GOOGLE_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q, target, format: 'text' }),
        signal: controller.signal,
      },
    );
    if (!res.ok) {
      // Doar codul și motivul Google (fără corpul cererii, fără URL — URL-ul conține cheia).
      let reason = '';
      try {
        const errBody = await res.json();
        reason = errBody?.error?.status ?? errBody?.error?.errors?.[0]?.reason ?? '';
      } catch {
        // corp ne-JSON — ignorăm
      }
      return { ok: false, reason: `http_${res.status}${reason ? `_${reason}` : ''}` };
    }
    const body = await res.json();
    const tr = body?.data?.translations?.[0];
    if (!tr || typeof tr.translatedText !== 'string') return { ok: false, reason: 'malformed_response' };
    return {
      ok: true,
      text: decodeBasicEntities(tr.translatedText),
      detected: normalizeLang(tr.detectedSourceLanguage),
    };
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError';
    return { ok: false, reason: aborted ? 'timeout' : 'network_error' };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json(401, { error: 'invalid_token' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // ── 1. JWT → uid. Client CA utilizatorul: RLS + auth.uid() reflectă JWT-ul din antet. ──
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return json(401, { error: 'invalid_token' });
  const uid = user.id;

  // ── 2. Body ──
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: 'bad_request' });
  }
  const announcementId = (payload as { announcement_id?: unknown } | null)?.announcement_id;
  const targetLang = (payload as { target_lang?: unknown } | null)?.target_lang;
  if (typeof announcementId !== 'string' || !UUID_RE.test(announcementId) || !isTargetLang(targetLang)) {
    return json(400, { error: 'bad_request' });
  }

  // ── 3. Anunțul, ca utilizatorul (RLS). ──
  const { data: ann, error: annErr } = await userClient
    .from('announcements')
    .select('id, description, source_lang, source_lang_detected')
    .eq('id', announcementId)
    .maybeSingle();
  if (annErr) {
    console.error('[translate-announcement] announcement read failed:', annErr.code, annErr.message);
    return json(500, { error: 'server_error' });
  }
  if (!ann) return json(404, { error: 'not_found' });

  const annSourceLang: string | null = typeof ann.source_lang === 'string' ? ann.source_lang : null;
  const annDetected = ann.source_lang_detected === true;

  // ── 4. Limba deja detectată = limba cerută. ──
  if (annDetected && annSourceLang === targetLang) {
    return json(200, { text: null, source_lang: annSourceLang, same_language: true, cached: true });
  }

  const admin = createClient(url, serviceKey);

  // ── 5. Cache. ──
  const { data: cachedRow, error: cacheErr } = await admin
    .from('announcement_translations')
    .select('text, source_lang')
    .eq('announcement_id', announcementId)
    .eq('lang', targetLang)
    .maybeSingle();
  if (cacheErr) {
    console.error('[translate-announcement] cache read failed:', cacheErr.code, cacheErr.message);
    return json(500, { error: 'server_error' });
  }
  if (cachedRow) {
    return json(200, {
      text: cachedRow.text,
      source_lang: cachedRow.source_lang,
      same_language: false,
      cached: true,
    });
  }

  // Descriere goală (nu ar trebui să existe; coloana e NOT NULL): nimic de tradus, fără cotă.
  const description: string = typeof ann.description === 'string' ? ann.description : '';
  if (description.trim().length === 0) {
    return json(200, {
      text: null,
      source_lang: annSourceLang ?? targetLang,
      same_language: true,
      cached: false,
    });
  }

  const apiKey = Deno.env.get('GOOGLE_TRANSLATE_API_KEY');
  if (!apiKey) {
    console.error('[translate-announcement] missing_translate_key');
    return json(500, { error: 'server_error' });
  }

  // ── 6. Rate limit: un singur SELECT pe ultimele 24 h (cel mult DAY_LIMIT rânduri relevante). ──
  const now = Date.now();
  const { data: recent, error: rlErr } = await admin
    .from('translation_requests')
    .select('requested_at')
    .eq('user_id', uid)
    .gt('requested_at', new Date(now - DAY_MS).toISOString())
    .order('requested_at', { ascending: false })
    .limit(DAY_LIMIT);
  if (rlErr) {
    console.error('[translate-announcement] rate limit read failed:', rlErr.code, rlErr.message);
    return json(500, { error: 'server_error' });
  }
  const times = (recent ?? []).map((r) => new Date(r.requested_at as string).getTime());
  const hourCount = times.filter((t) => t > now - HOUR_MS).length;
  let retryMs = 0;
  // Când a HOUR_LIMIT-a cea mai recentă cerere iese din fereastră, contorul scade sub plafon.
  if (hourCount >= HOUR_LIMIT) retryMs = Math.max(retryMs, times[HOUR_LIMIT - 1] + HOUR_MS - now);
  if (times.length >= DAY_LIMIT) retryMs = Math.max(retryMs, times[DAY_LIMIT - 1] + DAY_MS - now);
  if (hourCount >= HOUR_LIMIT || times.length >= DAY_LIMIT) {
    return json(429, {
      error: 'rate_limited',
      retry_after_seconds: Math.max(1, Math.ceil(retryMs / 1000)),
    });
  }

  // Fail closed: fără rândul de evidență nu apelăm Google (altfel limita n-ar mai exista).
  const { error: insErr } = await admin.from('translation_requests').insert({ user_id: uid });
  if (insErr) {
    console.error('[translate-announcement] rate limit insert failed:', insErr.code, insErr.message);
    return json(500, { error: 'server_error' });
  }

  // ── 7. Google Translate v2. ──
  const result = await googleTranslate(apiKey, description, targetLang);
  if (!result.ok) {
    console.error('[translate-announcement] provider error:', result.reason);
    return json(502, { error: 'provider_error' });
  }

  const detected = result.detected;

  // Marchează limba reală pe anunț (doar dacă știm limba și se schimbă ceva: evităm UPDATE-uri
  // fără efect, care ar produce evenimente Realtime inutile). Eșecul nu strică răspunsul.
  async function markDetected(lang: string): Promise<void> {
    if (annDetected && annSourceLang === lang) return;
    const { error } = await admin
      .from('announcements')
      .update({ source_lang: lang, source_lang_detected: true })
      .eq('id', announcementId);
    if (error) console.error('[translate-announcement] source_lang update failed:', error.code, error.message);
  }

  // ── 8. Aceeași limbă. ──
  if (detected === targetLang) {
    await markDetected(detected);
    return json(200, { text: null, source_lang: detected, same_language: true, cached: false });
  }

  // ── 9. Cache + marcarea anunțului. ──
  // Fără detectedSourceLanguage: păstrăm traducerea cu sursa „und” și NU marcăm anunțul ca detectat.
  const sourceLang = detected ?? UNKNOWN_LANG;
  const { error: upErr } = await admin.from('announcement_translations').upsert(
    {
      announcement_id: announcementId,
      lang: targetLang,
      source_lang: sourceLang,
      text: result.text,
      provider: PROVIDER,
    },
    { onConflict: 'announcement_id,lang' },
  );
  // Cache-ul eșuat nu e motiv să aruncăm o traducere deja plătită: logăm și răspundem.
  if (upErr) console.error('[translate-announcement] cache write failed:', upErr.code, upErr.message);
  if (detected) await markDetected(detected);

  return json(200, { text: result.text, source_lang: sourceLang, same_language: false, cached: false });
});
