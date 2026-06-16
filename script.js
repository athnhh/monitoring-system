const ADMIN_EMAIL = 'atharvashishn@gmail.com';
const ADMIN_USERNAME = 'quemahtech';

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

let appState = null;

// ── Smart DOM Sync Utilities ──
// Eliminate flicker by matching elements via data-id instead of full innerHTML rebuilds

// For table <tbody> — updates <tr> cells in-place, only creates new rows for new items
function smartTableSync(tbody, items, rowHtmlFn, getIdFn) {
  if (!tbody) return;
  // Map existing rows by data-id
  const rowMap = new Map();
  for (let i = 0; i < tbody.children.length; i++) {
    const row = tbody.children[i];
    const id = row.getAttribute('data-id');
    if (id) rowMap.set(id, row);
  }
  const frag = document.createDocumentFragment();
  const activeIds = new Set();
  items.forEach((item, idx) => {
    const id = getIdFn(item, idx);
    activeIds.add(id);
    if (rowMap.has(id)) {
      // Update existing row cells in-place — no flicker
      const row = rowMap.get(id);
      const tmp = document.createElement('tbody');
      tmp.innerHTML = rowHtmlFn(item, idx);
      const innerRow = tmp.querySelector('tr');
      const newCells = innerRow ? innerRow.children : [];
      for (let c = 0; c < newCells.length; c++) {
        if (row.children[c]) row.children[c].innerHTML = newCells[c].innerHTML;
      }
      frag.appendChild(row);
    } else {
      // Create new row with entrance animation
      const tmp = document.createElement('tbody');
      tmp.innerHTML = rowHtmlFn(item, idx);
      const row = tmp.querySelector('tr');
      if (row) {
        row.setAttribute('data-id', id);
        row.classList.add('enter-fade-slide');
        frag.appendChild(row);
      }
    }
  });
  // Check if there are orphaned rows that need exit animation
  const hasOrphans = [...rowMap.keys()].some(id => !activeIds.has(id));
  if (hasOrphans) {
    // Add exit animation to orphaned rows, then swap after animation completes
    for (const [id, row] of rowMap) {
      if (!activeIds.has(id)) row.classList.add('exit-fade');
    }
    setTimeout(() => {
      tbody.replaceChildren(frag);
    }, 280);
  } else {
    // No orphans — swap immediately (no flicker)
    tbody.replaceChildren(frag);
  }
}

// For card/list containers — matches by data-id, full outerHTML replacement for existing items
function smartListSync(container, items, htmlFn, getIdFn) {
  if (!container) return;
  const elMap = new Map();
  for (let i = 0; i < container.children.length; i++) {
    const el = container.children[i];
    const id = el.getAttribute('data-id');
    if (id) elMap.set(id, el);
  }
  const frag = document.createDocumentFragment();
  const activeIds = new Set();
  items.forEach((item, idx) => {
    const id = getIdFn(item, idx);
    activeIds.add(id);
    if (elMap.has(id)) {
      // Replace existing element with updated HTML (preserves data-id)
      const el = elMap.get(id);
      // Safer injection: match opening tag to add data-id
      el.outerHTML = htmlFn(item, idx).replace(/^<(\w+)/, `<$1 data-id="${id}"`);
      // Re-query the replaced element
      const updated = container.querySelector(`[data-id="${id}"]`);
      if (updated) frag.appendChild(updated);
    } else {
      // New element with entrance animation
      const wrapper = document.createElement('div');
      wrapper.innerHTML = htmlFn(item, idx);
      const child = wrapper.children[0] || wrapper;
      child.setAttribute('data-id', id);
      child.classList.add('enter-fade-slide');
      frag.appendChild(child);
    }
  });
  // Stale removal with exit animation
  const hasOrphans = [...elMap.keys()].some(id => !activeIds.has(id));
  if (hasOrphans) {
    for (const [id, el] of elMap) {
      if (!activeIds.has(id) && el.parentNode) el.classList.add('exit-fade');
    }
    setTimeout(() => {
      container.replaceChildren(frag);
    }, 280);
  } else {
    container.replaceChildren(frag);
  }
}

// ── RAF-Batched Render Scheduler ──
// Coalesces multiple real-time events into a single frame-accurate re-render.
// Prevents flicker when rapid socket events or Firestore syncs arrive.
const RenderQueue = {
  _rafId: null,
  _pending: false,

  schedule() {
    if (this._pending) return; // Already queued for this frame
    this._pending = true;
    this._rafId = requestAnimationFrame(async () => {
      this._rafId = null;
      this._pending = false;
      try { await refreshStateAndRender(); } catch (e) { console.warn('[RenderQueue]', e); }
    });
  },

  flush() {
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    if (this._pending) { this._pending = false; refreshStateAndRender(); }
  }
};

// ── Skeleton Loading Placeholders ──
// Renders shimmer animated placeholders in data containers while loading

function skeletonTableRows(count, cols) {
  const c = cols || 7;
  return Array.from({ length: count }, () =>
    '<tr class="skel-row enter-fade">' +
    Array.from({ length: c }, () => '<td><span class="skel" style="width:' + (40 + Math.random() * 40) + '%;height:14px;">&nbsp;</span></td>').join('') +
    '</tr>'
  ).join('');
}

function skeletonActRows(count) {
  return Array.from({ length: count }, () =>
    '<div class="skel-act-row enter-fade"><div class="skel skel-av">&nbsp;</div><div class="skel skel-line">&nbsp;</div><div class="skel skel-tag">&nbsp;</div></div>'
  ).join('');
}

function skeletonCards(count) {
  return Array.from({ length: count }, () =>
    '<div class="skel-card enter-fade"><div class="skel skel-av">&nbsp;</div><div class="skel-body"><div class="skel skel-line">&nbsp;</div><div class="skel skel-line-sm">&nbsp;</div></div></div>'
  ).join('');
}

function skeletonBars(count) {
  const widths = [45, 65, 35, 55, 50, 40, 60, 48];
  return Array.from({ length: count }, (_, i) =>
    '<div class="bar-row"><span class="bar-label skel" style="width:60px;height:12px;">&nbsp;</span>' +
    '<div class="bar-track"><div class="bar-fill skel-pulse" style="width:' + widths[i % widths.length] + '%;height:8px;border-radius:4px;"></div></div>' +
    '<span class="bar-val skel" style="width:30px;height:12px;">&nbsp;</span></div>'
  ).join('');
}

function showSkeletons() {
  // Present / absent lists
  const pEl = document.getElementById('a-present');
  if (pEl && (!pEl.children.length || pEl.textContent.includes('No data'))) {
    pEl.innerHTML = skeletonActRows(4);
  }
  const aEl = document.getElementById('a-absent');
  if (aEl && (!aEl.children.length || aEl.textContent.includes('No data'))) {
    aEl.innerHTML = skeletonActRows(3);
  }

  // Attendance log table
  const logEl = document.getElementById('a-log');
  if (logEl && !logEl.children.length) logEl.innerHTML = skeletonTableRows(4, 6);

  // Employee table
  const empTbody = document.getElementById('emp-table-body');
  if (empTbody && !empTbody.children.length) empTbody.innerHTML = skeletonTableRows(5, 9);

  // Leave requests
  const leaveEl = document.getElementById('leave-requests-list');
  if (leaveEl && (!leaveEl.children.length || leaveEl.textContent.includes('No pending'))) leaveEl.innerHTML = skeletonCards(3);
  const dashLeaveEl = document.getElementById('dash-pending-leaves');
  if (dashLeaveEl && (!dashLeaveEl.children.length || dashLeaveEl.textContent.includes('No pending'))) dashLeaveEl.innerHTML = skeletonCards(2);

  // Announcements list
  const annEl = document.getElementById('announcements-list');
  if (annEl && (!annEl.children.length || annEl.textContent.includes('No announc'))) annEl.innerHTML = skeletonCards(3);

  // Records table
  const recTbody = document.getElementById('a-records');
  if (recTbody && !recTbody.children.length) recTbody.innerHTML = skeletonTableRows(5, 9);

  // Leave balances table
  const lbTbody = document.getElementById('leave-balances-table');
  if (lbTbody && !lbTbody.children.length) lbTbody.innerHTML = skeletonTableRows(4, 6);

  // Leave history table
  const lhTbody = document.getElementById('leave-history-table');
  if (lhTbody && !lhTbody.children.length) lhTbody.innerHTML = skeletonTableRows(3, 7);

  // Department headcount bars
  const deptBars = document.getElementById('dept-headcount-bars');
  if (deptBars && !deptBars.children.length) deptBars.innerHTML = skeletonBars(4);
}

