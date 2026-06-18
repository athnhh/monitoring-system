const ADMIN_EMAIL = 'atharvashishn@gmail.com';
const ADMIN_USERNAME = 'quemahtech';

let currentUser = null;
let currentRole = '';
let currentLeaveType = 'CL';
let archivedVisible = false;
let adminNotifPanelOpen = false;
let empNotifPanelOpen = false;

let selectedLeaveManageIdx = null;
let archiveTargetId = null;
let removeTargetId = null;
let pendingUndoArchiveId = null;
let pendingUndoArchiveName = null;
let pendingUndoTimeout = null;
let annSelectedPriority = 'normal';
let serverAvailable = false;
let _pendingTabSwitch = null;
let _reportRows = [];

// Track nav badges cleared by user tab click — persisted in sessionStorage so they survive refresh
const clearedNavBadges = new Set();
function _saveClearedBadges() {
  sessionStorage.setItem('clearedNavBadges', JSON.stringify([...clearedNavBadges]));
}
function _loadClearedBadges() {
  try {
    const saved = JSON.parse(sessionStorage.getItem('clearedNavBadges'));
    if (saved) saved.forEach(id => clearedNavBadges.add(id));
  } catch (_) {}
}
_loadClearedBadges();

let appState = null;



// ══ HTML Template Validation (dev-only) ══
// Catches unclosed tags in template strings before they break the DOM
const __DEBUG_HTML = window.location.hostname === 'localhost' || window.location.search.includes('debug');
const __VOID_TAGS = new Set(['br','hr','img','input','meta','link','area','base','col','embed','source','track','wbr']);

function __checkHTMLTemplate(html, label) {
  if (!__DEBUG_HTML || !html || html.length < 10) return true;
  const openings = [...html.matchAll(/<([a-zA-Z]\w*)(?:\s[^>]*)?>/g)].map(m => m[1].toLowerCase()).filter(t => !__VOID_TAGS.has(t));
  const closings = [...html.matchAll(/<\/([a-zA-Z]\w*)>/g)].map(m => m[1].toLowerCase());
  const oCount = {}; openings.forEach(t => oCount[t] = (oCount[t] || 0) + 1);
  const cCount = {}; closings.forEach(t => cCount[t] = (cCount[t] || 0) + 1);
  const allTags = new Set([...Object.keys(oCount), ...Object.keys(cCount)]);
  let valid = true;
  for (const tag of allTags) {
    if (oCount[tag] !== cCount[tag]) {
      console.warn('[HTML Validation] Tag mismatch in "' + label + '": <' + tag + '> opened ' + (oCount[tag] || 0) + '×, closed ' + (cCount[tag] || 0) + '×');
      console.warn('   Context: ' + html.substring(0, 300));
      valid = false;
    }
  }
  return valid;
}

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
      const _rowHtml = rowHtmlFn(item, idx);
      __checkHTMLTemplate(_rowHtml, 'table');
      tmp.innerHTML = _rowHtml;
      const innerRow = tmp.querySelector('tr');
      const newCells = innerRow ? innerRow.children : [];
      for (let c = 0; c < newCells.length; c++) {
        if (row.children[c]) row.children[c].innerHTML = newCells[c].innerHTML;
      }
      frag.appendChild(row);
    } else {
      // Create new row with entrance animation
      const tmp = document.createElement('tbody');
      const _rowHtml = rowHtmlFn(item, idx);
      __checkHTMLTemplate(_rowHtml, 'table');
      tmp.innerHTML = _rowHtml;
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
    }, 400);
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
      const _listHtml = htmlFn(item, idx);
      __checkHTMLTemplate(_listHtml, 'list');
      // Safer injection: match opening tag to add data-id
      el.outerHTML = _listHtml.replace(/^<(\w+)/, `<$1 data-id="${id}"`);
      // Re-query the replaced element
      const updated = container.querySelector(`[data-id="${id}"]`);
      if (updated) frag.appendChild(updated);
    } else {
      // New element with entrance animation
      const wrapper = document.createElement('div');
      const _listHtml = htmlFn(item, idx);
      __checkHTMLTemplate(_listHtml, 'list');
      wrapper.innerHTML = _listHtml;
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
    }, 400);
  } else {
    container.replaceChildren(frag);
  }
}

// ── RAF-Batched Render Scheduler ──
// Coalesces multiple real-time events into a single frame-accurate re-render.
// Prevents flicker when rapid realtime events arrive.
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
  if (tabName === 'dashboard') markAdminNotifsRead();
  // Clear the nav badge for this tab on click
  const badgeMap = { dashboard: 'nav-badge-dash', employees: 'nav-badge-emps', leaves: 'nav-badge-leaves', announcements: 'nav-badge-ann' };
  if (badgeMap[tabName]) {
    clearedNavBadges.add(badgeMap[tabName]); _saveClearedBadges();
    const el = document.getElementById(badgeMap[tabName]);
    if (el) { el.classList.add('hidden'); el.textContent = ''; }
  }
  switchTab('#page-admin', 'admin', tabName, btnElement, async () => {
    // Refresh state on tab switch so all views show latest data
    await refreshStateAndRender();
    if (tabName === 'records') renderRecords();
    if (tabName === 'reports') setReport('daily', document.querySelector('.rtab.active'));
    if (tabName === 'settings') { loadCalendarConfig(); }
    if (tabName === 'employees') renderAll();
  });
}

function updateDashboardStats() {
  if (!appState) return;
  const now = new Date();
  const today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  const logs = appState.attendanceLogs || [];
  const leaveReqs = appState.leaveRequests || [];
  const activeEmployees = (appState.employees || []).filter(e => e.active);
  const todayLogs = logs.filter(l => (l.login_date || getDateFromISO(l.login_time)) === today);
  // Unique employees with any session today
  const presentSet = new Set();
  const lateSet = new Set();
  todayLogs.forEach(l => {
    if (l.status === 'Present' || l.status === 'Late' || l.status === 'Half-Day' || l.status === 'Active') {
      presentSet.add(l.emp_id);
      if (l.status === 'Late') lateSet.add(l.emp_id);
    }
  });
  // Employees on approved leave today
  const onLeaveIds = new Set(
    (leaveReqs || []).filter(lr =>
      lr.status === 'Approved' && lr.from && lr.to && today >= lr.from && today <= lr.to
    ).map(lr => lr.empId).filter(Boolean)
  );
  const present = presentSet.size;
  const late = lateSet.size;
  const onLeave = onLeaveIds.size;
  const absent = activeEmployees.length - present - onLeave;
  const total = activeEmployees.length;
  const rate = total > 0 ? Math.round(present / total * 100) : 0;
  setText('stat-total-emp', total);
  setText('stat-present-today', present);
  setText('stat-absent-today', Math.max(0, absent));
  setText('stat-late-today', late);
}

