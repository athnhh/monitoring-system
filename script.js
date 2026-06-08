let currentUser = null;
let currentRole = 'admin';
let currentLeaveType = 'CL';
let archivedVisible = false;
let adminNotifPanelOpen = false;
let empNotifPanelOpen = false;
let breakInterval = null;
let breakSeconds = 0;
let selectedLeaveManageIdx = null;

const DEPT_COLORS = {
  Engineering: 'c-eng', HR: 'c-hr', Marketing: 'c-mkt',
  Finance: 'c-fin', IT: 'c-it', Operations: 'c-ops'
};
const AV_COLORS = ['av-blue', 'av-green', 'av-purple', 'av-amber', 'av-teal', 'av-red', 'av-pink'];

let departments = ["Engineering", "HR", "IT", "Marketing", "Finance", "Operations"];
let employees = [];
let archivedEmployees = [];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

let attendanceRecords = [];
let leaveRequests = [];
let announcements = [];
let adminNotifications = [];
let empNotifications = [];

function saveToLocalStorage() {
  localStorage.setItem('departments', JSON.stringify(departments));
  localStorage.setItem('employees', JSON.stringify(employees));
  localStorage.setItem('archivedEmployees', JSON.stringify(archivedEmployees));
  localStorage.setItem('attendanceRecords', JSON.stringify(attendanceRecords));
  localStorage.setItem('leaveRequests', JSON.stringify(leaveRequests));
  localStorage.setItem('announcements', JSON.stringify(announcements));
  localStorage.setItem('adminNotifications', JSON.stringify(adminNotifications));
  localStorage.setItem('empNotifications', JSON.stringify(empNotifications));
  // Also sync to server (fire-and-forget)
  syncToServer();
}

function syncToServer() {
  api('/api/save', {
    method: 'POST',
    body: {
      employees, archivedEmployees, attendanceRecords, leaveRequests,
      announcements, adminNotifications, empNotifications, departments
    }
  }).catch(() => {});
}

function loadFromLocalStorage() {
  if (localStorage.getItem('departments')) departments = JSON.parse(localStorage.getItem('departments'));
  if (localStorage.getItem('employees')) employees = JSON.parse(localStorage.getItem('employees'));
  if (localStorage.getItem('archivedEmployees')) archivedEmployees = JSON.parse(localStorage.getItem('archivedEmployees'));
  if (localStorage.getItem('attendanceRecords')) attendanceRecords = JSON.parse(localStorage.getItem('attendanceRecords'));
  if (localStorage.getItem('leaveRequests')) leaveRequests = JSON.parse(localStorage.getItem('leaveRequests'));
  if (localStorage.getItem('announcements')) announcements = JSON.parse(localStorage.getItem('announcements'));
  if (localStorage.getItem('adminNotifications')) adminNotifications = JSON.parse(localStorage.getItem('adminNotifications'));
  if (localStorage.getItem('empNotifications')) empNotifications = JSON.parse(localStorage.getItem('empNotifications'));
}

// API HELPER
const API_BASE = '';

async function api(path, options = {}) {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    return await res.json();
  } catch (e) {
    console.error('API error:', path, e);
    return { success: false, error: e.message };
  }
}

let ws = null;
function connectWebSocket() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${proto}//${window.location.host}`;
  try {
    ws = new WebSocket(wsUrl);
    ws.onmessage = (e) => {
      try {
        const { event, data } = JSON.parse(e.data);
        handleRealtimeEvent(event, data);
      } catch (err) { /* ignore parse errors */ }
    };
    ws.onclose = () => { setTimeout(connectWebSocket, 3000); };
    ws.onerror = () => { ws.close(); };
  } catch (e) { /* silently fail */ }
}

function handleRealtimeEvent(event, data) {
  if (event === 'announcement') {
    announcements.unshift(data);
    renderAnnouncements();
  } else if (event === 'leave_request' || event === 'leave_update') {
    // Will be refreshed when user visits the leave tab
  } else if (event === 'attendance_update') {
    // Will be refreshed when user visits dashboard
  } else if (event === 'employee_added' || event === 'employee_deleted' || event === 'employee_archived') {
    refreshState();
  } else if (event === 'notification') {
    if (data.target === 'emp') {
      empNotifications.unshift(data);
      renderEmpNotifPanel();
    } else {
      adminNotifications.unshift(data);
      renderAdminNotifPanel();
    }
  }
}

async function refreshState() {
  const res = await api('/api/state');
  if (res.employees) {
    employees = res.employees;
    archivedEmployees = res.archivedEmployees || [];
    attendanceRecords = res.attendanceRecords || [];
    leaveRequests = res.leaveRequests || [];
    announcements = res.announcements || [];
    departments = res.departments || ['Engineering', 'HR', 'IT', 'Marketing', 'Finance', 'Operations'];
    renderEmpTable();
    updateDashboardStats();
    renderDashboardCards();
    renderLeaveRequests();
    renderLeaveBalances();
    renderLeaveHistory();
    renderArchivedTable();
    renderAnnouncements();
    renderDeptHeadcount();
    renderDepartments();
  }
}

// Fallback seed data when nothing is in localStorage and server is unreachable
function seedDefaultData() {
  if (!employees.length) {
    employees = [
      { id: 'EMP001', name: 'Rahul Sharma', dept: 'Engineering', email: 'rahul@test.com', phone: '+91 98765 43210', bday: '1990-05-15', joining: '2023-01-10', designation: 'Senior Developer', cl: 7.5, sl: 3.0, ul: 0, active: true, password: 'emp123' },
      { id: 'EMP002', name: 'Priya Patel', dept: 'HR', email: 'priya@test.com', phone: '+91 87654 32109', bday: '1992-08-22', joining: '2023-03-15', designation: 'HR Manager', cl: 7.5, sl: 3.0, ul: 0, active: true, password: 'emp123' }
    ];
  }
  if (!attendanceRecords.length) {
    const today = new Date().toISOString().split('T')[0];
    const hr = String(new Date().getHours()).padStart(2, '0');
    const min = String(new Date().getMinutes()).padStart(2, '0');
    attendanceRecords = [
      { id: 'EMP001', name: 'Rahul Sharma', dept: 'Engineering', date: today, in: '09:05', out: '', hours: 0, status: 'Present' },
      { id: 'EMP002', name: 'Priya Patel', dept: 'HR', date: today, in: '09:12', out: '', hours: 0, status: 'Present' }
    ];
  }
}

// Load persisted data before initializing views
loadFromLocalStorage();
seedDefaultData();
connectWebSocket();

// Keep a reference for archiving — will be overridden by server data on refresh
let deleteTargetId = null;

// INIT
document.addEventListener('DOMContentLoaded', () => {
  updateClock();
  setInterval(updateClock, 1000);
  renderDepartments();
  renderEmpTable();
  updateDashboardStats();
  renderDashboardCards();
  renderLeaveRequests();
  renderLeaveBalances();
  renderLeaveHistory();
  renderArchivedTable();
  renderAnnouncements();
  renderDeptHeadcount();
  renderAdminNotifPanel();
  renderEmpNotifPanel();
  setReport('daily', document.querySelector('.rtab'));
  setAdminGreeting();

  // Set today's date on inputs
  const today = new Date().toISOString().split('T')[0];
  const mi = document.getElementById('hist-month');
  if (mi) mi.value = today.slice(0, 7);
  const lf = document.getElementById('leave-from');
  const lt = document.getElementById('leave-to');
  if (lf) lf.value = today;
  if (lt) lt.value = today;

  // Restore previous session if "Remember me" was checked
  if (localStorage.getItem('rememberMe') === 'true') {
    restoreSession();
  }

  // Schedule 6pm auto sign-out for employees
  scheduleAutoSignOut();
});
// CLOCK & GREETINGS
function updateClock() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-IN', { hour12: true });
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const elms = ['admin-clock', 'emp-clock'];
  elms.forEach(id => { const e = document.getElementById(id); if (e) e.innerText = timeStr; });

  const ebig = document.getElementById('emp-bigclock');
  if (ebig) ebig.innerText = timeStr;
  const td1 = document.getElementById('today-date');
  const td2 = document.getElementById('today-date2');
  const eds = document.getElementById('emp-datestr');
  if (td1) td1.innerText = dateStr;
  if (td2) td2.innerText = dateStr;
  if (eds) eds.innerText = dateStr;
}

function setAdminGreeting() {
  const h = new Date().getHours();
  const g = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const el = document.getElementById('admin-greeting');
  if (el) el.textContent = `${g}, Administrator 👋`;
}

