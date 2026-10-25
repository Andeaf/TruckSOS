// Tipurile de domeniu folosite în aplicație. Schema exactă a bazei de date (tabele + RPC-uri)
// e generată în ./supabase.ts cu `npm run gen:types` și tipizează clientul Supabase.

export type Role = 'driver' | 'mechanic' | 'admin';
export type AnnouncementStatus = 'open' | 'accepted' | 'resolved' | 'cancelled';
export type ApplicationStatus = 'pending' | 'accepted' | 'rejected';
export type PriceType = 'fixed' | 'hourly';
export type ChannelType = 'global' | 'regional';

export interface Profile {
  id: string;
  full_name: string;
  role: Role;
  specialization: string | null;
  activity_zone: string | null;
  phone: string | null;
  /** Firma/angajatorul (ambele roluri). Public, ca semnal de încredere. */
  company_name: string | null;
  /** Email de contact ales de utilizator (separat de auth.users.email). Public. */
  contact_email: string | null;
  /** Faza 18: obligatorie aplicativ la mecanici (afișată public), opțională la șoferi. */
  address: string | null;
  /** Faza 18: TVA/CUI, normalizat uppercase fără spații. Aceleași reguli de rol ca address. */
  vat_number: string | null;
  /** Path în bucketul `photos`: `avatars/{user_id}/{uuid}.jpg`. NULL = fallback pe inițiale. */
  avatar_path: string | null;
  /** Medie denormalizată (1 zecimală), întreținută de trigger. 0 = fără evaluări. */
  rating_avg: number;
  rating_count: number;
  /** Comutatorul global de notificări din Setări. */
  push_enabled: boolean;
  /** 8 sept 2026: notificări la anunț nou pe Market. Pornit implicit; push_enabled îl domină. */
  market_push_enabled: boolean;
  /** 1.1 (G): notificări la mențiuni/reply, pornit implicit; push_enabled îl domină. */
  mention_push_enabled: boolean;
  /** Mecanic: raza (km) peste care nu mai vrea anunțuri noi. NULL = primește tot. */
  notify_radius_km: number | null;
  /** Mecanic: poziția de referință (atelier/domiciliu), pentru filtrul de rază. */
  latitude: number | null;
  longitude: number | null;
  /** Limba în care serverul compune textul notificărilor. */
  lang: string;
  /** Faza 15: piatră-funerară. NOT NULL = cont șters (PII golit); UI afișează „Utilizator șters". */
  deleted_at: string | null;
  /** Faza 16: ban aplicativ. NOT NULL = cont banat (setat DOAR prin admin_ban_user). */
  banned_at: string | null;
  /** Faza 16: NULL = ban permanent; altfel banul expiră automat la depășirea datei. */
  banned_until: string | null;
  /** Faza 16: motivul banului, afișat (localizat) pe ecranul de ban. */
  ban_reason: string | null;
  created_at: string;
}

/** Ce arătăm despre un alt utilizator în liste/carduri: nume + avatar (+ marcaj de cont șters). */
export type PublicUser = Pick<Profile, 'full_name' | 'avatar_path' | 'deleted_at'>;

/** Menționare „@Nume" pe un mesaj (10 sept 2026, coloana jsonb `mentions`, migrarea
 * 20260910): id-ul persoanei + numele EXACT inserat în text — bula evidențiază acel
 * „@Nume" și îl face apăsabil (→ profil). */
export interface MessageMention {
  id: string;
  name: string;
}

/** Mecanic favorit al unui șofer. PK compus (driver_id, mechanic_id). */
export interface FavoriteMechanic {
  driver_id: string;
  mechanic_id: string;
  created_at: string;
}

/** Intrare în istoricul de căutare al șoferului. PK compus → dedup prin upsert. */
export interface SearchHistoryEntry {
  driver_id: string;
  mechanic_id: string;
  searched_at: string;
}

/** Evaluare dată de un șofer unui mecanic. UNIQUE(mechanic_id, driver_id) → upsert. */
export interface Rating {
  id: string;
  mechanic_id: string;
  driver_id: string;
  stars: number;
  comment: string | null;
  created_at: string;
  updated_at: string;
}

export interface Announcement {
  id: string;
  driver_id: string;
  description: string;
  location: string;
  status: AnnouncementStatus;
  mechanic_id: string | null;
  truck_make: string | null;
  truck_model: string | null;
  truck_year: number | null;
  plate_number: string | null;
  /** Seria de șasiu (VIN) — obligatorie la anunțuri NOI (client-side); NULL istoric. */
  chassis_number: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Soft-delete DOAR pentru ecranul de Istoric; anunțul rămâne în DB (Faza 9.3). */
  hidden_from_history: boolean;
  /** 1.1 (H): limba sursă (presupusă la publicare, confirmată de detecție). */
  source_lang: string | null;
  /** 1.1 (H): true = `source_lang` confirmat de detecție (doar atunci se ascunde „Tradu”). */
  source_lang_detected: boolean;
  created_at: string;
  updated_at: string;
}

