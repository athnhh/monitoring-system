require('dotenv').config();
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
const url = require('url');
const nodemailer = require('nodemailer');

const { initFirebase, isFirebaseReady, readState, writeState, updateState } = require('./firebase');
const calendarService = require('./google-calendar');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

// ── Data Store ──
let state = {
  adminPassword: 'quemah123',
  employees: [],
  archivedEmployees: [],
  attendanceRecords: [],
  leaveRequests: [],
  announcements: [],
  adminNotifications: [],
  empNotifications: [],
  departments: ['Engineering', 'HR', 'IT', 'Marketing', 'Finance', 'Operations']
};

const DEFAULT_EMPLOYEES = [
  { id: 'EMP001', name: 'Rahul Sharma', dept: 'Engineering', email: 'rahul@test.com', phone: '+91 98765 43210', bday: '1990-05-15', joining: '2023-01-10', designation: 'Senior Developer', cl: 7.5, sl: 3.0, ul: 0, active: true, password: 'emp123' },
  { id: 'EMP002', name: 'Priya Patel', dept: 'HR', email: 'priya@test.com', phone: '+91 87654 32109', bday: '1992-08-22', joining: '2023-03-15', designation: 'HR Manager', cl: 7.5, sl: 3.0, ul: 0, active: true, password: 'emp123' }
];

// ── Data Persistence ──
async function loadData() {
  // Try Firebase first if configured
  if (isFirebaseReady()) {
    try {
      const fbState = await readState();
      if (fbState) {
        state = { ...state, ...fbState };
        if (!state.departments || !state.departments.length) state.departments = ['Engineering', 'HR', 'IT', 'Marketing', 'Finance', 'Operations'];
        console.log(`Loaded from Firebase: ${state.employees.length} employees, ${state.attendanceRecords.length} records`);
        return;
      }
    } catch (e) {
      console.error('Firebase load error, falling back to file:', e.message);
    }
  }

  // Fall back to local data.json
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const saved = JSON.parse(raw);
      state = { ...state, ...saved };
      if (!state.departments || !state.departments.length) state.departments = ['Engineering', 'HR', 'IT', 'Marketing', 'Finance', 'Operations'];
      console.log(`Loaded from file: ${state.employees.length} employees, ${state.attendanceRecords.length} records`);
    } else {
      state.employees = [...DEFAULT_EMPLOYEES];
      await saveData();
      console.log('Seeded default data.');
    }
  } catch (e) {
    console.error('Load error:', e.message);
    state.employees = [...DEFAULT_EMPLOYEES];
  }
}

async function saveData() {
  // Save to Firebase if configured
  if (isFirebaseReady()) {
    try {
      await writeState(state);
      return;
    } catch (e) {
      console.error('Firebase save error, falling back to file:', e.message);
    }
  }

  // Fall back to local data.json
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {
    console.error('Save error:', e.message);
  }
}

// ── Helpers ──
const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp'
};

function sendJSON(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}

