require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
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
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'atharvashishn@gmail.com';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'quemahtech';

// ── Express App ──
const app = express();
const server = http.createServer(app);

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.use(express.json({ limit: '5mb' }));

// ── Firebase Admin Initialization ──
let dbConnected = false;

async function connectDB() {
  // Look for the service account JSON file
  const possiblePaths = [
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
    './quemahtech-e9148-firebase-adminsdk-fbsvc-72d38afb10.json',
    './firebase-service-account.json'
  ];

  let serviceAccount = null;
  for (const p of possiblePaths) {
    if (p) {
      try {
        serviceAccount = require(path.resolve(__dirname, p));
        if (serviceAccount && serviceAccount.client_email) break;
      } catch (e) {
        // try next path
      }
    }
  }

  if (!serviceAccount || !serviceAccount.client_email) {
    console.warn('Firebase service account not found. Check FIREBASE_SERVICE_ACCOUNT_PATH in .env');
    console.warn('Looked in:', possiblePaths.filter(Boolean));
    return;
  }

  try {
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DATABASE_URL || undefined
      });
    }
    initFirestore();
    dbConnected = true;
    console.log('Firebase Firestore connected');

      // Seed default admin
    const adminUser = await Admin.findOne({ username: ADMIN_USERNAME });
    if (!adminUser) {
      await Admin.create({ username: ADMIN_USERNAME, password: 'quemah123', email: ADMIN_EMAIL });
      console.log(`Default admin created: ${ADMIN_USERNAME} / quemah123`);
    }

    // Seed default departments
    const deptCount = await Department.countDocuments();
    if (deptCount === 0) {
      await Department.insertMany(
        ['Engineering', 'HR', 'IT', 'Marketing', 'Finance', 'Operations'].map(name => ({ name }))
      );
      console.log('Default departments created');
    }
  } catch (e) {
    console.error('Firebase initialization error:', e.message);
  }
}

// ── SMTP ──
function createTransporter() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: parseInt(process.env.SMTP_PORT || '587', 10) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    tls: { rejectUnauthorized: false }
  });
}

async function sendEmail({ to, subject, html }) {
  const transporter = createTransporter();
  if (!transporter) throw new Error('SMTP not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS env vars.');
  const info = await transporter.sendMail({
    from: `"Quemahtech EMS" <${process.env.SMTP_USER}>`,
    to, subject, html, text: html ? html.replace(/<[^>]*>/g, '') : subject
  });
  return { success: true, messageId: info.messageId };
}