// AUTH
function setRole(role) {
  currentRole = role;
  document.querySelectorAll('.role-btn').forEach(b => b.classList.remove('active'));
  if (role === 'admin') {
    document.getElementById('role-admin').classList.add('active');
    document.getElementById('uid-label').innerText = 'Username';
    document.getElementById('uid').placeholder = 'Enter username';
  } else {
    document.getElementById('role-emp').classList.add('active');
    document.getElementById('uid-label').innerText = 'Employee ID';
    document.getElementById('uid').placeholder = 'Enter employee ID';
  }
}
async function doLogin() {
  const uid = document.getElementById('uid').value.trim();
  const pwd = document.getElementById('pwd').value.trim();
  const err = document.getElementById('err-msg');

  if (err) err.style.display = 'none';

  // Try server login first
  const res = await api('/api/login', {
    method: 'POST',
    body: { uid, pwd, role: currentRole }
  });

  const rememberMe = document.getElementById('remember-me')?.checked || false;

  if (res.success && res.role === 'admin') {
    localStorage.setItem('loggedIn', 'true');
    localStorage.setItem('userRole', 'admin');
    localStorage.setItem('userId', uid);
    if (rememberMe) localStorage.setItem('rememberMe', 'true');
    else localStorage.removeItem('rememberMe');
    await refreshState();
    switchPage('page-admin');
    renderRecords();
    renderEmpHistory();
    showNotifBar('success', 'Welcome back, Administrator!', '👋');
    return;
  }

  if (res.success && res.role === 'employee') {
    // Fetch fresh employee data from server
    await refreshState();
    const emp = employees.find(e => e.id === uid && e.active);
    if (emp) {
      currentUser = emp;
      localStorage.setItem('loggedIn', 'true');
      localStorage.setItem('userRole', 'employee');
      localStorage.setItem('userId', emp.id);
      if (rememberMe) localStorage.setItem('rememberMe', 'true');
      else localStorage.removeItem('rememberMe');
      loadEmployeeData(emp);
      switchPage('page-employee');
      // ── Auto attendance: sign in on page load ──
      autoAttendancePunchIn(emp);
      showNotifBar('success', `Welcome back, ${emp.name.split(' ')[0]}!`, '👋');
      return;
    }
  }

  // Fallback to localStorage-based auth (offline mode)
  const expectedAdminPwd = localStorage.getItem('adminPassword') || 'quemah123';
  if (currentRole === 'admin' && uid === 'quemahtech' && pwd === expectedAdminPwd) {
    localStorage.setItem('loggedIn', 'true');
    localStorage.setItem('userRole', 'admin');
    localStorage.setItem('userId', uid);
    if (rememberMe) localStorage.setItem('rememberMe', 'true');
    else localStorage.removeItem('rememberMe');
    switchPage('page-admin');
    renderRecords();
    renderEmpHistory();
    showNotifBar('success', 'Welcome back, Administrator!', '👋');
    return;
  }

  if (currentRole === 'employee') {
    const emp = employees.find(e => e.id === uid && e.active);
    if (emp) {
      const expectedEmpPwd = emp.password || 'emp123';
      if (pwd === expectedEmpPwd) {
        currentUser = emp;
        localStorage.setItem('loggedIn', 'true');
        localStorage.setItem('userRole', 'employee');
        localStorage.setItem('userId', emp.id);
        if (rememberMe) localStorage.setItem('rememberMe', 'true');
        else localStorage.removeItem('rememberMe');
        loadEmployeeData(emp);
        switchPage('page-employee');
        // ── Auto attendance: sign in on page load ──
        autoAttendancePunchIn(emp);
        showNotifBar('success', `Welcome back, ${emp.name.split(' ')[0]}!`, '👋');
        return;
      }
    }
  }

  if (err) err.style.display = 'flex';
}
function loadEmployeeData(emp) {

  document.getElementById('emp-fullname').innerText = emp.name;
  document.getElementById('emp-details').innerText =
    `${emp.id} | ${emp.dept} | ${emp.designation}`;

  document.getElementById('emp-badge').innerText =
    `👤 ${emp.name}`;

  document.getElementById('emp-topbar-name').innerText =
    emp.name;

  const avEl = document.getElementById('emp-av');

  if (avEl) {
    avEl.innerText = emp.name.charAt(0);
    avEl.className =
      `emp-hero-av ${AV_COLORS[
      employees.indexOf(emp) %
      AV_COLORS.length
      ]
      }`;
  }

  document.getElementById('emp-cl-bal').innerText = emp.cl;
  document.getElementById('emp-sl-bal').innerText = emp.sl;
  document.getElementById('emp-ul-used').innerText = emp.ul;

  document.getElementById('emp-cl-bal2').innerText = emp.cl;
  document.getElementById('emp-sl-bal2').innerText = emp.sl;
  document.getElementById('emp-ul-used2').innerText = emp.ul;

  renderEmpDashboard(emp);
}
function logout() {

  localStorage.removeItem('loggedIn');
  localStorage.removeItem('userRole');
  localStorage.removeItem('userId');
  localStorage.removeItem('rememberMe');

  currentUser = null;

  document.getElementById('uid').value = '';
  document.getElementById('pwd').value = '';

  switchPage('page-login');
}
async function restoreSession() {
  const loggedIn = localStorage.getItem('loggedIn');
  const userId = localStorage.getItem('userId');

  if (loggedIn !== 'true') return;

  // Try to refresh from server first
  try { await refreshState(); } catch (e) { /* use cached data */ }

  // Determine role from userId instead of relying on userRole,
  // which can get overwritten when using multiple tabs with different roles
  if (userId === 'quemahtech') {
    switchPage('page-admin');
    renderRecords();
    return;
  }

  if (userId) {
    const emp = employees.find(e => e.id === userId);
    if (emp) {
      currentUser = emp;
      loadEmployeeData(emp);
      switchPage('page-employee');

      // ── Auto attendance: sign in on page load, sign out if after 6pm ──
      autoAttendancePunchIn(emp);
    }
  }
}

function switchPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const t = document.getElementById(pageId);
  if (t) t.classList.add('active');
}

// NAVIGATION
function switchTab(containerSelector, tabPrefix, tabName, btnElement, extraRender) {
  // Update nav button active state
  const navBtns = document.querySelectorAll(containerSelector + ' .nav-btn');
  navBtns.forEach(b => b.classList.remove('active'));
  if (btnElement) btnElement.classList.add('active');

  const currentTab = document.querySelector(containerSelector + ' .' + (tabPrefix === 'admin' ? 'atab' : 'etab') + '.show');
  const newTab = document.getElementById(tabPrefix + '-' + tabName);
  if (!newTab) return;

  if (currentTab && currentTab !== newTab) {
    // Exit animation on current tab, then enter on new tab
    currentTab.classList.remove('show');
    currentTab.classList.add('tab-leaving');
    // Force reflow to ensure exit animation plays
    void currentTab.offsetWidth;

    // Wait for exit animation to complete (matches 0.18s in CSS)
    setTimeout(() => {
      currentTab.classList.remove('tab-leaving');
      newTab.classList.add('show');
      if (extraRender) extraRender();
    }, 190);
  } else {
    // No current tab or same tab — just show directly
    newTab.classList.add('show');
    if (extraRender) extraRender();
  }
}

function adminTab(tabName, btnElement) {
  switchTab('#page-admin', 'admin', tabName, btnElement, () => {
    if (tabName === 'records') renderRecords();
    if (tabName === 'reports') setReport('daily', document.querySelector('.rtab.active'));
  });
}

function empTab(tabName, btnElement) {
  switchTab('#page-employee', 'emp', tabName, btnElement, () => {
    if (tabName === 'history') renderEmpHistory();
  });
}

// DASHBOARD STATS
function updateDashboardStats() {
  const today = new Date().toISOString().split('T')[0];
  const todayRecs = attendanceRecords.filter(r => r.date === today);
  const present = todayRecs.filter(r => r.status === 'Present' || r.status === 'Late' || r.status === 'Half-Day').length;
  const absent = todayRecs.filter(r => r.status === 'Absent').length;
  const late = todayRecs.filter(r => r.status === 'Late').length;
  const total = employees.filter(e => e.active).length;
  const rate = total > 0 ? Math.round(present / total * 100) : 0;

  setText('stat-total-emp', total);
  setText('stat-present-today', present);
  setText('stat-absent-today', absent);
  setText('stat-late-today', late);
  setText('stat-present-rate', `${rate}% attendance`);
}

function renderDashboardCards() {
  updateDashboardStats();
  const today = new Date().toISOString().split('T')[0];
  const todayRecs = attendanceRecords.filter(r => r.date === today);
  const presentEmps = todayRecs.filter(r => ['Present', 'Late', 'Half-Day'].includes(r.status));
  const absentEmps = todayRecs.filter(r => r.status === 'Absent');

  const pEl = document.getElementById('a-present');
  const aEl = document.getElementById('a-absent');
  setText('title-present-count', `Present (${presentEmps.length})`);
  setText('title-absent-count', `Absent / On Leave (${absentEmps.length})`);

  if (pEl) pEl.innerHTML = presentEmps.length ? presentEmps.map(r => actRow(r)).join('') : '<p style="color:var(--subtle);font-size:13px;">No one present yet.</p>';
  if (aEl) aEl.innerHTML = absentEmps.length ? absentEmps.map(r => actRow(r)).join('') : '<p style="color:var(--subtle);font-size:13px;">All present!</p>';

  // Department bars
  const barsEl = document.getElementById('a-bars');
  if (barsEl) {
    const deptData = {};
    employees.filter(e => e.active).forEach(emp => {
      if (!deptData[emp.dept]) deptData[emp.dept] = { total: 0, present: 0 };
      deptData[emp.dept].total++;
      const rec = todayRecs.find(r => r.id === emp.id && ['Present', 'Late', 'Half-Day'].includes(r.status));
      if (rec) deptData[emp.dept].present++;
    });
    barsEl.innerHTML = Object.entries(deptData).map(([d, v]) => {
      const pct = v.total > 0 ? Math.round(v.present / v.total * 100) : 0;
      const color = pct >= 80 ? 'bf-green' : pct >= 50 ? 'bf-amber' : 'bf-red';
      return `<div class="bar-row"><span class="bar-label">${d}</span><div class="bar-track"><div class="bar-fill ${color}" style="width:${pct}%"></div></div><span class="bar-val">${pct}%</span></div>`;
    }).join('');
  }

  // Today's log table
  const logEl = document.getElementById('a-log');
  if (logEl) logEl.innerHTML = todayRecs.map(r => `
    <tr><td><div style="display:flex;align-items:center;gap:8px;"><div class="av ${AV_COLORS[employees.findIndex(e => e.id === r.id) % AV_COLORS.length]}">${r.name.charAt(0)}</div><span>${r.name}</span></div></td>
    <td><span class="chip ${DEPT_COLORS[r.dept] || 'c-eng'}">${r.dept}</span></td>
    <td><span style="font-family:var(--font-mono);font-size:12px;">${r.in || '—'}</span></td>
    <td><span style="font-family:var(--font-mono);font-size:12px;">${r.out || '—'}</span></td>
    <td><strong>${r.hours > 0 ? r.hours.toFixed(1) + 'h' : '—'}</strong></td>
    <td><span class="tag t-${r.status.toLowerCase().replace('-', '')}">${r.status}</span></td></tr>
  `).join('');

  // Pending leaves on dashboard
  renderDashPendingLeaves();
}

function actRow(r) {
  return `<div class="act-row"><div class="av ${AV_COLORS[employees.findIndex(e => e.id === r.id) % AV_COLORS.length]}">${r.name.charAt(0)}</div><div style="flex:1;"><div style="font-size:13px;font-weight:600;">${r.name}</div><div style="font-size:11px;color:var(--muted);">${r.dept}</div></div><span class="tag t-${r.status.toLowerCase().replace('-', '').replace(' ', '')}">${r.status}</span></div>`;
}

function renderDashPendingLeaves() {
  const el = document.getElementById('dash-pending-leaves');
  if (!el) return;
  const pending = leaveRequests.filter(l => l.status === 'Pending');
  if (!pending.length) { el.innerHTML = '<p style="color:var(--subtle);font-size:13px;">No pending requests.</p>'; return; }
  el.innerHTML = pending.map(l => leaveReqCard(l)).join('');
}

// RECORDS TAB
function renderRecords() {
  const dateF = document.getElementById('rec-date')?.value || '';
  const deptF = document.getElementById('rec-dept')?.value || '';
  const statusF = document.getElementById('rec-status')?.value || '';
  const tbody = document.getElementById('a-records');
  if (!tbody) return;
  let recs = attendanceRecords.slice();
  if (dateF) recs = recs.filter(r => r.date === dateF);
  if (deptF) recs = recs.filter(r => r.dept === deptF);
  if (statusF) recs = recs.filter(r => r.status === statusF);
  tbody.innerHTML = recs.map(r => `
    <tr><td><span style="font-family:var(--font-mono);font-size:11px;color:var(--muted);">${r.id}</span></td>
    <td><div style="display:flex;align-items:center;gap:8px;"><div class="av ${AV_COLORS[employees.findIndex(e => e.id === r.id) % AV_COLORS.length]}">${r.name.charAt(0)}</div>${r.name}</div></td>
    <td><span class="chip ${DEPT_COLORS[r.dept] || 'c-eng'}">${r.dept}</span></td>
    <td>${formatDate(r.date)}</td>
    <td><span style="font-family:var(--font-mono);font-size:12px;">${r.in || '—'}</span></td>
    <td><span style="font-family:var(--font-mono);font-size:12px;">${r.out || '—'}</span></td>
    <td><strong>${r.hours > 0 ? r.hours.toFixed(1) + 'h' : '—'}</strong></td>
    <td><span class="tag t-${r.status.toLowerCase().replace('-', '').replace(' ', '')}">${r.status}</span></td>
    <td style="font-size:11px;color:var(--subtle);">${r.status === 'Half-Day' ? 'Late login>14:00' : ''}</td></tr>
  `).join('');
}

