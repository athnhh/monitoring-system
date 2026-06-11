/* ═══════════════════════════════════
   SCRIPT.JS — Quemahtech Employee Management System
   Consolidated from shared.js, login.js, admin.js, employee.js
═══════════════════════════════════ */

/* ═══════════════════════════════════
   SHARED JS — Global state, utilities, API, notifications, exports
═══════════════════════════════════ */

// ── Global State ──
let currentUser = null;
let currentRole = 'admin';
let currentLeaveType = 'CL';
let archivedVisible = false;
let adminNotifPanelOpen = false;
let empNotifPanelOpen = false;
let breakInterval = null;
let breakSeconds = 0;
let selectedLeaveManageIdx = null;
let deleteTargetId = null;
let resetUserId = null;
let annSelectedRecipient = 'all';
let annSelectedPriority = 'normal';
let serverAvailable = false;

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
let ws = null;

const API_BASE = '';

// ── Data Persistence (Firestore + local cache + server fallback) ──
const DATA_KEY = 'ems_data';
const SESSION_KEY = 'ems_session';
let saveDebounceTimer = null;
let adminPassword = 'quemah123';

function getStateObject() {
  return {
    adminPassword,
    employees,
    archivedEmployees,
    attendanceRecords,
    leaveRequests,
    announcements,
    adminNotifications,
    empNotifications,
    departments
  };
}

function applyStateData(data) {
  if (!data) return;
  if (data.adminPassword) adminPassword = data.adminPassword;
  if (data.employees) employees = data.employees;
  if (data.archivedEmployees) archivedEmployees = data.archivedEmployees;
  if (data.attendanceRecords) attendanceRecords = data.attendanceRecords;
  if (data.leaveRequests) leaveRequests = data.leaveRequests;
  if (data.announcements) announcements = data.announcements;
  if (data.adminNotifications) adminNotifications = data.adminNotifications;
  if (data.empNotifications) empNotifications = data.empNotifications;
  if (data.departments && data.departments.length) departments = data.departments;
}

function saveToLocalCache() {
  try {
    localStorage.setItem(DATA_KEY, JSON.stringify(getStateObject()));
  } catch (e) {
    console.error('localStorage save error:', e.message);
  }
}

function loadFromLocalCache() {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    if (raw) {
      applyStateData(JSON.parse(raw));
      return true;
    }
  } catch (e) {
    console.error('localStorage load error:', e.message);
  }
  return false;
}

/** Primary save — Firestore when configured, else server API, always local cache */
function saveToLocalStorage() {
  saveToLocalCache();
  if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(persistToCloud, 400);
}

async function persistToCloud() {
  const state = getStateObject();
  if (window.FirebaseDB && window.FirebaseDB.isReady()) {
    const ok = await window.FirebaseDB.saveState(state);
    if (ok) return;
  }
  syncToServer();
}

function syncToServer() {
  api('/api/save', {
    method: 'POST',
    body: getStateObject()
  }).catch(() => {});
}

// ── Session persistence ──
function saveSession(role, userId, rememberMe) {
  const session = { loggedIn: true, userRole: role, userId, rememberMe, ts: Date.now() };
  localStorage.setItem('loggedIn', 'true');
  localStorage.setItem('userRole', role);
  localStorage.setItem('userId', userId);
  localStorage.setItem('rememberMe', rememberMe ? 'true' : 'false');
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  sessionStorage.setItem('loggedIn', 'true');
  sessionStorage.setItem('userRole', role);
  sessionStorage.setItem('userId', userId);
}

function getSession() {
  const rememberMe = localStorage.getItem('rememberMe') === 'true';
  if (localStorage.getItem('loggedIn') === 'true') {
    return {
      loggedIn: true,
      userRole: localStorage.getItem('userRole'),
      userId: localStorage.getItem('userId'),
      rememberMe
    };
  }
  if (sessionStorage.getItem('loggedIn') === 'true') {
    return {
      loggedIn: true,
      userRole: sessionStorage.getItem('userRole'),
      userId: sessionStorage.getItem('userId'),
      rememberMe: false
    };
  }
  return null;
}

function clearSession() {
  localStorage.removeItem('loggedIn');
  localStorage.removeItem('userRole');
  localStorage.removeItem('userId');
  localStorage.removeItem('rememberMe');
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem('loggedIn');
  sessionStorage.removeItem('userRole');
  sessionStorage.removeItem('userId');
}

function findNavButton(containerSelector, tabName) {
  const buttons = document.querySelectorAll(containerSelector + ' .nav-btn');
  for (const btn of buttons) {
    const onclick = btn.getAttribute('onclick') || '';
    if (onclick.includes("'"+tabName+"'") || onclick.includes('"'+tabName+'"')) return btn;
  }
  return buttons[0];
}

function restoreAdminTab(tabName) {
  const valid = ['dashboard', 'records', 'employees', 'leaves', 'calendar', 'reports', 'departments', 'announcements', 'settings'];
  const tab = valid.includes(tabName) ? tabName : 'dashboard';
  const btn = findNavButton('#page-admin', tab);
  document.querySelectorAll('#page-admin .nav-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.querySelectorAll('#page-admin .atab').forEach(t => t.classList.remove('show'));
  const tabEl = document.getElementById('admin-' + tab);
  if (tabEl) tabEl.classList.add('show');
  if (tab === 'records') renderRecords();
  if (tab === 'reports') setReport('daily', document.querySelector('.rtab'));
  if (tab === 'settings') { loadEmailConfig(); loadCalendarConfig(); }
}

function restoreEmpTab(tabName) {
  const valid = ['dashboard', 'history', 'leaves', 'calendar', 'settings'];
  const tab = valid.includes(tabName) ? tabName : 'dashboard';
  const btn = findNavButton('#page-employee', tab);
  document.querySelectorAll('#page-employee .nav-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.querySelectorAll('#page-employee .etab').forEach(t => t.classList.remove('show'));
  const tabEl = document.getElementById('emp-' + tab);
  if (tabEl) tabEl.classList.add('show');
  if (tab === 'history') renderEmpHistory();
}

async function restoreSession() {
  const session = getSession();
  if (!session || !session.loggedIn || !session.userRole) return false;

  if (session.userRole === 'admin') {
    switchPage('page-admin');
    restoreAdminTab(localStorage.getItem('adminLastTab') || 'dashboard');
    updateDashboardStats();
    renderDashboardCards();
    renderRecords();
    renderEmpTable();
    renderLeaveRequests();
    renderLeaveBalances();
    renderLeaveHistory();
    renderArchivedTable();
    renderAnnouncements();
    renderDeptHeadcount();
    renderDepartments();
    renderAdminNotifPanel();
    return true;
  }

    if (session.userRole === 'employee') {
    // Ensure employee data is loaded from cache before looking up
    if (employees.length === 0) {
      loadFromLocalCache();
    }
    const emp = employees.find(e => e.id === session.userId && e.active);
    if (!emp) {
      // Employee not found — session exists but data hasn't loaded yet
      return false;
    }
    currentUser = emp;
    loadEmployeeData(emp);
    switchPage('page-employee');
    restoreEmpTab(localStorage.getItem('empLastTab') || 'dashboard');
    return true;
  }

  clearSession();
  return false;
}

function refreshAllViews() {
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
  renderAdminNotifPanel();
  if (currentUser) {
    loadEmployeeData(currentUser);
    renderEmpNotifPanel();
  }
}

// ── API Helper ──
async function api(path, options = {}) {
  // Detect file:// protocol — fetch won't work from a local file
  if (window.location.protocol === 'file:') {
    console.error('API error:', path, '— accessed via file:// protocol');
    return { success: false, error: 'Cannot reach the server. Open http://localhost:3000 in your browser instead of opening the HTML file directly.' };
  }
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    // Check if response is JSON; if not, the server likely isn't running properly
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('json')) {
      const text = await res.text();
      console.error('API error: non-JSON response from', path, '- status', res.status, '- body:', text.substring(0, 200));
      let hint = 'Make sure the Node.js server is running via "node server.js" (or start.bat) and access the app at http://localhost:3000 — not via Live Server, VS Code preview, or by opening the HTML file directly.';
      if (res.status === 405) {
        hint = 'The page loaded from a static file server that cannot handle API POST requests. Stop Live Server / other static hosts, run "node server.js", then open http://localhost:3000.';
      }
      return {
        success: false,
        error: 'Server returned HTML instead of JSON (status ' + res.status + '). ' + hint
      };
    }
    return await res.json();
  } catch (e) {
    console.error('API error:', path, e);
    return { success: false, error: e.message };
  }
}

// ── WebSocket ──
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
  let loaded = false;

  if (window.FirebaseDB && window.FirebaseDB.isReady()) {
    const fbState = await window.FirebaseDB.loadState();
    if (fbState) {
      applyStateData(fbState);
      saveToLocalCache();
      loaded = true;
      console.log('Loaded data from Firestore');
    }
  }

  if (!loaded) {
    const res = await api('/api/state');
    if (res.employees) {
      applyStateData(res);
      serverAvailable = true;
      saveToLocalCache();
      loaded = true;
      console.log('Loaded data from server API');
    }
  }

  if (!loaded && loadFromLocalCache()) {
    console.log('Loaded data from local cache');
    loaded = employees.length > 0;
  }

  if (!loaded) {
    await trySeedFromJson();
  }

  refreshAllViews();
}

async function trySeedFromJson() {
  try {
    const res = await fetch('employees.json');
    if (!res.ok) return;
    const data = await res.json();
    if (data.employees && data.employees.length) {
      applyStateData(data);
      saveToLocalStorage();
      console.log('Seeded initial data from employees.json');
    }
  } catch (e) { /* optional seed file */ }
}

function startFirestoreListener() {
  if (!window.FirebaseDB || !window.FirebaseDB.isReady()) return;
  window.FirebaseDB.subscribe((data) => {
    if (!data) return;
    applyStateData(data);
    saveToLocalCache();
    refreshAllViews();
  });
}

// ── Clock & Greetings ──
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

// ── Page & Tab Navigation ──
function switchPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const t = document.getElementById(pageId);
  if (t) t.classList.add('active');
}

function switchTab(containerSelector, tabPrefix, tabName, btnElement, extraRender) {
  const navBtns = document.querySelectorAll(containerSelector + ' .nav-btn');
  navBtns.forEach(b => b.classList.remove('active'));
  if (btnElement) btnElement.classList.add('active');
  const currentTab = document.querySelector(containerSelector + ' .' + (tabPrefix === 'admin' ? 'atab' : 'etab') + '.show');
  const newTab = document.getElementById(tabPrefix + '-' + tabName);
  if (!newTab) return;
  if (currentTab && currentTab !== newTab) {
    currentTab.classList.remove('show');
    currentTab.classList.add('tab-leaving');
    void currentTab.offsetWidth;
    setTimeout(() => {
      currentTab.classList.remove('tab-leaving');
      newTab.classList.add('show');
      if (extraRender) extraRender();
    }, 190);
  } else {
    newTab.classList.add('show');
    if (extraRender) extraRender();
  }
}

// ── Notification Bar ──
function showNotifBar(type, message, icon) {
  const bar = document.getElementById('notif-bar');
  if (!bar) return;
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

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;');
}

// ── Notification Panel ──
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

// ── Dark Mode ──
function toggleDarkMode() {
  const isDark = document.body.classList.toggle('dark-mode');
  localStorage.setItem('darkMode', isDark ? 'true' : 'false');
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

// ── Password Strength ──
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
  if (score <= 40) { bar.style.backgroundColor = 'var(--red)'; }
  else if (score <= 80) { bar.style.backgroundColor = 'var(--amber)'; }
  else { bar.style.backgroundColor = 'var(--green)'; }
}