// ── Email Config (server-side) ──
// Priority: environment variables > email-config.json file
const EMAIL_CONFIG_PATH = path.join(__dirname, 'email-config.json');
function getEmailConfig() {
  // 1) Check environment variables first (for Vercel / CI deployments)
  if (process.env.SMTP_EMAIL && process.env.SMTP_PASSWORD) {
    return {
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      email: process.env.SMTP_EMAIL,
      password: process.env.SMTP_PASSWORD
    };
  }
  // 2) Fall back to local email-config.json file
  try {
    if (fs.existsSync(EMAIL_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(EMAIL_CONFIG_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('Email config error:', e.message);
  }
  return { host: '', port: 587, email: '', password: '' };
}

// ── Notify admin of new leave request via email ──
async function notifyAdminLeaveRequest(lr) {
  const cfg = getEmailConfig();
  if (!cfg.email || !cfg.password) return;
  const fromDate = lr.from || '—';
  const toDate = lr.to || '—';
  const subject = `New Leave Request: ${lr.empName} (${lr.type})`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
  <div style="background:linear-gradient(135deg,#0f2744,#1a3355);padding:24px;text-align:center;border-radius:12px 12px 0 0;">
    <h1 style="color:#f59e0b;margin:0;font-size:20px;">📋 New Leave Request</h1>
    <p style="color:#94a3b8;margin:6px 0 0;font-size:13px;">Employee Management System</p>
  </div>
  <div style="padding:28px 24px;background:#fff;border:1px solid #e2e8f0;border-radius:0 0 12px 12px;">
    <p style="color:#1e293b;font-size:15px;line-height:1.7;margin:0 0 16px;">A new leave request has been submitted and requires your review.</p>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:16px;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr><td style="color:#64748b;padding:4px 8px;">Employee</td><td style="color:#1e293b;font-weight:600;padding:4px 8px;">${lr.empName}</td></tr>
        <tr><td style="color:#64748b;padding:4px 8px;">Department</td><td style="color:#1e293b;font-weight:600;padding:4px 8px;">${lr.dept || '—'}</td></tr>
        <tr><td style="color:#64748b;padding:4px 8px;">Leave Type</td><td style="color:#1e293b;font-weight:600;padding:4px 8px;">${lr.type}</td></tr>
        <tr><td style="color:#64748b;padding:4px 8px;">From</td><td style="color:#1e293b;font-weight:600;padding:4px 8px;">${fromDate}</td></tr>
        <tr><td style="color:#64748b;padding:4px 8px;">To</td><td style="color:#1e293b;font-weight:600;padding:4px 8px;">${toDate}</td></tr>
        <tr><td style="color:#64748b;padding:4px 8px;">Duration</td><td style="color:#1e293b;font-weight:600;padding:4px 8px;">${lr.days} day(s)</td></tr>
      </table>
    </div>
    <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:14px 16px;margin-bottom:16px;">
      <p style="color:#92400e;font-size:13px;margin:0;"><strong>Reason:</strong> ${lr.reason || 'Not provided'}</p>
    </div>
    <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 12px;">Please log in to the admin panel to review and respond to this request.</p>
    <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 12px;">Regards,</p>
    <p style="color:#0f2744;font-size:14px;font-weight:700;margin:0;">Quemahtech Employee Management System</p>
  </div>
</div>`;
  await sendEmail({
    to: cfg.email,
    subject,
    html
  });
}

// ── Nodemailer Helper ──
function createTransporter(cfg) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: {
      user: cfg.email,
      pass: cfg.password
    },
    tls: {
      rejectUnauthorized: false
    }
  });
}

async function sendEmail({ to, cc, bcc, subject, html }) {
  const cfg = getEmailConfig();
  if (!cfg.email || !cfg.password) {
    throw new Error('Email not configured. Edit email-config.json with your SMTP credentials.');
  }
  const transporter = createTransporter(cfg);
  const info = await transporter.sendMail({
    from: `"Quemahtech EMS" <${cfg.email}>`,
    to,
    cc: cc || undefined,
    bcc: bcc || undefined,
    subject,
    html,
    text: html ? html.replace(/<[^>]*>/g, '') : subject
  });
  return { success: true, messageId: info.messageId };
}

async function testSmtpConnection() {
  const cfg = getEmailConfig();
  if (!cfg.email || !cfg.password) {
    throw new Error('Email not configured. Edit email-config.json with your SMTP credentials.');
  }
  const transporter = createTransporter(cfg);
  await transporter.verify();
  return { success: true, message: 'SMTP connection verified' };
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve({}); }
    });
  });
}

function serveStatic(req, res) {
  let filePath = req.url === '/' ? 'index.html' : req.url.slice(1);
  // Try dist/ first, fall back to root
  const distPath = path.join(__dirname, 'dist', filePath);
  const rootPath = path.join(__dirname, filePath);

  let fullPath = fs.existsSync(distPath) ? distPath : rootPath;
  if (!fs.existsSync(fullPath)) return false;

  const ext = path.extname(fullPath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';
  const content = fs.readFileSync(fullPath);
  res.writeHead(200, { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' });
  res.end(content);
  return true;
}

async function handleAPI(req, res) {
  const parsed = url.parse(req.url, true);
  const method = req.method;
  const parts = parsed.pathname.split('/').filter(Boolean);

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  // API routes
  if (parts[0] !== 'api') return sendJSON(res, 404, { error: 'Not found' });

  const body = method === 'POST' || method === 'PUT' ? await parseBody(req) : {};

  try {
    switch (parsed.pathname) {
      // ── LOGIN ──
      case '/api/login': {
        if (method !== 'POST') break;
        const { uid, pwd, role } = body;
        if (role === 'admin' && uid === 'quemahtech' && pwd === state.adminPassword)
          return sendJSON(res, 200, { success: true, role: 'admin', user: { id: 'quemahtech', name: 'Administrator' } });
        if (role === 'employee') {
          const emp = state.employees.find(e => e.id.toLowerCase() === uid.toLowerCase() && e.active);
          if (emp && (emp.password || 'emp123') === pwd)
            return sendJSON(res, 200, { success: true, role: 'employee', user: { id: emp.id, name: emp.name, dept: emp.dept, designation: emp.designation, cl: emp.cl, sl: emp.sl, ul: emp.ul } });
        }
        return sendJSON(res, 200, { success: false });
      }

      // ── STATE ──
      case '/api/state':
        return sendJSON(res, 200, {
          employees: state.employees, archivedEmployees: state.archivedEmployees,
          attendanceRecords: state.attendanceRecords, leaveRequests: state.leaveRequests,
          announcements: state.announcements, departments: state.departments
        });

      // ── EMPLOYEES ──
      case '/api/employees':
        if (method === 'GET') return sendJSON(res, 200, state.employees);
        if (method === 'POST') {
          const emp = body;
          if (state.employees.some(e => e.id === emp.id))
            return sendJSON(res, 400, { error: 'Employee ID already exists' });
          emp.active = true; emp.ul = emp.ul || 0;
          state.employees.push(emp); await saveData();
          broadcast('employee_added', emp);
          // Auto-create Google Calendar birthday event if configured
          if (emp.bday) {
            calendarService.createBirthdayEvent(emp).then(result => {
              if (result.success) {
                emp.calendarEventId = result.eventId;
                saveData();
                console.log(`Birthday event created for ${emp.name}`);
              }
            }).catch(err => console.error('Birthday event creation failed:', err.message));
          }
          return sendJSON(res, 200, { success: true, employee: emp });
        }
        break;

      // ── EMPLOYEE CRUD ──
      default: {
        const empMatch = parsed.pathname.match(/^\/api\/employees\/(.+)$/);
        if (empMatch) {
          const id = empMatch[1];
          if (method === 'DELETE') {
            const idx = state.employees.findIndex(e => e.id === id);
            if (idx === -1) return sendJSON(res, 404, { error: 'Not found' });
            const emp = state.employees[idx];
            // Remove Google Calendar event if exists
            if (emp.calendarEventId) {
              calendarService.deleteBirthdayEvent(emp.calendarEventId).catch(err =>
                console.error('Failed to delete calendar event for', emp.name, ':', err.message)
              );
            }
            state.archivedEmployees.push({ id: emp.id, name: emp.name, dept: emp.dept, status: 'Deleted', joining: emp.joining, exit: new Date().toISOString().split('T')[0] });
            state.employees.splice(idx, 1); await saveData();
            broadcast('employee_deleted', { id });
            return sendJSON(res, 200, { success: true });
          }
          if (method === 'PUT') {
            const idx = state.employees.findIndex(e => e.id === id);
            if (idx === -1) return sendJSON(res, 404, { error: 'Not found' });
            const oldBday = state.employees[idx].bday;
            state.employees[idx] = { ...state.employees[idx], ...body }; await saveData();
            // If birthday changed/added, update calendar event
            const newBday = state.employees[idx].bday;
            if (newBday && newBday !== oldBday) {
              calendarService.createBirthdayEvent(state.employees[idx]).then(result => {
                if (result.success) {
                  state.employees[idx].calendarEventId = result.eventId;
                  saveData();
                }
              }).catch(err => console.error('Birthday event update failed:', err.message));
            }
            return sendJSON(res, 200, { success: true, employee: state.employees[idx] });
          }
        }
        const archiveMatch = parsed.pathname.match(/^\/api\/employees\/(.+)\/archive$/);
        if (archiveMatch && method === 'POST') {
          const id = archiveMatch[1];
          const idx = state.employees.findIndex(e => e.id === id);
          if (idx === -1) return sendJSON(res, 404, { error: 'Not found' });
          const emp = state.employees[idx];
          state.archivedEmployees.push({ id: emp.id, name: emp.name, dept: emp.dept, status: 'Archived', joining: emp.joining, exit: new Date().toISOString().split('T')[0] });
          state.employees[idx].active = false; await saveData();
          broadcast('employee_archived', { id });
          return sendJSON(res, 200, { success: true });
        }
        break;
      }

      // ── ATTENDANCE ──
      case '/api/attendance':
        if (method === 'GET') return sendJSON(res, 200, state.attendanceRecords);
        if (method === 'POST') {
          const rec = body;
          const existing = state.attendanceRecords.findIndex(r => r.id === rec.id && r.date === rec.date);
          if (existing >= 0) state.attendanceRecords[existing] = { ...state.attendanceRecords[existing], ...rec };
          else state.attendanceRecords.unshift(rec);
          await saveData(); broadcast('attendance_update', rec);
          return sendJSON(res, 200, { success: true });
        }
        break;

      // ── LEAVE REQUESTS ──
      case '/api/leave-requests':
        if (method === 'GET') return sendJSON(res, 200, state.leaveRequests);
        if (method === 'POST') {
          const lr = body; lr.idx = state.leaveRequests.length;
          state.leaveRequests.push(lr); await saveData();
          broadcast('leave_request', lr);
          // ── Auto-send email notification to admin ──
          notifyAdminLeaveRequest(lr).catch(err => console.error('Leave email notification failed:', err.message));
          return sendJSON(res, 200, { success: true, leaveRequest: lr });
        }
        break;

      // ── ANNOUNCEMENTS ──
      case '/api/announcements':
        if (method === 'GET') return sendJSON(res, 200, state.announcements);
        if (method === 'POST') {
          const ann = body; state.announcements.unshift(ann); await saveData();
          broadcast('announcement', ann);
          return sendJSON(res, 200, { success: true });
        }
        break;

      // ── DEPARTMENTS ──
      case '/api/departments':
        if (method === 'GET') return sendJSON(res, 200, state.departments);
        if (method === 'POST') {
          if (state.departments.includes(body.name)) return sendJSON(res, 400, { error: 'Exists' });
          state.departments.push(body.name); await saveData();
          return sendJSON(res, 200, { success: true, departments: state.departments });
        }
        if (method === 'DELETE') {
          state.departments = state.departments.filter(d => d !== body.name); await saveData();
          return sendJSON(res, 200, { success: true, departments: state.departments });
        }
        break;

      // ── PASSWORD ──
      case '/api/password':
        if (method === 'PUT') {
          const { userId, currentPwd, newPwd } = body;
          if (userId === 'quemahtech') {
            if (currentPwd !== state.adminPassword) return sendJSON(res, 400, { error: 'Wrong password' });
            state.adminPassword = newPwd; await saveData();
            return sendJSON(res, 200, { success: true });
          }
          const emp = state.employees.find(e => e.id === userId);
          if (!emp) return sendJSON(res, 404, { error: 'Not found' });
          if (currentPwd !== (emp.password || 'emp123')) return sendJSON(res, 400, { error: 'Wrong password' });
          emp.password = newPwd; await saveData();
          return sendJSON(res, 200, { success: true });
        }
        break;

      // ── NOTIFICATIONS ──
      case '/api/notifications':
        if (method === 'POST') {
          const notif = body;
          notif.time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
          notif.unread = true;
          if (notif.target === 'admin') state.adminNotifications.unshift(notif);
          else state.empNotifications.unshift(notif);
          await saveData(); broadcast('notification', notif);
          return sendJSON(res, 200, { success: true });
        }
        break;

      // ── SAVE (bulk) ──
      case '/api/save':
        if (method === 'POST') {
          const data = body;
          if (data.employees) state.employees = data.employees;
          if (data.archivedEmployees) state.archivedEmployees = data.archivedEmployees;
          if (data.attendanceRecords) state.attendanceRecords = data.attendanceRecords;
          if (data.leaveRequests) state.leaveRequests = data.leaveRequests;
          if (data.announcements) state.announcements = data.announcements;
          if (data.adminNotifications) state.adminNotifications = data.adminNotifications;
          if (data.empNotifications) state.empNotifications = data.empNotifications;
          if (data.departments) state.departments = data.departments;
          await saveData();
          return sendJSON(res, 200, { success: true });
        }
        break;

      // ── SEND EMAIL (Nodemailer — reads SMTP config from email-config.json) ──
      case '/api/send-email': {
        if (method !== 'POST') break;
        const { to, subject, html } = body;
        if (!to || !subject) return sendJSON(res, 400, { error: 'Missing required fields' });
        try {
          const result = await sendEmail({
            to,
            cc: body.cc || '',
            bcc: body.bcc || '',
            subject,
            html: html || subject
          });
          return sendJSON(res, 200, result);
        } catch (err) {
          return sendJSON(res, 500, { error: 'Email failed: ' + err.message });
        }
      }

      // ── TEST SMTP CONFIG (reads from email-config.json) ──
      case '/api/test-smtp': {
        if (method !== 'POST') break;
        try {
          const result = await testSmtpConnection();
          return sendJSON(res, 200, result);
        } catch (err) {
          return sendJSON(res, 500, { error: 'SMTP test failed: ' + err.message });
        }
      }

      // ── GET EMAIL CONFIG (exposes email address without password) ──
      case '/api/email-config': {
        if (method !== 'GET') break;
        const cfg = getEmailConfig();
        return sendJSON(res, 200, {
          configured: !!(cfg.email && cfg.password),
          host: cfg.host || '',
          port: cfg.port || 587,
          email: cfg.email || ''
        });
      }

      // ── GOOGLE CALENDAR CONFIG ──
      case '/api/calendar-config': {
        if (method === 'GET') {
          const cc = calendarService.getCalendarConfig();
          return sendJSON(res, 200, {
            enabled: cc.enabled || false,
            serviceAccountPath: cc.serviceAccountPath || '',
            calendarId: cc.calendarId || 'primary'
          });
        }
        if (method === 'POST') {
          const saved = calendarService.saveCalendarConfig({
            serviceAccountPath: body.serviceAccountPath || '',
            calendarId: body.calendarId || 'primary',
            enabled: !!body.enabled
          });
          if (saved) return sendJSON(res, 200, { success: true, message: 'Calendar config saved' });
          return sendJSON(res, 500, { error: 'Failed to save calendar config' });
        }
        break;
      }

      // ── CREATE/UPDATE BIRTHDAY EVENT FOR EMPLOYEE ──
      case '/api/calendar/birthday': {
        if (method !== 'POST') break;
        const { employeeId } = body;
        const emp = state.employees.find(e => e.id === employeeId);
        if (!emp) return sendJSON(res, 404, { error: 'Employee not found' });
        if (!emp.bday) return sendJSON(res, 400, { error: 'Employee has no birthday set' });
        // Delete old event if exists
        if (emp.calendarEventId) {
          await calendarService.deleteBirthdayEvent(emp.calendarEventId).catch(() => {});
        }
        const result = await calendarService.createBirthdayEvent(emp);
        if (result.success) {
          emp.calendarEventId = result.eventId;
          await saveData();
        }
        return sendJSON(res, result.success ? 200 : 500, result);
      }

      // ── SYNC ALL BIRTHDAYS TO CALENDAR ──
      case '/api/calendar/sync-birthdays': {
        if (method !== 'POST') break;
        const cc = calendarService.getCalendarConfig();
        if (!cc.enabled) return sendJSON(res, 400, { error: 'Calendar not configured. Set up in Settings first.' });
        const results = [];
        for (const emp of state.employees) {
          if (!emp.active || !emp.bday) continue;
          // Delete old event if re-syncing
          if (emp.calendarEventId) {
            await calendarService.deleteBirthdayEvent(emp.calendarEventId).catch(() => {});
          }
          const result = await calendarService.createBirthdayEvent(emp);
          if (result.success) {
            emp.calendarEventId = result.eventId;
            results.push({ id: emp.id, name: emp.name, success: true });
          } else {
            results.push({ id: emp.id, name: emp.name, success: false, error: result.error });
          }
        }
        await saveData();
        return sendJSON(res, 200, { success: true, results });
      }

    }
  } catch (err) {
    console.error('API error:', err);
    return sendJSON(res, 500, { error: err.message });
  }

  // Fallback routes
  const notifGetMatch = parsed.pathname.match(/^\/api\/notifications\/(.+)$/);
  if (notifGetMatch && method === 'GET') {
    const userId = notifGetMatch[1];
    if (userId === 'quemahtech') return sendJSON(res, 200, state.adminNotifications);
    return sendJSON(res, 200, state.empNotifications.filter(n => n.userId === userId || !n.userId));
  }

  const notifReadMatch = parsed.pathname === '/api/notifications/read';
  if (notifReadMatch && method === 'PUT') {
    const arr = body.userId === 'quemahtech' ? state.adminNotifications : state.empNotifications;
    if (arr[body.idx]) arr[body.idx].unread = false;
    await saveData();
    return sendJSON(res, 200, { success: true });
  }

  const deptMatch = parsed.pathname.match(/^\/api\/departments\/(.+)$/);
  if (deptMatch && method === 'DELETE') {
    state.departments = state.departments.filter(d => d !== decodeURIComponent(deptMatch[1]));
    await saveData();
    return sendJSON(res, 200, { success: true, departments: state.departments });
  }

  const leaveMatch = parsed.pathname.match(/^\/api\/leave-requests\/(\d+)$/);
  if (leaveMatch && method === 'PUT') {
    const idx = parseInt(leaveMatch[1]);
    if (idx >= 0 && idx < state.leaveRequests.length) {
      state.leaveRequests[idx] = { ...state.leaveRequests[idx], ...body }; await saveData();
      broadcast('leave_update', state.leaveRequests[idx]);
      return sendJSON(res, 200, { success: true });
    }
    return sendJSON(res, 404, { error: 'Not found' });
  }

  return sendJSON(res, 404, { error: 'Route not found' });
}

// ── WebSocket broadcast ──
const clients = new Set();

function broadcast(event, data) {
  const msg = JSON.stringify({ event, data });
  for (const ws of clients) {
    try { ws.send(msg); } catch (e) { /* ignore */ }
  }
}

// ── Server ──
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.url.startsWith('/api')) {
    return handleAPI(req, res);
  }

  if (serveStatic(req, res)) return;

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

// ── WebSocket (disabled on Vercel — no persistent WS support) ──
if (!process.env.VERCEL) {
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`WS connected. ${clients.size} clients`);
    ws.on('close', () => { clients.delete(ws); console.log(`WS disconnected. ${clients.size} clients`); });
    ws.on('error', () => clients.delete(ws));
  });
}

// ── Ready flag for Vercel cold starts ──
let serverReady = false;

// Wrap the server handler to wait for initialization
const wrappedHandler = async (req, res) => {
  if (!serverReady) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Server still initializing, please retry.' }));
    return;
  }
  return server(req, res);
};

// ── Export for Vercel ──
module.exports = wrappedHandler;

// ── Start ──
async function start() {
  // Initialize Firebase (if configured)
  initFirebase();
  // Load data from Firebase or file
  await loadData();
  serverReady = true;

  if (!process.env.VERCEL) {
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`\n  Quemahtech Employee Management System`);
      console.log(`  http://localhost:${PORT}`);
      console.log(`  Admin: quemahtech / quemah123`);
      console.log(`  Emp:   EMP001 / emp123\n`);
    });
  }
}

start();
