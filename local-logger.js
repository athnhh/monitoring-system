/**
 * local-logger.js — Quemahtech Windows PC Attendance Logger
 *
 * Runs locally on employee Windows machines.
 * Writes attendance (login/logout/shutdown) to the SMB network share
 * \\AttendanceServerPC\AttendanceData\attendance_log.csv
 *
 * If the network share is unreachable, it queues locally in
 * local_queue.json and retries until the share comes back online.
 *
 * Usage:
 *   node local-logger.js signin  EMP001
 *   node local-logger.js signout EMP001
 *   node local-logger.js status
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');

const SUPABASE_URL = 'https://jrdfxkyhoutwzdbieefq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_vbDey0Diibq15CBKL4pXFA_Bl6U38T9';

const SMB_SHARE = '\\\\AttendanceServerPC\\AttendanceData';
const CSV_PATH   = path.join(SMB_SHARE, 'attendance_log.csv');
const QUEUE_PATH = path.join(__dirname, 'local_queue.json');
const RETRY_INTERVAL_MS = 30000; // 30 seconds

const computerName = os.hostname();
const userName     = os.userInfo().username;

// ── Helpers ──

function timestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function csvEscape(val) {
  if (val == null) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// ── CSV writer ──

// ── Supabase REST sync ──

async function syncToSupabase(entry) {
  try {
    const dateStr = entry.timestamp.split(' ')[0];
    const timeStr = entry.timestamp.split(' ')[1] || '';
    const record = {
      id: entry.employeeId,
      name: entry.user || '',
      dept: '',
      date: dateStr,
      in: entry.event === 'SIGNIN' ? timeStr : '',
      out: entry.event === 'SIGNOUT' || entry.event === 'SHUTDOWN' ? timeStr : '',
      hours: 0,
      status: 'Present',
      notes: `Auto-logged from ${entry.computer} (${entry.event})`
    };

    const response = await fetch(`${SUPABASE_URL}/rest/v1/attendance`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(record)
    });

    if (!response.ok) {
      throw new Error(`Supabase sync failed: ${response.status} ${response.statusText}`);
    }
    console.log(`[SUPABASE] Synced ${entry.event} ${entry.employeeId} to cloud`);
    return true;
  } catch (err) {
    console.warn(`[SUPABASE-OFFLINE] ${err.message}`);
    return false;
  }
}

function appendCSV(entry) {
  const line = [
    csvEscape(entry.timestamp),
    csvEscape(entry.employeeId),
    csvEscape(entry.event),    // SIGNIN, SIGNOUT, SHUTDOWN
    csvEscape(entry.computer),
    csvEscape(entry.user),
    csvEscape(entry.ip || ''),
    csvEscape(entry.notes || '')
  ].join(',') + '\n';

  const csvOk = (() => {
    try {
      if (!fs.existsSync(SMB_SHARE)) throw new Error('SMB share not reachable');
      let header = '';
      if (!fs.existsSync(CSV_PATH)) header = 'Timestamp,EmployeeID,Event,Computer,User,IP,Notes\n';
      fs.appendFileSync(CSV_PATH, header + line, 'utf8');
      console.log(`[OK] Logged to ${CSV_PATH}: ${entry.event} ${entry.employeeId}`);
      return true;
    } catch (err) {
      console.warn(`[OFFLINE] ${err.message} — queuing entry locally`);
      return false;
    }
  })();

  // Also try Supabase sync
  syncToSupabase(entry);

  if (!csvOk) queueEntry(entry);
  return csvOk;
}

// ── Local queue (offline resilience) ──

function queueEntry(entry) {
  let queue = [];
  try {
    if (fs.existsSync(QUEUE_PATH)) {
      queue = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8'));
    }
  } catch (_) { queue = []; }

  queue.push({ ...entry, _queuedAt: new Date().toISOString() });

  try {
    fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2), 'utf8');
    console.log(`[QUEUED] ${queue.length} pending entries`);
  } catch (e) {
    console.error(`[FATAL] Cannot write queue file: ${e.message}`);
  }
}

function flushQueue() {
  if (!fs.existsSync(QUEUE_PATH)) return;

  let queue;
  try {
    queue = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8'));
  } catch (_) { return; }

  if (!queue.length) return;

  // Quick reachability check
  try {
    if (!fs.existsSync(SMB_SHARE)) {
      console.log(`[RETRY] SMB share still unreachable — ${queue.length} entries remain queued`);
      return;
    }
  } catch (_) { return; }

  const remaining = [];
  for (const entry of queue) {
    try {
      const line = [
        csvEscape(entry.timestamp || entry._queuedAt),
        csvEscape(entry.employeeId),
        csvEscape(entry.event),
        csvEscape(entry.computer),
        csvEscape(entry.user),
        csvEscape(entry.ip || ''),
        csvEscape(entry.notes || '')
      ].join(',') + '\n';

      let header = '';
      if (!fs.existsSync(CSV_PATH)) {
        header = 'Timestamp,EmployeeID,Event,Computer,User,IP,Notes\n';
      }
      fs.appendFileSync(CSV_PATH, header + line, 'utf8');
      console.log(`[SYNCED] ${entry.event} ${entry.employeeId}`);
    } catch (_) {
      remaining.push(entry);
    }
  }

  if (remaining.length) {
    fs.writeFileSync(QUEUE_PATH, JSON.stringify(remaining, null, 2), 'utf8');
    console.log(`[RETRY] ${remaining.length}/${queue.length} entries still queued`);
  } else {
    fs.unlinkSync(QUEUE_PATH);
    console.log('[OK] All queued entries synced to network share');
  }
}

// ── Main ──

function main() {
  const cmd = process.argv[2];
  const empId = process.argv[3] || 'UNKNOWN';

  if (!cmd) {
    console.log('Usage:');
    console.log('  node local-logger.js signin  EMP001');
    console.log('  node local-logger.js signout EMP001');
    console.log('  node local-logger.js shutdown EMP001');
    console.log('  node local-logger.js status');
    process.exit(0);
  }

  if (cmd === 'status') {
    const queued = fs.existsSync(QUEUE_PATH)
      ? JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8') || '[]').length
      : 0;
    const shareOk = (() => { try { return fs.existsSync(SMB_SHARE); } catch (_) { return false; } })();
    console.log(`Share reachable : ${shareOk}`);
    console.log(`Queued entries  : ${queued}`);
    console.log(`Computer       : ${computerName}`);
    console.log(`User           : ${userName}`);
    process.exit(0);
  }

  const eventMap = {
    signin:  'SIGNIN',
    signout: 'SIGNOUT',
    shutdown: 'SHUTDOWN'
  };

  const event = eventMap[cmd];
  if (!event) {
    console.error(`Unknown command: ${cmd}. Use signin, signout, shutdown, or status.`);
    process.exit(1);
  }

  // Collect IP addresses
  let ip = '';
  try {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const iface of ifaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          ip = iface.address;
          break;
        }
      }
      if (ip) break;
    }
  } catch (_) {}

  const entry = {
    timestamp: timestamp(),
    employeeId: empId,
    event,
    computer: computerName,
    user: userName,
    ip,
    notes: ''
  };

  appendCSV(entry);

  // Schedule retry for queued entries
  if (fs.existsSync(QUEUE_PATH)) {
    setInterval(flushQueue, RETRY_INTERVAL_MS);
    // Also try once immediately after a brief delay
    setTimeout(flushQueue, 2000);
  }
}

// ── Start ──
main();
