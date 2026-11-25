type Table<Row, Insert, Update = Partial<Row>> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

type AssetRow = {
  id: string
  org_id: string
  asset_type_code: string
  internal_code: string
  name: string
  brand: string | null
  model: string | null
  serial_number: string | null
  acquired_at: string | null
  supplier_id: string | null
  purchase_document_path: string | null
  acquisition_value: number | null
  status: string
  location_id: string | null
  responsible_user_id: string | null
  notes: string | null
  active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

type OperationRow = {
  id: string
  org_id: string
  operation_number: number
  farm_id: string
  municipality: string | null
  field_location: string | null
  status: string
  operator_user_id: string | null
  responsible_user_id: string | null
  delivered_by_user_id: string | null
  received_by_user_id: string | null
  departure_at: string | null
  returned_at: string | null
  notes: string | null
  created_by: string
  created_at: string
}

export interface Database {
  public: {
    Tables: {
      assets: Table<
        AssetRow,
        Pick<AssetRow, 'org_id' | 'asset_type_code' | 'internal_code' | 'name'> &
          Partial<Omit<AssetRow, 'id' | 'created_by' | 'created_at' | 'updated_at'>>
      >
      asset_types: Table<
        { id: string; org_id: string; code: string; name: string; active: boolean },
        { org_id: string; code: string; name: string; id?: string; active?: boolean }
      >
      asset_statuses: Table<
        { org_id: string; code: string; name: string; active: boolean },
        { org_id: string; code: string; name: string; active?: boolean }
      >
      locations: Table<
        {
          id: string
          org_id: string
          name: string
          location_type: string
          address: string | null
          municipality: string | null
          department: string | null
          latitude: number | null
          longitude: number | null
          active: boolean
          created_at: string
        },
        { org_id: string; name: string; location_type?: string; active?: boolean }
      >
      memberships: Table<
        {
          id: string
          org_id: string
          user_id: string
          role_id: string
          active: boolean
          created_at: string
        },
        { org_id: string; user_id: string; role_id: string; active?: boolean }
      >
      user_profiles: Table<
        {
          org_id: string
          user_id: string
          display_name: string
          phone: string | null
          created_at: string
          updated_at: string
        },
        {
          org_id: string
          user_id: string
          display_name: string
          phone?: string | null
          updated_at?: string
        }
      >
      pilots: Table<
        {
          id: string
          org_id: string
          full_name: string
          phone: string | null
          license_number: string | null
          notes: string | null
          active: boolean
          created_by: string | null
          created_at: string
          updated_at: string
        },
        {
          org_id: string
          full_name: string
          phone?: string | null
          license_number?: string | null
          notes?: string | null
          active?: boolean
          created_by?: string | null
          updated_at?: string
        }
      >
      farms: Table<
        {
          id: string
          org_id: string
          name: string
          owner_or_customer: string | null
          municipality: string | null
          department: string | null
          address: string | null
          latitude: number | null
          longitude: number | null
          contact_name: string | null
          phone: string | null
          notes: string | null
          active: boolean
          created_at: string
        },
        {
          org_id: string
          name: string
          owner_or_customer?: string | null
          municipality?: string | null
          department?: string | null
          address?: string | null
          contact_name?: string | null
          phone?: string | null
          notes?: string | null
          active?: boolean
        }
      >
      operations: Table<
        OperationRow,
        Pick<OperationRow, 'org_id' | 'farm_id'> &
          Partial<Omit<OperationRow, 'id' | 'operation_number' | 'org_id' | 'farm_id' | 'created_by' | 'created_at'>>
      >
      operation_statuses: Table<
        { org_id: string; code: string; name: string; active: boolean },
        { org_id: string; code: string; name: string; active?: boolean }
      >
      flight_logs: Table<
        {
          id: string
          org_id: string
          drone_asset_id: string
          operation_id: string
          farm_id: string
          logged_at: string
          hour_meter_start: number
          hour_meter_end: number
          flight_hours: number
          recorded_by: string
          notes: string | null
        },
        {
          org_id: string
          drone_asset_id: string
          operation_id: string
          farm_id: string
          hour_meter_start: number
          hour_meter_end: number
          logged_at?: string
          notes?: string | null
        }
      >
      operation_assets: Table<
        {
          id: string
          org_id: string
          operation_id: string
          asset_id: string
          pilot_id: string | null
          delivered_by_user_id: string | null
          received_by_user_id: string | null
          returned_by_user_id: string | null
          return_received_by_user_id: string | null
          departure_condition: string | null
          return_condition: 'good' | 'damaged' | 'missing' | 'needs_inspection' | null
          departure_at: string
          returned_at: string | null
          return_location_id: string | null
          return_notes: string | null
          created_by: string
          created_at: string
        },
        {
          org_id: string
          operation_id: string
          asset_id: string
          delivered_by_user_id: string
          received_by_user_id: string
          departure_condition?: string | null
          departure_at?: string
        }
      >
      asset_assignments: Table<
        {
          id: string
          org_id: string
          asset_id: string
          assigned_asset_id: string | null
          assigned_user_id: string | null
          operation_id: string | null
          assignment_type: 'asset' | 'user' | 'operation'
          started_at: string
          ended_at: string | null
          reason: string | null
          created_by: string | null
          created_at: string
        },
        {
          org_id: string
          asset_id: string
          assignment_type: 'asset' | 'user' | 'operation'
          assigned_asset_id?: string | null
          assigned_user_id?: string | null
          operation_id?: string | null
          started_at?: string
          ended_at?: string | null
          reason?: string | null
        }
      >
      maintenance_types: Table<
        { org_id: string; code: string; name: string; active: boolean },
        { org_id: string; code: string; name: string; active?: boolean }
      >
      maintenance_plans: Table<
        {
          id: string
          org_id: string
          asset_type_code: string
          name: string
          interval_flight_hours: number | null
          interval_days: number | null
          active: boolean
          created_at: string
        },
        {
          org_id: string
          asset_type_code: string
          name: string
          interval_flight_hours?: number | null
          interval_days?: number | null
          active?: boolean
        }
      >
      maintenance_records: Table<
        {
          id: string
          org_id: string
          asset_id: string
          plan_id: string | null
          maintenance_type: string
          status: 'open' | 'in_progress' | 'completed' | 'cancelled'
          performed_at: string
          completed_at: string | null
          technician_user_id: string | null
          external_company: string | null
          external_technician: string | null
          diagnosis: string | null
          activities: string | null
          outcome: string | null
          cost: number | null
          next_intervention_at: string | null
          notes: string | null
          created_by: string
          created_at: string
        },
        {
          org_id: string
          asset_id: string
          maintenance_type: string
          plan_id?: string | null
          status?: 'open' | 'in_progress' | 'completed' | 'cancelled'
          performed_at?: string
          technician_user_id?: string | null
          external_company?: string | null
          external_technician?: string | null
          diagnosis?: string | null
          notes?: string | null
        }
      >
      documents: Table<
        {
          id: string
          org_id: string
          asset_id: string | null
          operation_id: string | null
          maintenance_record_id: string | null
          inventory_item_id: string | null
          storage_path: string
          file_name: string
          content_type: string | null
          uploaded_by: string
          uploaded_at: string
        },
        {
          org_id: string
          storage_path: string
          file_name: string
          content_type?: string | null
          asset_id?: string | null
          operation_id?: string | null
          maintenance_record_id?: string | null
          inventory_item_id?: string | null
          uploaded_by?: string
        }
      >
      inventory_items: Table<
        {
          id: string
          org_id: string
          internal_code: string
          name: string
          category: string
          manufacturer_reference: string | null
          unit: string
          quantity_on_hand: number
          minimum_quantity: number
          location_id: string | null
          supplier_id: string | null
          unit_value: number | null
          active: boolean
          notes: string | null
          is_serialized: boolean
          serial_number: string | null
          manufacturer: string | null
          model: string | null
          acquired_on: string | null
          created_by: string
          created_at: string
        },
        {
          org_id: string
          internal_code: string
          name: string
          category: string
          unit: string
          minimum_quantity?: number
          quantity_on_hand?: number
          location_id?: string | null
          supplier_id?: string | null
          unit_value?: number | null
          active?: boolean
          notes?: string | null
          is_serialized?: boolean
          serial_number?: string | null
          manufacturer?: string | null
          model?: string | null
          acquired_on?: string | null
        }
      >
      inventory_movements: Table<
        {
          id: string
          org_id: string
          item_id: string
          movement_type: string
          quantity_delta: number
          maintenance_record_id: string | null
          asset_id: string | null
          related_movement_id: string | null
          source_location_id: string | null
          target_location_id: string | null
          reason: string | null
          created_by: string
          created_at: string
        },
        {
          org_id: string
          item_id: string
          movement_type: string
          quantity_delta: number
          maintenance_record_id?: string | null
          asset_id?: string | null
          related_movement_id?: string | null
          source_location_id?: string | null
          target_location_id?: string | null
          reason?: string | null
        }
      >
      inventory_location_balances: Table<
        {
          id: string
          org_id: string
          item_id: string
          location_id: string | null
          balance_key: string
          quantity_on_hand: number
          updated_at: string
        },
        {
          org_id: string
          item_id: string
          location_id?: string | null
          quantity_on_hand?: number
        }
      >
      audit_events: Table<
        {
          id: number
          org_id: string
          occurred_at: string
          actor_user_id: string | null
          event_type: string
          entity_table: string
          entity_id: string | null
          before_state: Record<string, unknown> | null
          after_state: Record<string, unknown> | null
          correction_of: number | null
          correction_reason: string | null
          transaction_id: number
          previous_hash: string | null
          event_hash: string
        },
        never,
        never
      >
    }
    Views: Record<string, never>
    Functions: {
      has_org_permission: {
        Args: { target_org: string; permission: string }
        Returns: boolean
      }
      verify_audit_chain: {
        Args: { target_org: string }
        Returns: boolean
      }
      create_operation_with_assets: {
        Args: {
          p_org_id: string
          p_farm_id: string
          p_asset_ids: string[]
          p_operator_user_id: string
          p_responsible_user_id: string
          p_delivered_by_user_id: string
          p_received_by_user_id: string
          p_departure_condition: string
          p_municipality?: string | null
          p_field_location?: string | null
          p_departure_at?: string
          p_notes?: string | null
        }
        Returns: string
      }
      create_operation_with_pilots: {
        Args: {
          p_org_id: string
          p_farm_id: string
          p_asset_ids: string[]
          p_operator_user_id: string
          p_responsible_user_id: string
          p_delivered_by_user_id: string
          p_received_by_user_id: string
          p_departure_condition: string
          p_municipality?: string | null
          p_field_location?: string | null
          p_departure_at?: string
          p_notes?: string | null
          p_pilot_assignments?: Array<{ asset_id: string; pilot_id: string }>
        }
        Returns: string
      }
      set_operation_drone_pilot: {
        Args: {
          p_org_id: string
          p_operation_asset_id: string
          p_pilot_id: string
        }
        Returns: string
      }
      return_operation_asset: {
        Args: {
          p_org_id: string
          p_operation_asset_id: string
          p_return_condition: string
          p_returned_by_user_id: string
          p_return_received_by_user_id: string
          p_return_location_id?: string | null
          p_return_notes?: string | null
          p_hour_meter_start?: number | null
          p_hour_meter_end?: number | null
          p_returned_at?: string
        }
        Returns: string
      }
      start_maintenance: {
        Args: {
          p_org_id: string
          p_asset_id: string
          p_maintenance_type: string
          p_plan_id?: string | null
          p_performed_at?: string
          p_technician_user_id?: string | null
          p_external_company?: string | null
          p_external_technician?: string | null
          p_diagnosis?: string | null
          p_notes?: string | null
        }
        Returns: string
      }
      complete_maintenance: {
        Args: {
          p_org_id: string
          p_maintenance_record_id: string
          p_activities: string
          p_outcome: string
          p_release_asset_status: string
          p_cost?: number | null
          p_completed_at?: string
          p_next_intervention_at?: string | null
        }
        Returns: string
      }
      get_maintenance_inventory_options: {
        Args: { p_org_id: string }
        Returns: Array<{
          item_id: string
          internal_code: string
          item_name: string
          unit: string
          is_serialized: boolean
          location_id: string
          location_name: string
          quantity_available: number
        }>
      }
      complete_maintenance_with_parts: {
        Args: {
          p_org_id: string
          p_maintenance_record_id: string
          p_activities: string
          p_outcome: string
          p_release_asset_status: string
          p_cost?: number | null
          p_completed_at?: string
          p_next_intervention_at?: string | null
          p_parts?: Array<{
            item_id: string
            source_location_id: string
            quantity: number
            movement_type: 'installation' | 'consumption'
          }>
        }
        Returns: string
      }
      get_maintenance_alerts: {
        Args: { p_org_id: string }
        Returns: Array<{
          asset_id: string
          asset_name: string
          internal_code: string
          asset_type_code: string
          plan_id: string
          plan_name: string
          interval_flight_hours: number | null
          hours_since_maintenance: number | null
          hours_remaining: number | null
          due_date: string | null
          days_remaining: number | null
          alert_status: 'overdue' | 'due' | 'upcoming' | 'untracked'
        }>
      }
      assign_asset: {
        Args: {
          p_org_id: string
          p_asset_id: string
          p_assignment_type: 'asset' | 'user'
          p_assigned_asset_id?: string | null
          p_assigned_user_id?: string | null
          p_reason?: string | null
        }
        Returns: string
      }
      end_asset_assignment: {
        Args: { p_org_id: string; p_assignment_id: string }
        Returns: string
      }
      create_inventory_item: {
        Args: {
          p_org_id: string
          p_internal_code: string
          p_name: string
          p_category: string
          p_unit: string
          p_opening_quantity: number
          p_location_id: string | null
          p_is_serialized: boolean
          p_serial_number: string | null
          p_manufacturer: string | null
          p_model: string | null
          p_manufacturer_reference: string | null
          p_acquired_on: string | null
          p_supplier_id: string | null
          p_unit_value: number | null
          p_notes: string | null
        }
        Returns: string
      }
      record_inventory_movement: {
        Args: {
          p_org_id: string
          p_item_id: string
          p_movement_type: string
          p_quantity: number
          p_reason: string | null
          p_source_location_id?: string | null
          p_target_location_id?: string | null
          p_asset_id?: string | null
          p_maintenance_record_id?: string | null
        }
        Returns: string
      }
      update_asset_profile: {
        Args: {
          p_org_id: string
          p_asset_id: string
          p_internal_code: string
          p_name: string
          p_serial_number: string | null
          p_brand: string | null
          p_model: string | null
          p_acquired_at: string | null
          p_supplier_id: string | null
          p_acquisition_value: number | null
          p_location_id: string | null
          p_responsible_user_id: string | null
          p_notes: string | null
          p_battery_charge_cycles?: number | null
          p_battery_technical_notes?: string | null
        }
        Returns: string
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
