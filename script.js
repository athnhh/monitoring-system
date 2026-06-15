/* ═══════════════════════════════════
   SCRIPT.JS — Quemahtech Employee Management System
   Consolidated single file with server-backed data only.
═══════════════════════════════════ */

/* ═══════════════════════════════════
   SHARED JS — Global state, utilities, API, notifications
═══════════════════════════════════ */

const ADMIN_EMAIL = 'atharvashishn@gmail.com';

// ── Global State (loaded from server) ──
let currentUser = null;
let currentRole = '';
let currentLeaveType = 'CL';
let archivedVisible = false;
let adminNotifPanelOpen = false;
let empNotifPanelOpen = false;
let breakInterval = null;
let breakSeconds = 0;
let selectedLeaveManageIdx = null;
let deleteTargetId = null;
let annSelectedRecipient = 'all';
let annSelectedPriority = 'normal';
let serverAvailable = false;

// These are loaded from the server via /api/state — NOT in-memory arrays
let employees = [];
let archivedEmployees = [];
let attendanceRecords = [];
let leaveRequests = [];
let announcements = [];
let adminNotifications = [];
let empNotifications = [];
let departments = ["Engineering", "HR", "IT", "Marketing", "Finance", "Operations"];
let socket = null;

const DEPT_COLORS = {
  Engineering: 'c-eng', HR: 'c-hr', Marketing: 'c-mkt',
  Finance: 'c-fin', IT: 'c-it', Operations: 'c-ops'
};
const AV_COLORS = ['av-blue', 'av-green', 'av-purple', 'av-amber', 'av-teal', 'av-red', 'av-pink'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ═══════════════════════════════════════════════════════════════
// DYNAMIC API BASE URL
// ═══════════════════════════════════════════════════════════════
function resolveApiBase() {
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://localhost:3000';
  }
  return window.location.origin;
}

const API_BASE = resolveApiBase();
console.log('[EMS] API_BASE:', API_BASE);

// ── Socket.io Client ──
function connectSocketIO() {
  if (typeof io === 'undefined') {
    console.warn('Socket.io library not loaded, real-time updates disabled');
    return;
  }
  try {
    socket = io(API_BASE, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionAttempts: Infinity
    });
    socket.on('connect', () => {
      console.log('Socket.io connected:', socket.id);
      serverAvailable = true;
    });
    socket.on('disconnect', () => {
      console.log('Socket.io disconnected');
    });
    socket.on('connect_error', (err) => {
      console.warn('Socket.io connection error:', err.message);
      serverAvailable = false;
    });
    socket.on('notification', (data) => {
      console.log('Socket notification:', data);
      const targetList = data.target === 'admin' ? adminNotifications : empNotifications;
      const exists = targetList.some(n => n.text === data.text && n.time === data.time);
      if (!exists) {
        if (data.target === 'admin') {
          adminNotifications.unshift(data);
          updateAdminNotifBadge();
          renderAdminNotifPanel();
        } else {
          empNotifications.unshift(data);
          updateEmpNotifBadge();
          renderEmpNotifPanel();
        }
      }
    });
    socket.on('leave_request', (data) => {
      const idx = leaveRequests.findIndex(l => l.idx === data.idx);
      if (idx === -1) leaveRequests.unshift(data);
      renderLeaveRequests();
      renderLeaveHistory();
      renderDashPendingLeaves();
    });
    socket.on('leave_update', (data) => {
      const idx = leaveRequests.findIndex(l => l.idx === data.idx);
      if (idx !== -1) leaveRequests[idx] = data;
      renderLeaveRequests();
      renderLeaveHistory();
      renderDashPendingLeaves();
    });
    socket.on('employee_added', (data) => {
      if (!employees.find(e => e.id === data.id)) {
        employees.push(data);
        renderEmpTable();
        renderLeaveBalances();
        updateDashboardStats();
      }
    });
    socket.on('employee_deleted', (data) => {
      employees = employees.filter(e => e.id !== data.id);
      renderEmpTable();
      renderLeaveBalances();
      updateDashboardStats();
    });
    socket.on('password_changed', () => {
      showNotifBar('info', 'Password was changed in another session.', '🔑');
    });
    socket.on('leave_balance_updated', (data) => {
      const emp = employees.find(e => e.id === data.id);
      if (emp) { emp.cl = data.cl; emp.sl = data.sl; emp.ul = data.ul; }
      renderLeaveBalances();
    });
    socket.on('password_reset', (data) => {
      console.log('Password reset received via socket:', data);
      const pwdDisplay = document.getElementById('fp-temp-password');
      const statusEl = document.getElementById('fp-status-message');
      if (pwdDisplay && data.tempPassword) {
        pwdDisplay.textContent = data.tempPassword;
        pwdDisplay.style.display = 'block';
      }
      if (statusEl) {
        statusEl.innerHTML = '✅ <strong>Temporary password generated!</strong> Use the password below to log in. It expires in <strong>10 minutes</strong>.';
        statusEl.style.display = 'block';
        statusEl.style.color = 'var(--green-text)';
        statusEl.style.background = 'var(--green-bg)';
      }
      const sendBtn = document.querySelector('#forgot-modal .btn-primary');
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.textContent = '🔑 Generate Reset Password';
      }
      showNotifBar('success', '🔑 Temporary password delivered! Check the modal.', '🔑');
    });
  } catch (e) {
    console.warn('Socket.io init failed:', e.message);
  }
}

/* ═══════════════════════════════════
   ADMIN JS — Admin panel functions
═══════════════════════════════════ */

function adminTab(tabName, btnElement) {
  localStorage.setItem('adminLastTab', tabName);
  switchTab('#page-admin', 'admin', tabName, btnElement, () => {
    if (tabName === 'records') renderRecords();
    if (tabName === 'reports') setReport('daily', document.querySelector('.rtab.active'));
    if (tabName === 'settings') { loadCalendarConfig(); }
  });
}

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

