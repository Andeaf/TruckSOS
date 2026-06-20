export type Role = 'driver' | 'mechanic';
export type AnnouncementStatus = 'open' | 'accepted' | 'resolved';

export interface Profile {
  id: string;
  full_name: string;
  role: Role;
  created_at: string;
}

export interface Announcement {
  id: string;
  driver_id: string;
  description: string;
  location: string;
  status: AnnouncementStatus;
  mechanic_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  announcement_id: string;
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

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Omit<Profile, 'created_at'>;
        Update: Partial<Omit<Profile, 'id' | 'created_at'>>;
      };
      announcements: {
        Row: Announcement;
        Insert: Omit<Announcement, 'id' | 'created_at' | 'updated_at'> & {
          status?: AnnouncementStatus;
          mechanic_id?: string | null;
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
    };
    Functions: {
      accept_announcement: {
        Args: { p_announcement_id: string };
        Returns: void;
      };
    };
  };
}
