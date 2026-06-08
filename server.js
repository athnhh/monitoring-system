const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
const url = require('url');

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
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const saved = JSON.parse(raw);
      state = { ...state, ...saved };
      if (!state.departments || !state.departments.length) state.departments = ['Engineering', 'HR', 'IT', 'Marketing', 'Finance', 'Operations'];
      console.log(`Loaded: ${state.employees.length} employees, ${state.attendanceRecords.length} records`);
    } else {
      state.employees = [...DEFAULT_EMPLOYEES];
      saveData();
      console.log('Seeded default data.');
    }
  } catch (e) {
    console.error('Load error:', e.message);
    state.employees = [...DEFAULT_EMPLOYEES];
  }
}

function saveData() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf8'); }
  catch (e) { console.error('Save error:', e.message); }
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
  let filePath = req.url === '/' ? 'prototype.html' : req.url.slice(1);
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
          const emp = state.employees.find(e => e.id === uid && e.active);
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
          state.employees.push(emp); saveData();
          broadcast('employee_added', emp);
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
            state.archivedEmployees.push({ id: emp.id, name: emp.name, dept: emp.dept, status: 'Deleted', joining: emp.joining, exit: new Date().toISOString().split('T')[0] });
            state.employees.splice(idx, 1); saveData();
            broadcast('employee_deleted', { id });
            return sendJSON(res, 200, { success: true });
          }
          if (method === 'PUT') {
            const idx = state.employees.findIndex(e => e.id === id);
            if (idx === -1) return sendJSON(res, 404, { error: 'Not found' });
            state.employees[idx] = { ...state.employees[idx], ...body }; saveData();
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
          state.employees[idx].active = false; saveData();
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
          saveData(); broadcast('attendance_update', rec);
          return sendJSON(res, 200, { success: true });
        }
        break;

      // ── LEAVE REQUESTS ──
      case '/api/leave-requests':
        if (method === 'GET') return sendJSON(res, 200, state.leaveRequests);
        if (method === 'POST') {
          const lr = body; lr.idx = state.leaveRequests.length;
          state.leaveRequests.push(lr); saveData();
          broadcast('leave_request', lr);
          return sendJSON(res, 200, { success: true, leaveRequest: lr });
        }
        break;

      // ── ANNOUNCEMENTS ──
      case '/api/announcements':
        if (method === 'GET') return sendJSON(res, 200, state.announcements);
        if (method === 'POST') {
          const ann = body; state.announcements.unshift(ann); saveData();
          broadcast('announcement', ann);
          return sendJSON(res, 200, { success: true });
        }
        break;

      // ── DEPARTMENTS ──
      case '/api/departments':
        if (method === 'GET') return sendJSON(res, 200, state.departments);
        if (method === 'POST') {
          if (state.departments.includes(body.name)) return sendJSON(res, 400, { error: 'Exists' });
          state.departments.push(body.name); saveData();
          return sendJSON(res, 200, { success: true, departments: state.departments });
        }
        if (method === 'DELETE') {
          state.departments = state.departments.filter(d => d !== body.name); saveData();
          return sendJSON(res, 200, { success: true, departments: state.departments });
        }
        break;

      // ── PASSWORD ──
      case '/api/password':
        if (method === 'PUT') {
          const { userId, currentPwd, newPwd } = body;
          if (userId === 'quemahtech') {
            if (currentPwd !== state.adminPassword) return sendJSON(res, 400, { error: 'Wrong password' });
            state.adminPassword = newPwd; saveData();
            return sendJSON(res, 200, { success: true });
          }
          const emp = state.employees.find(e => e.id === userId);
          if (!emp) return sendJSON(res, 404, { error: 'Not found' });
          if (currentPwd !== (emp.password || 'emp123')) return sendJSON(res, 400, { error: 'Wrong password' });
          emp.password = newPwd; saveData();
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
          saveData(); broadcast('notification', notif);
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
          saveData();
          return sendJSON(res, 200, { success: true });
        }
        break;

      // ── SEND EMAIL (built-in SMTP, no nodemailer needed) ──
      case '/api/send-email': {
        if (method !== 'POST') break;
        const { to, subject, html, smtp } = body;
        if (!to || !subject) return sendJSON(res, 400, { error: 'Missing required fields' });
        try {
          const result = await sendEmail({
            host: smtp.host, port: smtp.port, user: smtp.user, pass: smtp.pass,
            to, subject, html: html || subject
          });
          return sendJSON(res, 200, result);
        } catch (err) {
          return sendJSON(res, 500, { error: 'Email failed: ' + err.message });
        }
      }

      // ── TEST SMTP ──
      case '/api/test-smtp': {
        if (method !== 'POST') break;
        try {
          const result = await sendEmail({
            host: body.host, port: parseInt(body.port), user: body.user, pass: body.pass,
            to: body.user, subject: 'TEST — SMTP Test',
            html: '<h2>SMTP Configuration Verified ✓</h2>'
          });
          return sendJSON(res, 200, result);
        } catch (err) {
          return sendJSON(res, 500, { error: 'SMTP test failed: ' + err.message });
        }
      }
    }
  } catch (err) {
    console.error('API error:', err);
    return sendJSON(res, 500, { error: err.message });
  }

  // Fallback route for notifications with userId in path
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
    saveData();
    return sendJSON(res, 200, { success: true });
  }

  // Department delete by name (e.g. DELETE /api/departments/Engineering)
  const deptMatch = parsed.pathname.match(/^\/api\/departments\/(.+)$/);
  if (deptMatch && method === 'DELETE') {
    state.departments = state.departments.filter(d => d !== decodeURIComponent(deptMatch[1]));
    saveData();
    return sendJSON(res, 200, { success: true, departments: state.departments });
  }

  // Leave request update by idx
  const leaveMatch = parsed.pathname.match(/^\/api\/leave-requests\/(\d+)$/);
  if (leaveMatch && method === 'PUT') {
    const idx = parseInt(leaveMatch[1]);
    if (idx >= 0 && idx < state.leaveRequests.length) {
      state.leaveRequests[idx] = { ...state.leaveRequests[idx], ...body }; saveData();
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
  // CORS headers for all responses
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // OPTIONS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // API routes
  if (req.url.startsWith('/api')) {
    return handleAPI(req, res);
  }

  // Static files
  if (serveStatic(req, res)) return;

  // 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

// ── WebSocket (local only — Vercel does not support persistent WS) ──
if (!process.env.VERCEL) {
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`WS connected. ${clients.size} clients`);
    ws.on('close', () => { clients.delete(ws); console.log(`WS disconnected. ${clients.size} clients`); });
    ws.on('error', () => clients.delete(ws));
  });
}

