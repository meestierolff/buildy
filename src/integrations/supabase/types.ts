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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      comments: {
        Row: {
          content: string
          created_at: string
          id: string
          mentions: string[] | null
          parent_id: string | null
          step_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          mentions?: string[] | null
          parent_id?: string | null
          step_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          mentions?: string[] | null
          parent_id?: string | null
          step_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "steps"
            referencedColumns: ["id"]
          },
        ]
      }
      favorites: {
        Row: {
          created_at: string
          id: string
          project_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          user_id?: string
        }
        Relationships: []
      }
      follows: {
        Row: {
          created_at: string
          id: string
          project_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          user_id?: string
        }
        Relationships: []
      }
      likes: {
        Row: {
          created_at: string
          id: string
          step_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          step_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          step_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "likes_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "steps"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          actor_id: string | null
          created_at: string
          id: string
          message: string | null
          project_id: string | null
          read: boolean
          step_id: string | null
          type: string
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          id?: string
          message?: string | null
          project_id?: string | null
          read?: boolean
          step_id?: string | null
          type: string
          user_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          id?: string
          message?: string | null
          project_id?: string | null
          read?: boolean
          step_id?: string | null
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      photobook_excluded_media: {
        Row: {
          created_at: string
          media_id: string
          trip_id: string
        }
        Insert: {
          created_at?: string
          media_id: string
          trip_id: string
        }
        Update: {
          created_at?: string
          media_id?: string
          trip_id?: string
        }
        Relationships: []
      }
      photobook_excluded_steps: {
        Row: {
          created_at: string
          step_id: string
          trip_id: string
        }
        Insert: {
          created_at?: string
          step_id: string
          trip_id: string
        }
        Update: {
          created_at?: string
          step_id?: string
          trip_id?: string
        }
        Relationships: []
      }
      photobook_settings: {
        Row: {
          chapter_overrides: Json
          cover_media_id: string | null
          cover_subtitle: string | null
          cover_title: string | null
          step_layout_overrides: Json
          step_photo_order: Json
          trip_id: string
          updated_at: string
        }
        Insert: {
          chapter_overrides?: Json
          cover_media_id?: string | null
          cover_subtitle?: string | null
          cover_title?: string | null
          step_layout_overrides?: Json
          step_photo_order?: Json
          trip_id: string
          updated_at?: string
        }
        Update: {
          chapter_overrides?: Json
          cover_media_id?: string | null
          cover_subtitle?: string | null
          cover_title?: string | null
          step_layout_overrides?: Json
          step_photo_order?: Json
          trip_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          display_name: string
          id: string
          is_private: boolean
          is_pro: boolean
          location: string | null
          onboarded: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string
          id?: string
          is_private?: boolean
          is_pro?: boolean
          location?: string | null
          onboarded?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string
          id?: string
          is_private?: boolean
          is_pro?: boolean
          location?: string | null
          onboarded?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          step_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          step_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          step_id?: string
          user_id?: string
        }
        Relationships: []
      }
      step_budget: {
        Row: {
          cost: number | null
          hours_spent: number | null
          step_id: string
          trip_id: string
          updated_at: string
          work_type: string | null
        }
        Insert: {
          cost?: number | null
          hours_spent?: number | null
          step_id: string
          trip_id: string
          updated_at?: string
          work_type?: string | null
        }
        Update: {
          cost?: number | null
          hours_spent?: number | null
          step_id?: string
          trip_id?: string
          updated_at?: string
          work_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "step_budget_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: true
            referencedRelation: "steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "step_budget_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      step_media: {
        Row: {
          compare_role: string | null
          created_at: string
          id: string
          media_type: string
          media_url: string
          sort_order: number
          step_id: string
          user_id: string
        }
        Insert: {
          compare_role?: string | null
          created_at?: string
          id?: string
          media_type?: string
          media_url: string
          sort_order?: number
          step_id: string
          user_id: string
        }
        Update: {
          compare_role?: string | null
          created_at?: string
          id?: string
          media_type?: string
          media_url?: string
          sort_order?: number
          step_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "step_media_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "steps"
            referencedColumns: ["id"]
          },
        ]
      }
      steps: {
        Row: {
          country: string | null
          created_at: string
          description: string | null
          floorplan_id: string | null
          floorplan_x: number | null
          floorplan_y: number | null
          id: string
          is_milestone: boolean
          latitude: number | null
          location_name: string
          longitude: number | null
          phase: string | null
          room: string | null
          step_date: string
          step_order: number
          travel_hours: number | null
          trip_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          country?: string | null
          created_at?: string
          description?: string | null
          floorplan_id?: string | null
          floorplan_x?: number | null
          floorplan_y?: number | null
          id?: string
          is_milestone?: boolean
          latitude?: number | null
          location_name: string
          longitude?: number | null
          phase?: string | null
          room?: string | null
          step_date: string
          step_order?: number
          travel_hours?: number | null
          trip_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          country?: string | null
          created_at?: string
          description?: string | null
          floorplan_id?: string | null
          floorplan_x?: number | null
          floorplan_y?: number | null
          id?: string
          is_milestone?: boolean
          latitude?: number | null
          location_name?: string
          longitude?: number | null
          phase?: string | null
          room?: string | null
          step_date?: string
          step_order?: number
          travel_hours?: number | null
          trip_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "steps_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_private_info: {
        Row: {
          address: string | null
          trip_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          trip_id: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          trip_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_private_info_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: true
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trips: {
        Row: {
          budget_public: boolean
          budget_total: number | null
          countries: string[] | null
          cover_image_url: string | null
          cover_position_y: number
          cover_title_position: string
          created_at: string
          custom_phases: string[]
          description: string | null
          end_date: string | null
          floorplan_url: string | null
          floorplans: Json
          id: string
          is_public: boolean
          progress_mode: string
          progress_percentage: number
          project_type: string | null
          start_date: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          budget_public?: boolean
          budget_total?: number | null
          countries?: string[] | null
          cover_image_url?: string | null
          cover_position_y?: number
          cover_title_position?: string
          created_at?: string
          custom_phases?: string[]
          description?: string | null
          end_date?: string | null
          floorplan_url?: string | null
          floorplans?: Json
          id?: string
          is_public?: boolean
          progress_mode?: string
          progress_percentage?: number
          project_type?: string | null
          start_date?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          budget_public?: boolean
          budget_total?: number | null
          countries?: string[] | null
          cover_image_url?: string | null
          cover_position_y?: number
          cover_title_position?: string
          created_at?: string
          custom_phases?: string[]
          description?: string | null
          end_date?: string | null
          floorplan_url?: string | null
          floorplans?: Json
          id?: string
          is_public?: boolean
          progress_mode?: string
          progress_percentage?: number
          project_type?: string | null
          start_date?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_follows: {
        Row: {
          created_at: string
          follower_id: string
          following_id: string
          id: string
        }
        Insert: {
          created_at?: string
          follower_id: string
          following_id: string
          id?: string
        }
        Update: {
          created_at?: string
          follower_id?: string
          following_id?: string
          id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_view_budget: { Args: { _trip_id: string }; Returns: boolean }
      can_view_step: { Args: { _step_id: string }; Returns: boolean }
      can_view_trip: { Args: { _trip_id: string }; Returns: boolean }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
