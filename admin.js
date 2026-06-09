/* ═══════════════════════════════════
   ADMIN JS — Admin panel functions
═══════════════════════════════════ */

// ── Admin Tab Navigation ──
function adminTab(tabName, btnElement) {
  switchTab('#page-admin', 'admin', tabName, btnElement, () => {
    if (tabName === 'records') renderRecords();
    if (tabName === 'reports') setReport('daily', document.querySelector('.rtab.active'));
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
      return '<div class=\"bar-row\"><span class=\"bar-label\">' + d + '</span><div class=\"bar-track\"><div class=\"bar-fill ' + color + '\" style=\"width:' + pct + '%\"></div></div><span class=\"bar-val\">' + pct + '%</span></div>';
    }).join('');
  }

  // Today's log table
  const logEl = document.getElementById('a-log');
  if (logEl) logEl.innerHTML = todayRecs.map(r =>
    '<tr><td><div style=\"display:flex;align-items:center;gap:8px;\"><div class=\"av ' + AV_COLORS[employees.findIndex(e => e.id === r.id) % AV_COLORS.length] + '\">' + r.name.charAt(0) + '</div><span>' + r.name + '</span></div></td>' +
    '<td><span class=\"chip ' + (DEPT_COLORS[r.dept] || 'c-eng') + '\">' + r.dept + '</span></td>' +
    '<td><span style=\"font-family:var(--font-mono);font-size:12px;\">' + (r.in || '—') + '</span></td>' +
    '<td><span style=\"font-family:var(--font-mono);font-size:12px;\">' + (r.out || '—') + '</span></td>' +
    '<td><strong>' + (r.hours > 0 ? r.hours.toFixed(1) + 'h' : '—') + '</strong></td>' +
    '<td><span class=\"tag t-' + r.status.toLowerCase().replace('-', '') + '\">' + r.status + '</span></td></tr>'
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
  return '<div class=\"act-row\"><div class=\"av ' + AV_COLORS[employees.findIndex(e => e.id === r.id) % AV_COLORS.length] + '\">' + r.name.charAt(0) + '</div><div style=\"flex:1;\"><div style=\"font-size:13px;font-weight:600;\">' + r.name + '</div><div style=\"font-size:11px;color:var(--muted);\">' + r.dept + '</div></div><span class=\"tag t-' + r.status.toLowerCase().replace('-', '').replace(' ', '') + '\">' + r.status + '</span></div>';
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
    '<tr><td><span style=\"font-family:var(--font-mono);font-size:11px;color:var(--muted);\">' + r.id + '</span></td>' +
    '<td><div style=\"display:flex;align-items:center;gap:8px;\"><div class=\"av ' + AV_COLORS[employees.findIndex(e => e.id === r.id) % AV_COLORS.length] + '\">' + r.name.charAt(0) + '</div>' + r.name + '</div></td>' +
    '<td><span class=\"chip ' + (DEPT_COLORS[r.dept] || 'c-eng') + '\">' + r.dept + '</span></td>' +
    '<td>' + formatDate(r.date) + '</td>' +
    '<td><span style=\"font-family:var(--font-mono);font-size:12px;\">' + (r.in || '—') + '</span></td>' +
    '<td><span style=\"font-family:var(--font-mono);font-size:12px;\">' + (r.out || '—') + '</span></td>' +
    '<td><strong>' + (r.hours > 0 ? r.hours.toFixed(1) + 'h' : '—') + '</strong></td>' +
    '<td><span class=\"tag t-' + r.status.toLowerCase().replace('-', '').replace(' ', '') + '\">' + r.status + '</span></td>' +
    '<td style=\"font-size:11px;color:var(--subtle);\">' + (r.status === 'Half-Day' ? 'Late login>14:00' : '') + '</td></tr>'
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
    '<tr><td><div class=\"av ' + AV_COLORS[i % AV_COLORS.length] + '\">' + emp.name.charAt(0) + '</div></td>' +
    '<td><span style=\"font-family:var(--font-mono);font-size:12px;font-weight:600;\">' + emp.id + '</span></td>' +
    '<td><strong>' + emp.name + '</strong></td>' +
    '<td><span class=\"chip ' + (DEPT_COLORS[emp.dept] || 'c-eng') + '\">' + emp.dept + '</span></td>' +
    '<td style=\"color:var(--muted);font-size:12px;\">' + (emp.designation || '—') + '</td>' +
    '<td style=\"font-size:12px;\">' + emp.email + '</td>' +
    '<td style=\"font-size:12px;\">' + (emp.phone || '—') + '</td>' +
    '<td style=\"font-size:12px;\">' + (emp.bday ? formatDate(emp.bday) : '—') + '</td>' +
    '<td><button class=\"btn btn-sm\" onclick=\"openEditEmpModal(\'' + emp.id + '\')\" title=\"Edit\">✏️</button> ' +
    '<button class=\"btn btn-sm\" onclick=\"archiveEmployee(' + employees.indexOf(emp) + ')\" title=\"Archive\">📦</button> ' +
    '<button class=\"btn btn-sm btn-danger\" onclick=\"openDeleteEmpModal(\'' + emp.id + '\')\" title=\"Remove\">🗑</button></td></tr>'
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
  const res = await api('/api/employees/' + deleteTargetId, { method: 'DELETE' });
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
    showNotifBar('info', emp.name + ' has been removed.', '🗑');
  } else { showNotifBar('error', 'Failed to remove employee.', '❌'); }
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
  return '<div class=\"leave-req-card\"><div class=\"av av-blue\">' + l.empName.charAt(0) + '</div><div style=\"flex:1;\">' +
    '<div style=\"font-size:13px;font-weight:600;\">' + l.empName + ' <span class=\"chip ' + typeColor + '\">' + l.type + '</span></div>' +
    '<div style=\"font-size:12px;color:var(--muted);margin-top:3px;\">' + formatDate(l.from) + ' – ' + formatDate(l.to) + ' (' + l.days + ' day' + (l.days > 1 ? 's' : '') + ')</div>' +
    '<div style=\"font-size:12px;color:var(--subtle);margin-top:2px;\">' + l.reason + '</div></div>' +
    '<div style=\"display:flex;flex-direction:column;align-items:flex-end;gap:6px;\">' + statusTag + '<div class=\"leave-req-actions\">' + actions + '</div></div></div>';
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
    '<tr><td><div style=\"display:flex;align-items:center;gap:8px;\"><div class=\"av ' + AV_COLORS[i % AV_COLORS.length] + '\">' + emp.name.charAt(0) + '</div>' + emp.name + '</div></td>' +
    '<td><span class=\"chip ' + (DEPT_COLORS[emp.dept] || 'c-eng') + '\">' + emp.dept + '</span></td>' +
    '<td><strong class=\"blue-v\">' + emp.cl + '</strong> days</td>' +
    '<td><strong class=\"green-v\">' + emp.sl + '</strong> days</td>' +
    '<td><strong class=\"red-v\">' + emp.ul + '</strong> days</td>' +
    '<td><button class=\"btn btn-sm\" onclick=\"openLeaveManage(' + employees.indexOf(emp) + ')\">Adjust</button></td></tr>'
  ).join('');
}