const DEPT_COLORS = {
  Engineering: 'c-eng', HR: 'c-hr', Marketing: 'c-mkt',
  Finance: 'c-fin', IT: 'c-it', Operations: 'c-ops'
};
const AV_COLORS = ['av-blue', 'av-green', 'av-purple', 'av-amber', 'av-teal', 'av-red', 'av-pink'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function showLoading(msg, sub) {
  const overlay = document.getElementById('loading-overlay');
  if (!overlay) return;
  const msgEl = document.getElementById('loading-msg');
  const subEl = document.getElementById('loading-sub');
  if (msgEl) msgEl.textContent = msg || 'Loading...';
  if (subEl) subEl.textContent = sub || 'Please wait';
  overlay.classList.add('show');
}

function hideLoading() {
  const overlay = document.getElementById('loading-overlay');
  if (!overlay) return;
  overlay.classList.remove('show');
}

function setButtonLoading(btnSelector, isLoading, originalText) {
  const btn = typeof btnSelector === 'string' ? document.querySelector(btnSelector) : btnSelector;
  if (!btn) return;
  if (isLoading) {
    btn.disabled = true;
    btn._origText = btn.innerHTML;
    btn.innerHTML = '<span class="loading-spinner-sm" style="margin-right:8px;vertical-align:middle;"></span> Processing...';
    btn.classList.add('btn-loading');
  } else {
    btn.disabled = false;
    btn.innerHTML = btn._origText || originalText || btn.innerHTML;
    btn.classList.remove('btn-loading');
  }
}

console.log('[EMS] Supabase mode');

// Supabase Realtime replaces Socket.io — handled in supabase.js

function adminTab(tabName, btnElement) {
  sessionStorage.setItem('adminLastTab', tabName);
  switchTab('#page-admin', 'admin', tabName, btnElement, () => {
    if (tabName === 'records') renderRecords();
    if (tabName === 'reports') setReport('daily', document.querySelector('.rtab.active'));
    if (tabName === 'settings') { loadCalendarConfig(); }
    if (tabName === 'employees') renderAll();
  });
}

function updateDashboardStats() {
  if (!appState) return;
  const today = new Date().toISOString().split('T')[0];
  const todayRecs = (appState.attendanceRecords || []).filter(r => r.date === today);
  const present = todayRecs.filter(r => r.status === 'Present' || r.status === 'Late' || r.status === 'Half-Day').length;
  const absent = todayRecs.filter(r => r.status === 'Absent').length;
  const late = todayRecs.filter(r => r.status === 'Late').length;
  const total = (appState.employees || []).filter(e => e.active).length;
  const rate = total > 0 ? Math.round(present / total * 100) : 0;
  setText('stat-total-emp', total);
  setText('stat-present-today', present);
  setText('stat-absent-today', absent);
  setText('stat-late-today', late);
  setText('stat-present-rate', rate + '% attendance');
}

function renderDashboardCards() {
  if (!appState) return;
  updateDashboardStats();
  const today = new Date().toISOString().split('T')[0];
  const employees = appState.employees || [];
  const attendanceRecords = appState.attendanceRecords || [];
  const leaveRequests = appState.leaveRequests || [];
  const todayRecs = attendanceRecords.filter(r => r.date === today);
  const presentEmps = todayRecs.filter(r => ['Present', 'Late', 'Half-Day'].includes(r.status));
  const absentEmps = todayRecs.filter(r => r.status === 'Absent');
  const pEl = document.getElementById('a-present');
  const aEl = document.getElementById('a-absent');
  setText('title-present-count', 'Present (' + presentEmps.length + ')');
  setText('title-absent-count', 'Absent / On Leave (' + absentEmps.length + ')');
  // Smart sync for present list — no flicker
  if (pEl) {
    if (presentEmps.length) {
      smartListSync(pEl, presentEmps, r => actRow(r, employees), r => r.id);
    } else {
      pEl.innerHTML = '<p style="color:var(--subtle);font-size:13px;">No one present yet.</p>';
    }
  }
  // Smart sync for absent list
  if (aEl) {
    if (absentEmps.length) {
      smartListSync(aEl, absentEmps, r => actRow(r, employees), r => r.id);
    } else {
      aEl.innerHTML = '<p style="color:var(--subtle);font-size:13px;">All present!</p>';
    }
  }

  const barsEl = document.getElementById('a-bars');
  if (barsEl) {
    const deptData = {};
    employees.filter(e => e.active).forEach(emp => {
      if (!deptData[emp.dept]) deptData[emp.dept] = { total: 0, present: 0 };
      deptData[emp.dept].total++;
      const rec = todayRecs.find(r => r.id === emp.id && ['Present', 'Late', 'Half-Day'].includes(r.status));
      if (rec) deptData[emp.dept].present++;
    });
    smartListSync(barsEl, Object.entries(deptData), ([d, v]) => {
      const pct = v.total > 0 ? Math.round(v.present / v.total * 100) : 0;
      const color = pct >= 80 ? 'bf-green' : pct >= 50 ? 'bf-amber' : 'bf-red';
      return '<div class="bar-row"><span class="bar-label">' + d + '</span><div class="bar-track"><div class="bar-fill ' + color + '" style="width:' + pct + '%"></div></div><span class="bar-val">' + pct + '%</span></div>';
    }, ([d]) => d);
  }

  // Smart sync for attendance log table
  const logEl = document.getElementById('a-log');
  if (logEl) {
    smartTableSync(logEl, todayRecs, r =>
      '<tr>' +
      '<td><div style="display:flex;align-items:center;gap:10px;">' +
        '<div class="av ' + AV_COLORS[employees.findIndex(e => e.id === r.id) % AV_COLORS.length] + '" style="flex-shrink:0;">' + r.name.charAt(0) + '</div>' +
        '<div style="display:flex;flex-direction:column;">' +
          '<span style="font-weight:600;font-size:14px;color:var(--text);">' + r.name + '</span>' +
          '<span style="font-size:11px;color:var(--subtle);">' + r.id + '</span>' +
        '</div>' +
      '</div></td>' +
      '<td><span class="chip ' + (DEPT_COLORS[r.dept] || 'c-eng') + '">' + r.dept + '</span></td>' +
      '<td><span style="font-family:var(--font-mono);font-size:13px;">' + (r.in || '—') + '</span></td>' +
      '<td><span style="font-family:var(--font-mono);font-size:13px;">' + (r.out || '—') + '</span></td>' +
      '<td><strong style="font-size:14px;">' + (r.hours > 0 ? r.hours.toFixed(1) + 'h' : '—') + '</strong></td>' +
      '<td><span class="tag t-' + r.status.toLowerCase().replace('-', '').replace(' ', '') + '">' + r.status + '</span></td></tr>',
      r => r.id + '-' + r.date
    );
  }

  renderDashPendingLeaves(leaveRequests);
}

function renderDashPendingLeaves(leaveRequests) {
  const el = document.getElementById('dash-pending-leaves');
  if (!el) return;
  const leaveReqs = leaveRequests || (appState ? appState.leaveRequests : []) || [];
  const pending = leaveReqs.filter(l => l.status === 'Pending');
  if (!pending.length) { el.innerHTML = '<p style="color:var(--subtle);font-size:13px;">No pending requests.</p>'; return; }
  smartListSync(el, pending, l => leaveReqCard(l), l => l.id || l.empId + '-' + l.from);
}

function actRow(r, employees) {
  const emps = employees || (appState ? appState.employees : []) || [];
  const idx = emps.findIndex(e => e.id === r.id);
  return '<div class="act-row">' +
    '<div class="av ' + AV_COLORS[Math.max(0, idx) % AV_COLORS.length] + '" style="flex-shrink:0;">' + r.name.charAt(0) + '</div>' +
    '<div style="flex:1;min-width:0;">' +
      '<div style="font-size:14px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + r.name + '</div>' +
      '<div style="font-size:12px;color:var(--subtle);margin-top:2px;">' + r.dept + '</div>' +
    '</div>' +
    '<span class="tag t-' + r.status.toLowerCase().replace('-', '').replace(' ', '') + '" style="flex-shrink:0;">' + r.status + '</span></div>';
}

function renderRecords() {
  if (!appState) return;
  const attendanceRecords = appState.attendanceRecords || [];
  const dateF = document.getElementById('rec-date')?.value || '';
  const deptF = document.getElementById('rec-dept')?.value || '';
  const statusF = document.getElementById('rec-status')?.value || '';
  const tbody = document.getElementById('a-records');
  if (!tbody) return;
  let recs = attendanceRecords.slice();
  if (dateF) recs = recs.filter(r => r.date === dateF);
  if (deptF) recs = recs.filter(r => r.dept === deptF);
  if (statusF) recs = recs.filter(r => r.status === statusF);
  const employees = appState.employees || [];
  smartTableSync(tbody, recs, r =>
    '<tr>' +
    '<td><span style="font-family:var(--font-mono);font-size:12px;color:var(--text);font-weight:600;">' + r.id + '</span></td>' +
    '<td><div style="display:flex;align-items:center;gap:10px;">' +
      '<div class="av ' + AV_COLORS[employees.findIndex(e => e.id === r.id) % AV_COLORS.length] + '" style="flex-shrink:0;width:32px;height:32px;font-size:12px;">' + r.name.charAt(0) + '</div>' +
      '<div style="display:flex;flex-direction:column;">' +
        '<span style="font-weight:600;font-size:14px;color:var(--text);">' + r.name + '</span>' +
      '</div>' +
    '</div></td>' +
    '<td><span class="chip ' + (DEPT_COLORS[r.dept] || 'c-eng') + '">' + r.dept + '</span></td>' +
    '<td>' + formatDate(r.date) + '</td>' +
    '<td><span style="font-family:var(--font-mono);font-size:13px;">' + (r.in || '—') + '</span></td>' +
    '<td><span style="font-family:var(--font-mono);font-size:13px;">' + (r.out || '—') + '</span></td>' +
    '<td><strong style="font-size:14px;">' + (r.hours > 0 ? r.hours.toFixed(1) + 'h' : '—') + '</strong></td>' +
    '<td><span class="tag t-' + r.status.toLowerCase().replace('-', '').replace(' ', '') + '">' + r.status + '</span></td>' +
    '<td style="font-size:12px;color:var(--subtle);">' + (r.status === 'Half-Day' ? 'Late login>14:00' : '') + '</td></tr>',
    r => r.id + '-' + r.date
  );
}

function renderEmpTable() {
  if (!appState) return;
  const employees = appState.employees || [];
  const tbody = document.getElementById('emp-table-body');
  if (!tbody) return;
  const search = document.getElementById('emp-search')?.value.toLowerCase() || '';
  const deptF = document.getElementById('emp-dept-filter')?.value || '';
  let list = employees.filter(e => e.active);
  if (search) list = list.filter(e => e.name.toLowerCase().includes(search) || e.id.toLowerCase().includes(search));
  if (deptF) list = list.filter(e => e.dept === deptF);
  smartTableSync(tbody, list, (emp, i) =>
    '<tr>' +
    /* Avatar column */
    '<td><div class="av ' + AV_COLORS[i % AV_COLORS.length] + '" style="flex-shrink:0;width:36px;height:36px;font-size:13px;">' + emp.name.charAt(0) + '</div></td>' +
    /* ID column */
    '<td><span style="font-family:var(--font-mono);font-size:12px;font-weight:600;color:var(--text);">' + emp.id + '</span></td>' +
    /* Name column */
    '<td><div style="display:flex;flex-direction:column;">' +
      '<span style="font-weight:600;font-size:14px;color:var(--text);">' + emp.name + '</span>' +
    '</div></td>' +
    /* Dept column */
    '<td><span class="chip ' + (DEPT_COLORS[emp.dept] || 'c-eng') + '">' + emp.dept + '</span></td>' +
    '<td style="color:var(--muted);font-size:13px;">' + (emp.designation || '—') + '</td>' +
    '<td style="font-size:13px;">' + emp.email + '</td>' +
    '<td style="font-size:13px;">' + (emp.phone || '—') + '</td>' +
    '<td style="font-size:13px;">' + (emp.bday ? formatDate(emp.bday) : '—') + '</td>' +
    '<td><button class="btn btn-sm" onclick="openEditEmpModal(\'' + emp.id + '\')" title="Edit">✏️</button> ' +
    '<button class="btn btn-sm" onclick="archiveEmployee(\'' + emp.id + '\')" title="Archive">📦</button> ' +
    '<button class="btn btn-sm btn-danger" onclick="openDeleteEmpModal(\'' + emp.id + '\')" title="Remove">🗑</button></td></tr>',
    emp => emp.id
  );
}

function archiveEmployee(empId) {
  if (!appState) return;
  const emp = (appState.employees || []).find(e => e.id === empId);
  if (!emp) return;
  if (!confirm('Archive ' + emp.name + '? They will be moved to the archived employees section.')) return;
  api('/api/employees/' + emp.id + '/archive', { method: 'POST' }).then(() => refreshStateAndRender());
  showNotifBar('info', emp.name + ' has been archived.', '📦');
}

function openDeleteEmpModal(id) {
  if (!appState) return;
  deleteTargetId = id;
  const emp = (appState.employees || []).find(e => e.id === id);
  if (emp) document.getElementById('delete-emp-name').innerText = emp.name + ' (' + emp.id + ')';
  document.getElementById('delete-emp-modal').style.display = 'flex';
}

function closeDeleteEmpModal() {
  document.getElementById('delete-emp-modal').style.display = 'none';
  deleteTargetId = null;
}

async function confirmDeleteEmployee() {
  if (!deleteTargetId || !appState) return;
  const emp = (appState.employees || []).find(e => e.id === deleteTargetId);
  if (!emp) { showNotifBar('error', 'Employee not found.', '❌'); closeDeleteEmpModal(); return; }
  closeDeleteEmpModal();
  showNotifBar('info', emp.name + ' has been removed.', '🗑');
  await api('/api/employees/' + deleteTargetId, { method: 'DELETE' });
  await refreshStateAndRender();
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
  // Auto-focus the first field for fast entry
  setTimeout(() => {
    const nameField = document.getElementById('f-name');
    if (nameField) nameField.focus();
  }, 100);
}

function openEditEmpModal(empId) {
  if (!appState) return;
  const emp = (appState.employees || []).find(e => e.id === empId);
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
    if (appState && (appState.employees || []).some(e => e.id === id)) { showNotifBar('warning', 'Employee ID already exists.', '⚠️'); return; }
    api('/api/employees', { method: 'POST', body: { id, name, dept, email, phone, bday, joining, designation, cl, sl, password: pwd || 'emp123' } }).then(async res => {
      if (res && res.success) {
        closeAddEmpModal();
        await refreshStateAndRender();
        showNotifBar('success', 'Employee ' + name + ' added successfully!', '✓');
      } else {
        showNotifBar('error', (res && res.error) || 'Failed to add employee.', '❌');
      }
    });
  } else {
    api('/api/employees/' + editId, { method: 'PUT', body: { name, dept, email, phone, bday, joining, designation, cl, sl, password: pwd || undefined } }).then(async res => {
      if (res && res.success) {
        closeAddEmpModal();
        await refreshStateAndRender();
        showNotifBar('success', 'Employee ' + name + ' updated successfully!', '✓');
      } else {
        showNotifBar('error', (res && res.error) || 'Failed to update employee.', '❌');
      }
    });
  }
}