function renderDashboardCards() {
  if (!appState) return;
  updateDashboardStats();
  const now = new Date();
  const today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  const employees = appState.employees || [];
  const logs = appState.attendanceLogs || [];
  const leaveRequests = appState.leaveRequests || [];
  const todayLogs = logs.filter(l => (l.login_date || getDateFromISO(l.login_time)) === today);
  // Group today logs by employee — pick latest session per emp
  const empLatest = {};
  todayLogs.forEach(l => {
    if (!empLatest[l.emp_id] || new Date(l.login_time) > new Date(empLatest[l.emp_id].login_time)) {
      empLatest[l.emp_id] = l;
    }
  });
  const latestTodayLogs = Object.values(empLatest);
  const presentLogs = latestTodayLogs.filter(l => ['Present', 'Late', 'Half-Day', 'Active'].includes(l.status));
  const absentEmpIds = employees.filter(e => e.active).map(e => e.id).filter(id => !empLatest[id]);
  const absentEmps = absentEmpIds.map(id => employees.find(e => e.id === id)).filter(Boolean);
  // Check which absent employees are on approved leave today
  const today2 = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  const leaveReqsToday = (appState.leaveRequests || []).filter(lr =>
    lr.status === 'Approved' && lr.from && lr.to && today2 >= lr.from && today2 <= lr.to
  );
  const onLeaveToday = new Set(leaveReqsToday.map(lr => lr.empId).filter(Boolean));
  const activeNowCount = presentLogs.filter(l => !l.logout_time).length;
  const pEl = document.getElementById('a-present');
  const aEl = document.getElementById('a-absent');
  setText('title-present-count', 'Present (' + presentLogs.length + ')' + (activeNowCount > 0 ? '  •  ' + activeNowCount + ' Active Now' : ''));
  setText('title-absent-count', 'Absent (' + Math.max(0, absentEmps.length - onLeaveToday.size) + ') / On Leave (' + onLeaveToday.size + ')');
  // Smart sync for present list
  if (pEl) {
    if (presentLogs.length) {
      smartListSync(pEl, presentLogs, l => actRowEmp(l, employees), l => l.emp_id);
    } else {
      pEl.innerHTML = '<p style="color:var(--subtle);font-size:13px;">No one present yet.</p>';
    }
  }
  // Smart sync for absent list
  if (aEl) {
    if (absentEmps.length) {
      smartListSync(aEl, absentEmps, function(e){ return absentRow(e, onLeaveToday.has(e.id) ? 'On Leave' : 'Absent'); }, function(e){ return e.id; });
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
      if (empLatest[emp.id]) deptData[emp.dept].present++;
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
    smartTableSync(logEl, latestTodayLogs, l =>
      '<tr data-log-id="' + l.id + '" class="session-row">' +
      '<td><div style="display:flex;align-items:center;gap:10px;">' +
        '<div class="av ' + AV_COLORS[employees.findIndex(e => e.id === l.emp_id) % AV_COLORS.length] + '" style="flex-shrink:0;">' + l.emp_name.charAt(0) + '</div>' +
        '<div style="display:flex;flex-direction:column;">' +
          '<span style="font-weight:600;font-size:14px;color:var(--text);display:flex;align-items:center;gap:6px;">' + (l.logout_time ? '' : '<span class="pulse-dot"style="width:8px;height:8px;"></span>') + '<span>' + l.emp_name + '</span></span>' +
      '<span style="font-size:11px;color:var(--subtle);">' + l.emp_id + '</span>' +
        '</div>' +
      '</div></td>' +
      '<td><span class="chip ' + (DEPT_COLORS[l.department] || 'c-eng') + '">' + l.department + '</span></td>' +
      '<td><span style="font-family:var(--font-mono);font-size:13px;font-weight:600;color:#16a34a;">' + formatTime(l.login_time) + '</span></td>' +
      '<td><span style="font-family:var(--font-mono);font-size:13px;font-weight:600;color:#dc2626;">' + (l.logout_time ? formatTime(l.logout_time) : '<span style="color:#d97706;font-weight:600;">Active Now</span>') + '</span></td>' +
      '<td><strong style="font-size:14px;">' + (l.working_hours > 0 ? l.working_hours.toFixed(1) + 'h' : '—') + '</strong></td>' +
      '<td><span class="tag t-' + l.status.toLowerCase().replace(/[-\s]/g, '') + '">' + l.status + '</span></td></tr>',
      l => l.emp_id
    );
  }

  // Render Active Now dedicated card
  renderActiveNow(latestTodayLogs, employees);

  renderDashPendingLeaves(leaveRequests);
}

function calcActiveDuration(loginTime) {
  if (!loginTime) return '';
  const start = new Date(loginTime);
  const now = new Date();
  const diffMs = now - start;
  if (diffMs < 0) return '—';
  const hrs = Math.floor(diffMs / 3600000);
  const mins = Math.floor((diffMs % 3600000) / 60000);
  if (hrs > 0) return hrs + 'h ' + mins + 'm';
  return mins + 'm';
}

function renderActiveNow(todayLogs, employees) {
  const emps = employees || (appState ? appState.employees : []) || [];
  const logs = todayLogs || (appState ? (appState.attendanceLogs || []).filter(l => { const d = new Date(); const ld = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); return (l.login_date || getDateFromISO(l.login_time)) === ld; }) : []);
  const deptFilter = document.getElementById('active-now-dept-filter')?.value || '';
  let activeLogs = logs.filter(l => ['Present', 'Late', 'Half-Day', 'Active'].includes(l.status) && !l.logout_time);
  if (deptFilter) {
    activeLogs = activeLogs.filter(l => (l.department || '') === deptFilter);
  }
  const card = document.getElementById('active-now-card');
  const list = document.getElementById('active-now-list');
  const countEl = document.getElementById('active-now-count');
  if (!card || !list) return;
  if (activeLogs.length === 0) {
    card.style.display = 'none';
    return;
  }
  card.style.display = 'block';
  if (countEl) countEl.textContent = activeLogs.length + ' signed in';
  // Use smartListSync for flicker-free updates
  smartListSync(list, activeLogs, l => {
    const idx = emps.findIndex(e => e.id === l.emp_id);
    const avColor = AV_COLORS[Math.max(0, idx) % AV_COLORS.length];
    return '<div class="active-now-item">' +
      '<span class="active-now-pulse"></span>' +
      '<div class="active-now-av ' + avColor + '">' + l.emp_name.charAt(0) + '</div>' +
      '<div class="active-now-body">' +
        '<div class="active-now-name">' + l.emp_name + '</div>' +
        '<div class="active-now-dept">' + (l.department || emps[idx]?.dept || '') + '</div>' +
      '</div>' +
      '<div class="active-now-meta">' +
        '<div class="active-now-time">' + formatTime(l.login_time) + '</div>' +
        '<div class="active-now-duration">' + calcActiveDuration(l.login_time) + '</div>' +
      '</div>' +
    '</div>';
  }, l => l.emp_id);
}