function archiveEmployee(idx) {
  if (!confirm('Archive ' + employees[idx].name + '? They will be moved to the archived employees section.')) return;
  const emp = employees[idx];
  api('/api/employees/' + emp.id + '/archive', { method: 'POST' });
  archivedEmployees.push({ id: emp.id, name: emp.name, dept: emp.dept, status: 'Archived', joining: emp.joining, exit: new Date().toISOString().split('T')[0] });
  employees[idx].active = false;
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
  closeDeleteEmpModal();
  renderEmpTable();
  renderArchivedTable();
  updateDashboardStats();
  renderLeaveBalances();
  renderDeptHeadcount();
  showNotifBar('info', emp.name + ' has been removed.', '🗑');
  api('/api/employees/' + deleteTargetId, { method: 'DELETE' });
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
    closeAddEmpModal();
    renderEmpTable();
    renderLeaveBalances();
    updateDashboardStats();
    showNotifBar('success', 'Employee ' + name + ' updated successfully!', '✓');
  }
}

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
    '<td><button class="btn btn-sm" onclick="openLeaveManage(' + employees.indexOf(emp) + ')\">Adjust</button></td></tr>'
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
  renderLeaveBalances();
  showNotifBar('success', 'Leave balances updated for ' + emp.name + '.', '✓');
}

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

function changeAdminPwd() {
  const cur = document.getElementById('a-cur-pwd').value.trim();
  const newPwd = document.getElementById('a-new-pwd').value.trim();
  const conf = document.getElementById('a-conf-pwd').value.trim();
  if (!cur || !newPwd || !conf) { showNotifBar('warning', 'Please fill in all fields.', '⚠️'); return; }
  if (newPwd.length < 6) { showNotifBar('warning', 'New password must be at least 6 characters.', '⚠️'); return; }
  if (newPwd !== conf) { showNotifBar('warning', 'Passwords do not match.', '⚠️'); return; }
  api('/api/auth/password', {
    method: 'PUT',
    body: { userId: 'quemahtech', currentPwd: cur, newPwd: newPwd }
  }).then(res => {
    if (res && res.success) {
      document.getElementById('a-cur-pwd').value = '';
      document.getElementById('a-new-pwd').value = '';
      document.getElementById('a-conf-pwd').value = '';
      document.getElementById('a-strength').style.width = '0%';
      showNotifBar('success', 'Admin password updated successfully!', '✓');
    } else {
      showNotifBar('error', (res && res.error) || 'Failed to update password.', '❌');
    }
  });
}

/* ═══════════════════════════════════
   EMPLOYEE JS
═══════════════════════════════════ */

function empTab(tabName, btnElement) {
  localStorage.setItem('empLastTab', tabName);
  switchTab('#page-employee', 'emp', tabName, btnElement, () => {
    if (tabName === 'history') renderEmpHistory();
  });
}

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

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const colors = ['bf-blue', 'bf-green', 'bf-amber', 'bf-red', 'bf-purple'];
  const barsEl = document.getElementById('emp-bars');
  if (barsEl) barsEl.innerHTML = days.map((d, i) => {
    const hrs = (Math.random() * 3 + 6).toFixed(1);
    const pct = Math.round(parseFloat(hrs) / 10 * 100);
    return '<div class="bar-row"><span class="bar-label">' + d + '</span><div class="bar-track"><div class="bar-fill ' + colors[i] + '" style="width:' + pct + '%"></div></div><span class="bar-val">' + hrs + 'h</span></div>';
  }).join('');

  const logEl = document.getElementById('emp-log');
  if (logEl) logEl.innerHTML = myRecs.slice(0, 7).map(r => {
    const dateObj = new Date(r.date);
    return '<tr><td>' + formatDate(r.date) + '</td><td style="color:var(--muted);font-size:12px;">' + DAYS[dateObj.getDay()] + '</td><td><span style="font-family:var(--font-mono);font-size:12px;">' + (r.in || '—') + '</span></td><td><span style="font-family:var(--font-mono);font-size:12px;">' + (r.out || '—') + '</span></td><td>—</td><td><strong>' + (r.hours > 0 ? r.hours.toFixed(1) + 'h' : '—') + '</strong></td><td><span class="tag t-' + r.status.toLowerCase().replace('-', '').replace(' ', '') + '">' + r.status + '</span></td></tr>';
  }).join('');

  renderMyLeaveHistory(emp);
}

function renderEmpHistory() {
  const monthInp = document.getElementById('hist-month');
  const monthStr = monthInp?.value || new Date().toISOString().slice(0, 7);
  const uid = localStorage.getItem('userId');
  const emp = employees.find(e => e.id === uid) || employees[0];
  if (!emp) return;
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

function empPunchIn() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-IN', { hour12: true, hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toISOString().split('T')[0];
  const h = now.getHours();
  const m = now.getMinutes();

  // Local time-block: reject if past 18:00
  if (h >= 18) {
    showNotifBar('error', 'Cannot sign in after 6:00 PM. Contact admin if you need a correction.', '⛔');
    return;
  }

  const pill = document.getElementById('emp-pill');
  if (pill) { pill.className = 'status-pill sp-in'; pill.innerHTML = '<div class="status-dot sd-g"></div>Signed In'; }
  showNotifBar('success', 'Punched In at ' + timeStr, '✓');
  appendTimeline('in', 'Signed In', timeStr);
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
  if (new Date().getHours() >= 18) { setTimeout(() => empPunchOut(), 1200); }
}

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
  if (!emp) return;
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
  if (!emp) { showNotifBar('error', 'Employee not found. Please log in again.', '❌'); return; }
  let days = 0;
  const d1 = new Date(from), d2 = new Date(to);
  for (let d = new Date(d1); d <= d2; d.setDate(d.getDate() + 1)) { if (d.getDay() !== 0 && d.getDay() !== 6) days++; }
  const newReq = { idx: leaveRequests.length, empId: emp.id, empName: emp.name, dept: emp.dept, type: currentLeaveType, from, to, days, reason, status: 'Pending' };
  leaveRequests.push(newReq);
  api('/api/leave-requests', { method: 'POST', body: newReq });
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

