export type Role = 'driver' | 'mechanic';
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
  created_at: string;
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
  latitude: number | null;
  longitude: number | null;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  announcement_id: string | null; // NULL = conversație directă (fără anunț), Faza 7
  driver_id: string;
  mechanic_id: string;
  created_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
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
  created_at: string;
}

export interface Truck {
  id: string;
  driver_id: string;
  make: string;
  model: string;
  year: number;
  nickname: string | null;
  plate_number: string | null;
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
  content: string;
  created_at: string;
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Omit<Profile, 'created_at'>;
        Update: Partial<Omit<Profile, 'id' | 'created_at' | 'role'>>;
      };
      announcements: {
        Row: Announcement;
        Insert: Omit<Announcement, 'id' | 'created_at' | 'updated_at'> & {
          status?: AnnouncementStatus;
          mechanic_id?: string | null;
          truck_make?: string | null;
          truck_model?: string | null;
          truck_year?: number | null;
          plate_number?: string | null;
          latitude?: number | null;
          longitude?: number | null;
        };
        Update: Partial<Omit<Announcement, 'id' | 'driver_id' | 'created_at'>>;
      };
      conversations: {
        Row: Conversation;
        Insert: Omit<Conversation, 'id' | 'created_at'>;
        Update: never;
      };
      messages: {
        Row: Message;
        Insert: Omit<Message, 'id' | 'created_at'>;
        Update: never;
      };
      applications: {
        Row: Application;
        Insert: Omit<Application, 'id' | 'created_at' | 'status'> & { status?: ApplicationStatus };
        Update: never;
      };
      trucks: {
        Row: Truck;
        Insert: Omit<Truck, 'id' | 'created_at'>;
        Update: Partial<Pick<Truck, 'make' | 'model' | 'year' | 'nickname' | 'plate_number'>>;
      };
      conversation_deletions: {
        Row: { conversation_id: string; user_id: string; deleted_at: string };
        Insert: { conversation_id: string; user_id: string };
        Update: never;
      };
      message_reads: {
        Row: { conversation_id: string; user_id: string; last_read_at: string };
        Insert: { conversation_id: string; user_id: string; last_read_at?: string };
        Update: { last_read_at: string };
      };
      channels: {
        Row: Channel;
        Insert: Omit<Channel, 'id' | 'created_at'>;
        Update: never;
      };
      channel_messages: {
        Row: ChannelMessage;
        Insert: Omit<ChannelMessage, 'id' | 'created_at'>;
        Update: never;
      };
      channel_reads: {
        Row: { channel_id: string; user_id: string; last_read_at: string };
        Insert: { channel_id: string; user_id: string; last_read_at?: string };
        Update: { last_read_at: string };
      };
    };
    Functions: {
      accept_announcement: {
        Args: { p_announcement_id: string };
        Returns: void;
      };
      start_direct_conversation: {
        Args: { p_mechanic_id: string };
        Returns: string;
      };
      search_mechanics: {
        Args: { p_query: string };
        Returns: Pick<Profile, 'id' | 'full_name' | 'specialization' | 'activity_zone'>[];
      };
      get_mechanic_phone: {
        Args: { p_mechanic_id: string };
        Returns: string | null;
      };
      get_driver_phone: {
        Args: { p_driver_id: string };
        Returns: string | null;
      };
      apply_to_announcement: {
        Args: {
          p_announcement_id: string;
          p_price_type: PriceType;
          p_price_amount: number;
          p_currency?: string;
          p_message?: string | null;
        };
        Returns: void;
      };
      accept_application: {
        Args: { p_application_id: string };
        Returns: string;
      };
      reject_application: {
        Args: { p_application_id: string };
        Returns: void;
      };
      withdraw_application: {
        Args: { p_application_id: string };
        Returns: void;
      };
      dismiss_application: {
        Args: { p_application_id: string };
        Returns: void;
      };
      resubmit_application: {
        Args: {
          p_application_id: string;
          p_price_type: PriceType;
          p_price_amount: number;
          p_currency?: string;
          p_message?: string | null;
        };
        Returns: void;
      };
    };
  };
}