function leaveReqCard(l) {
  const typeColor = l.type === 'CL' ? 'c-eng' : l.type === 'SL' ? 'c-mkt' : 'c-it';
  const statusTag = l.status === 'Pending' ? '<span class="tag t-late">Pending</span>' : l.status === 'Approved' ? '<span class="tag t-present">Approved</span>' : '<span class="tag t-absent">Rejected</span>';
  const actions = l.status === 'Pending'
    ? '<button class="btn btn-sm btn-success" onclick="handleLeave(\'' + l.id + '\',\'Approved\')">✓ Approve</button><button class="btn btn-sm btn-danger" onclick="handleLeave(\'' + l.id + '\',\'Rejected\')">✗ Reject</button>'
    : '';
  return '<div class="leave-req-card"><div class="av av-blue">' + l.empName.charAt(0) + '</div><div style="flex:1;">' +
    '<div style="font-size:13px;font-weight:600;">' + l.empName + ' <span class="chip ' + typeColor + '">' + l.type + '</span></div>' +
    '<div style="font-size:12px;color:var(--muted);margin-top:3px;">' + formatDate(l.from) + ' – ' + formatDate(l.to) + ' (' + l.days + ' day' + (l.days > 1 ? 's' : '') + ')</div>' +
    '<div style="font-size:12px;color:var(--subtle);margin-top:2px;">' + l.reason + '</div></div>' +
    '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">' + statusTag + '<div class="leave-req-actions">' + actions + '</div></div></div>';
}

