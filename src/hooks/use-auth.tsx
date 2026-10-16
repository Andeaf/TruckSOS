import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js';

import { translateAuthError } from '@/lib/auth-errors';
import { readStoredSession, supabase } from '@/lib/supabase';
import { registerPushToken, unregisterPushToken } from '@/lib/push';
import { buildDiagnosticEntry, flushDiagnostics, queueDiagnostic } from '@/lib/diagnostic-log';
import { diagnoseNetwork, isNetworkError } from '@/lib/network-diagnosis';
import { clearProfileCache, readProfileCache, writeProfileCache } from '@/lib/profile-cache';
import { signOutSocial } from '@/lib/social-auth';
import type { Profile } from '@/types/database';
import i18n from '@/i18n';

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  /** `true` doar când serverul a confirmat că nu există rând în `profiles` (cont nou). */
  profileMissing: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (
    email: string,
    password: string,
    fullName: string
  ) => Promise<{ error: string | null; needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
  createProfile: (
    role: 'driver' | 'mechanic',
    details: { phone: string; address?: string | null; vat_number?: string | null; full_name?: string | null }
  ) => Promise<string | null>;
  updateProfile: (updates: { full_name?: string; specialization?: string | null; activity_zone?: string | null; phone?: string | null; company_name?: string | null; contact_email?: string | null; address?: string | null; vat_number?: string | null; avatar_path?: string | null; push_enabled?: boolean; market_push_enabled?: boolean; notify_radius_km?: number | null; latitude?: number | null; longitude?: number | null; lang?: string }) => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  // 14 oct 2026 — reclamația „m-a deconectat fără motiv" (sesiune VALIDĂ pe server):
  // o citire a profilului picată pe rețea NU mai înseamnă „fără profil". Înainte, garda
  // trimitea omul la alegerea rolului, de unde „Continuă" lovea cheia duplicată
  // („profiles_pkey"). `profileMissing` e `true` doar cu confirmarea serverului.
  const [profileMissing, setProfileMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const profileRef = useRef<Profile | null>(null);
  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);
  // Reîncercarea citirii profilului când rețeaua pică: pauze crescătoare 3 s → 30 s.
  const profileRetryRef = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    delayMs: number;
    userId: string | null;
    failures: number;
  }>({ timer: null, delayMs: 3000, userId: null, failures: 0 });
  // Un singur diagnostic de rețea per pornire (jurnalul `client_diagnostics`).
  const offlineLoggedRef = useRef(false);
  // Sesiunea curentă, citibilă sincron din funcțiile async (starea React ar fi în urmă).
  const sessionRef = useRef<Session | null>(null);
  // Tokenul acestui dispozitiv, ținut ca să-l putem șterge exact pe el la logout.
  const pushTokenRef = useRef<string | null>(null);
  // Contul pentru care tokenul de mai sus e deja revendicat — ca reîncercările să
  // știe când chiar n-au ce face și când trebuie să re-lege tokenul (alt cont).
  const pushOwnerRef = useRef<string | null>(null);

  function cancelProfileRetry() {
    const r = profileRetryRef.current;
    if (r.timer) clearTimeout(r.timer);
    r.timer = null;
    r.delayMs = 3000;
    r.userId = null;
    r.failures = 0;
  }

  function scheduleProfileRetry(userId: string) {
    const r = profileRetryRef.current;
    if (r.timer) clearTimeout(r.timer);
    r.userId = userId;
    r.timer = setTimeout(() => {
      r.timer = null;
      if (r.userId === userId && sessionRef.current?.user.id === userId) void fetchProfile(userId);
    }, r.delayMs);
    r.delayMs = Math.min(r.delayMs * 2, 30000);
  }

  // Jurnalul de diagnostice (13 oct): ce vede telefonul când serverul pare inaccesibil.
  async function logOffline(kind: string, error: unknown) {
    if (offlineLoggedRef.current) return;
    offlineLoggedRef.current = true;
    try {
      const report = await diagnoseNetwork();
      await queueDiagnostic(buildDiagnosticEntry(kind, error, report));
    } catch {
      // doar jurnal
    }
  }

  // Profilul nu se poate citi acum (rețea / server): păstrăm ce avem — din memorie sau
  // din cache-ul de pe telefon — ca omul să rămână în aplicație, și reîncercăm cu pauze
  // crescătoare și la revenirea în prim-plan. Fără nimic în cache rămâne ecranul de
  // încărcare: tot mai bine decât un login sau un „alege rolul" fals.
  async function fallbackToOfflineProfile(userId: string, reason: unknown): Promise<Profile | null> {
    // Între timp s-a delogat sau a intrat alt cont: citirea asta nu mai are obiect (altfel ar
    // reprograma la nesfârșit reîncercări pentru un user care nu mai e în aplicație).
    if (sessionRef.current?.user.id !== userId) return null;
    const cached =
      profileRef.current?.id === userId ? profileRef.current : await readProfileCache(userId);
    if (sessionRef.current?.user.id !== userId) return null;
    if (cached) {
      setProfile(cached);
      setProfileMissing(false);
      setLoading(false);
    }
    if (reason !== 'no_live_session') void logOffline('profile_fetch', reason);
    const r = profileRetryRef.current;
    r.failures += 1;
    if (!cached && r.failures >= 3) {
      // Fără profil în cache nu ținem omul la nesfârșit pe ecranul de încărcare: ca înainte,
      // ajunge la login (sesiunea rămâne salvată pe telefon; următoarea pornire cu rețea intră
      // direct). Dacă getSession() de la pornire e încă în lucru, settle() îl readuce.
      cancelProfileRetry();
      sessionRef.current = null;
      setSession(null);
      setLoading(false);
      return null;
    }
    scheduleProfileRetry(userId);
    return cached;
  }

  /** Citește profilul de pe server; întoarce profilul folosit acum (server sau cache). */
  async function fetchProfile(userId: string): Promise<Profile | null> {
    try {
      // Fără token valid în clipa asta (reîmprospătarea a picat pe rețea), cererea ar
      // pleca anonim și ar primi „niciun rând" — ceea ce NU înseamnă că profilul lipsește.
      const {
        data: { session: live },
      } = await supabase.auth.getSession();
      if (!live || live.user.id !== userId) {
        return fallbackToOfflineProfile(userId, 'no_live_session');
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();
      if (error) return fallbackToOfflineProfile(userId, error);

      cancelProfileRetry();
      // `role` e text în schema generată; CHECK-ul din DB îl limitează la valorile din Role.
      const next = (data as Profile | null) ?? null;
      setProfile(next);
      // Doar aici, cu răspuns de la server, știm sigur că nu există rând (cont nou).
      setProfileMissing(!next);
      await writeProfileCache(next);
      setLoading(false);
      return next;
    } catch (e) {
      return fallbackToOfflineProfile(userId, e);
    }
  }

  useEffect(() => {
    let settled = false;
    const settle = (next: Session | null) => {
      settled = true;
      sessionRef.current = next;
      setSession(next);
      if (next) {
        void fetchProfile(next.user.id);
        // 13 oct 2026: cu sesiune, urcăm diagnosticele de rețea strânse cât serverul era inaccesibil.
        void flushDiagnostics();
      } else {
        setLoading(false);
      }
    };

    // 14 oct 2026: rețea lentă — după 8 s nu mai așteptăm reîmprospătarea tokenului, dar
    // nici nu-l trimitem la login: cu o sesiune salvată intrăm cu ea (profilul, din cache).
    const safetyTimer = setTimeout(() => {
      void (async () => {
        const stored = await readStoredSession();
        const cached = stored ? await readProfileCache(stored.user.id) : null;
        if (settled) return;
        if (stored && cached) {
          // Intrăm direct cu ce știm (sesiunea + profilul de pe telefon), fără să așteptăm
          // reîmprospătarea tokenului; getSession() de mai jos aduce apoi datele proaspete.
          settled = true;
          sessionRef.current = stored;
          setSession(stored);
          setProfile(cached);
          setProfileMissing(false);
          setLoading(false);
        } else {
          // Fără profil în cache nu avem ce arăta: login, ca înainte; dacă getSession()
          // reușește totuși mai târziu, settle() îl aduce înapoi în aplicație.
          settle(null);
        }
      })();
    }, 8000);

    supabase.auth
      .getSession()
      .then(async ({ data: { session }, error }) => {
        clearTimeout(safetyTimer);
        let next = session;
        if (!next && error && isAuthRetryableFetchError(error)) {
          // Tokenul e expirat și reîmprospătarea a picat pe REȚEA (nu pe server): sesiunea
          // din storage e în continuare bună — vezi readStoredSession. Dacă tokenul chiar
          // e invalid, auth-js emite SIGNED_OUT la prima reîmprospătare reușită → login.
          next = await readStoredSession();
          if (next) void logOffline('startup_session', error);
        }
        settle(next);
      })
      .catch(() => {
        clearTimeout(safetyTimer);
        if (!settled) settle(null);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') return;
      sessionRef.current = session;
      setSession(session);
      if (session) {
        // După login (parolă/Google/Apple) profilul încă nu e în memorie: arătăm încărcarea,
        // altfel formularul ar sta mut cât citim profilul (și omul ar apăsa iar „Intră").
        if (event === 'SIGNED_IN' && !profileRef.current) setLoading(true);
        void fetchProfile(session.user.id);
        // 13 oct 2026: cu sesiune, urcăm diagnosticele de rețea strânse cât serverul era inaccesibil.
        void flushDiagnostics();
      } else {
        cancelProfileRetry();
        setProfile(null);
        setProfileMissing(false);
        void clearProfileCache();
        setLoading(false);
      }
    });

    // Revenire în prim-plan cu o citire de profil restantă → reîncercăm imediat.
    const appState = AppState.addEventListener('change', (state) => {
      const r = profileRetryRef.current;
      if (state !== 'active' || !r.userId) return;
      if (r.timer) clearTimeout(r.timer);
      r.timer = null;
      void fetchProfile(r.userId);
    });

    return () => {
      clearTimeout(safetyTimer);
      cancelProfileRetry();
      appState.remove();
      subscription.unsubscribe();
    };
    // Rulează o singură dată, la montare: fetchProfile/settle citesc starea prin ref-uri,
    // iar abonamentele de aici nu trebuie refăcute la fiecare schimbare de sesiune.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signIn(email: string, password: string): Promise<string | null> {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return translateAuthError(error);
  }

  async function signUp(
    email: string,
    password: string,
    fullName: string
  ): Promise<{ error: string | null; needsConfirmation: boolean }> {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    if (error) return { error: translateAuthError(error), needsConfirmation: false };
    // Anti-enumerare: pentru un email deja confirmat Supabase întoarce un user „fals"
    // fără identities și NU trimite nimic — altfel omul ar aștepta degeaba un cod.
    if (data.user && data.user.identities?.length === 0) {
      return { error: i18n.t('authErrors.user_already_exists'), needsConfirmation: false };
    }
    // Fără sesiune = confirmarea emailului e activă → ecranul cere codul primit pe mail.
    return { error: null, needsConfirmation: !data.session };
  }

  // Înregistrăm tokenul de fiecare dată când avem sesiune (login sau repornire).
  // În Expo Go `registerPushToken` iese tăcut → nimic nu se schimbă acolo.
  //
  // 2 sept 2026 — bugul „nu primește nimeni notificări": dependența era DOAR
  // `session?.user.id`, deci exista o SINGURĂ încercare, imediat după login — adică
  // înainte ca rândul din `profiles` să existe (se creează la alegerea rolului).
  // Vechiul FK `push_tokens.user_id → profiles(id)` respingea INSERT-ul (23503 → 409)
  // și nimic nu mai reîncerca: 83% dintre conturi rămâneau fără token. Serverul e
  // reparat (migrarea 20260902 mută FK-ul pe auth.users), aici punem plasa de
  // siguranță pe client — se reîncearcă și când APARE profilul, și la fiecare
  // revenire în prim-plan, până când tokenul e confirmat pentru contul curent.
  const profileId = profile?.id;
  useEffect(() => {
    const userId = session?.user.id;
    if (!userId) return;

    let cancelled = false;
    let attemptsLeft = 5;

    const attempt = () => {
      // Deja înregistrat PENTRU CONTUL ĂSTA → nu mai facem nimic. Comparația cu
      // `pushOwnerRef` păstrează revendicarea de la Faza 14: pe schimbarea contului
      // pe același telefon tokenul TREBUIE re-legat, altfel notificările contului
      // vechi ar continua să ajungă aici.
      if (cancelled || attemptsLeft <= 0) return;
      if (pushTokenRef.current && pushOwnerRef.current === userId) return;
      attemptsLeft -= 1;
      registerPushToken(userId).then((token) => {
        if (cancelled) return;
        pushTokenRef.current = token;
        pushOwnerRef.current = token ? userId : null;
      });
    };

    attempt();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') attempt();
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [session?.user.id, profileId]);

  async function signOut() {
    // Întâi scoatem tokenul: altfel telefonul ar primi notificările contului vechi.
    const token = pushTokenRef.current;
    if (token) {
      await unregisterPushToken(token);
      pushTokenRef.current = null;
    }
    pushOwnerRef.current = null;
    cancelProfileRetry();
    await clearProfileCache();
    // Contul Google ales rămâne memorat nativ; fără asta următorul tap pe „Continuă cu
    // Google” ar intra direct, fără selector de cont (best-effort, doar pe telefon).
    await signOutSocial();
    await supabase.auth.signOut();
  }

  async function updateProfile(updates: {
    full_name?: string;
    specialization?: string | null;
    activity_zone?: string | null;
    phone?: string | null;
    company_name?: string | null;
    contact_email?: string | null;
    address?: string | null;
    vat_number?: string | null;
    avatar_path?: string | null;
    push_enabled?: boolean;
    market_push_enabled?: boolean;
    notify_radius_km?: number | null;
    latitude?: number | null;
    longitude?: number | null;
    lang?: string;
  }): Promise<string | null> {
    const userId = session?.user.id;
    if (!userId) return i18n.t('common.noSession');
    // Optimist: comutatoarele din Setări răspund instant, fără să aștepte serverul.
    // Refetch-ul de după rămâne sursa adevărului — pe eroare readuce valorile reale
    // (revert), pe succes doar confirmă ce s-a afișat deja.
    setProfile((prev) => (prev ? ({ ...prev, ...updates } as Profile) : prev));
    const { error } = await supabase
      .from('profiles')
      .update(updates as never)
      .eq('id', userId);
    await fetchProfile(userId);
    return error?.message ?? null;
  }

  async function createProfile(
    role: 'driver' | 'mechanic',
    // Faza 18: telefonul e obligatoriu la AMBELE roluri încă de la crearea profilului;
    // adresa + TVA vin doar de la mecanici (prestatori). Validate în role-select.
    details: { phone: string; address?: string | null; vat_number?: string | null; full_name?: string | null }
  ): Promise<string | null> {
    const userId = session?.user.id;
    // Numele: cel tastat în role-select (când metadata nu-l are — ex. Apple cu numele
    // ascuns), altfel `full_name` pus la înregistrare / de Google, altfel `name` (Google).
    const meta = session?.user.user_metadata ?? {};
    const fullName =
      details.full_name?.trim() ||
      (meta.full_name as string | undefined)?.trim() ||
      (meta.name as string | undefined)?.trim() ||
      i18n.t('common.defaultUser');
    if (!userId) return i18n.t('common.noSession');

    const { error } = await supabase.from('profiles').insert({
      id: userId,
      full_name: fullName,
      role,
      phone: details.phone,
      address: details.address ?? null,
      vat_number: details.vat_number ?? null,
    });

    if (!error) {
      await fetchProfile(userId);
      return null;
    }
    // 14 oct 2026: 23505 = profilul EXISTA deja - omul a ajuns aici dintr-o citire picata
    // pe retea, nu pentru ca n-ar avea cont. Il citim si mergem mai departe, fara eroare.
    if (error.code === '23505') {
      const existing = await fetchProfile(userId);
      return existing ? null : i18n.t('authErrors.network');
    }
    if (__DEV__) console.warn('[profile] insert esuat:', error.code, error.message);
    // Fara mesaje brute de Postgres pe ecran ("duplicate key value violates...").
    return isNetworkError(error)
      ? i18n.t('authErrors.network')
      : i18n.t('auth.roleSelect.errorGeneric');
  }

  return (
    <AuthContext.Provider value={{ session, profile, profileMissing, loading, signIn, signUp, signOut, createProfile, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth trebuie folosit în interiorul AuthProvider');
  return ctx;
}