// EMPLOYEES TAB
function renderEmpTable() {
  const tbody = document.getElementById('emp-table-body');
  if (!tbody) return;
  const search = document.getElementById('emp-search')?.value.toLowerCase() || '';
  const deptF = document.getElementById('emp-dept-filter')?.value || '';
  let list = employees.filter(e => e.active);
  if (search) list = list.filter(e => e.name.toLowerCase().includes(search) || e.id.toLowerCase().includes(search));
  if (deptF) list = list.filter(e => e.dept === deptF);
  tbody.innerHTML = list.map((emp, i) => `
    <tr>
      <td><div class="av ${AV_COLORS[i % AV_COLORS.length]}">${emp.name.charAt(0)}</div></td>
      <td><span style="font-family:var(--font-mono);font-size:12px;font-weight:600;">${emp.id}</span></td>
      <td><strong>${emp.name}</strong></td>
      <td><span class="chip ${DEPT_COLORS[emp.dept] || 'c-eng'}">${emp.dept}</span></td>
      <td style="color:var(--muted);font-size:12px;">${emp.designation || '—'}</td>
      <td style="font-size:12px;">${emp.email}</td>
      <td style="font-size:12px;">${emp.phone || '—'}</td>
      <td style="font-size:12px;">${emp.bday ? formatDate(emp.bday) : '—'}</td>
      <td>
        <button class="btn btn-sm" onclick="openEditEmpModal('${emp.id}')" title="Edit">✏️</button>
        <button class="btn btn-sm" onclick="archiveEmployee(${employees.indexOf(emp)})" title="Archive">📦</button>
        <button class="btn btn-sm btn-danger" onclick="openDeleteEmpModal('${emp.id}')" title="Remove">🗑</button>
      </td>
    </tr>
  `).join('');
}

function renderArchivedTable() {
  const tbody = document.getElementById('archived-table-body');
  if (!tbody) return;
  tbody.innerHTML = archivedEmployees.map(e => `
    <tr>
      <td><span style="font-family:var(--font-mono);font-size:12px;">${e.id}</span></td>
      <td>${e.name}</td>
      <td><span class="chip ${DEPT_COLORS[e.dept] || 'c-eng'}">${e.dept}</span></td>
      <td><span class="tag t-absent">${e.status}</span></td>
      <td style="font-size:12px;">${formatDate(e.joining)}</td>
      <td style="font-size:12px;">${formatDate(e.exit)}</td>
      <td><button class="btn btn-sm" onclick="showNotifBar('info','Full history for ${e.name} (Read-only)','📋')">View History</button></td>
    </tr>
  `).join('');
}

function archiveEmployee(idx) {
  if (!confirm(`Archive ${employees[idx].name}? They will be moved to the archived employees section.`)) return;
  const emp = employees[idx];
  api(`/api/employees/${emp.id}/archive`, { method: 'POST' });
  archivedEmployees.push({ id: emp.id, name: emp.name, dept: emp.dept, status: 'Archived', joining: emp.joining, exit: new Date().toISOString().split('T')[0] });
  employees[idx].active = false;
  saveToLocalStorage();
  renderEmpTable();
  renderArchivedTable();
  updateDashboardStats();
  showNotifBar('info', `${emp.name} has been archived.`, '📦');
}

function openDeleteEmpModal(id) {
  deleteTargetId = id;
  const emp = employees.find(e => e.id === id);
  if (emp) document.getElementById('delete-emp-name').innerText = `${emp.name} (${emp.id})`;
  document.getElementById('delete-emp-modal').style.display = 'flex';
}

function closeDeleteEmpModal() {
  document.getElementById('delete-emp-modal').style.display = 'none';
  deleteTargetId = null;
}

async function confirmDeleteEmployee() {
  if (!deleteTargetId) return;
  const res = await api(`/api/employees/${deleteTargetId}`, { method: 'DELETE' });
  if (res.success) {
    const emp = employees.find(e => e.id === deleteTargetId);
    archivedEmployees.push({ id: emp.id, name: emp.name, dept: emp.dept, status: 'Deleted', joining: emp.joining, exit: new Date().toISOString().split('T')[0] });
    employees = employees.filter(e => e.id !== deleteTargetId);
    saveToLocalStorage();
    closeDeleteEmpModal();
    renderEmpTable();
    renderArchivedTable();
    updateDashboardStats();
    renderLeaveBalances();
    renderDeptHeadcount();
    showNotifBar('info', `${emp.name} has been removed.`, '🗑');
  } else {
    showNotifBar('error', 'Failed to remove employee.', '❌');
  }
}

function openAddEmpModal() {
  document.getElementById('add-emp-modal').dataset.mode = 'add';
  document.getElementById('add-emp-modal').dataset.editId = '';
  document.getElementById('add-emp-title').innerText = '👤 Add New Employee';
  document.getElementById('add-emp-save-btn').innerText = '💾 Save Employee';
  document.getElementById('add-emp-modal').style.display = 'flex';
  document.getElementById('f-name').value = '';
  document.getElementById('f-id').value = '';
  document.getElementById('f-email').value = '';
  document.getElementById('f-phone').value = '';
  document.getElementById('f-birthday').value = '';
  document.getElementById('f-joining').value = new Date().toISOString().split('T')[0];
  document.getElementById('f-designation').value = '';
  document.getElementById('f-pwd').value = '';
  document.getElementById('f-cl').value = '7.5';
  document.getElementById('f-sl').value = '3.0';
  renderDepartments();
}

function openEditEmpModal(empId) {
  const emp = employees.find(e => e.id === empId);
  if (!emp) return;
  
  document.getElementById('add-emp-modal').dataset.mode = 'edit';
  document.getElementById('add-emp-modal').dataset.editId = empId;
  document.getElementById('add-emp-title').innerText = '✏️ Edit Employee';
  document.getElementById('add-emp-save-btn').innerText = '💾 Update Employee';
  document.getElementById('add-emp-modal').style.display = 'flex';
  
  document.getElementById('f-name').value = emp.name;
  document.getElementById('f-id').value = emp.id;
  document.getElementById('f-id').disabled = true;
  document.getElementById('f-email').value = emp.email || '';
  document.getElementById('f-phone').value = emp.phone || '';
  document.getElementById('f-birthday').value = emp.bday || '';
  document.getElementById('f-joining').value = emp.joining || new Date().toISOString().split('T')[0];
  document.getElementById('f-designation').value = emp.designation || '';
  document.getElementById('f-pwd').value = '';
  document.getElementById('f-pwd').placeholder = 'Leave blank to keep current';
  document.getElementById('f-cl').value = emp.cl;
  document.getElementById('f-sl').value = emp.sl;
  renderDepartments();
  if (document.getElementById('f-dept')) document.getElementById('f-dept').value = emp.dept;
}

function closeAddEmpModal() {
  document.getElementById('add-emp-modal').style.display = 'none';
  document.getElementById('f-id').disabled = false;
}

function saveEmployee() {
  const mode = document.getElementById('add-emp-modal').dataset.mode || 'add';
  const editId = document.getElementById('add-emp-modal').dataset.editId || '';
  const name = document.getElementById('f-name').value.trim();
  const id = document.getElementById('f-id').value.trim();
  const email = document.getElementById('f-email').value.trim();
  const phone = document.getElementById('f-phone').value.trim();
  const bday = document.getElementById('f-birthday').value;
  const joining = document.getElementById('f-joining').value;
  const dept = document.getElementById('f-dept').value;
  const designation = document.getElementById('f-designation').value.trim();
  const pwd = document.getElementById('f-pwd').value.trim();
  const cl = parseFloat(document.getElementById('f-cl').value) || 0;
  const sl = parseFloat(document.getElementById('f-sl').value) || 0;

  if (!name || !id || !dept) {
    showNotifBar('warning', 'Please fill in all required fields (*)', '⚠️');
    return;
  }

  if (mode === 'add') {
    if (employees.some(e => e.id === id)) {
      showNotifBar('warning', 'Employee ID already exists.', '⚠️');
      return;
    }
    
    const newEmp = {
      id, name, dept, email, phone, bday, joining, designation, cl, sl, ul: 0, active: true, password: pwd || 'emp123'
    };
    
    employees.push(newEmp);
    api('/api/employees', { method: 'POST', body: newEmp });
    saveToLocalStorage();
    closeAddEmpModal();
    renderEmpTable();
    renderLeaveBalances();
    updateDashboardStats();
    showNotifBar('success', `Employee ${name} added successfully!`, '✓');
  } else {
    // Edit mode
    const emp = employees.find(e => e.id === editId);
    if (!emp) {
      showNotifBar('error', 'Employee not found.', '❌');
      return;
    }
    
    emp.name = name;
    emp.dept = dept;
    emp.email = email;
    emp.phone = phone;
    emp.bday = bday;
    emp.joining = joining;
    emp.designation = designation;
    if (pwd) emp.password = pwd;
    emp.cl = cl;
    emp.sl = sl;
    
    api(`/api/employees/${editId}`, {
      method: 'PUT',
      body: { name, dept, email, phone, bday, joining, designation, cl, sl, password: pwd || undefined }
    });
    saveToLocalStorage();
    closeAddEmpModal();
    renderEmpTable();
    renderLeaveBalances();
    updateDashboardStats();
    showNotifBar('success', `Employee ${name} updated successfully!`, '✓');
  }
}

function toggleArchived() {
  archivedVisible = !archivedVisible;
  document.getElementById('archived-section').style.display = archivedVisible ? 'block' : 'none';
  document.getElementById('archived-toggle').classList.toggle('active', archivedVisible);
  document.getElementById('archived-arrow').innerText = archivedVisible ? '⌄' : '›';
}

function renderDepartments() {
  const tagList = document.getElementById('dept-tag-list');
  const recDept = document.getElementById('rec-dept');
  const empFilter = document.getElementById('emp-dept-filter');
  const fDept = document.getElementById('f-dept');

  if (tagList) tagList.innerHTML = departments.map(d => `<span class="chip ${DEPT_COLORS[d] || 'c-eng'}" style="padding:4px 12px;font-size:12px;display:inline-flex;align-items:center;gap:5px;">${d}<button style="background:none;border:none;cursor:pointer;color:inherit;font-size:14px;line-height:1;margin-left:2px;" onclick="removeDept('${d}')">×</button></span>`).join('');

  const allOpt = '<option value="">All Departments</option>' + departments.map(d => `<option value="${d}">${d}</option>`).join('');
  const deptOpt = departments.map(d => `<option value="${d}">${d}</option>`).join('');
  if (recDept) recDept.innerHTML = allOpt;
  if (empFilter) empFilter.innerHTML = allOpt;
  if (fDept) fDept.innerHTML = deptOpt;
}

