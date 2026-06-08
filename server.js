const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

// Data Store
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
// Default employees
const DEFAULT_EMPLOYEES = [
  { id: 'EMP001', name: 'Rahul Sharma', dept: 'Engineering', email: 'rahul@quemahtech.com', phone: '+91 98765 43210', bday: '1990-05-15', joining: '2023-01-10', designation: 'Senior Developer', cl: 7.5, sl: 3.0, ul: 0, active: true, password: 'emp123' },
  { id: 'EMP002', name: 'Priya Patel', dept: 'HR', email: 'priya@quemahtech.com', phone: '+91 87654 32109', bday: '1992-08-22', joining: '2023-03-15', designation: 'HR Manager', cl: 7.5, sl: 3.0, ul: 0, active: true, password: 'emp123' }
];

// Load/Save
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const saved = JSON.parse(raw);
      state = { ...state, ...saved };
      // Ensure departments
      if (!state.departments || state.departments.length === 0) {
        state.departments = ['Engineering', 'HR', 'IT', 'Marketing', 'Finance', 'Operations'];
      }
      console.log(`Loaded data: ${state.employees.length} employees, ${state.attendanceRecords.length} records`);
    } else {
      // First run — seed with defaults
      state.employees = [...DEFAULT_EMPLOYEES];
      saveData();
      console.log('Seeded default data.');
    }
  } catch (e) {
    console.error('Error loading data, using defaults:', e.message);      state.employees = [...DEFAULT_EMPLOYEES];
  }
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving data:', e.message);
  }
}

// WebSocket broadcast
const clients = new Set();

function broadcast(event, data) {
  const msg = JSON.stringify({ event, data });
  for (const ws of clients) {
    try {
      ws.send(msg);
    } catch (e) { /* ignore */ }
  }
}

// Express App
const app = express();
app.use(express.json());

// Serve from dist/ folder first (minified production build), fall back to root
const DIST_DIR = path.join(__dirname, 'dist');
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  console.log(`Serving minified production build from ${DIST_DIR}`);
}
app.use(express.static(path.join(__dirname)));

// Serve prototype.html (prefer dist/ version, fallback to root)
app.get('/', (req, res) => {
  const distHtml = path.join(DIST_DIR, 'prototype.html');
  if (fs.existsSync(distHtml)) {
    res.sendFile(distHtml);
  } else {
    res.sendFile(path.join(__dirname, 'prototype.html'));
  }
});

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// API Routes

// LOGIN
app.post('/api/login', (req, res) => {
  const { uid, pwd, role } = req.body;
  if (role === 'admin' && uid === 'quemahtech' && pwd === state.adminPassword) {
    return res.json({ success: true, role: 'admin', user: { id: 'quemahtech', name: 'Administrator' } });
  }
  if (role === 'employee') {
    const emp = state.employees.find(e => e.id === uid && e.active);
    if (emp && (emp.password || 'emp123') === pwd) {
      return res.json({ success: true, role: 'employee', user: { id: emp.id, name: emp.name, dept: emp.dept, designation: emp.designation, cl: emp.cl, sl: emp.sl, ul: emp.ul } });
    }
  }
  res.json({ success: false });
});

// GET ALL STATE (for initial load)
app.get('/api/state', (req, res) => {
  res.json({
    employees: state.employees,
    archivedEmployees: state.archivedEmployees,
    attendanceRecords: state.attendanceRecords,
    leaveRequests: state.leaveRequests,
    announcements: state.announcements,
    departments: state.departments
  });
});

// EMPLOYEES
app.get('/api/employees', (req, res) => res.json(state.employees));

app.post('/api/employees', (req, res) => {
  const emp = req.body;
  if (state.employees.some(e => e.id === emp.id)) {
    return res.status(400).json({ error: 'Employee ID already exists' });
  }
  emp.active = true;
  emp.ul = emp.ul || 0;
  state.employees.push(emp);
  saveData();
  broadcast('employee_added', emp);
  res.json({ success: true, employee: emp });
});