// ── SMTP (built-in, no nodemailer) ──
const net = require('net');
const tls = require('tls');

function sendEmail({ host, port, user, pass, to, subject, html }) {
  return new Promise((resolve, reject) => {
    const isSecure = port == 465;
    const p = parseInt(port) || 587;
    const opts = { host, port: p };
    let sock = isSecure ? tls.connect(opts, onConnect) : net.connect(opts, onConnect);
    let buffer = '', step = 0, secured = isSecure;

    function send(line) { sock.write(line + '\r\n'); }
    function bail(err) { try { sock.destroy(); } catch(e) {} reject(err); }

    sock.setTimeout(15000, () => bail(new Error('SMTP timeout')));
    sock.on('data', (data) => {
      buffer += data.toString();
      if (!buffer.includes('\r\n')) return;
      const lines = buffer.split('\r\n');
      const last = lines[lines.length - 2] || '';
      if (last.length < 4 || (last[3] === '-' && !buffer.endsWith('\r\n'))) return;
      const code = parseInt(last.slice(0, 3));
      const msg = buffer;
      buffer = '';
      if (code >= 500) return bail(new Error('SMTP error ' + msg));
      step++;
      try { handleStep(code, msg); } catch(e) { bail(e); }
    });
    sock.on('error', bail);

    function onConnect() {}
    function handleStep(code, msg) {
      if (step === 1) send('EHLO quemahtech.local');
      else if (step === 2) {
        if (!secured && msg.toUpperCase().includes('STARTTLS')) send('STARTTLS');
        else { send('AUTH LOGIN'); secured = true; }
      }
      else if (step === 3 && !secured) {
        secured = true;
        sock = tls.connect({ socket: sock, host }, () => { step = 1; sock.write('EHLO quemahtech.local\r\n'); });
        sock.on('data', (d) => {
          buffer += d.toString();
          const ls = buffer.split('\r\n'), l = ls[ls.length-2]||'';
          if (l.length<4||(l[3]==='-'&&!buffer.endsWith('\r\n'))) return;
          const c = parseInt(l.slice(0,3));
          if(c>=500) return bail(new Error('SMTP TLS error'));
          buffer=''; step++;
          if(step===2) sock.write('AUTH LOGIN\r\n');
        });
        sock.on('error', bail);
      }
      else if (step === 3) send(Buffer.from(user).toString('base64'));
      else if (step === 4) send(Buffer.from(pass).toString('base64'));
      else if (step === 5) send('MAIL FROM:<' + user + '>');
      else if (step === 6) send('RCPT TO:<' + to + '>');
      else if (step === 7) send('DATA');
      else if (step === 8) {
        let content = 'From: ' + user + '\r\nTo: ' + to + '\r\nSubject: ' + subject + '\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset="UTF-8"\r\n\r\n' + (html || subject) + '\r\n.\r\n';
        send(content);
      }
      else if (step === 9) { send('QUIT'); try { sock.destroy(); } catch(e){} resolve({ success: true, message: 'Email sent' }); }
    }
  });
}

// ── Start (always) ──
loadData();

// ── Export for Vercel ──
module.exports = server;

// ── Local server listen ──
if (!process.env.VERCEL) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  TEST Employee Management System`);
    console.log(`  http://localhost:${PORT}`);
    console.log(`  Admin: quemahtech / quemah123`);
    console.log(`  Emp:   EMP001 / emp123\n`);
  });
}