export interface AnnouncementPhoto {
  id: string;
  announcement_id: string;
  storage_path: string;
  created_at: string;
}

export interface Conversation {
  id: string;
  announcement_id: string | null; // NULL = conversație directă (fără anunț), Faza 7
  /** Faza 19 (Opțiunea C): semantic = INIȚIATORUL conversației (la market: cumpărătorul,
   * indiferent de rolul lui real). Numele coloanei e istoric, nu o garanție de rol. */
  driver_id: string;
  /** Faza 19: semantic = DESTINATARUL (la market: vânzătorul, indiferent de rol). */
  mechanic_id: string;
  /** Faza 15: true = conversație directă autentică (start_direct_conversation); false = pe anunț
   * SAU orfanată de un anunț șters. Indexul unic de perechi directe se aplică doar celor true. */
  is_direct: boolean;
  /** Faza 19: conversație de MARKET (NOT NULL) — contextul e anunțul de vânzare; SET NULL la ștergere. */
  listing_id: string | null;
  created_at: string;
  /** 11 aug: created_at al ultimului mesaj (trigger, migrarea 20260811) — sortarea listei.
   * Absent pe schema veche → clientul cade pe created_at. */
  last_message_at?: string | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  /** Gol ('') când mesajul e o poză SAU când e șters (tombstone). */
  content: string;
  /** Path în bucket-ul `photos` (`chat/{conv}/{uuid}.jpg`); null pt. mesaj text/șters. */
  image_path: string | null;
  /** Faza 14: tombstone — mesaj șters „pentru toți", bula rămâne cu text discret. */
  deleted_at: string | null;
  /** Faza 14: mesaj editat (fereastră 3 min) → etichetă „editat". */
  edited_at: string | null;
  /** Faza 14: reply — mesajul citat (același tabel), NULL dacă citatul a fost șters din DB. */
  reply_to_id: string | null;
  /** Faza 16: true = tombstone pus de un moderator (marcaj distinct „Șters de moderator"). */
  deleted_by_admin: boolean;
  /** Faza 19.4: contextul de anunț de market atașat mesajului („Sunt interesat" cu
   * cardul anunțului deasupra); SET NULL dacă anunțul dispare. */
  listing_id: string | null;
  /** Faza 19.5: mecanicul recomandat atașat mesajului; SET NULL dacă profilul dispare. */
  recommended_mechanic_id: string | null;
  /** Faza 19.6: anunțul de DEPANARE distribuit (share); SET NULL dacă anunțul dispare. */
  announcement_id: string | null;
  /** Faza 19.5: mesaj-fișier (un fișier = o bulă; content=''). Path în bucketul `photos`
   * (`chat/{conv}/{uuid}.{ext}`); numele ORIGINAL trăiește doar în file_name. */
  file_path: string | null;
  file_name: string | null;
  file_size: number | null;
  /** 24 aug: durata în secunde, doar la videoclipuri (meta „Videoclip · 0:12"). */
  file_duration: number | null;
  /** 10 sept: menționările „@Nume" din text (null/lipsă = niciuna sau schemă veche). */
  mentions?: MessageMention[] | null;
  created_at: string;
}

export interface Application {
  id: string;
  announcement_id: string;
  mechanic_id: string;
  price_type: PriceType;
  price_amount: number;
  currency: string;
  message: string | null;
  status: ApplicationStatus;
  /** Faza 14.10: bumpat de trigger la orice UPDATE (accept/reject/dismiss) — pt. bulina de Candidaturi. */
  updated_at: string;
  created_at: string;
}

export interface Truck {
  id: string;
  /** Proprietarul camionului (istoric „driver", dar orice rol poate salva camioane). */
  driver_id: string;
  make: string;
  model: string;
  year: number;
  nickname: string | null;
  plate_number: string | null;
  /** Seria de șasiu (VIN) — opțională pe camioanele salvate. */
  chassis_number: string | null;
  created_at: string;
}

export type ReportReason = 'spam' | 'harassment' | 'inappropriate' | 'scam' | 'other';
export type ReportStatus = 'pending' | 'reviewed' | 'dismissed';

/** Raport pe mesaj (cu snapshot), pe utilizator (message_id null) sau pe anunț de market
 * (listing_id, Faza 19). Faza 14.5. */
export interface Report {
  id: string;
  reporter_id: string;
  reported_user_id: string;
  message_id: string | null;
  message_table: 'messages' | 'channel_messages' | null;
  /** Faza 19: raport pe anunț de market; SET NULL dacă anunțul dispare (snapshot-ul rămâne). */
  listing_id: string | null;
  reason: ReportReason;
  details: string | null;
  content_snapshot: string | null;
  image_path_snapshot: string | null;
  status: ReportStatus;
  created_at: string;
}