// ── OTP Input Navigation ──
function otpNext(inp, idx) {
  if (inp.value.length === 1) {
    const next = document.querySelectorAll('.otp-inp')[idx + 1];
    if (next) next.focus();
  }
}

// ── Export Functions ──
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
    csv += '"' + r.id + '","' + r.name + '","' + r.dept + '","' + r.date + '","' + (r.in || '') + '","' + (r.out || '') + '",' + r.hours + ',"' + r.status + '"\r\n';
  });
  downloadCSV(csv, 'attendance_records_' + new Date().toISOString().split('T')[0] + '.csv');
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
    csv += '"' + r.date + '","' + (r.in || '') + '","' + (r.out || '') + '",' + r.hours + ',"' + r.status + '"\r\n';
  });
  downloadCSV(csv, emp.name.replace(/\s+/g, '_') + '_attendance_' + monthStr + '.csv');
  showNotifBar('success', 'Your attendance history exported!', '✓');
}

function exportExcel(source) {
  let data = [];
  let headers = [];
  let filename = '';
  if (source === 'records') {
    const dateF = document.getElementById('rec-date')?.value || '';
    const deptF = document.getElementById('rec-dept')?.value || '';
    const statusF = document.getElementById('rec-status')?.value || '';
    let recs = attendanceRecords.slice();
    if (dateF) recs = recs.filter(r => r.date === dateF);
    if (deptF) recs = recs.filter(r => r.dept === deptF);
    if (statusF) recs = recs.filter(r => r.status === statusF);
    headers = ['ID', 'Employee', 'Department', 'Date', 'Sign In', 'Sign Out', 'Hours', 'Status'];
    data = recs.map(r => [r.id, r.name, r.dept, r.date, r.in || '', r.out || '', r.hours, r.status]);
    filename = 'attendance_records_' + new Date().toISOString().split('T')[0] + '.xlsx';
  } else if (source === 'reports') {
    const rows = document.querySelectorAll('#rpt-table tr');
    headers = ['ID', 'Employee', 'Department', 'Date', 'Sign In', 'Sign Out', 'Hours', 'Status'];
    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length) { data.push(Array.from(cells).map(c => c.textContent.trim())); }
    });
    filename = 'report_' + new Date().toISOString().split('T')[0] + '.xlsx';
  } else if (source === 'employees') {
    const active = employees.filter(e => e.active);
    headers = ['ID', 'Name', 'Department', 'Designation', 'Email', 'Phone', 'Birthday', 'Joining Date', 'CL Balance', 'SL Balance', 'UL Used'];
    data = active.map(e => [e.id, e.name, e.dept, e.designation || '', e.email || '', e.phone || '', e.bday || '', e.joining || '', e.cl, e.sl, e.ul]);
    filename = 'employee_directory_' + new Date().toISOString().split('T')[0] + '.xlsx';
  }
  if (!data.length) { showNotifBar('warning', 'No data to export.', '⚠️'); return; }
  try {
    if (typeof XLSX === 'undefined') { exportCSV(); return; }
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    const colWidths = headers.map((h, i) => {
      const maxLen = Math.max(h.length, ...data.map(row => String(row[i] || '').length));
      return { wch: Math.min(maxLen + 3, 40) };
    });
    ws['!cols'] = colWidths;
    XLSX.utils.book_append_sheet(wb, ws, 'Data');
    XLSX.writeFile(wb, filename);
    showNotifBar('success', 'Excel file exported: ' + filename, '📊');
  } catch (e) {
    console.error('Excel export error:', e);
    showNotifBar('error', 'Excel export failed. Try CSV instead.', '❌');
  }
}

// ── Apply Email Template ──
function applyEmailTemplate(templateKey) {
  if (!templateKey || !EMAIL_TEMPLATES[templateKey]) return;
  const tpl = EMAIL_TEMPLATES[templateKey];
  const subjectEl = document.getElementById('compose-subject');
  const bodyEl = document.getElementById('compose-body');
  if (subjectEl) subjectEl.value = tpl.subject;
  if (bodyEl) {
    bodyEl.value = tpl.body;
    const count = document.getElementById('compose-charcount-modal');
    if (count) count.innerText = tpl.body.length;
  }
  // Auto-switch to preview mode when a template is selected
  toggleComposeView('preview');
}

// ── Toggle Compose Edit/Preview ──
function toggleComposeView(mode) {
  const editBtn = document.getElementById('compose-edit-btn');
  const previewBtn = document.getElementById('compose-preview-btn');
  const editWrap = document.getElementById('compose-body-wrap');
  const previewWrap = document.getElementById('compose-preview-wrap');
  const previewFrame = document.getElementById('compose-preview-frame');
  if (!editBtn || !previewBtn || !editWrap || !previewWrap) return;

  if (mode === 'preview') {
    editBtn.classList.remove('active');
    previewBtn.classList.add('active');
    editWrap.style.display = 'none';
    previewWrap.style.display = 'block';
    renderComposePreview(previewFrame);
  } else {
    previewBtn.classList.remove('active');
    editBtn.classList.add('active');
    previewWrap.style.display = 'none';
    editWrap.style.display = 'flex';
  }
}

function renderComposePreview(container) {
  if (!container) return;
  const bodyEl = document.getElementById('compose-body');
  const subjectEl = document.getElementById('compose-subject');
  const body = bodyEl ? bodyEl.value.trim() : '';
  const subject = subjectEl ? subjectEl.value.trim() : '';

  if (!body && !subject) {
    container.innerHTML = '<div class="compose-preview-placeholder"><span class="compose-preview-icon">👁</span><p>Select a template or write your message and switch to Preview</p></div>';
    return;
  }

  // Detect if body is HTML (starts with <) or plain text
  const isHtml = /^\s*</.test(body);
  const plainText = isHtml
    ? body.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
    : body;
  const subjectLine = subject || '(No subject)';

  container.innerHTML = '<div class="compose-preview-inner">' +
    '<div class="compose-preview-header"><span class="compose-preview-subj">' + escHtml(subjectLine) + '</span></div>' +
    '<div class="compose-preview-body">' +
    (isHtml ? body : '<div style="font-family:Arial,sans-serif;padding:16px;color:#1e293b;line-height:1.7;">' + escHtml(plainText).replace(/\n/g, '<br>') + '</div>') +
    '</div>' +
    '</div>';
}