function changeEmpPwd() {
  const cur = document.getElementById('e-cur-pwd').value.trim();
  const newPwd = document.getElementById('e-new-pwd').value.trim();
  const conf = document.getElementById('e-conf-pwd').value.trim();
  const uid = localStorage.getItem('userId');
  const emp = employees.find(e => e.id === uid);
  if (!emp) return;
  if (cur !== emp.password) { showNotifBar('error', 'Current password is incorrect.', '❌'); return; }
  if (newPwd.length < 6) { showNotifBar('warning', 'New password must be at least 6 characters.', '⚠️'); return; }
  if (newPwd !== conf) { showNotifBar('warning', 'Passwords do not match.', '⚠️'); return; }
  api('/api/auth/password', { method: 'PUT', body: { userId: uid, currentPwd: cur, newPwd }});
  emp.password = newPwd;
  document.getElementById('e-cur-pwd').value = '';
  document.getElementById('e-new-pwd').value = '';
  document.getElementById('e-conf-pwd').value = '';
  document.getElementById('e-strength').style.width = '0%';
  showNotifBar('success', 'Password updated successfully!', '✓');
}

/* ═══════════════════════════════════
   FORGOT PASSWORD — EMAIL-TRIGGERED, REAL-TIME IN-APP DELIVERY (Admin only)
   - Admin enters registered email → server generates temp password → Socket.io delivers
   - Employee requests are rejected server-side
═══════════════════════════════════ */

function openAdminReset() {
  document.getElementById('forgot-uid').value = '';
  document.getElementById('forgot-modal').style.display = 'flex';
  const statusEl = document.getElementById('fp-status-message');
  if (statusEl) statusEl.style.display = 'none';
  const pwdDisplay = document.getElementById('fp-temp-password');
  if (pwdDisplay) {
    pwdDisplay.style.display = 'none';
    pwdDisplay.textContent = '';
  }
}

async function sendAdminReset() {
  const uid = document.getElementById('forgot-uid').value.trim();

  const sendBtn = document.querySelector('#forgot-modal .btn-primary');
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.textContent = '⏳ Generating...';
  }

  try {
    const res = await api('/api/auth/forgot-password', {
      method: 'POST',
      body: { uid }
    });

    if (res && res.success) {
      const statusEl = document.getElementById('fp-status-message');
      if (statusEl) {
        statusEl.innerHTML = '⏳ <strong>Waiting for password delivery via real-time connection...</strong>';
        statusEl.style.display = 'block';
        statusEl.style.color = 'var(--amber-text)';
        statusEl.style.background = 'var(--amber-bg)';
      }
      showNotifBar('info', '⏳ Generating temporary password... Check the modal for the password.', '🔑');
    } else {
      showNotifBar('error', (res && res.error) || 'Failed to generate reset password.', '❌');
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.textContent = '🔑 Generate Reset Password';
      }
    }
  } catch (e) {
    showNotifBar('error', 'Server unreachable: ' + e.message, '❌');
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.textContent = '🔑 Generate Reset Password';
    }
  }
}



/* ═══════════════════════════════════
   API HELPER
═══════════════════════════════════ */
async function api(url, opts = {}) {
  try {
    const fetchOpts = {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
    };
    if (opts.body) fetchOpts.body = JSON.stringify(opts.body);
    const res = await fetch(API_BASE + url, fetchOpts);
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: 'Request failed with status ' + res.status }));
      console.warn('API error:', url, errBody);
      return errBody;
    }
    return await res.json();
  } catch (e) {
    console.warn('API fetch failed:', url, e.message);
    return null;
  }
}

// ── Load State from Server (persistent Firebase backend) ──
async function loadStateFromServer() {
  const data = await api('/api/state');
  if (data) {
    employees = data.employees || [];
    archivedEmployees = data.archivedEmployees || [];
    attendanceRecords = data.attendanceRecords || [];
    leaveRequests = data.leaveRequests || [];
    announcements = data.announcements || [];
    adminNotifications = data.adminNotifications || [];
    empNotifications = data.empNotifications || [];
    if (data.departments && data.departments.length) departments = data.departments;
    return true;
  }
  return false;
}

// ── Notification Badge — dynamically updated from DB count across devices ──
function updateAdminNotifBadge() {
  const badge = document.getElementById('admin-notif-count');
  if (!badge) return;
  // Sync count from server for accuracy across devices
  api('/api/notifications/quemahtech').then(data => {
    if (data && typeof data.count === 'number') {
      const count = data.count;
      badge.textContent = count;
      badge.style.display = count > 0 ? 'flex' : 'none';
      // Also update the local array if notifications came back
      if (data.notifications) {
        adminNotifications = data.notifications;
      }
    } else {
      // Fallback: count from local array
      const unread = adminNotifications.filter(n => n.unread !== false).length;
      badge.textContent = unread;
      badge.style.display = unread > 0 ? 'flex' : 'none';
    }
  }).catch(() => {
    // Fallback: count from local array
    const unread = adminNotifications.filter(n => n.unread !== false).length;
    badge.textContent = unread;
    badge.style.display = unread > 0 ? 'flex' : 'none';
  });
}

function updateEmpNotifBadge() {
  const badge = document.getElementById('emp-notif-count');
  if (!badge) return;
  const uid = localStorage.getItem('userId');
  api('/api/notifications/' + uid).then(data => {
    if (data && typeof data.count === 'number') {
      const count = data.count;
      badge.textContent = count;
      badge.style.display = count > 0 ? 'flex' : 'none';
      if (data.notifications) {
        empNotifications = data.notifications;
      }
    } else {
      const unread = empNotifications.filter(n => n.unread !== false).length;
      badge.textContent = unread;
      badge.style.display = unread > 0 ? 'flex' : 'none';
    }
  }).catch(() => {
    const unread = empNotifications.filter(n => n.unread !== false).length;
    badge.textContent = unread;
    badge.style.display = unread > 0 ? 'flex' : 'none';
  });
}