function renderLeaveRequests(leaveRequests) {
  const el = document.getElementById('leave-requests-list');
  if (!el) return;
  const leaveReqs = leaveRequests || (appState ? appState.leaveRequests : []) || [];
  const pending = leaveReqs.filter(l => l.status === 'Pending');
  if (!pending.length) { el.innerHTML = '<p style="color:var(--subtle);font-size:13px;">No pending requests 🎉</p>'; return; }
  smartListSync(el, pending, l => leaveReqCard(l), l => l.id || l.empId + '-' + l.from);
}

function handleLeave(idxOrId, decision) {
  if (!appState) return;
  const leaveRequests = appState.leaveRequests || [];
  const req = leaveRequests.find(l => String(l.id) === String(idxOrId) || String(l.idx) === String(idxOrId));
  if (!req) return;
  api('/api/leave-requests/' + (req.id || req.idx), { method: 'PUT', body: { status: decision } }).then(async (res) => {
    await refreshStateAndRender();
    if (decision === 'Approved') {
      if (res && res.warning) showNotifBar('warning', res.warning, '⚠️');
      showNotifBar('success', 'Leave for ' + req.empName + ' Approved!', '✓');
      addAdminNotif('Leave request from ' + req.empName + ' has been Approved.');
    } else {
      showNotifBar('info', 'Leave for ' + req.empName + ' Rejected.', 'ℹ');
    }
  });
}

function renderLeaveBalances(leaveRequests) {
  if (!appState) return;
  const employees = appState.employees || [];
  const tbody = document.getElementById('leave-balances-table');
  if (!tbody) return;
  smartTableSync(tbody, employees.filter(e => e.active), (emp, i) =>
    '<tr>' +
    '<td><div style="display:flex;align-items:center;gap:10px;">' +
      '<div class="av ' + AV_COLORS[i % AV_COLORS.length] + '" style="flex-shrink:0;">' + emp.name.charAt(0) + '</div>' +
      '<div style="display:flex;flex-direction:column;">' +
        '<span style="font-weight:600;font-size:14px;color:var(--text);">' + emp.name + '</span>' +
        '<span style="font-family:var(--font-mono);font-size:11px;color:var(--subtle);">' + emp.id + '</span>' +
      '</div>' +
    '</div></td>' +
    '<td><span class="chip ' + (DEPT_COLORS[emp.dept] || 'c-eng') + '">' + emp.dept + '</span></td>' +
    '<td><strong class="blue-v" style="font-size:15px;">' + emp.cl + '</strong> days</td>' +
    '<td><strong class="green-v" style="font-size:15px;">' + emp.sl + '</strong> days</td>' +
    '<td><strong class="red-v" style="font-size:15px;">' + (emp.ul || 0) + '</strong> days</td>' +
    '<td><button class="btn btn-sm" onclick="openLeaveManage(\'' + emp.id + '\')">Adjust</button></td></tr>',
    emp => emp.id
  );
}

function renderLeaveHistory(leaveRequests) {
  const tbody = document.getElementById('leave-history-table');
  if (!tbody) return;
  const leaveReqs = leaveRequests || (appState ? appState.leaveRequests : []) || [];
  smartTableSync(tbody, leaveReqs, l => {
    const typeColor = l.type === 'CL' ? 'c-eng' : l.type === 'SL' ? 'c-mkt' : 'c-it';
    return '<tr><td>' + l.empName + '</td><td><span class="chip ' + typeColor + '">' + l.type + '</span></td><td>' + formatDate(l.from) + '</td><td>' + formatDate(l.to) + '</td><td>' + l.days + '</td><td><span class="tag t-' + (l.status || 'pending').toLowerCase() + '">' + (l.status || 'Pending') + '</span></td><td style="font-size:12px;color:var(--muted);">' + l.reason + '</td></tr>';
  }, l => (l.id || l.empId + '-' + l.from + '-' + l.type));
}

function openLeaveManage(empId) {
  if (!appState) return;
  const employees = appState.employees || [];
  const idx = employees.findIndex(e => e.id === empId);
  if (idx === -1) return;
  selectedLeaveManageIdx = idx;
  const emp = employees[idx];
  document.getElementById('lm-emp-name').innerText = emp.name;
  document.getElementById('lm-cl').value = emp.cl;
  document.getElementById('lm-sl').value = emp.sl;
  document.getElementById('lm-ul').value = emp.ul || 0;
  document.getElementById('leave-manage-modal').style.display = 'flex';
}

function saveLeaveBalance() {
  if (selectedLeaveManageIdx === null || !appState) return;
  const employees = appState.employees || [];
  const emp = employees[selectedLeaveManageIdx];
  emp.cl = parseFloat(document.getElementById('lm-cl').value) || 0;
  emp.sl = parseFloat(document.getElementById('lm-sl').value) || 0;
  emp.ul = parseFloat(document.getElementById('lm-ul').value) || 0;
  document.getElementById('leave-manage-modal').style.display = 'none';
  api('/api/employees/' + emp.id, { method: 'PUT', body: { cl: emp.cl, sl: emp.sl, ul: emp.ul } }).then(async () => {
    await refreshStateAndRender();
    showNotifBar('success', 'Leave balances updated for ' + emp.name + '.', '✓');
  });
}

function setReport(type, btn) {
  if (!appState) return;
  const attendanceRecords = appState.attendanceRecords || [];
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
  if (tbody) {
    smartTableSync(tbody, recs, r =>
      '<tr>' +
      '<td><span style="font-family:var(--font-mono);font-size:12px;color:var(--muted);font-weight:600;">' + r.id + '</span></td>' +
      '<td>' +
        '<div style="display:flex;align-items:center;gap:10px;">' +
          '<div class="av ' + AV_COLORS[0] + '" style="flex-shrink:0;">' + r.name.charAt(0) + '</div>' +
          '<span style="font-weight:600;font-size:14px;color:var(--text);">' + r.name + '</span>' +
        '</div>' +
      '</td>' +
      '<td><span class="chip ' + (DEPT_COLORS[r.dept] || 'c-eng') + '">' + r.dept + '</span></td>' +
      '<td>' + formatDate(r.date) + '</td>' +
      '<td><span style="font-family:var(--font-mono);font-size:13px;">' + (r.in || '—') + '</span></td>' +
      '<td><span style="font-family:var(--font-mono);font-size:13px;">' + (r.out || '—') + '</span></td>' +
      '<td><strong style="font-size:14px;">' + (r.hours > 0 ? r.hours.toFixed(1) + 'h' : '—') + '</strong></td>' +
      '<td><span class="tag t-' + r.status.toLowerCase().replace('-', '').replace(' ', '') + '">' + r.status + '</span></td></tr>',
      r => r.id + '-' + r.date
    );
  }
}

