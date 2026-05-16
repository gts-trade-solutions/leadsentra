import { z } from 'zod';

export const CompanyRow = z.object({
  company_id: z.string().min(1, "company_id is required"),
  legal_name: z.string().optional().or(z.literal("")),
  trading_name: z.string().optional().or(z.literal("")),
  company_type: z.string().optional().or(z.literal("")),
  size: z.string().optional().or(z.literal("")),
  website: z.string().url().optional().or(z.literal("")),
  head_office_address: z.string().optional().or(z.literal("")),
  city_regency: z.string().optional().or(z.literal("")),
  province_id: z.string().optional().or(z.literal("")),
  postal_code: z.string().optional().or(z.literal("")),
  country: z.string().optional().or(z.literal("")),
  phone_main: z.string().optional().or(z.literal("")),
  email_general: z.string().email().optional().or(z.literal("")),
  linkedin: z.string().url().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
}).refine(
  (d) => Boolean(d.legal_name) || Boolean(d.trading_name),
  { message: "Either legal_name or trading_name is required", path: ["legal_name"] }
);
export type CompanyRowT = z.infer<typeof CompanyRow>;

const emptyToNull = (v?: string | null) =>
  v && v.toString().trim().length ? v.toString().trim() : null;

export const ContactRow = z.object({
  company_id: z.string().min(1, "company_id is required"),
  contact_name: z.string().min(1, "contact_name is required"),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  title: z.string().optional().or(z.literal("")),
  department: z.string().optional().or(z.literal("")),
  linkedin_url: z.string().url().optional().or(z.literal("")),
  facebook_url: z.string().url().optional().or(z.literal("")),
  instagram_url: z.string().url().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
  location: z.string().optional().transform(emptyToNull).nullable()
});
export type ContactRowT = z.infer<typeof ContactRow>;