function addAdminNotif(text) {
  const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  adminNotifications.unshift({ text, time, unread: true });
  updateAdminNotifBadge();
  renderAdminNotifPanel();
  api('/api/notifications', { method: 'POST', body: { text, target: 'admin' } });
}

function addEmpNotif(text, userId) {
  const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  empNotifications.unshift({ text, time, unread: true, userId });
  updateEmpNotifBadge();
  renderEmpNotifPanel();
  api('/api/notifications', { method: 'POST', body: { text, target: 'emp', userId } });
}

function toggleNotifPanel() {
  adminNotifPanelOpen = !adminNotifPanelOpen;
  document.getElementById('notif-panel').classList.toggle('open', adminNotifPanelOpen);
  if (adminNotifPanelOpen) {
    renderAdminNotifPanel();
    markAdminNotifsRead();
  }
}

function toggleEmpNotifPanel() {
  empNotifPanelOpen = !empNotifPanelOpen;
  document.getElementById('emp-notif-panel').classList.toggle('open', empNotifPanelOpen);
  if (empNotifPanelOpen) {
    renderEmpNotifPanel();
    markEmpNotifsRead();
  }
}

function markAdminNotifsRead() {
  adminNotifications.forEach(n => { n.unread = false; });
  updateAdminNotifBadge();
  api('/api/notifications/mark-read', { method: 'POST', body: { userId: ADMIN_EMAIL } });
}

function markEmpNotifsRead() {
  empNotifications.forEach(n => { n.unread = false; });
  updateEmpNotifBadge();
  const uid = localStorage.getItem('userId');
  api('/api/notifications/mark-read', { method: 'POST', body: { userId: uid } });
}

function renderAdminNotifPanel() {
  const body = document.getElementById('notif-panel-body');
  if (!body) return;
  if (!adminNotifications.length) {
    body.innerHTML = '<p style="color:var(--subtle);font-size:13px;text-align:center;padding:20px;">No notifications yet.</p>';
    return;
  }
  body.innerHTML = adminNotifications.map(n =>
    '<div class="notif-item' + (n.unread ? ' unread' : '') + '">' +
    '<div>' + n.text + '</div>' +
    '<div class="notif-item-time">' + (n.time || '') + '</div></div>'
  ).join('');
}

function renderEmpNotifPanel() {
  const body = document.getElementById('emp-notif-panel-body');
  if (!body) return;
  if (!empNotifications.length) {
    body.innerHTML = '<p style="color:var(--subtle);font-size:13px;text-align:center;padding:20px;">No notifications yet.</p>';
    return;
  }
  body.innerHTML = empNotifications.map(n =>
    '<div class="notif-item' + (n.unread ? ' unread' : '') + '">' +
    '<div>' + n.text + '</div>' +
    '<div class="notif-item-time">' + (n.time || '') + '</div></div>'
  ).join('');
}

function showNotifBar(type, msg, icon) {
  const bar = document.getElementById('notif-bar');
  const iconEl = document.getElementById('notif-icon');
  const textEl = document.getElementById('notif-text');
  if (!bar || !textEl) return;
  bar.className = 'notif-bar ' + type;
  if (iconEl) iconEl.textContent = icon || '✓';
  textEl.textContent = msg;
  bar.style.display = 'flex';
  clearTimeout(bar._hideTimer);
  bar._hideTimer = setTimeout(hideNotifBar, 5000);
}

function hideNotifBar() {
  const bar = document.getElementById('notif-bar');
  if (bar) bar.style.display = 'none';
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
}

function checkPwdStrength(inputId, barId) {
  const val = document.getElementById(inputId)?.value || '';
  const bar = document.getElementById(barId);
  if (!bar) return;
  let pct = 0;
  if (val.length >= 6) pct = 25;
  if (val.length >= 8) pct = 50;
  if (/[A-Z]/.test(val) && /[a-z]/.test(val)) pct = 75;
  if (/[^a-zA-Z0-9]/.test(val) && val.length >= 8) pct = 100;
  bar.style.width = pct + '%';
  bar.style.background = pct < 50 ? '#ef4444' : pct < 75 ? '#d97706' : '#16a34a';
}

/* ═══════════════════════════════════
   LOGIN / AUTH — Unified Single Form
   - Admin: enter quemahtech
   - Employee: enter Employee ID
╔═══════════════════════════════════ */

function toggleAdminReset() {
  // no-op: forgot password link is always visible now
}