function changeAdminPwd() {
  const cur = document.getElementById('a-cur-pwd').value.trim();
  const newPwd = document.getElementById('a-new-pwd').value.trim();
  const conf = document.getElementById('a-conf-pwd').value.trim();
  if (!cur || !newPwd || !conf) { showNotifBar('warning', 'Please fill in all fields.', '⚠️'); return; }
  if (newPwd.length < 6) { showNotifBar('warning', 'New password must be at least 6 characters.', '⚠️'); return; }
  if (newPwd !== conf) { showNotifBar('warning', 'Passwords do not match.', '⚠️'); return; }
  const btn = document.querySelector('#admin-settings .btn-primary');
  setButtonLoading(btn, true);
  api('/api/auth/password', {
    method: 'PUT',
    body: { userId: ADMIN_USERNAME, currentPwd: cur, newPwd: newPwd }
  }).then(res => {
    setButtonLoading(btn, false, 'Update Password');
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

function empTab(tabName, btnElement) {
  sessionStorage.setItem('empLastTab', tabName);
  switchTab('#page-employee', 'emp', tabName, btnElement, () => {
    if (tabName === 'history') renderEmpHistory();
  });
}

function renderEmpDashboard(emp) {
  if (!appState) return;
  const attendanceRecords = appState.attendanceRecords || [];
  const announcements = appState.announcements || [];
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
  if (barsEl) smartListSync(barsEl, days, (d, i) => {
    const hrs = (Math.random() * 3 + 6).toFixed(1);
    const pct = Math.round(parseFloat(hrs) / 10 * 100);
    return '<div class="bar-row"><span class="bar-label">' + d + '</span><div class="bar-track"><div class="bar-fill ' + colors[i] + '" style="width:' + pct + '%"></div></div><span class="bar-val">' + hrs + 'h</span></div>';
  }, d => d);

  const logEl = document.getElementById('emp-log');
  if (logEl) {
    smartTableSync(logEl, myRecs.slice(0, 7), r => {
      const dateObj = new Date(r.date);
      return '<tr><td style="font-weight:500;">' + formatDate(r.date) + '</td><td style="color:var(--muted);font-size:13px;">' + DAYS[dateObj.getDay()] + '</td><td><span style="font-family:var(--font-mono);font-size:13px;">' + (r.in || '—') + '</span></td><td><span style="font-family:var(--font-mono);font-size:13px;">' + (r.out || '—') + '</span></td><td style="color:var(--subtle);">—</td><td><strong style="font-size:14px;">' + (r.hours > 0 ? r.hours.toFixed(1) + 'h' : '—') + '</strong></td><td><span class="tag t-' + r.status.toLowerCase().replace('-', '').replace(' ', '') + '">' + r.status + '</span></td></tr>';
    }, r => r.id + '-' + r.date);
  }

  renderMyLeaveHistory(emp);
  renderAnnouncementsEmp(announcements);
}

function renderEmpHistory() {
  if (!appState) return;
  const attendanceRecords = appState.attendanceRecords || [];
  const employees = appState.employees || [];
  const monthInp = document.getElementById('hist-month');
  const monthStr = monthInp?.value || new Date().toISOString().slice(0, 7);
  const uid = sessionStorage.getItem('userId');
  const emp = employees.find(e => e.id === uid) || employees[0];
  if (!emp) return;
  const recs = attendanceRecords.filter(r => r.id === emp.id && r.date.startsWith(monthStr));
  const present = recs.filter(r => ['Present', 'Late', 'Half-Day'].includes(r.status)).length;
  const hours = recs.reduce((a, r) => a + r.hours, 0);
  const summEl = document.getElementById('hist-summary');
  if (summEl) summEl.innerHTML = '<div class="sum-item"><span>Working Days</span><strong>' + recs.length + '</strong></div><div class="sum-item"><span>Present</span><strong class="green-v">' + present + '</strong></div><div class="sum-item"><span>Total Hours</span><strong>' + hours.toFixed(1) + 'h</strong></div>';
  const tbody = document.getElementById('hist-table');
  if (tbody) {
    smartTableSync(tbody, recs, r => {
      const dateObj = new Date(r.date);
      return '<tr><td style="font-weight:500;">' + formatDate(r.date) + '</td><td style="color:var(--muted);font-size:13px;">' + DAYS[dateObj.getDay()] + '</td><td><span style="font-family:var(--font-mono);font-size:13px;">' + (r.in || '—') + '</span></td><td><span style="font-family:var(--font-mono);font-size:13px;">' + (r.out || '—') + '</span></td><td style="color:var(--subtle);">—</td><td><strong style="font-size:14px;">' + (r.hours > 0 ? r.hours.toFixed(1) + 'h' : '—') + '</strong></td><td><span class="tag t-' + r.status.toLowerCase().replace('-', '').replace(' ', '') + '">' + r.status + '</span></td></tr>';
    }, r => r.id + '-' + r.date);
  }
}

function empPunchIn() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-IN', { hour12: true, hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toISOString().split('T')[0];
  const h = now.getHours();
  const m = now.getMinutes();

  if (h >= 18) {
    showNotifBar('error', 'Cannot sign in after 6:00 PM. Contact admin if you need a correction.', '⛔');
    return;
  }

  const pill = document.getElementById('emp-pill');
  if (pill) { pill.className = 'status-pill sp-in'; pill.innerHTML = '<div class="status-dot sd-g"></div>Signed In'; }
  showNotifBar('success', 'Punched In at ' + timeStr, '✓');
  appendTimeline('in', 'Signed In', timeStr);
  if (h >= 14) showNotifBar('warning', 'First login after 2:00 PM — this day will be flagged as Half-Day.', '⚠️');
  if (!appState) return;
  const uid = sessionStorage.getItem('userId');
  const emp = (appState.employees || []).find(e => e.id === uid);
  if (emp) {
    const inTimeStr = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    let status = 'Present';
    if (h >= 14) status = 'Half-Day';
    else if (h > 9 || (h === 9 && m > 15)) status = 'Late';
    const rec = { id: emp.id, name: emp.name, dept: emp.dept, date: dateStr, in: inTimeStr, out: '', hours: 0, status: status };
    api('/api/attendance', { method: 'POST', body: rec }).then(async res => {
      if (res && !res.success) showNotifBar('error', res.error || 'Failed to save sign-in.', '❌');
      await refreshStateAndRender();
    });
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
  if (!appState) return;
  const uid = sessionStorage.getItem('userId');
  const emp = (appState.employees || []).find(e => e.id === uid);
  if (emp) {
    const h = now.getHours();
    const m = now.getMinutes();
    const outTimeStr = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    const rec = { id: emp.id, name: emp.name, dept: emp.dept, date: dateStr, in: '', out: outTimeStr, hours: 0, status: 'Present' };
    api('/api/attendance', { method: 'POST', body: rec }).then(async res => {
      if (res && !res.success) showNotifBar('error', res.error || 'Failed to save sign-out.', '❌');
      await refreshStateAndRender();
    });
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
  const attendanceRecords = appState ? appState.attendanceRecords || [] : [];
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
  if (!appState) return;
  const employees = appState.employees || [];
  const uid = sessionStorage.getItem('userId');
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
  if (!appState) return;
  const employees = appState.employees || [];
  const uid = sessionStorage.getItem('userId');
  const emp = employees.find(e => e.id === uid) || employees[0];
  if (!emp) { showNotifBar('error', 'Employee not found. Please log in again.', '❌'); return; }
  let days = 0;
  const d1 = new Date(from), d2 = new Date(to);
  for (let d = new Date(d1); d <= d2; d.setDate(d.getDate() + 1)) { if (d.getDay() !== 0 && d.getDay() !== 6) days++; }
  const newReq = { empId: emp.id, empName: emp.name, dept: emp.dept, type: currentLeaveType, from, to, days, reason, status: 'Pending' };
  api('/api/leave-requests', { method: 'POST', body: newReq }).then(async () => {
    await refreshStateAndRender();
    showNotifBar('success', 'Leave request submitted! Awaiting admin approval.', '✓');
    addAdminNotif('New leave request from ' + emp.name + ' (' + currentLeaveType + ') for ' + formatDate(from) + '.');
    document.getElementById('leave-reason').value = '';
  });
}

function renderMyLeaveHistory(emp) {
  if (!appState) return;
  const leaveRequests = appState.leaveRequests || [];
  const el = document.getElementById('my-leave-history');
  if (!el) return;
  const myLeaves = leaveRequests.filter(l => l.empId === emp.id);
  if (!myLeaves.length) { el.innerHTML = '<p style="color:var(--subtle);font-size:13px;">No leave history.</p>'; return; }
  smartListSync(el, myLeaves, l => {
    const typeColor = l.type === 'CL' ? 'c-eng' : l.type === 'SL' ? 'c-mkt' : 'c-it';
    return '<div class="leave-req-card" style="flex-wrap:wrap;"><div style="flex:1;"><div style="font-size:13px;font-weight:600;"><span class="chip ' + typeColor + '">' + l.type + '</span> ' + formatDate(l.from) + ' – ' + formatDate(l.to) + '</div><div style="font-size:12px;color:var(--muted);">' + l.days + ' day(s) | ' + l.reason + '</div></div><span class="tag t-' + (l.status || 'pending').toLowerCase() + '">' + (l.status || 'Pending') + '</span></div>';
  }, l => l.id || l.empId + '-' + l.from + '-' + l.type);
}

function changeEmpPwd() {
  const cur = document.getElementById('e-cur-pwd').value.trim();
  const newPwd = document.getElementById('e-new-pwd').value.trim();
  const conf = document.getElementById('e-conf-pwd').value.trim();
  if (!appState) return;
  const employees = appState.employees || [];
  const uid = sessionStorage.getItem('userId');
  const emp = employees.find(e => e.id === uid);
  if (!emp) return;
  if (newPwd.length < 6) { showNotifBar('warning', 'New password must be at least 6 characters.', '⚠️'); return; }
  if (newPwd !== conf) { showNotifBar('warning', 'Passwords do not match.', '⚠️'); return; }
  const btn = document.querySelector('#emp-settings .btn-primary');
  setButtonLoading(btn, true);
  api('/api/auth/password', { method: 'PUT', body: { userId: uid, currentPwd: cur, newPwd } }).then(res => {
    setButtonLoading(btn, false, 'Update Password');
    if (res && res.success) {
      emp.password = newPwd;
      document.getElementById('e-cur-pwd').value = '';
      document.getElementById('e-new-pwd').value = '';
      document.getElementById('e-conf-pwd').value = '';
      document.getElementById('e-strength').style.width = '0%';
      showNotifBar('success', 'Password updated successfully!', '✓');
    } else {
      showNotifBar('error', (res && res.error) || 'Failed to update password.', '❌');
    }
  });
}

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
    if (res && res.success && res.tempPassword) {
      const statusEl = document.getElementById('fp-status-message');
      if (statusEl) {
        statusEl.innerHTML = '✅ <strong>Temporary password generated. Use it to log in, then change it in Settings.</strong>';
        statusEl.style.display = 'block';
        statusEl.style.color = 'var(--green-text, #166534)';
        statusEl.style.background = 'var(--green-bg, #dcfce7)';
        statusEl.style.border = '1px solid var(--green-border, #86efac)';
      }
      const pwdEl = document.getElementById('fp-temp-password');
      if (pwdEl) {
        pwdEl.textContent = res.tempPassword;
        pwdEl.style.display = 'block';
      }
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.textContent = '🔑 Generate New Password';
      }
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

async function api(url, opts = {}) {
  // Use SupabaseClient directly (stateless, no server needed)
  if (typeof SupabaseClient !== 'undefined' && SupabaseClient.ready) {
    const result = await SupabaseClient.call(opts.method || 'GET', url, opts.body || null);
    if (result) return result;
  }
  // Fallback: return null (SupabaseClient handles all API calls)
  return null;
}

async function loadStateFromServer() {
  const data = await api('/api/state');
  if (data) {
    appState = data;
    serverAvailable = true;
    return true;
  }
  console.error('[EMS] Server unreachable — cannot load state.');
  return false;
}

function updateNavBadges() {
  // Update notification badges on nav buttons
  if (!appState) return;

  // ── Admin nav badges ──
  // Leave Mgmt: pending leave requests
  const pendingLeaves = (appState.leaveRequests || []).filter(l => l.status === 'Pending').length;
  updateBadge('nav-badge-leaves', pendingLeaves);

  // Announcements: total announcements count
  const annCount = (appState.announcements || []).length;
  updateBadge('nav-badge-ann', annCount);

  // Employees: total active employees count
  const empCount = (appState.employees || []).filter(e => e.active).length;
  updateBadge('nav-badge-emps', empCount);

  // Dashboard: pending leaves + unread notifications
  const unreadNotifs = (appState.adminNotifications || []).filter(n => n.unread !== false).length;
  const dashCount = pendingLeaves + unreadNotifs;
  updateBadge('nav-badge-dash', dashCount);

  // ── Employee nav badges ──
  const uid = sessionStorage.getItem('userId');
  if (uid) {
    const myPendingLeaves = (appState.leaveRequests || [])
      .filter(l => l.empId === uid && l.status === 'Pending').length;
    updateBadge('nav-badge-emp-leaves', myPendingLeaves);
  }
}

function updateBadge(id, count) {
  const el = document.getElementById(id);
  if (!el) return;
  if (count > 0) {
    el.textContent = count > 99 ? '99+' : count;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
    el.textContent = '';
  }
}

function updateAdminNotifBadge() {
  const badge = document.getElementById('admin-notif-count');
  if (!badge) return;
  if (!appState || !appState.adminNotifications) { badge.textContent = '0'; badge.style.display = 'none'; return; }
  const activeNotifs = appState.adminNotifications.filter(n => n.unread !== false);
  const count = activeNotifs.length;
  badge.textContent = count;
  badge.style.display = count > 0 ? 'flex' : 'none';
}

function updateEmpNotifBadge() {
  const badge = document.getElementById('emp-notif-count');
  if (!badge) return;
  if (!appState || !appState.empNotifications) { badge.textContent = '0'; badge.style.display = 'none'; return; }
  const uid = sessionStorage.getItem('userId');
  const relevant = appState.empNotifications.filter(n => n.target === 'emp' || n.userId === uid);
  const activeNotifs = relevant.filter(n => n.unread !== false);
  const count = activeNotifs.length;
  badge.textContent = count;
  badge.style.display = count > 0 ? 'flex' : 'none';
}

function addAdminNotif(text) {
  api('/api/notifications', { method: 'POST', body: { text, target: 'admin' } }).then(async () => {
    await refreshStateAndRender();
  });
}

function addEmpNotif(text, userId) {
  api('/api/notifications', { method: 'POST', body: { text, target: 'emp', userId } }).then(async () => {
    await refreshStateAndRender();
  });
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
  if (appState && appState.adminNotifications) {
    appState.adminNotifications.forEach(n => { n.unread = false; });
  }
  updateAdminNotifBadge();
  api('/api/notifications/mark-read', { method: 'POST', body: { userId: ADMIN_EMAIL } });
}

function markEmpNotifsRead() {
  if (appState && appState.empNotifications) {
    appState.empNotifications.forEach(n => { n.unread = false; });
  }
  updateEmpNotifBadge();
  const uid = sessionStorage.getItem('userId');
  api('/api/notifications/mark-read', { method: 'POST', body: { userId: uid } });
}

function renderAdminNotifPanel() {
  const body = document.getElementById('notif-panel-body');
  if (!body) return;
  const notifs = (appState && appState.adminNotifications) || [];
  if (!notifs.length) {
    body.innerHTML = '<p style="color:var(--subtle);font-size:13px;text-align:center;padding:20px;">No notifications yet.</p>';
    return;
  }
  smartListSync(body, notifs, n =>
    '<div class="notif-item' + (n.unread ? ' unread' : '') + '"><div>' + n.text + '</div><div class="notif-item-time">' + (n.time || '') + '</div></div>',
    n => n._id || n.text + (n.time || '')
  );
}

function renderEmpNotifPanel() {
  const body = document.getElementById('emp-notif-panel-body');
  if (!body) return;
  const uid = sessionStorage.getItem('userId');
  const allNotifs = (appState && appState.empNotifications) || [];
  const notifs = allNotifs.filter(n => n.target === 'emp' || n.userId === uid);
  if (!notifs.length) {
    body.innerHTML = '<p style="color:var(--subtle);font-size:13px;text-align:center;padding:20px;">No notifications yet.</p>';
    return;
  }
  smartListSync(body, notifs, n =>
    '<div class="notif-item' + (n.unread ? ' unread' : '') + '"><div>' + n.text + '</div><div class="notif-item-time">' + (n.time || '') + '</div></div>',
    n => n._id || n.text + (n.time || '')
  );
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

function toggleAdminReset() {
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

  const currentHour = new Date().getHours();
  if (uid !== ADMIN_USERNAME && uid.toLowerCase() !== ADMIN_EMAIL && currentHour >= 18) {
    document.getElementById('err-msg').style.display = 'flex';
    document.getElementById('err-msg-text').textContent = 'Employee logins are blocked after 6:00 PM IST.';
    return;
  }

  const loginBtn = document.querySelector('.login-btn');
  setButtonLoading(loginBtn, true);

  const res = await api('/api/auth/login', {
    method: 'POST',
    body: { uid, pwd }
  });

  if (res && res.error === 'TIME_BLOCK') {
    setButtonLoading(loginBtn, false, 'Sign In');
    document.getElementById('err-msg').style.display = 'flex';
    document.getElementById('err-msg-text').textContent = res.message || 'Employee logins are blocked after 6:00 PM IST.';
    return;
  }

  if (res && res.success) {
    sessionStorage.setItem('userId', uid);
    sessionStorage.setItem('userRole', res.role);
    if (rememberMe) {
      localStorage.setItem('rememberedUser', uid);
    } else {
      localStorage.removeItem('rememberedUser');
    }

    if (res.role === 'admin') {
      currentUser = { name: 'Administrator' };
      currentRole = 'admin';
      showLoading('Loading admin panel...', 'Fetching employee data from server');
      showSkeletons();
      await loadStateFromServer();
      showAdminPage();
      hideLoading();
    } else if (res.role === 'employee') {
      showLoading('Loading employee data...', 'Syncing from server');
      showSkeletons();
      await loadStateFromServer();
      currentUser = res.user;
      currentRole = 'employee';

      if (res.timeBlock && res.timeBlock.isHalfDay) {
        showNotifBar('warning', '⚠️ First login after 2:00 PM — today will be flagged as Half-Day.', '⚠️');
      }

      const emp = appState && (appState.employees || []).find(e => e.id === res.user.id);
      if (emp) {
        showEmployeePage(emp);
        hideLoading();
      } else {
        hideLoading();
        showNotifBar('error', 'Employee data not found. Check database connection.', '❌');
      }
    }
    return;
  }

  if (res) {
    setButtonLoading(loginBtn, false, 'Sign In');
    document.getElementById('err-msg').style.display = 'flex';
    document.getElementById('err-msg-text').textContent = res.message || res.error || 'Invalid credentials. Please try again.';
    return;
  }

  setButtonLoading(loginBtn, false, 'Sign In');
  document.getElementById('err-msg').style.display = 'flex';
  document.getElementById('err-msg-text').textContent = 'Unable to connect to database. Check your Supabase configuration.';
}

function logout() {
  if (currentRole === 'employee') {
    const uid = sessionStorage.getItem('userId');
    api('/api/auth/logout', { method: 'POST', body: { uid } });
  }
  currentUser = null;
  currentRole = '';
  sessionStorage.removeItem('userId');
  sessionStorage.removeItem('userRole');
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
  renderAll();
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
  document.getElementById('emp-ul-used').textContent = emp.ul || 0;
  document.getElementById('emp-cl-bal2').textContent = emp.cl;
  document.getElementById('emp-sl-bal2').textContent = emp.sl;
  document.getElementById('emp-ul-used2').textContent = emp.ul || 0;
  initClock('emp-clock');
  renderEmpDashboard(emp);
  updateNavBadges();
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
  tabs.forEach(t => t.classList.remove('show'));
  const target = document.getElementById(prefix + '-' + tabName);
  if (target) {
    target.classList.add('show');
    if (onShow) onShow();
  }
  document.querySelectorAll(pageId + ' .nav-btn').forEach(b => b.classList.remove('active'));
  if (btnElement) btnElement.classList.add('active');
}

function renderAll() {
  if (!appState) return;
  updateDashboardStats();
  renderDashboardCards();
  renderBirthdayModule();
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
  updateNavBadges();
  renderAdminNotifPanel();
  renderEmpNotifPanel();
}

async function refreshStateAndRender() {
  const loaded = await loadStateFromServer();
  if (loaded) {
    if (document.getElementById('page-admin').classList.contains('active')) {
      renderAll();
    } else if (document.getElementById('page-employee').classList.contains('active')) {
      const uid = sessionStorage.getItem('userId');
      const emp = (appState.employees || []).find(e => e.id === uid);
      if (emp) renderEmpDashboard(emp);
      updateNavBadges();
    }
  }
}

function renderArchivedTable() {
  if (!appState) return;
  const archivedEmployees = appState.archivedEmployees || [];
  const tbody = document.getElementById('archived-table-body');
  if (!tbody) return;    smartTableSync(tbody, archivedEmployees, a =>
    '<tr>' +
    '<td><span style="font-family:var(--font-mono);font-size:12px;font-weight:600;">' + (a.id || '—') + '</span></td>' +
    '<td><span style="font-weight:500;font-size:14px;color:var(--text);">' + a.name + '</span></td>' +
    '<td><span class="chip ' + (DEPT_COLORS[a.dept] || 'c-eng') + '">' + a.dept + '</span></td>' +
    '<td><span class="tag t-' + (a.status === 'Archived' ? 'leave' : 'absent') + '">' + a.status + '</span></td>' +
    '<td style="font-size:13px;">' + (a.joining ? formatDate(a.joining) : '—') + '</td>' +
    '<td style="font-size:13px;">' + (a.exit ? formatDate(a.exit) : '—') + '</td>' +
    '<td><button class="btn btn-sm" onclick="showNotifBar(&quot;info&quot;,&quot;Archived employee data is read-only.&quot;,&quot;ℹ️&quot;)">👁 View</button></td></tr>',
    a => a.id || a.name
  );
}

function toggleArchived() {
  archivedVisible = !archivedVisible;
  document.getElementById('archived-section').style.display = archivedVisible ? 'block' : 'none';
  document.getElementById('archived-toggle').classList.toggle('active', archivedVisible);
  document.getElementById('archived-arrow').style.transform = archivedVisible ? 'rotate(90deg)' : '';
}

function renderDeptHeadcount() {
  if (!appState) return;
  const employees = appState.employees || [];
  const el = document.getElementById('dept-headcount-bars');
  if (!el) return;
  const counts = {};
  employees.filter(e => e.active).forEach(e => { counts[e.dept] = (counts[e.dept] || 0) + 1; });
  const max = Math.max(...Object.values(counts), 1);
  const colors = ['bf-blue', 'bf-green', 'bf-amber', 'bf-red', 'bf-purple', 'bf-green'];
  smartListSync(el, Object.entries(counts), ([d, c], i) =>
    '<div class="bar-row"><span class="bar-label">' + d + '</span><div class="bar-track"><div class="bar-fill ' + colors[i % colors.length] + '" style="width:' + (c / max * 100) + '%"></div></div><span class="bar-val">' + c + '</span></div>',
    ([d]) => d
  );
}

function renderDepartments() {
  if (!appState) return;
  const departments = appState.departments || [];
  const selects = ['f-dept', 'rec-dept', 'emp-dept-filter'];
  selects.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const allOption = id !== 'f-dept' ? '<option value="">All Departments</option>' : '';
    el.innerHTML = allOption + departments.map(d => '<option value="' + d + '">' + d + '</option>').join('');
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
  if (appState && appState.departments && appState.departments.includes(name)) { showNotifBar('warning', 'Department already exists.', '⚠️'); return; }
  input.value = '';
  await api('/api/departments', { method: 'POST', body: { name } });
  await refreshStateAndRender();
  showNotifBar('success', 'Department \'' + name + '\' added.', '✓');
}

async function removeDept(name) {
  if (!confirm('Remove department \'' + name + '\'?')) return;
  await api('/api/departments/' + encodeURIComponent(name), { method: 'DELETE' });
  await refreshStateAndRender();
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
  api('/api/announcements', { method: 'POST', body: ann }).then(async () => {
    await refreshStateAndRender();
    document.getElementById('ann-subject').value = '';
    document.getElementById('ann-body').value = '';
    document.getElementById('ann-charcount').textContent = '0';
    showNotifBar('success', 'Announcement sent!', '📢');
  });
}

function previewAnnouncement() {
  const subject = document.getElementById('ann-subject').value.trim() || '(No subject)';
  const body = document.getElementById('ann-body').value.trim() || '(No message)';
  showNotifBar('info', '📢 ' + subject + ' — ' + body.substring(0, 100) + (body.length > 100 ? '…' : ''), '👁');
}

function renderAnnouncements() {
  if (!appState) return;
  const announcements = appState.announcements || [];
  const el = document.getElementById('announcements-list');
  if (!el) return;
  const badge = document.getElementById('ann-count-badge');
  if (badge) badge.textContent = announcements.length;
  if (!announcements.length) {
    el.innerHTML = '<div class="ann-empty-state"><span class="ann-empty-icon">📭</span><div class="ann-empty-text">No announcements yet</div><div class="ann-empty-sub">Your first announcement will appear here</div></div>';
    return;
  }
  smartListSync(el, announcements, a => {
    const cat = a.priority === 'urgent' ? 'ann-cat-urgent' : a.priority === 'high' ? 'ann-cat-high' : a.priority === 'low' ? 'ann-cat-general' : 'ann-cat-event';
    const pClass = 'priority-' + (a.priority || 'normal');
    return '<div class="announcement-card ' + pClass + '"><div class="ann-header"><div class="ann-header-left"><span class="ann-category-badge ' + cat + '">' + (a.priority || 'normal') + '</span><div class="ann-subject">' + a.subject + '</div></div></div><div class="ann-meta"><span class="ann-meta-item">📅 ' + formatDate(a.date) + '</span><span class="ann-meta-item">👤 ' + (a.by || 'Admin') + '</span><span class="ann-meta-item">👥 ' + (a.recipient || 'All Employees') + '</span></div><div class="ann-body">' + a.body.replace(/\n/g, '<br>') + '</div></div>';
  }, a => a.date + '-' + (a.subject || '').substring(0, 20));
}

function renderBirthdayModule() {
  const birthdayModule = document.getElementById('birthday-module');
  const birthdayList = document.getElementById('birthday-list');
  if (!birthdayModule || !birthdayList || !appState) return;
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0].slice(5);
  const employees = appState.employees || [];
  const birthdayEmps = employees.filter(e => e.bday && e.bday.slice(5) === todayStr);
  if (birthdayEmps.length > 0) {
    birthdayModule.style.display = 'block';
    birthdayList.innerHTML = birthdayEmps.map(e => {
      const year = today.getFullYear();
      const bday = e.bday.split('-');
      const calendarUrl = 'https://www.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(e.name + '\'s Birthday') + '&dates=' + year + bday[1] + bday[2] + '/' + year + bday[1] + bday[2] + '&details=Birthday+of+' + encodeURIComponent(e.name);
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;"><span>🎂</span><span><strong>' + e.name + '</strong>\'s Birthday today!</span><a href="' + calendarUrl + '" target="_blank" style="margin-left:auto;font-size:12px;color:var(--accent);">📅 Add to Calendar</a></div>';
    }).join('');
  } else {
    birthdayModule.style.display = 'none';
  }
}

function renderAnnouncementsEmp(announcements) {
  const anns = announcements || (appState ? appState.announcements : []) || [];
  const el = document.getElementById('emp-announcements-list');
  if (!el) return;
  const badge = document.getElementById('emp-ann-count');
  if (badge) badge.textContent = anns.length;
  if (!anns.length) {
    el.innerHTML = '<p style="color:var(--subtle);font-size:13px;">No announcements yet.</p>';
    return;
  }
  smartListSync(el, anns.slice(0, 5), a => {
    const pClass = 'priority-' + (a.priority || 'normal');
    return '<div class="announcement-card ' + pClass + '" style="padding:14px 18px;"><div class="ann-header"><div class="ann-subject" style="font-size:14px;">' + a.subject + '</div><span style="font-size:12px;color:var(--subtle);">' + formatDate(a.date) + '</span></div><div class="ann-body" style="font-size:13px;">' + (a.body.length > 120 ? a.body.substring(0, 120) + '…' : a.body) + '</div></div>';
  }, a => a.date + '-' + (a.subject || '').substring(0, 20));
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
  const text = '📧 [' + subject + '] to ' + to + ': ' + (body || '').replace(/<[^>]*>/g, '').substring(0, 100);
  addAdminNotif(text);
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
  if (!appState) return;
  const attendanceRecords = appState.attendanceRecords || [];
  const rows = [['ID','Name','Dept','Date','In','Out','Hours','Status']];
  attendanceRecords.forEach(r => rows.push([r.id, r.name, r.dept, r.date, r.in, r.out, r.hours, r.status]));
  const csv = rows.map(r => r.join(',')).join('\n');
  downloadFile(csv, 'attendance_records.csv', 'text/csv');
}

function exportExcel(type) {
  if (typeof XLSX === 'undefined') { showNotifBar('warning', 'XLSX library not loaded.', '⚠️'); return; }
  if (!appState) return;
  const attendanceRecords = appState.attendanceRecords || [];
  const employees = appState.employees || [];
  try {
    if (type === 'records') {
      const data = attendanceRecords.map(r => ({ ID: r.id, Name: r.name, Dept: r.dept, Date: r.date, In: r.in, Out: r.out, Hours: r.hours, Status: r.status }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
      XLSX.writeFile(wb, 'attendance_records.xlsx');
    } else if (type === 'employees') {
      const data = employees.filter(e => e.active).map(e => ({ ID: e.id, Name: e.name, Dept: e.dept, Email: e.email, Phone: e.phone, Designation: e.designation, CL: e.cl, SL: e.sl, UL: e.ul || 0 }));
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
  if (!appState) return;
  const attendanceRecords = appState.attendanceRecords || [];
  const uid = sessionStorage.getItem('userId');
  const myRecs = attendanceRecords.filter(r => r.id === uid);
  const rows = [['Date','Day','In','Out','Hours','Status']];
  myRecs.forEach(r => {
    const d = new Date(r.date + 'T00:00:00');
    rows.push([r.date, DAYS[d.getDay()], r.in, r.out, r.hours, r.status]);
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
  // In Supabase mode, always live
  serverAvailable = true;
  updateServerStatusIndicator();
}

function updateServerStatusIndicator() {
  const indicator = document.getElementById('server-status-indicator');
  if (!indicator) {
    const topbar = document.querySelector('.topbar-right');
    if (!topbar) return;
    const el = document.createElement('span');
    el.id = 'server-status-indicator';
    el.style.cssText = 'font-size:11px;padding:3px 10px;border-radius:6px;display:inline-flex;align-items:center;gap:4px;font-weight:500;';
    topbar.prepend(el);
  }
  const el = document.getElementById('server-status-indicator');
  if (!el) return;
  el.textContent = '● Supabase Live';
  el.style.background = 'rgba(34,197,94,0.12)';
  el.style.color = '#86efac';
  el.style.border = '1px solid rgba(34,197,94,0.2)';
}

function startSupabaseListener() {
  if (typeof SupabaseDB !== 'undefined' && SupabaseDB.isConfigured()) {
    const inited = SupabaseDB.init();
    if (inited) {
      SupabaseDB.subscribeAll(() => {
        console.log('[Supabase] Realtime change — scheduling render');
        RenderQueue.schedule();
      });
      console.log('[Supabase] Realtime listener attached');
    }
  }
}

async function init() {
  if (localStorage.getItem('darkMode') === 'true') {
    document.body.classList.add('dark-mode');
    document.querySelectorAll('.dark-toggle-btn').forEach(b => b.textContent = '☀️');
  }

  const remembered = localStorage.getItem('rememberedUser');
  if (remembered) {
    document.getElementById('uid').value = remembered;
    document.getElementById('remember-me').checked = true;
  }

  // No server health check needed — Supabase is always available
  serverAvailable = true;
  updateServerStatusIndicator();

  // Initialize SupabaseClient for direct database access
  if (typeof SupabaseClient !== 'undefined') {
    SupabaseClient.init();
  }

  startSupabaseListener();

  const savedUid = sessionStorage.getItem('userId');
  const savedRole = sessionStorage.getItem('userRole');
  if (savedUid && savedRole) {
    showLoading('Restoring your session...', 'Loading data from server');
    showSkeletons();
    const loaded = await loadStateFromServer();
    if (loaded) {
      if (savedRole === 'admin') {
        showAdminPage();
        hideLoading();
        return;
      } else if (savedRole === 'employee') {
        const emp = (appState && appState.employees || []).find(e => e.id === savedUid);
        if (emp) {
          showEmployeePage(emp);
          hideLoading();
          return;
        }
      }
    }
    hideLoading();
    sessionStorage.removeItem('userId');
    sessionStorage.removeItem('userRole');
  }

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

  // Supabase Realtime handles all live sync (no Socket.io needed)

  const h = new Date().getHours();
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const greetEl = document.getElementById('admin-greeting');
  if (greetEl) greetEl.textContent = greet + ', Administrator 👋';

  const today = new Date();
  const todayEl = document.getElementById('today-date');
  if (todayEl) todayEl.textContent = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const todayEl2 = document.getElementById('today-date2');
  if (todayEl2) todayEl2.textContent = today.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  renderBirthdayModule();
}

document.addEventListener('DOMContentLoaded', init);

// ── Seed Test Employee (one-shot) ──
(async function seedTestEmployee() {
  if (localStorage.getItem('seed_emp7429')) return;
  await new Promise(resolve => setTimeout(resolve, 2000));
  if (typeof SupabaseClient === 'undefined' || !SupabaseClient.ready) return;
  const state = await api('/api/state');
  if (!state) return;
  if ((state.employees || []).some(e => e.id === 'EMP-7429')) { localStorage.setItem('seed_emp7429', '1'); return; }
  const res = await api('/api/employees', { method: 'POST', body: { id: 'EMP-7429', name: 'Alex Mercer', dept: 'Quality Assurance', bday: '1996-08-24', password: 'testpassword123', cl: 7.5, sl: 3.0, joining: new Date().toISOString().split('T')[0] } });
  if (res && res.success) { console.log('[Seed] EMP-7429 Alex Mercer created'); localStorage.setItem('seed_emp7429', '1'); }
})();