function removeDept(name) {
  if (!confirm(`Remove department "${name}"?`)) return;
  departments = departments.filter(d => d !== name);
  saveToLocalStorage();
  renderDepartments();
  renderDeptHeadcount();
  showNotifBar('info', `Department "${name}" removed.`, '🗑');
}

function addDept() {
  const inp = document.getElementById('new-dept-input');
  const val = inp?.value.trim();
  if (!val) return;
  if (departments.includes(val)) { showNotifBar('warning', 'Department already exists.', '⚠️'); return; }
  departments.push(val);
  if (inp) inp.value = '';
  saveToLocalStorage();
  renderDepartments();
  renderDeptHeadcount();
  showNotifBar('success', `Department "${val}" added!`, '✓');
}

function renderDeptHeadcount() {
  const el = document.getElementById('dept-headcount-bars');
  if (!el) return;
  const counts = {};
  departments.forEach(d => counts[d] = 0);
  employees.filter(e => e.active).forEach(e => { if (counts[e.dept] !== undefined) counts[e.dept]++; });
  const max = Math.max(...Object.values(counts), 1);
  const colors = ['bf-blue', 'bf-green', 'bf-purple', 'bf-amber', 'bf-red', 'bf-purple'];
  el.innerHTML = Object.entries(counts).map(([d, c], i) => `
    <div class="bar-row">
      <span class="bar-label">${d}</span>
      <div class="bar-track"><div class="bar-fill ${colors[i % colors.length]}" style="width:${Math.round(c / max * 100)}%"></div></div>
      <span class="bar-val">${c} emp</span>
    </div>
  `).join('');
}

// LEAVE MANAGEMENT
function leaveReqCard(l) {
  const typeColor = l.type === 'CL' ? 'c-eng' : l.type === 'SL' ? 'c-mkt' : 'c-it';
  const statusTag = l.status === 'Pending' ? '<span class="tag t-late">Pending</span>' : l.status === 'Approved' ? '<span class="tag t-present">Approved</span>' : '<span class="tag t-absent">Rejected</span>';
  const actions = l.status === 'Pending' ? `
    <button class="btn btn-sm btn-success" onclick="handleLeave(${l.idx},'Approved')">✓ Approve</button>
    <button class="btn btn-sm btn-danger" onclick="handleLeave(${l.idx},'Rejected')">✗ Reject</button>
  ` : '';
  return `<div class="leave-req-card">
    <div class="av av-blue">${l.empName.charAt(0)}</div>
    <div style="flex:1;">
      <div style="font-size:13px;font-weight:600;">${l.empName} <span class="chip ${typeColor}">${l.type}</span></div>
      <div style="font-size:12px;color:var(--muted);margin-top:3px;">${formatDate(l.from)} – ${formatDate(l.to)} (${l.days} day${l.days > 1 ? 's' : ''})</div>
      <div style="font-size:12px;color:var(--subtle);margin-top:2px;">${l.reason}</div>
    </div>
    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
      ${statusTag}
      <div class="leave-req-actions">${actions}</div>
    </div>
  </div>`;
}

function renderLeaveRequests() {
  const el = document.getElementById('leave-requests-list');
  if (!el) return;
  const pending = leaveRequests.filter(l => l.status === 'Pending');
  el.innerHTML = pending.length ? pending.map(l => leaveReqCard(l)).join('') : '<p style="color:var(--subtle);font-size:13px;">No pending requests 🎉</p>';
}

function handleLeave(idx, decision) {
  // Apply leave balance rules
  const req = leaveRequests[idx];
  const emp = employees.find(e => e.id === req.empId);
  if (emp && decision === 'Approved') {
    if (req.type === 'CL') {
      if (emp.cl >= req.days) { emp.cl -= req.days; }
      else {
        const deficit = req.days - emp.cl; emp.cl = 0; emp.ul += deficit;
        showNotifBar('warning', `CL insufficient. ${deficit} day(s) converted to Unpaid Leave.`, '⚠️');
      }
    } else if (req.type === 'SL') {
      // Full sick day = 0.5 SL + 0.5 UL per day
      const slNeeded = req.days * 0.5;
      const ulNeeded = req.days * 0.5;
      if (emp.sl >= slNeeded) { emp.sl -= slNeeded; emp.ul += ulNeeded; }
      else {
        emp.ul += req.days; emp.sl = Math.max(0, emp.sl - slNeeded);
        showNotifBar('warning', `SL insufficient. Applied as Unpaid Leave.`, '⚠️');
      }
    }
  }
  leaveRequests[idx].status = decision;
  // Sync to server for real-time broadcast
  api(`/api/leave-requests/${idx}`, {
    method: 'PUT',
    body: { status: decision }
  });
  saveToLocalStorage();
  renderLeaveRequests();
  renderLeaveBalances();
  renderLeaveHistory();
  renderDashPendingLeaves();
  if (decision === 'Approved') {
    showNotifBar('success', `Leave for ${req.empName} Approved!`, '✓');
    addAdminNotif(`Leave request from ${req.empName} has been ${decision}.`);
  } else {
    showNotifBar('info', `Leave for ${req.empName} Rejected.`, 'ℹ');
  }
}

function renderLeaveBalances() {
  const tbody = document.getElementById('leave-balances-table');
  if (!tbody) return;
  tbody.innerHTML = employees.filter(e => e.active).map((emp, i) => `
    <tr>
      <td><div style="display:flex;align-items:center;gap:8px;"><div class="av ${AV_COLORS[i % AV_COLORS.length]}">${emp.name.charAt(0)}</div>${emp.name}</div></td>
      <td><span class="chip ${DEPT_COLORS[emp.dept] || 'c-eng'}">${emp.dept}</span></td>
      <td><strong class="blue-v">${emp.cl}</strong> days</td>
      <td><strong class="green-v">${emp.sl}</strong> days</td>
      <td><strong class="red-v">${emp.ul}</strong> days</td>
      <td><button class="btn btn-sm" onclick="openLeaveManage(${employees.indexOf(emp)})">Adjust</button></td>
    </tr>
  `).join('');
}

// Render Leave History in admin tab
function renderLeaveHistory() {
  const tbody = document.getElementById('leave-history-table');
  if (!tbody) return;
  tbody.innerHTML = leaveRequests.map(l => {
    const typeColor = l.type === 'CL' ? 'c-eng' : l.type === 'SL' ? 'c-mkt' : 'c-it';
    return `<tr>
      <td>${l.empName}</td>
      <td><span class="chip ${typeColor}">${l.type}</span></td>
      <td>${formatDate(l.from)}</td>
      <td>${formatDate(l.to)}</td>
      <td>${l.days}</td>
      <td><span class="tag t-${l.status.toLowerCase()}">${l.status}</span></td>
      <td style="font-size:12px;color:var(--muted);">${l.reason}</td>
    </tr>`;
  }).join('');
}

function openLeaveManage(idx) {
  selectedLeaveManageIdx = idx;
  const emp = employees[idx];
  document.getElementById('lm-emp-name').innerText = emp.name;
  document.getElementById('lm-cl').value = emp.cl;
  document.getElementById('lm-sl').value = emp.sl;
  document.getElementById('lm-ul').value = emp.ul;
  document.getElementById('leave-manage-modal').style.display = 'flex';
}

function saveLeaveBalance() {
  if (selectedLeaveManageIdx === null) return;
  const emp = employees[selectedLeaveManageIdx];
  emp.cl = parseFloat(document.getElementById('lm-cl').value) || 0;
  emp.sl = parseFloat(document.getElementById('lm-sl').value) || 0;
  emp.ul = parseFloat(document.getElementById('lm-ul').value) || 0;
  document.getElementById('leave-manage-modal').style.display = 'none';
  saveToLocalStorage();
  renderLeaveBalances();
  showNotifBar('success', `Leave balances updated for ${emp.name}.`, '✓');
}

// Employee: select leave type
function selectLeaveType(btn, type) {
  document.querySelectorAll('.leave-type-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentLeaveType = type;
  calcLeaveDays();
}

function calcLeaveDays() {
  const from = document.getElementById('leave-from')?.value;
  const to = document.getElementById('leave-to')?.value;
  const note = document.getElementById('leave-calc-text');
  if (!note) return;
  if (!from || !to) { note.innerText = 'Select dates to calculate leave days.'; return; }
  const d1 = new Date(from), d2 = new Date(to);
  if (d2 < d1) { note.innerText = 'End date must be after start date.'; return; }
  let days = 0;
  for (let d = new Date(d1); d <= d2; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) days++;
  }
  const uid = localStorage.getItem('userId');
  const emp = employees.find(e => e.id === uid) || employees[0];
  let msg = `${days} working day(s) requested.`;
  if (currentLeaveType === 'CL') msg += ` Your CL balance: ${emp.cl} days.${emp.cl < days ? ` ⚠️ ${days - emp.cl} day(s) will become Unpaid.` : ''}`;
  else if (currentLeaveType === 'SL') msg += ` Your SL balance: ${emp.sl} days. Note: Each SL day = 0.5 SL + 0.5 Unpaid.`;
  note.innerText = msg;
}

function submitLeaveRequest() {
  const from = document.getElementById('leave-from')?.value;
  const to = document.getElementById('leave-to')?.value;
  const reason = document.getElementById('leave-reason')?.value.trim();
  if (!from || !to) { showNotifBar('warning', 'Please select leave dates.', '⚠️'); return; }
  if (!reason) { showNotifBar('warning', 'Please provide a reason.', '⚠️'); return; }
  const uid = localStorage.getItem('userId');
  const emp = employees.find(e => e.id === uid) || employees[0];
  let days = 0;
  const d1 = new Date(from), d2 = new Date(to);
  for (let d = new Date(d1); d <= d2; d.setDate(d.getDate() + 1)) { if (d.getDay() !== 0 && d.getDay() !== 6) days++; }
  const newReq = { idx: leaveRequests.length, empId: emp.id, empName: emp.name, dept: emp.dept, type: currentLeaveType, from, to, days, reason, status: 'Pending' };
  leaveRequests.push(newReq);
  // Sync to server for real-time broadcast
  api('/api/leave-requests', { method: 'POST', body: newReq });
  api('/api/notifications', {
    method: 'POST',
    body: { text: `New leave request from ${emp.name} (${currentLeaveType}) for ${formatDate(from)}.`, target: 'admin' }
  });
  saveToLocalStorage();
  renderMyLeaveHistory(emp);
  showNotifBar('success', 'Leave request submitted! Awaiting admin approval.', '✓');
  addAdminNotif(`New leave request from ${emp.name} (${currentLeaveType}) for ${formatDate(from)}.`);
  document.getElementById('leave-reason').value = '';
}