async function doLogin() {
  const uid = document.getElementById('uid').value.trim();
  const pwd = document.getElementById('pwd').value.trim();
  const rememberMe = document.getElementById('remember-me')?.checked || false;

  if (!uid || !pwd) {
    document.getElementById('err-msg').style.display = 'flex';
    document.getElementById('err-msg-text').textContent = 'Please fill in all fields.';
    return;
  }

  document.getElementById('err-msg').style.display = 'none';

  // Login via server API (no role — server auto-detects)
  const res = await api('/api/auth/login', {
    method: 'POST',
    body: { uid, pwd }
  });

  // Handle server-side errors (time-block, DB down, etc.)
  if (!res) {
    document.getElementById('err-msg').style.display = 'flex';
    document.getElementById('err-msg-text').textContent = 'Server unreachable. Please ensure the server is running.';
    return;
  }

  if (res.error === 'TIME_BLOCK') {
    document.getElementById('err-msg').style.display = 'flex';
    document.getElementById('err-msg-text').textContent = res.message || 'Employee logins are blocked after 6:00 PM IST.';
    return;
  }

  if (res.success) {
    localStorage.setItem('userId', uid);
    if (rememberMe) localStorage.setItem('rememberedUser', uid);
    else localStorage.removeItem('rememberedUser');

    if (res.role === 'admin') {
      currentUser = { name: 'Administrator' };
      currentRole = 'admin';
      showAdminPage();
    } else if (res.role === 'employee') {
      currentUser = res.user;
      currentRole = 'employee';

      // Show half-day warning from server if applicable
      if (res.timeBlock && res.timeBlock.isHalfDay) {
        showNotifBar('warning', '⚠️ First login after 2:00 PM — today will be flagged as Half-Day.', '⚠️');
      }

      const empId = res.user.id;
      const emp = employees.find(e => e.id === empId);
      if (emp) {
        showEmployeePage(emp);
      } else {
        const loaded = await loadStateFromServer();
        if (loaded) {
          const emp2 = employees.find(e => e.id === empId);
          if (emp2) showEmployeePage(emp2);
        } else {
          showNotifBar('error', 'Employee data not available. Check database connection.', '❌');
        }
      }
    }
    return;
  }

  document.getElementById('err-msg').style.display = 'flex';
  document.getElementById('err-msg-text').textContent = 'Invalid credentials. Please try again.';
}

function logout() {
  currentUser = null;
  localStorage.removeItem('userId');
  document.getElementById('page-admin').classList.remove('active');
  document.getElementById('page-employee').classList.remove('active');
  document.getElementById('page-login').classList.add('active');
  document.getElementById('uid').value = '';
  document.getElementById('pwd').value = '';
  document.getElementById('err-msg').style.display = 'none';
  closeNotifPanels();
}

function closeNotifPanels() {
  adminNotifPanelOpen = false;
  empNotifPanelOpen = false;
  document.getElementById('notif-panel')?.classList.remove('open');
  document.getElementById('emp-notif-panel')?.classList.remove('open');
}

async function showAdminPage() {
  document.getElementById('page-login').classList.remove('active');
  document.getElementById('page-admin').classList.add('active');
  initClock('admin-clock');
  await loadStateAndRender();
}

function showEmployeePage(emp) {
  document.getElementById('page-login').classList.remove('active');
  document.getElementById('page-employee').classList.add('active');
  document.getElementById('emp-topbar-name').textContent = emp.name;
  document.getElementById('emp-badge').textContent = '👤 ' + emp.id;
  document.getElementById('emp-fullname').textContent = emp.name;
  document.getElementById('emp-details').textContent = emp.dept + (emp.designation ? ' — ' + emp.designation : '');
  document.getElementById('emp-av').textContent = emp.name.charAt(0);
  document.getElementById('emp-cl-bal').textContent = emp.cl;
  document.getElementById('emp-sl-bal').textContent = emp.sl;
  document.getElementById('emp-ul-used').textContent = emp.ul;
  document.getElementById('emp-cl-bal2').textContent = emp.cl;
  document.getElementById('emp-sl-bal2').textContent = emp.sl;
  document.getElementById('emp-ul-used2').textContent = emp.ul;
  initClock('emp-clock');
  renderEmpDashboard(emp);
  renderAnnouncementsEmp();
  autoAttendancePunchIn(emp);
}