/** Faza 19 — Market: anunț de vânzare (ambele roluri postează). */
export type MarketCategory = 'tires' | 'parts' | 'trucks' | 'trailers' | 'accessories' | 'other';
export type MarketListingStatus = 'active' | 'sold';

export interface MarketListing {
  id: string;
  seller_id: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  category: MarketCategory;
  status: MarketListingStatus;
  created_at: string;
  updated_at: string;
}

/** Poză de anunț market. Spre deosebire de announcement_photos, are `position`:
 * cover = poziția 0, editabilă (anunțul de market se poate edita, cel de depanare nu). */
export interface MarketListingPhoto {
  id: string;
  listing_id: string;
  storage_path: string;
  position: number;
  created_at: string;
}

export interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  created_at: string;
}

export interface ChannelMessage {
  id: string;
  channel_id: string;
  sender_id: string;
  /** Gol ('') când mesajul e o poză SAU când e șters (tombstone). */
  content: string;
  /** Path în bucket-ul `photos` (`channel/{channel}/{uuid}.jpg`); null pt. mesaj text/șters. */
  image_path: string | null;
  /** Faza 14: tombstone — mesaj șters „pentru toți". */
  deleted_at: string | null;
  /** Faza 14: mesaj editat (fereastră 3 min). */
  edited_at: string | null;
  /** Faza 14: reply — mesajul citat (același tabel). */
  reply_to_id: string | null;
  /** Faza 16: true = tombstone pus de un moderator (marcaj distinct „Șters de moderator"). */
  deleted_by_admin: boolean;
  /** Faza 19.5/19.6: paritate cu chatul privat — anunțuri, mecanic recomandat, fișier. */
  listing_id: string | null;
  recommended_mechanic_id: string | null;
  announcement_id: string | null;
  file_path: string | null;
  file_name: string | null;
  file_size: number | null;
  /** 24 aug: durata în secunde, doar la videoclipuri (paritate cu chatul privat). */
  file_duration: number | null;
  /** 10 sept: menționările „@Nume" din text (paritate cu chatul privat). */
  mentions?: MessageMention[] | null;
  created_at: string;
}

/** Faza 16: o intrare în jurnalul de audit al acțiunilor de admin. Doar-citire (scris server-side). */
export interface AdminAuditEntry {
  id: string;
  admin_id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

// ── 1.1 (B): ce primește un oaspete (rolul `anon`) — proiecțiile pure din migrarea B1 ──
// Doar coloanele acordate lui `anon`: fără telefon, adresă, TVA, e-mail de contact,
// coordonate exacte, plăcuță, VIN, căi de fișiere. Toate se citesc fără sesiune.

/** 1.1 (B): view guest_* (migrarea 20261026). */
export interface GuestProfile {
  id: string;
  full_name: string;
  role: Role;
  avatar_path: string | null;
  specialization: string | null;
  activity_zone: string | null;
  company_name: string | null;
  rating_avg: number;
  rating_count: number;
  created_at: string;
}

/** 1.1 (B): view guest_* (migrarea 20261026). */
export interface GuestAnnouncement {
  id: string;
  driver_id: string;
  description: string;
  location: string;
  status: AnnouncementStatus;
  created_at: string;
  truck_make: string | null;
  truck_model: string | null;
  truck_year: number | null;
  /** Coordonate rotunjite la 2 zecimale (~1 km), coloane generate pe `announcements`. */
  lat_approx: number | null;
  lng_approx: number | null;
}

/** 1.1 (B): view guest_* (migrarea 20261026). */
export interface GuestAnnouncementPhoto {
  id: string;
  announcement_id: string;
  storage_path: string;
  created_at: string;
}

/** 1.1 (B): view guest_* (migrarea 20261026). */
export interface GuestMarketListing {
  id: string;
  seller_id: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  category: MarketCategory;
  status: MarketListingStatus;
  created_at: string;
}

/** 1.1 (B): view guest_* (migrarea 20261026). */
export interface GuestMarketListingPhoto {
  id: string;
  listing_id: string;
  storage_path: string;
  position: number;
}

/** 1.1 (B): view guest_* (migrarea 20261026). */
export interface GuestChannel {
  id: string;
  name: string;
  type: ChannelType;
  created_at: string;
}

/** 1.1 (B): view guest_* (migrarea 20261026).
 * Max 50 de mesaje per canal, ultimele 7 zile; poza nu se vede, doar `has_image`. */
export interface GuestChannelMessage {
  id: string;
  channel_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  reply_to_id: string | null;
  mentions: MessageMention[] | null;
  has_image: boolean;
  announcement_id: string | null;
  listing_id: string | null;
  recommended_mechanic_id: string | null;
}
