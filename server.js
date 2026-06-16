require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { Server } = require('socket.io');

const admin = require('firebase-admin');
const calendarService = require('./google-calendar');

const {
  Admin, Employee, Attendance, LeaveRequest,
  Announcement, Notification, PasswordReset,
  Department, ArchivedEmployee, SystemConfig
} = require('./models');

const PORT = process.env.PORT || 3000;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'atharvashishn@gmail.com';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'quemahtech';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'quemah123';

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json({ limit: '10mb' }));

let dbConnected = false;

async function connectDB() {
  try {
    await admin.firestore().collection('systemConfig').doc('_connection_test').set({
      connected: true, timestamp: new Date().toISOString()
    });
    dbConnected = true;
    console.log('Firebase Firestore connected successfully');

    let adminUser = await Admin.findOne({ username: ADMIN_USERNAME });
    if (!adminUser) {
      adminUser = await Admin.findOne({ email: ADMIN_EMAIL });
    }
    if (!adminUser) {
      const allAdmins = await Admin.find({});
      adminUser = allAdmins.find(a => a.username === ADMIN_USERNAME || a.email === ADMIN_EMAIL);
    }
    if (adminUser) {
      if (adminUser.password !== ADMIN_PASSWORD) {
        adminUser.password = ADMIN_PASSWORD;
        await adminUser.save();
        console.log('Admin password reset to default: ' + ADMIN_USERNAME + ' / ' + ADMIN_PASSWORD);
      }
    } else {
      await Admin.create({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD, email: ADMIN_EMAIL });
      console.log('Default admin auto-seeded: ' + ADMIN_USERNAME + ' / ' + ADMIN_PASSWORD);
    }

    const verifyAdmin = await Admin.findOne({ username: ADMIN_USERNAME });
    if (!verifyAdmin || verifyAdmin.password !== ADMIN_PASSWORD) {
      console.warn('Admin seed verification failed — forcing direct write');
      const db2 = admin.firestore();
      await db2.collection('admins').doc(ADMIN_USERNAME).set({
        username: ADMIN_USERNAME, password: ADMIN_PASSWORD, email: ADMIN_EMAIL
      }, { merge: true });
    }

    const defaultEmps = [
      { id: 'EMP001', name: 'Rahul Sharma', dept: 'Engineering', designation: 'Senior Developer', email: 'rahul@quemahtech.com', password: 'emp123', cl: 7.5, sl: 3.0 },
      { id: 'EMP002', name: 'Priya Patel', dept: 'HR', designation: 'HR Manager', email: 'priya@quemahtech.com', password: 'emp123', cl: 6.0, sl: 1.0 },
    ];
    for (const data of defaultEmps) {
      const existing = await Employee.findOne({ id: data.id });
      if (!existing) {
        await Employee.create({ ...data, phone: '', bday: '', joining: '', ul: 0, active: true });
      }
    }

    const deptCount = await Department.countDocuments();
    if (deptCount === 0) {
      for (const name of ['Engineering', 'HR', 'IT', 'Marketing', 'Finance', 'Operations']) {
        await Department.create({ name });
      }
      console.log('Default departments created');
    }
  } catch (e) {
    console.error('Firestore connection/seeding error:', e.message);
    dbConnected = false;
  }
}

let io = null;

function setupSocketIO() {
  if (process.env.VERCEL) return;
  io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] }
  });
  io.on('connection', (socket) => {
    console.log('Socket connected:', socket.id, '(' + io.engine.clientsCount + ' total)');
    socket.on('disconnect', () => {
      console.log('Socket disconnected:', socket.id, '(' + io.engine.clientsCount + ' total)');
    });
    socket.on('request_password_reset', () => {
      console.log('Password reset requested via socket from', socket.id);
    });
  });
}

function broadcast(event, data) {
  if (io) {
    io.emit(event, data);
    console.log('Broadcast:', event);
  }
}

function sanitizeEmp(e) {
  const obj = e.toObject ? e.toObject() : { ...e };
  const { _ref, _collection, _id, password, ...rest } = obj;
  return rest;
}

function getISTNow() {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  return new Date(now.getTime() + istOffset);
}
function getISTHour() { return getISTNow().getUTCHours(); }
function getISTMinutes() { return getISTNow().getUTCMinutes(); }

const ACCRUAL_FLAG_KEY = '_leaveAccrualLastRun';