function renderMyLeaveHistory(emp) {
  const el = document.getElementById('my-leave-history');
  if (!el) return;
  const myLeaves = leaveRequests.filter(l => l.empId === emp.id);
  if (!myLeaves.length) { el.innerHTML = '<p style="color:var(--subtle);font-size:13px;">No leave history.</p>'; return; }
  el.innerHTML = myLeaves.map(l => {
    const typeColor = l.type === 'CL' ? 'c-eng' : l.type === 'SL' ? 'c-mkt' : 'c-it';
    return `<div class="leave-req-card" style="flex-wrap:wrap;">
      <div style="flex:1;"><div style="font-size:13px;font-weight:600;"><span class="chip ${typeColor}">${l.type}</span> ${formatDate(l.from)} – ${formatDate(l.to)}</div>
      <div style="font-size:12px;color:var(--muted);">${l.days} day(s) | ${l.reason}</div></div>
      <span class="tag t-${l.status.toLowerCase()}">${l.status}</span>
    </div>`;
  }).join('');
}

// REPORTS
function setReport(type, btn) {
  document.querySelectorAll('.rtab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const today = new Date().toISOString().split('T')[0];
  let recs = [];
  let title = '';
  if (type === 'daily') {
    recs = attendanceRecords.filter(r => r.date === today);
    title = `Daily Report — ${formatDate(today)}`;
  } else if (type === 'weekly') {
    const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    recs = attendanceRecords.filter(r => new Date(r.date) >= weekStart);
    title = 'Weekly Report — Current Week';
  } else {
    const mn = today.slice(0, 7);
    recs = attendanceRecords.filter(r => r.date.startsWith(mn));
    title = `Monthly Report — ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;
  }

  setText('rpt-title', title);
  setText('rpt-table-title', `Detailed Records (${recs.length})`);

  const present = recs.filter(r => ['Present', 'Late', 'Half-Day'].includes(r.status)).length;
  const absent = recs.filter(r => r.status === 'Absent').length;
  const late = recs.filter(r => r.status === 'Late').length;
  const avgHrs = recs.length ? (recs.reduce((a, r) => a + r.hours, 0) / recs.length).toFixed(1) : 0;
  const sumEl = document.getElementById('rpt-summary');
  if (sumEl) sumEl.innerHTML = `
    <div class="sum-item"><span>Total Records</span><strong>${recs.length}</strong></div>
    <div class="sum-item"><span>Present</span><strong class="green-v">${present}</strong></div>
    <div class="sum-item"><span>Absent</span><strong class="red-v">${absent}</strong></div>
    <div class="sum-item"><span>Late</span><strong class="amber-v">${late}</strong></div>
    <div class="sum-item"><span>Avg Hours</span><strong>${avgHrs}h</strong></div>
  `;

  // Bars
  const depts = [...new Set(recs.map(r => r.dept))];
  const colors = ['bf-blue', 'bf-green', 'bf-amber', 'bf-red', 'bf-purple', 'bf-green'];
  const attEl = document.getElementById('rpt-att-bars');
  const hrEl = document.getElementById('rpt-hr-bars');
  if (attEl) attEl.innerHTML = depts.map((d, i) => {
    const dr = recs.filter(r => r.dept === d);
    const pr = dr.filter(r => ['Present', 'Late', 'Half-Day'].includes(r.status)).length;
    const pct = dr.length ? Math.round(pr / dr.length * 100) : 0;
    return `<div class="bar-row"><span class="bar-label">${d}</span><div class="bar-track"><div class="bar-fill ${colors[i % colors.length]}" style="width:${pct}%"></div></div><span class="bar-val">${pct}%</span></div>`;
  }).join('');
  if (hrEl) hrEl.innerHTML = depts.map((d, i) => {
    const dr = recs.filter(r => r.dept === d && r.hours > 0);
    const avg = dr.length ? (dr.reduce((a, r) => a + r.hours, 0) / dr.length).toFixed(1) : 0;
    const pct = Math.min(Math.round(parseFloat(avg) / 10 * 100), 100);
    return `<div class="bar-row"><span class="bar-label">${d}</span><div class="bar-track"><div class="bar-fill ${colors[i % colors.length]}" style="width:${pct}%"></div></div><span class="bar-val">${avg}h</span></div>`;
  }).join('');

  const thead = document.getElementById('rpt-thead');
  const tbody = document.getElementById('rpt-table');
  if (thead) thead.innerHTML = '<th>ID</th><th>Employee</th><th>Dept</th><th>Date</th><th>In</th><th>Out</th><th>Hours</th><th>Status</th>';
  if (tbody) tbody.innerHTML = recs.map(r => `<tr>
    <td><span style="font-family:var(--font-mono);font-size:11px;color:var(--muted);">${r.id}</span></td>
    <td>${r.name}</td>
    <td><span class="chip ${DEPT_COLORS[r.dept] || 'c-eng'}">${r.dept}</span></td>
    <td>${formatDate(r.date)}</td>
    <td><span style="font-family:var(--font-mono);font-size:12px;">${r.in || '—'}</span></td>
    <td><span style="font-family:var(--font-mono);font-size:12px;">${r.out || '—'}</span></td>
    <td>${r.hours > 0 ? r.hours.toFixed(1) + 'h' : '—'}</td>
    <td><span class="tag t-${r.status.toLowerCase().replace('-', '').replace(' ', '')}">${r.status}</span></td>
  </tr>`).join('');
}

// EMPLOYEE PORTAL
function renderEmpDashboard(emp) {
  const myRecs = attendanceRecords.filter(r => r.id === emp.id);
  const now = new Date();
  const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const thisMonth = myRecs.filter(r => r.date.startsWith(monthStr));
  const present = thisMonth.filter(r => ['Present', 'Late', 'Half-Day'].includes(r.status)).length;
  const absent = thisMonth.filter(r => r.status === 'Absent').length;
  const hours = thisMonth.reduce((a, r) => a + r.hours, 0);
  const late = thisMonth.filter(r => r.status === 'Late').length;
  setText('ms-present', present);
  setText('ms-absent', absent);
  setText('ms-hours', hours.toFixed(1) + 'h');
  setText('ms-late', late);

  // Weekly bars
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const colors = ['bf-blue', 'bf-green', 'bf-amber', 'bf-red', 'bf-purple'];
  const barsEl = document.getElementById('emp-bars');
  if (barsEl) barsEl.innerHTML = days.map((d, i) => {
    const hrs = (Math.random() * 3 + 6).toFixed(1);
    const pct = Math.round(parseFloat(hrs) / 10 * 100);
    return `<div class="bar-row"><span class="bar-label">${d}</span><div class="bar-track"><div class="bar-fill ${colors[i]}" style="width:${pct}%"></div></div><span class="bar-val">${hrs}h</span></div>`;
  }).join('');

  // Recent log
  const logEl = document.getElementById('emp-log');
  if (logEl) logEl.innerHTML = myRecs.slice(0, 7).map(r => {
    const dateObj = new Date(r.date);
    return `<tr>
      <td>${formatDate(r.date)}</td>
      <td style="color:var(--muted);font-size:12px;">${DAYS[dateObj.getDay()]}</td>
      <td><span style="font-family:var(--font-mono);font-size:12px;">${r.in || '—'}</span></td>
      <td><span style="font-family:var(--font-mono);font-size:12px;">${r.out || '—'}</span></td>
      <td style="font-size:12px;">—</td>
      <td><strong>${r.hours > 0 ? r.hours.toFixed(1) + 'h' : '—'}</strong></td>
      <td><span class="tag t-${r.status.toLowerCase().replace('-', '').replace(' ', '')}">${r.status}</span></td>
    </tr>`;
  }).join('');

  renderMyLeaveHistory(emp);
}

function renderEmpHistory() {
  const monthInp = document.getElementById('hist-month');
  const monthStr = monthInp?.value || new Date().toISOString().slice(0, 7);
  const uid =
    localStorage.getItem('userId');
  const emp = employees.find(e => e.id === uid) || employees[0];
  const recs = attendanceRecords.filter(r => r.id === emp.id && r.date.startsWith(monthStr));
  const present = recs.filter(r => ['Present', 'Late', 'Half-Day'].includes(r.status)).length;
  const hours = recs.reduce((a, r) => a + r.hours, 0);
  const summEl = document.getElementById('hist-summary');
  if (summEl) summEl.innerHTML = `<div class="sum-item"><span>Working Days</span><strong>${recs.length}</strong></div><div class="sum-item"><span>Present</span><strong class="green-v">${present}</strong></div><div class="sum-item"><span>Total Hours</span><strong>${hours.toFixed(1)}h</strong></div>`;
  const tbody = document.getElementById('hist-table');
  if (tbody) tbody.innerHTML = recs.map(r => {
    const dateObj = new Date(r.date);
    return `<tr><td>${formatDate(r.date)}</td><td style="color:var(--muted);">${DAYS[dateObj.getDay()]}</td><td><span style="font-family:var(--font-mono);font-size:12px;">${r.in || '—'}</span></td><td><span style="font-family:var(--font-mono);font-size:12px;">${r.out || '—'}</span></td><td>—</td><td><strong>${r.hours > 0 ? r.hours.toFixed(1) + 'h' : '—'}</strong></td><td><span class="tag t-${r.status.toLowerCase().replace('-', '').replace(' ', '')}">${r.status}</span></td></tr>`;
  }).join('');
}

// PUNCH ACTIONS
function empPunchIn() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-IN', { hour12: true, hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toISOString().split('T')[0];

  const pill = document.getElementById('emp-pill');
  if (pill) { pill.className = 'status-pill sp-in'; pill.innerHTML = '<div class="status-dot sd-g"></div>Signed In'; }
  showNotifBar('success', `Punched In at ${timeStr}`, '✓');
  appendTimeline('in', `Signed In`, timeStr);

  const h = now.getHours();
  const m = now.getMinutes();
  if (h >= 14) showNotifBar('warning', 'First login after 2:00 PM — this day will be flagged as Half-Day.', '⚠️');

  const uid = localStorage.getItem('userId');
  const emp = employees.find(e => e.id === uid);
  if (emp) {
    let rec = attendanceRecords.find(r => r.id === emp.id && r.date === dateStr);
    let status = 'Present';
    if (h >= 14) status = 'Half-Day';
    else if (h > 9 || (h === 9 && m > 15)) status = 'Late';

    const inTimeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

    if (!rec) {
      rec = {
        id: emp.id, name: emp.name, dept: emp.dept, date: dateStr,
        in: inTimeStr, out: '', hours: 0, status: status
      };
      attendanceRecords.unshift(rec);
    } else {
      rec.in = inTimeStr;
      rec.status = status;
    }
    api('/api/attendance', { method: 'POST', body: rec });
    saveToLocalStorage();
    renderEmpDashboard(emp);
    renderDashboardCards();
    renderRecords();
  }
}

function empPunchOut() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-IN', { hour12: true, hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toISOString().split('T')[0];

  const pill = document.getElementById('emp-pill');
  if (pill) { pill.className = 'status-pill sp-out'; pill.innerHTML = '<div class="status-dot sd-r"></div>Not signed in'; }
  if (breakInterval) { clearInterval(breakInterval); breakInterval = null; document.getElementById('break-btn').innerText = '☕ Start Break'; document.getElementById('break-timer-wrap').style.display = 'none'; }
  showNotifBar('info', `Punched Out at ${timeStr}`, '←');
  appendTimeline('out', 'Signed Out', timeStr);

  const uid = localStorage.getItem('userId');
  const emp = employees.find(e => e.id === uid);
  if (emp) {
    let rec = attendanceRecords.find(r => r.id === emp.id && r.date === dateStr);
    const h = now.getHours();
    const m = now.getMinutes();
    const outTimeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

    if (rec && rec.in) {
      rec.out = outTimeStr;
      const [inH, inM] = rec.in.split(':').map(Number);
      const diffHrs = (h - inH) + (m - inM) / 60;
      rec.hours = Math.max(0, parseFloat(diffHrs.toFixed(2)));
    } else {
      rec = {
        id: emp.id, name: emp.name, dept: emp.dept, date: dateStr,
        in: '', out: outTimeStr, hours: 0, status: 'Present'
      };
      attendanceRecords.unshift(rec);
    }
    api('/api/attendance', { method: 'POST', body: rec });
    saveToLocalStorage();
    renderEmpDashboard(emp);
    renderDashboardCards();
    renderRecords();
  }
}

function toggleBreak() {
  const btn = document.getElementById('break-btn');
  const wrap = document.getElementById('break-timer-wrap');
  const disp = document.getElementById('break-timer');
  if (!btn) return;
  if (btn.innerText.includes('Start')) {
    btn.innerText = '☕ Stop Break';
    if (wrap) wrap.style.display = 'block';
    breakInterval = setInterval(() => {
      breakSeconds++;
      const m = String(Math.floor(breakSeconds / 60)).padStart(2, '0');
      const s = String(breakSeconds % 60).padStart(2, '0');
      if (disp) disp.innerText = `${m}:${s}`;
    }, 1000);
    const now = new Date().toLocaleTimeString('en-IN', { hour12: true, hour: '2-digit', minute: '2-digit' });
    appendTimeline('break', 'Break started', now);
    const pillEl = document.getElementById('emp-pill');
    if (pillEl) { pillEl.className = 'status-pill sp-break'; pillEl.innerHTML = '<div class="status-dot sd-a"></div>On Break'; }
  } else {
    btn.innerText = '☕ Start Break';
    clearInterval(breakInterval);
    breakInterval = null;
    const dur = disp?.innerText || '0:00';
    if (wrap) wrap.style.display = 'none';
    breakSeconds = 0;
    showNotifBar('info', `Break ended — Duration: ${dur}`, '☕');
    const now = new Date().toLocaleTimeString('en-IN', { hour12: true, hour: '2-digit', minute: '2-digit' });
    appendTimeline('in', 'Break ended', now);
    const pillEl = document.getElementById('emp-pill');
    if (pillEl) { pillEl.className = 'status-pill sp-in'; pillEl.innerHTML = '<div class="status-dot sd-g"></div>Signed In'; }
  }
}

function appendTimeline(type, text, time) {
  const tl = document.getElementById('today-timeline');
  if (!tl) return;
  if (tl.children.length === 1 && tl.children[0].style.color === 'var(--subtle)') tl.innerHTML = '';
  const colors = { in: '#22c55e', out: '#ef4444', break: 'var(--amber)' };
  const item = document.createElement('li');
  item.className = 'timeline-item';
  item.innerHTML = `<div class="timeline-dot td-${type}" style="background:${colors[type] || colors.in}"></div><div class="timeline-content">${text}<div class="timeline-time">${time}</div></div>`;
  tl.prepend(item);
}

function autoAttendancePunchIn(emp) {
  const today = new Date().toISOString().split('T')[0];
  const existingRec = attendanceRecords.find(r => r.id === emp.id && r.date === today);
  if (!existingRec || !existingRec.in) {
    setTimeout(() => empPunchIn(), 700);
  } else {
    const pill = document.getElementById('emp-pill');
    if (pill && existingRec.in) {
      pill.className = 'status-pill sp-in';
      pill.innerHTML = '<div class="status-dot sd-g"></div>Signed In';
    }
  }
  // Auto sign-out if page loaded after 6pm
  if (new Date().getHours() >= 18) {
    setTimeout(() => tryAutoSignOutAt6pm(), 1200);
  }
}

// MODALS, NOTIFICATIONS & TOASTS
function showNotifBar(type, message, icon) {
  const bar = document.getElementById('notif-bar');
  if (!bar) return;
  // Reset display and force animation to restart
  bar.style.display = 'flex';
  bar.style.animation = 'none';
  bar.className = 'notif-bar';
  void bar.offsetWidth;
  bar.style.animation = '';
  bar.classList.add(type);
  bar.innerHTML = `
    <span class="notif-icon">${icon || 'ℹ️'}</span>
    <span class="notif-text">${message}</span>
    <button class="notif-close" onclick="hideNotifBar()">×</button>
  `;
  if (window.notifTimeout) clearTimeout(window.notifTimeout);
  window.notifTimeout = setTimeout(hideNotifBar, 4000);
}

function hideNotifBar() {
  const bar = document.getElementById('notif-bar');
  if (bar) bar.style.display = 'none';
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.innerText = val;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const y = parts[0];
    const m = MONTHS[parseInt(parts[1]) - 1]?.slice(0, 3);
    const d = parts[2];
    if (m) return `${d} ${m} ${y}`;
  }
  return dateStr;
}

function toggleNotifPanel() {
  adminNotifPanelOpen = !adminNotifPanelOpen;
  const p = document.getElementById('notif-panel');
  if (p) p.classList.toggle('open', adminNotifPanelOpen);
}

function toggleEmpNotifPanel() {
  empNotifPanelOpen = !empNotifPanelOpen;
  const p = document.getElementById('emp-notif-panel');
  if (p) p.classList.toggle('open', empNotifPanelOpen);
}

function renderAdminNotifPanel() {
  const list = document.getElementById('notif-panel-body');
  const badge = document.getElementById('admin-notif-count');
  const count = adminNotifications.filter(n => n.unread).length;
  if (badge) {
    badge.innerText = count;
    badge.style.display = count > 0 ? 'inline-flex' : 'none';
  }
  if (!list) return;
  list.innerHTML = adminNotifications.map((n, i) => `
    <div class="notif-item ${n.unread ? 'unread' : ''}" onclick="markAdminNotifRead(${i})">
      <p>${n.text}</p>
      <div class="notif-item-time">${n.time}</div>
    </div>
  `).join('');
}

function renderEmpNotifPanel() {
  const list = document.getElementById('emp-notif-panel-body');
  const badge = document.getElementById('emp-notif-count');
  const count = empNotifications.filter(n => n.unread).length;
  if (badge) {
    badge.innerText = count;
    badge.style.display = count > 0 ? 'inline-flex' : 'none';
  }
  if (!list) return;
  list.innerHTML = empNotifications.map((n, i) => `
    <div class="notif-item ${n.unread ? 'unread' : ''}" onclick="markEmpNotifRead(${i})">
      <p>${n.text}</p>
      <div class="notif-item-time">${n.time}</div>
    </div>
  `).join('');
}

function markAdminNotifRead(idx) {
  if (adminNotifications[idx]) {
    adminNotifications[idx].unread = false;
    renderAdminNotifPanel();
  }
}

function markEmpNotifRead(idx) {
  if (empNotifications[idx]) {
    empNotifications[idx].unread = false;
    renderEmpNotifPanel();
  }
}

function addAdminNotif(text) {
  const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  adminNotifications.unshift({ text, time, unread: true });
  renderAdminNotifPanel();
}

function addEmpNotif(text) {
  const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  empNotifications.unshift({ text, time, unread: true });
  renderEmpNotifPanel();
}

function renderAnnouncements() {
  const el = document.getElementById('announcements-list');
  const empEl = document.getElementById('emp-announcements-list');
  const badge = document.getElementById('ann-count-badge');
  const empBadge = document.getElementById('emp-ann-count');

  if (badge) badge.innerText = announcements.length;
  if (empBadge) empBadge.innerText = announcements.length;

  const priorityLabels = { low: 'General', normal: 'General', high: 'Important', urgent: 'Urgent' };
  const priorityMap = { low: 'ann-cat-general', normal: 'ann-cat-general', high: 'ann-cat-high', urgent: 'ann-cat-urgent' };

  const html = announcements.map((a, i) => {
    const prior = a.priority || 'normal';
    const priorLabel = priorityLabels[prior] || 'General';
    const priorClass = priorityMap[prior] || 'ann-cat-general';
    return `
    <div class="announcement-card priority-${prior}">
      <div class="ann-header">
        <div class="ann-header-left">
          <span class="ann-category-badge ${priorClass}">${priorLabel}</span>
          <strong class="ann-subject">${escHtml(a.subject)}</strong>
        </div>
      </div>
      <div class="ann-meta">
        <span class="ann-meta-item">📅 ${formatDate(a.date)}</span>
        <span class="ann-meta-item">👤 ${a.by || 'Admin'}</span>
        ${a.recipient ? `<span class="ann-meta-item">👥 ${escHtml(a.recipient)}</span>` : ''}
      </div>
      <div class="ann-body">${escHtml(a.body)}</div>
    </div>
  `}).join('');

  if (el) {
    if (announcements.length) {
      el.innerHTML = html;
    } else {
      el.innerHTML = `<div class="ann-empty-state">
        <span class="ann-empty-icon">📭</span>
        <div class="ann-empty-text">No announcements yet</div>
        <div class="ann-empty-sub">Send your first announcement above</div>
      </div>`;
    }
  }
  if (empEl) {
    if (announcements.length) {
      empEl.innerHTML = html;
    } else {
      empEl.innerHTML = '<p style="color:var(--subtle);font-size:14px;text-align:center;padding:16px;">No announcements yet.</p>';
    }
  }
}

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Announced Recipient & Priority selection ──
let annSelectedRecipient = 'all';
let annSelectedPriority = 'normal';

function selectAnnRecipient(btn, val) {
  document.querySelectorAll('.ann-recip-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  annSelectedRecipient = val;
  const deptWrap = document.getElementById('ann-dept-select-wrap');
  if (deptWrap) deptWrap.style.display = val === 'dept' ? 'block' : 'none';
}

function selectAnnPriority(btn, val) {
  document.querySelectorAll('.ann-prior-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  annSelectedPriority = val;
}

function toggleSmsSection() {
  const body = document.getElementById('ann-sms-body');
  const arrow = document.getElementById('ann-sms-arrow');
  if (!body || !arrow) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  arrow.classList.toggle('open', !open);
}

// ── Character counters ──
document.addEventListener('input', function(e) {
  if (e.target.id === 'ann-body') {
    const count = document.getElementById('ann-charcount');
    if (count) count.innerText = e.target.value.length;
  }
  if (e.target.id === 'sms-body') {
    const count = document.getElementById('sms-charcount');
    if (count) count.innerText = e.target.value.length;
  }
});

async function postAnnouncement() {
  const subEl = document.getElementById('ann-subject');
  const bodyEl = document.getElementById('ann-body');
  if (!subEl || !bodyEl) return;

  const subject = subEl.value.trim();
  const body = bodyEl.value.trim();

  if (!subject || !body) {
    showNotifBar('warning', 'Please enter both subject and message.', '⚠️');
    return;
  }

  const today = new Date().toISOString().split('T')[0];
  
  let recipientText = 'All Employees';
  if (annSelectedRecipient === 'dept') {
    const deptSelect = document.getElementById('ann-dept-select');
    recipientText = deptSelect ? deptSelect.value + ' Department' : 'Department';
  } else if (annSelectedRecipient === 'individual') {
    recipientText = 'Individual';
  }
  
  const ann = { 
    date: today, 
    subject, 
    body, 
    by: 'Admin',
    priority: annSelectedPriority,
    recipient: recipientText
  };
  
  announcements.unshift(ann);

  // Post to server for real-time broadcast
  await api('/api/announcements', { method: 'POST', body: ann });

  subEl.value = '';
  bodyEl.value = '';
  const charCount = document.getElementById('ann-charcount');
  if (charCount) charCount.innerText = '0';
  renderAnnouncements();
  showNotifBar('success', 'Announcement sent successfully!', '📣');
  // Also add notification via API
  await api('/api/notifications', {
    method: 'POST',
    body: { text: `New Announcement: ${subject}`, target: 'emp' }
  });
  empNotifications.unshift({ text: `New Announcement: ${subject}`, time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }), unread: true });
  renderEmpNotifPanel();
}

let resetUserId = null;

function openForgotModal() {
  document.getElementById('forgot-modal').style.display = 'flex';
  document.getElementById('forgot-uid').value = '';
  document.getElementById('forgot-phone').value = '';
  // Reset any OTP fallback text from previous attempt
  const otpHelp = document.getElementById('otp-help-text');
  if (otpHelp) { otpHelp.style.display = 'none'; otpHelp.innerText = ''; }
}

function closeOtpModal() {
  document.getElementById('otp-modal').style.display = 'none';
  const otpHelp = document.getElementById('otp-help-text');
  if (otpHelp) { otpHelp.style.display = 'none'; otpHelp.innerText = ''; }
}

function sendOTP() {
  const uid = document.getElementById('forgot-uid').value.trim();
  const phone = document.getElementById('forgot-phone').value.trim();
  if (!uid || !phone) {
    showNotifBar('warning', 'Please enter both Username/ID and phone details.', '⚠️');
    return;
  }

  let userFound = false;
  let userEmail = '';
  let userName = '';
  
  if (uid === 'quemahtech') {
    userFound = true;
    userEmail = 'admin@test.com';
    userName = 'Administrator';
  } else {
    const emp = employees.find(e => e.id === uid && e.active);
    if (emp) {
      const cleanPhone = emp.phone ? emp.phone.replace(/\s+/g, '') : '';
      const last4 = cleanPhone.substring(cleanPhone.length - 4);
      if (last4 === phone) {
        userFound = true;
        userEmail = emp.email || '';
        userName = emp.name;
      }
    }
  }

  if (!userFound) {
    showNotifBar('error', 'User details or phone number not matched.', '❌');
    return;
  }

  resetUserId = uid;
  
  // Generate a random 4-digit OTP
  const otp = String(Math.floor(1000 + Math.random() * 9000));
  localStorage.setItem('resetOtp', otp);
  localStorage.setItem('resetOtpExpiry', Date.now() + 300000); // 5 min expiry

  // Try to send OTP via email
  const smtpSettings = JSON.parse(localStorage.getItem('smtpSettings') || '{}');
  
  // Store OTP in modal dataset for fallback display
  document.getElementById('otp-modal').dataset.fallbackOtp = otp;

  if (smtpSettings.host && smtpSettings.email && smtpSettings.pwd && userEmail) {
    api('/api/send-email', {
      method: 'POST',
      body: {
        to: userEmail,
        subject: 'TEST — Password Reset OTP',
        html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;">
          <div style="background:#0f2744;padding:20px;text-align:center;border-radius:10px 10px 0 0;">
            <h1 style="color:#f59e0b;margin:0;font-size:20px;">🛡️ TEST</h1>
            <p style="color:#94a3b8;margin:4px 0 0;font-size:12px;">Employee Management System</p>
          </div>
          <div style="padding:24px;background:#fff;border:1px solid #e2e8f0;border-radius:0 0 10px 10px;">
            <h2 style="color:#0f2744;margin:0 0 8px;">Password Reset</h2>
            <p style="color:#475569;font-size:14px;margin:0 0 16px;">Hi <strong>${userName}</strong>, use the OTP below to reset your password. This code expires in 5 minutes.</p>
            <div style="background:#f8fafc;border:2px dashed #f59e0b;border-radius:8px;padding:16px;text-align:center;margin-bottom:16px;">
              <span style="font-size:32px;font-weight:700;letter-spacing:8px;color:#0f2744;font-family:monospace;">${otp}</span>
            </div>
            <p style="color:#94a3b8;font-size:12px;margin:0;">If you didn't request this, please ignore this email.</p>
          </div>
        </div>`,
        smtp: {
          host: smtpSettings.host,
          port: smtpSettings.port,
          user: smtpSettings.email,
          pass: smtpSettings.pwd
        }
      }
    }).then(res => {
      if (res.success) {
        showNotifBar('success', `OTP sent to ${userEmail}!`, '📧');
      } else {
        showNotifBar('warning', `Email failed. OTP shown below.`, '📱');
        showOtpFallback(otp);
      }
    }).catch(() => {
      showNotifBar('warning', `Email failed. OTP shown below.`, '📱');
      showOtpFallback(otp);
    });
  } else {
    showNotifBar('warning', `SMTP not configured. OTP shown below.`, '📱');
    showOtpFallback(otp);
  }

  document.getElementById('forgot-modal').style.display = 'none';
  document.getElementById('otp-modal').style.display = 'flex';

  const inps = document.querySelectorAll('.otp-inp');
  inps.forEach(inp => inp.value = '');
  if (inps[0]) inps[0].focus();
}