function initClock(elId) {
  function tick() {
    const now = new Date();
    const el = document.getElementById(elId);
    if (el) el.textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  tick();
  setInterval(tick, 1000);
}

function toggleDarkMode() {
  document.body.classList.toggle('dark-mode');
  const isDark = document.body.classList.contains('dark-mode');
  localStorage.setItem('darkMode', isDark ? 'true' : 'false');
  document.querySelectorAll('.dark-toggle-btn').forEach(b => b.textContent = isDark ? '☀️' : '🌙');
}

function switchTab(pageId, prefix, tabName, btnElement, onShow) {
  const tabClass = prefix === 'admin' ? 'atab' : 'etab';
  const tabs = document.querySelectorAll(pageId + ' .' + tabClass);
  tabs.forEach(t => {
    t.classList.remove('show');
    t.classList.add('tab-leaving');
    setTimeout(() => t.classList.remove('tab-leaving'), 200);
  });
  const target = document.getElementById(prefix + '-' + tabName);
  if (target) {
    setTimeout(() => {
      target.classList.add('show');
      if (onShow) onShow();
    }, 100);
  }
  document.querySelectorAll(pageId + ' .nav-btn').forEach(b => b.classList.remove('active'));
  if (btnElement) btnElement.classList.add('active');
}

async function loadStateAndRender() {
  const loaded = await loadStateFromServer();
  if (loaded) {
    renderAll();
  } else {
    showNotifBar('warning', 'Could not load data from server. Check database connection.', '⚠');
  }
}

function renderAll() {
  updateDashboardStats();
  renderDashboardCards();
  renderRecords();
  renderEmpTable();
  renderArchivedTable();
  renderLeaveRequests();
  renderLeaveBalances();
  renderLeaveHistory();
  renderDeptHeadcount();
  renderDepartments();
  renderAnnouncements();
  updateAdminNotifBadge();
  updateEmpNotifBadge();
  renderAdminNotifPanel();
  renderEmpNotifPanel();
  const lastTab = localStorage.getItem('adminLastTab') || 'dashboard';
  const tabBtns = document.querySelectorAll('#page-admin .nav-btn');
  tabBtns.forEach(b => {
    if (b.textContent.includes('Dashboard') && lastTab === 'dashboard') b.click();
    else if (b.textContent.includes('Records') && lastTab === 'records') b.click();
    else if (b.textContent.includes('Employees') && lastTab === 'employees') b.click();
    else if (b.textContent.includes('Reports') && lastTab === 'reports') b.click();
    else if (b.textContent.includes('Departments') && lastTab === 'departments') b.click();
    else if (b.textContent.includes('Announce') && lastTab === 'announcements') b.click();
    else if (b.textContent.includes('Settings') && lastTab === 'settings') b.click();
  });
}

function renderArchivedTable() {
  const tbody = document.getElementById('archived-table-body');
  if (!tbody) return;
  tbody.innerHTML = archivedEmployees.map(a =>
    '<tr><td><span style="font-family:var(--font-mono);font-size:12px;">' + (a.id || '—') + '</span></td>' +
    '<td>' + a.name + '</td>' +
    '<td><span class="chip ' + (DEPT_COLORS[a.dept] || 'c-eng') + '">' + a.dept + '</span></td>' +
    '<td><span class="tag t-' + (a.status === 'Archived' ? 'leave' : 'absent') + '">' + a.status + '</span></td>' +
    '<td>' + (a.joining ? formatDate(a.joining) : '—') + '</td>' +
    '<td>' + (a.exit ? formatDate(a.exit) : '—') + '</td>' +
    '<td><button class="btn btn-sm" onclick="showNotifBar(&quot;info&quot;,&quot;Archived employee data is read-only.&quot;,&quot;ℹ️&quot;)">👁 View</button></td></tr>'
  ).join('');
}

function toggleArchived() {
  archivedVisible = !archivedVisible;
  document.getElementById('archived-section').style.display = archivedVisible ? 'block' : 'none';
  document.getElementById('archived-toggle').classList.toggle('active', archivedVisible);
  document.getElementById('archived-arrow').style.transform = archivedVisible ? 'rotate(90deg)' : '';
}

function renderDeptHeadcount() {
  const el = document.getElementById('dept-headcount-bars');
  if (!el) return;
  const counts = {};
  employees.filter(e => e.active).forEach(e => { counts[e.dept] = (counts[e.dept] || 0) + 1; });
  const max = Math.max(...Object.values(counts), 1);
  const colors = ['bf-blue', 'bf-green', 'bf-amber', 'bf-red', 'bf-purple', 'bf-green'];
  el.innerHTML = Object.entries(counts).map(([d, c], i) =>
    '<div class="bar-row"><span class="bar-label">' + d + '</span><div class="bar-track"><div class="bar-fill ' + colors[i % colors.length] + '" style="width:' + (c / max * 100) + '%"></div></div><span class="bar-val">' + c + '</span></div>'
  ).join('');
}

function renderDepartments() {
  const selects = ['f-dept', 'rec-dept', 'emp-dept-filter'];
  selects.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = departments.map(d => '<option value="' + d + '">' + d + '</option>').join('');
  });
  const tagList = document.getElementById('dept-tag-list');
  if (tagList) {
    tagList.innerHTML = departments.map(d =>
      '<span class="chip ' + (DEPT_COLORS[d] || 'c-eng') + '" style="display:inline-flex;align-items:center;gap:4px;padding:6px 12px;font-size:12px;">' +
      d + '<button onclick="removeDept(\'' + d + '\')" style="background:none;border:none;cursor:pointer;color:inherit;font-size:14px;padding:0;margin-left:2px;">×</button></span>'
    ).join('');
  }
}

async function addDept() {
  const input = document.getElementById('new-dept-input');
  if (!input || !input.value.trim()) return;
  const name = input.value.trim();
  if (departments.includes(name)) { showNotifBar('warning', 'Department already exists.', '⚠️'); return; }
  departments.push(name);
  input.value = '';
  renderDepartments();
  renderDeptHeadcount();
  await api('/api/departments', { method: 'POST', body: { name } });
  showNotifBar('success', 'Department \'' + name + '\' added.', '✓');
}

async function removeDept(name) {
  if (!confirm('Remove department \'' + name + '\'?')) return;
  departments = departments.filter(d => d !== name);
  renderDepartments();
  renderDeptHeadcount();
  await api('/api/departments/' + encodeURIComponent(name), { method: 'DELETE' });
  showNotifBar('info', 'Department \'' + name + '\' removed.', '🗑');
}

