export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string
          admin_id: string
          created_at: string
          details: Json
          id: string
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          admin_id: string
          created_at?: string
          details?: Json
          id?: string
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          admin_id?: string
          created_at?: string
          details?: Json
          id?: string
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_log_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      announcement_photos: {
        Row: {
          announcement_id: string
          created_at: string
          id: string
          storage_path: string
        }
        Insert: {
          announcement_id: string
          created_at?: string
          id?: string
          storage_path: string
        }
        Update: {
          announcement_id?: string
          created_at?: string
          id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_photos_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
        ]
      }
      announcement_views: {
        Row: {
          announcement_id: string
          viewed_at: string
          viewer_id: string
        }
        Insert: {
          announcement_id: string
          viewed_at?: string
          viewer_id: string
        }
        Update: {
          announcement_id?: string
          viewed_at?: string
          viewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_views_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          chassis_number: string | null
          created_at: string | null
          description: string
          driver_id: string
          hidden_from_history: boolean
          id: string
          latitude: number | null
          location: string
          longitude: number | null
          mechanic_id: string | null
          plate_number: string | null
          status: string
          truck_make: string | null
          truck_model: string | null
          truck_year: number | null
          updated_at: string | null
        }
        Insert: {
          chassis_number?: string | null
          created_at?: string | null
          description: string
          driver_id: string
          hidden_from_history?: boolean
          id?: string
          latitude?: number | null
          location: string
          longitude?: number | null
          mechanic_id?: string | null
          plate_number?: string | null
          status?: string
          truck_make?: string | null
          truck_model?: string | null
          truck_year?: number | null
          updated_at?: string | null
        }
        Update: {
          chassis_number?: string | null
          created_at?: string | null
          description?: string
          driver_id?: string
          hidden_from_history?: boolean
          id?: string
          latitude?: number | null
          location?: string
          longitude?: number | null
          mechanic_id?: string | null
          plate_number?: string | null
          status?: string
          truck_make?: string | null
          truck_model?: string | null
          truck_year?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "announcements_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcements_mechanic_id_fkey"
            columns: ["mechanic_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      app_versions: {
        Row: {
          latest_version: string
          platform: string
          store_url: string
          updated_at: string
        }
        Insert: {
          latest_version: string
          platform: string
          store_url: string
          updated_at?: string
        }
        Update: {
          latest_version?: string
          platform?: string
          store_url?: string
          updated_at?: string
        }
        Relationships: []
      }
      applications: {
        Row: {
          announcement_id: string
          created_at: string
          currency: string
          id: string
          mechanic_id: string
          message: string | null
          price_amount: number
          price_type: string
          status: string
          updated_at: string
        }
        Insert: {
          announcement_id: string
          created_at?: string
          currency?: string
          id?: string
          mechanic_id: string
          message?: string | null
          price_amount: number
          price_type: string
          status?: string
          updated_at?: string
        }
        Update: {
          announcement_id?: string
          created_at?: string
          currency?: string
          id?: string
          mechanic_id?: string
          message?: string | null
          price_amount?: number
          price_type?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "applications_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_mechanic_id_fkey"
            columns: ["mechanic_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      blocked_users: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocked_users_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocked_users_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_messages: {
        Row: {
          announcement_id: string | null
          channel_id: string
          content: string
          created_at: string
          deleted_at: string | null
          deleted_by_admin: boolean
          edited_at: string | null
          file_duration: number | null
          file_name: string | null
          file_path: string | null
          file_size: number | null
          id: string
          image_path: string | null
          listing_id: string | null
          mentions: Json | null
          recommended_mechanic_id: string | null
          reply_to_id: string | null
          sender_id: string
        }
        Insert: {
          announcement_id?: string | null
          channel_id: string
          content: string
          created_at?: string
          deleted_at?: string | null
          deleted_by_admin?: boolean
          edited_at?: string | null
          file_duration?: number | null
          file_name?: string | null
          file_path?: string | null
          file_size?: number | null
          id?: string
          image_path?: string | null
          listing_id?: string | null
          mentions?: Json | null
          recommended_mechanic_id?: string | null
          reply_to_id?: string | null
          sender_id: string
        }
        Update: {
          announcement_id?: string | null
          channel_id?: string
          content?: string
          created_at?: string
          deleted_at?: string | null
          deleted_by_admin?: boolean
          edited_at?: string | null
          file_duration?: number | null
          file_name?: string | null
          file_path?: string | null
          file_size?: number | null
          id?: string
          image_path?: string | null
          listing_id?: string | null
          mentions?: Json | null
          recommended_mechanic_id?: string | null
          reply_to_id?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_messages_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_messages_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_messages_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "market_listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_messages_recommended_mechanic_id_fkey"
            columns: ["recommended_mechanic_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "channel_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_push_prefs: {
        Row: {
          channel_id: string
          enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          channel_id: string
          enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          channel_id?: string
          enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_push_prefs_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_push_prefs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_push_state: {
        Row: {
          channel_id: string
          last_pushed_at: string
          user_id: string
        }
        Insert: {
          channel_id: string
          last_pushed_at?: string
          user_id: string
        }
        Update: {
          channel_id?: string
          last_pushed_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_push_state_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_push_state_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_reads: {
        Row: {
          channel_id: string
          last_read_at: string
          user_id: string
        }
        Insert: {
          channel_id: string
          last_read_at?: string
          user_id: string
        }
        Update: {
          channel_id?: string
          last_read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_reads_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      channels: {
        Row: {
          created_at: string
          id: string
          name: string
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          type?: string
        }
        Relationships: []
      }
      conversation_deletions: {
        Row: {
          conversation_id: string
          deleted_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          deleted_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          deleted_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_deletions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_deletions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          announcement_id: string | null
          created_at: string | null
          driver_id: string
          id: string
          is_direct: boolean
          listing_id: string | null
          mechanic_id: string
        }
        Insert: {
          announcement_id?: string | null
          created_at?: string | null
          driver_id: string
          id?: string
          is_direct?: boolean
          listing_id?: string | null
          mechanic_id: string
        }
        Update: {
          announcement_id?: string | null
          created_at?: string | null
          driver_id?: string
          id?: string
          is_direct?: boolean
          listing_id?: string | null
          mechanic_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: true
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "market_listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_mechanic_id_fkey"
            columns: ["mechanic_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      favorite_mechanics: {
        Row: {
          created_at: string
          driver_id: string
          mechanic_id: string
        }
        Insert: {
          created_at?: string
          driver_id: string
          mechanic_id: string
        }
        Update: {
          created_at?: string
          driver_id?: string
          mechanic_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorite_mechanics_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorite_mechanics_mechanic_id_fkey"
            columns: ["mechanic_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      market_listing_photos: {
        Row: {
          created_at: string
          id: string
          listing_id: string
          position: number
          storage_path: string
        }
        Insert: {
          created_at?: string
          id?: string
          listing_id: string
          position?: number
          storage_path: string
        }
        Update: {
          created_at?: string
          id?: string
          listing_id?: string
          position?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_listing_photos_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "market_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      market_listings: {
        Row: {
          category: string
          created_at: string
          currency: string
          description: string
          id: string
          price: number
          seller_id: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          currency?: string
          description: string
          id?: string
          price: number
          seller_id: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          currency?: string
          description?: string
          id?: string
          price?: number
          seller_id?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_listings_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reads: {
        Row: {
          conversation_id: string
          last_read_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          last_read_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          last_read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reads_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          announcement_id: string | null
          content: string
          conversation_id: string
          created_at: string | null
          deleted_at: string | null
          deleted_by_admin: boolean
          edited_at: string | null
          file_duration: number | null
          file_name: string | null
          file_path: string | null
          file_size: number | null
          id: string
          image_path: string | null
          listing_id: string | null
          mentions: Json | null
          recommended_mechanic_id: string | null
          reply_to_id: string | null
          sender_id: string
        }
        Insert: {
          announcement_id?: string | null
          content: string
          conversation_id: string
          created_at?: string | null
          deleted_at?: string | null
          deleted_by_admin?: boolean
          edited_at?: string | null
          file_duration?: number | null
          file_name?: string | null
          file_path?: string | null
          file_size?: number | null
          id?: string
          image_path?: string | null
          listing_id?: string | null
          mentions?: Json | null
          recommended_mechanic_id?: string | null
          reply_to_id?: string | null
          sender_id: string
        }
        Update: {
          announcement_id?: string | null
          content?: string
          conversation_id?: string
          created_at?: string | null
          deleted_at?: string | null
          deleted_by_admin?: boolean
          edited_at?: string | null
          file_duration?: number | null
          file_name?: string | null
          file_path?: string | null
          file_size?: number | null
          id?: string
          image_path?: string | null
          listing_id?: string | null
          mentions?: Json | null
          recommended_mechanic_id?: string | null
          reply_to_id?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "market_listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_recommended_mechanic_id_fkey"
            columns: ["recommended_mechanic_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          activity_zone: string | null
          address: string | null
          avatar_path: string | null
          ban_reason: string | null
          banned_at: string | null
          banned_until: string | null
          company_name: string | null
          contact_email: string | null
          created_at: string | null
          deleted_at: string | null
          full_name: string
          id: string
          lang: string
          latitude: number | null
          longitude: number | null
          market_push_enabled: boolean
          notify_radius_km: number | null
          phone: string | null
          push_enabled: boolean
          rating_avg: number
          rating_count: number
          role: string
          specialization: string | null
          vat_number: string | null
        }
        Insert: {
          activity_zone?: string | null
          address?: string | null
          avatar_path?: string | null
          ban_reason?: string | null
          banned_at?: string | null
          banned_until?: string | null
          company_name?: string | null
          contact_email?: string | null
          created_at?: string | null
          deleted_at?: string | null
          full_name: string
          id: string
          lang?: string
          latitude?: number | null
          longitude?: number | null
          market_push_enabled?: boolean
          notify_radius_km?: number | null
          phone?: string | null
          push_enabled?: boolean
          rating_avg?: number
          rating_count?: number
          role: string
          specialization?: string | null
          vat_number?: string | null
        }
        Update: {
          activity_zone?: string | null
          address?: string | null
          avatar_path?: string | null
          ban_reason?: string | null
          banned_at?: string | null
          banned_until?: string | null
          company_name?: string | null
          contact_email?: string | null
          created_at?: string | null
          deleted_at?: string | null
          full_name?: string
          id?: string
          lang?: string
          latitude?: number | null
          longitude?: number | null
          market_push_enabled?: boolean
          notify_radius_km?: number | null
          phone?: string | null
          push_enabled?: boolean
          rating_avg?: number
          rating_count?: number
          role?: string
          specialization?: string | null
          vat_number?: string | null
        }
        Relationships: []
      }
      push_tokens: {
        Row: {
          app_build: string | null
          device_token: string | null
          platform: string | null
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          app_build?: string | null
          device_token?: string | null
          platform?: string | null
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          app_build?: string | null
          device_token?: string | null
          platform?: string | null
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ratings: {
        Row: {
          comment: string | null
          created_at: string
          driver_id: string
          id: string
          mechanic_id: string
          stars: number
          updated_at: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          driver_id: string
          id?: string
          mechanic_id: string
          stars: number
          updated_at?: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          driver_id?: string
          id?: string
          mechanic_id?: string
          stars?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ratings_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_mechanic_id_fkey"
            columns: ["mechanic_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          content_snapshot: string | null
          created_at: string
          details: string | null
          id: string
          image_path_snapshot: string | null
          listing_id: string | null
          message_id: string | null
          message_table: string | null
          reason: string
          reported_user_id: string
          reporter_id: string
          status: string
        }
        Insert: {
          content_snapshot?: string | null
          created_at?: string
          details?: string | null
          id?: string
          image_path_snapshot?: string | null
          listing_id?: string | null
          message_id?: string | null
          message_table?: string | null
          reason: string
          reported_user_id: string
          reporter_id: string
          status?: string
        }
        Update: {
          content_snapshot?: string | null
          created_at?: string
          details?: string | null
          id?: string
          image_path_snapshot?: string | null
          listing_id?: string | null
          message_id?: string | null
          message_table?: string | null
          reason?: string
          reported_user_id?: string
          reporter_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "market_listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reported_user_id_fkey"
            columns: ["reported_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      search_history: {
        Row: {
          driver_id: string
          mechanic_id: string
          searched_at: string
        }
        Insert: {
          driver_id: string
          mechanic_id: string
          searched_at?: string
        }
        Update: {
          driver_id?: string
          mechanic_id?: string
          searched_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "search_history_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_history_mechanic_id_fkey"
            columns: ["mechanic_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      trucks: {
        Row: {
          chassis_number: string | null
          created_at: string
          driver_id: string
          id: string
          make: string
          model: string
          nickname: string | null
          plate_number: string | null
          year: number
        }
        Insert: {
          chassis_number?: string | null
          created_at?: string
          driver_id: string
          id?: string
          make: string
          model: string
          nickname?: string | null
          plate_number?: string | null
          year: number
        }
        Update: {
          chassis_number?: string | null
          created_at?: string
          driver_id?: string
          id?: string
          make?: string
          model?: string
          nickname?: string | null
          plate_number?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "trucks_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _purge_user_data: { Args: { p_uid: string }; Returns: string[] }
      accept_announcement: {
        Args: { p_announcement_id: string }
        Returns: undefined
      }
      accept_application: {
        Args: { p_application_id: string }
        Returns: string
      }
      admin_ban_user: {
        Args: { p_reason: string; p_uid: string; p_until?: string }
        Returns: undefined
      }
      admin_dashboard_stats: { Args: never; Returns: Json }
      admin_delete_announcement: { Args: { p_id: string }; Returns: undefined }
      admin_delete_listing: { Args: { p_id: string }; Returns: undefined }
      admin_delete_message: {
        Args: { p_id: string; p_table: string }
        Returns: undefined
      }
      admin_delete_review: { Args: { p_id: string }; Returns: undefined }
      admin_list_channel_messages: { Args: { p_limit?: number }; Returns: Json }
      admin_list_recent_announcements: {
        Args: { p_limit?: number }
        Returns: Json
      }
      admin_list_recent_listings: { Args: { p_limit?: number }; Returns: Json }
      admin_list_recent_reviews: { Args: { p_limit?: number }; Returns: Json }
      admin_list_reports: { Args: { p_status?: string }; Returns: Json }
      admin_pending_reports_count: { Args: never; Returns: number }
      admin_report_context: {
        Args: {
          p_after?: number
          p_before?: number
          p_message_id: string
          p_table: string
        }
        Returns: Json
      }
      admin_report_conversation: {
        Args: { p_report_id: string }
        Returns: Json
      }
      admin_search_announcements: {
        Args: { p_limit?: number; p_query: string }
        Returns: Json
      }
      admin_search_users: { Args: { p_query: string }; Returns: Json }
      admin_unban_user: { Args: { p_uid: string }; Returns: undefined }
      admin_update_profile: {
        Args: { p_fields: Json; p_uid: string }
        Returns: undefined
      }
      admin_update_report_status: {
        Args: { p_id: string; p_status: string }
        Returns: undefined
      }
      admin_user_detail: { Args: { p_uid: string }; Returns: Json }
      apply_to_announcement: {
        Args: {
          p_announcement_id: string
          p_currency?: string
          p_message?: string
          p_price_amount: number
          p_price_type: string
        }
        Returns: undefined
      }
      block_user: { Args: { p_target: string }; Returns: undefined }
      claim_push_token: {
        Args: {
          p_app_build?: string
          p_device_token?: string
          p_platform?: string
          p_previous_token?: string
          p_token: string
        }
        Returns: undefined
      }
      delete_message: {
        Args: { p_id: string; p_table: string }
        Returns: undefined
      }
      dismiss_application: {
        Args: { p_application_id: string }
        Returns: undefined
      }
      distance_km: {
        Args: { lat1: number; lat2: number; lon1: number; lon2: number }
        Returns: number
      }
      edit_message: {
        Args: { p_content: string; p_id: string; p_table: string }
        Returns: undefined
      }
      get_driver_phone: { Args: { p_driver_id: string }; Returns: string }
      get_mechanic_phone: { Args: { p_mechanic_id: string }; Returns: string }
      is_admin: { Args: { p_uid?: string }; Returns: boolean }
      is_banned: { Args: { p_uid?: string }; Returns: boolean }
      is_block_between: { Args: { p_a: string; p_b: string }; Returns: boolean }
      is_blocked_by: {
        Args: { p_blocked: string; p_blocker: string }
        Returns: boolean
      }
      is_conversation_blocked: {
        Args: { p_conversation_id: string }
        Returns: boolean
      }
      notify_mechanics_new_announcement: {
        Args: {
          p_announcement: Database["public"]["Tables"]["announcements"]["Row"]
        }
        Returns: undefined
      }
      notify_push: {
        Args: {
          p_body: string
          p_data?: Json
          p_ios_body?: string
          p_ios_title?: string
          p_tag?: string
          p_title: string
          p_user_id: string
        }
        Returns: undefined
      }
      purge_user_data: { Args: never; Returns: string[] }
      push_text: { Args: { p_key: string; p_lang: string }; Returns: string }
      recompute_mechanic_rating: {
        Args: { p_mechanic: string }
        Returns: undefined
      }
      record_announcement_view: {
        Args: { p_announcement_id: string }
        Returns: undefined
      }
      reject_application: {
        Args: { p_application_id: string }
        Returns: undefined
      }
      repost_announcement: {
        Args: { p_announcement_id: string }
        Returns: undefined
      }
      resolve_open_announcement: {
        Args: { p_announcement_id: string }
        Returns: undefined
      }
      resubmit_application: {
        Args: {
          p_application_id: string
          p_currency?: string
          p_message?: string
          p_price_amount: number
          p_price_type: string
        }
        Returns: undefined
      }
      search_market_listings: {
        Args: {
          p_category?: string
          p_limit?: number
          p_offset?: number
          p_query: string
          p_sort?: string
        }
        Returns: {
          category: string
          created_at: string
          currency: string
          description: string
          id: string
          price: number
          seller_id: string
          status: string
          title: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "market_listings"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      search_mechanics: {
        Args: { p_query: string }
        Returns: {
          activity_zone: string
          avatar_path: string
          full_name: string
          id: string
          rating_avg: number
          rating_count: number
          specialization: string
        }[]
      }
      search_users: {
        Args: { p_query: string }
        Returns: {
          activity_zone: string
          avatar_path: string
          full_name: string
          id: string
          rating_avg: number
          rating_count: number
          role: string
          specialization: string
        }[]
      }
      set_announcements_hidden: { Args: { p_ids?: string[] }; Returns: number }
      start_direct_conversation: {
        Args: { p_mechanic_id: string }
        Returns: string
      }
      start_market_conversation: {
        Args: { p_listing_id: string }
        Returns: string
      }
      storage_api_delete: {
        Args: { p_bucket: string; p_name: string }
        Returns: undefined
      }
      user_lang: { Args: { p_user_id: string }; Returns: string }
      withdraw_application: {
        Args: { p_application_id: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
