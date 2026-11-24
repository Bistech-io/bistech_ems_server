-- Migration 0010: users_info table for personal profile details
CREATE TABLE IF NOT EXISTS users_info (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  organization_id uuid NOT NULL,
  personal_email text,
  personal_phone text,
  date_of_birth date,
  address_line text,
  city text,
  country_code char(2),
  emergency_contact_name text,
  emergency_contact_phone text,
  emergency_contact_relation text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_info_user_fk FOREIGN KEY (organization_id, user_id) REFERENCES users (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT users_info_org_fk FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT users_info_org_user_uniq UNIQUE (organization_id, user_id)
);

-- Backfill from employee_profiles joined on employees
INSERT INTO users_info (user_id, organization_id, personal_email, personal_phone, date_of_birth, address_line, city, country_code, emergency_contact_name, emergency_contact_phone, emergency_contact_relation, created_at, updated_at)
SELECT e.user_id, ep.organization_id, ep.personal_email, ep.personal_phone, ep.date_of_birth, ep.address_line, ep.city, ep.country_code, ep.emergency_contact_name, ep.emergency_contact_phone, ep.emergency_contact_relation, ep.created_at, ep.updated_at
FROM employee_profiles ep
JOIN employees e ON e.id = ep.employee_id
ON CONFLICT (user_id) DO UPDATE SET
  personal_email = EXCLUDED.personal_email,
  personal_phone = EXCLUDED.personal_phone,
  date_of_birth = EXCLUDED.date_of_birth,
  address_line = EXCLUDED.address_line,
  city = EXCLUDED.city,
  country_code = EXCLUDED.country_code,
  emergency_contact_name = EXCLUDED.emergency_contact_name,
  emergency_contact_phone = EXCLUDED.emergency_contact_phone,
  emergency_contact_relation = EXCLUDED.emergency_contact_relation,
  updated_at = EXCLUDED.updated_at;