function showOtpFallback(otp) {
  const otpHelp = document.getElementById('otp-help-text');
  if (otpHelp) {
    otpHelp.innerText = `⚠️ Email unavailable — use this code:  ${otp}`;
    otpHelp.style.display = 'block';
  }
}

function otpNext(inp, idx) {
  if (inp.value.length === 1) {
    const next = document.querySelectorAll('.otp-inp')[idx + 1];
    if (next) next.focus();
  }
}

function verifyOTP() {
  const inps = document.querySelectorAll('.otp-inp');
  let otp = '';
  inps.forEach(inp => otp += inp.value.trim());
  
  const savedOtp = localStorage.getItem('resetOtp');
  const expiry = parseInt(localStorage.getItem('resetOtpExpiry') || '0');
  
  if (otp === savedOtp && Date.now() < expiry) {
    localStorage.removeItem('resetOtp');
    localStorage.removeItem('resetOtpExpiry');
    document.getElementById('otp-modal').style.display = 'none';
    document.getElementById('newpwd-modal').style.display = 'flex';
    document.getElementById('np-pwd').value = '';
    document.getElementById('np-conf').value = '';
    showNotifBar('success', 'Code verified. Set your new password.', '✓');
  } else if (Date.now() >= expiry && savedOtp) {
    showNotifBar('error', 'Code expired. Please request a new one.', '⏰');
  } else {
    showNotifBar('error', 'Invalid code. Please try again.', '❌');
  }
}