function populateTemplateSelect() {
  const sel = document.getElementById('compose-template-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Select a template to pre-fill —</option>' +
    Object.entries(EMAIL_TEMPLATES).map(([key, tpl]) =>
      '<option value="' + key + '">' + tpl.name + '</option>'
    ).join('');
}

// ── Email Templates ──
const EMAIL_TEMPLATES = {
  'holiday': {
    name: '🎉 Holiday Greeting',
    subject: 'Wishing You a Wonderful [Festival]!',
    body: '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">\n  <div style="background:linear-gradient(135deg,#0f2744,#1a3355);padding:24px;text-align:center;border-radius:12px 12px 0 0;">\n    <h1 style="color:#f59e0b;margin:0;font-size:22px;">✨ Happy [Festival]!</h1>\n    <p style="color:#94a3b8;margin:8px 0 0;font-size:13px;">From the entire team at Quemahtech</p>\n  </div>\n  <div style="padding:28px 24px;background:#fff;border:1px solid #e2e8f0;border-radius:0 0 12px 12px;">\n    <p style="color:#1e293b;font-size:15px;line-height:1.7;margin:0 0 16px;">Dear Team,</p>\n    <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 16px;">On behalf of the entire management, we extend our warmest wishes to you and your family on the occasion of <strong>[Festival]</strong>. May this festive season bring joy, prosperity, and happiness to your home.</p>\n    <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 16px;">As per the company calendar, the office will remain closed on <strong>[Date]</strong>. Please plan accordingly.</p>\n    <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:14px 16px;margin-bottom:16px;">\n      <p style="color:#92400e;font-size:13px;margin:0;">📅 <strong>Holiday Details:</strong><br>Festival: [Festival]<br>Date: [Date]<br>Status: Paid Holiday</p>\n    </div>\n    <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 12px;">Warm regards,</p>\n    <p style="color:#0f2744;font-size:14px;font-weight:700;margin:0;">Administrator<br><span style="color:#64748b;font-weight:400;font-size:12px;">Quemahtech Employee Management System</span></p>\n  </div>\n  <div style="text-align:center;padding:16px;color:#94a3b8;font-size:11px;">\n    <p style="margin:0;">Quemahtech EMS — Employee Management System</p>\n  </div>\n</div>'
  },
  'leave-approved': {
    name: '✅ Leave Approved',
    subject: 'Your Leave Request Has Been Approved',
    body: '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">\n  <div style="background:linear-gradient(135deg,#065f46,#047857);padding:24px;text-align:center;border-radius:12px 12px 0 0;">\n    <h1 style="color:#fff;margin:0;font-size:20px;">✅ Leave Approved</h1>\n    <p style="color:#a7f3d0;margin:6px 0 0;font-size:13px;">Quemahtech Employee Management System</p>\n  </div>\n  <div style="padding:28px 24px;background:#fff;border:1px solid #e2e8f0;border-radius:0 0 12px 12px;">\n    <p style="color:#1e293b;font-size:15px;line-height:1.7;margin:0 0 16px;">Dear [Employee Name],</p>\n    <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 12px;">We are pleased to inform you that your leave request has been <strong style="color:#16a34a;">approved</strong>.</p>\n    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin-bottom:16px;">\n      <table style="width:100%;border-collapse:collapse;font-size:13px;">\n        <tr><td style="color:#64748b;padding:4px 8px;">Leave Type</td><td style="color:#1e293b;font-weight:600;padding:4px 8px;">[Leave Type]</td></tr>\n        <tr><td style="color:#64748b;padding:4px 8px;">From</td><td style="color:#1e293b;font-weight:600;padding:4px 8px;">[From Date]</td></tr>\n        <tr><td style="color:#64748b;padding:4px 8px;">To</td><td style="color:#1e293b;font-weight:600;padding:4px 8px;">[To Date]</td></tr>\n        <tr><td style="color:#64748b;padding:4px 8px;">Duration</td><td style="color:#1e293b;font-weight:600;padding:4px 8px;">[Days] day(s)</td></tr>\n      </table>\n    </div>\n    <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 12px;">Please ensure a smooth handover of your pending tasks before proceeding on leave. If you have any questions, please reach out to your department head.</p>\n    <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 12px;">Enjoy your time off!</p>\n    <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 12px;">Best regards,</p>\n    <p style="color:#0f2744;font-size:14px;font-weight:700;margin:0;">Administrator</p>\n  </div>\n</div>'
  },
  'leave-rejected': {
    name: '❌ Leave Rejected',
    subject: 'Update on Your Leave Request',
    body: '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">\n  <div style="background:linear-gradient(135deg,#7f1d1d,#991b1b);padding:24px;text-align:center;border-radius:12px 12px 0 0;">\n    <h1 style="color:#fff;margin:0;font-size:20px;">Leave Request Update</h1>\n    <p style="color:#fca5a5;margin:6px 0 0;font-size:13px;">Quemahtech Employee Management System</p>\n  </div>\n  <div style="padding:28px 24px;background:#fff;border:1px solid #e2e8f0;border-radius:0 0 12px 12px;">\n    <p style="color:#1e293b;font-size:15px;line-height:1.7;margin:0 0 16px;">Dear [Employee Name],</p>\n    <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 12px;">After careful review, we regret to inform you that your leave request could not be approved at this time.</p>\n    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin-bottom:16px;">\n      <p style="color:#991b1b;font-size:13px;margin:0;"><strong>Reason:</strong> [Reason for rejection — e.g. staffing constraints, insufficient balance, scheduling conflict]</p>\n    </div>\n    <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 12px;">We encourage you to discuss alternative dates with your manager or explore other leave options. You may also reach out to HR for further assistance.</p>\n    <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 12px;">We appreciate your understanding.</p>\n    <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 12px;">Sincerely,</p>\n    <p style="color:#0f2744;font-size:14px;font-weight:700;margin:0;">Administrator</p>\n  </div>\n</div>'
  },
  'birthday': {
    name: '🎂 Birthday Greeting',
    subject: 'Happy Birthday, [Name]! 🎂',
    body: '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">\n  <div style="background:linear-gradient(135deg,#7c3aed,#a78bfa);padding:24px;text-align:center;border-radius:12px 12px 0 0;">\n    <div style="font-size:48px;margin-bottom:8px;">🎂</div>\n    <h1 style="color:#fff;margin:0;font-size:22px;">Happy Birthday, [Name]!</h1>\n    <p style="color:#ddd6fe;margin:8px 0 0;font-size:13px;">From everyone at Quemahtech</p>\n  </div>\n  <div style="padding:28px 24px;background:#fff;border:1px solid #e2e8f0;border-radius:0 0 12px 12px;">\n    <p style="color:#1e293b;font-size:15px;line-height:1.7;margin:0 0 16px;">Dear [Name],</p>\n    <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 16px;">On behalf of the entire team at <strong>Quemahtech</strong>, we wish you the happiest of birthdays! 🎉 Your hard work, dedication, and positive energy make a real difference every day.</p>\n    <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 16px;">May your year ahead be filled with success, joy, and wonderful moments. Enjoy your special day to the fullest!</p>\n    <div style="text-align:center;padding:20px 0 16px;">\n      <div style="font-size:36px;">🎈🎉🎊</div>\n    </div>\n    <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 12px;">With warm wishes,</p>\n    <p style="color:#0f2744;font-size:14px;font-weight:700;margin:0;">The Quemahtech Team<br><span style="color:#64748b;font-weight:400;font-size:12px;">Employee Management System</span></p>\n  </div>\n</div>'
  },
  'welcome': {
    name: '👋 Welcome New Employee',
    subject: 'Welcome to the Team, [Name]! 🎉',
    body: '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">\n  <div style="background:linear-gradient(135deg,#0f2744,#1a3355);padding:24px;text-align:center;border-radius:12px 12px 0 0;">\n    <div style="font-size:40px;margin-bottom:8px;">👋</div>\n    <h1 style="color:#f59e0b;margin:0;font-size:22px;">Welcome Aboard, [Name]!</h1>\n    <p style="color:#94a3b8;margin:8px 0 0;font-size:13px;">Quemahtech Employee Management System</p>\n  </div>\n  <div style="padding:28px 24px;background:#fff;border:1px solid #e2e8f0;border-radius:0 0 12px 12px;">\n    <p style="color:#1e293b;font-size:15px;line-height:1.7;margin:0 0 16px;">Dear [Name],</p>\n    <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 16px;">A warm welcome to the <strong>Quemahtech</strong> family! We are thrilled to have you join us as a <strong>[Designation]</strong> in the <strong>[Department]</strong> department.</p>\n    <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 16px;">Your journey with us begins on <strong>[Joining Date]</strong>. Here\'s what you need to know to get started:</p>\n    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:16px;">\n      <ul style="color:#475569;font-size:13px;line-height:1.8;margin:0;padding-left:20px;">\n        <li>Your Employee ID is: <strong>[Employee ID]</strong></li>\n        <li>Department: <strong>[Department]</strong></li>\n        <li>Reporting to: <strong>[Manager Name]</strong></li>\n        <li>Office Hours: 9:00 AM — 6:00 PM (Mon–Fri)</li>\n      </ul>\n    </div>\n    <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 12px;">Please complete your onboarding checklist and reach out to HR if you need any assistance settling in.</p>\n    <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 12px;">We look forward to achieving great things together!</p>\n    <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 12px;">Warm regards,</p>\n    <p style="color:#0f2744;font-size:14px;font-weight:700;margin:0;">Administrator &amp; The Quemahtech Team</p>\n  </div>\n</div>'
  },
  'anniversary': {
    name: '🏆 Work Anniversary',
    subject: 'Congratulations on Your Work Anniversary, [Name]!',
    body: '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">\n  <div style="background:linear-gradient(135deg,#d97706,#f59e0b);padding:24px;text-align:center;border-radius:12px 12px 0 0;">\n    <div style="font-size:40px;margin-bottom:8px;">🏆</div>\n    <h1 style="color:#1a1a1a;margin:0;font-size:22px;">Congratulations, [Name]!</h1>\n    <p style="color:#78350f;margin:8px 0 0;font-size:13px;">[Years] Year(s) of Excellence at Quemahtech</p>\n  </div>\n  <div style="padding:28px 24px;background:#fff;border:1px solid #e2e8f0;border-radius:0 0 12px 12px;">\n    <p style="color:#1e293b;font-size:15px;line-height:1.7;margin:0 0 16px;">Dear [Name],</p>\n    <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 16px;">Today marks a wonderful milestone — <strong>[Years] incredible year(s)</strong> with <strong>Quemahtech</strong>! We want to take this moment to express our deepest gratitude for your dedication, hard work, and the invaluable contributions you have made to our team.</p>\n    <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 16px;">Your commitment to excellence inspires those around you, and we are proud to have you as part of our growing family. Here\'s to many more years of shared success! 🥂</p>\n    <div style="text-align:center;padding:16px 0;">\n      <div style="display:inline-block;background:#fef3c7;padding:12px 24px;border-radius:8px;">\n        <span style="font-size:28px;">🎉</span>\n        <p style="color:#92400e;font-size:14px;font-weight:600;margin:4px 0 0;">[Years] Year Service Award</p>\n      </div>\n    </div>\n    <p style="color:#475569;font-size:14px;line-height:1.7;margin:12px 0 12px;">Thank you for being an essential part of our journey!</p>\n    <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 12px;">With appreciation,</p>\n    <p style="color:#0f2744;font-size:14px;font-weight:700;margin:0;">The Quemahtech Management</p>\n  </div>\n</div>'
  },
  'notice': {
    name: '📋 Office Memo / Notice',
    subject: 'Important Office Notice: [Subject]',
    body: '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">\n  <div style="background:linear-gradient(135deg,#0f2744,#1a3355);padding:20px 24px;text-align:center;border-radius:12px 12px 0 0;">\n    <h1 style="color:#f59e0b;margin:0;font-size:18px;">📋 OFFICE MEMORANDUM</h1>\n    <p style="color:#94a3b8;margin:6px 0 0;font-size:12px;">Quemahtech Employee Management System</p>\n  </div>\n  <div style="padding:28px 24px;background:#fff;border:1px solid #e2e8f0;border-radius:0 0 12px 12px;">\n    <div style="display:flex;justify-content:space-between;font-size:12px;color:#64748b;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #e2e8f0;">\n      <span><strong>Date:</strong> [Date]</span>\n      <span><strong>Ref:</strong> QMT/MEMO/[Reference No.]</span>\n    </div>\n    <p style="color:#1e293b;font-size:15px;line-height:1.7;margin:0 0 16px;">To All Employees,</p>\n    <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 16px;">[Message body — describe the announcement, policy change, event, or important information that needs to be communicated to all staff members.]</p>\n    <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 16px;">Key details are summarized below:</p>\n    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:16px;">\n      <ul style="color:#475569;font-size:13px;line-height:1.8;margin:0;padding-left:20px;">\n        <li><strong>Effective Date:</strong> [Effective Date]</li>\n        <li><strong>Applies to:</strong> All Departments</li>\n        <li><strong>Action Required:</strong> [Yes/No — specify if any response needed]</li>\n      </ul>\n    </div>\n    <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 12px;">Please direct any questions to HR or your department head.</p>\n    <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 12px;">Thank you for your cooperation.</p>\n    <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 12px;">Sincerely,</p>\n    <p style="color:#0f2744;font-size:14px;font-weight:700;margin:0;">Administration<br><span style="color:#64748b;font-weight:400;font-size:12px;">Quemahtech Employee Management System</span></p>\n  </div>\n</div>'
  }
};

// ── Email Sending (EmailJS — works on static hosting / GitHub Pages) ──

function isEmailJSConfigured() {

  return window.EMAILJS_CONFIG && window.EMAILJS_CONFIG.publicKey && window.EMAILJS_CONFIG.serviceId && window.EMAILJS_CONFIG.templateId;

}



function getEmailJSConfig() {

  return window.EMAILJS_CONFIG || {};

}



function setEmailServerWarning(visible) {

  const el = document.getElementById('email-server-warning');

  if (el) el.style.display = visible ? 'block' : 'none';

}



// Alias so the HTML settings button "Test EmailJS" works without server
function testEmailJS() {
  testSmtp();
}

function testSmtp() {

  if (!isEmailJSConfigured()) {
    showNotifBar('warning', 'EmailJS keys not set — configure in emailjs-config.js', '⚙️');
    return;
  }

  showNotifBar('info', 'Sending test email via EmailJS…', '🔌');

  const cfg = getEmailJSConfig();

  emailjs.send(cfg.serviceId, cfg.templateId, {

    to_email: cfg.fromEmail || 'test@example.com',

    subject: 'Quemahtech — EmailJS Test',

    message: 'EmailJS is configured and working!\n\nThis is a test message from your Employee Management System.'

  }).then(() => {

    showNotifBar('success', 'EmailJS test sent! Check your inbox.', '✓');

  }).catch(err => {

    showNotifBar('error', 'EmailJS test failed: ' + (err.text || err.message || 'Unknown error'), '❌');

  });

}



// ── Load Email Config and Display in Settings ──
function loadEmailConfig() {
  const cfg = getEmailJSConfig();
  const serviceEl = document.getElementById('email-config-service');
  const statusEl = document.getElementById('email-config-status');
  if (!statusEl) return;

  if (isEmailJSConfigured()) {
    if (serviceEl) serviceEl.innerText = 'EmailJS';
    statusEl.innerText = '✅ EmailJS Ready';
    statusEl.style.color = 'var(--green)';
    statusEl.title = 'EmailJS configured — sending is available.';
  } else {
    if (serviceEl) serviceEl.innerText = 'Not set';
    statusEl.innerText = '⚙️ Optional — set keys in emailjs-config.js';
    statusEl.style.color = 'var(--amber)';
    statusEl.title = 'EmailJS is optional. Password reset works via on-screen OTP even without email.';
  }
}



function updateSmtpStatus(res) {

  const cfg = getEmailJSConfig();

  const from = document.getElementById('compose-from-display');

  if (from) {

    from.value = (cfg && cfg.fromEmail) ? cfg.fromEmail : 'Configured via EmailJS';

  }

  const badge = document.getElementById('compose-status-badge');

  const configured = isEmailJSConfigured();

  if (badge) { 

    badge.innerText = configured ? '● EmailJS Ready' : '● Not configured';

    badge.className = 'compose-status-badge' + (configured ? ' connected' : '');

  }

  const status = document.getElementById('compose-smtp-status');

  if (status) { 

    if (configured) {

      status.innerText = cfg.fromEmail || 'EmailJS';

      status.style.color = 'var(--green)';

    } else {

      status.innerText = 'Not configured';

      status.style.color = 'var(--red)';

    }

  }

}



function sendCustomEmail() {

  const to = document.getElementById('compose-to').value.trim();

  const cc = document.getElementById('compose-cc')?.value.trim() || '';

  const bcc = document.getElementById('compose-bcc')?.value.trim() || '';

  const subject = document.getElementById('compose-subject').value.trim();

  const body = document.getElementById('compose-body').value.trim();

  const btn = document.getElementById('compose-send-btn');

  if (!to || !subject || !body) { showNotifBar('warning', 'Please fill in To, Subject, and Message.', '⚠️'); return; }

  if (!isEmailJSConfigured()) { showNotifBar('warning', 'Configure EmailJS in emailjs-config.js first', '⚙️'); return; }

  if (btn) { btn.disabled = true; btn.innerHTML = '<span>⏳</span> Sending…'; }

  showNotifBar('info', 'Sending email to ' + to + ' via EmailJS…', '📧');

  const isHtml = /^\s*</.test(body);

  const htmlContent = isHtml

    ? body

    : '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1e293b;line-height:1.7;">' +

      body.replace(/\n/g, '<br>') +

      '</div>';

  

  const recipients = to.split(',').map(r => r.trim()).filter(Boolean);

  let sentCount = 0;

  let failCount = 0;

  const cfg = getEmailJSConfig();

  

  const sendPromises = recipients.map(recipient => {

    return emailjs.send(cfg.serviceId, cfg.templateId, {

      to_email: recipient,

      subject: subject,

      message: isHtml ? htmlContent : body

    }).then(() => { sentCount++; }).catch(err => { failCount++; console.error('EmailJS send error:', err); });

  });

  

  if (cc) {

    const ccRecipients = cc.split(',').map(r => r.trim()).filter(Boolean);

    ccRecipients.forEach(recipient => {

      sendPromises.push(

        emailjs.send(cfg.serviceId, cfg.templateId, {

          to_email: recipient,

          subject: 'CC: ' + subject,

          message: isHtml ? htmlContent : body

        }).then(() => { sentCount++; }).catch(err => { failCount++; console.error('EmailJS CC error:', err); })

      );

    });

  }

  

  if (bcc) {

    const bccRecipients = bcc.split(',').map(r => r.trim()).filter(Boolean);

    bccRecipients.forEach(recipient => {

      sendPromises.push(

        emailjs.send(cfg.serviceId, cfg.templateId, {

          to_email: recipient,

          subject: 'BCC: ' + subject,

          message: isHtml ? htmlContent : body

        }).then(() => { sentCount++; }).catch(err => { failCount++; console.error('EmailJS BCC error:', err); })

      );

    });

  }

  

  Promise.all(sendPromises).finally(() => {

    if (sentCount > 0 && failCount === 0) {

      showNotifBar('success', 'Email sent to ' + sentCount + ' recipient(s)!', '✓');

      clearCompose();

    } else if (failCount > 0 && sentCount === 0) {

      showNotifBar('error', 'Email sending failed for all recipients.', '❌');

    } else {

      showNotifBar('warning', 'Sent to ' + sentCount + ', failed: ' + failCount, '⚠️');

    }

    if (btn) { btn.disabled = false; btn.innerHTML = '<span>📤</span> Send Email'; }

  });

}

function clearCompose() {
  ['compose-to','compose-cc','compose-bcc','compose-subject','compose-body'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const count = document.getElementById('compose-charcount-modal');
  if (count) count.innerText = '0';
  const sel = document.getElementById('compose-template-select');
  if (sel) sel.value = '';
}

function toggleCcBccModal() {
  const wrap = document.getElementById('compose-cc-wrap-modal');
  if (wrap) wrap.style.display = wrap.style.display === 'none' ? 'block' : 'none';
}

function openComposeModal() {

  document.getElementById('compose-modal').style.display = 'flex';

  // Reset to edit mode

  toggleComposeView('edit');

  // Update status/from display from EmailJS config (no server call needed)

  updateSmtpStatus(null);

  populateTemplateSelect();

  document.getElementById('compose-to').focus();

}

function closeComposeModal() {
  document.getElementById('compose-modal').style.display = 'none';
}

function wrapTag(textareaId, tag, attrs) {
  const ta = document.getElementById(textareaId);
  if (!ta) return;
  const start = ta.selectionStart, end = ta.selectionEnd;
  const sel = ta.value.substring(start, end);
  const before = ta.value.substring(0, start);
  const after = ta.value.substring(end);
  const attrStr = attrs ? ' ' + attrs : '';    ta.value = before + '<' + tag + attrStr + '>' + sel + '</' + tag + '>' + after;
  ta.focus();
  const count = document.getElementById('compose-charcount-modal');
  if (count) count.innerText = ta.value.length;
}

function wrapHtml(textareaId, html) {
  const ta = document.getElementById(textareaId);
  if (!ta) return;
  const start = ta.selectionStart;
  const before = ta.value.substring(0, start);
  const after = ta.value.substring(start);
  ta.value = before + html + after;
  ta.focus();
  const count = document.getElementById('compose-charcount-modal');
  if (count) count.innerText = ta.value.length;
}

// ── Google Calendar Integration ──
async function loadCalendarConfig() {
  const statusEl = document.getElementById('calendar-config-status');
  const saEl = document.getElementById('calendar-config-sa');
  const idEl = document.getElementById('calendar-config-id');
  const saPathEl = document.getElementById('cal-sa-path');
  const calIdEl = document.getElementById('cal-id');
  if (!statusEl) return;
  // If server isn't available, show as not configured without making an API call
  if (!serverAvailable) {
    statusEl.innerText = '❌ Not configured (server required)';
    statusEl.style.color = 'var(--red)';
    if (saEl) saEl.innerText = 'Not set';
    if (idEl) idEl.innerText = '—';
    return;
  }
  const res = await api('/api/calendar-config');
  if (res.enabled) {
    statusEl.innerText = '✅ Configured';
    statusEl.style.color = 'var(--green)';
    if (saEl) saEl.innerText = res.serviceAccountPath || '—';
    if (idEl) idEl.innerText = res.calendarId || 'primary';
    if (saPathEl) saPathEl.value = res.serviceAccountPath || '';
    if (calIdEl) calIdEl.value = res.calendarId || 'primary';
  } else {
    statusEl.innerText = '❌ Not configured';
    statusEl.style.color = 'var(--red)';
    if (saEl) saEl.innerText = 'Not set';
    if (idEl) idEl.innerText = '—';
  }
}

async function saveCalendarConfig() {
  if (!serverAvailable) {
    showNotifBar('warning', 'Calendar sync requires the Node.js server to be running (node server.js) or a Vercel deployment. On static hosting this feature is unavailable.', '⚠️');
    return;
  }
  const serviceAccountPath = document.getElementById('cal-sa-path')?.value.trim() || '';
  const calendarId = document.getElementById('cal-id')?.value.trim() || 'primary';
  if (!serviceAccountPath) {
    showNotifBar('warning', 'Please enter the service account JSON file path.', '⚠️');
    return;
  }
  const res = await api('/api/calendar-config', {
    method: 'POST',
    body: {
      serviceAccountPath,
      calendarId,
      enabled: true
    }
  });
  if (res.success) {
    showNotifBar('success', 'Calendar config saved! Sync birthdays to create events.', '✓');
    loadCalendarConfig();
  } else {
    showNotifBar('error', 'Failed to save: ' + (res.error || 'Unknown error'), '❌');
  }
}

async function syncBirthdaysToCalendar() {
  if (!serverAvailable) {
    showNotifBar('warning', 'Calendar sync requires the Node.js server (node server.js) or Vercel deployment. Unavailable on static hosting.', '⚠️');
    return;
  }
  showNotifBar('info', 'Syncing all employee birthdays to Google Calendar…', '📅');
  const res = await api('/api/calendar/sync-birthdays', { method: 'POST' });
  if (res.success) {
    const succeeded = res.results.filter(r => r.success).length;
    const failed = res.results.filter(r => !r.success).length;
    if (succeeded > 0) {
      showNotifBar('success', succeeded + ' birthday event(s) created!', '✓');
    }
    if (failed > 0) {
      showNotifBar('warning', failed + ' birthday(s) failed. Check server logs.', '⚠️');
    }
    if (succeeded === 0 && failed === 0) {
      showNotifBar('info', 'No employees with birthdays to sync.', 'ℹ️');
    }
  } else {
    showNotifBar('error', 'Sync failed: ' + (res.error || 'Calendar not configured'), '❌');
  }
}

async function testCalendarConnection() {
  if (!serverAvailable) {
    showNotifBar('warning', 'Calendar requires the Node.js server (node server.js) or Vercel deployment. Unavailable on static hosting.', '⚠️');
    return;
  }
  showNotifBar('info', 'Testing Google Calendar connection…', '🔌');
  const res = await api('/api/calendar-config', { method: 'GET' });
  if (res.enabled) {
    showNotifBar('success', '✅ Calendar configured! Service account path: ' + (res.serviceAccountPath || 'N/A') + ' | Calendar ID: ' + (res.calendarId || 'primary'), '✓');
  } else {
    showNotifBar('error', 'Calendar not configured. Please save config first.', '❌');
  }
}

// ── Character Counter (event delegation) ──
document.addEventListener('input', function(e) {
  if (e.target.id === 'ann-body') {
    const count = document.getElementById('ann-charcount');
    if (count) count.innerText = e.target.value.length;
  }
  if (e.target.id === 'compose-body') {
    const count = document.getElementById('compose-charcount-modal');
    if (count) count.innerText = e.target.value.length;
  }
});

// ── Announcements ──
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
    return '<div class="announcement-card priority-' + prior + '">' +
      '<div class="ann-header"><div class="ann-header-left">' +
      '<span class="ann-category-badge ' + priorClass + '">' + priorLabel + '</span>' +
      '<strong class="ann-subject">' + escHtml(a.subject) + '</strong></div></div>' +
      '<div class="ann-meta">' +
      '<span class="ann-meta-item">📅 ' + formatDate(a.date) + '</span>' +
      '<span class="ann-meta-item">👤 ' + (a.by || 'Admin') + '</span>' +
      (a.recipient ? '<span class="ann-meta-item">👥 ' + escHtml(a.recipient) + '</span>' : '') + '</div>' +
      '<div class="ann-body">' + escHtml(a.body) + '</div></div>';
  }).join('');
  if (el) {
    if (announcements.length) { el.innerHTML = html; }
    else { el.innerHTML = '<div class="ann-empty-state"><span class="ann-empty-icon">📭</span><div class="ann-empty-text">No announcements yet</div><div class="ann-empty-sub">Send your first announcement above</div></div>'; }
  }
  if (empEl) {
    if (announcements.length) { empEl.innerHTML = html; }
    else { empEl.innerHTML = '<p style="color:var(--subtle);font-size:14px;text-align:center;padding:16px;">No announcements yet.</p>'; }
  }
}

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