function actRowEmp(l, employees) {
  const emps = employees || (appState ? appState.employees : []) || [];
  const idx = emps.findIndex(e => e.id === l.emp_id);
  const isActive = !l.logout_time;
  return '<div class="act-row">' +
    '<div class="av ' + AV_COLORS[Math.max(0, idx) % AV_COLORS.length] + '" style="flex-shrink:0;">' + l.emp_name.charAt(0) + '</div>' +
    '<div style="flex:1;min-width:0;">' +
      '<div style="display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
        (isActive ? '<span class="pulse-dot"></span>' : '') +
        '<span>' + l.emp_name + '</span>' +
        (isActive ? '<span class="tag t-present" style="font-size:10px;padding:2px 8px;font-weight:600;">Active Now</span>' : '') +
      '</div>' +
      '<div style="font-size:12px;color:var(--subtle);margin-top:2px;">' + l.department + '</div>' +
    '</div>' +
    '<span class="tag t-' + l.status.toLowerCase().replace(/[-\s]/g, '') + '" style="flex-shrink:0;">' + l.status + '</span></div>';
}

function absentRow(e, statusText) {
  var st = statusText || 'Absent';
  var tagClass = st.toLowerCase().replace(/[-\s]/g, '');
  return '<div class="act-row">' +
    '<div class="av ' + AV_COLORS[0] + '" style="flex-shrink:0;">' + e.name.charAt(0) + '</div>' +
    '<div style="flex:1;min-width:0;">' +
      '<div style="font-size:14px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + e.name + '</div>' +
      '<div style="font-size:12px;color:var(--subtle);margin-top:2px;">' + e.dept + '</div>' +
    '</div>' +
    '<span class="tag t-' + tagClass + '" style="flex-shrink:0;">' + st + '</span></div>';
}

function renderDashPendingLeaves(leaveRequests) {
  const el = document.getElementById('dash-pending-leaves');
  if (!el) return;
  const leaveReqs = leaveRequests || (appState ? appState.leaveRequests : []) || [];
  const pending = leaveReqs.filter(l => l.status === 'Pending');
  if (!pending.length) { el.innerHTML = '<p style="color:var(--subtle);font-size:13px;">No pending requests.</p>'; return; }
  smartListSync(el, pending, l => leaveReqCard(l), l => l.id || l.empId + '-' + l.from);
}

function renderRecords() {
  if (!appState) return;
  const logs = appState.attendanceLogs || [];
  const employees = appState.employees || [];
  const leaveReqs = appState.leaveRequests || [];
  const dateF = document.getElementById('rec-date')?.value || '';
  const deptF = document.getElementById('rec-dept')?.value || '';
  const statusF = document.getElementById('rec-status')?.value || '';
  const tbody = document.getElementById('a-records');
  if (!tbody) return;

  const effectiveDate = dateF || new Date().toISOString().split('T')[0];

  // ── Helper: find empIds on approved leave covering a date ──
  function _onLeaveIds(dateStr) {
    var ids = [];
    for (var i = 0; i < leaveReqs.length; i++) {
      var lr = leaveReqs[i];
      if (lr.status === 'Approved' && lr.from && lr.to && dateStr >= lr.from && dateStr <= lr.to) {
        if (lr.empId && ids.indexOf(lr.empId) === -1) ids.push(lr.empId);
      }
    }
    return ids;
  }

  // ── Step 1: Filter logs by date (always scoped to effective date) ──
  var recs = logs.slice();
  recs = recs.filter(function(l){ return (l.login_date || getDateFromISO(l.login_time)) === effectiveDate; });

  // ── Step 2: Filter by department ──
  if (deptF) recs = recs.filter(function(l){ return l.department === deptF; });

  // ── Step 3: Build rows ──
  var rows = [];

  if (statusF === 'Absent') {
    var loggedIds = new Set(recs.map(function(l){ return l.emp_id; }));
    var leaveIds = _onLeaveIds(effectiveDate);
    var onLeaveSet = new Set(leaveIds);
    var _today = new Date().toISOString().split('T')[0];
    var absentEmps = employees.filter(function(e){ return e.active && !loggedIds.has(e.id) && !onLeaveSet.has(e.id) && (e.joining ? e.joining <= effectiveDate : effectiveDate >= _today); });
    if (deptF) absentEmps = absentEmps.filter(function(e){ return e.dept === deptF; });
    rows = absentEmps.map(function(emp){ return { _type:'absent', emp_id:emp.id, emp_name:emp.name, department:emp.dept, login_time:null, logout_time:null, working_hours:0, status:'Absent' }; });
  } else if (statusF === 'Leave') {
    var leaveIds2 = _onLeaveIds(effectiveDate);
    var onLeaveSet2 = new Set(leaveIds2);
    var _today = new Date().toISOString().split('T')[0];
    var leaveEmps = employees.filter(function(e){ return e.active && onLeaveSet2.has(e.id) && (e.joining ? e.joining <= effectiveDate : effectiveDate >= _today); });
    if (deptF) leaveEmps = leaveEmps.filter(function(e){ return e.dept === deptF; });
    rows = leaveEmps.map(function(emp){ return { _type:'absent', emp_id:emp.id, emp_name:emp.name, department:emp.dept, login_time:null, logout_time:null, working_hours:0, status:'Leave' }; });
  } else {
    if (statusF) {
      if (statusF === 'Present') {
        console.log('[Records] Present filter: recs before status filter =', recs.length);
        console.log('[Records] Status values in recs:', recs.map(function(l){ return JSON.stringify(l.status); }));
        recs = recs.filter(function(l){ return ['Present', 'Late', 'Half-Day', 'Active'].includes(l.status); });
        console.log('[Records] Present filter: recs after status filter =', recs.length);
      } else {
        recs = recs.filter(function(l){ return l.status === statusF; });
      }
    }
    rows = recs.map(function(l){ return { _type:'log', _id:l.id, emp_id:l.emp_id, emp_name:l.emp_name, department:l.department, login_time:l.login_time, logout_time:l.logout_time, working_hours:l.working_hours, status:l.status, computer_name: l.computer_name || '' }; });

    // All Status: add absent + leave employees
    if (!statusF) {
      var loggedIds2 = new Set(recs.map(function(l){ return l.emp_id; }));
      var leaveIds3 = _onLeaveIds(effectiveDate);
      var onLeaveSet3 = new Set(leaveIds3);
      var _today = new Date().toISOString().split('T')[0];
      var otherEmps = employees.filter(function(e){ return e.active && !loggedIds2.has(e.id) && (e.joining ? e.joining <= effectiveDate : effectiveDate >= _today); });
      if (deptF) otherEmps = otherEmps.filter(function(e){ return e.dept === deptF; });
      for (var i = 0; i < otherEmps.length; i++) {
        var emp = otherEmps[i];
        rows.push({
          _type:'absent', emp_id:emp.id, emp_name:emp.name, department:emp.dept,
          login_time:null, logout_time:null, working_hours:0,
          status: onLeaveSet3.has(emp.id) ? 'Leave' : 'Absent'
        });
      }
      // Sort: present/active first, leave second, absent last
      rows.sort(function(a,b){
        var order = { Leave:1, Absent:2 };
        var ao = order[a.status] || 0;
        var bo = order[b.status] || 0;
        return ao - bo;
      });
    }
  }

  // ── Step 4: Render ──
  smartTableSync(tbody, rows, function(r){
    var empIdx = employees.findIndex(function(e){ return e.id === r.emp_id; });
    var avColor = AV_COLORS[Math.max(0, empIdx) % AV_COLORS.length];
    var isAbsent = (r.status === 'Absent' || r.status === 'Leave');
    var hasLogin = !!r.login_time;
    var hasLogout = !!r.logout_time;
    var tagClass = r.status.toLowerCase().replace(/[-\s]/g, '');

    return '<tr data-id="' + (r._id || 'absent-' + r.emp_id) + '">' +
      '<td><span style="font-family:var(--font-mono);font-size:12px;color:var(--text);font-weight:600;">' + r.emp_id + '</span></td>' +
      '<td><div style="display:flex;align-items:center;gap:10px;">' +
        '<div class="av ' + avColor + '" style="flex-shrink:0;width:32px;height:32px;font-size:12px;">' + r.emp_name.charAt(0) + '</div>' +
        '<div style="display:flex;flex-direction:column;">' +
          '<span style="font-weight:600;font-size:14px;color:var(--text);display:flex;align-items:center;gap:6px;">' +
            (isAbsent ? '' : hasLogout ? '' : '<span class="pulse-dot" style="width:8px;height:8px;"></span>') +
            '<span>' + r.emp_name + '</span>' +
          '</span>' +
        '</div>' +
      '</div></td>' +
      '<td><span class="chip ' + (DEPT_COLORS[r.department] || 'c-eng') + '">' + r.department + '</span></td>' +
      '<td>' + (hasLogin ? formatDate(getDateFromISO(r.login_time)) : formatDate(effectiveDate)) + '</td>' +
      '<td>' + (hasLogin ? '<span style="font-family:var(--font-mono);font-size:13px;font-weight:600;color:#16a34a;">' + formatTime(r.login_time) + '</span>' : '<span style="color:var(--subtle);">—</span>') + '</td>' +
      '<td>' + (hasLogout ? '<span style="font-family:var(--font-mono);font-size:13px;font-weight:600;color:#dc2626;">' + formatTime(r.logout_time) + '</span>' : isAbsent ? '<span style="color:var(--subtle);">—</span>' : '<span style="color:#d97706;font-weight:600;">Active</span>') + '</td>' +
      '<td>' + (r.working_hours > 0 ? '<strong style="font-size:14px;">' + r.working_hours.toFixed(1) + 'h</strong>' : '<span style="color:var(--subtle);">—</span>') + '</td>' +
      '<td><span class="tag t-' + tagClass + '">' + r.status + '</span></td>' +
      '<td style="font-size:12px;color:var(--subtle);">' + (r.computer_name || '—') + '</td>' +
      '<td style="font-size:12px;color:var(--subtle);">' + (r.status === 'Half-Day' ? 'Login after 14:00' : '') + '</td></tr>';
  }, function(r){ return r.emp_id + '-' + (r._id || ''); });
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
    '<td><button class="btn btn-sm" onclick="openEditEmpModal(\'' + emp.id + '\')" title="Edit">Edit</button> ' +
    '<button class="btn btn-sm" onclick="archiveEmployee(\'' + emp.id + '\')" title="Archive">Archive</button> ' +
    '<button class="btn btn-sm btn-danger" onclick="openRemoveEmpModal(\'' + emp.id + '\')" title="Remove">Remove</button></td></tr>',
    emp => emp.id
  );
}

