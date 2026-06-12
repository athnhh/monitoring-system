require('dotenv').config();
const http = require('http');
const path = require('path');
const fs = require('fs');
const url = require('url');
const nodemailer = require('nodemailer');
const admin = require('firebase-admin');
const { Server } = require('socket.io');

const calendarService = require('./google-calendar');

const {
  Admin, Employee, Attendance, LeaveRequest,
  Announcement, Notification, PasswordReset,
  Department, ArchivedEmployee, initFirestore
} = require('./models');

const PORT = process.env.PORT || 3000;
const SERVICE_ACCOUNT_PATH = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || 'firebase-service-account.json';

// ═══════════════════════════════════════════════════════════════
// HARDCODED MASTER ADMIN EMAIL — Do NOT change this value.
// This is the absolute admin email for password resets & notifications.
// ═══════════════════════════════════════════════════════════════
const ADMIN_EMAIL = 'atharvashishn@gmail.com';

// ── Firebase / Firestore Connection ──
let dbConnected = false;

async function connectDB() {
  try {
    // Initialize Firebase Admin SDK (safe to call multiple times)
    const serviceAccount = require(path.resolve(__dirname, SERVICE_ACCOUNT_PATH));
    if (admin.apps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    }
    initFirestore();
    dbConnected = true;
    console.log('Firestore connected: project ' + serviceAccount.project_id);

    // Seed default admin if not exists
    const adminCount = await Admin.countDocuments({ username: 'quemahtech' });
    if (adminCount === 0) {
      await Admin.create({ username: 'quemahtech', password: 'quemah123', email: ADMIN_EMAIL || '' });
      console.log('Default admin seeded: quemahtech / quemah123');
    }

    // Seed default departments
    const deptCount = await Department.countDocuments();
    if (deptCount === 0) {
      const defaultDepts = ['Engineering', 'HR', 'IT', 'Marketing', 'Finance', 'Operations'];
      await Department.insertMany(defaultDepts.map(name => ({ name })));
      console.log('Default departments seeded');
    }
  } catch (e) {
    console.error('Firestore connection error:', e.message);
    console.log('Server will start but database features will be unavailable.');
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
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(obj));
}

// ── Email Config (SMTP from env vars) ──
function getEmailConfig() {
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      email: process.env.SMTP_USER,
      password: process.env.SMTP_PASS
    };
  }
  return null;
}

function createTransporter(cfg) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: { user: cfg.email, pass: cfg.password },
    tls: { rejectUnauthorized: false }
  });
}

async function sendEmail({ to, subject, html }) {
  const cfg = getEmailConfig();
  if (!cfg) throw new Error('SMTP not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS env vars.');
  const transporter = createTransporter(cfg);
  const info = await transporter.sendMail({
    from: `"Quemahtech EMS" <${cfg.email}>`,
    to,
    subject,
    html,
    text: html ? html.replace(/<[^>]*>/g, '') : subject
  });
  return { success: true, messageId: info.messageId };
}

async function testSmtpConnection() {
  const cfg = getEmailConfig();
  if (!cfg) throw new Error('SMTP not configured.');
  const transporter = createTransporter(cfg);
  await transporter.verify();
  return { success: true, message: 'SMTP connection verified' };
}

