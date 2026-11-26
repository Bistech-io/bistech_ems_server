-- 0013_office_ip_attendance_security.sql
-- Adds organization-level allowed office IP/CIDR allowlist for attendance
-- check-in/check-out network enforcement and records client IP on attendance events.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS allowed_office_ips TEXT[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS check_out_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS check_in_ip TEXT,
  ADD COLUMN IF NOT EXISTS check_out_ip TEXT;