async function postAnnouncement() {
  const subEl = document.getElementById('ann-subject');
  const bodyEl = document.getElementById('ann-body');
  if (!subEl || !bodyEl) return;
  const subject = subEl.value.trim();
  const body = bodyEl.value.trim();
  if (!subject || !body) { showNotifBar('warning', 'Please enter both subject and message.', '⚠️'); return; }
  const today = new Date().toISOString().split('T')[0];
  let recipientText = 'All Employees';
  if (annSelectedRecipient === 'dept') {
    const deptSelect = document.getElementById('ann-dept-select');
    recipientText = deptSelect ? deptSelect.value + ' Department' : 'Department';
  } else if (annSelectedRecipient === 'individual') { recipientText = 'Individual'; }
  const ann = { date: today, subject, body, by: 'Admin', priority: annSelectedPriority, recipient: recipientText };
  announcements.unshift(ann);
  api('/api/announcements', { method: 'POST', body: ann }).catch(() => {});
  subEl.value = '';
  bodyEl.value = '';
  const charCount = document.getElementById('ann-charcount');
  if (charCount) charCount.innerText = '0';
  renderAnnouncements();
  showNotifBar('success', 'Announcement sent successfully!', '📣');
  api('/api/notifications', { method: 'POST', body: { text: 'New Announcement: ' + subject, target: 'emp' } }).catch(() => {});
  empNotifications.unshift({ text: 'New Announcement: ' + subject, time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }), unread: true });
  renderEmpNotifPanel();
}

