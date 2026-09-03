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
      alerts: {
        Row: {
          created_at: string
          description: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          org_id: string
          recommended_action: string | null
          resolution: string | null
          resolved_at: string | null
          severity: Database["public"]["Enums"]["alert_severity"]
          status: Database["public"]["Enums"]["alert_status"]
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          org_id: string
          recommended_action?: string | null
          resolution?: string | null
          resolved_at?: string | null
          severity?: Database["public"]["Enums"]["alert_severity"]
          status?: Database["public"]["Enums"]["alert_status"]
          title: string
          type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          org_id?: string
          recommended_action?: string | null
          resolution?: string | null
          resolved_at?: string | null
          severity?: Database["public"]["Enums"]["alert_severity"]
          status?: Database["public"]["Enums"]["alert_status"]
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string
          after: Json | null
          before: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          org_id: string
        }
        Insert: {
          action: string
          actor_id: string
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          org_id: string
        }
        Update: {
          action?: string
          actor_id?: string
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          org_id: string
          parent_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          org_id: string
          parent_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          org_id?: string
          parent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_note_counters: {
        Row: {
          financial_year: string
          next_number: number
          org_id: string
        }
        Insert: {
          financial_year: string
          next_number?: number
          org_id: string
        }
        Update: {
          financial_year?: string
          next_number?: number
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_note_counters_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_notes: {
        Row: {
          cgst_amount: number
          created_at: string
          created_by: string
          credit_note_date: string
          credit_note_number: string
          id: string
          igst_amount: number
          is_full: boolean
          org_id: string
          reason: string | null
          sales_invoice_id: string
          sgst_amount: number
          subtotal: number
          total_amount: number
        }
        Insert: {
          cgst_amount?: number
          created_at?: string
          created_by?: string
          credit_note_date?: string
          credit_note_number: string
          id?: string
          igst_amount?: number
          is_full?: boolean
          org_id: string
          reason?: string | null
          sales_invoice_id: string
          sgst_amount?: number
          subtotal?: number
          total_amount?: number
        }
        Update: {
          cgst_amount?: number
          created_at?: string
          created_by?: string
          credit_note_date?: string
          credit_note_number?: string
          id?: string
          igst_amount?: number
          is_full?: boolean
          org_id?: string
          reason?: string | null
          sales_invoice_id?: string
          sgst_amount?: number
          subtotal?: number
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "credit_notes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_notes_sales_invoice_id_fkey"
            columns: ["sales_invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          billing_address: string | null
          created_at: string
          email: string | null
          gstin: string | null
          id: string
          is_active: boolean
          name: string
          org_id: string
          phone: string | null
          shipping_address: string | null
          state: string | null
          updated_at: string
        }
        Insert: {
          billing_address?: string | null
          created_at?: string
          email?: string | null
          gstin?: string | null
          id?: string
          is_active?: boolean
          name: string
          org_id: string
          phone?: string | null
          shipping_address?: string | null
          state?: string | null
          updated_at?: string
        }
        Update: {
          billing_address?: string | null
          created_at?: string
          email?: string | null
          gstin?: string | null
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          phone?: string | null
          shipping_address?: string | null
          state?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      debit_notes: {
        Row: {
          cgst_amount: number
          created_at: string
          created_by: string
          debit_note_date: string
          debit_note_number: string
          id: string
          igst_amount: number
          org_id: string
          reason: string | null
          sales_invoice_id: string
          sgst_amount: number
          subtotal: number
          total_amount: number
        }
        Insert: {
          cgst_amount?: number
          created_at?: string
          created_by?: string
          debit_note_date?: string
          debit_note_number: string
          id?: string
          igst_amount?: number
          org_id: string
          reason?: string | null
          sales_invoice_id: string
          sgst_amount?: number
          subtotal?: number
          total_amount?: number
        }
        Update: {
          cgst_amount?: number
          created_at?: string
          created_by?: string
          debit_note_date?: string
          debit_note_number?: string
          id?: string
          igst_amount?: number
          org_id?: string
          reason?: string | null
          sales_invoice_id?: string
          sgst_amount?: number
          subtotal?: number
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "debit_notes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "debit_notes_sales_invoice_id_fkey"
            columns: ["sales_invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          id: string
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string
          currency: string
          gst_registration_type: string
          gstin: string | null
          id: string
          industry: string | null
          name: string
          plan: string
          slug: string
          state: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          currency?: string
          gst_registration_type?: string
          gstin?: string | null
          id?: string
          industry?: string | null
          name: string
          plan?: string
          slug: string
          state?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          currency?: string
          gst_registration_type?: string
          gstin?: string | null
          id?: string
          industry?: string | null
          name?: string
          plan?: string
          slug?: string
          state?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      permissions: {
        Row: {
          description: string
          key: string
          module: string
        }
        Insert: {
          description: string
          key: string
          module: string
        }
        Update: {
          description?: string
          key?: string
          module?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          barcode: string | null
          brand: string | null
          category_id: string | null
          cost_price: number
          created_at: string
          description: string | null
          hsn_code: string | null
          id: string
          image_url: string | null
          name: string
          org_id: string
          reorder_point: number
          reorder_quantity: number
          selling_price: number
          sku: string
          status: string
          supplier_id: string | null
          tax_rate: number
          unit: string
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          brand?: string | null
          category_id?: string | null
          cost_price?: number
          created_at?: string
          description?: string | null
          hsn_code?: string | null
          id?: string
          image_url?: string | null
          name: string
          org_id: string
          reorder_point?: number
          reorder_quantity?: number
          selling_price?: number
          sku: string
          status?: string
          supplier_id?: string | null
          tax_rate?: number
          unit?: string
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          brand?: string | null
          category_id?: string | null
          cost_price?: number
          created_at?: string
          description?: string | null
          hsn_code?: string | null
          id?: string
          image_url?: string | null
          name?: string
          org_id?: string
          reorder_point?: number
          reorder_quantity?: number
          selling_price?: number
          sku?: string
          status?: string
          supplier_id?: string | null
          tax_rate?: number
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      proforma_invoices: {
        Row: {
          cgst_amount: number
          created_at: string
          created_by: string
          customer_id: string
          id: string
          igst_amount: number
          org_id: string
          proforma_date: string
          proforma_number: string
          sales_order_id: string | null
          sgst_amount: number
          subtotal: number
          total_amount: number
        }
        Insert: {
          cgst_amount?: number
          created_at?: string
          created_by?: string
          customer_id: string
          id?: string
          igst_amount?: number
          org_id: string
          proforma_date?: string
          proforma_number: string
          sales_order_id?: string | null
          sgst_amount?: number
          subtotal?: number
          total_amount?: number
        }
        Update: {
          cgst_amount?: number
          created_at?: string
          created_by?: string
          customer_id?: string
          id?: string
          igst_amount?: number
          org_id?: string
          proforma_date?: string
          proforma_number?: string
          sales_order_id?: string | null
          sgst_amount?: number
          subtotal?: number
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "proforma_invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proforma_invoices_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proforma_invoices_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "sales_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_items: {
        Row: {
          cgst_amount: number
          created_at: string
          id: string
          igst_amount: number
          org_id: string
          product_id: string
          purchase_order_id: string
          quantity: number
          received_quantity: number
          sgst_amount: number
          tax_rate: number
          unit_cost: number
        }
        Insert: {
          cgst_amount?: number
          created_at?: string
          id?: string
          igst_amount?: number
          org_id: string
          product_id: string
          purchase_order_id: string
          quantity: number
          received_quantity?: number
          sgst_amount?: number
          tax_rate?: number
          unit_cost?: number
        }
        Update: {
          cgst_amount?: number
          created_at?: string
          id?: string
          igst_amount?: number
          org_id?: string
          product_id?: string
          purchase_order_id?: string
          quantity?: number
          received_quantity?: number
          sgst_amount?: number
          tax_rate?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          cgst_amount: number
          created_at: string
          created_by: string
          discount_amount: number
          expected_delivery_date: string | null
          id: string
          igst_amount: number
          notes: string | null
          order_date: string
          org_id: string
          po_number: string
          sgst_amount: number
          shipping_amount: number
          status: Database["public"]["Enums"]["po_status"]
          subtotal: number
          supplier_id: string
          tax_amount: number
          total_amount: number
          updated_at: string
          warehouse_id: string
        }
        Insert: {
          cgst_amount?: number
          created_at?: string
          created_by?: string
          discount_amount?: number
          expected_delivery_date?: string | null
          id?: string
          igst_amount?: number
          notes?: string | null
          order_date?: string
          org_id: string
          po_number: string
          sgst_amount?: number
          shipping_amount?: number
          status?: Database["public"]["Enums"]["po_status"]
          subtotal?: number
          supplier_id: string
          tax_amount?: number
          total_amount?: number
          updated_at?: string
          warehouse_id: string
        }
        Update: {
          cgst_amount?: number
          created_at?: string
          created_by?: string
          discount_amount?: number
          expected_delivery_date?: string | null
          id?: string
          igst_amount?: number
          notes?: string | null
          order_date?: string
          org_id?: string
          po_number?: string
          sgst_amount?: number
          shipping_amount?: number
          status?: Database["public"]["Enums"]["po_status"]
          subtotal?: number
          supplier_id?: string
          tax_amount?: number
          total_amount?: number
          updated_at?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          permission_key: string
          role: string
        }
        Insert: {
          permission_key: string
          role: string
        }
        Update: {
          permission_key?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          },
        ]
      }
      sales_invoice_counters: {
        Row: {
          financial_year: string
          next_number: number
          org_id: string
        }
        Insert: {
          financial_year: string
          next_number?: number
          org_id: string
        }
        Update: {
          financial_year?: string
          next_number?: number
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_invoice_counters_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_invoice_items: {
        Row: {
          cgst_amount: number
          created_at: string
          hsn_code: string | null
          id: string
          igst_amount: number
          invoice_id: string
          org_id: string
          product_id: string
          quantity: number
          sgst_amount: number
          tax_rate: number
          unit_price: number
        }
        Insert: {
          cgst_amount?: number
          created_at?: string
          hsn_code?: string | null
          id?: string
          igst_amount?: number
          invoice_id: string
          org_id: string
          product_id: string
          quantity: number
          sgst_amount?: number
          tax_rate?: number
          unit_price?: number
        }
        Update: {
          cgst_amount?: number
          created_at?: string
          hsn_code?: string | null
          id?: string
          igst_amount?: number
          invoice_id?: string
          org_id?: string
          product_id?: string
          quantity?: number
          sgst_amount?: number
          tax_rate?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoice_items_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_invoices: {
        Row: {
          billing_address: string | null
          cgst_amount: number
          created_at: string
          created_by: string
          customer_gstin: string | null
          customer_id: string
          discount_amount: number
          id: string
          igst_amount: number
          invoice_date: string
          invoice_number: string
          org_id: string
          payment_status: Database["public"]["Enums"]["invoice_payment_status"]
          sales_order_id: string
          sgst_amount: number
          shipping_address: string | null
          shipping_amount: number
          subtotal: number
          total_amount: number
          updated_at: string
        }
        Insert: {
          billing_address?: string | null
          cgst_amount?: number
          created_at?: string
          created_by?: string
          customer_gstin?: string | null
          customer_id: string
          discount_amount?: number
          id?: string
          igst_amount?: number
          invoice_date?: string
          invoice_number: string
          org_id: string
          payment_status?: Database["public"]["Enums"]["invoice_payment_status"]
          sales_order_id: string
          sgst_amount?: number
          shipping_address?: string | null
          shipping_amount?: number
          subtotal?: number
          total_amount?: number
          updated_at?: string
        }
        Update: {
          billing_address?: string | null
          cgst_amount?: number
          created_at?: string
          created_by?: string
          customer_gstin?: string | null
          customer_id?: string
          discount_amount?: number
          id?: string
          igst_amount?: number
          invoice_date?: string
          invoice_number?: string
          org_id?: string
          payment_status?: Database["public"]["Enums"]["invoice_payment_status"]
          sales_order_id?: string
          sgst_amount?: number
          shipping_address?: string | null
          shipping_amount?: number
          subtotal?: number
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoices_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoices_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: true
            referencedRelation: "sales_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_order_counters: {
        Row: {
          financial_year: string
          next_number: number
          org_id: string
        }
        Insert: {
          financial_year: string
          next_number?: number
          org_id: string
        }
        Update: {
          financial_year?: string
          next_number?: number
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_order_counters_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_order_items: {
        Row: {
          cgst_amount: number
          created_at: string
          id: string
          igst_amount: number
          org_id: string
          product_id: string
          quantity: number
          sales_order_id: string
          sgst_amount: number
          tax_rate: number
          unit_price: number
        }
        Insert: {
          cgst_amount?: number
          created_at?: string
          id?: string
          igst_amount?: number
          org_id: string
          product_id: string
          quantity: number
          sales_order_id: string
          sgst_amount?: number
          tax_rate?: number
          unit_price?: number
        }
        Update: {
          cgst_amount?: number
          created_at?: string
          id?: string
          igst_amount?: number
          org_id?: string
          product_id?: string
          quantity?: number
          sales_order_id?: string
          sgst_amount?: number
          tax_rate?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_order_items_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_items_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "sales_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_orders: {
        Row: {
          cgst_amount: number
          created_at: string
          created_by: string
          customer_id: string
          discount_amount: number
          expected_fulfillment_date: string | null
          id: string
          igst_amount: number
          notes: string | null
          order_date: string
          org_id: string
          sgst_amount: number
          shipping_amount: number
          so_number: string
          status: Database["public"]["Enums"]["so_status"]
          subtotal: number
          total_amount: number
          updated_at: string
          warehouse_id: string
        }
        Insert: {
          cgst_amount?: number
          created_at?: string
          created_by?: string
          customer_id: string
          discount_amount?: number
          expected_fulfillment_date?: string | null
          id?: string
          igst_amount?: number
          notes?: string | null
          order_date?: string
          org_id: string
          sgst_amount?: number
          shipping_amount?: number
          so_number: string
          status?: Database["public"]["Enums"]["so_status"]
          subtotal?: number
          total_amount?: number
          updated_at?: string
          warehouse_id: string
        }
        Update: {
          cgst_amount?: number
          created_at?: string
          created_by?: string
          customer_id?: string
          discount_amount?: number
          expected_fulfillment_date?: string | null
          id?: string
          igst_amount?: number
          notes?: string | null
          order_date?: string
          org_id?: string
          sgst_amount?: number
          shipping_amount?: number
          so_number?: string
          status?: Database["public"]["Enums"]["so_status"]
          subtotal?: number
          total_amount?: number
          updated_at?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_levels: {
        Row: {
          damaged: number
          expired: number
          id: string
          in_transit: number
          incoming: number
          org_id: string
          product_id: string
          quantity: number
          reserved: number
          updated_at: string
          warehouse_id: string
        }
        Insert: {
          damaged?: number
          expired?: number
          id?: string
          in_transit?: number
          incoming?: number
          org_id: string
          product_id: string
          quantity?: number
          reserved?: number
          updated_at?: string
          warehouse_id: string
        }
        Update: {
          damaged?: number
          expired?: number
          id?: string
          in_transit?: number
          incoming?: number
          org_id?: string
          product_id?: string
          quantity?: number
          reserved?: number
          updated_at?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_levels_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_levels_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_levels_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_levels_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          created_at: string
          created_by: string
          id: string
          notes: string | null
          org_id: string
          product_id: string
          quantity: number
          reference: string | null
          type: Database["public"]["Enums"]["movement_type"]
          warehouse_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          id?: string
          notes?: string | null
          org_id: string
          product_id: string
          quantity: number
          reference?: string | null
          type: Database["public"]["Enums"]["movement_type"]
          warehouse_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          notes?: string | null
          org_id?: string
          product_id?: string
          quantity?: number
          reference?: string | null
          type?: Database["public"]["Enums"]["movement_type"]
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          city: string | null
          code: string | null
          contact_person: string | null
          created_at: string
          email: string | null
          gst_number: string | null
          id: string
          is_active: boolean
          lead_time_days: number
          min_order_quantity: number | null
          name: string
          org_id: string
          payment_terms: string | null
          phone: string | null
          rating: number
          state: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          code?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          gst_number?: string | null
          id?: string
          is_active?: boolean
          lead_time_days?: number
          min_order_quantity?: number | null
          name: string
          org_id: string
          payment_terms?: string | null
          phone?: string | null
          rating?: number
          state?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          code?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          gst_number?: string | null
          id?: string
          is_active?: boolean
          lead_time_days?: number
          min_order_quantity?: number | null
          name?: string
          org_id?: string
          payment_terms?: string | null
          phone?: string | null
          rating?: number
          state?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouses: {
        Row: {
          address: string | null
          city: string | null
          code: string
          contact_name: string | null
          contact_phone: string | null
          country: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          org_id: string
          postal_code: string | null
          state: string | null
          type: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          code: string
          contact_name?: string | null
          contact_phone?: string | null
          country?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          org_id: string
          postal_code?: string | null
          state?: string | null
          type?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          code?: string
          contact_name?: string | null
          contact_phone?: string | null
          country?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          postal_code?: string | null
          state?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "warehouses_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      products_safe: {
        Row: {
          barcode: string | null
          brand: string | null
          category_id: string | null
          cost_price: number | null
          created_at: string | null
          description: string | null
          hsn_code: string | null
          id: string | null
          image_url: string | null
          name: string | null
          org_id: string | null
          reorder_point: number | null
          reorder_quantity: number | null
          selling_price: number | null
          sku: string | null
          status: string | null
          supplier_id: string | null
          tax_rate: number | null
          unit: string | null
          updated_at: string | null
        }
        Insert: {
          barcode?: string | null
          brand?: string | null
          category_id?: string | null
          cost_price?: never
          created_at?: string | null
          description?: string | null
          hsn_code?: string | null
          id?: string | null
          image_url?: string | null
          name?: string | null
          org_id?: string | null
          reorder_point?: number | null
          reorder_quantity?: number | null
          selling_price?: number | null
          sku?: string | null
          status?: string | null
          supplier_id?: string | null
          tax_rate?: number | null
          unit?: string | null
          updated_at?: string | null
        }
        Update: {
          barcode?: string | null
          brand?: string | null
          category_id?: string | null
          cost_price?: never
          created_at?: string | null
          description?: string | null
          hsn_code?: string | null
          id?: string | null
          image_url?: string | null
          name?: string | null
          org_id?: string | null
          reorder_point?: number | null
          reorder_quantity?: number | null
          selling_price?: number | null
          sku?: string | null
          status?: string | null
          supplier_id?: string | null
          tax_rate?: number | null
          unit?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      cancel_sales_order: { Args: { _so_id: string }; Returns: undefined }
      confirm_sales_order: { Args: { _so_id: string }; Returns: undefined }
      create_credit_note: {
        Args: {
          _invoice_id: string
          _is_full: boolean
          _reason?: string
          _subtotal?: number
        }
        Returns: string
      }
      generate_sales_invoice: { Args: { _so_id: string }; Returns: string }
      has_org_role: {
        Args: {
          _org: string
          _roles: Database["public"]["Enums"]["org_role"][]
        }
        Returns: boolean
      }
      has_permission: { Args: { _key: string; _org: string }; Returns: boolean }
      is_org_member: { Args: { _org: string }; Returns: boolean }
      next_credit_note_number: { Args: { _org_id: string }; Returns: string }
      next_sales_invoice_number: { Args: { _org_id: string }; Returns: string }
      next_sales_order_number: { Args: { _org_id: string }; Returns: string }
      receive_purchase_order_item: {
        Args: { _item_id: string; _quantity: number }
        Returns: undefined
      }
      ship_sales_order: { Args: { _so_id: string }; Returns: undefined }
    }
    Enums: {
      alert_severity: "info" | "warning" | "critical"
      alert_status: "open" | "acknowledged" | "resolved" | "dismissed"
      invoice_payment_status: "unpaid" | "partial" | "paid"
      movement_type:
        | "inbound"
        | "outbound"
        | "adjustment"
        | "transfer_in"
        | "transfer_out"
        | "return"
        | "damage"
        | "reserve"
        | "unreserve"
        | "expired"
      org_role:
        | "owner"
        | "admin"
        | "manager"
        | "staff"
        | "viewer"
        | "inventory_manager"
        | "procurement_manager"
        | "sales_manager"
        | "accountant"
        | "warehouse_operator"
      po_status:
        | "draft"
        | "pending_approval"
        | "approved"
        | "sent"
        | "partially_received"
        | "received"
        | "closed"
        | "cancelled"
      so_status:
        | "draft"
        | "confirmed"
        | "processing"
        | "packed"
        | "shipped"
        | "delivered"
        | "cancelled"
        | "returned"
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
    Enums: {
      alert_severity: ["info", "warning", "critical"],
      alert_status: ["open", "acknowledged", "resolved", "dismissed"],
      invoice_payment_status: ["unpaid", "partial", "paid"],
      movement_type: [
        "inbound",
        "outbound",
        "adjustment",
        "transfer_in",
        "transfer_out",
        "return",
        "damage",
        "reserve",
        "unreserve",
        "expired",
      ],
      org_role: [
        "owner",
        "admin",
        "manager",
        "staff",
        "viewer",
        "inventory_manager",
        "procurement_manager",
        "sales_manager",
        "accountant",
        "warehouse_operator",
      ],
      po_status: [
        "draft",
        "pending_approval",
        "approved",
        "sent",
        "partially_received",
        "received",
        "closed",
        "cancelled",
      ],
      so_status: [
        "draft",
        "confirmed",
        "processing",
        "packed",
        "shipped",
        "delivered",
        "cancelled",
        "returned",
      ],
    },
  },
} as const
