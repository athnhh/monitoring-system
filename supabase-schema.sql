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

-- 3. Attendance table
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

-- 9. Enable Row Level Security (optional but recommended)
-- For internal team tools, RLS can be disabled completely.
-- If enabled, add permissive policies for the anon key.
-- ALTER TABLE admin ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE archived_employees ENABLE ROW LEVEL SECURITY;

-- 10. Enable Realtime for all tables
-- Go to Supabase Dashboard → Database → Replication
-- and enable replication for all 8 tables above.
-- Or run:
-- ALTER PUBLICATION supabase_realtime ADD TABLE admin;
-- ALTER PUBLICATION supabase_realtime ADD TABLE employees;
-- ALTER PUBLICATION supabase_realtime ADD TABLE attendance;
-- ALTER PUBLICATION supabase_realtime ADD TABLE leave_requests;
-- ALTER PUBLICATION supabase_realtime ADD TABLE announcements;
-- ALTER PUBLICATION supabase_realtime ADD TABLE departments;
-- ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
-- ALTER PUBLICATION supabase_realtime ADD TABLE archived_employees;
