const fs = require('fs');
let c = fs.readFileSync('script.js', 'utf8');

const marker = "localStorage.setItem('seed_emp7429', '1'); }\n})();";
const idx = c.indexOf(marker);

if (idx === -1) { console.error('Marker not found'); process.exit(1); }

const newCode = `

// ══ Schema SQL (fallback embedded copy for Run SQL Setup) ══
const __SCHEMA_SQL = \`
CREATE TABLE IF NOT EXISTS admin (
  username TEXT PRIMARY KEY,
  password TEXT NOT NULL,
  email TEXT
);

INSERT INTO admin (username, password, email)
VALUES ('quemahtech', 'quemah123', 'atharvashishn@gmail.com')
ON CONFLICT (username) DO NOTHING;

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  dept TEXT, email TEXT, phone TEXT, bday TEXT, joining TEXT,
  designation TEXT, password TEXT DEFAULT 'emp123',
  cl REAL DEFAULT 7.5, sl REAL DEFAULT 3.0, ul REAL DEFAULT 0,
  active BOOLEAN DEFAULT true, calendar_event_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attendance_logs (
  id BIGSERIAL PRIMARY KEY,
  emp_id TEXT NOT NULL, emp_name TEXT NOT NULL, department TEXT,
  login_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  logout_time TIMESTAMPTZ, working_hours REAL DEFAULT 0,
  status TEXT DEFAULT 'Active', computer_name TEXT DEFAULT '',
  login_date TEXT, event TEXT DEFAULT 'LOGIN',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attendance_logs_active
  ON attendance_logs (emp_id, logout_time) WHERE logout_time IS NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_logs_date
  ON attendance_logs (login_date);

CREATE TABLE IF NOT EXISTS attendance (
  id TEXT, name TEXT, dept TEXT, date TEXT,
  "in" TEXT, "out" TEXT, hours REAL DEFAULT 0,
  status TEXT DEFAULT 'Present', notes TEXT DEFAULT '',
  PRIMARY KEY (id, date)
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id BIGSERIAL PRIMARY KEY, emp_id TEXT, emp_name TEXT, dept TEXT,
  type TEXT, from_date TEXT, to_date TEXT, days INTEGER,
  reason TEXT, status TEXT DEFAULT 'Pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS announcements (
  id BIGSERIAL PRIMARY KEY, date TEXT, subject TEXT, body TEXT,
  "by" TEXT DEFAULT 'Admin', priority TEXT DEFAULT 'normal',
  recipient TEXT DEFAULT 'All Employees',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS departments (name TEXT PRIMARY KEY);

INSERT INTO departments (name) VALUES
  ('Engineering'), ('HR'), ('IT'), ('Marketing'), ('Finance'), ('Operations')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY, text TEXT, time TEXT,
  unread BOOLEAN DEFAULT true, target TEXT DEFAULT 'admin',
  user_id TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS archived_employees (
  id TEXT PRIMARY KEY, original_id TEXT, name TEXT, dept TEXT,
  status TEXT, joining TEXT, exit TEXT, employee_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE attendance_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests DISABLE ROW LEVEL SECURITY;
ALTER TABLE notifications DISABLE ROW LEVEL SECURITY;
ALTER TABLE announcements DISABLE ROW LEVEL SECURITY;
ALTER TABLE departments DISABLE ROW LEVEL SECURITY;
ALTER TABLE archived_employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE admin DISABLE ROW LEVEL SECURITY;
ALTER TABLE attendance DISABLE ROW LEVEL SECURITY;
\`;

// ══ Run SQL Setup — executes the schema SQL via Supabase RPC ══
async function runSqlSetup() {
  const btn = document.getElementById('run-sql-setup-btn');
  const logEl = document.getElementById('sql-setup-log');
  const statusEl = document.getElementById('sql-setup-status');
  if (!btn || !logEl) return;

  setButtonLoading(btn, true);
  logEl.innerHTML = '';

  function log(msg, type) {
    const color = type === 'error' ? '#ef4444' : type === 'success' ? '#16a34a' : 'var(--muted)';
    logEl.innerHTML += '<div style="padding:3px 0;font-size:12px;line-height:1.5;color:' + color + '">' + msg + '</div>';
    logEl.scrollTop = logEl.scrollHeight;
  }

  if (statusEl) statusEl.textContent = 'Connecting...';

  if (typeof SupabaseDB === 'undefined' || !SupabaseDB.supabase) {
    log('❌ Supabase client not initialized. Check your configuration.', 'error');
    if (statusEl) statusEl.textContent = 'Failed — not connected';
    setButtonLoading(btn, false);
    return;
  }

  const sb = SupabaseDB.supabase;

  log('🔍 Checking for exec_sql RPC function...', 'info');
  let execSqlExists = false;
  try {
    const { error } = await sb.rpc('exec_sql', { query: 'SELECT 1' });
    if (!error) {
      execSqlExists = true;
      log('✅ exec_sql function found!', 'success');
    } else if (error.message && error.message.includes('function') && (error.message.includes('not found') || error.message.includes('does not exist'))) {
      execSqlExists = false;
      log('ℹ️ exec_sql function not found.', 'info');
    } else {
      execSqlExists = true;
      log('⚠️ exec_sql RPC responded (continuing)...', 'info');
    }
  } catch (e) {
    execSqlExists = false;
    log('ℹ️ exec_sql not available: ' + e.message.substring(0, 80), 'info');
  }

  if (!execSqlExists) {
    log('', 'info');
    log('📋 First, create the exec_sql Postgres function. Copy and run this in Supabase SQL Editor:', 'info');
    const createFn = \`CREATE OR REPLACE FUNCTION exec_sql(query text)
RETURNS void AS \$\$
BEGIN
  EXECUTE query;
END;
\$\$ LANGUAGE plpgsql SECURITY DEFINER;\`;
    logEl.innerHTML += '<div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:12px;margin:6px 0;font-family:var(--font-mono);font-size:11px;white-space:pre-wrap;color:var(--text);line-height:1.7;">' + createFn + '</div>';
    log('Then click "Run SQL Setup" again.', 'info');
    logEl.innerHTML += '<div style="margin-top:6px;"><button class="btn btn-sm" onclick="window.open(\\'https://supabase.com/dashboard/project/jrdfxkyhoutwzdbieefq/sql/new\\',\\'_blank\\')">🔗 Open SQL Editor</button>' +
      ' <button class="btn btn-sm" onclick="runSqlSetup()">🔄 Retry</button></div>';
    if (statusEl) statusEl.textContent = 'Requires exec_sql';
    setButtonLoading(btn, false);
    return;
  }

  if (statusEl) statusEl.textContent = 'Loading schema...';
  log('📄 Loading schema SQL...', 'info');

  let sqlText = '';
  try {
    const res = await fetch('supabase-schema.sql');
    if (res.ok) {
      sqlText = await res.text();
      log('✅ Loaded from supabase-schema.sql (' + (sqlText.length / 1024).toFixed(1) + ' KB)', 'success');
    } else {
      throw new Error('HTTP ' + res.status);
    }
  } catch (e) {
    log('⚠️ Using embedded fallback schema (' + e.message.substring(0, 60) + ')', 'info');
    sqlText = __SCHEMA_SQL;
  }

  const statements = sqlText
    .split(';')
    .map(s => s.trim())
    .filter(s => s && s.length > 6 && !s.startsWith('--'));

  log('📋 Found ' + statements.length + ' executable statements', 'info');
  if (statusEl) statusEl.textContent = 'Running ' + statements.length + ' statements...';

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.substring(0, 65).replace(/\\n/g, ' ').trim();
    log((i + 1) + '/' + statements.length + ' ⏳ ' + preview + '...', 'info');

    try {
      const { error } = await sb.rpc('exec_sql', { query: stmt + ';' });
      if (error) {
        const msg = error.message || '';
        if (msg.includes('already exists') || msg.includes('duplicate key') || msg.includes('unique constraint')) {
          log('   ⚠️ Already exists (skipped)', 'info');
          successCount++;
        } else {
          log('   ❌ ' + msg.substring(0, 120), 'error');
          failCount++;
        }
      } else {
        log('   ✅ Done', 'success');
        successCount++;
      }
    } catch (e) {
      log('   ❌ ' + e.message.substring(0, 100), 'error');
      failCount++;
    }

    if (statusEl) statusEl.textContent = 'Progress: ' + (i + 1) + '/' + statements.length;
  }

  log('', 'info');
  log('═══════════════════════════════', 'info');
  const summaryMsg = '📊 Complete: ✅ ' + successCount + ' OK, ❌ ' + failCount + ' errors';
  log(summaryMsg, failCount > 0 ? 'error' : 'success');

  if (failCount === 0) {
    log('🎉 All statements executed successfully!', 'success');
    if (statusEl) statusEl.textContent = '✅ Complete — ' + successCount + ' OK';
    log('🔄 Refreshing application state...', 'info');
    await refreshStateAndRender();
    log('✅ State refreshed!', 'success');
  } else {
    if (statusEl) statusEl.textContent = '⚠️ ' + successCount + ' OK, ' + failCount + ' errors';
  }

  setButtonLoading(btn, false, '⚡ Run SQL Setup');
}
`;

// Insert new code after the closing of seedTestEmployee
const insertAt = idx + marker.length;
c = c.slice(0, insertAt) + newCode + c.slice(insertAt);

fs.writeFileSync('script.js', c, 'utf8');
console.log('✅ Code appended successfully. New file length: ' + c.length + ' chars');