function sendAnnouncement() { postAnnouncement(); }

function previewAnnouncement() {
  const subject = document.getElementById('ann-subject')?.value.trim();
  const body = document.getElementById('ann-body')?.value.trim();
  if (!subject || !body) { showNotifBar('warning', 'Please enter both subject and message to preview.', '⚠️'); return; }
  alert('Announcement Preview\n\nSubject: ' + subject + '\n\nMessage:\n' + body);
}

// ── Department Management ──
function renderDepartments() {
  const tagList = document.getElementById('dept-tag-list');
  const recDept = document.getElementById('rec-dept');
  const empFilter = document.getElementById('emp-dept-filter');
  const fDept = document.getElementById('f-dept');
  if (tagList) tagList.innerHTML = departments.map(d =>
    '<span class="chip ' + (DEPT_COLORS[d] || 'c-eng') + '" style="padding:4px 12px;font-size:12px;display:inline-flex;align-items:center;gap:5px;">' + d +
    '<button style="background:none;border:none;cursor:pointer;color:inherit;font-size:14px;line-height:1;margin-left:2px;" onclick="removeDept(\'' + d + '\')">×</button></span>'
  ).join('');
  const allOpt = '<option value="">All Departments</option>' + departments.map(d => '<option value="' + d + '">' + d + '</option>').join('');
  const deptOpt = departments.map(d => '<option value="' + d + '">' + d + '</option>').join('');
  if (recDept) recDept.innerHTML = allOpt;
  if (empFilter) empFilter.innerHTML = allOpt;
  if (fDept) fDept.innerHTML = deptOpt;
}

function removeDept(name) {
  if (!confirm('Remove department "' + name + '"?')) return;
  departments = departments.filter(d => d !== name);
  saveToLocalStorage();
  renderDepartments();
  renderDeptHeadcount();
  showNotifBar('info', 'Department "' + name + '" removed.', '🗑');
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
  showNotifBar('success', 'Department "' + val + '" added!', '✓');
}

function renderDeptHeadcount() {
  const el = document.getElementById('dept-headcount-bars');
  if (!el) return;
  const counts = {};
  departments.forEach(d => counts[d] = 0);
  employees.filter(e => e.active).forEach(e => { if (counts[e.dept] !== undefined) counts[e.dept]++; });
  const max = Math.max(...Object.values(counts), 1);
  const colors = ['bf-blue', 'bf-green', 'bf-purple', 'bf-amber', 'bf-red', 'bf-purple'];
  el.innerHTML = Object.entries(counts).map(([d, c], i) =>
    '<div class="bar-row"><span class="bar-label">' + d + '</span><div class="bar-track"><div class="bar-fill ' + colors[i % colors.length] + '" style="width:' + Math.round(c / max * 100) + '%"></div></div><span class="bar-val">' + c + ' emp</span></div>'
  ).join('');
}

function renderArchivedTable() {
  const tbody = document.getElementById('archived-table-body');
  if (!tbody) return;
  tbody.innerHTML = archivedEmployees.map(e =>
    '<tr><td><span style="font-family:var(--font-mono);font-size:12px;">' + e.id + '</span></td><td>' + e.name + '</td><td><span class="chip ' + (DEPT_COLORS[e.dept] || 'c-eng') + '">' + e.dept + '</span></td><td><span class="tag t-absent">' + e.status + '</span></td><td style="font-size:12px;">' + formatDate(e.joining) + '</td><td style="font-size:12px;">' + formatDate(e.exit) + '</td><td><button class="btn btn-sm" onclick="showNotifBar(&#39;info&#39;,&#39;Full history for &#39; + e.name + &#39; (Read-only)&#39;,&#39;📋&#39;)">View History</button></td></tr>'
  ).join('');
}

// ── Archived Employee Toggle ──
function toggleArchived() {
  archivedVisible = !archivedVisible;
  document.getElementById('archived-section').style.display = archivedVisible ? 'block' : 'none';
  document.getElementById('archived-toggle').classList.toggle('active', archivedVisible);
  document.getElementById('archived-arrow').innerText = archivedVisible ? '⌄' : '›';
}

// ── Auto Sign-out ──
function scheduleAutoSignOut() {
  const now = new Date();
  const target = new Date(now);
  target.setHours(18, 0, 0, 0);
  if (now >= target) return;
  setTimeout(tryAutoSignOutAt6pm, target.getTime() - now.getTime());
}

function tryAutoSignOutAt6pm() {
  const page = document.getElementById('page-employee');
  if (!currentUser || !page || !page.classList.contains('active')) return;
  const today = new Date().toISOString().split('T')[0];
  const rec = attendanceRecords.find(r => r.id === currentUser.id && r.date === today);
  if (rec && rec.in && !rec.out) { empPunchOut(); showNotifBar('info', 'Auto signed out — 6:00 PM', '⏰'); }
}

// ── Page Before Unload ──
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
    rec.out = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    const [inH, inM] = rec.in.split(':').map(Number);
    rec.hours = Math.max(0, parseFloat(((h - inH) + (m - inM) / 60).toFixed(2)));
    saveToLocalStorage();
    try { const blob = new Blob([JSON.stringify(rec)], { type: 'application/json' }); navigator.sendBeacon('/api/attendance', blob); } catch (e) { /* silent */ }
  }
}

// ── Global Modal Dismiss ──
window.addEventListener('click', (e) => {
  if (e.target === document.getElementById('leave-manage-modal')) document.getElementById('leave-manage-modal').style.display = 'none';
  if (e.target === document.getElementById('forgot-modal')) document.getElementById('forgot-modal').style.display = 'none';
  if (e.target === document.getElementById('otp-modal')) document.getElementById('otp-modal').style.display = 'none';
  if (e.target === document.getElementById('newpwd-modal')) document.getElementById('newpwd-modal').style.display = 'none';
  if (e.target === document.getElementById('add-emp-modal')) closeAddEmpModal();
  if (e.target === document.getElementById('delete-emp-modal')) closeDeleteEmpModal();
  if (e.target === document.getElementById('compose-modal')) closeComposeModal();
});

// ── INIT ──
document.addEventListener('DOMContentLoaded', async () => {
  restoreDarkMode();

  if (window.FirebaseDB) {
    window.FirebaseDB.init();
    startFirestoreListener();
  }

  connectWebSocket();
  await refreshState();

  updateClock();
  setInterval(updateClock, 1000);
  setAdminGreeting();

  const today = new Date().toISOString().split('T')[0];
  const mi = document.getElementById('hist-month');
  if (mi) mi.value = today.slice(0, 7);
  const lf = document.getElementById('leave-from');
  const lt = document.getElementById('leave-to');
  if (lf) lf.value = today;
  if (lt) lt.value = today;

  const restored = await restoreSession();
  if (!restored) {
    switchPage('page-login');
  }

  scheduleAutoSignOut();
});

/* ═══════════════════════════════════
   LOGIN JS — Auth, session, password reset
═══════════════════════════════════ */

// ── Role Selection ──
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

// ── Login ──
async function doLogin() {
  const uid = document.getElementById('uid').value.trim();
  const pwd = document.getElementById('pwd').value.trim();
  const err = document.getElementById('err-msg');
  if (err) err.style.display = 'none';

  // Try server login first
  const res = await api('/api/login', { method: 'POST', body: { uid, pwd, role: currentRole } });
  const rememberMe = document.getElementById('remember-me')?.checked || false;

  if (res.success && res.role === 'admin') {
    saveSession('admin', uid, rememberMe);
    await refreshState();
    switchPage('page-admin');
    renderRecords();
    renderEmpHistory();
    showNotifBar('success', 'Welcome back, Administrator!', '👋');
    return;
  }

  if (res.success && res.role === 'employee') {
    await refreshState();
    const emp = employees.find(e => e.id.toLowerCase() === uid.toLowerCase() && e.active);
    if (emp) {
      currentUser = emp;
      saveSession('employee', emp.id, rememberMe);
      loadEmployeeData(emp);
      switchPage('page-employee');
      autoAttendancePunchIn(emp);
      showNotifBar('success', 'Welcome back, ' + emp.name.split(' ')[0] + '!', '👋');
      return;
    }
  }

  // Fallback when server API unavailable (Firestore / static hosting)
  const expectedAdminPwd = adminPassword || 'quemah123';
  if (currentRole === 'admin' && uid === 'quemahtech' && pwd === expectedAdminPwd) {
    saveSession('admin', uid, rememberMe);
    saveToLocalCache();
    switchPage('page-admin');
    renderRecords();
    renderEmpHistory();
    showNotifBar('success', 'Welcome back, Administrator!', '👋');
    return;
  }

  if (currentRole === 'employee') {
    const emp = employees.find(e => e.id.toLowerCase() === uid.toLowerCase() && e.active);
    if (emp) {
      const expectedEmpPwd = emp.password || 'emp123';
      if (pwd === expectedEmpPwd) {
        currentUser = emp;
        saveSession('employee', emp.id, rememberMe);
        saveToLocalCache();
        loadEmployeeData(emp);
        switchPage('page-employee');
        autoAttendancePunchIn(emp);
        showNotifBar('success', 'Welcome back, ' + emp.name.split(' ')[0] + '!', '👋');
        return;
      }
    }
  }

  if (err) err.style.display = 'flex';
}

// ── Load Employee Data ──
function loadEmployeeData(emp) {
  document.getElementById('emp-fullname').innerText = emp.name;
  document.getElementById('emp-details').innerText = emp.id + ' | ' + emp.dept + ' | ' + emp.designation;
  document.getElementById('emp-badge').innerText = '👤 ' + emp.name;
  document.getElementById('emp-topbar-name').innerText = emp.name;
  const avEl = document.getElementById('emp-av');
  if (avEl) {
    avEl.innerText = emp.name.charAt(0);
    avEl.className = 'emp-hero-av ' + AV_COLORS[employees.indexOf(emp) % AV_COLORS.length];
  }
  document.getElementById('emp-cl-bal').innerText = emp.cl;
  document.getElementById('emp-sl-bal').innerText = emp.sl;
  document.getElementById('emp-ul-used').innerText = emp.ul;
  document.getElementById('emp-cl-bal2').innerText = emp.cl;
  document.getElementById('emp-sl-bal2').innerText = emp.sl;
  document.getElementById('emp-ul-used2').innerText = emp.ul;
  renderEmpDashboard(emp);
}

// ── Logout ──
function logout() {
  clearSession();
  currentUser = null;
  document.getElementById('uid').value = '';
  document.getElementById('pwd').value = '';
  switchPage('page-login');
}