function setModalHeader(title) {
  const header = document.querySelector('#delete-emp-modal .modal-header h3');
  if (header) header.textContent = title;
}

function archiveEmployee(empId) {
  if (!appState) return;
  const emp = (appState.employees || []).find(e => e.id === empId);
  if (!emp) return;
  archiveTargetId = empId;
  removeTargetId = null;
  setModalHeader('Archive Employee');
  document.getElementById('delete-emp-modal').dataset.mode = 'archive';
  const modalBody = document.querySelector('#delete-emp-modal .modal-body');
  if (modalBody) {
    modalBody.innerHTML = '' +
      '<p style="font-size:16px;margin-bottom:8px;">Archive <strong>' + emp.name + '</strong>?</p>' +
      '<p style="font-size:13px;color:var(--amber-text, #92400e);margin-bottom:16px;">They will be moved to the archived employees section. Data preserved for compliance.</p>' +
      '<div style="display:flex;gap:10px;justify-content:center;">' +
        '<button class="btn" onclick="closeDeleteEmpModal()" style="flex:1;">Cancel</button>' +
        '<button class="btn btn-primary" id="archive-confirm-btn" onclick="confirmArchiveEmployee()" style="flex:1;">Archive Employee</button>' +
      '</div>';
  }
  document.getElementById('delete-emp-modal').style.display = 'flex';
}

async function confirmArchiveEmployee() {
  if (!archiveTargetId || !appState) return;
  const emp = (appState.employees || []).find(e => e.id === archiveTargetId);
  if (!emp) { showNotifBar('error', 'Employee not found.'); closeDeleteEmpModal(); return; }
  const confirmBtn = document.getElementById('archive-confirm-btn');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<span class="loading-spinner-sm" style="margin-right:6px;vertical-align:middle;"></span> Archiving...';
  }
  const res = await api('/api/employees/' + archiveTargetId + '/archive', { method: 'POST' });
  closeDeleteEmpModal();
  await refreshStateAndRender();
  if (res && res.success) {
    pendingUndoArchiveId = archiveTargetId;
    pendingUndoArchiveName = emp.name;
    const empName = emp.name;
    // Clear any previous undo timer
    if (pendingUndoTimeout) clearTimeout(pendingUndoTimeout);
    pendingUndoTimeout = setTimeout(() => {
      pendingUndoArchiveId = null;
      pendingUndoArchiveName = null;
      pendingUndoTimeout = null;
    }, 5000);
    showNotifBar('success', 'CSV exported!');
}

