/**
 * Corecții peste tipurile generate (`./supabase.ts`) pentru view-urile `public.announcements`,
 * `public.profiles` și `public.guest_announcements` (1.1, după faza 4).
 *
 * De ce există: din faza 4, `announcements` și `profiles` sunt VIEW-uri security_invoker peste
 * `app.announcements` / `app.profiles`. `supabase gen types` le pune în `Views` cu TOATE coloanele
 * `| null` în `Row`, `never` în `Insert`/`Update` pe coloanele calculate cu CASE și
 * `Relationships: []` (FK-urile sunt pe `app.*`). Realitatea: scrierile merg prin triggerele
 * INSTEAD OF (toate coloanele scriibile, mai puțin cele generate), NOT NULL-urile sunt cele din
 * tabelele `app.*` (definiția din 20261031000300_baseline_production_schema.sql, mutată neschimbată
 * în 20261101000100_private_tables.sql), iar PostgREST rezolvă embed-urile
 * `profiles!driver_id(...)` / `profiles!mechanic_id(...)` prin view-uri.
 *
 * La următorul `npm run gen:types`: `./supabase.ts` se suprascrie, fișierul acesta rămâne și se
 * aplică peste noul tip. Dacă schema unui view se schimbă (coloană nouă, NOT NULL nou, altă
 * mască CASE, FK nou), override-ul de mai jos trebuie actualizat de mână — altfel o coloană
 * nouă apare cu forma generată (`| null` / `never`), iar una scoasă rămâne aici ca fantomă.
 *
 * Coloane acoperite:
 * - announcements (20): id, driver_id, description, location, status, mechanic_id, created_at,
 *   updated_at, truck_make, truck_model, truck_year, plate_number*, latitude*, longitude*,
 *   hidden_from_history, chassis_number*, lat_approx†, lng_approx†, source_lang,
 *   source_lang_detected; Relationships: driver_id → profiles, mechanic_id → profiles.
 * - profiles (25): id, full_name, role, created_at, specialization, activity_zone, phone*,
 *   rating_avg, rating_count, avatar_path, push_enabled*, notify_radius_km*, latitude*,
 *   longitude*, lang*, deleted_at, company_name, contact_email*, banned_at*, banned_until*,
 *   ban_reason*, address*, vat_number*, market_push_enabled*, mention_push_enabled*.
 * - guest_announcements: doar Relationships (driver_id → profiles).
 * - moderation_notices (8, PLAN_1.1_FIX 7.9; migrarea 20261102000200_reports_moderation.sql):
 *   id, user_id, kind (uniunea literală din CHECK-ul tabelului), reason, target_type, target_id,
 *   created_at, read_at; Insert `never`, Update doar `read_at` (singura coloană cu GRANT UPDATE),
 *   Relationships []. View-ul nu există încă în `supabase.ts` generat — se compară la primul
 *   gen:types de după aplicarea 3.3 pe producție (atunci `kind` vine `string | null` și toate
 *   coloanele `| null`). ATENȚIE la acel moment: MergeDeep îmbină în adâncime, deci `Update` va
 *   primi și coloanele generate (nu doar `read_at`), iar `Insert: never` peste un obiect generat
 *   trebuie re-verificat (probă de tipuri: `insert(...)` și `update({ reason })` trebuie să pice).
 *
 * `*` = coloană mascată cu CASE în view: rămâne `| null` în `Row` chiar dacă e NOT NULL în tabel
 * (push_enabled, lang, market_push_enabled, mention_push_enabled), pentru că view-ul o întoarce
 * NULL celor care n-au voie s-o vadă; în `Insert`/`Update` are tipul real (triggerul o scrie).
 * `†` = coloană GENERATED în tabel: rămâne `never` în `Insert`/`Update` (triggerul n-o scrie).
 * `created_at` / `updated_at` au DEFAULT now() dar NU sunt NOT NULL în tabel → `| null` în `Row`.
 * `status` / `role` rămân `string` (text + CHECK în baza de date), ca la generator.
 */
import type { Database as GeneratedDatabase } from './supabase';

/**
 * Îmbinare recursivă de tipuri obiect: cheile din B câștigă, cheile doar din A rămân neatinse.
 * Obiectele prezente în ambele se îmbină în adâncime; tablourile/tuplurile și valorile simple
 * din B înlocuiesc complet (ex. `Relationships`). Modificatorii `?`/`readonly` din B se păstrează
 * (tip mapat omomorf peste B). Testele sunt în tuplu ca `never` (`x?: never`) să nu se distribuie.
 */
export type MergeDeep<A, B> = Simplify<
  Omit<A, keyof B> & {
    [K in keyof B]: K extends keyof A ? MergeValue<A[K], B[K]> : B[K];
  }
>;

type MergeValue<A, B> = [B] extends [readonly unknown[]]
  ? B
  : [A] extends [readonly unknown[]]
    ? B
    : [A] extends [object]
      ? [B] extends [object]
        ? MergeDeep<A, B>
        : B
      : B;