// ── Forgot Password Flow ──
function openForgotModal() {
  document.getElementById('forgot-modal').style.display = 'flex';
  document.getElementById('forgot-uid').value = '';
  document.getElementById('forgot-phone').value = '';
  document.getElementById('forgot-email').value = '';
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
  const email = document.getElementById('forgot-email').value.trim();
  const phone = document.getElementById('forgot-phone').value.trim();
  if (!uid || (!email && !phone)) { showNotifBar('warning', 'Please enter your Username/ID and your registered email OR phone.', '⚠️'); return; }

  let userFound = false;
  let userEmail = '';
  let userName = '';
  let userPhone = '';

  if (uid === 'quemahtech') {
    userFound = true;
    userEmail = 'admin@test.com';
    userName = 'Administrator';
  } else {
    const emp = employees.find(e => e.id.toLowerCase() === uid.toLowerCase() && e.active);
    if (emp) {
      const cleanPhone = emp.phone ? emp.phone.replace(/\s+/g, '') : '';
      const last4 = cleanPhone.substring(cleanPhone.length - 4);
      // Verify by email OR phone
      const emailMatch = email && emp.email && emp.email.toLowerCase() === email.toLowerCase();
      const phoneMatch = phone && last4 === phone;
      if (emailMatch || phoneMatch) {
        userFound = true;
        userEmail = emp.email || '';
        userName = emp.name;
        userPhone = cleanPhone;
      }
    }
  }

  if (!userFound) { showNotifBar('error', 'User details not matched. Check your ID and email or phone.', '❌'); return; }

  resetUserId = uid;
  const otp = String(Math.floor(1000 + Math.random() * 9000));
  localStorage.setItem('resetOtp', otp);
  localStorage.setItem('resetOtpExpiry', Date.now() + 300000);
  document.getElementById('otp-modal').dataset.fallbackOtp = otp;

  // Always show OTP on screen first — works regardless of email config
  showOtpFallback(otp);

  if (userEmail) {
    const otpMessage = 'Hi ' + userName + ',\n\nYour password reset OTP is: ' + otp + '\n\nThis code expires in 5 minutes.\n\nIf you didn\'t request this, please ignore this message.\n\n— Quemahtech EMS';
    // Try sending email silently in background — not required for flow to work
    if (isEmailJSConfigured()) {
      const cfg = getEmailJSConfig();
      emailjs.send(cfg.serviceId, cfg.templateId, {
        to_email: userEmail,
        subject: 'Quemahtech — Password Reset OTP',
        message: otpMessage
      }).then(() => {
        showNotifBar('success', 'OTP sent to ' + userEmail + '!', '📧');
      }).catch(() => {
        // Email failed — OTP is already visible on screen, no error needed
      });
    }
  }

  document.getElementById('forgot-modal').style.display = 'none';
  document.getElementById('otp-modal').style.display = 'flex';
  const inps = document.querySelectorAll('.otp-inp');
  inps.forEach(inp => inp.value = '');
  if (inps[0]) inps[0].focus();
}

function showOtpFallback(otp) {
  const otpHelp = document.getElementById('otp-help-text');
  if (otpHelp) { otpHelp.innerText = '🔑 Your OTP code:  ' + otp; otpHelp.style.display = 'block'; }
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
  } else if (Date.now() >= expiry && savedOtp) { showNotifBar('error', 'Code expired. Please request a new one.', '⏰'); }
  else { showNotifBar('error', 'Invalid code. Please try again.', '❌'); }
}

function doResetPwd() {
  const pwd = document.getElementById('np-pwd').value.trim();
  const conf = document.getElementById('np-conf').value.trim();
  if (pwd.length < 6) { showNotifBar('warning', 'Password must be at least 6 characters.', '⚠️'); return; }
  if (pwd !== conf) { showNotifBar('warning', 'Passwords do not match.', '⚠️'); return; }
  if (resetUserId === 'quemahtech') {
    adminPassword = pwd;
    saveToLocalStorage();
    showNotifBar('success', 'Admin password reset successful!', '🔑');
  } else {
    const emp = employees.find(e => e.id === resetUserId && e.active);
    if (emp) { emp.password = pwd; saveToLocalStorage(); showNotifBar('success', 'Employee password reset successful!', '🔑'); }
  }
  document.getElementById('newpwd-modal').style.display = 'none';
  resetUserId = null;
}

/* ═══════════════════════════════════
   ADMIN JS — Admin panel functions
═══════════════════════════════════ */

// ── Admin Tab Navigation ──
function adminTab(tabName, btnElement) {
  localStorage.setItem('adminLastTab', tabName);
  switchTab('#page-admin', 'admin', tabName, btnElement, () => {
    if (tabName === 'records') renderRecords();
    if (tabName === 'reports') setReport('daily', document.querySelector('.rtab.active'));
    if (tabName === 'settings') { loadEmailConfig(); loadCalendarConfig(); }
  });
}

// ── Dashboard Stats ──
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
  setText('stat-present-rate', rate + '% attendance');
}

// ── Dashboard Cards ──
function renderDashboardCards() {
  updateDashboardStats();
  const today = new Date().toISOString().split('T')[0];
  const todayRecs = attendanceRecords.filter(r => r.date === today);
  const presentEmps = todayRecs.filter(r => ['Present', 'Late', 'Half-Day'].includes(r.status));
  const absentEmps = todayRecs.filter(r => r.status === 'Absent');
  const pEl = document.getElementById('a-present');
  const aEl = document.getElementById('a-absent');
  setText('title-present-count', 'Present (' + presentEmps.length + ')');
  setText('title-absent-count', 'Absent / On Leave (' + absentEmps.length + ')');
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
      return '<div class="bar-row"><span class="bar-label">' + d + '</span><div class="bar-track"><div class="bar-fill ' + color + '" style="width:' + pct + '%"></div></div><span class="bar-val">' + pct + '%</span></div>';
    }).join('');
  }

  // Today's log table
  const logEl = document.getElementById('a-log');
  if (logEl) logEl.innerHTML = todayRecs.map(r =>
    '<tr><td><div style="display:flex;align-items:center;gap:8px;"><div class="av ' + AV_COLORS[employees.findIndex(e => e.id === r.id) % AV_COLORS.length] + '">' + r.name.charAt(0) + '</div><span>' + r.name + '</span></div></td>' +
    '<td><span class="chip ' + (DEPT_COLORS[r.dept] || 'c-eng') + '">' + r.dept + '</span></td>' +
    '<td><span style="font-family:var(--font-mono);font-size:12px;">' + (r.in || '—') + '</span></td>' +
    '<td><span style="font-family:var(--font-mono);font-size:12px;">' + (r.out || '—') + '</span></td>' +
    '<td><strong>' + (r.hours > 0 ? r.hours.toFixed(1) + 'h' : '—') + '</strong></td>' +
    '<td><span class="tag t-' + r.status.toLowerCase().replace('-', '') + '">' + r.status + '</span></td></tr>'
  ).join('');

  renderDashPendingLeaves();
}

function renderDashPendingLeaves() {
  const el = document.getElementById('dash-pending-leaves');
  if (!el) return;
  const pending = leaveRequests.filter(l => l.status === 'Pending');
  if (!pending.length) { el.innerHTML = '<p style="color:var(--subtle);font-size:13px;">No pending requests.</p>'; return; }
  el.innerHTML = pending.map(l => leaveReqCard(l)).join('');
}

function actRow(r) {
  return '<div class="act-row"><div class="av ' + AV_COLORS[employees.findIndex(e => e.id === r.id) % AV_COLORS.length] + '">' + r.name.charAt(0) + '</div><div style="flex:1;"><div style="font-size:13px;font-weight:600;">' + r.name + '</div><div style="font-size:11px;color:var(--muted);">' + r.dept + '</div></div><span class="tag t-' + r.status.toLowerCase().replace('-', '').replace(' ', '') + '">' + r.status + '</span></div>';
}

// ── Records Tab ──
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
  tbody.innerHTML = recs.map(r =>
    '<tr><td><span style="font-family:var(--font-mono);font-size:11px;color:var(--muted);">' + r.id + '</span></td>' +
    '<td><div style="display:flex;align-items:center;gap:8px;"><div class="av ' + AV_COLORS[employees.findIndex(e => e.id === r.id) % AV_COLORS.length] + '">' + r.name.charAt(0) + '</div>' + r.name + '</div></td>' +
    '<td><span class="chip ' + (DEPT_COLORS[r.dept] || 'c-eng') + '">' + r.dept + '</span></td>' +
    '<td>' + formatDate(r.date) + '</td>' +
    '<td><span style="font-family:var(--font-mono);font-size:12px;">' + (r.in || '—') + '</span></td>' +
    '<td><span style="font-family:var(--font-mono);font-size:12px;">' + (r.out || '—') + '</span></td>' +
    '<td><strong>' + (r.hours > 0 ? r.hours.toFixed(1) + 'h' : '—') + '</strong></td>' +
    '<td><span class="tag t-' + r.status.toLowerCase().replace('-', '').replace(' ', '') + '">' + r.status + '</span></td>' +
    '<td style="font-size:11px;color:var(--subtle);">' + (r.status === 'Half-Day' ? 'Late login>14:00' : '') + '</td></tr>'
  ).join('');
}

// ── Employee Table ──
function renderEmpTable() {
  const tbody = document.getElementById('emp-table-body');
  if (!tbody) return;
  const search = document.getElementById('emp-search')?.value.toLowerCase() || '';
  const deptF = document.getElementById('emp-dept-filter')?.value || '';
  let list = employees.filter(e => e.active);
  if (search) list = list.filter(e => e.name.toLowerCase().includes(search) || e.id.toLowerCase().includes(search));
  if (deptF) list = list.filter(e => e.dept === deptF);
  tbody.innerHTML = list.map((emp, i) =>
    '<tr><td><div class="av ' + AV_COLORS[i % AV_COLORS.length] + '">' + emp.name.charAt(0) + '</div></td>' +
    '<td><span style="font-family:var(--font-mono);font-size:12px;font-weight:600;">' + emp.id + '</span></td>' +
    '<td><strong>' + emp.name + '</strong></td>' +
    '<td><span class="chip ' + (DEPT_COLORS[emp.dept] || 'c-eng') + '">' + emp.dept + '</span></td>' +
    '<td style="color:var(--muted);font-size:12px;">' + (emp.designation || '—') + '</td>' +
    '<td style="font-size:12px;">' + emp.email + '</td>' +
    '<td style="font-size:12px;">' + (emp.phone || '—') + '</td>' +
    '<td style="font-size:12px;">' + (emp.bday ? formatDate(emp.bday) : '—') + '</td>' +
    '<td><button class="btn btn-sm" onclick="openEditEmpModal(\'' + emp.id + '\')" title="Edit">✏️</button> ' +
    '<button class="btn btn-sm" onclick="archiveEmployee(' + employees.indexOf(emp) + ')" title="Archive">📦</button> ' +
    '<button class="btn btn-sm btn-danger" onclick="openDeleteEmpModal(\'' + emp.id + '\')" title="Remove">🗑</button></td></tr>'
  ).join('');
}

// ── Employee CRUD ──
function archiveEmployee(idx) {
  if (!confirm('Archive ' + employees[idx].name + '? They will be moved to the archived employees section.')) return;
  const emp = employees[idx];
  api('/api/employees/' + emp.id + '/archive', { method: 'POST' });
  archivedEmployees.push({ id: emp.id, name: emp.name, dept: emp.dept, status: 'Archived', joining: emp.joining, exit: new Date().toISOString().split('T')[0] });
  employees[idx].active = false;
  saveToLocalStorage();
  renderEmpTable();
  renderArchivedTable();
  updateDashboardStats();
  showNotifBar('info', emp.name + ' has been archived.', '📦');
}