app.delete('/api/employees/:id', (req, res) => {
  const id = req.params.id;
  const idx = state.employees.findIndex(e => e.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Employee not found' });
  const emp = state.employees[idx];
  // Move to archived
  state.archivedEmployees.push({
    id: emp.id, name: emp.name, dept: emp.dept, status: 'Deleted',
    joining: emp.joining, exit: new Date().toISOString().split('T')[0]
  });
  state.employees.splice(idx, 1);
  saveData();
  broadcast('employee_deleted', { id });
  res.json({ success: true });
});

app.put('/api/employees/:id', (req, res) => {
  const id = req.params.id;
  const idx = state.employees.findIndex(e => e.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Employee not found' });
  state.employees[idx] = { ...state.employees[idx], ...req.body };
  saveData();
  res.json({ success: true, employee: state.employees[idx] });
});

// ARCHIVE
app.post('/api/employees/:id/archive', (req, res) => {
  const id = req.params.id;
  const idx = state.employees.findIndex(e => e.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Employee not found' });
  const emp = state.employees[idx];
  state.archivedEmployees.push({
    id: emp.id, name: emp.name, dept: emp.dept, status: 'Archived',
    joining: emp.joining, exit: new Date().toISOString().split('T')[0]
  });
  state.employees[idx].active = false;
  saveData();
  broadcast('employee_archived', { id });
  res.json({ success: true });
});

// ATTENDANCE
app.get('/api/attendance', (req, res) => res.json(state.attendanceRecords));

app.post('/api/attendance', (req, res) => {
  const rec = req.body;
  const existing = state.attendanceRecords.findIndex(r => r.id === rec.id && r.date === rec.date);
  if (existing >= 0) {
    state.attendanceRecords[existing] = { ...state.attendanceRecords[existing], ...rec };
  } else {
    state.attendanceRecords.unshift(rec);
  }
  saveData();
  broadcast('attendance_update', rec);
  res.json({ success: true });
});

// LEAVE REQUESTS
app.get('/api/leave-requests', (req, res) => res.json(state.leaveRequests));

app.post('/api/leave-requests', (req, res) => {
  const lr = req.body;
  lr.idx = state.leaveRequests.length;
  state.leaveRequests.push(lr);
  saveData();
  broadcast('leave_request', lr);
  res.json({ success: true, leaveRequest: lr });
});

app.put('/api/leave-requests/:idx', (req, res) => {
  const idx = parseInt(req.params.idx);
  if (idx >= 0 && idx < state.leaveRequests.length) {
    state.leaveRequests[idx] = { ...state.leaveRequests[idx], ...req.body };
    saveData();
    broadcast('leave_update', state.leaveRequests[idx]);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// ANNOUNCEMENTS
app.get('/api/announcements', (req, res) => res.json(state.announcements));

app.post('/api/announcements', (req, res) => {
  const ann = req.body;
  state.announcements.unshift(ann);
  saveData();
  broadcast('announcement', ann);
  res.json({ success: true });
});

// DEPARTMENTS
app.get('/api/departments', (req, res) => res.json(state.departments));

app.post('/api/departments', (req, res) => {
  const { name } = req.body;
  if (state.departments.includes(name)) return res.status(400).json({ error: 'Exists' });
  state.departments.push(name);
  saveData();
  res.json({ success: true, departments: state.departments });
});

app.delete('/api/departments/:name', (req, res) => {
  state.departments = state.departments.filter(d => d !== req.params.name);
  saveData();
  res.json({ success: true, departments: state.departments });
});

// Email sending via SMTP (built-in, no nodemailer)
const net = require('net');
const tls = require('tls');

/**
 * Send email via SMTP using Node.js built-in net/tls modules.
 * Supports STARTTLS (port 587), direct TLS (port 465), and plain (port 25).
 */
function sendEmail({ host, port, user, pass, to, subject, html }) {
  return new Promise((resolve, reject) => {
    const isSecure = port === 465 || port === '465';
    const connectOpts = { host, port: parseInt(port) || 587 };
    
    let sock = isSecure 
      ? tls.connect(connectOpts, onConnect)
      : net.connect(connectOpts, onConnect);
    
    let buffer = '';
    let step = 0;
    let secured = isSecure;
    
    function send(line) {
      sock.write(line + '\r\n');
    }
    
    function bail(err) {
      try { sock.destroy(); } catch(e) {}
      reject(err);
    }
    
    sock.setTimeout(10000, () => bail(new Error('SMTP timeout')));
    
    sock.on('data', (data) => {
      buffer += data.toString();
      // SMTP responses end with CRLF.CRLF for data, or just CRLF for commands
      if (!buffer.includes('\r\n')) return;
      // For multi-line responses, wait for the last line (starts with space)
      const lines = buffer.split('\r\n');
      const lastLine = lines[lines.length - 2] || '';
      if (lastLine.length < 4 || (lastLine[3] === '-' && !buffer.endsWith('\r\n'))) return;
      
      const code = parseInt(lastLine.substring(0, 3));
      const msg = buffer;
      buffer = '';
      
      if (code >= 500) {
        return bail(new Error('SMTP error: ' + msg));
      }
      
      step++;
      try { handleStep(code, msg); } catch (e) { bail(e); }
    });
    
    sock.on('error', (err) => bail(err));
    sock.on('close', () => {});
    
    function onConnect() {
      // Wait for greeting
    }
    
    function handleStep(code, msg) {
      if (step === 1) {
        // Got greeting, send EHLO
        send('EHLO quemahtech.local');
      } else if (step === 2) {
        // Got EHLO response, check for STARTTLS
        if (!secured && msg.toUpperCase().includes('STARTTLS')) {
          send('STARTTLS');
        } else if (!secured && code === 250) {
          // No STARTTLS available, try AUTH
          send('AUTH LOGIN');
          secured = true; // prevent STARTTLS loop
        } else {
          send('AUTH LOGIN');
        }
      } else if (step === 3 && msg.toUpperCase().includes('STARTTLS') && !secured) {
        // Server ready for STARTTLS
        secured = true;
        const tlsOpts = { socket: sock, host };
        sock = tls.connect(tlsOpts, () => {
          // After TLS handshake, send EHLO again
          step = 1;
          sock.write('EHLO quemahtech.local\r\n');
        });
        sock.on('data', (data) => {
          buffer += data.toString();
          const lines = buffer.split('\r\n');
          const lastLine = lines[lines.length - 2] || '';
          if (lastLine.length < 4 || (lastLine[3] === '-' && !buffer.endsWith('\r\n'))) return;
          const c = parseInt(lastLine.substring(0, 3));
          if (c >= 500) return bail(new Error('SMTP TLS error: ' + buffer));
          buffer = '';
          step++;
          if (step === 2) {
            sock.write('AUTH LOGIN\r\n');
          }
        });
        sock.on('error', (err) => bail(err));
      } else if (step === 3) {
        // AUTH LOGIN response (334), send user
        send(Buffer.from(user).toString('base64'));
      } else if (step === 4) {
        // AUTH user response (334), send pass
        send(Buffer.from(pass).toString('base64'));
      } else if (step === 5) {
        // AUTH success (235)
        send('MAIL FROM:<' + user + '>');
      } else if (step === 6) {
        // MAIL FROM accepted
        send('RCPT TO:<' + to + '>');
      } else if (step === 7) {
        // RCPT TO accepted
        send('DATA');
      } else if (step === 8) {
        // DATA accepted (354), send email content
        const boundary = '----=_Part_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        let content = 'From: ' + user + '\r\n';
        content += 'To: ' + to + '\r\n';
        content += 'Subject: ' + subject + '\r\n';
        content += 'MIME-Version: 1.0\r\n';
        content += 'Content-Type: text/html; charset=\"UTF-8\"\r\n';
        content += '\r\n';
        content += html || subject;
        content += '\r\n.\r\n';
        send(content);
      } else if (step === 9) {
        // Email sent (250)
        send('QUIT');
        try { sock.destroy(); } catch(e) {}
        resolve({ success: true, message: 'Email sent to ' + to });
      }
    }
  });
}

// Email sending API endpoint
app.post('/api/send-email', async (req, res) => {
  const { to, subject, html, smtp } = req.body;
  
  if (!to || !subject) {
    return res.status(400).json({ error: 'Missing required fields: to, subject' });
  }
  
  // Try nodemailer first if available, fall back to built-in SMTP
  try {
    let result;
    try {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: parseInt(smtp.port),
        secure: parseInt(smtp.port) === 465,
        auth: { user: smtp.user, pass: smtp.pass },
        tls: { rejectUnauthorized: false }
      });
      const info = await transporter.sendMail({
        from: smtp.user,
        to,
        subject,
        html: html || subject
      });
      result = { success: true, messageId: info.messageId };
    } catch (nodemailerErr) {
      // Fall back to built-in SMTP client
      result = await sendEmail({
        host: smtp.host,
        port: smtp.port,
        user: smtp.user,
        pass: smtp.pass,
        to,
        subject,
        html: html || subject
      });
    }
    res.json(result);
  } catch (err) {
    console.error('Email send error:', err.message);
    res.status(500).json({ error: 'Failed to send email: ' + err.message });
  }
});

// SMTP test endpoint
app.post('/api/test-smtp', async (req, res) => {
  const { host, port, user, pass } = req.body;
  if (!host || !port || !user || !pass) {
    return res.status(400).json({ error: 'Missing SMTP fields' });
  }
  
  try {
    const result = await sendEmail({
      host, port: parseInt(port), user, pass,
      to: user,
      subject: 'QUEMAHTECH — SMTP Test Successful',
      html: '<h2>SMTP Configuration Verified ✓</h2><p>Your SMTP settings are correct and emails can be sent from the QUEMAHTECH Employee Management System.</p><p style="color:#666;font-size:12px;">Sent at: ' + new Date().toLocaleString() + '</p>'
    });
    res.json(result);
  } catch (err) {
    console.error('SMTP test error:', err.message);
    res.status(500).json({ error: 'SMTP test failed: ' + err.message });
  }
});

app.put('/api/password', (req, res) => {
  const { userId, currentPwd, newPwd } = req.body;
  if (userId === 'quemahtech') {
    if (currentPwd !== state.adminPassword) return res.status(400).json({ error: 'Wrong password' });
    state.adminPassword = newPwd;
    saveData();
    return res.json({ success: true });
  }
  const emp = state.employees.find(e => e.id === userId);
  if (!emp) return res.status(404).json({ error: 'Not found' });
  if (currentPwd !== (emp.password || 'emp123')) return res.status(400).json({ error: 'Wrong password' });
  emp.password = newPwd;
  saveData();
  res.json({ success: true });
});

// NOTIFICATIONS
app.get('/api/notifications/:userId', (req, res) => {
  const userId = req.params.userId;
  if (userId === 'quemahtech') return res.json(state.adminNotifications);
  res.json(state.empNotifications.filter(n => n.userId === userId || !n.userId));
});

app.post('/api/notifications', (req, res) => {
  const notif = req.body;
  notif.time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  notif.unread = true;
  if (notif.target === 'admin') {
    state.adminNotifications.unshift(notif);
  } else {
    state.empNotifications.unshift(notif);
  }
  saveData();
  broadcast('notification', notif);
  res.json({ success: true });
});

app.put('/api/notifications/read', (req, res) => {
  const { userId, idx } = req.body;
  const arr = userId === 'quemahtech' ? state.adminNotifications : state.empNotifications;
  if (arr[idx]) arr[idx].unread = false;
  saveData();
  res.json({ success: true });
});

// SAVE ALL (bulk save from client)
app.post('/api/save', (req, res) => {
  const data = req.body;
  if (data.employees) state.employees = data.employees;
  if (data.archivedEmployees) state.archivedEmployees = data.archivedEmployees;
  if (data.attendanceRecords) state.attendanceRecords = data.attendanceRecords;
  if (data.leaveRequests) state.leaveRequests = data.leaveRequests;
  if (data.announcements) state.announcements = data.announcements;
  if (data.adminNotifications) state.adminNotifications = data.adminNotifications;
  if (data.empNotifications) state.empNotifications = data.empNotifications;
  if (data.departments) state.departments = data.departments;
  saveData();
  res.json({ success: true });
});

// HTTP + WebSocket Server
const server = http.createServer(app);

const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`WebSocket connected. Total clients: ${clients.size}`);
  ws.on('close', () => {
    clients.delete(ws);
    console.log(`WebSocket disconnected. Total clients: ${clients.size}`);
  });
  ws.on('error', () => clients.delete(ws));
});

// Start
loadData();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║   QUEMAHTECH Employee Management System  ║`);
  console.log(`╠══════════════════════════════════════════╣`);
  console.log(`║  Server: http://localhost:${PORT}            ║`);
  console.log(`║  Admin:  quemahtech / quemah123         ║`);
  console.log(`║  Emp:    EMP001 / emp123                ║`);
  console.log(`║  Emp:    EMP002 / emp123                ║`);
  console.log(`╚══════════════════════════════════════════╝\n`);
});