type Simplify<T> = { [K in keyof T]: T[K] } & {};

type AnnouncementRow = {
  id: string;
  driver_id: string;
  description: string;
  location: string;
  status: string;
  mechanic_id: string | null;
  created_at: string | null;
  updated_at: string | null;
  truck_make: string | null;
  truck_model: string | null;
  truck_year: number | null;
  plate_number: string | null;
  latitude: number | null;
  longitude: number | null;
  hidden_from_history: boolean;
  chassis_number: string | null;
  lat_approx: number | null;
  lng_approx: number | null;
  source_lang: string | null;
  source_lang_detected: boolean;
};

type AnnouncementWrite = {
  id?: string;
  status?: string;
  mechanic_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  truck_make?: string | null;
  truck_model?: string | null;
  truck_year?: number | null;
  plate_number?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  hidden_from_history?: boolean;
  chassis_number?: string | null;
  lat_approx?: never;
  lng_approx?: never;
  source_lang?: string | null;
  source_lang_detected?: boolean;
};

type ProfileRow = {
  id: string;
  full_name: string;
  role: string;
  created_at: string | null;
  specialization: string | null;
  activity_zone: string | null;
  phone: string | null;
  rating_avg: number;
  rating_count: number;
  avatar_path: string | null;
  push_enabled: boolean | null;
  notify_radius_km: number | null;
  latitude: number | null;
  longitude: number | null;
  lang: string | null;
  deleted_at: string | null;
  company_name: string | null;
  contact_email: string | null;
  banned_at: string | null;
  banned_until: string | null;
  ban_reason: string | null;
  address: string | null;
  vat_number: string | null;
  market_push_enabled: boolean | null;
  mention_push_enabled: boolean | null;
};

type ProfileWrite = {
  created_at?: string | null;
  specialization?: string | null;
  activity_zone?: string | null;
  phone?: string | null;
  rating_avg?: number;
  rating_count?: number;
  avatar_path?: string | null;
  push_enabled?: boolean;
  notify_radius_km?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  lang?: string;
  deleted_at?: string | null;
  company_name?: string | null;
  contact_email?: string | null;
  banned_at?: string | null;
  banned_until?: string | null;
  ban_reason?: string | null;
  address?: string | null;
  vat_number?: string | null;
  market_push_enabled?: boolean;
  mention_push_enabled?: boolean;
};

/** Valorile din CHECK-ul `app.moderation_notices.kind` (faza 3.3). */
export type ModerationNoticeKind =
  | 'message_deleted'
  | 'announcement_deleted'
  | 'listing_deleted'
  | 'review_deleted'
  | 'banned';

type ModerationNoticeRow = {
  id: string;
  user_id: string;
  kind: ModerationNoticeKind;
  reason: string | null;
  target_type: string | null;
  target_id: string | null;
  created_at: string;
  read_at: string | null;
};

type DatabaseOverrides = {
  public: {
    Views: {
      announcements: {
        Row: AnnouncementRow;
        Insert: AnnouncementWrite & {
          driver_id: string;
          description: string;
          location: string;
        };
        Update: AnnouncementWrite & {
          driver_id?: string;
          description?: string;
          location?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'announcements_driver_id_fkey';
            columns: ['driver_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'announcements_mechanic_id_fkey';
            columns: ['mechanic_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: ProfileRow;
        Insert: ProfileWrite & {
          id: string;
          full_name: string;
          role: string;
        };
        Update: ProfileWrite & {
          id?: string;
          full_name?: string;
          role?: string;
        };
        Relationships: [];
      };
      guest_announcements: {
        Relationships: [
          {
            foreignKeyName: 'announcements_driver_id_fkey';
            columns: ['driver_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      // Cheie nouă (lipsește din tipul generat): MergeDeep o adaugă neschimbată (`B[K]`).
      moderation_notices: {
        Row: ModerationNoticeRow;
        Insert: never;
        Update: { read_at?: string | null };
        Relationships: [];
      };
    };
  };
};

/** Schema folosită de client (`createClient<Database>`): cea generată + corecțiile de mai sus. */
export type Database = MergeDeep<GeneratedDatabase, DatabaseOverrides>;

type PublicSchema = Database['public'];
type PublicRelations = PublicSchema['Tables'] & PublicSchema['Views'];

/** `Row` pentru un tabel sau view din `public`, pe schema corectată. */
export type Tables<Name extends keyof PublicRelations> = PublicRelations[Name]['Row'];
/** `Insert` pentru un tabel sau view scriibil din `public`, pe schema corectată. */
export type TablesInsert<Name extends keyof PublicRelations> = PublicRelations[Name] extends {
  Insert: infer I;
}
  ? I
  : never;
/** `Update` pentru un tabel sau view scriibil din `public`, pe schema corectată. */
export type TablesUpdate<Name extends keyof PublicRelations> = PublicRelations[Name] extends {
  Update: infer U;
}
  ? U
  : never;