async function runMonthlyLeaveAccrual() {
  try {
    if (!dbConnected) return;
    const config = await SystemConfig.findOne({ key: 'leaveAccrual' });
    const lastRun = config && config.value ? config.value.lastRun : '';
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const firstOfMonth = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-01';
    if (todayStr !== firstOfMonth) return;
    if (lastRun === firstOfMonth) return;
    const emps = await Employee.find({ active: true });
    let count = 0;
    for (const emp of emps) {
      emp.cl = (parseFloat(emp.cl) || 0) + 1.0;
      emp.sl = (parseFloat(emp.sl) || 0) + 0.5;
      emp.cl = Math.min(emp.cl, 30);
      emp.sl = Math.min(emp.sl, 15);
      if (emp.save) await emp.save();
      count++;
    }
    await SystemConfig.updateOne({ key: 'leaveAccrual' }, { value: { lastRun: firstOfMonth } }, { upsert: true });
    console.log('[Accrual] ' + count + ' employees credited (' + firstOfMonth + ')');
  } catch (e) {
    console.error('[Accrual] Error:', e.message);
  }
}

function requireDB(req, res, next) {
  if (!dbConnected) {
    return res.status(503).json({ error: 'Database not connected. Check Firebase service account configuration.' });
  }
  next();
}

async function runMonthlyAccrualForAll() {
  try {
    if (!dbConnected) return;
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const allEmps = await Employee.find({ active: true });
    for (const emp of allEmps) {
      if (emp._lastAccrualMonth !== currentMonth || emp._lastAccrualYear !== currentYear) {
        emp.cl = (emp.cl || 0) + 1.0;
        emp.sl = (emp.sl || 0) + 0.5;
        emp._lastAccrualMonth = currentMonth;
        emp._lastAccrualYear = currentYear;
        await emp.save();
      }
    }
    console.log('Monthly leave accrual applied to ' + allEmps.length + ' employees for ' + (currentMonth + 1) + '/' + currentYear);
  } catch (e) {
    console.error('Monthly accrual cron error:', e.message);
  }
}

async function forceLogoutExpiredEmployees() {
  try {
    if (!dbConnected) return;
    const hr = getISTHour();
    if (hr < 18) return;
    const today = new Date().toISOString().split('T')[0];
    const activeSession = await SystemConfig.findOne({ key: 'activeSessions' });
    if (!activeSession || !activeSession.value) return;
    const sessions = activeSession.value.sessions || [];
    let changed = false;
    for (const session of sessions) {
      if (!session.loggedOut) {
        session.loggedOut = true;
        session.forceLoggedOutAt = new Date().toISOString();
        changed = true;
        const attRec = await Attendance.findOne({ id: session.employeeId, date: today });
        if (attRec && attRec.in && !attRec.out) {
          const outHr = getISTHour();
          const outMin = getISTMinutes();
          attRec.out = String(outHr).padStart(2, '0') + ':' + String(outMin).padStart(2, '0');
          const [inH, inM] = attRec.in.split(':').map(Number);
          const diffHrs = (outHr - inH) + (outMin - inM) / 60;
          attRec.hours = Math.max(0, parseFloat(diffHrs.toFixed(2)));
          if (attRec.hours > 0 && attRec.hours < 4) attRec.status = 'Half-Day';
          await attRec.save();
          broadcast('attendance_update', attRec.toObject());
        }
      }
    }
    if (changed) {
      await SystemConfig.updateOne({ key: 'activeSessions' }, { value: { sessions } }, { upsert: true });
      broadcast('force_logout', { message: 'All employee sessions logged out at 18:00 IST' });
      console.log('Force logout completed for all active employee sessions');
    }
  } catch (e) {
    console.error('Force logout error:', e.message);
  }
}

const authRouter = express.Router();
authRouter.use(requireDB);