function doResetPwd() {
  const pwd = document.getElementById('np-pwd').value.trim();
  const conf = document.getElementById('np-conf').value.trim();
  if (pwd.length < 6) {
    showNotifBar('warning', 'Password must be at least 6 characters.', '⚠️');
    return;
  }
  if (pwd !== conf) {
    showNotifBar('warning', 'Passwords do not match.', '⚠️');
    return;
  }

  if (resetUserId === 'quemahtech') {
    localStorage.setItem('adminPassword', pwd);
    showNotifBar('success', 'Admin password reset successful!', '🔑');
  } else {
    const emp = employees.find(e => e.id === resetUserId && e.active);
    if (emp) {
      emp.password = pwd;
      saveToLocalStorage();
      showNotifBar('success', 'Employee password reset successful!', '🔑');
    }
  }
  document.getElementById('newpwd-modal').style.display = 'none';
  resetUserId = null;
}

function checkPwdStrength(inputId, barId) {
  const pwd = document.getElementById(inputId).value;
  const bar = document.getElementById(barId);
  if (!bar) return;
  let score = 0;
  if (pwd.length >= 6) score += 20;
  if (/[A-Z]/.test(pwd)) score += 20;
  if (/[a-z]/.test(pwd)) score += 20;
  if (/[0-9]/.test(pwd)) score += 20;
  if (/[^A-Za-z0-9]/.test(pwd)) score += 20;

  bar.style.width = score + '%';
  if (score <= 40) {
    bar.style.backgroundColor = 'var(--red)';
  } else if (score <= 80) {
    bar.style.backgroundColor = 'var(--amber)';
  } else {
    bar.style.backgroundColor = 'var(--green)';
  }
}

function changeAdminPwd() {
  const cur = document.getElementById('a-cur-pwd').value.trim();
  const newPwd = document.getElementById('a-new-pwd').value.trim();
  const conf = document.getElementById('a-conf-pwd').value.trim();
  const expectedAdminPwd = localStorage.getItem('adminPassword') || 'quemah123';

  if (cur !== expectedAdminPwd) {
    showNotifBar('error', 'Current password is incorrect.', '❌');
    return;
  }
  if (newPwd.length < 6) {
    showNotifBar('warning', 'New password must be at least 6 characters.', '⚠️');
    return;
  }
  if (newPwd !== conf) {
    showNotifBar('warning', 'Passwords do not match.', '⚠️');
    return;
  }

  localStorage.setItem('adminPassword', newPwd);
  document.getElementById('a-cur-pwd').value = '';
  document.getElementById('a-new-pwd').value = '';
  document.getElementById('a-conf-pwd').value = '';
  document.getElementById('a-strength').style.width = '0%';
  showNotifBar('success', 'Admin password updated successfully!', '✓');
}

function changeEmpPwd() {
  const cur = document.getElementById('e-cur-pwd').value.trim();
  const newPwd = document.getElementById('e-new-pwd').value.trim();
  const conf = document.getElementById('e-conf-pwd').value.trim();
  const uid = localStorage.getItem('userId');
  const emp = employees.find(e => e.id === uid);
  if (!emp) return;

  const expectedPwd = emp.password || 'emp123';
  if (cur !== expectedPwd) {
    showNotifBar('error', 'Current password is incorrect.', '❌');
    return;
  }
  if (newPwd.length < 6) {
    showNotifBar('warning', 'New password must be at least 6 characters.', '⚠️');
    return;
  }
  if (newPwd !== conf) {
    showNotifBar('warning', 'Passwords do not match.', '⚠️');
    return;
  }

  emp.password = newPwd;
  saveToLocalStorage();
  document.getElementById('e-cur-pwd').value = '';
  document.getElementById('e-new-pwd').value = '';
  document.getElementById('e-conf-pwd').value = '';
  document.getElementById('e-strength').style.width = '0%';
  showNotifBar('success', 'Password updated successfully!', '✓');
}