function exportReportCSV() {
  if (!appState || !_reportRows.length) { showNotifBar('warning', 'No report data to export. Load a report first.'); return; }
  const activeType = document.querySelector('.rtab.active')?.dataset?.reportType || 'daily';
  const label = activeType.charAt(0).toUpperCase() + activeType.slice(1);
  const rows = [['ID','Employee','Dept','Date','Login','Logout','Hours','Status','Device']];
  _reportRows.forEach(function(r) {
    rows.push([
      r.emp_id,
      r.emp_name,
      r.department,
      r.login_time ? getDateFromISO(r.login_time) : (r.status === 'Absent' || r.status === 'Leave' ? '—' : ''),
      r.login_time ? formatTime(r.login_time) : '—',
      r.logout_time ? formatTime(r.logout_time) : (r.status === 'Absent' || r.status === 'Leave' ? '—' : 'Active'),
      r.working_hours > 0 ? r.working_hours.toFixed(1) : (r.status === 'Absent' || r.status === 'Leave' ? '0' : '—'),
      r.status,
      r.computer_name || ''
    ]);
  });
  const csv = rows.map(function(row) {
    return row.map(function(cell) { return '"' + String(cell).replace(/"/g, '""') + '"'; }).join(',');
  }).join('
');
  downloadFile(csv, label.toLowerCase() + '_report_' + new Date().toISOString().split('T')[0] + '.csv', 'text/csv');
  showNotifBar('success', label + ' report CSV exported!');
}

function exportReportExcel() {
  if (typeof XLSX === 'undefined') { showNotifBar('warning', 'XLSX library not loaded.'); return; }
  if (!appState || !_reportRows.length) { showNotifBar('warning', 'No report data to export. Load a report first.'); return; }
  const activeType = document.querySelector('.rtab.active')?.dataset?.reportType || 'daily';
  const label = activeType.charAt(0).toUpperCase() + activeType.slice(1);
  var dateStr = new Date().toISOString().split('T')[0];
  var filename = label.toLowerCase() + '_report_' + dateStr;
  var wb = XLSX.utils.book_new();

  try {
    var detailData = _reportRows.map(function(r) {
      return {
        ID: r.emp_id,
        Employee: r.emp_name,
        Department: r.department,
        Date: r.login_time ? getDateFromISO(r.login_time) : (r.status === 'Absent' || r.status === 'Leave' ? '—' : ''),
        Login: r.login_time ? formatTime(r.login_time) : '—',
        Logout: r.logout_time ? formatTime(r.logout_time) : (r.status === 'Absent' || r.status === 'Leave' ? '—' : 'Active'),
        'Hours Worked': r.working_hours > 0 ? parseFloat(r.working_hours.toFixed(2)) : 0,
        Status: r.status,
        Device: r.computer_name || ''
      };
    });
    var wsDetail = XLSX.utils.json_to_sheet(detailData);
    wsDetail['!cols'] = [
      { wch: 10 }, { wch: 20 }, { wch: 15 }, { wch: 14 },
      { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 18 }
    ];
    XLSX.utils.book_append_sheet(wb, wsDetail, label + ' Detail');

    var empSummary = {};
    _reportRows.forEach(function(r) {
      if (r.status === 'Absent' || r.status === 'Leave') return;
      if (!empSummary[r.emp_id]) {
        empSummary[r.emp_id] = {
          emp_id: r.emp_id,
          emp_name: r.emp_name,
          department: r.department,
          total_hours: 0,
          sessions: 0,
          days_present: new Set()
        };
      }
      empSummary[r.emp_id].total_hours += r.working_hours || 0;
      empSummary[r.emp_id].sessions++;
      if (r.login_time) empSummary[r.emp_id].days_present.add(getDateFromISO(r.login_time));
    });
    var summaryData = Object.keys(empSummary).map(function(k) {
      var e = empSummary[k];
      return {
        ID: e.emp_id,
        Employee: e.emp_name,
        Department: e.department,
        'Days Present': e.days_present.size,
        'Total Sessions': e.sessions,
        'Total Hours': parseFloat(e.total_hours.toFixed(2)),
        'Avg Hours/Day': parseFloat((e.total_hours / Math.max(1, e.days_present.size)).toFixed(2))
      };
    });
    var wsSummary = XLSX.utils.json_to_sheet(summaryData);
    wsSummary['!cols'] = [
      { wch: 10 }, { wch: 20 }, { wch: 15 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 14 }
    ];
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Hours Summary');

    XLSX.writeFile(wb, filename + '.xlsx');
    showNotifBar('success', label + ' report exported to Excel with hours breakdown!');
  } catch (e) {
    showNotifBar('error', 'Export failed: ' + e.message);
  }
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
  el.textContent = 'Supabase Live';
  el.style.background = 'rgba(34,197,94,0.12)';
  el.style.color = '#86efac';
  el.style.border = '1px solid rgba(34,197,94,0.2)';
}

function startSupabaseListener() {
  if (typeof SupabaseDB !== 'undefined' && SupabaseDB.isConfigured()) {
    const inited = SupabaseDB.init();
    if (inited) {
      SupabaseDB.subscribeAll(handleRealtimeEvent);
      console.log('[Supabase] Realtime listener attached');
    }
  }
}

function handleRealtimeEvent(info) {
  if (!info || !info.table || !info.event) return;
  const { table, event, new: newData, old: oldData } = info;
  const isAdmin = document.getElementById('page-admin')?.classList.contains('active');
  const isEmp = document.getElementById('page-employee')?.classList.contains('active');

  // ── attendance_logs: sign-in/out live updates ──
  if (table === 'attendance_logs') {
    if (!appState) { RenderQueue.schedule(); return; }

    if (event === 'INSERT' && newData) {
      appState.attendanceLogs = [...(appState.attendanceLogs || []), newData];
      if (isAdmin) {
        const time = formatTime(newData.login_time);
        showNotifBar('info', (newData.emp_name || 'Employee') + ' signed in at ' + time);
        updateDashboardStats();
        renderDashboardCards();
        if (document.getElementById('tab-records')?.classList.contains('active')) renderRecords();
      }
      if (isEmp && newData.emp_id === sessionStorage.getItem('userId')) {
        updateDashboardStats();
        const emp = appState.employees?.find(e => e.id === newData.emp_id);
        if (emp) renderEmpDashboard(emp);
        const pill = document.getElementById('emp-pill');
        if (pill) { pill.className = 'status-pill sp-in'; pill.innerHTML = '<div class="status-dot sd-g"></div>Signed In'; }
      }
      RenderQueue.schedule();
    } else if (event === 'UPDATE' && newData) {
      const logs = appState?.attendanceLogs || [];
      const idx = logs.findIndex(l => l.id === newData.id);
      if (idx !== -1) { appState.attendanceLogs[idx] = { ...logs[idx], ...newData }; }
      if (isAdmin && newData.logout_time && (!oldData?.logout_time)) {
        const time = formatTime(newData.logout_time);
        showNotifBar('info', (newData.emp_name || 'Employee') + ' signed out at ' + time);
        updateDashboardStats();
        renderDashboardCards();
        if (document.getElementById('tab-records')?.classList.contains('active')) renderRecords();
      }
      if (isEmp && newData.emp_id === sessionStorage.getItem('userId') && newData.logout_time) {
        updateDashboardStats();
        const emp = appState.employees?.find(e => e.id === newData.emp_id);
        if (emp) renderEmpDashboard(emp);
        const pill = document.getElementById('emp-pill');
        if (pill) { pill.className = 'status-pill sp-out'; pill.innerHTML = '<div class="status-dot sd-r"></div>Signed Out'; }
      }
      RenderQueue.schedule();
    } else if (event === 'DELETE') {
      RenderQueue.schedule();
    }
    return;
  }

  // ── leave_requests: live toast + UI update ──
  if (table === 'leave_requests') {
    if (!appState) { RenderQueue.schedule(); return; }

    if (event === 'INSERT' && newData) {
      const lr = {
        id: newData.id, empId: newData.emp_id, empName: newData.emp_name,
        dept: newData.dept, type: newData.type, from: newData.from_date,
        to: newData.to_date, days: newData.days, reason: newData.reason,
        status: newData.status || 'Pending'
      };
      appState.leaveRequests = [...(appState.leaveRequests || []), lr];
      if (isAdmin) {
        showNotifBar('info', 'New leave request from ' + (lr.empName || 'Employee'));
        renderLeaveRequests();
        renderLeaveHistory();
        clearedNavBadges.delete('nav-badge-leaves'); clearedNavBadges.delete('nav-badge-dash'); _saveClearedBadges();
        updateNavBadges();
      }
      if (isEmp && lr.empId === sessionStorage.getItem('userId')) {
        showNotifBar('info', 'Your leave request has been submitted. Waiting for approval.');
      }
      RenderQueue.schedule();
    } else if (event === 'UPDATE' && newData) {
      const reqs = appState.leaveRequests || [];
      const idx = reqs.findIndex(l => String(l.id) === String(newData.id));
      const wasPending = idx !== -1 ? reqs[idx].status === 'Pending' : false;
      if (idx !== -1) {
        appState.leaveRequests[idx] = { ...reqs[idx], status: newData.status || reqs[idx].status };
      }
      if (isAdmin) {
        renderLeaveRequests();
        renderLeaveHistory();
        updateNavBadges();
      }
      if (isEmp && idx !== -1 && wasPending && reqs[idx].empId === sessionStorage.getItem('userId')) {
        showNotifBar('info', 'Your leave was ' + (newData.status || 'updated') + '.');
      }
      RenderQueue.schedule();
    } else if (event === 'DELETE') {
      RenderQueue.schedule();
    }
    return;
  }

  // ── notifications: update badge + panel ──
  if (table === 'notifications' && newData) {
    const normalized = {
      ...newData,
      isRead: newData.is_read === true || newData.unread === false
    };

    if (event === 'INSERT') {
      if (isAdmin && newData.target === 'admin') {
        appState.adminNotifications = [...(appState.adminNotifications || []), normalized];
        updateAdminNotifBadge();
        clearedNavBadges.delete('nav-badge-dash'); _saveClearedBadges();
        updateNavBadges();
        renderAdminNotifPanel();
      }
      if (isEmp && (newData.target === 'emp' || newData.user_id === sessionStorage.getItem('userId'))) {
        appState.empNotifications = [...(appState.empNotifications || []), normalized];
        updateEmpNotifBadge();
        updateNavBadges();
        renderEmpNotifPanel();
      }
      RenderQueue.schedule();
      return;
    }

    if (event === 'UPDATE') {
      // Sync read-state changes across devices in real time
      const adminIdx = (appState.adminNotifications || []).findIndex(n => n.id === newData.id);
      if (adminIdx !== -1) {
        appState.adminNotifications[adminIdx].isRead = normalized.isRead;
        appState.adminNotifications[adminIdx].unread = normalized.unread;
        updateAdminNotifBadge();
        updateNavBadges();
        if (document.getElementById('notif-panel')?.classList.contains('open')) {
          renderAdminNotifPanel();
        }
      }
      const empIdx = (appState.empNotifications || []).findIndex(n => n.id === newData.id);
      if (empIdx !== -1) {
        appState.empNotifications[empIdx].isRead = normalized.isRead;
        appState.empNotifications[empIdx].unread = normalized.unread;
        updateEmpNotifBadge();
        updateNavBadges();
        if (document.getElementById('emp-notif-panel')?.classList.contains('open')) {
          renderEmpNotifPanel();
        }
      }
      RenderQueue.schedule();
      return;
    }
  }

  // ── employees: update list + table ──
  if (table === 'employees' && appState) {
    if (event === 'INSERT' && newData) {
      const { password, ...safe } = newData;
      appState.employees = [...(appState.employees || []), safe];
    } else if (event === 'UPDATE' && newData) {
      const { password, ...safe } = newData;
      const idx = (appState.employees || []).findIndex(e => e.id === safe.id);
      if (idx !== -1) appState.employees[idx] = { ...appState.employees[idx], ...safe };
    } else if (event === 'DELETE' && oldData) {
      appState.employees = (appState.employees || []).filter(e => e.id !== oldData.id);
    }
    if (isAdmin) { renderEmpTable(); renderLeaveBalances(); updateNavBadges(); }
    RenderQueue.schedule();
    return;
  }

  // ── announcements: re-activate badge on new broadcast ──
  if (table === 'announcements' && event === 'INSERT' && appState) {
    clearedNavBadges.delete('nav-badge-ann'); _saveClearedBadges();
    updateNavBadges();
    RenderQueue.schedule();
    return;
  }

  // ── Fallback: full refresh for anything else ──
  RenderQueue.schedule();
}

// ── Password Recovery via Supabase Auth ──
async function setupPasswordRecovery() {
  if (typeof SupabaseDB === 'undefined' || !SupabaseDB.isReady()) return;
  const supabase = SupabaseDB.supabase;
  if (!supabase?.auth) return;

  // Check URL hash for recovery redirect
  if (window.location.hash && window.location.hash.includes('type=recovery')) {
    document.getElementById('recovery-modal').style.display = 'flex';
  }

  // Listen for recovery events (catches cases where hash was already processed)
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') {
      document.getElementById('recovery-modal').style.display = 'flex';
    }
  });
}

async function setNewPassword() {
  const newPwd = document.getElementById('rp-new-pwd').value.trim();
  const confirmPwd = document.getElementById('rp-confirm-pwd').value.trim();
  const statusEl = document.getElementById('rp-status');
  if (!newPwd || newPwd.length < 6) {
    statusEl.textContent = 'Password must be at least 6 characters.';
    statusEl.style.display = 'block'; return;
  }
  if (newPwd !== confirmPwd) {
    statusEl.textContent = 'Passwords do not match.';
    statusEl.style.display = 'block'; return;
  }
  statusEl.style.display = 'none';
  const btn = document.querySelector('#recovery-modal .btn-primary');
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    // Update Supabase Auth password
    const supabase = SupabaseDB.supabase;
    if (supabase?.auth) {
      const { error } = await supabase.auth.updateUser({ password: newPwd });
      if (error) { showNotifBar('error', 'Auth update failed: ' + error.message); btn.disabled = false; btn.textContent = 'Set New Password'; return; }
    }
    // Update admin table password
    await dbUpdateAdminPassword(newPwd);
    showNotifBar('success', 'Password changed successfully. Please log in with your new password.');
    document.getElementById('recovery-modal').style.display = 'none';
    document.getElementById('rp-new-pwd').value = '';
    document.getElementById('rp-confirm-pwd').value = '';
    document.getElementById('forgot-modal').style.display = 'none';
    window.location.hash = '';
  } catch (e) {
    showNotifBar('error', 'Error: ' + e.message);
  }
  btn.disabled = false; btn.textContent = 'Set New Password';
}