authRouter.post('/login', async (req, res) => {
  try {
    const { uid, pwd } = req.body;
    const normalized = (uid || '').toLowerCase().trim();

    if (normalized === ADMIN_USERNAME || normalized === ADMIN_EMAIL.toLowerCase()) {
      let adminUser = await Admin.findOne({ username: ADMIN_USERNAME });
      if (!adminUser) {
        adminUser = await Admin.findOne({ email: ADMIN_EMAIL });
      }
      if (adminUser) {
        if (adminUser.password === pwd) {
          return res.json({ success: true, role: 'admin', user: { id: ADMIN_USERNAME, name: 'Administrator' } });
        }
        return res.json({ success: false, message: 'Incorrect admin password.' });
      }
      return res.json({ success: false, message: 'Admin account not found in database. Server may not have seeded correctly.' });
    }

    const hr = getISTHour();
    const min = getISTMinutes();
    if (hr >= 18) {
      return res.json({ success: false, error: 'TIME_BLOCK', message: 'Employee logins are blocked after 6:00 PM IST (current time: ' + String(hr).padStart(2,'0') + ':' + String(min).padStart(2,'0') + ' IST). Office hours: 9:00 AM - 6:00 PM.' });
    }

    let emp = await Employee.findOne({ id: normalized, active: true });
    if (!emp) {
      emp = await Employee.findOne({ email: normalized, active: true });
    }
    if (!emp) {
      const all = await Employee.find({ active: true });
      emp = all.find(e => e.id && e.id.toLowerCase() === normalized);
    }
    if (!emp) {
      const all = await Employee.find({ active: true });
      emp = all.find(e => e.email && e.email.toLowerCase() === normalized);
    }

    if (emp && emp.password === pwd) {
      const halfDay = hr >= 14;

      const sessionsConfig = await SystemConfig.findOne({ key: 'activeSessions' });
      let sessions = (sessionsConfig && sessionsConfig.value && sessionsConfig.value.sessions) ? sessionsConfig.value.sessions : [];
      sessions = sessions.filter(s => s.employeeId !== emp.id);
      sessions.push({
        employeeId: emp.id,
        employeeName: emp.name,
        loggedInAt: new Date().toISOString(),
        loggedOut: false
      });
      await SystemConfig.updateOne({ key: 'activeSessions' }, { value: { sessions } }, { upsert: true });

      broadcast('employee_logged_in', { id: emp.id, name: emp.name });

      return res.json({
        success: true, role: 'employee',
        user: { id: emp.id, name: emp.name, dept: emp.dept, designation: emp.designation, cl: emp.cl, sl: emp.sl, ul: emp.ul },
        timeBlock: { isHalfDay: halfDay }
      });
    }
    return res.json({ success: false });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

authRouter.post('/logout', async (req, res) => {
  try {
    const { uid } = req.body;
    const normalized = (uid || '').toLowerCase().trim();
    if (normalized && normalized !== ADMIN_USERNAME) {
      const sessionsConfig = await SystemConfig.findOne({ key: 'activeSessions' });
      if (sessionsConfig && sessionsConfig.value) {
        let sessions = sessionsConfig.value.sessions || [];
        const session = sessions.find(s => s.employeeId === normalized);
        if (session) {
          session.loggedOut = true;
          session.loggedOutAt = new Date().toISOString();
        }
        await SystemConfig.updateOne({ key: 'activeSessions' }, { value: { sessions } }, { upsert: true });
      }
      const today = new Date().toISOString().split('T')[0];
      const attRec = await Attendance.findOne({ id: normalized, date: today });
      if (attRec && attRec.in && !attRec.out) {
        const hr = getISTHour();
        const min = getISTMinutes();
        attRec.out = String(hr).padStart(2, '0') + ':' + String(min).padStart(2, '0');
        const [inH, inM] = attRec.in.split(':').map(Number);
        const diffHrs = (hr - inH) + (min - inM) / 60;
        attRec.hours = Math.max(0, parseFloat(diffHrs.toFixed(2)));
        await attRec.save();
        broadcast('attendance_update', attRec.toObject());
      }
    }
    broadcast('employee_logged_out', { id: normalized });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

authRouter.post('/forgot-password', async (req, res) => {
  try {
    const { uid } = req.body;
    const normalized = (uid || '').toLowerCase().trim();
    const isAuthorized = normalized === ADMIN_USERNAME || normalized === ADMIN_EMAIL.toLowerCase();
    if (!isAuthorized) {
      return res.status(400).json({ error: 'Unauthorized. Only the system administrator can reset their password.' });
    }
    const adminUser = await Admin.findOne({ username: ADMIN_USERNAME });
    if (!adminUser) return res.status(404).json({ error: 'Admin not found' });
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const tempPassword = Array.from({ length: 12 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join('');
    adminUser.password = tempPassword;
    await adminUser.save();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await PasswordReset.create({
      userId: ADMIN_USERNAME,
      tempPassword,
      email: ADMIN_EMAIL,
      expiresAt
    });
    broadcast('password_reset', {
      tempPassword,
      expiresAt,
      message: 'Your temporary password has been generated and is displayed below.'
    });
    res.json({ success: true, message: 'Temporary password delivered to the admin panel via real-time connection.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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

authRouter.put('/password', async (req, res) => {
  try {
    const { userId, currentPwd, newPwd } = req.body;
    if (userId === ADMIN_USERNAME) {
      const adm = await Admin.findOne({ username: ADMIN_USERNAME });
      if (!adm) return res.status(404).json({ error: 'Admin not found' });
      if (adm.password !== currentPwd) return res.status(400).json({ error: 'Wrong password' });
      adm.password = newPwd;
      await adm.save();
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

authRouter.post('/reset-admin', async (req, res) => {
  try {
    const adminUser = await Admin.findOne({ username: ADMIN_USERNAME });
    if (adminUser) {
      adminUser.password = ADMIN_PASSWORD;
      await adminUser.save();
      broadcast('password_changed', { userId: ADMIN_USERNAME });
      return res.json({ success: true, message: 'Admin password reset to: ' + ADMIN_PASSWORD });
    }
    res.status(404).json({ error: 'Admin not found' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const apiRouter = express.Router();

apiRouter.get('/health', (req, res) => {
  res.json({ status: 'ok', db: dbConnected ? 'connected' : 'disconnected' });
});

apiRouter.use(requireDB);

apiRouter.get('/state', async (req, res) => {
  try {
    const [employees, archivedEmployeesDocs, attendanceRecords, leaveRequests, announcements, departments] =
      await Promise.all([
        Employee.find({}),
        ArchivedEmployee.find({}),
        Attendance.find({}),
        LeaveRequest.find({}),
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
      const addNotif = await Notification.create({
        text: 'New employee added: ' + emp.name + ' (' + emp.id + ')',
        time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        unread: true,
        target: 'admin',
        userId: ''
      });
      broadcast('notification', addNotif.toObject());
      res.json({ success: true, employee: sanitizeEmp(emp) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

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
      broadcast('employee_updated', sanitizeEmp(emp));
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
      const hr = getISTHour();
      const min = getISTMinutes();
      if (body.in && !body.out) {
        if (hr >= 18) {
          return res.status(403).json({ success: false, error: 'Sign-in blocked after 6:00 PM IST.' });
        }
      }
      const existing = await Attendance.findOne({ id: body.id, date: body.date });
      if (existing) {
        Object.assign(existing, body);
        if (existing.in && !existing.out && hr >= 14) {
          existing.status = 'Half-Day';
        }
        await existing.save();
      } else {
        let status = body.status || 'Present';
        if (body.in && !body.out) {
          if (hr >= 14) status = 'Half-Day';
          else if (hr > 9 || (hr === 9 && min > 15)) status = 'Late';
        }
        body.status = status;
        await Attendance.create(body);
      }
      broadcast('attendance_update', body);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

apiRouter.route('/leave-requests')
  .get(async (req, res) => {
    try {
      const reqs = await LeaveRequest.find({});
      res.json(reqs);
    } catch (e) { res.status(500).json({ error: e.message }); }
  })
  .post(async (req, res) => {
    try {
      const lr = await LeaveRequest.create({ ...req.body });
      broadcast('leave_request', lr.toObject());
      res.json({ success: true, leaveRequest: lr.toObject() });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

apiRouter.put('/leave-requests/:id', async (req, res) => {
  try {
    const docId = req.params.id;
    const lr = await LeaveRequest.findOne({ id: docId });
    if (!lr) return res.status(404).json({ error: 'Not found' });
    const oldStatus = lr.status;
    const newStatus = req.body.status;
    Object.assign(lr, req.body);
    await lr.save();
    if (newStatus === 'Approved' && oldStatus !== 'Approved' && lr.empId && lr.days) {
      const emp = await Employee.findOne({ id: lr.empId });
      if (emp) {
        if (lr.type === 'CL') {
          if (emp.cl >= lr.days) {
            emp.cl -= lr.days;
          } else {
            const deficit = lr.days - emp.cl;
            emp.cl = 0;
            emp.ul = (emp.ul || 0) + deficit;
          }
        } else if (lr.type === 'SL') {
          const slNeeded = lr.days * 0.5;
          const ulNeeded = lr.days * 0.5;
          if (emp.sl >= slNeeded) {
            emp.sl -= slNeeded;
            emp.ul = (emp.ul || 0) + ulNeeded;
          } else {
            emp.ul = (emp.ul || 0) + lr.days;
            emp.sl = Math.max(0, emp.sl - slNeeded);
          }
        } else if (lr.type === 'UL') {
          emp.ul = (emp.ul || 0) + lr.days;
        }
        await emp.save();
        broadcast('leave_balance_updated', { id: emp.id, cl: emp.cl, sl: emp.sl, ul: emp.ul });
      }
    }
    broadcast('leave_update', lr.toObject());
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

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
      const annNotif = await Notification.create({
        text: 'New announcement: ' + (req.body.subject || ''),
        time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        unread: true,
        target: 'emp',
        userId: ''
      });
      broadcast('notification', annNotif.toObject());
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

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
      broadcast('departments_updated', { departments: depts.map(d => d.name) });
      res.json({ success: true, departments: depts.map(d => d.name) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

apiRouter.delete('/departments/:name', async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    await Department.deleteOne({ name });
    const depts = await Department.find({});
    broadcast('departments_updated', { departments: depts.map(d => d.name) });
    res.json({ success: true, departments: depts.map(d => d.name) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

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

apiRouter.get('/notifications/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    let notifs;
    if (userId === ADMIN_USERNAME) {
      notifs = await Notification.find({ target: 'admin' });
    } else {
      const all = await Notification.find({});
      notifs = all.filter(r => r.target === 'emp' || r.userId === userId);
    }
    const unreadNotifs = notifs.filter(n => n.unread !== false);
    res.json({ notifications: notifs, count: unreadNotifs.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

apiRouter.post('/notifications/mark-read', async (req, res) => {
  try {
    const { userId } = req.body;
    let notifs;
    if (!userId || userId === ADMIN_USERNAME) {
      notifs = await Notification.find({ target: 'admin' });
    } else {
      const all = await Notification.find({});
      notifs = all.filter(r => r.target === 'emp' || r.userId === userId);
    }
    for (const n of notifs) {
      if (n.unread !== false) {
        n.unread = false;
        if (n.save) await n.save();
      }
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

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

app.use('/api/auth', authRouter);
app.use('/api', apiRouter);

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webp': 'image/webp'
};

app.use(express.static(path.join(__dirname, 'dist')));
app.use(express.static(__dirname));

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

setupSocketIO();

apiRouter.post('/leave-accrual', async (req, res) => {
  try {
    if (!dbConnected) return res.status(503).json({ error: 'DB not connected' });
    const emps = await Employee.find({ active: true });
    let count = 0;
    for (const emp of emps) {
      emp.cl = (parseFloat(emp.cl) || 0) + 1.0;
      emp.sl = (parseFloat(emp.sl) || 0) + 0.5;
      emp.cl = Math.min(emp.cl, 30);
      emp.sl = Math.min(emp.sl, 15);
      if (emp.save) await emp.save();
      count++;
    }
    const today = new Date().toISOString().split('T')[0];
    await SystemConfig.updateOne({ key: 'leaveAccrual' }, { value: { lastRun: today } }, { upsert: true });
    res.json({ success: true, count, message: count + ' employees credited (CL +1.0, SL +0.5)' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

setInterval(() => {
  forceLogoutExpiredEmployees();
}, 60000);

if (process.env.VERCEL) {
  connectDB().then(() => {
    runMonthlyLeaveAccrual();
  }).catch(console.error);
} else {
  (async () => {
    await connectDB();
    runMonthlyLeaveAccrual();
    server.listen(PORT, '0.0.0.0', () => {
      console.log('\n  ' + (process.env.APP_NAME || 'Quemahtech') + ' Employee Management System');
      console.log('  http://localhost:' + PORT);
      console.log('  DB: ' + (dbConnected ? 'Firestore connected' : 'DB offline'));
      console.log('  Socket.io: ' + (io ? 'enabled' : 'disabled (Vercel)'));
      console.log('  Admin: ' + ADMIN_USERNAME + ' / ' + ADMIN_PASSWORD);
      console.log('  Emp:   EMP001 / emp123\n');
    });
  })();
}

module.exports = app;