async function notifyAdminLeaveRequest(lr) {
  if (!ADMIN_EMAIL) return;
  const transporter = createTransporter();
  if (!transporter) return;
  try {
    await transporter.sendMail({
      from: `"Quemahtech EMS" <${process.env.SMTP_USER}>`,
      to: ADMIN_EMAIL,
      subject: `New Leave Request: ${lr.empName} (${lr.type})`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:linear-gradient(135deg,#0f2744,#1a3355);padding:24px;text-align:center;border-radius:12px 12px 0 0;">
          <h1 style="color:#f59e0b;margin:0;">📋 New Leave Request</h1>
          <p style="color:#94a3b8;margin:6px 0 0;">Employee Management System</p>
        </div>
        <div style="padding:28px 24px;background:#fff;border:1px solid #e2e8f0;">
          <p style="color:#1e293b;margin:0 0 16px;">A new leave request has been submitted.</p>
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <tr><td style="color:#64748b;padding:4px 8px;">Employee</td><td style="font-weight:600;padding:4px 8px;">${lr.empName}</td></tr>
            <tr><td style="color:#64748b;padding:4px 8px;">Department</td><td style="font-weight:600;padding:4px 8px;">${lr.dept || '—'}</td></tr>
            <tr><td style="color:#64748b;padding:4px 8px;">Leave Type</td><td style="font-weight:600;padding:4px 8px;">${lr.type}</td></tr>
            <tr><td style="color:#64748b;padding:4px 8px;">Duration</td><td style="font-weight:600;padding:4px 8px;">${lr.days} day(s)</td></tr>
          </table>
          <p style="color:#475569;margin:16px 0 0;">Please log in to the admin panel to review.</p>
        </div>
      </div>`
    });
  } catch (e) {
    console.error('Leave email notification failed:', e.message);
  }
}

// ── Socket.io ──
let io = null;

function setupSocketIO() {
  if (process.env.VERCEL) return;
  io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] }
  });
  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id} (${io.engine.clientsCount} total)`);
    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id} (${io.engine.clientsCount} total)`);
    });
  });
}

function broadcast(event, data) {
  if (io) io.emit(event, data);
}

// ── Sanitizers ──
// Only strip Firestore doc _id and password — keep business id (e.g. 'EMP001')
function sanitizeEmp(e) {
  const obj = e.toObject ? e.toObject() : { ...e };
  const { _id, password, ...rest } = obj;
  return rest;
}

// ── Middleware: require DB ──
function requireDB(req, res, next) {
  if (!dbConnected) {
    return res.status(503).json({ error: 'Database not connected. Check Firebase service account in .env.' });
  }
  next();
}

// ── Auth Router ──
const authRouter = express.Router();
authRouter.use(requireDB);

// POST /api/auth/login
authRouter.post('/login', async (req, res) => {
  try {
    const { uid, pwd, role } = req.body;
    if (role === 'admin') {
      const admin = await Admin.findOne({ username: uid });
      if (admin && admin.password === pwd) {
        return res.json({ success: true, role: 'admin', user: { id: admin.username, name: 'Administrator' } });
      }
      return res.json({ success: false });
    }
    if (role === 'employee') {
      let emp = await Employee.findOne({ id: uid, active: true });
      if (!emp) {
        const all = await Employee.find({ active: true });
        emp = all.find(e => e.id && e.id.toLowerCase() === uid.toLowerCase());
      }
      if (emp && emp.password === pwd) {
        return res.json({
          success: true, role: 'employee',
          user: { id: emp.id, name: emp.name, dept: emp.dept, designation: emp.designation, cl: emp.cl, sl: emp.sl, ul: emp.ul }
        });
      }
      return res.json({ success: false });
    }
    res.json({ success: false });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── ADMIN-ONLY Forgot Password — PRIVACY-SAFE ──
// This endpoint is strictly for the system administrator only.
// It generates a temp password, emails it via SMTP, and NEVER returns it in the response.
authRouter.post('/forgot-password', async (req, res) => {
  try {
    const { uid } = req.body;

    // Strict admin-only check
    if (!uid || uid !== ADMIN_USERNAME) {
      return res.status(400).json({ error: 'Invalid admin username. Only the system administrator can reset their password.' });
    }

    // Validate SMTP is configured before doing anything
    if (!ADMIN_EMAIL || !process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
      return res.status(400).json({ error: 'SMTP not configured. Cannot send reset email.' });
    }

    const adminUser = await Admin.findOne({ username: ADMIN_USERNAME });
    if (!adminUser) return res.status(404).json({ error: 'Admin not found' });

    // Generate a random temporary password (16 alphanumeric chars, high entropy)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*';
    const tempPassword = Array.from({ length: 16 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join('');

    // ═══ SEND EMAIL FIRST — only modify DB on success ═══
    try {
      await sendEmail({
        to: ADMIN_EMAIL,
        subject: `${process.env.APP_NAME || 'Quemahtech EMS'} — Admin Password Reset`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
          <div style="background:linear-gradient(135deg,#0f2744,#1a3355);padding:24px;text-align:center;border-radius:12px 12px 0 0;">
            <h1 style="color:#f59e0b;margin:0;">🔑 Admin Password Reset</h1>
          </div>
          <div style="padding:28px 24px;background:#fff;border:1px solid #e2e8f0;">
            <p style="color:#1e293b;">A password reset was requested for the Quemahtech EMS admin panel.</p>
            <p style="color:#1e293b;">Use the temporary password below to log in:</p>
            <div style="font-size:24px;font-weight:700;color:#0f2744;text-align:center;padding:20px;background:#f0f4f8;border-radius:8px;letter-spacing:4px;font-family:monospace;margin:16px 0;">${tempPassword}</div>
            <p style="color:#64748b;font-size:13px;">This temporary password expires in <strong>10 minutes</strong>.</p>
            <p style="color:#64748b;font-size:13px;">After logging in, navigate to <strong>Settings</strong> to change your password immediately.</p>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;">
            <p style="color:#94a3b8;font-size:12px;">${process.env.APP_NAME || 'Quemahtech'} Employee Management System</p>
          </div>
        </div>`
      });
    } catch (emailErr) {
      return res.status(500).json({ error: 'Failed to send email: ' + emailErr.message + '. Password was NOT changed.' });
    }

    // ═══ Email sent successfully — now update the database ═══
    adminUser.password = tempPassword;
    await adminUser.save();

    // Store reset record with expiry (10 minutes)
    await PasswordReset.create({
      userId: ADMIN_USERNAME,
      tempPassword,
      email: ADMIN_EMAIL,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    });

    // 🔒 PRIVACY: Only success message — NO password, token, or code displayed on screen
    res.json({ success: true, message: 'Check your email inbox for the temporary password.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Admin-Only: Reset password after login with temp password ──
authRouter.post('/reset-password', async (req, res) => {
  try {
    const { userId, currentPwd, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }
    const targetUser = userId === ADMIN_USERNAME
      ? await Admin.findOne({ username: ADMIN_USERNAME })
      : await Employee.findOne({ id: userId });
    if (!targetUser) return res.status(404).json({ error: 'User not found' });
    if (currentPwd && targetUser.password !== currentPwd) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }
    targetUser.password = newPassword;
    await targetUser.save();
    broadcast('password_changed', { userId: userId || ADMIN_USERNAME });
    res.json({ success: true, message: 'Password reset successful' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/auth/password — Change password (admin or employee)
authRouter.put('/password', async (req, res) => {
  try {
    const { userId, currentPwd, newPwd } = req.body;
    if (userId === ADMIN_USERNAME) {
      const admin = await Admin.findOne({ username: ADMIN_USERNAME });
      if (!admin) return res.status(404).json({ error: 'Admin not found' });
      if (admin.password !== currentPwd) return res.status(400).json({ error: 'Wrong password' });
      admin.password = newPwd;
      await admin.save();
      broadcast('password_changed', { userId: ADMIN_USERNAME });
      return res.json({ success: true });
    }
    const emp = await Employee.findOne({ id: userId });
    if (!emp) return res.status(404).json({ error: 'Not found' });
    if (emp.password !== currentPwd) return res.status(400).json({ error: 'Wrong password' });
    emp.password = newPwd;
    await emp.save();
    broadcast('password_changed', { userId });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── API Router ──
const apiRouter = express.Router();

// GET /api/health
apiRouter.get('/health', (req, res) => {
  res.json({ status: 'ok', db: dbConnected ? 'connected' : 'disconnected' });
});

apiRouter.use(requireDB);

// GET /api/state
apiRouter.get('/state', async (req, res) => {
  try {
    const [employees, archivedEmployeesDocs, attendanceRecords, leaveRequests, announcements, departments] =
      await Promise.all([
        Employee.find({}),
        ArchivedEmployee.find({}),
        Attendance.find({}),
        LeaveRequest.find({ $sort: { idx: -1 } }),
        Announcement.find({}),
        Department.find({})
      ]);
    const archived = archivedEmployeesDocs.map(a => ({
      id: a.id || a.originalId, name: a.name, dept: a.dept,
      status: a.status, joining: a.joining, exit: a.exit
    }));
    const allNotifs = await Notification.find({});
    return res.json({
      employees: employees.map(sanitizeEmp),
      archivedEmployees: archived,
      attendanceRecords: attendanceRecords,
      leaveRequests: leaveRequests,
      announcements: announcements,
      adminNotifications: (allNotifs || []).filter(n => n.target === 'admin'),
      empNotifications: (allNotifs || []).filter(n => n.target === 'emp' || n.userId),
      departments: departments.map(d => d.name)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET/POST /api/employees
apiRouter.route('/employees')
  .get(async (req, res) => {
    try {
      const emps = await Employee.find({});
      res.json(emps.map(sanitizeEmp));
    } catch (e) { res.status(500).json({ error: e.message }); }
  })
  .post(async (req, res) => {
    try {
      const body = req.body;
      const existing = await Employee.findOne({ id: body.id });
      if (existing) return res.status(400).json({ error: 'Employee ID already exists' });
      const emp = await Employee.create({
        id: body.id, name: body.name, dept: body.dept,
        email: body.email || '', phone: body.phone || '',
        bday: body.bday || '', joining: body.joining || '',
        designation: body.designation || '',
        password: body.password || 'emp123',
        cl: body.cl || 7.5, sl: body.sl || 3.0, ul: 0,
        active: true
      });
      broadcast('employee_added', sanitizeEmp(emp));
      if (emp.bday) {
        calendarService.createBirthdayEvent(emp).then(result => {
          if (result.success) Employee.updateOne({ id: emp.id }, { calendarEventId: result.eventId });
        }).catch(() => {});
      }
      res.json({ success: true, employee: sanitizeEmp(emp) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

// GET/PUT/DELETE /api/employees/:id
apiRouter.route('/employees/:id')
  .get(async (req, res) => {
    try {
      const emp = await Employee.findOne({ id: req.params.id });
      if (!emp) return res.status(404).json({ error: 'Not found' });
      res.json(sanitizeEmp(emp));
    } catch (e) { res.status(500).json({ error: e.message }); }
  })
  .put(async (req, res) => {
    try {
      const emp = await Employee.findOne({ id: req.params.id });
      if (!emp) return res.status(404).json({ error: 'Not found' });
      const oldBday = emp.bday;
      Object.assign(emp, req.body);
      await emp.save();
      if (emp.bday && emp.bday !== oldBday) {
        calendarService.createBirthdayEvent(emp).then(result => {
          if (result.success) Employee.updateOne({ id: emp.id }, { calendarEventId: result.eventId });
        }).catch(() => {});
      }
      res.json({ success: true, employee: sanitizeEmp(emp) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  })
  .delete(async (req, res) => {
    try {
      const emp = await Employee.findOneAndDelete({ id: req.params.id });
      if (!emp) return res.status(404).json({ error: 'Not found' });
      if (emp.calendarEventId) {
        calendarService.deleteBirthdayEvent(emp.calendarEventId).catch(() => {});
      }
      await ArchivedEmployee.create({
        originalId: emp.id, id: emp.id, name: emp.name,
        dept: emp.dept, status: 'Deleted',
        joining: emp.joining, exit: new Date().toISOString().split('T')[0],
        employeeData: emp.toObject()
      });
      broadcast('employee_deleted', { id: req.params.id });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

// POST /api/employees/:id/archive
apiRouter.post('/employees/:id/archive', async (req, res) => {
  try {
    const emp = await Employee.findOne({ id: req.params.id });
    if (!emp) return res.status(404).json({ error: 'Not found' });
    await ArchivedEmployee.create({
      originalId: emp.id, id: emp.id, name: emp.name,
      dept: emp.dept, status: 'Archived',
      joining: emp.joining, exit: new Date().toISOString().split('T')[0],
      employeeData: emp.toObject()
    });
    emp.active = false;
    await emp.save();
    broadcast('employee_archived', { id: req.params.id });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET/POST /api/attendance
apiRouter.route('/attendance')
  .get(async (req, res) => {
    try {
      const recs = await Attendance.find({});
      res.json(recs);
    } catch (e) { res.status(500).json({ error: e.message }); }
  })
  .post(async (req, res) => {
    try {
      const body = req.body;
      const existing = await Attendance.findOne({ id: body.id, date: body.date });
      if (existing) {
        Object.assign(existing, body);
        await existing.save();
      } else {
        await Attendance.create(body);
      }
      broadcast('attendance_update', body);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

// GET/POST /api/leave-requests
apiRouter.route('/leave-requests')
  .get(async (req, res) => {
    try {
      const reqs = await LeaveRequest.find({ $sort: { idx: -1 } });
      res.json(reqs);
    } catch (e) { res.status(500).json({ error: e.message }); }
  })
  .post(async (req, res) => {
    try {
      const count = await LeaveRequest.countDocuments();
      const lr = await LeaveRequest.create({ ...req.body, idx: count });
      broadcast('leave_request', lr.toObject());
      notifyAdminLeaveRequest(lr.toObject());
      res.json({ success: true, leaveRequest: lr.toObject() });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

// PUT /api/leave-requests/:idx
apiRouter.put('/leave-requests/:idx', async (req, res) => {
  try {
    const idx = parseInt(req.params.idx);
    const lr = await LeaveRequest.findOne({ idx });
    if (!lr) return res.status(404).json({ error: 'Not found' });
    Object.assign(lr, req.body);
    await lr.save();
    broadcast('leave_update', lr.toObject());
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET/POST /api/announcements
apiRouter.route('/announcements')
  .get(async (req, res) => {
    try {
      const anns = await Announcement.find({});
      res.json(anns);
    } catch (e) { res.status(500).json({ error: e.message }); }
  })
  .post(async (req, res) => {
    try {
      const ann = await Announcement.create(req.body);
      broadcast('announcement', ann.toObject());
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

// GET/POST /api/departments
apiRouter.route('/departments')
  .get(async (req, res) => {
    try {
      const depts = await Department.find({});
      res.json(depts.map(d => d.name));
    } catch (e) { res.status(500).json({ error: e.message }); }
  })
  .post(async (req, res) => {
    try {
      const exists = await Department.findOne({ name: req.body.name });
      if (exists) return res.status(400).json({ error: 'Exists' });
      await Department.create({ name: req.body.name });
      const depts = await Department.find({});
      res.json({ success: true, departments: depts.map(d => d.name) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

// DELETE /api/departments/:name
apiRouter.delete('/departments/:name', async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    await Department.deleteOne({ name });
    const depts = await Department.find({});
    res.json({ success: true, departments: depts.map(d => d.name) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET/POST /api/notifications
apiRouter.route('/notifications')
  .post(async (req, res) => {
    try {
      const notif = await Notification.create({
        text: req.body.text,
        time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        unread: true,
        target: req.body.target || 'admin',
        userId: req.body.userId || ''
      });
      broadcast('notification', notif.toObject());
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

// GET /api/notifications/:userId — returns notifications array AND actual .length from DB for badge sync
apiRouter.get('/notifications/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    let notifs;
    if (userId === ADMIN_USERNAME) {
      notifs = await Notification.find({ target: 'admin', $sort: { createdAt: -1 } });
    } else {
      const all = await Notification.find({ $sort: { createdAt: -1 } });
      notifs = all.filter(r => r.target === 'emp' || r.userId === userId);
    }
    // Return both the array and the actual count for badge sync
    res.json({ notifications: notifs, count: notifs.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/save (bulk sync from frontend)
apiRouter.post('/save', async (req, res) => {
  try {
    const body = req.body;
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
        const exists = await Announcement.findOne({ subject: a.subject, date: a.date });
        if (exists) {
          Object.assign(exists, a);
          await exists.save();
        } else {
          await Announcement.create(a);
        }
      }
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/send-email
apiRouter.post('/send-email', async (req, res) => {
  try {
    const { to, subject, html } = req.body;
    if (!to || !subject) return res.status(400).json({ error: 'Missing required fields' });
    const result = await sendEmail({ to, subject, html: html || subject });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Email failed: ' + err.message });
  }
});

// POST /api/test-smtp
apiRouter.post('/test-smtp', async (req, res) => {
  try {
    const transporter = createTransporter();
    if (!transporter) return res.status(400).json({ error: 'SMTP not configured.' });
    await transporter.verify();
    res.json({ success: true, message: 'SMTP connection verified' });
  } catch (err) {
    res.status(500).json({ error: 'SMTP test failed: ' + err.message });
  }
});

// GET /api/email-config
apiRouter.get('/email-config', (req, res) => {
  res.json({
    configured: !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
    host: process.env.SMTP_HOST || '', port: parseInt(process.env.SMTP_PORT || '587', 10),
    email: process.env.SMTP_USER || '', adminEmail: ADMIN_EMAIL || ''
  });
});

// GET/POST /api/calendar-config
apiRouter.route('/calendar-config')
  .get((req, res) => {
    const cc = calendarService.getCalendarConfig();
    res.json({ enabled: cc.enabled || false, serviceAccountPath: cc.serviceAccountPath || '', calendarId: cc.calendarId || 'primary' });
  })
  .post((req, res) => {
    const saved = calendarService.saveCalendarConfig({
      serviceAccountPath: req.body.serviceAccountPath || '',
      calendarId: req.body.calendarId || 'primary',
      enabled: !!req.body.enabled
    });
    if (saved) return res.json({ success: true, message: 'Calendar config saved' });
    res.status(500).json({ error: 'Failed to save calendar config' });
  });

// POST /api/calendar/birthday
apiRouter.post('/calendar/birthday', async (req, res) => {
  try {
    const emp = await Employee.findOne({ id: req.body.employeeId });
    if (!emp) return res.status(404).json({ error: 'Employee not found' });
    if (!emp.bday) return res.status(400).json({ error: 'Employee has no birthday set' });
    if (emp.calendarEventId) {
      await calendarService.deleteBirthdayEvent(emp.calendarEventId).catch(() => {});
    }
    const result = await calendarService.createBirthdayEvent(emp.toObject());
    if (result.success) {
      emp.calendarEventId = result.eventId;
      await emp.save();
    }
    res.status(result.success ? 200 : 500).json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/calendar/sync-birthdays
apiRouter.post('/calendar/sync-birthdays', async (req, res) => {
  try {
    const cc = calendarService.getCalendarConfig();
    if (!cc.enabled) return res.status(400).json({ error: 'Calendar not configured.' });
    const allActive = await Employee.find({ active: true });
    const allEmps = allActive.filter(e => e.bday && e.bday !== '');
    const results = [];
    for (const emp of allEmps) {
      if (emp.calendarEventId) {
        await calendarService.deleteBirthdayEvent(emp.calendarEventId).catch(() => {});
      }
      const result = await calendarService.createBirthdayEvent(emp);
      if (result.success) {
        await Employee.updateOne({ id: emp.id }, { calendarEventId: result.eventId });
        results.push({ id: emp.id, name: emp.name, success: true });
      } else {
        results.push({ id: emp.id, name: emp.name, success: false, error: result.error });
      }
    }
    res.json({ success: true, results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Mount Routers ──
app.use('/api/auth', authRouter);
app.use('/api', apiRouter);

// ── Static File Serving ──
const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webp': 'image/webp'
};

app.use(express.static(path.join(__dirname, 'dist')));
app.use(express.static(__dirname));

// Fallback: serve index.html for SPA routes (but NOT for API calls)
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  const filePath = req.path === '/' ? 'index.html' : req.path.slice(1);
  const distPath = path.join(__dirname, 'dist', filePath);
  const rootPath = path.join(__dirname, filePath);
  const fullPath = fs.existsSync(distPath) ? distPath : rootPath;
  if (fs.existsSync(fullPath)) {
    const ext = path.extname(fullPath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';
    return res.sendFile(fullPath);
  }
  res.status(404).send('Not found');
});

// ── Socket.io ──
setupSocketIO();

// ── Start ──
let serverReady = false;

const wrappedHandler = (req, res) => {
  if (!serverReady) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Server still initializing, please retry.' }));
    return;
  }
  server.emit('request', req, res);
};

module.exports = wrappedHandler;

async function start() {
  await connectDB();
  serverReady = true;

  if (!process.env.VERCEL) {
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`\n  ${process.env.APP_NAME || 'Quemahtech'} Employee Management System`);
      console.log(`  http://localhost:${PORT}`);
      console.log(`  DB: ${dbConnected ? 'Firestore connected' : 'DB offline'}`);
      console.log(`  Socket.io: ${io ? 'enabled' : 'disabled (Vercel)'}`);
      console.log(`  Admin: ${ADMIN_USERNAME} / quemah123`);
      console.log(`  Emp:   EMP001 / emp123\n`);
    });
  }
}

start();