function openDeleteEmpModal(id) {
  deleteTargetId = id;
  const emp = employees.find(e => e.id === id);
  if (emp) document.getElementById('delete-emp-name').innerText = emp.name + ' (' + emp.id + ')';
  document.getElementById('delete-emp-modal').style.display = 'flex';
}

function closeDeleteEmpModal() {
  document.getElementById('delete-emp-modal').style.display = 'none';
  deleteTargetId = null;
}

async function confirmDeleteEmployee() {
  if (!deleteTargetId) return;
  const emp = employees.find(e => e.id === deleteTargetId);
  if (!emp) { showNotifBar('error', 'Employee not found.', '❌'); closeDeleteEmpModal(); return; }
  archivedEmployees.push({ id: emp.id, name: emp.name, dept: emp.dept, status: 'Deleted', joining: emp.joining, exit: new Date().toISOString().split('T')[0] });
  employees = employees.filter(e => e.id !== deleteTargetId);
  saveToLocalStorage();
  closeDeleteEmpModal();
  renderEmpTable();
  renderArchivedTable();
  updateDashboardStats();
  renderLeaveBalances();
  renderDeptHeadcount();
  showNotifBar('info', emp.name + ' has been removed.', '🗑');
  // Sync to server if available (fire-and-forget)
  api('/api/employees/' + deleteTargetId, { method: 'DELETE' }).then(r => {
    if (!r || !r.success) console.warn('Server sync failed for employee delete (expected on static hosting)');
  });
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
  if (!name || !id || !dept) { showNotifBar('warning', 'Please fill in all required fields (*)', '⚠️'); return; }
  if (mode === 'add') {
    if (employees.some(e => e.id === id)) { showNotifBar('warning', 'Employee ID already exists.', '⚠️'); return; }
    const newEmp = { id, name, dept, email, phone, bday, joining, designation, cl, sl, ul: 0, active: true, password: pwd || 'emp123' };
    employees.push(newEmp);
    api('/api/employees', { method: 'POST', body: newEmp });
    saveToLocalStorage();
    closeAddEmpModal();
    renderEmpTable();
    renderLeaveBalances();
    updateDashboardStats();
    showNotifBar('success', 'Employee ' + name + ' added successfully!', '✓');
  } else {
    const emp = employees.find(e => e.id === editId);
    if (!emp) { showNotifBar('error', 'Employee not found.', '❌'); return; }
    emp.name = name; emp.dept = dept; emp.email = email; emp.phone = phone; emp.bday = bday; emp.joining = joining; emp.designation = designation;
    if (pwd) emp.password = pwd;
    emp.cl = cl; emp.sl = sl;
    api('/api/employees/' + editId, { method: 'PUT', body: { name, dept, email, phone, bday, joining, designation, cl, sl, password: pwd || undefined } });
    saveToLocalStorage();
    closeAddEmpModal();
    renderEmpTable();
    renderLeaveBalances();
    updateDashboardStats();
    showNotifBar('success', 'Employee ' + name + ' updated successfully!', '✓');
  }
}

// ── Leave Management ──
function leaveReqCard(l) {
  const typeColor = l.type === 'CL' ? 'c-eng' : l.type === 'SL' ? 'c-mkt' : 'c-it';
  const statusTag = l.status === 'Pending' ? '<span class="tag t-late">Pending</span>' : l.status === 'Approved' ? '<span class="tag t-present">Approved</span>' : '<span class="tag t-absent">Rejected</span>';
  const actions = l.status === 'Pending'
    ? '<button class="btn btn-sm btn-success" onclick="handleLeave(' + l.idx + ',\'Approved\')">✓ Approve</button><button class="btn btn-sm btn-danger" onclick="handleLeave(' + l.idx + ',\'Rejected\')">✗ Reject</button>'
    : '';
  return '<div class="leave-req-card"><div class="av av-blue">' + l.empName.charAt(0) + '</div><div style="flex:1;">' +
    '<div style="font-size:13px;font-weight:600;">' + l.empName + ' <span class="chip ' + typeColor + '">' + l.type + '</span></div>' +
    '<div style="font-size:12px;color:var(--muted);margin-top:3px;">' + formatDate(l.from) + ' – ' + formatDate(l.to) + ' (' + l.days + ' day' + (l.days > 1 ? 's' : '') + ')</div>' +
    '<div style="font-size:12px;color:var(--subtle);margin-top:2px;">' + l.reason + '</div></div>' +
    '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">' + statusTag + '<div class="leave-req-actions">' + actions + '</div></div></div>';
}

function renderLeaveRequests() {
  const el = document.getElementById('leave-requests-list');
  if (!el) return;
  const pending = leaveRequests.filter(l => l.status === 'Pending');
  el.innerHTML = pending.length ? pending.map(l => leaveReqCard(l)).join('') : '<p style="color:var(--subtle);font-size:13px;">No pending requests 🎉</p>';
}

function handleLeave(idx, decision) {
  const req = leaveRequests[idx];
  const emp = employees.find(e => e.id === req.empId);
  if (emp && decision === 'Approved') {
    if (req.type === 'CL') {
      if (emp.cl >= req.days) { emp.cl -= req.days; }
      else { const deficit = req.days - emp.cl; emp.cl = 0; emp.ul += deficit; showNotifBar('warning', 'CL insufficient. ' + deficit + ' day(s) converted to Unpaid Leave.', '⚠️'); }
    } else if (req.type === 'SL') {
      const slNeeded = req.days * 0.5;
      const ulNeeded = req.days * 0.5;
      if (emp.sl >= slNeeded) { emp.sl -= slNeeded; emp.ul += ulNeeded; }
      else { emp.ul += req.days; emp.sl = Math.max(0, emp.sl - slNeeded); showNotifBar('warning', 'SL insufficient. Applied as Unpaid Leave.', '⚠️'); }
    }
  }
  leaveRequests[idx].status = decision;
  api('/api/leave-requests/' + idx, { method: 'PUT', body: { status: decision } });
  saveToLocalStorage();
  renderLeaveRequests();
  renderLeaveBalances();
  renderLeaveHistory();
  renderDashPendingLeaves();
  if (decision === 'Approved') { showNotifBar('success', 'Leave for ' + req.empName + ' Approved!', '✓'); addAdminNotif('Leave request from ' + req.empName + ' has been ' + decision + '.'); }
  else { showNotifBar('info', 'Leave for ' + req.empName + ' Rejected.', 'ℹ'); }
}

function renderLeaveBalances() {
  const tbody = document.getElementById('leave-balances-table');
  if (!tbody) return;
  tbody.innerHTML = employees.filter(e => e.active).map((emp, i) =>
    '<tr><td><div style="display:flex;align-items:center;gap:8px;"><div class="av ' + AV_COLORS[i % AV_COLORS.length] + '">' + emp.name.charAt(0) + '</div>' + emp.name + '</div></td>' +
    '<td><span class="chip ' + (DEPT_COLORS[emp.dept] || 'c-eng') + '">' + emp.dept + '</span></td>' +
    '<td><strong class="blue-v">' + emp.cl + '</strong> days</td>' +
    '<td><strong class="green-v">' + emp.sl + '</strong> days</td>' +
    '<td><strong class="red-v">' + emp.ul + '</strong> days</td>' +
    '<td><button class="btn btn-sm" onclick="openLeaveManage(' + employees.indexOf(emp) + ')">Adjust</button></td></tr>'
  ).join('');
}

function renderLeaveHistory() {
  const tbody = document.getElementById('leave-history-table');
  if (!tbody) return;
  tbody.innerHTML = leaveRequests.map(l => {
    const typeColor = l.type === 'CL' ? 'c-eng' : l.type === 'SL' ? 'c-mkt' : 'c-it';
    return '<tr><td>' + l.empName + '</td><td><span class="chip ' + typeColor + '">' + l.type + '</span></td><td>' + formatDate(l.from) + '</td><td>' + formatDate(l.to) + '</td><td>' + l.days + '</td><td><span class="tag t-' + l.status.toLowerCase() + '">' + l.status + '</span></td><td style="font-size:12px;color:var(--muted);">' + l.reason + '</td></tr>';
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
  showNotifBar('success', 'Leave balances updated for ' + emp.name + '.', '✓');
}

// ── Reports ──
function setReport(type, btn) {
  document.querySelectorAll('.rtab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const today = new Date().toISOString().split('T')[0];
  let recs = [];
  let title = '';
  if (type === 'daily') { recs = attendanceRecords.filter(r => r.date === today); title = 'Daily Report — ' + formatDate(today); }
  else if (type === 'weekly') { const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay()); recs = attendanceRecords.filter(r => new Date(r.date) >= weekStart); title = 'Weekly Report — Current Week'; }
  else { const mn = today.slice(0, 7); recs = attendanceRecords.filter(r => r.date.startsWith(mn)); title = 'Monthly Report — ' + new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }); }

  setText('rpt-title', title);
  setText('rpt-table-title', 'Detailed Records (' + recs.length + ')');
  const present = recs.filter(r => ['Present', 'Late', 'Half-Day'].includes(r.status)).length;
  const absent = recs.filter(r => r.status === 'Absent').length;
  const late = recs.filter(r => r.status === 'Late').length;
  const avgHrs = recs.length ? (recs.reduce((a, r) => a + r.hours, 0) / recs.length).toFixed(1) : 0;
  const sumEl = document.getElementById('rpt-summary');
  if (sumEl) sumEl.innerHTML = '<div class="sum-item"><span>Total Records</span><strong>' + recs.length + '</strong></div><div class="sum-item"><span>Present</span><strong class="green-v">' + present + '</strong></div><div class="sum-item"><span>Absent</span><strong class="red-v">' + absent + '</strong></div><div class="sum-item"><span>Late</span><strong class="amber-v">' + late + '</strong></div><div class="sum-item"><span>Avg Hours</span><strong>' + avgHrs + 'h</strong></div>';

  const depts = [...new Set(recs.map(r => r.dept))];
  const colors = ['bf-blue', 'bf-green', 'bf-amber', 'bf-red', 'bf-purple', 'bf-green'];
  const attEl = document.getElementById('rpt-att-bars');
  const hrEl = document.getElementById('rpt-hr-bars');
  if (attEl) attEl.innerHTML = depts.map((d, i) => {
    const dr = recs.filter(r => r.dept === d);
    const pr = dr.filter(r => ['Present', 'Late', 'Half-Day'].includes(r.status)).length;
    const pct = dr.length ? Math.round(pr / dr.length * 100) : 0;
    return '<div class="bar-row"><span class="bar-label">' + d + '</span><div class="bar-track"><div class="bar-fill ' + colors[i % colors.length] + '" style="width:' + pct + '%"></div></div><span class="bar-val">' + pct + '%</span></div>';
  }).join('');
  if (hrEl) hrEl.innerHTML = depts.map((d, i) => {
    const dr = recs.filter(r => r.dept === d && r.hours > 0);
    const avg = dr.length ? (dr.reduce((a, r) => a + r.hours, 0) / dr.length).toFixed(1) : 0;
    const pct = Math.min(Math.round(parseFloat(avg) / 10 * 100), 100);
    return '<div class="bar-row"><span class="bar-label">' + d + '</span><div class="bar-track"><div class="bar-fill ' + colors[i % colors.length] + '" style="width:' + pct + '%"></div></div><span class="bar-val">' + avg + 'h</span></div>';
  }).join('');

  const thead = document.getElementById('rpt-thead');
  const tbody = document.getElementById('rpt-table');
  if (thead) thead.innerHTML = '<th>ID</th><th>Employee</th><th>Dept</th><th>Date</th><th>In</th><th>Out</th><th>Hours</th><th>Status</th>';
  if (tbody) tbody.innerHTML = recs.map(r => '<tr><td><span style="font-family:var(--font-mono);font-size:11px;color:var(--muted);">' + r.id + '</span></td><td>' + r.name + '</td><td><span class="chip ' + (DEPT_COLORS[r.dept] || 'c-eng') + '">' + r.dept + '</span></td><td>' + formatDate(r.date) + '</td><td><span style="font-family:var(--font-mono);font-size:12px;">' + (r.in || '—') + '</span></td><td><span style="font-family:var(--font-mono);font-size:12px;">' + (r.out || '—') + '</span></td><td>' + (r.hours > 0 ? r.hours.toFixed(1) + 'h' : '—') + '</td><td><span class="tag t-' + r.status.toLowerCase().replace('-', '').replace(' ', '') + '">' + r.status + '</span></td></tr>').join('');
}

