/* ═══════════════════════════════════════
   SUPABASE CLIENT — Direct Supabase access
   Version: 2 (cache-busting update)
═══════════════════════════════════════ */
(function () {
  console.log('[SBClient] Loading version 2 — if you see this, fresh code is running.');
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
    if (path === '/api/auth/reset-password' && method === 'POST')
      return () => _resetPassword(body.newPassword);

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

    // ── Attendance (Multi-Session Punch Ledger) ──
    if (path === '/api/attendance/logs' && method === 'GET')
      return () => _getAttendanceLogs();
    if (path === '/api/attendance/login' && method === 'POST')
      return () => _loginSession(body);
    if (path === '/api/attendance/logout' && method === 'POST')
      return () => _logoutSession(body);

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
      return () => db.getAll('announcements', 'created_at');
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

    // ── Calendar — delegate to local server ──
    if (path === '/api/calendar-config' && method === 'GET')
      return () => _calendarConfig();
    if (path === '/api/calendar-config' && method === 'POST')
      return () => _saveCalendarConfig(body);
    if (path === '/api/calendar/birthday' && method === 'POST')
      return () => _createBirthdayEvent(body.name, body.birthday);
    if (path === '/api/calendar/sync-birthdays' && method === 'POST')
      return () => _syncAllBirthdays(body.employees || []);
    if (path.startsWith('/api/calendar'))
      return () => _calendarConfig();

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
      console.log('[Auth] Admin login attempt:', normalized);
      const { data: admins, error } = await db.supabase
        .from('admin').select('*').eq('username', ADMIN_USERNAME).limit(1);
      if (error) {
        console.error('[Auth] Admin DB query error:', error.message);
        return { success: false, message: 'Database error. Check Supabase connection.' };
      }
      if (!admins || admins.length === 0) {
        console.error('[Auth] Admin account not found in DB!');
        return { success: false, message: 'Admin account not found in database. Run SQL setup.' };
      }
      if (admins[0].password === pwd) {
        console.log('[Auth] Admin login SUCCESS');
        return { success: true, role: 'admin', user: { id: ADMIN_USERNAME, name: 'Administrator' } };
      }
      console.log('[Auth] Admin login FAILED - incorrect password');
      return { success: false, message: 'Incorrect admin password.' };
    }

    // ── Employee check: fetch ALL active employees, match in JavaScript ──
    console.log('[Auth] Employee login attempt for ID/email:', normalized);
    
    try {
      // Fetch ALL active employees in one query (no filter on ID — avoids any encoding/RLS issues)
      const { data: allEmps, error: fetchError } = await db.supabase
        .from('employees').select('*').eq('active', true);
      
      if (fetchError) {
        console.error('[Auth] Error fetching employees:', fetchError.message);
        return { success: false, message: 'Database error. Please contact admin.' };
      }
      
      if (!allEmps || allEmps.length === 0) {
        console.log('[Auth] No active employees found in the database!');
        return { success: false, message: 'No employees found in the system. Contact admin.' };
      }
      
      console.log('[Auth] Found', allEmps.length, 'active employees in DB');
      
      // Try to find the employee by matching in JavaScript
      const originalUid = (uid || '').trim();
      const normalizedUid = originalUid.toLowerCase();
      
      // Strategy 1: Exact ID match (preserving case)
      let matchedEmp = allEmps.find(e => e.id === originalUid);
      
      // Strategy 2: Case-insensitive ID match
      if (!matchedEmp) {
        console.log('[Auth] No exact ID match, trying case-insensitive...');
        matchedEmp = allEmps.find(e => e.id.toLowerCase() === normalizedUid);
      }
      
      // Strategy 3: Email match (case-insensitive)
      if (!matchedEmp) {
        console.log('[Auth] No ID match, trying email...');
        matchedEmp = allEmps.find(e => e.email && e.email.toLowerCase() === normalizedUid);
      }
      
      if (matchedEmp) {
        console.log('[Auth] Employee matched:', matchedEmp.id, '-', matchedEmp.name, '(strategy:', matchedEmp.id === originalUid ? 'exact ID' : matchedEmp.id.toLowerCase() === normalizedUid ? 'case-insensitive ID' : 'email', ')');
        
        if (matchedEmp.password === pwd) {
          console.log('[Auth] Employee login SUCCESS:', matchedEmp.id);
          const hr = new Date().getHours();
          return {
            success: true, role: 'employee',
            user: { id: matchedEmp.id, name: matchedEmp.name, dept: matchedEmp.dept,
                    designation: matchedEmp.designation, cl: matchedEmp.cl, sl: matchedEmp.sl, ul: matchedEmp.ul || 0 },
            timeBlock: { isHalfDay: hr >= 14 }
          };
        } else {
          console.log('[Auth] Password MISMATCH for employee:', matchedEmp.id);
          return { success: false, message: 'Invalid credentials. Please check your password.' };
        }
      }
      
      // Employee not found by any strategy
      console.log('[Auth] No matching employee found for:', originalUid);
      
      // ── Diagnostic: log available employee IDs ──
      console.log('[Auth] DIAGNOSTIC: Available employee IDs:', allEmps.map(e => e.id).join(', '));
      
      // Check if employee exists but is inactive (active = false or null)
      // Fetch ALL employees (including inactive) and match in JS
      try {
        const { data: allEmpsIncludingInactive } = await db.supabase
          .from('employees').select('id,active').limit(500);
        if (allEmpsIncludingInactive && allEmpsIncludingInactive.length > 0) {
          const inactiveMatch = allEmpsIncludingInactive.find(e => e.id.toLowerCase() === normalizedUid || (e.email && e.email.toLowerCase() === normalizedUid));
          if (inactiveMatch) {
            console.log('[Auth] DIAGNOSTIC: Employee', normalizedUid, 'found with active =', inactiveMatch.active);
            if (inactiveMatch.active === null || inactiveMatch.active === undefined) {
              console.log('[Auth] DIAGNOSTIC: active is NULL — auto-fixing and retrying...');
              await db.supabase.from('employees').update({ active: true }).eq('id', inactiveMatch.id);
              console.log('[Auth] DIAGNOSTIC: Fixed active flag — retrying login automatically...');
              return await _login(uid, pwd);
            } else if (inactiveMatch.active === false) {
              return { success: false, message: 'Employee "' + originalUid + '" has been deactivated. Contact admin to reactivate your account.' };
            }
          }
        }
      } catch (diagErr) {
        console.warn('[Auth] DIAGNOSTIC: Inactive check query failed:', diagErr.message);
      }
      
    } catch (err) {
      console.error('[Auth] Employee lookup error:', err.message);
      return { success: false, message: 'Error looking up employee. Check database connection.' };
    }
    
    return { success: false, message: 'Employee not found. Check your Employee ID or contact admin.' };
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

    // 1. Try Supabase Auth password reset email (works if user exists in Auth)
    let emailSent = false;
    try {
      const redirectUrl = window.location.origin + window.location.pathname;
      const { error } = await db.supabase.auth.resetPasswordForEmail('atharvashishn@gmail.com', {
        redirectTo: redirectUrl
      });
      if (!error) emailSent = true;
    } catch (_) {}

    // 2. Always generate a temp password as fallback
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const tempPwd = Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    await db.supabase.from('admin').update({ password: tempPwd }).eq('username', 'quemahtech');

    const warningMessage = 'Your admin password has been RESET. Your previous password will no longer work. Use the temporary password below to log in, then change your password in Settings.';

    if (emailSent) {
      return { success: true, message: 'Password reset email sent. ' + warningMessage, tempPassword: tempPwd };
    }
    return { success: true, message: warningMessage, tempPassword: tempPwd };
  }

  async function _resetPassword(newPwd) {
    await db.supabase.from('admin').update({ password: newPwd }).eq('username', 'quemahtech');
    return { success: true };
  }

  // ── State ──

  async function _getState() {
    const [employees, attendanceLogs, leaveRequests, announcements, depts, archived, notifications] =
      await Promise.all([
        db.getAll('employees'),
        _getAllAttendanceLogs(),
        db.getAll('leave_requests'),
        db.getAll('announcements', 'created_at'),
        db.getAll('departments'),
        db.getAll('archived_employees'),
        db.getAll('notifications', 'created_at')
      ]);
    return {
      employees: employees.map(e => { const { password, ...rest } = e; return rest; }),
      archivedEmployees: (archived || []).map(a => ({
        id: a.id || a.original_id, name: a.name, dept: a.dept,
        status: a.status, joining: a.joining, exit: a.exit,
        employee_data: a.employee_data || null
      })),
      attendanceLogs: (attendanceLogs || []).map(l => ({
        id: l.id, emp_id: l.emp_id, emp_name: l.emp_name,
        department: l.department,
        login_time: l.login_time,
        logout_time: l.logout_time,
        working_hours: l.working_hours || 0,
        status: l.status || 'Active',
        computer_name: l.computer_name || '',
        login_date: l.login_date,
        event: l.event || 'LOGIN'
      })),
      leaveRequests: (leaveRequests || []).map(l => ({
        id: l.id, empId: l.emp_id, empName: l.emp_name, dept: l.dept,
        type: l.type, from: l.from_date, to: l.to_date,
        days: l.days, reason: l.reason, status: l.status
      })),
      announcements: announcements || [],
      adminNotifications: (notifications || []).filter(n => n.target === 'admin').map(_normalizeNotif),
      empNotifications: (notifications || []).filter(n => n.target === 'emp' || n.user_id).map(_normalizeNotif),
      departments: (depts || []).map(d => d.name)
    };
  }

  // ── Employees ──

  async function _createEmployee(data) {
    console.log('[Auth] Creating employee:', data.id, data.name);
    const { data: existing } = await db.supabase
      .from('employees').select('id').eq('id', data.id).limit(1);
    if (existing && existing.length > 0) {
      console.warn('[Auth] Employee ID already exists:', data.id);
      return { error: 'Employee ID already exists' };
    }
    const empPassword = data.password || 'emp123';
    console.log('[Auth] Creating employee with password length:', empPassword.length);
    const emp = await db.insert('employees', {
      id: data.id, name: data.name, dept: data.dept,
      email: data.email || '', phone: data.phone || '',
      bday: data.bday || '', joining: data.joining || '',
      designation: data.designation || '',
      password: empPassword,
      cl: data.cl || 7.5, sl: data.sl || 3.0, ul: 0, active: true
    });
    if (emp) {
      console.log('[Auth] Employee created successfully in DB:', data.id);
      await db.insert('notifications', {
        text: 'New employee added: ' + data.name + ' (' + data.id + ')',
        time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        unread: true, target: 'admin', user_id: ''
      });

      // ── Auto-create Google Calendar birthday event ──
      if (data.bday) {
        try {
          const calResult = await _createBirthdayEvent(data.name, data.bday);
          if (calResult && calResult.success && calResult.eventId) {
            // Store the calendar event ID on the employee record for future updates
            await db.supabase.from('employees').update({
              calendar_event_id: calResult.eventId
            }).eq('id', data.id);
            console.log('[Calendar] Birthday event created for', data.name, '— ID:', calResult.eventId);
          } else if (calResult && calResult.error) {
            console.warn('[Calendar] Failed to create birthday event for', data.name, ':', calResult.error);
          }
        } catch (e) {
          // Calendar failure must NOT block employee creation
          console.warn('[Calendar] Birthday event creation skipped for', data.name, ':', e.message);
        }
      }
    }
    if (!emp) {
      console.error('[Auth] Failed to insert employee into DB:', data.id);
      return { error: 'Failed to create employee in database' };
    }
    console.log('[Auth] Employee creation complete:', data.id);
    return { success: true, employee: emp };
  }

  async function _updateEmployee(id, body) {
    // Strip undefined values to prevent overwriting DB columns with null
    const cleanBody = {};
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined) {
        cleanBody[key] = value;
      }
    }
    console.log('[Auth] Updating employee', id, 'fields:', Object.keys(cleanBody));
    if (cleanBody.password) {
      console.log('[Auth] Password changing for employee:', id);
    }
    const ok = await db.update('employees', 'id', id, cleanBody);
    if (ok) {
      console.log('[Auth] Employee', id, 'updated successfully');
      return { success: true };
    }
    console.error('[Auth] Failed to update employee:', id);
    return { error: 'Not found or update failed' };
  }

  async function _deleteEmployee(id) {
    const { data: emp } = await db.supabase
      .from('employees').select('*').eq('id', id).limit(1);
    if (!emp || emp.length === 0) return { error: 'Not found' };
    // Cascade: delete attendance_logs, then attendance, then employee
    await db.supabase.from('attendance_logs').delete().eq('emp_id', id);
    await db.supabase.from('attendance').delete().eq('id', id);
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

  // ── Attendance (Multi-Session Punch Ledger) ──

  async function _getAllAttendanceLogs() {
    try {
      const { data, error } = await db.supabase
        .from('attendance_logs')
        .select('*')
        .order('login_time', { ascending: false });
      if (error) return [];
      return data || [];
    } catch (e) {
      console.warn('[SBClient] attendance_logs table not available yet:', e.message);
      return [];
    }
  }

  async function _getAttendanceLogs() {
    const { data, error } = await db.supabase
      .from('attendance_logs')
      .select('*')
      .order('login_time', { ascending: false });
    if (error) return [];
    return data || [];
  }

  async function _loginSession(body) {
    const { empId, empName, department, computerName } = body;
    if (!empId) return { success: false, error: 'Missing employee ID.' };
    const hr = new Date().getHours();
    if (hr < 9) {
      return { success: false, error: 'Office starts at 9:00 AM. Sign-in blocked before 9:00 AM IST.' };
    }
    if (hr >= 18) {
      return { success: false, error: 'Sign-in blocked after 6:00 PM IST.' };
    }
    // Check for existing active session
    try {
      const { data: active } = await db.supabase
        .from('attendance_logs')
        .select('id')
        .eq('emp_id', empId)
        .is('logout_time', null)
        .limit(1);
      if (active && active.length > 0) {
        return { success: false, error: 'Already signed in. Please sign out first.' };
      }
    } catch (e) {
      return { success: false, error: 'Attendance system not ready. Contact admin.' };
    }
    const now = new Date();
    const m = now.getMinutes();
    let status = 'Present';
    if (hr >= 14) status = 'Half-Day';
    else if (hr > 9 || (hr === 9 && m > 15)) status = 'Late';
    const loginDate = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    const { data, error } = await db.supabase
      .from('attendance_logs')
      .insert({
        emp_id: empId,
        emp_name: empName,
        department: department || '',
        login_time: now.toISOString(),
        logout_time: null,
        working_hours: 0,
        status,
        computer_name: computerName || 'Web Browser',
        login_date: loginDate,
        event: 'LOGIN'
      })
      .select()
      .single();
    if (error) return { success: false, error: error.message };
    return { success: true, log: data };
  }

  async function _logoutSession(body) {
    const { empId } = body;
    if (!empId) return { success: false, error: 'Missing employee ID.' };
    // Find the active session for this employee
    let active, findErr;
    try {
      const res = await db.supabase
        .from('attendance_logs')
        .select('*')
        .eq('emp_id', empId)
        .is('logout_time', null)
        .limit(1);
      active = res.data; findErr = res.error;
    } catch (e) {
      return { success: false, error: 'Attendance system not ready. Contact admin.' };
    }
    if (findErr) return { success: false, error: findErr.message };
    if (!active || active.length === 0) {
      return { success: false, error: 'No active session found. Please sign in first.' };
    }
    const session = active[0];
    const now = new Date();
    const loginTime = new Date(session.login_time);

    // ── Cap effective working hours to office hours (9:00 AM – 6:00 PM) ──
    const OFFICE_START = 9;   // 9:00 AM
    const OFFICE_END   = 18;  // 6:00 PM

    var effectiveStart = new Date(loginTime);
    var effectiveEnd   = new Date(now);

    if (effectiveStart.getHours() + effectiveStart.getMinutes() / 60 < OFFICE_START) {
      effectiveStart.setHours(OFFICE_START, 0, 0, 0);
    }
    if (effectiveEnd.getHours() + effectiveEnd.getMinutes() / 60 > OFFICE_END) {
      effectiveEnd.setHours(OFFICE_END, 0, 0, 0);
    }

    let workingHours = Math.max(0, (effectiveEnd - effectiveStart) / (1000 * 60 * 60));

    // Auto-deduct 1 hour lunch break (13:00-14:00) if the shift spans the lunch period
    var effStartHour = effectiveStart.getHours() + effectiveStart.getMinutes() / 60;
    var effEndHour   = effectiveEnd.getHours() + effectiveEnd.getMinutes() / 60;
    if (effStartHour < 14 && effEndHour > 13) {
      workingHours = Math.max(0, workingHours - 1);
    }
    const { data, error } = await db.supabase
      .from('attendance_logs')
      .update({
        logout_time: now.toISOString(),
        working_hours: Math.round(workingHours * 100) / 100
      })
      .eq('id', session.id)
      .select()
      .single();
    if (error) return { success: false, error: error.message };
    return { success: true, log: data };
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
      unread: true, is_read: false, target: data.target || 'admin', user_id: data.userId || ''
    });
    return { success: true };
  }

  async function _getNotifications(userId) {
    const all = await db.getAll('notifications', 'created_at');
    const notifs = (!userId || userId === 'quemahtech')
      ? all.filter(n => n.target === 'admin')
      : all.filter(n => n.target === 'emp' || n.user_id === userId);
    const notifsWithRead = notifs.map(n => ({
      ...n,
      isRead: n.is_read === true || n.unread === false
    }));
    const unread = notifsWithRead.filter(n => !n.isRead).length;
    return { notifications: notifsWithRead, count: unread };
  }

  // Normalize a raw notification record: derive isRead from is_read or unread
  function _normalizeNotif(n) {
    return {
      ...n,
      isRead: n.is_read === true || n.unread === false
    };
  }

  async function _markNotificationsRead(userId) {
    const all = await db.getAll('notifications');

    // Determine which notifications to mark read
    const isAdmin = !userId || userId === 'quemahtech' || userId === 'atharvashishn@gmail.com';
    const targets = isAdmin
      ? all.filter(n => n.target === 'admin' && n.is_read !== true)
      : all.filter(n => (n.target === 'emp' || n.user_id === userId) && n.is_read !== true);

    for (const n of targets) {
      const ok = await db.update('notifications', 'id', n.id, { unread: false, is_read: true });
      if (!ok) console.warn('[SBClient] Failed to mark notification', n.id, 'as read');
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

  // ── Calendar helpers (call local server) ──

  async function _calendarFetch(path, opts) {
    const port = window.location.port || '3000';
    const base = window.location.protocol + '//' + window.location.hostname + ':' + port;
    try {
      const res = await fetch(base + path, {
        method: opts?.method || 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: opts?.body ? JSON.stringify(opts.body) : undefined,
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.warn('[Calendar] Server unreachable:', e.message);
      return null;
    }
  }

  async function _calendarConfig() {
    return await _calendarFetch('/api/calendar-config');
  }

  async function _saveCalendarConfig(body) {
    return await _calendarFetch('/api/calendar-config', { method: 'POST', body });
  }

  async function _createBirthdayEvent(name, birthday) {
    return await _calendarFetch('/api/calendar/birthday', {
      method: 'POST',
      body: { name, birthday },
    });
  }

  async function _syncAllBirthdays(employees) {
    // If no employees passed, fetch all active employees with birthdays from DB
    if (!employees || employees.length === 0) {
      const emps = await db.getAll('employees');
      employees = (emps || []).filter(e => e.active !== false && e.bday);
    }
    return await _calendarFetch('/api/calendar/sync-birthdays', {
      method: 'POST',
      body: { employees },
    });
  }

  // ── Public API ──

  const api = { init, call, get ready() { return ready; } };
  window.SupabaseClient = api;
})();