async function dbUpdateAdminPassword(newPwd) {
  await api('/api/auth/reset-password', { method: 'POST', body: { newPassword: newPwd } });
}

async function init() {
  if (localStorage.getItem('darkMode') === 'true') {
    document.body.classList.add('dark-mode');
    document.querySelectorAll('.dark-toggle-btn').forEach(b => b.textContent = 'L');
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
  setupPasswordRecovery();

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
  if (greetEl) greetEl.textContent = greet + ', Administrator';

  const today = new Date();
  const todayEl = document.getElementById('today-date');
  if (todayEl) todayEl.textContent = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const todayEl2 = document.getElementById('today-date2');
  if (todayEl2) todayEl2.textContent = today.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  renderBirthdayModule();

  // ── Keyboard shortcut: Ctrl+Z / Cmd+Z to undo archive ──
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && pendingUndoArchiveId && pendingUndoArchiveName) {
      // Don't intercept Ctrl+Z when user is typing in a form field
      const tag = (document.activeElement?.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      undoArchive(pendingUndoArchiveName);
    }
  });
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

// ══ Schema SQL (fallback embedded copy for Run SQL Setup) ══
const __SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS admin (
  username TEXT PRIMARY KEY,
  password TEXT NOT NULL,
  email TEXT
);

INSERT INTO admin (username, password, email)
VALUES ('quemahtech', 'quemah123', 'atharvashishn@gmail.com')
ON CONFLICT (username) DO NOTHING;

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  dept TEXT, email TEXT, phone TEXT, bday TEXT, joining TEXT,
  designation TEXT, password TEXT DEFAULT 'emp123',
  cl REAL DEFAULT 7.5, sl REAL DEFAULT 3.0, ul REAL DEFAULT 0,
  active BOOLEAN DEFAULT true, calendar_event_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attendance_logs (
  id BIGSERIAL PRIMARY KEY,
  emp_id TEXT NOT NULL, emp_name TEXT NOT NULL, department TEXT,
  login_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  logout_time TIMESTAMPTZ, working_hours REAL DEFAULT 0,
  status TEXT DEFAULT 'Active', computer_name TEXT DEFAULT '',
  login_date TEXT, event TEXT DEFAULT 'LOGIN',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Partial unique index: at most one active session per employee (DB-level duplicate prevention)
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_logs_active_unique
  ON attendance_logs (emp_id)
  WHERE logout_time IS NULL;

-- Non-unique index for fast active-session lookup (kept for broader queries)
CREATE INDEX IF NOT EXISTS idx_attendance_logs_active
  ON attendance_logs (emp_id, logout_time) WHERE logout_time IS NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_logs_date
  ON attendance_logs (login_date);

CREATE TABLE IF NOT EXISTS attendance (
  id TEXT, name TEXT, dept TEXT, date TEXT,
  "in" TEXT, "out" TEXT, hours REAL DEFAULT 0,
  status TEXT DEFAULT 'Present', notes TEXT DEFAULT '',
  PRIMARY KEY (id, date)
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id BIGSERIAL PRIMARY KEY, emp_id TEXT, emp_name TEXT, dept TEXT,
  type TEXT, from_date TEXT, to_date TEXT, days INTEGER,
  reason TEXT, status TEXT DEFAULT 'Pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS announcements (
  id BIGSERIAL PRIMARY KEY, date TEXT, subject TEXT, body TEXT,
  "by" TEXT DEFAULT 'Admin', priority TEXT DEFAULT 'normal',
  recipient TEXT DEFAULT 'All Employees',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS departments (name TEXT PRIMARY KEY);

INSERT INTO departments (name) VALUES
  ('Engineering'), ('HR'), ('IT'), ('Marketing'), ('Finance'), ('Operations')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY, text TEXT, time TEXT,
  unread BOOLEAN DEFAULT true, is_read BOOLEAN DEFAULT false,
  target TEXT DEFAULT 'admin',
  user_id TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS archived_employees (
  id TEXT PRIMARY KEY, original_id TEXT, name TEXT, dept TEXT,
  status TEXT, joining TEXT, exit TEXT, employee_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE attendance_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests DISABLE ROW LEVEL SECURITY;
ALTER TABLE notifications DISABLE ROW LEVEL SECURITY;
ALTER TABLE announcements DISABLE ROW LEVEL SECURITY;
ALTER TABLE departments DISABLE ROW LEVEL SECURITY;
ALTER TABLE archived_employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE admin DISABLE ROW LEVEL SECURITY;
ALTER TABLE attendance DISABLE ROW LEVEL SECURITY;
`;

// ══ Run SQL Setup — executes the schema SQL via Supabase RPC ══
async function runSqlSetup() {
  const btn = document.getElementById('run-sql-setup-btn');
  const logEl = document.getElementById('sql-setup-log');
  const statusEl = document.getElementById('sql-setup-status');
  if (!btn || !logEl) return;

  setButtonLoading(btn, true);
  logEl.innerHTML = '';

  function log(msg, type) {
    const color = type === 'error' ? '#ef4444' : type === 'success' ? '#16a34a' : 'var(--muted)';
    logEl.innerHTML += '<div style="padding:3px 0;font-size:12px;line-height:1.5;color:' + color + '">' + msg + '</div>';
    logEl.scrollTop = logEl.scrollHeight;
  }

  if (statusEl) statusEl.textContent = 'Connecting...';

  if (typeof SupabaseDB === 'undefined' || !SupabaseDB.supabase) {
    log('Supabase client not initialized. Check your configuration.', 'error');
    if (statusEl) statusEl.textContent = 'Failed — not connected';
    setButtonLoading(btn, false);
    return;
  }

  const sb = SupabaseDB.supabase;

  log('Checking for exec_sql RPC function...', 'info');
  let execSqlExists = false;
  try {
    const { error } = await sb.rpc('exec_sql', { query: 'SELECT 1' });
    if (!error) {
      execSqlExists = true;
      log('exec_sql function found!', 'success');
    } else if (error.message && error.message.includes('function') && (error.message.includes('not found') || error.message.includes('does not exist'))) {
      execSqlExists = false;
      log('exec_sql function not found.', 'info');
    } else {
      execSqlExists = true;
      log('exec_sql RPC responded (continuing)...', 'info');
    }
  } catch (e) {
    execSqlExists = false;
    log('exec_sql not available: ' + e.message.substring(0, 80), 'info');
  }

  if (!execSqlExists) {
    log('', 'info');
    log('First, create the exec_sql Postgres function. Copy and run this in Supabase SQL Editor:', 'info');
    const createFn = `CREATE OR REPLACE FUNCTION exec_sql(query text)
RETURNS void AS $$
BEGIN
  EXECUTE query;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;`;
    logEl.innerHTML += '<div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:12px;margin:6px 0;font-family:var(--font-mono);font-size:11px;white-space:pre-wrap;color:var(--text);line-height:1.7;">' + createFn + '</div>';
    log('Then click "Run SQL Setup" again.', 'info');
    logEl.innerHTML += '<div style="margin-top:6px;"><button class="btn btn-sm" onclick="window.open(\'https://supabase.com/dashboard/project/jrdfxkyhoutwzdbieefq/sql/new\',\'_blank\')">Open SQL Editor</button>' +
      ' <button class="btn btn-sm" onclick="runSqlSetup()">Retry</button></div>';
    if (statusEl) statusEl.textContent = 'Requires exec_sql';
    setButtonLoading(btn, false);
    return;
  }

  if (statusEl) statusEl.textContent = 'Loading schema...';
  log('Loading schema SQL...', 'info');

  let sqlText = '';
  try {
    const res = await fetch('supabase-schema.sql');
    if (res.ok) {
      sqlText = await res.text();
      log('Loaded from supabase-schema.sql (' + (sqlText.length / 1024).toFixed(1) + ' KB)', 'success');
    } else {
      throw new Error('HTTP ' + res.status);
    }
  } catch (e) {
    log('Using embedded fallback schema (' + e.message.substring(0, 60) + ')', 'info');
    sqlText = __SCHEMA_SQL;
  }

  const statements = sqlText
    .split(';')
    .map(s => s.trim())
    .filter(s => s && s.length > 6 && !s.startsWith('--'));

  log('Found ' + statements.length + ' executable statements', 'info');
  if (statusEl) statusEl.textContent = 'Running ' + statements.length + ' statements...';

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.substring(0, 65).replace(/\n/g, ' ').trim();
    log((i + 1) + '/' + statements.length + ' ' + preview + '...', 'info');

    try {
      const { error } = await sb.rpc('exec_sql', { query: stmt + ';' });
      if (error) {
        const msg = error.message || '';
        if (msg.includes('already exists') || msg.includes('duplicate key') || msg.includes('unique constraint')) {
          log('   Already exists (skipped)', 'info');
          successCount++;
        } else {
          log('   ' + msg.substring(0, 120), 'error');
          failCount++;
        }
      } else {
        log('   Done', 'success');
        successCount++;
      }
    } catch (e) {
      log('   ' + e.message.substring(0, 100), 'error');
      failCount++;
    }

    if (statusEl) statusEl.textContent = 'Progress: ' + (i + 1) + '/' + statements.length;
  }

  log('', 'info');
  log('═══════════════════════════════', 'info');
  const summaryMsg = 'Complete: ' + successCount + ' OK, ' + failCount + ' errors';
  log(summaryMsg, failCount > 0 ? 'error' : 'success');

  if (failCount === 0) {
    log('All statements executed successfully!', 'success');
    if (statusEl) statusEl.textContent = 'Complete — ' + successCount + ' OK';
    log('Refreshing application state...', 'info');
    await refreshStateAndRender();
    log('State refreshed!', 'success');
  } else {
    if (statusEl) statusEl.textContent = successCount + ' OK, ' + failCount + ' errors';
  }

  setButtonLoading(btn, false, 'Run SQL Setup');
}


// ═══════════════════════════════════
// SESSION RESTORATION — Auto-initialize on page load
// ═══════════════════════════════════

async function initApp(retryCount) {
  retryCount = retryCount || 0;
  console.log('[EMS] Initializing application... (attempt ' + (retryCount + 1) + ')');

  // Retry SupabaseClient init with backoff
  if (typeof SupabaseClient === 'undefined' || !SupabaseClient.ready) {
    if (typeof SupabaseClient !== 'undefined') {
      const inited = SupabaseClient.init();
      if (inited) {
        console.log('[EMS] SupabaseClient initialized successfully');
      } else if (retryCount < 5) {
        console.warn('[EMS] SupabaseClient init failed, retrying in 500ms...');
        setTimeout(() => initApp(retryCount + 1), 500);
        return;
      } else {
        console.error('[EMS] SupabaseClient init failed after 5 retries');
      }
    } else if (retryCount < 10) {
      console.warn('[EMS] SupabaseClient not loaded yet, retrying in 300ms...');
      setTimeout(() => initApp(retryCount + 1), 300);
      return;
    }
  }

  // Start periodic polling for cross-device sync (once)
  if (!window._emsSyncPollStarted) {
    window._emsSyncPollStarted = true;
    console.log('[EMS] Starting cross-device sync polling (every 30s)');
    setInterval(async () => {
      if (document.getElementById('page-login')?.classList.contains('active')) return; // Don't poll on login
      await refreshStateAndRender();
    }, 30000);
  }

  const userId = sessionStorage.getItem('userId');
  const userRole = sessionStorage.getItem('userRole');

  if (userId && userRole) {
    console.log('[EMS] Session found:', userId, 'role:', userRole);
    showLoading('Restoring session...', 'Loading your data');
    try {
      // Retry loadStateFromServer once if it fails
      let loaded = await loadStateFromServer();
      if (!loaded) {
        console.warn('[EMS] First state load failed, retrying...');
        await new Promise(r => setTimeout(r, 1000));
        loaded = await loadStateFromServer();
      }
      if (loaded && appState) {
        if (userRole === 'admin') {
          console.log('[EMS] Restoring admin session');
          currentUser = { name: 'Administrator' };
          currentRole = 'admin';
          showAdminPage();
          hideLoading();
          return;
        } else if (userRole === 'employee') {
          console.log('[EMS] Restoring employee session:', userId);
          currentRole = 'employee';
          const emp = findEmployeeByIdOrEmail(userId);
          if (emp) {
            currentUser = emp;
            showEmployeePage(emp);
            console.log('[EMS] Employee session restored:', emp.name);
            hideLoading();
            return;
          } else {
            console.warn('[EMS] Employee not found:', userId);
          }
        }
      }
    } catch (e) {
      console.error('[EMS] Session restoration error:', e.message);
    }
    // Session restoration failed - clear session but preserve rememberedUser in localStorage
    currentUser = null;
    currentRole = '';
    sessionStorage.removeItem('userId');
    sessionStorage.removeItem('userRole');
    hideLoading();
  } else {
    console.log('[EMS] No session, showing login page');
    const rememberedUser = localStorage.getItem('rememberedUser');
    if (rememberedUser) {
      document.getElementById('uid').value = rememberedUser;
      document.getElementById('remember-me').checked = true;
    }
  }
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(() => initApp(), 100);
} else {
  document.addEventListener('DOMContentLoaded', () => setTimeout(() => initApp(), 100));
}