function renderLeaveHistory() {
  const tbody = document.getElementById('leave-history-table');
  if (!tbody) return;
  tbody.innerHTML = leaveRequests.map(l => {
    const typeColor = l.type === 'CL' ? 'c-eng' : l.type === 'SL' ? 'c-mkt' : 'c-it';
    return '<tr><td>' + l.empName + '</td><td><span class=\"chip ' + typeColor + '\">' + l.type + '</span></td><td>' + formatDate(l.from) + '</td><td>' + formatDate(l.to) + '</td><td>' + l.days + '</td><td><span class=\"tag t-' + l.status.toLowerCase() + '\">' + l.status + '</span></td><td style=\"font-size:12px;color:var(--muted);\">' + l.reason + '</td></tr>';
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
  if (sumEl) sumEl.innerHTML = '<div class=\"sum-item\"><span>Total Records</span><strong>' + recs.length + '</strong></div><div class=\"sum-item\"><span>Present</span><strong class=\"green-v\">' + present + '</strong></div><div class=\"sum-item\"><span>Absent</span><strong class=\"red-v\">' + absent + '</strong></div><div class=\"sum-item\"><span>Late</span><strong class=\"amber-v\">' + late + '</strong></div><div class=\"sum-item\"><span>Avg Hours</span><strong>' + avgHrs + 'h</strong></div>';

  const depts = [...new Set(recs.map(r => r.dept))];
  const colors = ['bf-blue', 'bf-green', 'bf-amber', 'bf-red', 'bf-purple', 'bf-green'];
  const attEl = document.getElementById('rpt-att-bars');
  const hrEl = document.getElementById('rpt-hr-bars');
  if (attEl) attEl.innerHTML = depts.map((d, i) => {
    const dr = recs.filter(r => r.dept === d);
    const pr = dr.filter(r => ['Present', 'Late', 'Half-Day'].includes(r.status)).length;
    const pct = dr.length ? Math.round(pr / dr.length * 100) : 0;
    return '<div class=\"bar-row\"><span class=\"bar-label\">' + d + '</span><div class=\"bar-track\"><div class=\"bar-fill ' + colors[i % colors.length] + '\" style=\"width:' + pct + '%\"></div></div><span class=\"bar-val\">' + pct + '%</span></div>';
  }).join('');
  if (hrEl) hrEl.innerHTML = depts.map((d, i) => {
    const dr = recs.filter(r => r.dept === d && r.hours > 0);
    const avg = dr.length ? (dr.reduce((a, r) => a + r.hours, 0) / dr.length).toFixed(1) : 0;
    const pct = Math.min(Math.round(parseFloat(avg) / 10 * 100), 100);
    return '<div class=\"bar-row\"><span class=\"bar-label\">' + d + '</span><div class=\"bar-track\"><div class=\"bar-fill ' + colors[i % colors.length] + '\" style=\"width:' + pct + '%\"></div></div><span class=\"bar-val\">' + avg + 'h</span></div>';
  }).join('');

  const thead = document.getElementById('rpt-thead');
  const tbody = document.getElementById('rpt-table');
  if (thead) thead.innerHTML = '<th>ID</th><th>Employee</th><th>Dept</th><th>Date</th><th>In</th><th>Out</th><th>Hours</th><th>Status</th>';
  if (tbody) tbody.innerHTML = recs.map(r => '<tr><td><span style=\"font-family:var(--font-mono);font-size:11px;color:var(--muted);\">' + r.id + '</span></td><td>' + r.name + '</td><td><span class=\"chip ' + (DEPT_COLORS[r.dept] || 'c-eng') + '\">' + r.dept + '</span></td><td>' + formatDate(r.date) + '</td><td><span style=\"font-family:var(--font-mono);font-size:12px;\">' + (r.in || '—') + '</span></td><td><span style=\"font-family:var(--font-mono);font-size:12px;\">' + (r.out || '—') + '</span></td><td>' + (r.hours > 0 ? r.hours.toFixed(1) + 'h' : '—') + '</td><td><span class=\"tag t-' + r.status.toLowerCase().replace('-', '').replace(' ', '') + '\">' + r.status + '</span></td></tr>').join('');
}

// ── Admin Password Change ──
function changeAdminPwd() {
  const cur = document.getElementById('a-cur-pwd').value.trim();
  const newPwd = document.getElementById('a-new-pwd').value.trim();
  const conf = document.getElementById('a-conf-pwd').value.trim();
  const expectedAdminPwd = localStorage.getItem('adminPassword') || 'quemah123';
  if (cur !== expectedAdminPwd) { showNotifBar('error', 'Current password is incorrect.', '❌'); return; }
  if (newPwd.length < 6) { showNotifBar('warning', 'New password must be at least 6 characters.', '⚠️'); return; }
  if (newPwd !== conf) { showNotifBar('warning', 'Passwords do not match.', '⚠️'); return; }
  localStorage.setItem('adminPassword', newPwd);
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