// ── Notify admin of new leave request via email ──
async function notifyAdminLeaveRequest(lr) {
  if (!ADMIN_EMAIL) return;
  const cfg = getEmailConfig();
  if (!cfg) return;
  const subject = `New Leave Request: ${lr.empName} (${lr.type})`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
  <div style="background:linear-gradient(135deg,#0f2744,#1a3355);padding:24px;text-align:center;border-radius:12px 12px 0 0;">
    <h1 style="color:#f59e0b;margin:0;font-size:20px;">📋 New Leave Request</h1>
    <p style="color:#94a3b8;margin:6px 0 0;font-size:13px;">Employee Management System</p>
  </div>
  <div style="padding:28px 24px;background:#fff;border:1px solid #e2e8f0;border-radius:0 0 12px 12px;">
    <p style="color:#1e293b;font-size:15px;line-height:1.7;margin:0 0 16px;">A new leave request has been submitted.</p>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:16px;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr><td style="color:#64748b;padding:4px 8px;">Employee</td><td style="color:#1e293b;font-weight:600;padding:4px 8px;">${lr.empName}</td></tr>
        <tr><td style="color:#64748b;padding:4px 8px;">Department</td><td style="color:#1e293b;font-weight:600;padding:4px 8px;">${lr.dept || '—'}</td></tr>
        <tr><td style="color:#64748b;padding:4px 8px;">Leave Type</td><td style="color:#1e293b;font-weight:600;padding:4px 8px;">${lr.type}</td></tr>
        <tr><td style="color:#64748b;padding:4px 8px;">Duration</td><td style="color:#1e293b;font-weight:600;padding:4px 8px;">${lr.days} day(s)</td></tr>
      </table>
    </div>
    <p style="color:#475569;font-size:14px;line-height:1.7;margin:0;">Please log in to the admin panel to review.</p>
  </div>
</div>`;
  try {
    await sendEmail({ to: ADMIN_EMAIL, subject, html });
  } catch (e) {
    console.error('Leave email notification failed:', e.message);
  }
}

// ── Parse Body ──
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

// ── Static File Serving ──
function serveStatic(req, res) {
  let filePath = req.url === '/' ? 'index.html' : req.url.slice(1);
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

// ── Socket.io setup ──
let io = null;

function setupSocketIO(server) {
  if (process.env.VERCEL) return; // No Socket.io on Vercel

  io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE']
    }
  });

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id} (${io.engine.clientsCount} total)`);

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id} (${io.engine.clientsCount} total)`);
    });
  });
}

function broadcast(event, data) {
  if (io) {
    io.emit(event, data);
  }
}

// ── API Handler ──
// NOTE: Using if/else chains instead of switch because switch with default in the
// middle makes routes after default unreachable.
async function handleAPI(req, res) {
  const parsed = url.parse(req.url, true);
  const method = req.method;
  const parts = parsed.pathname.split('/').filter(Boolean);

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  if (parts[0] !== 'api') return sendJSON(res, 404, { error: 'Not found' });
  if (!dbConnected && parsed.pathname !== '/api/health') {
    return sendJSON(res, 503, { error: 'Database not connected. Check FIREBASE_SERVICE_ACCOUNT_PATH.' });
  }

  const body = method === 'POST' || method === 'PUT' ? await parseBody(req) : {};

  // ── Route matching ──
  const leaveMatch = parsed.pathname.match(/^\/api\/leave-requests\/(\d+)$/);
  const deptMatch = parsed.pathname.match(/^\/api\/departments\/(.+)$/);
  const notifGetMatch = parsed.pathname.match(/^\/api\/notifications\/(.+)$/);
  const empMatch = parsed.pathname.match(/^\/api\/employees\/(.+)$/);
  const archiveMatch = parsed.pathname.match(/^\/api\/employees\/(.+)\/archive$/);

  try {

    // ── HEALTH ──
    if (parsed.pathname === '/api/health') {
      return sendJSON(res, 200, { status: 'ok', db: dbConnected ? 'connected' : 'disconnected' });
    }

    // ── LOGIN ──
    if (parsed.pathname === '/api/login' && method === 'POST') {
      const { uid, pwd, role } = body;
      if (role === 'admin') {
        const admin = await Admin.findOne({ username: uid });
        if (admin && admin.password === pwd) {
          return sendJSON(res, 200, {
            success: true, role: 'admin',
            user: { id: admin.username, name: 'Administrator' }
          });
        }
        return sendJSON(res, 200, { success: false });
      }
      if (role === 'employee') {
        // Try exact match first, then case-insensitive lookup via Firestore
        let emp = await Employee.findOne({ id: uid, active: true });
        if (!emp) {
          // Fallback: case-insensitive lookup by fetching active employees
          const allEmps = await Employee.find({ active: true });
          emp = allEmps.find(e => e.id && e.id.toLowerCase() === uid.toLowerCase());
        }
        if (emp && emp.password === pwd) {
          return sendJSON(res, 200, {
            success: true, role: 'employee',
            user: {
              id: emp.id, name: emp.name, dept: emp.dept,
              designation: emp.designation, cl: emp.cl, sl: emp.sl, ul: emp.ul
            }
          });
        }
        return sendJSON(res, 200, { success: false });
      }
      return sendJSON(res, 200, { success: false });
    }

    // ── STATE (full data for frontend) ──
    if (parsed.pathname === '/api/state') {
      const [employees, archivedEmployees, attendanceRecords, leaveRequests, announcements, departments] =
        await Promise.all([
          Employee.find({}).lean(),
          ArchivedEmployee.find({}).lean(),
          Attendance.find({}).lean(),
          LeaveRequest.find({ $sort: { idx: -1 } }),
          Announcement.find({}),
          Department.find({}).lean()
        ]);

      const archived = archivedEmployees.map(a => ({
        id: a.id || a.originalId,
        name: a.name,
        dept: a.dept,
        status: a.status,
        joining: a.joining,
        exit: a.exit
      }));

      return sendJSON(res, 200, {
        employees: employees.map(sanitizeEmp),
        archivedEmployees: archived,
        attendanceRecords: attendanceRecords.map(sanitizeAttendance),
        leaveRequests: leaveRequests.map(sanitizeLeave),
        announcements: announcements.map(sanitizeAnnouncement),
        adminNotifications: [],
        empNotifications: [],
        departments: departments.map(d => d.name)
      });
    }

    // ── EMPLOYEES LIST / CREATE ──
    if (parsed.pathname === '/api/employees') {
      if (method === 'GET') {
        const emps = await Employee.find({}).lean();
        return sendJSON(res, 200, emps.map(sanitizeEmp));
      }
      if (method === 'POST') {
        const existing = await Employee.findOne({ id: body.id });
        if (existing) return sendJSON(res, 400, { error: 'Employee ID already exists' });
        const emp = await Employee.create({
          id: body.id, name: body.name, dept: body.dept,
          email: body.email || '', phone: body.phone || '',
          bday: body.bday || '', joining: body.joining || '',
          designation: body.designation || '',
          password: body.password || 'emp123',
          cl: body.cl || 7.5, sl: body.sl || 3.0, ul: body.ul || 0,
          active: true
        });
        broadcast('employee_added', sanitizeEmp(emp.toObject()));

        if (emp.bday) {
          calendarService.createBirthdayEvent(emp.toObject()).then(result => {
            if (result.success) {
              Employee.updateOne({ id: emp.id }, { calendarEventId: result.eventId });
            }
          }).catch(() => {});
        }

        return sendJSON(res, 200, { success: true, employee: sanitizeEmp(emp.toObject()) });
      }
      return sendJSON(res, 404, { error: 'Method not allowed' });
    }

    // ── EMPLOYEE ARCHIVE ──
    if (archiveMatch && method === 'POST') {
      const id = archiveMatch[1];
      const emp = await Employee.findOne({ id });
      if (!emp) return sendJSON(res, 404, { error: 'Not found' });
      await ArchivedEmployee.create({
        originalId: emp.id, id: emp.id, name: emp.name,
        dept: emp.dept, status: 'Archived',
        joining: emp.joining,
        exit: new Date().toISOString().split('T')[0],
        employeeData: emp.toObject()
      });
      emp.active = false;
      await emp.save();
      broadcast('employee_archived', { id });
      return sendJSON(res, 200, { success: true });
    }

    // ── EMPLOYEE CRUD by ID ──
    if (empMatch) {
      const id = empMatch[1];
      if (method === 'GET') {
        const emp = await Employee.findOne({ id }).lean();
        if (!emp) return sendJSON(res, 404, { error: 'Not found' });
        return sendJSON(res, 200, sanitizeEmp(emp));
      }
      if (method === 'DELETE') {
        const emp = await Employee.findOneAndDelete({ id });
        if (!emp) return sendJSON(res, 404, { error: 'Not found' });
        if (emp.calendarEventId) {
          calendarService.deleteBirthdayEvent(emp.calendarEventId).catch(() => {});
        }
        await ArchivedEmployee.create({
          originalId: emp.id, id: emp.id, name: emp.name,
          dept: emp.dept, status: 'Deleted',
          joining: emp.joining,
          exit: new Date().toISOString().split('T')[0],
          employeeData: emp.toObject()
        });
        broadcast('employee_deleted', { id });
        return sendJSON(res, 200, { success: true });
      }
      if (method === 'PUT') {
        const emp = await Employee.findOne({ id });
        if (!emp) return sendJSON(res, 404, { error: 'Not found' });
        const oldBday = emp.bday;
        Object.assign(emp, body);
        await emp.save();

        if (emp.bday && emp.bday !== oldBday) {
          calendarService.createBirthdayEvent(emp.toObject()).then(result => {
            if (result.success) {
              Employee.updateOne({ id: emp.id }, { calendarEventId: result.eventId });
            }
          }).catch(() => {});
        }
        return sendJSON(res, 200, { success: true, employee: sanitizeEmp(emp.toObject()) });
      }
      return sendJSON(res, 404, { error: 'Method not allowed' });
    }

    // ── ATTENDANCE ──
    if (parsed.pathname === '/api/attendance') {
      if (method === 'GET') {
        const recs = await Attendance.find({}).lean();
        return sendJSON(res, 200, recs.map(sanitizeAttendance));
      }
      if (method === 'POST') {
        const existing = await Attendance.findOne({ id: body.id, date: body.date });
        if (existing) {
          Object.assign(existing, body);
          await existing.save();
        } else {
          await Attendance.create(body);
        }
        broadcast('attendance_update', body);
        return sendJSON(res, 200, { success: true });
      }
      return sendJSON(res, 404, { error: 'Method not allowed' });
    }

    // ── LEAVE REQUESTS ──
    if (parsed.pathname === '/api/leave-requests') {
      if (method === 'GET') {
      const reqs = await LeaveRequest.find({ $sort: { idx: -1 } });
        return sendJSON(res, 200, reqs.map(sanitizeLeave));
      }
      if (method === 'POST') {
        const count = await LeaveRequest.countDocuments();
        const lr = await LeaveRequest.create({ ...body, idx: count });
        broadcast('leave_request', sanitizeLeave(lr.toObject()));
        notifyAdminLeaveRequest(lr.toObject());
        return sendJSON(res, 200, { success: true, leaveRequest: sanitizeLeave(lr.toObject()) });
      }
      return sendJSON(res, 404, { error: 'Method not allowed' });
    }

    // ── LEAVE REQUEST BY ID ──
    if (leaveMatch && method === 'PUT') {
      const idx = parseInt(leaveMatch[1]);
      const lr = await LeaveRequest.findOne({ idx });
      if (!lr) return sendJSON(res, 404, { error: 'Not found' });
      Object.assign(lr, body);
      await lr.save();
      broadcast('leave_update', sanitizeLeave(lr.toObject()));
      return sendJSON(res, 200, { success: true });
    }

    // ── ANNOUNCEMENTS ──
    if (parsed.pathname === '/api/announcements') {
      if (method === 'GET') {
        const anns = await Announcement.find({});
        return sendJSON(res, 200, anns.map(sanitizeAnnouncement));
      }
      if (method === 'POST') {
        const ann = await Announcement.create(body);
        broadcast('announcement', sanitizeAnnouncement(ann.toObject()));
        return sendJSON(res, 200, { success: true });
      }
      return sendJSON(res, 404, { error: 'Method not allowed' });
    }

    // ── DEPARTMENTS ──
    if (parsed.pathname === '/api/departments') {
      if (method === 'GET') {
        const depts = await Department.find({}).lean();
        return sendJSON(res, 200, depts.map(d => d.name));
      }
      if (method === 'POST') {
        const exists = await Department.findOne({ name: body.name });
        if (exists) return sendJSON(res, 400, { error: 'Exists' });
        await Department.create({ name: body.name });
        const depts = await Department.find({}).lean();
        return sendJSON(res, 200, { success: true, departments: depts.map(d => d.name) });
      }
      if (method === 'POST' && body.name) {
        await Department.deleteOne({ name: body.name });
        const depts = await Department.find({}).lean();
        return sendJSON(res, 200, { success: true, departments: depts.map(d => d.name) });
      }
      // DELETE for collections with ?name= query
      return sendJSON(res, 404, { error: 'Method not allowed' });
    }

    // ── DELETE DEPARTMENT BY NAME (from path) ──
    if (deptMatch && method === 'DELETE') {
      const name = decodeURIComponent(deptMatch[1]);
      await Department.deleteOne({ name });
      const depts = await Department.find({}).lean();
      return sendJSON(res, 200, { success: true, departments: depts.map(d => d.name) });
    }

    // ── PASSWORD CHANGE ──
    if (parsed.pathname === '/api/password' && method === 'PUT') {
      const { userId, currentPwd, newPwd } = body;
      if (userId === 'quemahtech') {
        const admin = await Admin.findOne({ username: 'quemahtech' });
        if (admin.password !== currentPwd) return sendJSON(res, 400, { error: 'Wrong password' });
        admin.password = newPwd;
        await admin.save();
        broadcast('password_changed', { userId: 'quemahtech' });
        return sendJSON(res, 200, { success: true });
      }
      const emp = await Employee.findOne({ id: userId });
      if (!emp) return sendJSON(res, 404, { error: 'Not found' });
      if (emp.password !== currentPwd) return sendJSON(res, 400, { error: 'Wrong password' });
      emp.password = newPwd;
      await emp.save();
      broadcast('password_changed', { userId });
      return sendJSON(res, 200, { success: true });
    }

    // ── NOTIFICATIONS CREATE ──
    if (parsed.pathname === '/api/notifications' && method === 'POST') {
      const notif = await Notification.create({
        text: body.text,
        time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        unread: true,
        target: body.target || 'admin',
        userId: body.userId || ''
      });
      broadcast('notification', notif.toObject ? notif.toObject() : notif);
      return sendJSON(res, 200, { success: true });
    }

    // ── GET NOTIFICATIONS BY USER ──
    if (notifGetMatch && method === 'GET') {
      const userId = notifGetMatch[1];
      let notifs;
      if (userId === 'quemahtech') {
        const allNotifs = await Notification.find({ target: 'admin' });
        notifs = (allNotifs || []).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      } else {
        const allNotifs = await Notification.find({});
        notifs = (allNotifs || []).filter(r => r.target === 'emp' || r.userId === userId).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      }
      return sendJSON(res, 200, notifs);
    }

    // ── SAVE (bulk sync from frontend) ──
    if (parsed.pathname === '/api/save' && method === 'POST') {
      if (body.employees) {
        for (const e of body.employees) {
          await Employee.updateOne({ id: e.id }, { $set: e }, { upsert: true });
        }
      }
      if (body.departments && body.departments.length) {
        await Department.deleteMany({});
        await Department.insertMany(body.departments.map(name => ({ name })));
      }
      if (body.announcements && body.announcements.length) {
        for (const a of body.announcements) {
          await Announcement.updateOne(
            { subject: a.subject, date: a.date },
            { $set: a }
          );
        }
      }
      return sendJSON(res, 200, { success: true });
    }

    // ── FORGOT PASSWORD (Admin only) ──
    if (parsed.pathname === '/api/forgot-password' && method === 'POST') {
      const { uid: forgotUid } = body;

      if (forgotUid !== 'quemahtech') {
        return sendJSON(res, 400, { error: 'Invalid admin username. Only the system administrator can reset their password.' });
      }

      const admin = await Admin.findOne({ username: 'quemahtech' });
      if (!admin) return sendJSON(res, 404, { error: 'Admin not found' });

      const otp = String(Math.floor(100000 + Math.random() * 900000));

      await PasswordReset.create({
        userId: 'quemahtech',
        otp,
        email: ADMIN_EMAIL,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000)
      });

      if (ADMIN_EMAIL && getEmailConfig()) {
        sendEmail({
          to: ADMIN_EMAIL,
          subject: 'Quemahtech — Admin Password Reset OTP',
          html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
            <h2 style="color:#0f2744;">🔑 Password Reset OTP</h2>
            <p>Your admin password reset OTP is:</p>
            <div style="font-size:32px;font-weight:700;color:#f59e0b;text-align:center;padding:20px;background:#fef3c7;border-radius:8px;letter-spacing:8px;font-family:monospace;">${otp}</div>
            <p style="color:#64748b;font-size:13px;">This code expires in <strong>5 minutes</strong>.</p>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;">
            <p style="color:#94a3b8;font-size:12px;">Quemahtech Employee Management System</p>
          </div>`
        }).then(() => {
          console.log('OTP email sent to', ADMIN_EMAIL);
        }).catch(err => {
          console.error('OTP email failed:', err.message);
        });
      }

      const maskedEmail = ADMIN_EMAIL ? ADMIN_EMAIL.replace(/(.{2})(.*)(@.*)/, '$1***$3') : '';

      return sendJSON(res, 200, {
        success: true,
        message: 'OTP sent to admin email',
        email: maskedEmail,
        otpExpiryMs: 300000
      });
    }

    // ── VERIFY OTP ──
    if (parsed.pathname === '/api/verify-otp' && method === 'POST') {
      const { otp: verifyOtp, userId: otpUserId } = body;

      const resetRecord = await PasswordReset.findOne({
        userId: otpUserId || 'quemahtech',
        otp: verifyOtp,
        expiresAt: { $gt: new Date() }
      });

      if (!resetRecord) {
        const expired = await PasswordReset.findOne({
          userId: otpUserId || 'quemahtech',
          otp: verifyOtp
        });

        if (expired) {
          return sendJSON(res, 400, { error: 'OTP expired. Please request a new one.' });
        }
        return sendJSON(res, 400, { error: 'Invalid OTP. Please try again.' });
      }

      await PasswordReset.deleteOne({ _id: resetRecord._id || resetRecord.id });
      return sendJSON(res, 200, { success: true, message: 'OTP verified' });
    }

    // ── RESET PASSWORD ──
    if (parsed.pathname === '/api/reset-password' && method === 'POST') {
      const { newPassword } = body;

      if (!newPassword || newPassword.length < 6) {
        return sendJSON(res, 400, { error: 'Password must be at least 6 characters.' });
      }

      const adminUser = await Admin.findOne({ username: 'quemahtech' });
      if (!adminUser) return sendJSON(res, 404, { error: 'Admin not found' });

      adminUser.password = newPassword;
      await adminUser.save();

      broadcast('password_changed', { userId: 'quemahtech' });
      return sendJSON(res, 200, { success: true, message: 'Password reset successful' });
    }

    // ── SEND EMAIL via SMTP ──
    if (parsed.pathname === '/api/send-email' && method === 'POST') {
      const { to, subject, html: emailHtml } = body;
      if (!to || !subject) return sendJSON(res, 400, { error: 'Missing required fields' });
      try {
        const result = await sendEmail({ to, subject, html: emailHtml || subject });
        return sendJSON(res, 200, result);
      } catch (err) {
        return sendJSON(res, 500, { error: 'Email failed: ' + err.message });
      }
    }

    // ── TEST SMTP ──
    if (parsed.pathname === '/api/test-smtp' && method === 'POST') {
      try {
        const result = await testSmtpConnection();
        return sendJSON(res, 200, result);
      } catch (err) {
        return sendJSON(res, 500, { error: 'SMTP test failed: ' + err.message });
      }
    }

    // ── GET SMTP/EMAIL CONFIG ──
    if (parsed.pathname === '/api/email-config' && method === 'GET') {
      const cfg = getEmailConfig();
      return sendJSON(res, 200, {
        configured: !!(cfg && cfg.email && cfg.password),
        host: cfg ? cfg.host : '',
        port: cfg ? cfg.port : 587,
        email: cfg ? cfg.email : '',
        adminEmail: ADMIN_EMAIL || ''
      });
    }

    // ── GOOGLE CALENDAR ──
    if (parsed.pathname === '/api/calendar-config') {
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
      return sendJSON(res, 404, { error: 'Method not allowed' });
    }

    // ── CALENDAR BIRTHDAY ──
    if (parsed.pathname === '/api/calendar/birthday' && method === 'POST') {
      const { employeeId } = body;
      const empBday = await Employee.findOne({ id: employeeId });
      if (!empBday) return sendJSON(res, 404, { error: 'Employee not found' });
      if (!empBday.bday) return sendJSON(res, 400, { error: 'Employee has no birthday set' });
      if (empBday.calendarEventId) {
        await calendarService.deleteBirthdayEvent(empBday.calendarEventId).catch(() => {});
      }
      const bdayResult = await calendarService.createBirthdayEvent(empBday.toObject());
      if (bdayResult.success) {
        empBday.calendarEventId = bdayResult.eventId;
        await empBday.save();
      }
      return sendJSON(res, bdayResult.success ? 200 : 500, bdayResult);
    }

    // ── SYNC ALL BIRTHDAYS ──
    if (parsed.pathname === '/api/calendar/sync-birthdays' && method === 'POST') {
      const cc = calendarService.getCalendarConfig();
      if (!cc.enabled) return sendJSON(res, 400, { error: 'Calendar not configured.' });
      const allActiveEmps = await Employee.find({ active: true });
      const allEmps = allActiveEmps.filter(e => e.bday && e.bday !== '').map(e => ({ ...e, lean: () => e }));
      const results = [];
      for (const emp of allEmps) {
        if (emp.calendarEventId) {
          await calendarService.deleteBirthdayEvent(emp.calendarEventId).catch(() => {});
        }
        const resSync = await calendarService.createBirthdayEvent(emp);
        if (resSync.success) {
          await Employee.updateOne({ id: emp.id }, { calendarEventId: resSync.eventId });
          results.push({ id: emp.id, name: emp.name, success: true });
        } else {
          results.push({ id: emp.id, name: emp.name, success: false, error: resSync.error });
        }
      }
      return sendJSON(res, 200, { success: true, results });
    }

    // ── 404 fallback ──
    return sendJSON(res, 404, { error: 'Route not found' });

  } catch (err) {
    console.error('API error:', err);
    return sendJSON(res, 500, { error: err.message });
  }
}

