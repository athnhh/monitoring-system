const fs = require('fs');
let c = fs.readFileSync('script.js', 'utf8');

const oldStr = 'CREATE INDEX IF NOT EXISTS idx_attendance_logs_active\n  ON attendance_logs (emp_id, logout_time) WHERE logout_time IS NULL;';

const newStr = `-- Partial unique index: at most one active session per employee (DB-level duplicate prevention)\nCREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_logs_active_unique\n  ON attendance_logs (emp_id)\n  WHERE logout_time IS NULL;\n\n-- Non-unique index for fast active-session lookup (kept for broader queries)\nCREATE INDEX IF NOT EXISTS idx_attendance_logs_active\n  ON attendance_logs (emp_id, logout_time) WHERE logout_time IS NULL;`;

if (c.includes(oldStr)) {
  c = c.replace(oldStr, newStr);
  fs.writeFileSync('script.js', c, 'utf8');
  console.log('✅ script.js updated successfully');
} else {
  console.log('❌ old string not found in script.js');
  // Debug: find what's around idx_attendance_logs_active
  const idx = c.indexOf('idx_attendance_logs_active');
  if (idx >= 0) {
    const context = c.slice(Math.max(0, idx - 50), idx + 90);
    console.log('Context around match:', JSON.stringify(context));
  }
}
