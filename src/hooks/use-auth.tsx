import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import type { Session } from '@supabase/supabase-js';

import { translateAuthError } from '@/lib/auth-errors';
import { supabase } from '@/lib/supabase';
import { registerPushToken, unregisterPushToken } from '@/lib/push';
import { signOutSocial } from '@/lib/social-auth';
import type { Profile } from '@/types/database';
import i18n from '@/i18n';

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
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
  const [loading, setLoading] = useState(true);
  // Tokenul acestui dispozitiv, ținut ca să-l putem șterge exact pe el la logout.
  const pushTokenRef = useRef<string | null>(null);
  // Contul pentru care tokenul de mai sus e deja revendicat — ca reîncercările să
  // știe când chiar n-au ce face și când trebuie să re-lege tokenul (alt cont).
  const pushOwnerRef = useRef<string | null>(null);

  async function fetchProfile(userId: string) {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      // `role` e text în schema generată; CHECK-ul din DB îl limitează la valorile din Role.
      setProfile((data as Profile | null) ?? null);
    } catch {
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const safetyTimer = setTimeout(() => setLoading(false), 8000);

    supabase.auth.getSession().then(({ data: { session } }) => {
      clearTimeout(safetyTimer);
      setSession(session);
      if (session) fetchProfile(session.user.id);
      else setLoading(false);
    }).catch(() => {
      clearTimeout(safetyTimer);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') return;
      setSession(session);
      if (session) fetchProfile(session.user.id);
      else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      clearTimeout(safetyTimer);
      subscription.unsubscribe();
    };
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

    if (!error) await fetchProfile(userId);
    return error?.message ?? null;
  }

  return (
    <AuthContext.Provider value={{ session, profile, loading, signIn, signUp, signOut, createProfile, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth trebuie folosit în interiorul AuthProvider');
  return ctx;
}
