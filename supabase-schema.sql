-- ═════════════════════════════════════════════════════════╗
-- Quemahtech EMS — Supabase Database Schema               ║
-- Run this entire script in Supabase SQL Editor to create  ║
-- all required tables and seed the admin account.          ║
-- ═════════════════════════════════════════════════════════╝

-- 1. Admin table (single row for admin credentials)
CREATE TABLE IF NOT EXISTS admin (
  username TEXT PRIMARY KEY,
  password TEXT NOT NULL,
  email TEXT
);

-- Seed the default admin account
INSERT INTO admin (username, password, email)
VALUES ('quemahtech', 'quemah123', 'atharvashishn@gmail.com')
ON CONFLICT (username) DO NOTHING;

-- 2. Employees table
CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  dept TEXT,
  email TEXT,
  phone TEXT,
  bday TEXT,
  joining TEXT,
  designation TEXT,
  password TEXT DEFAULT 'emp123',
  cl REAL DEFAULT 7.5,
  sl REAL DEFAULT 3.0,
  ul REAL DEFAULT 0,
  active BOOLEAN DEFAULT true,
  calendar_event_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Attendance logs table (Multi-Session Punch Ledger)
-- Each row = one login/logout session pair. Never overwritten.
CREATE TABLE IF NOT EXISTS attendance_logs (
  id BIGSERIAL PRIMARY KEY,
  emp_id TEXT NOT NULL,
  emp_name TEXT NOT NULL,
  department TEXT,
  login_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  logout_time TIMESTAMPTZ,
  working_hours REAL DEFAULT 0,
  status TEXT DEFAULT 'Active',
  computer_name TEXT DEFAULT '',
  login_date TEXT,
  event TEXT DEFAULT 'LOGIN',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- GPS fields
  gps_lat DOUBLE PRECISION,
  gps_lng DOUBLE PRECISION,
  gps_accuracy REAL,
  gps_status TEXT DEFAULT 'unknown',
  attendance_type TEXT DEFAULT 'office',
  approval_status TEXT DEFAULT 'approved',
  approval_reason TEXT,
  approval_note TEXT,
  approval_photo_url TEXT,
  device_fingerprint TEXT,
  device_info TEXT
);

-- Partial unique index: at most one active session per employee (DB-level duplicate prevention)
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_logs_active_unique
  ON attendance_logs (emp_id)
  WHERE logout_time IS NULL;

-- Non-unique index for fast active-session lookup (kept for broader queries)
CREATE INDEX IF NOT EXISTS idx_attendance_logs_active
  ON attendance_logs (emp_id, logout_time)
  WHERE logout_time IS NULL;

-- Index for daily queries
CREATE INDEX IF NOT EXISTS idx_attendance_logs_date
  ON attendance_logs (login_date);

-- 3b. Old attendance table (keep for data migration / backward compat)
CREATE TABLE IF NOT EXISTS attendance (
  id TEXT,
  name TEXT,
  dept TEXT,
  date TEXT,
  "in" TEXT,
  "out" TEXT,
  hours REAL DEFAULT 0,
  status TEXT DEFAULT 'Present',
  notes TEXT DEFAULT '',
  PRIMARY KEY (id, date)
);