// ── Admin Password Change ──
function changeAdminPwd() {
  const cur = document.getElementById('a-cur-pwd').value.trim();
  const newPwd = document.getElementById('a-new-pwd').value.trim();
  const conf = document.getElementById('a-conf-pwd').value.trim();
  const expectedAdminPwd = adminPassword || 'quemah123';
  if (cur !== expectedAdminPwd) { showNotifBar('error', 'Current password is incorrect.', '❌'); return; }
  if (newPwd.length < 6) { showNotifBar('warning', 'New password must be at least 6 characters.', '⚠️'); return; }
  if (newPwd !== conf) { showNotifBar('warning', 'Passwords do not match.', '⚠️'); return; }
  adminPassword = newPwd;
  saveToLocalStorage();
  // Sync password change to server
  api('/api/password', {
    method: 'PUT',
    body: { userId: 'quemahtech', currentPwd: cur, newPwd: newPwd }
  });
  document.getElementById('a-cur-pwd').value = '';
  document.getElementById('a-new-pwd').value = '';
  document.getElementById('a-conf-pwd').value = '';
  document.getElementById('a-strength').style.width = '0%';
  showNotifBar('success', 'Admin password updated successfully!', '✓');
}

/* ═══════════════════════════════════
   EMPLOYEE JS — Employee portal functions
═══════════════════════════════════ */

// ── Employee Tab Navigation ──
function empTab(tabName, btnElement) {
  localStorage.setItem('empLastTab', tabName);
  switchTab('#page-employee', 'emp', tabName, btnElement, () => {
    if (tabName === 'history') renderEmpHistory();
  });
}

// ── Employee Dashboard ──
function renderEmpDashboard(emp) {
  const myRecs = attendanceRecords.filter(r => r.id === emp.id);
  const now = new Date();
  const monthStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
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
    return '<div class="bar-row"><span class="bar-label">' + d + '</span><div class="bar-track"><div class="bar-fill ' + colors[i] + '" style="width:' + pct + '%"></div></div><span class="bar-val">' + hrs + 'h</span></div>';
  }).join('');

  // Recent log
  const logEl = document.getElementById('emp-log');
  if (logEl) logEl.innerHTML = myRecs.slice(0, 7).map(r => {
    const dateObj = new Date(r.date);
    return '<tr><td>' + formatDate(r.date) + '</td><td style="color:var(--muted);font-size:12px;">' + DAYS[dateObj.getDay()] + '</td><td><span style="font-family:var(--font-mono);font-size:12px;">' + (r.in || '—') + '</span></td><td><span style="font-family:var(--font-mono);font-size:12px;">' + (r.out || '—') + '</span></td><td style="font-size:12px;">—</td><td><strong>' + (r.hours > 0 ? r.hours.toFixed(1) + 'h' : '—') + '</strong></td><td><span class="tag t-' + r.status.toLowerCase().replace('-', '').replace(' ', '') + '">' + r.status + '</span></td></tr>';
  }).join('');

  renderMyLeaveHistory(emp);
}

// ── Employee History ──
function renderEmpHistory() {
  const monthInp = document.getElementById('hist-month');
  const monthStr = monthInp?.value || new Date().toISOString().slice(0, 7);
  const uid = localStorage.getItem('userId');
  const emp = employees.find(e => e.id === uid) || employees[0];
  const recs = attendanceRecords.filter(r => r.id === emp.id && r.date.startsWith(monthStr));
  const present = recs.filter(r => ['Present', 'Late', 'Half-Day'].includes(r.status)).length;
  const hours = recs.reduce((a, r) => a + r.hours, 0);
  const summEl = document.getElementById('hist-summary');
  if (summEl) summEl.innerHTML = '<div class="sum-item"><span>Working Days</span><strong>' + recs.length + '</strong></div><div class="sum-item"><span>Present</span><strong class="green-v">' + present + '</strong></div><div class="sum-item"><span>Total Hours</span><strong>' + hours.toFixed(1) + 'h</strong></div>';
  const tbody = document.getElementById('hist-table');
  if (tbody) tbody.innerHTML = recs.map(r => {
    const dateObj = new Date(r.date);
    return '<tr><td>' + formatDate(r.date) + '</td><td style="color:var(--muted);">' + DAYS[dateObj.getDay()] + '</td><td><span style="font-family:var(--font-mono);font-size:12px;">' + (r.in || '—') + '</span></td><td><span style="font-family:var(--font-mono);font-size:12px;">' + (r.out || '—') + '</span></td><td>—</td><td><strong>' + (r.hours > 0 ? r.hours.toFixed(1) + 'h' : '—') + '</strong></td><td><span class="tag t-' + r.status.toLowerCase().replace('-', '').replace(' ', '') + '">' + r.status + '</span></td></tr>';
  }).join('');
}

// ── Punch Actions ──
function empPunchIn() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-IN', { hour12: true, hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toISOString().split('T')[0];
  const pill = document.getElementById('emp-pill');
  if (pill) { pill.className = 'status-pill sp-in'; pill.innerHTML = '<div class="status-dot sd-g"></div>Signed In'; }
  showNotifBar('success', 'Punched In at ' + timeStr, '✓');
  appendTimeline('in', 'Signed In', timeStr);
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
    const inTimeStr = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    if (!rec) {
      rec = { id: emp.id, name: emp.name, dept: emp.dept, date: dateStr, in: inTimeStr, out: '', hours: 0, status: status };
      attendanceRecords.unshift(rec);
    } else { rec.in = inTimeStr; rec.status = status; }
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
  showNotifBar('info', 'Punched Out at ' + timeStr, '←');
  appendTimeline('out', 'Signed Out', timeStr);
  const uid = localStorage.getItem('userId');
  const emp = employees.find(e => e.id === uid);
  if (emp) {
    let rec = attendanceRecords.find(r => r.id === emp.id && r.date === dateStr);
    const h = now.getHours();
    const m = now.getMinutes();
    const outTimeStr = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    if (rec && rec.in) {
      rec.out = outTimeStr;
      const [inH, inM] = rec.in.split(':').map(Number);
      const diffHrs = (h - inH) + (m - inM) / 60;
      rec.hours = Math.max(0, parseFloat(diffHrs.toFixed(2)));
    } else {
      rec = { id: emp.id, name: emp.name, dept: emp.dept, date: dateStr, in: '', out: outTimeStr, hours: 0, status: 'Present' };
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
      if (disp) disp.innerText = m + ':' + s;
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
    showNotifBar('info', 'Break ended — Duration: ' + dur, '☕');
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
  item.innerHTML = '<div class="timeline-dot td-' + type + '" style="background:' + (colors[type] || colors.in) + '"></div><div class="timeline-content">' + text + '<div class="timeline-time">' + time + '</div></div>';
  tl.prepend(item);
}

function autoAttendancePunchIn(emp) {
  const today = new Date().toISOString().split('T')[0];
  const existingRec = attendanceRecords.find(r => r.id === emp.id && r.date === today);
  if (!existingRec || !existingRec.in) {
    setTimeout(() => empPunchIn(), 700);
  } else {
    const pill = document.getElementById('emp-pill');
    if (pill && existingRec.in) { pill.className = 'status-pill sp-in'; pill.innerHTML = '<div class="status-dot sd-g"></div>Signed In'; }
  }
  if (new Date().getHours() >= 18) { setTimeout(() => tryAutoSignOutAt6pm(), 1200); }
}

// ── Leave Request ──
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
  let msg = days + ' working day(s) requested.';
  if (currentLeaveType === 'CL') msg += ' Your CL balance: ' + emp.cl + ' days.' + (emp.cl < days ? ' ⚠️ ' + (days - emp.cl) + ' day(s) will become Unpaid.' : '');
  else if (currentLeaveType === 'SL') msg += ' Your SL balance: ' + emp.sl + ' days. Note: Each SL day = 0.5 SL + 0.5 Unpaid.';
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
  api('/api/leave-requests', { method: 'POST', body: newReq });
  api('/api/notifications', { method: 'POST', body: { text: 'New leave request from ' + emp.name + ' (' + currentLeaveType + ') for ' + formatDate(from) + '.', target: 'admin' } });
  saveToLocalStorage();
  renderMyLeaveHistory(emp);
  showNotifBar('success', 'Leave request submitted! Awaiting admin approval.', '✓');
  addAdminNotif('New leave request from ' + emp.name + ' (' + currentLeaveType + ') for ' + formatDate(from) + '.');
  document.getElementById('leave-reason').value = '';
}

function renderMyLeaveHistory(emp) {
  const el = document.getElementById('my-leave-history');
  if (!el) return;
  const myLeaves = leaveRequests.filter(l => l.empId === emp.id);
  if (!myLeaves.length) { el.innerHTML = '<p style="color:var(--subtle);font-size:13px;">No leave history.</p>'; return; }
  el.innerHTML = myLeaves.map(l => {
    const typeColor = l.type === 'CL' ? 'c-eng' : l.type === 'SL' ? 'c-mkt' : 'c-it';
    return '<div class="leave-req-card" style="flex-wrap:wrap;"><div style="flex:1;"><div style="font-size:13px;font-weight:600;"><span class="chip ' + typeColor + '">' + l.type + '</span> ' + formatDate(l.from) + ' – ' + formatDate(l.to) + '</div><div style="font-size:12px;color:var(--muted);">' + l.days + ' day(s) | ' + l.reason + '</div></div><span class="tag t-' + l.status.toLowerCase() + '">' + l.status + '</span></div>';
  }).join('');
}

// ── Employee Password Change ──
function changeEmpPwd() {
  const cur = document.getElementById('e-cur-pwd').value.trim();
  const newPwd = document.getElementById('e-new-pwd').value.trim();
  const conf = document.getElementById('e-conf-pwd').value.trim();
  const uid = localStorage.getItem('userId');
  const emp = employees.find(e => e.id === uid);
  if (!emp) return;
  const expectedPwd = emp.password || 'emp123';
  if (cur !== expectedPwd) { showNotifBar('error', 'Current password is incorrect.', '❌'); return; }
  if (newPwd.length < 6) { showNotifBar('warning', 'New password must be at least 6 characters.', '⚠️'); return; }
  if (newPwd !== conf) { showNotifBar('warning', 'Passwords do not match.', '⚠️'); return; }
  emp.password = newPwd;
  saveToLocalStorage();
  document.getElementById('e-cur-pwd').value = '';
  document.getElementById('e-new-pwd').value = '';
  document.getElementById('e-conf-pwd').value = '';
  document.getElementById('e-strength').style.width = '0%';
  showNotifBar('success', 'Password updated successfully!', '✓');
}
