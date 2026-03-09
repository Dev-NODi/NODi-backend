import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════
// COMPANY SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════
export const CreateCompanySchema = z.object({
  name: z.string().min(1, 'Company name is required'),
  motiveCompanyId: z.number().int().positive().optional(),
});

export type CreateCompanyDTO = z.infer<typeof CreateCompanySchema>;

// ═══════════════════════════════════════════════════════════════════════════
// DRIVER SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════
export const RegisterDriverSchema = z.object({
  phone: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number (E.164 format)'),
  name: z.string().optional(),
  email: z.string().email().optional(),
  deviceId: z.string().optional(),
  devicePlatform: z.enum(['ios', 'android']).optional(),
  fcmToken: z.string().optional(),
});

export type RegisterDriverDTO = z.infer<typeof RegisterDriverSchema>;

export const AssignDriverSchema = z.object({
  companyId: z.number().int().positive(),
  role: z.enum(['driver', 'co_passenger', 'cleaner']),
  motiveDriverId: z.number().int().positive().optional(),
});

export type AssignDriverDTO = z.infer<typeof AssignDriverSchema>;

// ═══════════════════════════════════════════════════════════════════════════
// API RESPONSE TYPES
// ═══════════════════════════════════════════════════════════════════════════
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
// ═══════════════════════════════════════════════════════════════════════════
// WEBHOOK SCHEMAS (Updated for actual Motive format)
// ═══════════════════════════════════════════════════════════════════════════

export const MotiveWebhookSchema = z.object({
  // Webhook metadata
  action: z.string(), // 'user_duty_status_updated'
  trigger: z.string(), // 'created', 'updated', 'deleted'
  
  // Driver ID (this is the Motive driver ID)
  id: z.number().int(),
  
  // Driver info
  role: z.string(), // 'driver', 'admin', etc.
  email: z.string().email().nullable(),
  username: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  phone: z.string().nullable(),
  phone_ext: z.string().nullable(),
  
  // Company info
  driver_company_id: z.number().int().nullable(),
  
  // Carrier/Terminal info
  carrier_name: z.string().nullable(),
  carrier_street: z.string().nullable(),
  carrier_city: z.string().nullable(),
  carrier_state: z.string().nullable(),
  carrier_zip: z.string().nullable(),
  terminal_street: z.string().nullable(),
  terminal_city: z.string().nullable(),
  terminal_state: z.string().nullable(),
  terminal_zip: z.string().nullable(),
  
  // Time & compliance
  time_zone: z.string(),
  cycle: z.string().nullable(),
  exception_24_hour_restart: z.boolean(),
  exception_8_hour_break: z.boolean(),
  exception_wait_time: z.boolean(),
  exception_short_haul: z.boolean(),
  exception_ca_farm_school_bus: z.boolean(),
  
  // Alternate cycle (for drivers working in multiple jurisdictions)
  cycle2: z.string().nullable(),
  exception_24_hour_restart2: z.boolean(),
  exception_8_hour_break2: z.boolean(),
  exception_wait_time2: z.boolean(),
  exception_short_haul2: z.boolean(),
  exception_ca_farm_school_bus2: z.boolean(),
  
  // ELD settings
  eld_mode: z.string(), // 'exempt', 'eld', 'aobrd'
  time_tracking_mode: z.string(), // 'timecards', 'hos', etc.
  drivers_license_number: z.string().nullable(),
  drivers_license_state: z.string().nullable(),
  yard_moves_enabled: z.boolean(),
  personal_conveyance_enabled: z.boolean(),
  
  // Status
  status: z.string(), // 'active', 'inactive'
  duty_status: z.enum(['off_duty', 'on_duty', 'driving', 'sleeper_berth']),
  
  // Timestamp
  updated_at: z.string(), // ISO 8601 format
}).passthrough(); // Allow additional fields Motive might add

export type MotiveWebhookPayload = z.infer<typeof MotiveWebhookSchema>;

export interface WebhookProcessingResult {
  success: boolean;
  webhookId: bigint;
  sessionId?: number;
  driverId?: number;
  message?: string;
  error?: string;
}