// ── Sanitizers ──
function sanitizeEmp(e) {
  return { ...e, _id: undefined, createdAt: undefined, updatedAt: undefined };
}
function sanitizeAttendance(r) {
  return { ...r, _id: undefined, createdAt: undefined, updatedAt: undefined };
}
function sanitizeLeave(l) {
  return { ...l, _id: undefined, createdAt: undefined, updatedAt: undefined };
}
function sanitizeAnnouncement(a) {
  return { ...a, _id: undefined, createdAt: undefined, updatedAt: undefined };
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

  if (req.url === '/socket.io/' || req.url?.startsWith('/socket.io')) {
    res.writeHead(404);
    return res.end('Socket.io path handled internally');
  }

  if (serveStatic(req, res)) return;

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

// ── Setup Socket.io ──
setupSocketIO(server);

// ── Export for Vercel ──
let serverReady = false;

const wrappedHandler = async (req, res) => {
  if (!serverReady) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Server still initializing, please retry.' }));
    return;
  }
  return server(req, res);
};

module.exports = wrappedHandler;

// ── Start ──
async function start() {
  await connectDB();
  serverReady = true;

  if (!process.env.VERCEL) {
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`\n  Quemahtech Employee Management System`);
      console.log(`  http://localhost:${PORT}`);
      console.log(`  DB: ${dbConnected ? 'Firestore connected' : 'DB offline'}`);
      console.log(`  Socket.io: ${io ? 'enabled' : 'disabled (Vercel)'}`);
      console.log(`  Admin: quemahtech / quemah123`);
      console.log(`  Emp:   EMP001 / emp123\n`);
    });
  }
}

start();