function selectAnnRecipient(btn, val) {
  document.querySelectorAll('.ann-recip-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  annSelectedRecipient = val;
  document.getElementById('ann-dept-select-wrap').style.display = val === 'dept' ? 'block' : 'none';
}

function selectAnnPriority(btn, val) {
  document.querySelectorAll('.ann-prior-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  annSelectedPriority = val;
}

function sendAnnouncement() {
  const subject = document.getElementById('ann-subject').value.trim();
  const body = document.getElementById('ann-body').value.trim();
  if (!subject || !body) { showNotifBar('warning', 'Please enter subject and message.', '⚠️'); return; }
  const today = new Date().toISOString().split('T')[0];
  const ann = { date: today, subject, body, by: 'Admin', priority: annSelectedPriority, recipient: annSelectedRecipient === 'all' ? 'All Employees' : 'Department: ' + (document.getElementById('ann-dept-select')?.value || '') };
  announcements.unshift(ann);
  renderAnnouncements();
  api('/api/announcements', { method: 'POST', body: ann });
  document.getElementById('ann-subject').value = '';
  document.getElementById('ann-body').value = '';
  document.getElementById('ann-charcount').textContent = '0';
  showNotifBar('success', 'Announcement sent!', '📢');
}

function previewAnnouncement() {
  const subject = document.getElementById('ann-subject').value.trim() || '(No subject)';
  const body = document.getElementById('ann-body').value.trim() || '(No message)';
  showNotifBar('info', '📢 ' + subject + ' — ' + body.substring(0, 100) + (body.length > 100 ? '…' : ''), '👁');
}

function renderAnnouncements() {
  const el = document.getElementById('announcements-list');
  if (!el) return;
  const badge = document.getElementById('ann-count-badge');
  if (badge) badge.textContent = announcements.length;
  if (!announcements.length) {
    el.innerHTML = '<div class="ann-empty-state"><span class="ann-empty-icon">📭</span><div class="ann-empty-text">No announcements yet</div><div class="ann-empty-sub">Your first announcement will appear here</div></div>';
    return;
  }
  el.innerHTML = announcements.map(a => {
    const cat = a.priority === 'urgent' ? 'ann-cat-urgent' : a.priority === 'high' ? 'ann-cat-high' : a.priority === 'low' ? 'ann-cat-general' : 'ann-cat-event';
    const pClass = 'priority-' + (a.priority || 'normal');
    return '<div class="announcement-card ' + pClass + '"><div class="ann-header"><div class="ann-header-left"><span class="ann-category-badge ' + cat + '">' + (a.priority || 'normal') + '</span><div class="ann-subject">' + a.subject + '</div></div></div><div class="ann-meta"><span class="ann-meta-item">📅 ' + formatDate(a.date) + '</span><span class="ann-meta-item">👤 ' + (a.by || 'Admin') + '</span><span class="ann-meta-item">👥 ' + (a.recipient || 'All Employees') + '</span></div><div class="ann-body">' + a.body.replace(/\n/g, '<br>') + '</div></div>';
  }).join('');
}

function renderAnnouncementsEmp() {
  const el = document.getElementById('emp-announcements-list');
  if (!el) return;
  const badge = document.getElementById('emp-ann-count');
  if (badge) badge.textContent = announcements.length;
  if (!announcements.length) {
    el.innerHTML = '<p style="color:var(--subtle);font-size:13px;">No announcements yet.</p>';
    return;
  }
  el.innerHTML = announcements.slice(0, 5).map(a => {
    const pClass = 'priority-' + (a.priority || 'normal');
    return '<div class="announcement-card ' + pClass + '" style="padding:14px 18px;"><div class="ann-header"><div class="ann-subject" style="font-size:14px;">' + a.subject + '</div><span style="font-size:12px;color:var(--subtle);">' + formatDate(a.date) + '</span></div><div class="ann-body" style="font-size:13px;">' + (a.body.length > 120 ? a.body.substring(0, 120) + '…' : a.body) + '</div></div>';
  }).join('');
}

function openComposeModal() {
  document.getElementById('compose-modal').style.display = 'flex';
  loadEmailConfig();
}

function closeComposeModal() {
  document.getElementById('compose-modal').style.display = 'none';
}

function sendCustomEmail() {
  const to = document.getElementById('compose-to').value.trim();
  const subject = document.getElementById('compose-subject').value.trim();
  const body = document.getElementById('compose-body').value.trim();
  if (!to || !subject) { showNotifBar('warning', 'Please fill in To and Subject.', '⚠️'); return; }
  // Send as in-app notification instead of SMTP email
  const text = '📧 [' + subject + '] to ' + to + ': ' + (body || '').replace(/<[^>]*>/g, '').substring(0, 100);
  addAdminNotif(text);
  api('/api/notifications', { method: 'POST', body: { text, target: 'admin' } });
  showNotifBar('success', 'Notification sent to admin panel!', '📨');
  closeComposeModal();
}

function clearCompose() {
  document.getElementById('compose-to').value = '';
  document.getElementById('compose-cc').value = '';
  document.getElementById('compose-bcc').value = '';
  document.getElementById('compose-subject').value = '';
  document.getElementById('compose-body').value = '';
  document.getElementById('compose-charcount-modal').textContent = '0';
}

function toggleCcBccModal() {
  const wrap = document.getElementById('compose-cc-wrap-modal');
  if (wrap) wrap.style.display = wrap.style.display === 'none' ? 'block' : 'none';
}

function toggleComposeView(view) {
  document.getElementById('compose-edit-btn').classList.toggle('active', view === 'edit');
  document.getElementById('compose-preview-btn').classList.toggle('active', view === 'preview');
  document.getElementById('compose-body-wrap').style.display = view === 'edit' ? 'flex' : 'none';
  document.getElementById('compose-preview-wrap').style.display = view === 'preview' ? 'flex' : 'none';
}

function wrapTag(textareaId, tag) {
  const ta = document.getElementById(textareaId);
  if (!ta) return;
  const start = ta.selectionStart, end = ta.selectionEnd;
  const text = ta.value;
  ta.value = text.substring(0, start) + '<' + tag + '>' + text.substring(start, end) + '</' + tag + '>' + text.substring(end);
}

function wrapHtml(textareaId, html) {
  const ta = document.getElementById(textareaId);
  if (!ta) return;
  const start = ta.selectionStart;
  ta.value = ta.value.substring(0, start) + html + ta.value.substring(ta.selectionEnd);
}

function loadEmailConfig() {
  const statusEl = document.getElementById('email-config-status');
  const serviceEl = document.getElementById('email-config-service');
  if (!statusEl) return;
  if (serviceEl) serviceEl.textContent = 'In-App';
  statusEl.textContent = '✅ Real-time delivery active';
  statusEl.style.color = 'var(--green)';
}

function loadCalendarConfig() {
  const statusEl = document.getElementById('calendar-config-status');
  const saEl = document.getElementById('calendar-config-sa');
  const idEl = document.getElementById('calendar-config-id');
  api('/api/calendar-config').then(cfg => {
    if (cfg) {
      if (statusEl) statusEl.textContent = cfg.enabled ? '✅ Connected' : 'Not configured';
      if (statusEl) statusEl.style.color = cfg.enabled ? 'var(--green)' : 'var(--amber)';
      if (saEl) saEl.textContent = cfg.serviceAccountPath || '—';
      if (idEl) idEl.textContent = cfg.calendarId || '—';
      if (cfg.enabled && document.getElementById('cal-sa-path')) {
        document.getElementById('cal-sa-path').value = cfg.serviceAccountPath || '';
        document.getElementById('cal-id').value = cfg.calendarId || 'primary';
      }
    }
  }).catch(() => {});
}

async function saveCalendarConfig() {
  const saPath = document.getElementById('cal-sa-path')?.value.trim() || '';
  const calId = document.getElementById('cal-id')?.value.trim() || 'primary';
  const res = await api('/api/calendar-config', {
    method: 'POST',
    body: { serviceAccountPath: saPath, calendarId: calId, enabled: !!(saPath) }
  });
  if (res && res.success) {
    showNotifBar('success', 'Calendar config saved!', '💾');
    loadCalendarConfig();
  } else {
    showNotifBar('error', 'Failed to save calendar config.', '❌');
  }
}

async function syncBirthdaysToCalendar() {
  showNotifBar('info', 'Syncing birthdays to calendar…', '📅');
  const res = await api('/api/calendar/sync-birthdays', { method: 'POST' });
  if (res && res.success) {
    showNotifBar('success', res.results.length + ' birthdays synced to calendar!', '📅');
  } else {
    showNotifBar('error', 'Calendar sync failed: ' + (res?.error || 'unknown'), '❌');
  }
}

async function testCalendarConnection() {
  showNotifBar('info', 'Testing calendar connection…', '🔌');
  const res = await api('/api/calendar-config');
  if (res && res.enabled) {
    showNotifBar('success', 'Calendar connection OK!', '✅');
  } else {
    showNotifBar('warning', 'Calendar not configured.', '⚠️');
  }
}

function exportCSV() {
  const rows = [['ID','Name','Dept','Date','In','Out','Hours','Status']];
  attendanceRecords.forEach(r => rows.push([r.id, r.name, r.dept, r.date, r.in, r.out, r.hours, r.status]));
  const csv = rows.map(r => r.join(',')).join('\n');
  downloadFile(csv, 'attendance_records.csv', 'text/csv');
}

function exportExcel(type) {
  if (typeof XLSX === 'undefined') { showNotifBar('warning', 'XLSX library not loaded.', '⚠️'); return; }
  try {
    if (type === 'records') {
      const data = attendanceRecords.map(r => ({ ID: r.id, Name: r.name, Dept: r.dept, Date: r.date, In: r.in, Out: r.out, Hours: r.hours, Status: r.status }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
      XLSX.writeFile(wb, 'attendance_records.xlsx');
    } else if (type === 'employees') {
      const data = employees.filter(e => e.active).map(e => ({ ID: e.id, Name: e.name, Dept: e.dept, Email: e.email, Phone: e.phone, Designation: e.designation, CL: e.cl, SL: e.sl, UL: e.ul }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Employees');
      XLSX.writeFile(wb, 'employees.xlsx');
    }
    showNotifBar('success', 'Excel file exported!', '📊');
  } catch (e) {
    showNotifBar('error', 'Export failed: ' + e.message, '❌');
  }
}

function exportEmpCSV() {
  const uid = localStorage.getItem('userId');
  const myRecs = attendanceRecords.filter(r => r.id === uid);
  const rows = [['Date','Day','In','Out','Hours','Status']];
  myRecs.forEach(r => {
    const d = new Date(r.date + 'T00:00:00');
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    rows.push([r.date, days[d.getDay()], r.in, r.out, r.hours, r.status]);
  });
  const csv = rows.map(r => r.join(',')).join('\n');
  downloadFile(csv, 'my_attendance.csv', 'text/csv');
  showNotifBar('success', 'CSV exported!', '📄');
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

async function checkServerHealth() {
  // Remove any existing banner first (handles re-init edge cases)
  const existing = document.getElementById('server-warning-banner');
  if (existing) existing.remove();

  // Test if the backend server is reachable
  const res = await api('/api/health');
  if (!res || res.status !== 'ok') {
    // Server is down — show a persistent warning
    const loginCard = document.querySelector('.login-card');
    if (loginCard) {
      const banner = document.createElement('div');
      banner.id = 'server-warning-banner';
      banner.style.cssText = 'background:rgba(220,38,38,0.15);border:1px solid rgba(220,38,38,0.3);border-radius:8px;padding:12px 14px;margin-bottom:20px;font-size:13px;color:#fca5a5;display:flex;align-items:center;gap:8px;';
      banner.innerHTML = '⚠️ <strong>Server offline</strong> — The backend server is not reachable. Please start the server with <code style="background:rgba(0,0,0,0.2);padding:2px 6px;border-radius:3px;">npm start</code>.';
      loginCard.prepend(banner);
    }
    serverAvailable = false;
  } else {
    serverAvailable = true;
  }
}

function init() {
  if (localStorage.getItem('darkMode') === 'true') {
    document.body.classList.add('dark-mode');
    document.querySelectorAll('.dark-toggle-btn').forEach(b => b.textContent = '☀️');
  }

  const remembered = localStorage.getItem('rememberedUser');
  if (remembered) {
    document.getElementById('uid').value = remembered;
    document.getElementById('remember-me').checked = true;
    // Trigger admin reset visibility check if remembered user is the admin
    if (typeof toggleAdminReset === 'function') toggleAdminReset();
  }

  // Check server health on load — show a banner if the backend is unreachable
  checkServerHealth();

  const annBody = document.getElementById('ann-body');
  if (annBody) {
    annBody.addEventListener('input', () => {
      document.getElementById('ann-charcount').textContent = annBody.value.length;
    });
  }
  const composeBody = document.getElementById('compose-body');
  if (composeBody) {
    composeBody.addEventListener('input', () => {
      document.getElementById('compose-charcount-modal').textContent = composeBody.value.length;
    });
  }
  const histMonth = document.getElementById('hist-month');
  if (histMonth) {
    histMonth.value = new Date().toISOString().slice(0, 7);
  }

  connectSocketIO();

  const h = new Date().getHours();
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const greetEl = document.getElementById('admin-greeting');
  if (greetEl) greetEl.textContent = greet + ', Administrator 👋';

  const today = new Date();
  const todayEl = document.getElementById('today-date');
  if (todayEl) todayEl.textContent = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const todayEl2 = document.getElementById('today-date2');
  if (todayEl2) todayEl2.textContent = today.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

document.addEventListener('DOMContentLoaded', init);
