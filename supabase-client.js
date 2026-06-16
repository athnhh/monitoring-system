/* ═══════════════════════════════════════
   SUPABASE CLIENT — Direct Supabase access
   Drop-in replacement for FirebaseClient + server API
═══════════════════════════════════════ */
(function () {
  'use strict';

  let db = null; // reference to SupabaseDB
  let ready = false;

  function init() {
    if (typeof SupabaseDB === 'undefined' || !SupabaseDB.isConfigured()) {
      console.warn('[SBClient] Supabase not configured');
      return false;
    }
    const inited = SupabaseDB.init();
    if (inited) {
      db = SupabaseDB;
      ready = true;
      console.log('[SBClient] Initialized');
      return true;
    }
    return false;
  }

  // ── Router: maps API-style calls to Supabase operations ──

  async function call(method, path, body) {
    if (!ready) return null;
    try {
      const handler = _route(method, path, body);
      if (!handler) return null;
      return await handler();
    } catch (e) {
      console.error('[SBClient] Error:', path, e.message);
      return null;
    }
  }

  function _route(method, path, body) {
    // ── Auth ──
    if (path === '/api/auth/login' && method === 'POST')
      return () => _login(body.uid, body.pwd);
    if (path === '/api/auth/logout' && method === 'POST')
      return () => ({ success: true });
    if (path === '/api/auth/password' && method === 'PUT')
      return () => _changePassword(body.userId, body.currentPwd, body.newPwd || body.newPassword);
    if (path === '/api/auth/forgot-password' && method === 'POST')
      return () => _forgotPassword(body.uid);

    // ── Health / State ──
    if (path === '/api/health' && method === 'GET')
      return () => ({ status: 'ok', db: 'connected' });
    if (path === '/api/state' && method === 'GET')
      return () => _getState();

    // ── Employees ──
    if (path === '/api/employees' && method === 'GET')
      return () => db.getAll('employees');
    if (path === '/api/employees' && method === 'POST')
      return () => _createEmployee(body, body.password);
    const empMatch = path.match(/^\/api\/employees\/([^/]+)$/);
    if (empMatch) {
      const id = decodeURIComponent(empMatch[1]);
      if (method === 'GET') return () => db.getById('employees', 'id', id);
      if (method === 'PUT') return () => _updateEmployee(id, body);
      if (method === 'DELETE') return () => _deleteEmployee(id);
    }
    const archiveMatch = path.match(/^\/api\/employees\/([^/]+)\/archive$/);
    if (archiveMatch && method === 'POST')
      return () => _archiveEmployee(decodeURIComponent(archiveMatch[1]));
    const unarchiveMatch = path.match(/^\/api\/employees\/([^/]+)\/unarchive$/);
    if (unarchiveMatch && method === 'POST')
      return () => _unarchiveEmployee(decodeURIComponent(unarchiveMatch[1]));

    // ── Attendance ──
    if (path === '/api/attendance' && method === 'GET')
      return () => db.getAll('attendance');
    if (path === '/api/attendance' && method === 'POST')
      return () => _saveAttendance(body);

    // ── Leave requests ──
    if (path === '/api/leave-requests' && method === 'GET')
      return () => db.getAll('leave_requests');
    if (path === '/api/leave-requests' && method === 'POST')
      return () => _createLeaveRequest(body);
    const lrMatch = path.match(/^\/api\/leave-requests\/([^/]+)$/);
    if (lrMatch && method === 'PUT')
      return () => _updateLeaveRequest(decodeURIComponent(lrMatch[1]), body);

    // ── Announcements ──
    if (path === '/api/announcements' && method === 'GET')
      return () => db.getAll('announcements', 'date');
    if (path === '/api/announcements' && method === 'POST')
      return () => db.insert('announcements', body);

    // ── Departments ──
    if (path === '/api/departments' && method === 'GET')
      return () => _getDepartments();
    if (path === '/api/departments' && method === 'POST')
      return () => _addDepartment(body.name);
    const deptMatch = path.match(/^\/api\/departments\/(.+)$/);
    if (deptMatch && method === 'DELETE')
      return () => _removeDepartment(decodeURIComponent(deptMatch[1]));

    // ── Notifications ──
    if (path === '/api/notifications' && method === 'POST')
      return () => _addNotification(body);
    const notifMatch = path.match(/^\/api\/notifications\/([^/]+)$/);
    if (notifMatch && method === 'GET')
      return () => _getNotifications(decodeURIComponent(notifMatch[1]));
    if (path === '/api/notifications/mark-read' && method === 'POST')
      return () => _markNotificationsRead(body.userId);

    // ── Calendar (no-op on static) ──
    if (path.startsWith('/api/calendar') || path.startsWith('/api/calendar-config'))
      return () => ({ success: true, enabled: false });

    // ── Save ──
    if (path === '/api/save' && method === 'POST')
      return () => _saveAll(body);

    // ── Leave accrual ──
    if (path === '/api/leave-accrual' && method === 'POST')
      return () => _runLeaveAccrual();

    return null;
  }

  // ── Auth ──

  async function _login(uid, pwd) {
    const normalized = (uid || '').toLowerCase().trim();
    const ADMIN_USERNAME = 'quemahtech';
    const ADMIN_EMAIL = 'atharvashishn@gmail.com';

    // Admin check
    if (normalized === ADMIN_USERNAME || normalized === ADMIN_EMAIL.toLowerCase()) {
      const { data: admins, error } = await db.supabase
        .from('admin').select('*').eq('username', ADMIN_USERNAME).limit(1);
      if (!error && admins && admins.length > 0 && admins[0].password === pwd) {
        return { success: true, role: 'admin', user: { id: ADMIN_USERNAME, name: 'Administrator' } };
      }
      return { success: false, message: 'Incorrect admin password.' };
    }

    // Employee check
    let { data: emps, error } = await db.supabase
      .from('employees').select('*').eq('id', normalized).eq('active', true).limit(1);
    if (!emps || emps.length === 0) {
      const { data: emps2 } = await db.supabase
        .from('employees').select('*').eq('email', normalized).eq('active', true).limit(1);
      emps = emps2;
    }
    if (emps && emps.length > 0) {
      if (emps[0].password === pwd) {
        const hr = new Date().getHours();
        return {
          success: true, role: 'employee',
          user: { id: emps[0].id, name: emps[0].name, dept: emps[0].dept,
                  designation: emps[0].designation, cl: emps[0].cl, sl: emps[0].sl, ul: emps[0].ul || 0 },
          timeBlock: { isHalfDay: hr >= 14 }
        };
      }
    }
    return { success: false, message: 'Invalid credentials.' };
  }

  async function _changePassword(userId, currentPwd, newPwd) {
    if (userId === 'quemahtech') {
      const { data: admins } = await db.supabase
        .from('admin').select('*').eq('username', 'quemahtech').limit(1);
      if (!admins || admins.length === 0) return { error: 'Admin not found' };
      if (admins[0].password !== currentPwd) return { error: 'Wrong password' };
      await db.supabase.from('admin').update({ password: newPwd }).eq('username', 'quemahtech');
      return { success: true };
    }
    const { data: emps } = await db.supabase
      .from('employees').select('*').eq('id', userId).limit(1);
    if (!emps || emps.length === 0) return { error: 'User not found' };
    if (emps[0].password !== currentPwd) return { error: 'Wrong password' };
    await db.supabase.from('employees').update({ password: newPwd }).eq('id', userId);
    return { success: true };
  }

  async function _forgotPassword(uid) {
    const normalized = (uid || '').toLowerCase().trim();
    if (normalized !== 'quemahtech' && normalized !== 'atharvashishn@gmail.com')
      return { error: 'Unauthorized. Only admin can reset password.' };
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const tempPwd = Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    await db.supabase.from('admin').update({ password: tempPwd }).eq('username', 'quemahtech');
    return { success: true, message: 'Temporary password generated.', tempPassword: tempPwd };
  }

  // ── State ──

  async function _getState() {
    const [employees, attendance, leaveRequests, announcements, depts, archived, notifications] =
      await Promise.all([
        db.getAll('employees'), db.getAll('attendance'), db.getAll('leave_requests'),
        db.getAll('announcements'), db.getAll('departments'), db.getAll('archived_employees'),
        db.getAll('notifications')
      ]);
    return {
      employees: employees.map(e => { const { password, ...rest } = e; return rest; }),
      archivedEmployees: (archived || []).map(a => ({
        id: a.id || a.original_id, name: a.name, dept: a.dept,
        status: a.status, joining: a.joining, exit: a.exit
      })),
      attendanceRecords: attendance || [],
      leaveRequests: (leaveRequests || []).map(l => ({
        id: l.id, empId: l.emp_id, empName: l.emp_name, dept: l.dept,
        type: l.type, from: l.from_date, to: l.to_date,
        days: l.days, reason: l.reason, status: l.status
      })),
      announcements: announcements || [],
      adminNotifications: (notifications || []).filter(n => n.target === 'admin'),
      empNotifications: (notifications || []).filter(n => n.target === 'emp' || n.user_id),
      departments: (depts || []).map(d => d.name)
    };
  }

  // ── Employees ──

  async function _createEmployee(data) {
    const { data: existing } = await db.supabase
      .from('employees').select('id').eq('id', data.id).limit(1);
    if (existing && existing.length > 0) return { error: 'Employee ID already exists' };
    const emp = await db.insert('employees', {
      id: data.id, name: data.name, dept: data.dept,
      email: data.email || '', phone: data.phone || '',
      bday: data.bday || '', joining: data.joining || '',
      designation: data.designation || '',
      password: data.password || 'emp123',
      cl: data.cl || 7.5, sl: data.sl || 3.0, ul: 0, active: true
    });
    if (emp) {
      await db.insert('notifications', {
        text: 'New employee added: ' + data.name + ' (' + data.id + ')',
        time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        unread: true, target: 'admin', user_id: ''
      });
    }
    return emp ? { success: true, employee: emp } : { error: 'Failed to create employee' };
  }

  async function _updateEmployee(id, body) {
    const ok = await db.update('employees', 'id', id, body);
    return ok ? { success: true } : { error: 'Not found' };
  }

  async function _deleteEmployee(id) {
    const { data: emp } = await db.supabase
      .from('employees').select('*').eq('id', id).limit(1);
    if (!emp || emp.length === 0) return { error: 'Not found' };
    await db.supabase.from('employees').delete().eq('id', id);
    await db.insert('archived_employees', {
      id, original_id: id, name: emp[0].name, dept: emp[0].dept,
      status: 'Deleted', joining: emp[0].joining,
      exit: new Date().toISOString().split('T')[0],
      employee_data: emp[0]
    });
    return { success: true };
  }

  async function _archiveEmployee(id) {
    const { data: emp } = await db.supabase
      .from('employees').select('*').eq('id', id).limit(1);
    if (!emp || emp.length === 0) return { error: 'Not found' };
    await db.insert('archived_employees', {
      id, original_id: id, name: emp[0].name, dept: emp[0].dept,
      status: 'Archived', joining: emp[0].joining,
      exit: new Date().toISOString().split('T')[0], employee_data: emp[0]
    });
    await db.supabase.from('employees').update({ active: false }).eq('id', id);
    return { success: true };
  }

  async function _unarchiveEmployee(id) {
    // Find the archived record
    const { data: archived } = await db.supabase
      .from('archived_employees').select('*').eq('id', id).order('created_at', { ascending: false }).limit(1);
    // Restore the employee
    const { data: emp } = await db.supabase
      .from('employees').select('*').eq('id', id).limit(1);
    if (!emp || emp.length === 0) return { error: 'Not found' };
    // Set active back to true
    await db.supabase.from('employees').update({ active: true }).eq('id', id);
    // Remove from archived_employees
    if (archived && archived.length > 0) {
      await db.supabase.from('archived_employees').delete().eq('id', archived[0].id);
    }
    return { success: true };
  }

  // ── Attendance ──

  async function _saveAttendance(body) {
    const { id, date } = body;
    if (!id || !date) return { success: false, error: 'Missing id or date.' };
    const hr = new Date().getHours();
    if (body.in && !body.out && hr >= 18) {
      return { success: false, error: 'Sign-in blocked after 6:00 PM IST.' };
    }
    let status = body.status || 'Present';
    if (body.in && !body.out) {
      if (hr >= 14) status = 'Half-Day';
      else if (hr > 9 || (hr === 9 && new Date().getMinutes() > 15)) status = 'Late';
    }
    body.status = status;
    const result = await db.upsert('attendance', body, 'id,date');
    if (!result) return { success: false, error: 'Failed to save attendance — database error.' };
    return { success: true };
  }

  // ── Leave Requests ──

  async function _createLeaveRequest(data) {
    const lr = await db.insert('leave_requests', {
      emp_id: data.empId, emp_name: data.empName, dept: data.dept,
      type: data.type, from_date: data.from, to_date: data.to,
      days: data.days, reason: data.reason, status: 'Pending'
    });
    return { success: true, leaveRequest: lr };
  }

  async function _updateLeaveRequest(idOrIdx, body) {
    const { data: lrs } = await db.supabase
      .from('leave_requests').select('*').eq('id', idOrIdx).limit(1);
    if (!lrs || lrs.length === 0) return { success: false };
    const lr = lrs[0];
    const oldStatus = lr.status;
    const newStatus = body.status;
    await db.supabase.from('leave_requests').update(body).eq('id', idOrIdx);

    // Deduct leave balances on approval
    let warning = null;
    if (newStatus === 'Approved' && oldStatus !== 'Approved' && lr.emp_id && lr.days) {
      const { data: emps } = await db.supabase
        .from('employees').select('*').eq('id', lr.emp_id).limit(1);
      if (emps && emps.length > 0) {
        const emp = emps[0];
        let cl = emp.cl || 0, sl = emp.sl || 0, ul = emp.ul || 0;
        if (lr.type === 'CL') {
          if (cl >= lr.days) { cl -= lr.days; }
          else { const deficit = lr.days - cl; cl = 0; ul += deficit; warning = 'CL insufficient. ' + deficit + ' day(s) converted to Unpaid Leave.'; }
        } else if (lr.type === 'SL') {
          const slNeeded = lr.days * 0.5;
          const ulNeeded = lr.days * 0.5;
          if (sl >= slNeeded) { sl -= slNeeded; ul += ulNeeded; }
          else { ul += lr.days; sl = Math.max(0, sl - slNeeded); warning = 'SL insufficient. Applied as Unpaid Leave.'; }
        } else if (lr.type === 'UL') { ul += lr.days; }
        await db.supabase.from('employees').update({ cl, sl, ul }).eq('id', lr.emp_id);
      }
    }
    return { success: true, warning };
  }

  // ── Departments ──

  async function _getDepartments() {
    const depts = await db.getAll('departments');
    return (depts || []).map(d => d.name);
  }

  async function _addDepartment(name) {
    const existing = await db.getByFilter('departments', { name });
    if (existing && existing.length > 0) return { error: 'Exists' };
    await db.insert('departments', { name });
    const all = await db.getAll('departments');
    return { success: true, departments: all.map(d => d.name) };
  }

  async function _removeDepartment(name) {
    await db.remove('departments', 'name', name);
    const all = await db.getAll('departments');
    return { success: true, departments: all.map(d => d.name) };
  }

  // ── Notifications ──

  async function _addNotification(data) {
    await db.insert('notifications', {
      text: data.text, time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      unread: true, target: data.target || 'admin', user_id: data.userId || ''
    });
    return { success: true };
  }

  async function _getNotifications(userId) {
    const all = await db.getAll('notifications');
    const notifs = (!userId || userId === 'quemahtech')
      ? all.filter(n => n.target === 'admin')
      : all.filter(n => n.target === 'emp' || n.user_id === userId);
    const unread = notifs.filter(n => n.unread !== false).length;
    return { notifications: notifs, count: unread };
  }

  async function _markNotificationsRead(userId) {
    const all = await db.getAll('notifications');
    const targets = (!userId || userId === 'quemahtech')
      ? all.filter(n => n.target === 'admin' && n.unread !== false)
      : all.filter(n => (n.target === 'emp' || n.user_id === userId) && n.unread !== false);
    for (const n of targets) {
      await db.supabase.from('notifications').update({ unread: false }).eq('id', n.id);
    }
    return { success: true };
  }

  // ── Save All ──

  async function _saveAll(body) {
    if (body.employees) {
      for (const e of body.employees) {
        await db.supabase.from('employees').upsert(e, { onConflict: 'id' });
      }
    }
    if (body.departments) {
      await db.supabase.from('departments').delete().neq('name', '__dummy__');
      for (const name of body.departments) {
        await db.insert('departments', { name });
      }
    }
    if (body.announcements) {
      for (const a of body.announcements) await db.insert('announcements', a);
    }
    return { success: true };
  }

  // ── Leave Accrual ──

  async function _runLeaveAccrual() {
    const emps = await db.getAll('employees');
    let count = 0;
    for (const emp of emps) {
      if (emp.active !== false) {
        await db.supabase.from('employees').update({
          cl: Math.min((parseFloat(emp.cl) || 0) + 1.0, 30),
          sl: Math.min((parseFloat(emp.sl) || 0) + 0.5, 15)
        }).eq('id', emp.id);
        count++;
      }
    }
    return { success: true, count, message: count + ' employees credited (CL +1.0, SL +0.5)' };
  }

  // ── Public API ──

  const api = { init, call, get ready() { return ready; } };
  window.SupabaseClient = api;
})();