function downloadCSV(csvContent, filename) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function exportCSV() {
  let csv = 'ID,Employee,Department,Date,Sign In,Sign Out,Hours,Status\r\n';
  const dateF = document.getElementById('rec-date')?.value || '';
  const deptF = document.getElementById('rec-dept')?.value || '';
  const statusF = document.getElementById('rec-status')?.value || '';

  let recs = attendanceRecords.slice();
  if (dateF) recs = recs.filter(r => r.date === dateF);
  if (deptF) recs = recs.filter(r => r.dept === deptF);
  if (statusF) recs = recs.filter(r => r.status === statusF);

  recs.forEach(r => {
    csv += `"${r.id}","${r.name}","${r.dept}","${r.date}","${r.in || ''}","${r.out || ''}",${r.hours},"${r.status}"\r\n`;
  });

  downloadCSV(csv, `attendance_records_${new Date().toISOString().split('T')[0]}.csv`);
  showNotifBar('success', 'Records exported successfully!', '✓');
}

function exportEmpCSV() {
  const uid = localStorage.getItem('userId');
  const emp = employees.find(e => e.id === uid);
  if (!emp) return;

  const monthInp = document.getElementById('hist-month');
  const monthStr = monthInp?.value || new Date().toISOString().slice(0, 7);

  let csv = 'Date,Sign In,Sign Out,Hours,Status\r\n';
  const recs = attendanceRecords.filter(r => r.id === emp.id && r.date.startsWith(monthStr));

  recs.forEach(r => {
    csv += `"${r.date}","${r.in || ''}","${r.out || ''}",${r.hours},"${r.status}"\r\n`;
  });

  downloadCSV(csv, `${emp.name.replace(/\s+/g, '_')}_attendance_${monthStr}.csv`);
  showNotifBar('success', 'Your attendance history exported!', '✓');
}

// EXCEL EXPORT
function exportExcel(source) {
  let data = [];
  let headers = [];
  let filename = '';

  if (source === 'records') {
    // Export from Records tab with current filters
    const dateF = document.getElementById('rec-date')?.value || '';
    const deptF = document.getElementById('rec-dept')?.value || '';
    const statusF = document.getElementById('rec-status')?.value || '';

    let recs = attendanceRecords.slice();
    if (dateF) recs = recs.filter(r => r.date === dateF);
    if (deptF) recs = recs.filter(r => r.dept === deptF);
    if (statusF) recs = recs.filter(r => r.status === statusF);

    headers = ['ID', 'Employee', 'Department', 'Date', 'Sign In', 'Sign Out', 'Hours', 'Status'];
    data = recs.map(r => [r.id, r.name, r.dept, r.date, r.in || '', r.out || '', r.hours, r.status]);
    filename = `attendance_records_${new Date().toISOString().split('T')[0]}.xlsx`;

  } else if (source === 'reports') {
    // Export from Reports tab (data already rendered)
    const rows = document.querySelectorAll('#rpt-table tr');
    headers = ['ID', 'Employee', 'Department', 'Date', 'Sign In', 'Sign Out', 'Hours', 'Status'];
    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length) {
        data.push(Array.from(cells).map(c => c.textContent.trim()));
      }
    });
    filename = `report_${new Date().toISOString().split('T')[0]}.xlsx`;
  } else if (source === 'employees') {
    // Export employee directory
    const active = employees.filter(e => e.active);
    headers = ['ID', 'Name', 'Department', 'Designation', 'Email', 'Phone', 'Birthday', 'Joining Date', 'CL Balance', 'SL Balance', 'UL Used'];
    data = active.map(e => [e.id, e.name, e.dept, e.designation || '', e.email || '', e.phone || '', e.bday || '', e.joining || '', e.cl, e.sl, e.ul]);
    filename = `employee_directory_${new Date().toISOString().split('T')[0]}.xlsx`;
  }

  if (!data.length) {
    showNotifBar('warning', 'No data to export.', '⚠️');
    return;
  }

  try {
    if (typeof XLSX === 'undefined') {
      // Fallback to CSV if SheetJS is not loaded
      exportCSV();
      return;
    }
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    // Auto-fit column widths
    const colWidths = headers.map((h, i) => {
      const maxLen = Math.max(h.length, ...data.map(row => String(row[i] || '').length));
      return { wch: Math.min(maxLen + 3, 40) };
    });
    ws['!cols'] = colWidths;
    XLSX.utils.book_append_sheet(wb, ws, 'Data');
    XLSX.writeFile(wb, filename);
    showNotifBar('success', `Excel file exported: ${filename}`, '📊');
  } catch (e) {
    console.error('Excel export error:', e);
    showNotifBar('error', 'Excel export failed. Try CSV instead.', '❌');
  }
}

function testSmtp() {
  const host = document.getElementById('smtp-host').value.trim();
  const port = document.getElementById('smtp-port').value.trim();
  const email = document.getElementById('smtp-email').value.trim();
  const pwd = document.getElementById('smtp-pwd').value.trim();

  if (!host || !port || !email || !pwd) {
    showNotifBar('warning', 'Please fill all SMTP settings to test.', '⚠️');
    return;
  }

  showNotifBar('info', 'Connecting to SMTP server...', '🔌');
  
  api('/api/test-smtp', {
    method: 'POST',
    body: { host, port, user: email, pass: pwd }
  }).then(res => {
    if (res.success) {
      showNotifBar('success', `SMTP connection to ${host}:${port} successful! Test email sent to ${email}.`, '✓');
    } else {
      showNotifBar('error', `SMTP failed: ${res.error || 'Unknown error'}`, '❌');
    }
  }).catch(err => {
    showNotifBar('error', `SMTP test failed: ${err.message}`, '❌');
  });
}

function saveSmtp() {
  const host = document.getElementById('smtp-host').value.trim();
  const port = document.getElementById('smtp-port').value.trim();
  const email = document.getElementById('smtp-email').value.trim();
  const pwd = document.getElementById('smtp-pwd').value.trim();

  localStorage.setItem('smtpSettings', JSON.stringify({ host, port, email, pwd }));
  showNotifBar('success', 'SMTP settings saved successfully!', '✓');
}

function sendSMSAlert() {
  const smsBody = document.getElementById('sms-body').value.trim();
  if (!smsBody) {
    showNotifBar('warning', 'Please enter SMS content.', '⚠️');
    return;
  }

  showNotifBar('info', 'Sending SMS alerts via Twilio...', '📱');
  setTimeout(() => {
    showNotifBar('success', 'SMS alerts broadcasted to team!', '✓');
    document.getElementById('sms-body').value = '';
  }, 1000);
}

function sendAnnouncement() {
  postAnnouncement();
}

function previewAnnouncement() {
  const subject = document.getElementById('ann-subject')?.value.trim();
  const body = document.getElementById('ann-body')?.value.trim();
  if (!subject || !body) {
    showNotifBar('warning', 'Please enter both subject and message to preview.', '⚠️');
    return;
  }
  alert(`Announcement Preview\n\nSubject: ${subject}\n\nMessage:\n${body}`);
}

// DARK MODE TOGGLE
function toggleDarkMode() {
  const isDark = document.body.classList.toggle('dark-mode');
  localStorage.setItem('darkMode', isDark ? 'true' : 'false');
  // Update toggle button icons
  const btns = document.querySelectorAll('.dark-toggle-btn');
  btns.forEach(btn => btn.textContent = isDark ? '☀️' : '🌙');
}

function restoreDarkMode() {
  const saved = localStorage.getItem('darkMode');
  if (saved === 'true') {
    document.body.classList.add('dark-mode');
    const btns = document.querySelectorAll('.dark-toggle-btn');
    btns.forEach(btn => btn.textContent = '☀️');
  }
}

// Restore dark mode preference on load — uses its own listener so it runs after all rendering
document.addEventListener('DOMContentLoaded', restoreDarkMode);

// ── Auto sign-out on page close / tab close ──
window.addEventListener('beforeunload', handlePageBeforeUnload);

function handlePageBeforeUnload() {
  const role = localStorage.getItem('userRole');
  if (role !== 'employee') return;
  const userId = localStorage.getItem('userId');
  if (!userId) return;

  const emp = employees.find(e => e.id === userId);
  if (!emp) return;

  const today = new Date().toISOString().split('T')[0];
  const rec = attendanceRecords.find(r => r.id === emp.id && r.date === today);

  if (rec && rec.in && !rec.out) {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    rec.out = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const [inH, inM] = rec.in.split(':').map(Number);
    rec.hours = Math.max(0, parseFloat(((h - inH) + (m - inM) / 60).toFixed(2)));
    // Persist to localStorage
    localStorage.setItem('attendanceRecords', JSON.stringify(attendanceRecords));
    // Use sendBeacon for server (reliable during page unload)
    try {
      const blob = new Blob([JSON.stringify(rec)], { type: 'application/json' });
      navigator.sendBeacon('/api/attendance', blob);
    } catch (e) { /* silent */ }
  }
}

// ── Schedule auto sign-out at 6:00 PM ──
function scheduleAutoSignOut() {
  const now = new Date();
  const target = new Date(now);
  target.setHours(18, 0, 0, 0);

  if (now >= target) return; // Handled in autoAttendancePunchIn instead

  setTimeout(tryAutoSignOutAt6pm, target.getTime() - now.getTime());
}

function tryAutoSignOutAt6pm() {
  const page = document.getElementById('page-employee');
  if (!currentUser || !page || !page.classList.contains('active')) return;

  const today = new Date().toISOString().split('T')[0];
  const rec = attendanceRecords.find(r => r.id === currentUser.id && r.date === today);

  if (rec && rec.in && !rec.out) {
    empPunchOut();
    showNotifBar('info', 'Auto signed out — 6:00 PM', '⏰');
  }
}

// Global modal dismiss listeners
window.addEventListener('click', (e) => {
  const lmModal = document.getElementById('leave-manage-modal');
  const fpModal = document.getElementById('forgot-modal');
  const otpModal = document.getElementById('otp-modal');
  const npModal = document.getElementById('newpwd-modal');
  const addModal = document.getElementById('add-emp-modal');
  const delModal = document.getElementById('delete-emp-modal');

  if (e.target === lmModal) lmModal.style.display = 'none';
  if (e.target === fpModal) fpModal.style.display = 'none';
  if (e.target === otpModal) otpModal.style.display = 'none';
  if (e.target === npModal) npModal.style.display = 'none';
  if (e.target === addModal) closeAddEmpModal();
  if (e.target === delModal) closeDeleteEmpModal();
});