-- 4. Leave requests table
CREATE TABLE IF NOT EXISTS leave_requests (
  id BIGSERIAL PRIMARY KEY,
  emp_id TEXT,
  emp_name TEXT,
  dept TEXT,
  type TEXT,
  from_date TEXT,
  to_date TEXT,
  days INTEGER,
  reason TEXT,
  status TEXT DEFAULT 'Pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Announcements table
CREATE TABLE IF NOT EXISTS announcements (
  id BIGSERIAL PRIMARY KEY,
  date TEXT,
  subject TEXT,
  body TEXT,
  "by" TEXT DEFAULT 'Admin',
  priority TEXT DEFAULT 'normal',
  recipient TEXT DEFAULT 'All Employees',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Departments table
CREATE TABLE IF NOT EXISTS departments (
  name TEXT PRIMARY KEY
);

-- Seed default departments
INSERT INTO departments (name) VALUES
  ('Engineering'), ('HR'), ('IT'), ('Marketing'), ('Finance'), ('Operations')
ON CONFLICT (name) DO NOTHING;

-- 7. Notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  text TEXT,
  time TEXT,
  unread BOOLEAN DEFAULT true,
  is_read BOOLEAN DEFAULT false,
  target TEXT DEFAULT 'admin',
  user_id TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Archived employees table
CREATE TABLE IF NOT EXISTS archived_employees (
  id TEXT PRIMARY KEY,
  original_id TEXT,
  name TEXT,
  dept TEXT,
  status TEXT,
  joining TEXT,
  exit TEXT,
  employee_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. GPS attendance logs for permanent tracking
CREATE TABLE IF NOT EXISTS attendance_gps_logs (
  id BIGSERIAL PRIMARY KEY,
  emp_id TEXT NOT NULL,
  emp_name TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  accuracy REAL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  event_type TEXT NOT NULL,
  device_fingerprint TEXT,
  device_info TEXT,
  distance_from_office REAL,
  in_office BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gps_emp_id ON attendance_gps_logs (emp_id);
CREATE INDEX IF NOT EXISTS idx_gps_timestamp ON attendance_gps_logs (timestamp);

-- 10. Attendance approval requests for remote/field work
CREATE TABLE IF NOT EXISTS attendance_approvals (
  id BIGSERIAL PRIMARY KEY,
  attendance_log_id BIGSERIAL,
  emp_id TEXT NOT NULL,
  emp_name TEXT NOT NULL,
  department TEXT,
  login_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  distance_from_office REAL,
  reason TEXT NOT NULL,
  reason_type TEXT NOT NULL,
  note TEXT,
  photo_url TEXT,
  device_info TEXT,
  status TEXT DEFAULT 'pending',
  admin_note TEXT,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_approvals_emp_id ON attendance_approvals (emp_id);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON attendance_approvals (status);

-- 11. Employee approved/known devices
CREATE TABLE IF NOT EXISTS employee_devices (
  id BIGSERIAL PRIMARY KEY,
  emp_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  device_info TEXT,
  first_seen TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  is_approved BOOLEAN DEFAULT true,
  UNIQUE(emp_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_devices_emp_id ON employee_devices (emp_id);

-- 12. Office geofence configuration
CREATE TABLE IF NOT EXISTS office_geofence (
  id INTEGER PRIMARY KEY DEFAULT 1,
  lat DOUBLE PRECISION NOT NULL DEFAULT 18.5204,
  lng DOUBLE PRECISION NOT NULL DEFAULT 73.8567,
  radius_meters INTEGER NOT NULL DEFAULT 100,
  address TEXT DEFAULT 'Office Address',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO office_geofence (id, lat, lng, radius_meters, address)
VALUES (1, 18.5204, 73.8567, 100, 'Main Office')
ON CONFLICT (id) DO NOTHING;

-- 13. Row Level Security (RLS)
-- Supabase enables RLS by default on new tables via the dashboard.
-- When RLS is ON but no policy exists, ALL operations are blocked.
-- To fix the "violates row-level security policy" error, run:
--
--   ALTER TABLE attendance_logs DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE leave_requests DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE notifications DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE announcements DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE departments DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE archived_employees DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE admin DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE attendance DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE attendance_gps_logs DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE attendance_approvals DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE employee_devices DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE office_geofence DISABLE ROW LEVEL SECURITY;

-- Or grant permissive policies (example for attendance_logs):
--   CREATE POLICY "anon_all" ON attendance_logs FOR ALL
--     TO anon USING (true) WITH CHECK (true);

-- 14. Enable Realtime for all tables
-- Go to Supabase Dashboard → Database → Replication
-- and enable replication for all tables above.
-- Or run:
-- ALTER PUBLICATION supabase_realtime ADD TABLE admin;
-- ALTER PUBLICATION supabase_realtime ADD TABLE employees;
-- ALTER PUBLICATION supabase_realtime ADD TABLE attendance_logs;
-- ALTER PUBLICATION supabase_realtime ADD TABLE attendance;
-- ALTER PUBLICATION supabase_realtime ADD TABLE leave_requests;
-- ALTER PUBLICATION supabase_realtime ADD TABLE announcements;
-- ALTER PUBLICATION supabase_realtime ADD TABLE departments;
-- ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
-- ALTER PUBLICATION supabase_realtime ADD TABLE archived_employees;
-- ALTER PUBLICATION supabase_realtime ADD TABLE attendance_gps_logs;
-- ALTER PUBLICATION supabase_realtime ADD TABLE attendance_approvals;
-- ALTER PUBLICATION supabase_realtime ADD TABLE employee_devices;
-- ALTER PUBLICATION supabase_realtime ADD TABLE office_geofence;
