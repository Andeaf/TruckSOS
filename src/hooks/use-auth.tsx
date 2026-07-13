import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';
import { registerPushToken, unregisterPushToken } from '@/lib/push';
import type { Profile } from '@/types/database';
import i18n from '@/i18n';

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string, fullName: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  createProfile: (role: 'driver' | 'mechanic') => Promise<string | null>;
  updateProfile: (updates: { full_name?: string; specialization?: string | null; activity_zone?: string | null; phone?: string | null; avatar_path?: string | null; push_enabled?: boolean; notify_radius_km?: number | null; latitude?: number | null; longitude?: number | null; lang?: string }) => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  // Tokenul acestui dispozitiv, ținut ca să-l putem șterge exact pe el la logout.
  const pushTokenRef = useRef<string | null>(null);

  async function fetchProfile(userId: string) {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      setProfile(data ?? null);
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
    return error?.message ?? null;
  }

  async function signUp(
    email: string,
    password: string,
    fullName: string
  ): Promise<string | null> {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    return error?.message ?? null;
  }

  // Înregistrăm tokenul de fiecare dată când avem sesiune (login sau repornire).
  // În Expo Go `registerPushToken` iese tăcut → nimic nu se schimbă acolo.
  useEffect(() => {
    const userId = session?.user.id;
    if (!userId) return;
    registerPushToken(userId).then((token) => {
      pushTokenRef.current = token;
    });
  }, [session?.user.id]);

  async function signOut() {
    // Întâi scoatem tokenul: altfel telefonul ar primi notificările contului vechi.
    const token = pushTokenRef.current;
    if (token) {
      await unregisterPushToken(token);
      pushTokenRef.current = null;
    }
    await supabase.auth.signOut();
  }

  async function updateProfile(updates: {
    full_name?: string;
    specialization?: string | null;
    activity_zone?: string | null;
    phone?: string | null;
    avatar_path?: string | null;
    push_enabled?: boolean;
    notify_radius_km?: number | null;
    latitude?: number | null;
    longitude?: number | null;
    lang?: string;
  }): Promise<string | null> {
    const userId = session?.user.id;
    if (!userId) return i18n.t('common.noSession');
    const { error } = await supabase
      .from('profiles')
      .update(updates as never)
      .eq('id', userId);
    if (!error) await fetchProfile(userId);
    return error?.message ?? null;
  }

  async function createProfile(role: 'driver' | 'mechanic'): Promise<string | null> {
    const userId = session?.user.id;
    const fullName = (session?.user.user_metadata?.full_name as string) ?? i18n.t('common.defaultUser');
    if (!userId) return i18n.t('common.noSession');

    const { error } = await supabase
      .from('profiles')
      .insert({ id: userId, full_name: fullName, role });

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
