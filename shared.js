/* ═══════════════════════════════════
   SHARED JS — Quemahtech Employee Management System
   Global state, utilities, API, notifications, exports
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

// ── Data Persistence (localStorage + server backup) ──
const DATA_KEY = 'ems_data';

function saveToLocalStorage() {
  // Always save to localStorage first (survives refreshes even without server)
  try {
    localStorage.setItem(DATA_KEY, JSON.stringify({
      employees, archivedEmployees, attendanceRecords, leaveRequests,
      announcements, adminNotifications, empNotifications, departments
    }));
  } catch (e) {
    console.error('localStorage save error:', e.message);
  }
  // Also try to sync to server (silently fails if server is not running)
  syncToServer();
}

function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data.employees) employees = data.employees;
      if (data.archivedEmployees) archivedEmployees = data.archivedEmployees;
      if (data.attendanceRecords) attendanceRecords = data.attendanceRecords;
      if (data.leaveRequests) leaveRequests = data.leaveRequests;
      if (data.announcements) announcements = data.announcements;
      if (data.adminNotifications) adminNotifications = data.adminNotifications;
      if (data.empNotifications) empNotifications = data.empNotifications;
      if (data.departments) departments = data.departments;
      return true;
    }
  } catch (e) {
    console.error('localStorage load error:', e.message);
  }
  return false;
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
      return {
        success: false,
        error: 'Server returned HTML instead of JSON (status ' + res.status + '). Make sure the Node.js server is running via "node server.js" and access the app at http://localhost:3000.'
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
  // Try server first
  const res = await api('/api/state');
  if (res.employees && res.employees.length > 0) {
    employees = res.employees;
    archivedEmployees = res.archivedEmployees || [];
    attendanceRecords = res.attendanceRecords || [];
    leaveRequests = res.leaveRequests || [];
    announcements = res.announcements || [];
    departments = res.departments || ['Engineering', 'HR', 'IT', 'Marketing', 'Finance', 'Operations'];
  } else if (loadFromLocalStorage()) {
    // Fall back to localStorage if server returned no data
    console.log('Loaded data from localStorage (server unavailable)');
  }
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
  downloadCSV(csv, emp.name.replace(/\\s+/g, '_') + '_attendance_' + monthStr + '.csv');
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

// ── Email Sending (server-side config via email-config.json) ──
function testSmtp() {
  showNotifBar('info', 'Testing SMTP connection from server config…', '🔌');
  api('/api/test-smtp', { method: 'POST' })
    .then(res => {
      if (res.success) showNotifBar('success', 'SMTP connection verified! ✓', '✓');
      else showNotifBar('error', 'SMTP failed: ' + (res.error || 'Unknown error'), '❌');
    }).catch(err => {
      showNotifBar('error', 'SMTP test failed: ' + err.message, '❌');
    });
}

// ── Load Email Config and Display in Settings ──
async function loadEmailConfig() {
  const res = await api('/api/email-config');
  const emailEl = document.getElementById('email-config-email');
  const hostEl = document.getElementById('email-config-host');
  const portEl = document.getElementById('email-config-port');
  const statusEl = document.getElementById('email-config-status');
  if (!emailEl) return;
  if (res.configured) {
    emailEl.innerText = res.email || '—';
    hostEl.innerText = res.host || '—';
    portEl.innerText = res.port || '—';
    statusEl.innerText = '✅ Configured';
    statusEl.style.color = 'var(--green)';
  } else {
    emailEl.innerText = 'Not configured';
    hostEl.innerText = '—';
    portEl.innerText = '—';
    statusEl.innerText = '❌ Not configured';
    statusEl.style.color = 'var(--red)';
  }
}

function updateSmtpStatus(res) {
  const from = document.getElementById('compose-from-display');
  if (from) {
    if (res && res.email) {
      from.value = res.email;
    } else {
      from.value = 'Server-configured (email-config.json)';
    }
  }
  const badge = document.getElementById('compose-status-badge');
  if (badge) { 
    badge.innerText = res && res.configured ? '● Connected' : '● Not configured';
    badge.className = 'compose-status-badge' + (res && res.configured ? ' connected' : '');
  }
  const status = document.getElementById('compose-smtp-status');
  if (status) { 
    if (res && res.configured) {
      status.innerText = res.email;
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
  if (btn) { btn.disabled = true; btn.innerHTML = '<span>⏳</span> Sending…'; }
  showNotifBar('info', 'Sending email to ' + to + '…', '📧');
  // Detect if body is already HTML (starts with <), send as-is; else convert newlines to <br>
  const isHtml = /^\s*</.test(body);
  const htmlContent = isHtml
    ? body
    : '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1e293b;line-height:1.7;">' +
      body.replace(/\n/g, '<br>') +
      '</div>';
  api('/api/send-email', {
    method: 'POST',
    body: { to, cc, bcc, subject, html: htmlContent }
  }).then(res => {
    if (res.success) {
      showNotifBar('success', 'Email sent successfully to ' + to + '!', '✓');
      clearCompose();
    } else {
      showNotifBar('error', 'Email failed: ' + (res.error || 'Unknown error'), '❌');
    }
  }).catch(err => {
    showNotifBar('error', 'Email failed: ' + err.message, '❌');
  }).finally(() => {
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
  // Fetch email config and update status/from display
  api('/api/email-config').then(res => {
    updateSmtpStatus(res);
  }).catch(() => {
    updateSmtpStatus(null);
  });
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
  const res = await api('/api/calendar-config');
  const statusEl = document.getElementById('calendar-config-status');
  const saEl = document.getElementById('calendar-config-sa');
  const idEl = document.getElementById('calendar-config-id');
  const saPathEl = document.getElementById('cal-sa-path');
  const calIdEl = document.getElementById('cal-id');
  if (!statusEl) return;
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
    return '<div class=\"announcement-card priority-' + prior + '\">' +
      '<div class=\"ann-header\"><div class=\"ann-header-left\">' +
      '<span class=\"ann-category-badge ' + priorClass + '\">' + priorLabel + '</span>' +
      '<strong class=\"ann-subject\">' + escHtml(a.subject) + '</strong></div></div>' +
      '<div class=\"ann-meta\">' +
      '<span class=\"ann-meta-item\">📅 ' + formatDate(a.date) + '</span>' +
      '<span class=\"ann-meta-item\">👤 ' + (a.by || 'Admin') + '</span>' +
      (a.recipient ? '<span class=\"ann-meta-item\">👥 ' + escHtml(a.recipient) + '</span>' : '') + '</div>' +
      '<div class=\"ann-body\">' + escHtml(a.body) + '</div></div>';
  }).join('');
  if (el) {
    if (announcements.length) { el.innerHTML = html; }
    else { el.innerHTML = '<div class=\"ann-empty-state\"><span class=\"ann-empty-icon\">📭</span><div class=\"ann-empty-text\">No announcements yet</div><div class=\"ann-empty-sub\">Send your first announcement above</div></div>'; }
  }
  if (empEl) {
    if (announcements.length) { empEl.innerHTML = html; }
    else { empEl.innerHTML = '<p style=\"color:var(--subtle);font-size:14px;text-align:center;padding:16px;\">No announcements yet.</p>'; }
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
  await api('/api/announcements', { method: 'POST', body: ann });
  subEl.value = '';
  bodyEl.value = '';
  const charCount = document.getElementById('ann-charcount');
  if (charCount) charCount.innerText = '0';
  renderAnnouncements();
  showNotifBar('success', 'Announcement sent successfully!', '📣');
  await api('/api/notifications', { method: 'POST', body: { text: 'New Announcement: ' + subject, target: 'emp' } });
  empNotifications.unshift({ text: 'New Announcement: ' + subject, time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }), unread: true });
  renderEmpNotifPanel();
}

function sendAnnouncement() { postAnnouncement(); }

function previewAnnouncement() {
  const subject = document.getElementById('ann-subject')?.value.trim();
  const body = document.getElementById('ann-body')?.value.trim();
  if (!subject || !body) { showNotifBar('warning', 'Please enter both subject and message to preview.', '⚠️'); return; }
  alert('Announcement Preview\\n\\nSubject: ' + subject + '\\n\\nMessage:\\n' + body);
}

// ── Department Management ──
function renderDepartments() {
  const tagList = document.getElementById('dept-tag-list');
  const recDept = document.getElementById('rec-dept');
  const empFilter = document.getElementById('emp-dept-filter');
  const fDept = document.getElementById('f-dept');
  if (tagList) tagList.innerHTML = departments.map(d =>
    '<span class=\"chip ' + (DEPT_COLORS[d] || 'c-eng') + '\" style=\"padding:4px 12px;font-size:12px;display:inline-flex;align-items:center;gap:5px;\">' + d +
    '<button style=\"background:none;border:none;cursor:pointer;color:inherit;font-size:14px;line-height:1;margin-left:2px;\" onclick=\"removeDept(\'' + d + '\')\">×</button></span>'
  ).join('');
  const allOpt = '<option value=\"\">All Departments</option>' + departments.map(d => '<option value=\"' + d + '\">' + d + '</option>').join('');
  const deptOpt = departments.map(d => '<option value=\"' + d + '\">' + d + '</option>').join('');
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
    '<div class=\"bar-row\"><span class=\"bar-label\">' + d + '</span><div class=\"bar-track\"><div class=\"bar-fill ' + colors[i % colors.length] + '\" style=\"width:' + Math.round(c / max * 100) + '%\"></div></div><span class=\"bar-val\">' + c + ' emp</span></div>'
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
    // Send to server via sendBeacon (Firebase/file-backed)
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
  // Restore dark mode preference first
  restoreDarkMode();
  connectWebSocket();

  // Load persisted data from server (Firebase or file-backed) before rendering
  await refreshState();

  updateClock();
  setInterval(updateClock, 1000);
  setAdminGreeting();

  // Set today's date on inputs
  const today = new Date().toISOString().split('T')[0];
  const mi = document.getElementById('hist-month');
  if (mi) mi.value = today.slice(0, 7);
  const lf = document.getElementById('leave-from');
  const lt = document.getElementById('leave-to');
  if (lf) lf.value = today;
  if (lt) lt.value = today;

  // Clear any stale session data — login page always shows first on fresh load.
  // Session only persists for the current page view after explicit login.
  localStorage.removeItem('loggedIn');
  localStorage.removeItem('userRole');
  localStorage.removeItem('userId');
  localStorage.removeItem('rememberMe');

  // Schedule 6pm auto sign-out for employees
  scheduleAutoSignOut();
});
