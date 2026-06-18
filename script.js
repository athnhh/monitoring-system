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
    showNotifBar('success', empName + ' archived successfully! Press Ctrl+Z to undo within 5 seconds.');
  }
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

function _countWorkingDaysInMonth(fromDate, toDate) {
  var count = 0;
  for (var d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== 0 && d.getDay() !== 6) count++;
  }
  return count;
}

function _buildMonthlySummaryData() {
  var employees = appState.employees || [];
  var logs = appState.attendanceLogs || [];
  var leaveReqs = appState.leaveRequests || [];
  var now = new Date();
  var monthStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  var monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  var monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  var today = now.getDate();
  var monthEndStr = monthEnd.toISOString().split('T')[0];
  var monthStartStr = monthStr + '-01';

  // Attendance per employee
  var empAttendance = {};
  var monthLogs = logs.filter(function(l) { return (l.login_date || getDateFromISO(l.login_time)).startsWith(monthStr); });
  monthLogs.forEach(function(l) {
    if (!empAttendance[l.emp_id]) {
      empAttendance[l.emp_id] = { presentDays: new Set(), lateDays: new Set(), halfDays: new Set(), totalHours: 0, sessionCount: 0 };
    }
    var dateKey = l.login_date || getDateFromISO(l.login_time);
    if (l.status === 'Present' || l.status === 'Late' || l.status === 'Half-Day' || l.status === 'Active') {
      empAttendance[l.emp_id].presentDays.add(dateKey);
      if (l.status === 'Late') empAttendance[l.emp_id].lateDays.add(dateKey);
      if (l.status === 'Half-Day') empAttendance[l.emp_id].halfDays.add(dateKey);
    }
    empAttendance[l.emp_id].totalHours += l.working_hours || 0;
    empAttendance[l.emp_id].sessionCount++;
  });

  // Leave usage per employee this month
  var leaveUsage = {};
  leaveReqs.filter(function(lr) {
    return lr.status === 'Approved' && lr.from && lr.to &&
      lr.from <= monthEndStr && lr.to >= monthStartStr;
  }).forEach(function(lr) {
    if (!leaveUsage[lr.empId]) leaveUsage[lr.empId] = { CL: 0, SL: 0, UL: 0 };
    if (leaveUsage[lr.empId][lr.type] !== undefined) {
      leaveUsage[lr.empId][lr.type] += lr.days || 0;
    }
  });

  // Build per-employee summary with joining-date-aware working days
  var summaryRows = [];
  var activeEmps = employees.filter(function(e) { return e.active; });
  activeEmps.forEach(function(emp) {
    var att = empAttendance[emp.id] || { presentDays: new Set(), lateDays: new Set(), halfDays: new Set(), totalHours: 0, sessionCount: 0 };
    var leaves = leaveUsage[emp.id] || { CL: 0, SL: 0, UL: 0 };

    // Calculate effective working days from max(joining_date, month_start) to today
    var _effStart = new Date(monthStart);
    if (emp.joining) {
      var _joinDate = new Date(emp.joining + 'T00:00:00');
      if (_joinDate > _effStart) _effStart = _joinDate;
    }
    var _todayDate = new Date(now.getFullYear(), now.getMonth(), Math.min(today, monthEnd.getDate()));
    var _workingDays = _countWorkingDaysInMonth(_effStart, _todayDate);

    var presentCount = att.presentDays.size;
    var lateCount = att.lateDays.size;
    var halfCount = att.halfDays.size;
    var leaveDays = leaves.CL + leaves.SL + leaves.UL;
    var absentCount = Math.max(0, _workingDays - presentCount - leaveDays);
    var rate = _workingDays > 0 ? Math.round(presentCount / _workingDays * 100) : 0;

    summaryRows.push({
      emp_id: emp.id,
      emp_name: emp.name,
      department: emp.dept,
      joining: emp.joining || '' ,
      workingDays: _workingDays,
      presentCount: presentCount,
      lateCount: lateCount,
      halfCount: halfCount,
      absentCount: absentCount,
      leaveDays: leaveDays,
      totalHours: parseFloat(att.totalHours.toFixed(2)),
      avgHours: att.presentDays.size > 0 ? parseFloat((att.totalHours / att.presentDays.size).toFixed(2)) : 0,
      clUsed: leaves.CL,
      slUsed: leaves.SL,
      ulUsed: leaves.UL,
      clBalance: emp.cl || 0,
      slBalance: emp.sl || 0,
      ulTotal: emp.ul || 0,
      rate: rate
    });
  });

  return {
    monthStr: monthStr,
    monthName: now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    monthLogs: monthLogs,
    leaveReqs: leaveReqs,
    monthEnd: monthEnd,
    summaryRows: summaryRows
  };
}

function exportMonthlySummaryCSV() {
  if (!appState) { showNotifBar('warning', 'App data not loaded.'); return; }
  var data = _buildMonthlySummaryData();
  if (!data || !data.summaryRows.length) { showNotifBar('warning', 'No employees found.'); return; }

  var rows = [['ID','Employee','Dept','Joining Date','Working Days','Days Present','Days Late','Half-Day','Days Absent','Days on Leave','Total Hours','Avg Hours/Day','CL Used','SL Used','UL Used','CL Balance','SL Balance','UL Used (Total)','Attendance Rate %']];
  data.summaryRows.forEach(function(r) {
    rows.push([
      r.emp_id, r.emp_name, r.department, r.joining || '—',
      r.workingDays, r.presentCount, r.lateCount, r.halfCount,
      r.absentCount, r.leaveDays,
      r.totalHours, r.avgHours,
      r.clUsed, r.slUsed, r.ulUsed,
      r.clBalance, r.slBalance, r.ulTotal,
      r.rate
    ]);
  });

  var csv = rows.map(function(row) {
    return row.map(function(cell) { return '"' + String(cell).replace(/"/g, '""') + '"'; }).join(',');
  }).join('\n');
  downloadFile(csv, 'monthly_summary_' + data.monthStr + '.csv', 'text/csv');
  showNotifBar('success', 'Monthly summary CSV exported!');
}

function exportMonthlySummaryExcel() {
  if (typeof XLSX === 'undefined') { showNotifBar('warning', 'XLSX library not loaded.'); return; }
  if (!appState) { showNotifBar('warning', 'App data not loaded.'); return; }
  var data = _buildMonthlySummaryData();
  if (!data) return;
  var wb = XLSX.utils.book_new();
  var filename = 'monthly_summary_' + data.monthStr;

  try {
    // Sheet 1: Employee Summary
    var summaryData = data.summaryRows.map(function(r) {
      return {
        ID: r.emp_id,
        Employee: r.emp_name,
        Department: r.department,
        'Joining Date': r.joining || '—',
        'Working Days': r.workingDays,
        'Days Present': r.presentCount,
        'Days Late': r.lateCount,
        'Half-Day': r.halfCount,
        'Days Absent': r.absentCount,
        'Days on Leave': r.leaveDays,
        'Total Hours': r.totalHours,
        'Avg Hours/Day': r.avgHours,
        'CL Used': r.clUsed,
        'SL Used': r.slUsed,
        'UL Used': r.ulUsed,
        'CL Balance': r.clBalance,
        'SL Balance': r.slBalance,
        'UL Used (Total)': r.ulTotal,
        'Attendance Rate %': r.rate
      };
    });
    var wsSummary = XLSX.utils.json_to_sheet(summaryData);
    wsSummary['!cols'] = [
      { wch: 10 }, { wch: 22 }, { wch: 16 }, { wch: 14 },
      { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 10 },
      { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 14 },
      { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 16 }
    ];
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Employee Summary');

    // Sheet 2: Leave Details
    var leaveDetails = [];
    data.leaveReqs.filter(function(lr) {
      return lr.from && lr.to && lr.from <= data.monthEnd.toISOString().split('T')[0] && lr.to >= data.monthStr + '-01';
    }).forEach(function(lr) {
      leaveDetails.push({
        Employee: lr.empName || '—',
        'Leave Type': lr.type || '—',
        'From': lr.from || '—',
        'To': lr.to || '—',
        'Days': lr.days || 0,
        'Status': lr.status || '—',
        'Reason': lr.reason || ''
      });
    });
    if (leaveDetails.length === 0) {
      leaveDetails.push({ 'Info': 'No leave requests in ' + data.monthName });
    }
    var wsLeaves = XLSX.utils.json_to_sheet(leaveDetails);
    wsLeaves['!cols'] = [{ wch: 22 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 10 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, wsLeaves, 'Leave Details');

    // Sheet 3: Daily Attendance Detail
    var dailyRows = [];
    data.monthLogs.forEach(function(l) {
      dailyRows.push({
        Date: l.login_date || getDateFromISO(l.login_time),
        Employee: l.emp_name,
        ID: l.emp_id,
        Department: l.department,
        Login: formatTime(l.login_time),
        Logout: l.logout_time ? formatTime(l.logout_time) : 'Active',
        Hours: l.working_hours > 0 ? parseFloat(l.working_hours.toFixed(2)) : 0,
        Status: l.status,
        Device: l.computer_name || ''
      });
    });
    if (dailyRows.length === 0) {
      dailyRows.push({ 'Info': 'No attendance records in ' + data.monthName });
    }
    var wsDaily = XLSX.utils.json_to_sheet(dailyRows);
    wsDaily['!cols'] = [{ wch: 14 }, { wch: 22 }, { wch: 10 }, { wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, wsDaily, 'Daily Detail');

    XLSX.writeFile(wb, filename + '.xlsx');
    showNotifBar('success', 'Monthly summary exported to Excel with 3 sheets!');
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



// ═══════════════════════════════════
// MISSING FUNCTIONS — Restored Login & Core Operations
// ═══════════════════════════════════

// ── Utility functions ──

function getDateFromISO(iso) {
  if (!iso) return '';
  return iso.substring(0, 10);
}

function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return dateStr;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
}

function setText(elId, text) {
  const el = document.getElementById(elId);
  if (el) el.textContent = text;
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType || 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function checkPwdStrength(inputId, barId) {
  const pwd = document.getElementById(inputId)?.value || '';
  const bar = document.getElementById(barId);
  if (!bar) return;
  const strength = Math.min(100, pwd.length * 10);
  bar.style.width = strength + '%';
  bar.style.background = strength < 40 ? '#ef4444' : strength < 70 ? '#f59e0b' : '#22c55e';
}

let _clockIntervals = {};
function startClock(elId) {
  if (_clockIntervals[elId]) return;
  function tick() {
    const el = document.getElementById(elId);
    if (!el) { clearInterval(_clockIntervals[elId]); delete _clockIntervals[elId]; return; }
    el.textContent = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  }
  tick();
  _clockIntervals[elId] = setInterval(tick, 1000);
  // Clear interval when page unloads
  window.addEventListener('beforeunload', () => { clearInterval(_clockIntervals[elId]); delete _clockIntervals[elId]; });
}

// ── Notification Bar ──

const NOTIF_TIMERS = {};
function showNotifBar(type, msg, duration) {
  const bar = document.getElementById('notif-bar');
  const icon = document.getElementById('notif-icon');
  const text = document.getElementById('notif-text');
  if (!bar || !text) return;
  bar.className = 'notif-bar';
  bar.style.display = 'flex';
  if (type === 'success') { bar.classList.add('notif-success'); if (icon) icon.textContent = '✓'; }
  else if (type === 'error') { bar.classList.add('notif-error'); if (icon) icon.textContent = '✗'; }
  else if (type === 'warning') { bar.classList.add('notif-warning'); if (icon) icon.textContent = '!'; }
  else { bar.classList.add('notif-info'); if (icon) icon.textContent = 'i'; }
  text.textContent = msg;
  // Clear any existing timeout for this bar
  if (NOTIF_TIMERS.bar) clearTimeout(NOTIF_TIMERS.bar);
  NOTIF_TIMERS.bar = setTimeout(() => { hideNotifBar(); }, duration || 4000);
}

function hideNotifBar() {
  const bar = document.getElementById('notif-bar');
  if (!bar) return;
  bar.style.display = 'none';
  if (NOTIF_TIMERS.bar) { clearTimeout(NOTIF_TIMERS.bar); NOTIF_TIMERS.bar = null; }
}

// ── Tab / Page Switching ──

function switchTab(pageId, role, tabName, btnEl, callback) {
  // Hide all tabs in the page
  const page = document.querySelector(pageId);
  if (!page) return;
  const prefix = role === 'admin' ? 'admin-' : role === 'employee' ? 'emp-' : '';
  const tabs = page.querySelectorAll('.atab, .etab');
  tabs.forEach(t => t.classList.remove('show'));
  // Show the target tab
  const target = document.getElementById(prefix + tabName);
  if (target) target.classList.add('show');
  // Update active button
  if (btnEl) {
    const siblings = btnEl.parentElement ? btnEl.parentElement.querySelectorAll('.nav-btn') : [];
    siblings.forEach(b => b.classList.remove('active'));
    btnEl.classList.add('active');
  } else {
    const navBtns = document.querySelectorAll(pageId + ' .nav-btn');
    navBtns.forEach(b => {
      b.classList.remove('active');
      if (b.textContent.trim().toLowerCase().includes(tabName.toLowerCase())) b.classList.add('active');
    });
  }
  // Callback
  if (callback) callback();
}

// ── API Gateway ──

async function api(path, options) {
  if (typeof SupabaseClient === 'undefined' || !SupabaseClient.ready) {
    console.error('[API] SupabaseClient not ready');
    return null;
  }
  const method = (options && options.method) || 'GET';
  const body = options && options.body;
  try {
    return await SupabaseClient.call(method, path, body);
  } catch (e) {
    console.error('[API] Error calling', path, e.message);
    return null;
  }
}

// ── Login Handler ──

async function doLogin() {
  const uid = document.getElementById('uid').value.trim();
  const pwd = document.getElementById('pwd').value.trim();
  const errEl = document.getElementById('err-msg');
  const errText = document.getElementById('err-msg-text');

  if (!uid || !pwd) {
    if (errText) errText.textContent = 'Please enter both username/ID and password.';
    if (errEl) errEl.style.display = 'flex';
    return;
  }

  if (errEl) errEl.style.display = 'none';

  const btn = document.querySelector('.login-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span style="display:inline-block;width:16px;height:16px;border:2px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:8px;vertical-align:middle;"></span> Signing in...';
  }

  try {
    const res = await api('/api/auth/login', { method: 'POST', body: { uid, pwd } });

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> Sign In';
    }

    if (!res) {
      if (errText) errText.textContent = 'Connection error. Check your network or Supabase configuration.';
      if (errEl) errEl.style.display = 'flex';
      console.error('[Login] No response from server');
      return;
    }

    if (res.success) {
      sessionStorage.setItem('userId', res.user.id);
      sessionStorage.setItem('userRole', res.role);

      if (document.getElementById('remember-me') && document.getElementById('remember-me').checked) {
        localStorage.setItem('rememberedUser', uid);
      } else {
        localStorage.removeItem('rememberedUser');
      }

      showLoading('Welcome ' + (res.user.name || '') + '!', 'Loading your data...');

      // Initialize SupabaseClient if not already
      if (typeof SupabaseClient !== 'undefined' && !SupabaseClient.ready) {
        SupabaseClient.init();
      }

      // Start realtime listener
      startSupabaseListener();

      const loaded = await loadStateFromServer();

      if (loaded && appState) {
        if (res.role === 'admin') {
          currentUser = { name: 'Administrator' };
          currentRole = 'admin';
          showAdminPage();
        } else if (res.role === 'employee') {
          currentRole = 'employee';
          const emp = (appState.employees || []).find(e => e.id === res.user.id);
          if (emp) {
            currentUser = emp;
            showEmployeePage(emp);
          } else {
            if (errText) errText.textContent = 'Employee record not found in system data.';
            if (errEl) errEl.style.display = 'flex';
          }
        }
      } else {
        if (errText) errText.textContent = 'Failed to load application data. Please try again.';
        if (errEl) errEl.style.display = 'flex';
      }
      hideLoading();
    } else {
      if (errText) errText.textContent = res.message || 'Invalid credentials. Please try again.';
      if (errEl) errEl.style.display = 'flex';
    }
  } catch (e) {
    console.error('[Login] Error:', e);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> Sign In';
    }
    if (errText) errText.textContent = 'An unexpected error occurred. Check console for details.';
    if (errEl) errEl.style.display = 'flex';
  }
}

// ── Logout ──

function logout() {
  currentUser = null;
  currentRole = '';
  appState = null;
  sessionStorage.removeItem('userId');
  sessionStorage.removeItem('userRole');
  sessionStorage.removeItem('adminLastTab');
  sessionStorage.removeItem('empLastTab');
  // Switch to login page
  document.getElementById('page-login').classList.add('active');
  document.getElementById('page-admin').classList.remove('active');
  document.getElementById('page-employee').classList.remove('active');
  document.getElementById('uid').value = '';
  document.getElementById('pwd').value = '';
  const remembered = localStorage.getItem('rememberedUser');
  if (remembered) {
    document.getElementById('uid').value = remembered;
    document.getElementById('remember-me').checked = true;
  }
  // Clear clock intervals
  Object.keys(_clockIntervals).forEach(key => {
    clearInterval(_clockIntervals[key]);
    delete _clockIntervals[key];
  });
}

// ── State Management ──

async function loadStateFromServer() {
  try {
    const state = await api('/api/state');
    if (state) {
      appState = state;
      console.log('[State] Loaded app state from server');
      return true;
    }
    console.warn('[State] No state returned from server');
    return false;
  } catch (e) {
    console.error('[State] Failed to load state:', e.message);
    return false;
  }
}

async function refreshStateAndRender() {
  if (document.getElementById('page-login')?.classList.contains('active')) return;
  try {
    await loadStateFromServer();
    if (!appState) return;
    if (currentRole === 'admin' && document.getElementById('page-admin')?.classList.contains('active')) {
      updateDashboardStats();
      renderEmpTable();
      renderLeaveRequests();
      renderLeaveHistory();
      renderLeaveBalances();
      updateNavBadges();
      // Re-render active tab content
      const activeTab = document.querySelector('#page-admin .atab.show');
      if (activeTab) {
        if (activeTab.id === 'admin-dashboard') renderDashboardCards();
        if (activeTab.id === 'admin-records') renderRecords();
        if (activeTab.id === 'admin-reports') setReport(document.querySelector('.rtab.active')?.dataset?.reportType || 'daily', document.querySelector('.rtab.active'));
      }
    } else if (currentRole === 'employee' && document.getElementById('page-employee')?.classList.contains('active')) {
      const emp = appState?.employees?.find(e => e.id === sessionStorage.getItem('userId'));
      if (emp) {
        renderEmpDashboard(emp);
        renderEmpHistory();
      }
    }
  } catch (e) {
    console.warn('[Refresh] Error refreshing state:', e.message);
  }
}

// ── Show Pages ──

function showAdminPage() {
  document.getElementById('page-login').classList.remove('active');
  document.getElementById('page-admin').classList.add('active');
  document.getElementById('page-employee').classList.remove('active');

  const h = new Date().getHours();
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const greetEl = document.getElementById('admin-greeting');
  if (greetEl) greetEl.textContent = greet + ', Administrator';

  const today = new Date();
  const todayEl = document.getElementById('today-date');
  if (todayEl) todayEl.textContent = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const todayEl2 = document.getElementById('today-date2');
  if (todayEl2) todayEl2.textContent = today.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  populateDeptFilters();
  renderDashboardCards();
  renderEmpTable();
  renderLeaveRequests();
  renderLeaveHistory();
  renderLeaveBalances();
  updateNavBadges();
  renderBirthdayModule();
  renderAdminNotifPanel();

  // Restore last active tab
  const lastTab = sessionStorage.getItem('adminLastTab') || 'dashboard';
  const navBtns = document.querySelectorAll('#page-admin .nav-btn');
  let tabFound = false;
  navBtns.forEach(btn => {
    const match = btn.getAttribute('onclick');
    if (match && match.includes("'" + lastTab + "'")) {
      adminTab(lastTab, btn);
      tabFound = true;
    }
  });
  if (!tabFound) {
    // Default to dashboard
    const dashBtn = document.querySelector('#page-admin .nav-btn');
    if (dashBtn) adminTab('dashboard', dashBtn);
  }

  startClock('admin-clock');
  updateDashboardStats();
}

function showEmployeePage(emp) {
  document.getElementById('page-login').classList.remove('active');
  document.getElementById('page-admin').classList.remove('active');
  document.getElementById('page-employee').classList.add('active');

  // Set employee info
  const avEl = document.getElementById('emp-av');
  if (avEl) avEl.textContent = (emp.name || '?').charAt(0).toUpperCase();
  const nameEl = document.getElementById('emp-fullname');
  if (nameEl) nameEl.textContent = emp.name || '—';
  const detailsEl = document.getElementById('emp-details');
  if (detailsEl) detailsEl.textContent = (emp.id || '') + '  •  ' + (emp.dept || '') + (emp.designation ? '  •  ' + emp.designation : '');
  const topbarEl = document.getElementById('emp-topbar-name');
  if (topbarEl) topbarEl.textContent = (emp.name || 'Employee') + "'s Attendance";
  const badgeEl = document.getElementById('emp-badge');
  if (badgeEl) badgeEl.textContent = emp.id || 'Employee';

  // Set leave balances
  setText('emp-cl-bal', (emp.cl || 0).toString());
  setText('emp-sl-bal', (emp.sl || 0).toString());
  setText('emp-ul-used', (emp.ul || 0).toString());
  setText('emp-cl-bal2', (emp.cl || 0).toString());
  setText('emp-sl-bal2', (emp.sl || 0).toString());
  setText('emp-ul-used2', (emp.ul || 0).toString());

  // Render dashboard
  renderEmpDashboard(emp);
  renderEmpHistory();

  // Announcements
  renderEmpAnnouncements();

  // Default to dashboard tab
  const dashBtn = document.querySelector('#page-employee .nav-btn');
  if (dashBtn) empTab('dashboard', dashBtn);

  startClock('emp-clock');
}

// ── Employee Tab ──

function empTab(tabName, btnElement) {
  sessionStorage.setItem('empLastTab', tabName);
  // Clear nav badge for leaves
  if (tabName === 'leaves') {
    clearedNavBadges.add('nav-badge-emp-leaves');
    _saveClearedBadges();
    const badge = document.getElementById('nav-badge-emp-leaves');
    if (badge) { badge.classList.add('hidden'); badge.textContent = ''; }
  }
  switchTab('#page-employee', 'employee', tabName, btnElement, async () => {
    if (tabName === 'history') renderEmpHistory();
    if (tabName === 'dashboard') {
      const emp = appState?.employees?.find(e => e.id === sessionStorage.getItem('userId'));
      if (emp) renderEmpDashboard(emp);
    }
  });
}

// ── Employee Dashboard ──

function renderEmpDashboard(emp) {
  if (!appState || !emp) return;
  const logs = appState.attendanceLogs || [];
  const now = new Date();
  const today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  const monthStr = today.substring(0, 7);

  // Check if signed in
  const empLogs = logs.filter(l => l.emp_id === emp.id);
  const todayLogs = empLogs.filter(l => (l.login_date || getDateFromISO(l.login_time)) === today);
  const activeSession = todayLogs.find(l => !l.logout_time);

  const pill = document.getElementById('emp-pill');
  if (pill) {
    if (activeSession) {
      pill.className = 'status-pill sp-in';
      pill.innerHTML = '<div class="status-dot sd-g"></div>Signed In';
    } else if (todayLogs.length > 0) {
      pill.className = 'status-pill sp-out';
      pill.innerHTML = '<div class="status-dot sd-r"></div>Signed Out';
    } else {
      pill.className = 'status-pill sp-out';
      pill.innerHTML = '<div class="status-dot sd-r"></div>Not signed in';
    }
  }

  // Monthly stats
  const monthLogs = empLogs.filter(l => (l.login_date || getDateFromISO(l.login_time)).startsWith(monthStr));
  const presentDays = new Set();
  let totalHours = 0;
  let lateCount = 0;
  monthLogs.forEach(l => {
    if (['Present', 'Late', 'Half-Day', 'Active'].includes(l.status)) {
      const dateKey = l.login_date || getDateFromISO(l.login_time);
      presentDays.add(dateKey);
      if (l.status === 'Late') lateCount++;
    }
    totalHours += l.working_hours || 0;
  });

  // Calculate expected working days
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const effectiveStart = new Date(Math.max(monthStart.getTime(), emp.joining ? new Date(emp.joining + 'T00:00:00').getTime() : 0));
  let workingDays = 0;
  for (let d = new Date(effectiveStart); d <= now; d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== 0 && d.getDay() !== 6) workingDays++;
  }
  const absentCount = Math.max(0, workingDays - presentDays.size);

  setText('ms-present', presentDays.size.toString());
  setText('ms-absent', absentCount.toString());
  setText('ms-hours', totalHours.toFixed(1) + 'h');
  setText('ms-late', lateCount.toString());

  // Big clock
  const bigClock = document.getElementById('emp-bigclock');
  if (bigClock) bigClock.textContent = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  const dateStrEl = document.getElementById('emp-datestr');
  if (dateStrEl) dateStrEl.textContent = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  // Weekly hours bar chart
  renderEmpWeeklyHours(emp);

  // Today's timeline
  renderTodayTimeline(todayLogs);

  // Recent attendance table
  renderEmpRecentLogs(empLogs);
}

function renderEmpWeeklyHours(emp) {
  const barsEl = document.getElementById('emp-bars');
  if (!barsEl || !appState) return;
  const logs = appState.attendanceLogs || [];
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));

  const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  let html = '';
  let totalWeekHours = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    if (d > now) {
      html += '<div class="bar-row" style="opacity:0.4;"><span class="bar-label">' + weekDays[i] + '</span><div class="bar-track"><div class="bar-fill" style="width:0%"></div></div><span class="bar-val">—</span></div>';
      continue;
    }
    const dayLogs = logs.filter(l => l.emp_id === emp.id && (l.login_date || getDateFromISO(l.login_time)) === dateStr);
    let dayHours = 0;
    dayLogs.forEach(l => { dayHours += l.working_hours || 0; });
    totalWeekHours += dayHours;
    const pct = Math.min(100, (dayHours / 9) * 100);
    const color = pct >= 80 ? 'bf-green' : pct >= 50 ? 'bf-amber' : 'bf-red';
    html += '<div class="bar-row"><span class="bar-label">' + weekDays[i] + '</span><div class="bar-track"><div class="bar-fill ' + color + '" style="width:' + pct + '%"></div></div><span class="bar-val">' + dayHours.toFixed(1) + 'h</span></div>';
  }
  html += '<div class="bar-row" style="border-top:1px solid var(--border);padding-top:8px;margin-top:4px;"><span class="bar-label" style="font-weight:600;">Total</span><div class="bar-track"></div><span class="bar-val" style="font-weight:600;">' + totalWeekHours.toFixed(1) + 'h</span></div>';
  barsEl.innerHTML = html;
}

function renderTodayTimeline(todayLogs) {
  const timeline = document.getElementById('today-timeline');
  if (!timeline) return;
  if (!todayLogs || todayLogs.length === 0) {
    timeline.innerHTML = '<li class="timeline-item" style="color:var(--subtle);font-size:13px;">No events yet today.</li>';
    return;
  }
  let html = '';
  todayLogs.forEach(l => {
    const time = l.logout_time ? formatTime(l.logout_time) : formatTime(l.login_time);
    const label = !l.logout_time ? 'Signed in' : 'Signed out';
    const dotColor = !l.logout_time ? '#22c55e' : '#ef4444';
    html += '<li class="timeline-item" style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);">' +
      '<span style="width:10px;height:10px;border-radius:50%;background:' + dotColor + ';flex-shrink:0;"></span>' +
      '<span style="font-family:var(--font-mono);font-size:13px;font-weight:600;color:var(--text);min-width:50px;">' + time + '</span>' +
      '<span style="font-size:13px;color:var(--muted);">' + label + '</span></li>';
  });
  timeline.innerHTML = html;
}

function renderEmpRecentLogs(empLogs) {
  const tbody = document.getElementById('emp-log');
  if (!tbody) return;
  const recent = empLogs.slice(-10).reverse();
  if (recent.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--subtle);">No attendance records found.</td></tr>';
    return;
  }
  let html = '';
  recent.forEach(l => {
    const date = l.login_date || getDateFromISO(l.login_time);
    const d = new Date(date + 'T00:00:00');
    const dayName = DAYS[d.getDay()] || '';
    const statusClass = (l.status || 'Active').toLowerCase().replace(/[-\s]/g, '');
    html += '<tr>' +
      '<td>' + formatDate(date) + '</td>' +
      '<td>' + dayName + '</td>' +
      '<td><span style="font-family:var(--font-mono);color:#16a34a;font-weight:600;">' + formatTime(l.login_time) + '</span></td>' +
      '<td><span style="font-family:var(--font-mono);color:#dc2626;font-weight:600;">' + (l.logout_time ? formatTime(l.logout_time) : '<span style="color:#d97706;">Active</span>') + '</span></td>' +
      '<td>—</td>' +
      '<td>' + (l.working_hours > 0 ? l.working_hours.toFixed(1) + 'h' : '—') + '</td>' +
      '<td><span class="tag t-' + statusClass + '">' + (l.status || 'Active') + '</span></td></tr>';
  });
  tbody.innerHTML = html;
}

// ── Employee Sign In/Out ──

async function empPunchIn() {
  const empId = sessionStorage.getItem('userId');
  if (!empId || !appState) return;
  const emp = appState.employees?.find(e => e.id === empId);
  if (!emp) return;
  const btn = document.querySelector('.pbtn-in');
  if (btn) { btn.disabled = true; btn.textContent = 'Signing in...'; }
  const res = await api('/api/attendance/login', {
    method: 'POST',
    body: { empId: emp.id, empName: emp.name, department: emp.dept, computerName: 'Web Browser (' + navigator.platform + ')' }
  });
  if (btn) { btn.disabled = false; btn.textContent = 'Sign In'; }
  if (res && res.success) {
    showNotifBar('success', 'Signed in successfully!');
    await refreshStateAndRender();
    const emp2 = appState?.employees?.find(e => e.id === empId);
    if (emp2) renderEmpDashboard(emp2);
  } else {
    showNotifBar('error', res?.error || 'Sign in failed.');
  }
}

async function empPunchOut() {
  const empId = sessionStorage.getItem('userId');
  if (!empId) return;
  const btn = document.querySelector('.pbtn-out');
  if (btn) { btn.disabled = true; btn.textContent = 'Signing out...'; }
  const res = await api('/api/attendance/logout', {
    method: 'POST',
    body: { empId }
  });
  if (btn) { btn.disabled = false; btn.textContent = 'Sign Out'; }
  if (res && res.success) {
    showNotifBar('success', 'Signed out successfully!');
    await refreshStateAndRender();
    const emp2 = appState?.employees?.find(e => e.id === empId);
    if (emp2) renderEmpDashboard(emp2);
  } else {
    showNotifBar('error', res?.error || 'Sign out failed.');
  }
}

// ── Employee History ──

function renderEmpHistory() {
  if (!appState) return;
  const empId = sessionStorage.getItem('userId');
  if (!empId) return;
  const logs = appState.attendanceLogs || [];
  const empLogs = logs.filter(l => l.emp_id === empId);
  const monthFilter = document.getElementById('hist-month')?.value || new Date().toISOString().slice(0, 7);
  const filtered = empLogs.filter(l => (l.login_date || getDateFromISO(l.login_time)).startsWith(monthFilter));
  const tbody = document.getElementById('hist-table');
  if (!tbody) return;
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--subtle);">No records for this month.</td></tr>';
  } else {
    let html = '';
    filtered.slice().reverse().forEach(l => {
      const date = l.login_date || getDateFromISO(l.login_time);
      const d = new Date(date + 'T00:00:00');
      const dayName = DAYS[d.getDay()] || '';
      const statusClass = (l.status || 'Active').toLowerCase().replace(/[-\s]/g, '');
      html += '<tr>' +
        '<td>' + formatDate(date) + '</td>' +
        '<td>' + dayName + '</td>' +
        '<td><span style="font-family:var(--font-mono);color:#16a34a;font-weight:600;">' + formatTime(l.login_time) + '</span></td>' +
        '<td><span style="font-family:var(--font-mono);color:#dc2626;font-weight:600;">' + (l.logout_time ? formatTime(l.logout_time) : '<span style="color:#d97706;">Active</span>') + '</span></td>' +
        '<td>—</td>' +
        '<td>' + (l.working_hours > 0 ? l.working_hours.toFixed(1) + 'h' : '—') + '</td>' +
        '<td><span class="tag t-' + statusClass + '">' + (l.status || 'Active') + '</span></td></tr>';
    });
    tbody.innerHTML = html;
  }
  // Summary
  const summaryEl = document.getElementById('hist-summary');
  if (summaryEl) {
    let totalHours = 0;
    let presentDays = 0;
    filtered.forEach(l => {
      totalHours += l.working_hours || 0;
      if (['Present', 'Late', 'Half-Day', 'Active'].includes(l.status)) presentDays++;
    });
    summaryEl.textContent = presentDays + ' days present, ' + totalHours.toFixed(1) + ' total hours this month';
  }
}

function exportEmpCSV() {
  if (!appState) { showNotifBar('warning', 'No data loaded.'); return; }
  const empId = sessionStorage.getItem('userId');
  const logs = (appState.attendanceLogs || []).filter(l => l.emp_id === empId);
  const monthFilter = document.getElementById('hist-month')?.value || new Date().toISOString().slice(0, 7);
  const filtered = logs.filter(l => (l.login_date || getDateFromISO(l.login_time)).startsWith(monthFilter));
  if (!filtered.length) { showNotifBar('warning', 'No records for this month.'); return; }
  const rows = [['Date','Day','Login','Logout','Hours','Status']];
  filtered.slice().reverse().forEach(l => {
    const date = l.login_date || getDateFromISO(l.login_time);
    const d = new Date(date + 'T00:00:00');
    rows.push([date, DAYS[d.getDay()] || '', formatTime(l.login_time), l.logout_time ? formatTime(l.logout_time) : 'Active', (l.working_hours || 0).toFixed(1), l.status || 'Active']);
  });
  const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
  downloadFile(csv, 'attendance_' + empId + '_' + monthFilter + '.csv', 'text/csv');
  showNotifBar('success', 'CSV exported!');
}

// ── Employee Leave Functions ──

function selectLeaveType(btn, type) {
  currentLeaveType = type;
  document.querySelectorAll('.leave-type-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  calcLeaveDays();
}

function calcLeaveDays() {
  const from = document.getElementById('leave-from')?.value;
  const to = document.getElementById('leave-to')?.value;
  const note = document.getElementById('leave-calc-text');
  if (!note) return;
  if (!from || !to) {
    note.textContent = 'Select dates to calculate leave days and check balance.';
    return;
  }
  const f = new Date(from + 'T00:00:00');
  const t = new Date(to + 'T00:00:00');
  if (t < f) { note.textContent = 'End date must be after start date.'; return; }
  const days = Math.floor((t - f) / (1000 * 60 * 60 * 24)) + 1;
  const empId = sessionStorage.getItem('userId');
  const emp = appState?.employees?.find(e => e.id === empId);
  let balance = 0;
  if (currentLeaveType === 'CL') balance = emp?.cl || 0;
  else if (currentLeaveType === 'SL') balance = emp?.sl || 0;
  else balance = 999; // UL has no limit
  note.textContent = days + ' day(s) requested. ' + (currentLeaveType === 'UL' ? 'Unpaid leave — no limit.' : 'Your ' + currentLeaveType + ' balance: ' + balance + ' day(s).' + (days > balance ? ' <span style="color:var(--red);">Insufficient balance! Excess will be converted to UL.</span>' : ''));
}

async function submitLeaveRequest() {
  const empId = sessionStorage.getItem('userId');
  if (!empId || !appState) return;
  const emp = appState.employees?.find(e => e.id === empId);
  if (!emp) return;
  const from = document.getElementById('leave-from')?.value;
  const to = document.getElementById('leave-to')?.value;
  const reason = document.getElementById('leave-reason')?.value?.trim() || '';
  if (!from || !to) { showNotifBar('warning', 'Please select from and to dates.'); return; }
  if (!reason) { showNotifBar('warning', 'Please provide a reason for your leave.'); return; }
  const f = new Date(from + 'T00:00:00');
  const t = new Date(to + 'T00:00:00');
  const days = Math.floor((t - f) / (1000 * 60 * 60 * 24)) + 1;
  const btn = document.querySelector('#emp-leaves .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }
  const res = await api('/api/leave-requests', {
    method: 'POST',
    body: { empId: emp.id, empName: emp.name, dept: emp.dept, type: currentLeaveType, from, to, days, reason }
  });
  if (btn) { btn.disabled = false; btn.textContent = 'Submit Leave Request'; }
  if (res && res.success) {
    showNotifBar('success', 'Leave request submitted! Waiting for admin approval.');
    document.getElementById('leave-from').value = '';
    document.getElementById('leave-to').value = '';
    document.getElementById('leave-reason').value = '';
    await refreshStateAndRender();
    renderEmpLeaveHistory();
  } else {
    showNotifBar('error', 'Failed to submit leave request.');
  }
}

function renderEmpLeaveHistory() {
  const el = document.getElementById('my-leave-history');
  if (!el || !appState) return;
  const empId = sessionStorage.getItem('userId');
  const myLeaves = (appState.leaveRequests || []).filter(l => l.empId === empId).reverse();
  if (!myLeaves.length) {
    el.innerHTML = '<p style="color:var(--subtle);font-size:13px;">No leave requests yet.</p>';
    return;
  }
  let html = '';
  myLeaves.forEach(l => {
    const tagClass = (l.status || 'Pending').toLowerCase();
    html += '<div class="leave-req-card" style="padding:10px 0;border-bottom:1px solid var(--border);font-size:13px;display:flex;justify-content:space-between;align-items:center;">' +
      '<div><strong>' + (l.type || '—') + '</strong> &nbsp;' + (l.from || '') + ' → ' + (l.to || '') + ' (' + (l.days || 0) + 'd)</div>' +
      '<span class="tag t-' + tagClass + '">' + (l.status || 'Pending') + '</span></div>';
  });
  el.innerHTML = html;
}

// ── Employee Announcements ──

function renderEmpAnnouncements() {
  const el = document.getElementById('emp-announcements-list');
  if (!el || !appState) return;
  const anns = appState.announcements || [];
  const count = document.getElementById('emp-ann-count');
  if (count) count.textContent = anns.length;
  if (!anns.length) {
    el.innerHTML = '<p style="color:var(--subtle);font-size:13px;">No announcements yet.</p>';
    return;
  }
  let html = '';
  anns.slice(0, 5).forEach(a => {
    const priority = a.priority || 'normal';
    const color = priority === 'urgent' ? '#dc2626' : priority === 'high' ? '#d97706' : 'var(--muted)';
    html += '<div class="announcement-card" style="padding:12px 0;border-bottom:1px solid var(--border);">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
        '<strong style="font-size:14px;">' + (a.subject || '') + '</strong>' +
        '<span style="font-size:11px;color:' + color + ';font-weight:600;">' + priority.toUpperCase() + '</span>' +
      '</div>' +
      '<p style="font-size:13px;color:var(--muted);margin:4px 0;">' + (a.body || '') + '</p>' +
      '<span style="font-size:11px;color:var(--subtle);">' + (a.date || '') + '</span></div>';
  });
  el.innerHTML = html;
}

// ── Employee Password Change ──

async function changeEmpPwd() {
  const curPwd = document.getElementById('e-cur-pwd')?.value.trim();
  const newPwd = document.getElementById('e-new-pwd')?.value.trim();
  const confPwd = document.getElementById('e-conf-pwd')?.value.trim();
  if (!curPwd || !newPwd || !confPwd) { showNotifBar('warning', 'Please fill all fields.'); return; }
  if (newPwd.length < 6) { showNotifBar('warning', 'New password must be at least 6 characters.'); return; }
  if (newPwd !== confPwd) { showNotifBar('error', 'Passwords do not match.'); return; }
  const btn = document.querySelector('#emp-settings .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Updating...'; }
  const empId = sessionStorage.getItem('userId');
  const res = await api('/api/auth/password', {
    method: 'PUT',
    body: { userId: empId, currentPwd, newPassword: newPwd }
  });
  if (btn) { btn.disabled = false; btn.textContent = 'Update Password'; }
  if (res && res.success) {
    showNotifBar('success', 'Password changed successfully!');
    document.getElementById('e-cur-pwd').value = '';
    document.getElementById('e-new-pwd').value = '';
    document.getElementById('e-conf-pwd').value = '';
  } else {
    showNotifBar('error', res?.error || 'Failed to change password.');
  }
}

// ── Admin: Leave Management ──

function renderLeaveRequests() {
  const el = document.getElementById('leave-requests-list');
  if (!el || !appState) return;
  const pending = (appState.leaveRequests || []).filter(l => l.status === 'Pending');
  if (!pending.length) {
    el.innerHTML = '<p style="color:var(--subtle);font-size:13px;">No pending requests.</p>';
    return;
  }
  smartListSync(el, pending, l => leaveReqCard(l), l => l.id || l.empId + '-' + l.from);
}

function renderLeaveHistory() {
  const tbody = document.getElementById('leave-history-table');
  if (!tbody || !appState) return;
  const all = (appState.leaveRequests || []).slice().reverse();
  if (!all.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--subtle);">No leave requests.</td></tr>';
    return;
  }
  let html = '';
  all.forEach(l => {
    const tagClass = (l.status || 'Pending').toLowerCase();
    html += '<tr><td>' + (l.empName || '—') + '</td><td>' + (l.type || '—') + '</td><td>' + (l.from || '—') + '</td><td>' + (l.to || '—') + '</td><td>' + (l.days || 0) + '</td><td><span class="tag t-' + tagClass + '">' + (l.status || 'Pending') + '</span></td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + (l.reason || '—') + '</td></tr>';
  });
  tbody.innerHTML = html;
}

function renderLeaveBalances() {
  const tbody = document.getElementById('leave-balances-table');
  if (!tbody || !appState) return;
  const emps = (appState.employees || []).filter(e => e.active);
  if (!emps.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--subtle);">No employees found.</td></tr>';
    return;
  }
  let html = '';
  emps.forEach(e => {
    html += '<tr><td>' + e.name + '</td><td><span class="chip ' + (DEPT_COLORS[e.dept] || 'c-eng') + '">' + (e.dept || '—') + '</span></td><td>' + (e.cl || 0) + '</td><td>' + (e.sl || 0) + '</td><td>' + (e.ul || 0) + '</td><td><button class="btn btn-sm" onclick="openLeaveManageModal(\'' + e.id + '\')">Adjust</button></td></tr>';
  });
  tbody.innerHTML = html;
}

function leaveReqCard(l) {
  return '<div class="leave-req-card" style="display:flex;align-items:flex-start;gap:12px;padding:14px 16px;border:1px solid var(--border);border-radius:9px;margin-bottom:10px;">' +
    '<div style="flex:1;">' +
      '<div style="font-weight:600;font-size:14px;">' + (l.empName || 'Employee') + '</div>' +
      '<div style="font-size:12px;color:var(--subtle);margin:4px 0;">' + (l.type || '—') + ' Leave · ' + (l.from || '') + ' → ' + (l.to || '') + ' (' + (l.days || 0) + 'd)</div>' +
      '<div style="font-size:12px;color:var(--muted);">' + (l.reason || 'No reason provided') + '</div>' +
    '</div>' +
    '<div style="display:flex;gap:6px;flex-shrink:0;">' +
      '<button class="btn btn-sm" style="background:#22c55e;color:#fff;border-color:#22c55e;" onclick="approveLeave(' + (l.id || 0) + ')">Approve</button>' +
      '<button class="btn btn-sm btn-danger" onclick="rejectLeave(' + (l.id || 0) + ')">Reject</button>' +
    '</div></div>';
}

async function approveLeave(id) {
  const res = await api('/api/leave-requests/' + id, { method: 'PUT', body: { status: 'Approved' } });
  if (res && res.success !== false) {
    showNotifBar('success', 'Leave approved!' + (res.warning ? ' ' + res.warning : ''));
    await refreshStateAndRender();
  } else {
    showNotifBar('error', 'Failed to approve leave.');
  }
}

async function rejectLeave(id) {
  const res = await api('/api/leave-requests/' + id, { method: 'PUT', body: { status: 'Rejected' } });
  if (res && res.success !== false) {
    showNotifBar('success', 'Leave rejected.');
    await refreshStateAndRender();
  } else {
    showNotifBar('error', 'Failed to reject leave.');
  }
}

function openLeaveManageModal(empId) {
  const emp = appState?.employees?.find(e => e.id === empId);
  if (!emp) return;
  selectedLeaveManageIdx = empId;
  document.getElementById('lm-emp-name').textContent = emp.name;
  document.getElementById('lm-cl').value = emp.cl || 0;
  document.getElementById('lm-sl').value = emp.sl || 0;
  document.getElementById('lm-ul').value = emp.ul || 0;
  document.getElementById('leave-manage-modal').style.display = 'flex';
}

async function saveLeaveBalance() {
  const empId = selectedLeaveManageIdx;
  if (!empId) return;
  const cl = parseFloat(document.getElementById('lm-cl').value) || 0;
  const sl = parseFloat(document.getElementById('lm-sl').value) || 0;
  const ul = parseFloat(document.getElementById('lm-ul').value) || 0;
  const res = await api('/api/employees/' + encodeURIComponent(empId), {
    method: 'PUT',
    body: { cl, sl, ul }
  });
  if (res && res.success) {
    showNotifBar('success', 'Leave balance updated!');
    document.getElementById('leave-manage-modal').style.display = 'none';
    await refreshStateAndRender();
  } else {
    showNotifBar('error', 'Failed to update balance.');
  }
}

// ── Admin: Department Management ──

async function addDept() {
  const input = document.getElementById('new-dept-input');
  const name = input?.value?.trim();
  if (!name) { showNotifBar('warning', 'Enter a department name.'); return; }
  const res = await api('/api/departments', { method: 'POST', body: { name } });
  if (res && res.success) {
    showNotifBar('success', 'Department added!');
    input.value = '';
    await refreshStateAndRender();
    renderDepartments();
    renderDeptHeadcount();
  } else {
    showNotifBar('error', res?.error === 'Exists' ? 'Department already exists.' : 'Failed to add department.');
  }
}

async function removeDept(name) {
  if (!confirm('Remove department "' + name + '"?')) return;
  const res = await api('/api/departments/' + encodeURIComponent(name), { method: 'DELETE' });
  if (res && res.success) {
    showNotifBar('success', 'Department removed!');
    await refreshStateAndRender();
    renderDepartments();
    renderDeptHeadcount();
  } else {
    showNotifBar('error', 'Failed to remove department.');
  }
}

function renderDepartments() {
  const list = document.getElementById('dept-tag-list');
  if (!list || !appState) return;
  const depts = appState.departments || [];
  if (!depts.length) {
    list.innerHTML = '<p style="color:var(--subtle);font-size:13px;">No departments. Add one above.</p>';
    return;
  }
  let html = '';
  depts.forEach(d => {
    html += '<div class="dept-tag"><span>' + d + '</span><button class="dept-remove" onclick="removeDept(\'' + d.replace(/'/g, "\\'") + '\')">X</button></div>';
  });
  list.innerHTML = html;
  // Update all dept dropdowns
  populateDeptFilters();
}

function renderDeptHeadcount() {
  const barsEl = document.getElementById('dept-headcount-bars');
  if (!barsEl || !appState) return;
  const emps = (appState.employees || []).filter(e => e.active);
  const deptCount = {};
  emps.forEach(e => {
    if (!deptCount[e.dept]) deptCount[e.dept] = 0;
    deptCount[e.dept]++;
  });
  const depts = appState.departments || [];
  if (!depts.length) { barsEl.innerHTML = '<p style="color:var(--subtle);font-size:13px;">No departments.</p>'; return; }
  const maxCount = Math.max(1, ...Object.values(deptCount));
  let html = '';
  depts.forEach(d => {
    const count = deptCount[d] || 0;
    const pct = (count / maxCount) * 100;
    html += '<div class="bar-row"><span class="bar-label">' + d + '</span><div class="bar-track"><div class="bar-fill bf-blue" style="width:' + pct + '%"></div></div><span class="bar-val">' + count + '</span></div>';
  });
  barsEl.innerHTML = html;
}

// ── Admin: Announcements ──

function selectAnnPriority(btn, val) {
  annSelectedPriority = val;
  document.querySelectorAll('.ann-prior-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

function previewAnnouncement() {
  const subject = document.getElementById('ann-subject')?.value || '(No subject)';
  const body = document.getElementById('ann-body')?.value || '(No message)';
  const priority = annSelectedPriority || 'normal';
  showNotifBar('info', '[PREVIEW] ' + priority.toUpperCase() + ': ' + subject + ' — ' + body.substring(0, 100) + (body.length > 100 ? '...' : ''));
}

async function sendAnnouncement() {
  const subject = document.getElementById('ann-subject')?.value?.trim();
  const body = document.getElementById('ann-body')?.value?.trim();
  if (!subject || !body) { showNotifBar('warning', 'Please enter both subject and message.'); return; }
  const recipient = document.getElementById('ann-recipient-select')?.value || 'all';
  const btn = document.querySelector('.ann-send-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
  const today = new Date().toISOString().split('T')[0];
  const res = await api('/api/announcements', {
    method: 'POST',
    body: { date: today, subject, body, by: 'Admin', priority: annSelectedPriority, recipient: recipient === 'all' ? 'All Employees' : recipient }
  });
  if (btn) { btn.disabled = false; btn.textContent = 'Send Announcement'; }
  if (res && !res.error) {
    showNotifBar('success', 'Announcement sent!');
    document.getElementById('ann-subject').value = '';
    document.getElementById('ann-body').value = '';
    document.getElementById('ann-charcount').textContent = '0';
    await refreshStateAndRender();
    renderAnnouncements();
  } else {
    showNotifBar('error', 'Failed to send announcement.');
  }
}

function renderAnnouncements() {
  const el = document.getElementById('announcements-list');
  if (!el || !appState) return;
  const anns = appState.announcements || [];
  const count = document.getElementById('ann-count-badge');
  if (count) count.textContent = anns.length;
  if (!anns.length) {
    el.innerHTML = '<div class="ann-empty-state"><span class="ann-empty-icon"></span><div class="ann-empty-text">No announcements yet</div><div class="ann-empty-sub">Your first announcement will appear here</div></div>';
    return;
  }
  let html = '';
  anns.forEach(a => {
    const priority = a.priority || 'normal';
    const pClass = priority === 'urgent' ? 'pd-urgent' : priority === 'high' ? 'pd-high' : priority === 'low' ? 'pd-low' : 'pd-normal';
    html += '<div class="announcement-card" style="padding:14px 16px;border:1px solid var(--border);border-radius:9px;margin-bottom:10px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">' +
        '<div><strong style="font-size:14px;">' + (a.subject || '') + '</strong>' +
        '<span style="font-size:11px;color:var(--subtle);margin-left:10px;">' + (a.date || '') + '</span></div>' +
        '<span class="ann-prior-dot ' + pClass + '"></span>' +
      '</div>' +
      '<p style="font-size:13px;color:var(--muted);margin:6px 0;line-height:1.5;">' + (a.body || '') + '</p>' +
      '<span style="font-size:11px;color:var(--subtle);">By ' + (a.by || 'Admin') + ' · ' + (a.recipient || 'All Employees') + '</span></div>';
  });
  el.innerHTML = html;
}

// ── Admin: Filters & Helpers ──

function populateDeptFilters() {
  const depts = appState?.departments || [];
  const selects = ['rec-dept', 'rpt-dept', 'emp-dept-filter', 'f-dept', 'ann-recipient-select', 'active-now-dept-filter'];
  selects.forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const currentVal = sel.value;
    sel.innerHTML = '';
    if (id === 'f-dept') {
      // Add employee modal - no "All" option
      depts.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d; opt.textContent = d;
        sel.appendChild(opt);
      });
    } else {
      const allOpt = document.createElement('option');
      if (id === 'ann-recipient-select') {
        allOpt.value = 'all'; allOpt.textContent = 'All Employees';
      } else if (id === 'active-now-dept-filter') {
        allOpt.value = ''; allOpt.textContent = 'All Depts';
      } else {
        allOpt.value = ''; allOpt.textContent = 'All Departments';
      }
      sel.appendChild(allOpt);
      depts.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d; opt.textContent = d;
        sel.appendChild(opt);
      });
    }
    sel.value = currentVal || '';
  });
}

function renderAll() {
  renderEmpTable();
  populateDeptFilters();
  renderDepartments();
  renderDeptHeadcount();
  renderAnnouncements();
}

// ── Admin: Nav Badges ──

function updateNavBadges() {
  if (!appState) return;
  // Leave badges
  const pendingLeaves = (appState.leaveRequests || []).filter(l => l.status === 'Pending').length;
  ['nav-badge-leaves', 'nav-badge-dash'].forEach(id => {
    const badge = document.getElementById(id);
    if (!badge) return;
    if (pendingLeaves > 0 && !clearedNavBadges.has(id)) {
      badge.textContent = pendingLeaves;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
      badge.textContent = '';
    }
  });
  // Employee leaves badge
  const empBadge = document.getElementById('nav-badge-emp-leaves');
  if (empBadge) {
    const empId = sessionStorage.getItem('userId');
    const myPending = (appState.leaveRequests || []).filter(l => l.empId === empId && l.status === 'Pending').length;
    if (myPending > 0 && !clearedNavBadges.has('nav-badge-emp-leaves')) {
      empBadge.textContent = myPending;
      empBadge.classList.remove('hidden');
    } else {
      empBadge.classList.add('hidden');
      empBadge.textContent = '';
    }
  }
}

// ── Admin: Notifications ──

let notifPanelOpen = false;
function toggleNotifPanel() {
  notifPanelOpen = !notifPanelOpen;
  const panel = document.getElementById('notif-panel');
  if (!panel) return;
  if (notifPanelOpen) {
    panel.classList.add('open');
    renderAdminNotifPanel();
  } else {
    panel.classList.remove('open');
  }
  markAdminNotifsRead();
}

let empNotifPanelOpen = false;
function toggleEmpNotifPanel() {
  empNotifPanelOpen = !empNotifPanelOpen;
  const panel = document.getElementById('emp-notif-panel');
  if (!panel) return;
  if (empNotifPanelOpen) {
    panel.classList.add('open');
    renderEmpNotifPanel();
  } else {
    panel.classList.remove('open');
  }
}

function renderAdminNotifPanel() {
  const body = document.getElementById('notif-panel-body');
  if (!body || !appState) return;
  const notifs = appState.adminNotifications || [];
  if (!notifs.length) {
    body.innerHTML = '<p style="padding:20px;text-align:center;color:var(--subtle);font-size:13px;">No notifications yet.</p>';
    return;
  }
  let html = '';
  notifs.forEach(n => {
    html += '<div class="notif-item' + (n.isRead ? '' : ' notif-unread') + '"><div class="notif-item-text">' + (n.text || '') + '</div><div class="notif-item-time">' + (n.time || '') + '</div></div>';
  });
  body.innerHTML = html;
  updateAdminNotifBadge();
}

function renderEmpNotifPanel() {
  const body = document.getElementById('emp-notif-panel-body');
  if (!body || !appState) return;
  const notifs = appState.empNotifications || [];
  if (!notifs.length) {
    body.innerHTML = '<p style="padding:20px;text-align:center;color:var(--subtle);font-size:13px;">No notifications yet.</p>';
    return;
  }
  let html = '';
  notifs.forEach(n => {
    html += '<div class="notif-item' + (n.isRead ? '' : ' notif-unread') + '"><div class="notif-item-text">' + (n.text || '') + '</div><div class="notif-item-time">' + (n.time || '') + '</div></div>';
  });
  body.innerHTML = html;
  updateEmpNotifBadge();
}

function updateAdminNotifBadge() {
  const count = (appState?.adminNotifications || []).filter(n => !n.isRead).length;
  const badge = document.getElementById('admin-notif-count');
  if (badge) {
    badge.textContent = count;
    badge.style.display = count > 0 ? 'flex' : 'none';
  }
}

function updateEmpNotifBadge() {
  const count = (appState?.empNotifications || []).filter(n => !n.isRead).length;
  const badge = document.getElementById('emp-notif-count');
  if (badge) {
    badge.textContent = count;
    badge.style.display = count > 0 ? 'flex' : 'none';
  }
}

async function markAdminNotifsRead() {
  if (!appState) return;
  const unread = (appState.adminNotifications || []).filter(n => !n.isRead);
  if (unread.length === 0) return;
  await api('/api/notifications/mark-read', { method: 'POST', body: { userId: 'quemahtech' } });
  unread.forEach(n => n.isRead = true);
  updateAdminNotifBadge();
  updateNavBadges();
}

// ── Admin: Birthday Module ──

function renderBirthdayModule() {
  const module = document.getElementById('birthday-module');
  const list = document.getElementById('birthday-list');
  if (!module || !list || !appState) return;
  const emps = appState.employees || [];
  const today = new Date();
  const todayMD = (today.getMonth() + 1) + '-' + today.getDate();
  const birthdayEmps = emps.filter(e => e.bday && (e.bday.substring(5) === (String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0'))));
  if (!birthdayEmps.length) {
    module.style.display = 'none';
    return;
  }
  module.style.display = 'block';
  list.innerHTML = birthdayEmps.map(e =>
    '<div style="display:flex;align-items:center;gap:12px;padding:6px 0;">' +
      '<span style="font-size:20px;">🎂</span>' +
      '<span style="font-weight:600;">' + e.name + '</span>' +
      '<span style="color:var(--subtle);font-size:13px;">(' + e.dept + ')</span>' +
    '</div>'
  ).join('');
}

// ── Admin: Password & Settings ──

async function changeAdminPwd() {
  const curPwd = document.getElementById('a-cur-pwd')?.value.trim();
  const newPwd = document.getElementById('a-new-pwd')?.value.trim();
  const confPwd = document.getElementById('a-conf-pwd')?.value.trim();
  if (!curPwd || !newPwd || !confPwd) { showNotifBar('warning', 'Please fill all fields.'); return; }
  if (newPwd.length < 6) { showNotifBar('warning', 'New password must be at least 6 characters.'); return; }
  if (newPwd !== confPwd) { showNotifBar('error', 'Passwords do not match.'); return; }
  const btn = document.querySelector('#admin-settings .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Updating...'; }
  const res = await api('/api/auth/password', {
    method: 'PUT',
    body: { userId: 'quemahtech', currentPwd: curPwd, newPassword: newPwd }
  });
  if (btn) { btn.disabled = false; btn.textContent = 'Update Password'; }
  if (res && res.success) {
    showNotifBar('success', 'Password changed successfully!');
    document.getElementById('a-cur-pwd').value = '';
    document.getElementById('a-new-pwd').value = '';
    document.getElementById('a-conf-pwd').value = '';
  } else {
    showNotifBar('error', res?.error || 'Failed to change password.');
  }
}

function openAdminReset() {
  document.getElementById('forgot-modal').style.display = 'flex';
}

async function sendAdminReset() {
  const uid = document.getElementById('forgot-uid')?.value.trim() || 'quemahtech';
  const btn = document.querySelector('#forgot-modal .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Processing...'; }
  const res = await api('/api/auth/forgot-password', { method: 'POST', body: { uid } });
  if (btn) { btn.disabled = false; btn.textContent = 'Generate & Email Reset'; }
  const status = document.getElementById('fp-status-message');
  const tempPwd = document.getElementById('fp-temp-password');
  if (!status || !tempPwd) return;
  if (res && res.success) {
    status.style.display = 'block';
    status.style.background = '#dcfce7';
    status.style.color = '#166534';
    status.style.border = '1px solid #bbf7d0';
    status.textContent = res.message || 'Password reset successfully!';
    if (res.tempPassword) {
      tempPwd.style.display = 'block';
      tempPwd.textContent = res.tempPassword;
    }
  } else {
    status.style.display = 'block';
    status.style.background = '#fee2e2';
    status.style.color = '#991b1b';
    status.style.border = '1px solid #fecaca';
    status.textContent = res?.error || 'Failed to reset password.';
  }
}

// ── Admin: Calendar Config ──

function loadCalendarConfig() {
  // Stub: just show status
  const statusEl = document.getElementById('calendar-config-status');
  const saEl = document.getElementById('calendar-config-sa');
  const idEl = document.getElementById('calendar-config-id');
  if (statusEl) statusEl.textContent = 'Configured via server';
  if (saEl) saEl.textContent = localStorage.getItem('cal_sa_email') || '—';
  if (idEl) idEl.textContent = localStorage.getItem('cal_id') || localStorage.getItem('calendarId') || '—';
  // Email status
  const emailStatus = document.getElementById('email-config-status');
  if (emailStatus) emailStatus.textContent = 'In-App Active';
}

async function saveCalendarConfig() {
  const saPath = document.getElementById('cal-sa-path')?.value?.trim();
  const calId = document.getElementById('cal-id')?.value?.trim();
  if (!saPath) { showNotifBar('warning', 'Please enter the service account JSON path.'); return; }
  if (!calId) { showNotifBar('warning', 'Please enter a Calendar ID.'); return; }
  showNotifBar('info', 'Saving calendar config to server...');
  const res = await api('/api/calendar-config', { method: 'POST', body: { serviceAccountPath: saPath, calendarId: calId } });
  if (res && res.success) {
    localStorage.setItem('cal_sa_path', saPath);
    localStorage.setItem('cal_id', calId);
    showNotifBar('success', 'Calendar config saved!');
    loadCalendarConfig();
  } else {
    showNotifBar('error', 'Failed to save config.');
  }
}

async function syncBirthdaysToCalendar() {
  if (!appState) { showNotifBar('warning', 'App data not loaded.'); return; }
  showNotifBar('info', 'Syncing birthdays to calendar...');
  const emps = (appState.employees || []).filter(e => e.active && e.bday);
  const res = await api('/api/calendar/sync-birthdays', { method: 'POST', body: { employees: emps } });
  if (res && res.success) {
    showNotifBar('success', 'Birthdays synced! (' + (res.count || emps.length) + ' events)');
  } else {
    showNotifBar('error', 'Sync failed. Check server configuration.');
  }
}

async function testCalendarConnection() {
  showNotifBar('info', 'Testing calendar connection...');
  const config = await api('/api/calendar-config');
  if (config && !config.error) {
    showNotifBar('success', 'Calendar connection OK!');
  } else {
    showNotifBar('error', config?.error || 'Connection failed. Check server.');
  }
}

// ── Admin: Employee Modals ──

function openAddEmpModal() {
  document.getElementById('add-emp-modal').style.display = 'flex';
  document.getElementById('add-emp-title').textContent = 'Add New Employee';
  document.getElementById('f-id').value = '';
  document.getElementById('f-name').value = '';
  document.getElementById('f-email').value = '';
  document.getElementById('f-phone').value = '';
  document.getElementById('f-birthday').value = '';
  document.getElementById('f-joining').value = '';
  document.getElementById('f-designation').value = '';
  document.getElementById('f-pwd').value = '';
  document.getElementById('f-cl').value = '7.5';
  document.getElementById('f-sl').value = '3.0';
  populateDeptFilters();
}

function closeAddEmpModal() {
  document.getElementById('add-emp-modal').style.display = 'none';
}

async function saveEmployee() {
  const id = document.getElementById('f-id')?.value?.trim();
  const name = document.getElementById('f-name')?.value?.trim();
  const dept = document.getElementById('f-dept')?.value;
  if (!id || !name || !dept) { showNotifBar('warning', 'Please fill required fields (Name, ID, Department).'); return; }
  const btn = document.getElementById('add-emp-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  const data = {
    id, name, dept,
    email: document.getElementById('f-email')?.value?.trim() || '',
    phone: document.getElementById('f-phone')?.value?.trim() || '',
    bday: document.getElementById('f-birthday')?.value || '',
    joining: document.getElementById('f-joining')?.value || new Date().toISOString().split('T')[0],
    designation: document.getElementById('f-designation')?.value?.trim() || '',
    password: document.getElementById('f-pwd')?.value?.trim() || 'emp123',
    cl: parseFloat(document.getElementById('f-cl')?.value) || 7.5,
    sl: parseFloat(document.getElementById('f-sl')?.value) || 3.0
  };
  const res = await api('/api/employees', { method: 'POST', body: data });
  if (btn) { btn.disabled = false; btn.textContent = 'Save Employee'; }
  if (res && res.success) {
    showNotifBar('success', 'Employee ' + name + ' added successfully!');
    closeAddEmpModal();
    await refreshStateAndRender();
    renderEmpTable();
  } else {
    showNotifBar('error', res?.error || 'Failed to add employee.');
  }
}

function openEditEmpModal(empId) {
  const emp = appState?.employees?.find(e => e.id === empId);
  if (!emp) { showNotifBar('error', 'Employee not found.'); return; }
  document.getElementById('add-emp-modal').style.display = 'flex';
  document.getElementById('add-emp-title').textContent = 'Edit Employee: ' + emp.name;
  document.getElementById('f-id').value = emp.id;
  document.getElementById('f-id').disabled = true;
  document.getElementById('f-name').value = emp.name || '';
  document.getElementById('f-email').value = emp.email || '';
  document.getElementById('f-phone').value = emp.phone || '';
  document.getElementById('f-birthday').value = emp.bday || '';
  document.getElementById('f-joining').value = emp.joining || '';
  document.getElementById('f-designation').value = emp.designation || '';
  document.getElementById('f-pwd').value = '';
  document.getElementById('f-pwd').placeholder = 'Leave blank to keep current';
  document.getElementById('f-cl').value = emp.cl || 0;
  document.getElementById('f-sl').value = emp.sl || 0;
  populateDeptFilters();
  setTimeout(() => {
    const deptSelect = document.getElementById('f-dept');
    if (deptSelect) deptSelect.value = emp.dept || '';
  }, 50);
  // Override save to update instead
  const saveBtn = document.getElementById('add-emp-save-btn');
  if (saveBtn) {
    saveBtn.onclick = async function() {
      const updatedData = {
        name: document.getElementById('f-name')?.value?.trim() || emp.name,
        dept: document.getElementById('f-dept')?.value || emp.dept,
        email: document.getElementById('f-email')?.value?.trim() || '',
        phone: document.getElementById('f-phone')?.value?.trim() || '',
        bday: document.getElementById('f-birthday')?.value || '',
        joining: document.getElementById('f-joining')?.value || '',
        designation: document.getElementById('f-designation')?.value?.trim() || '',
        cl: parseFloat(document.getElementById('f-cl')?.value) || 0,
        sl: parseFloat(document.getElementById('f-sl')?.value) || 0
      };
      const newPwd = document.getElementById('f-pwd')?.value?.trim();
      if (newPwd) updatedData.password = newPwd;
      if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }
      const res = await api('/api/employees/' + encodeURIComponent(empId), { method: 'PUT', body: updatedData });
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Employee'; }
      if (res && res.success) {
        showNotifBar('success', 'Employee updated!');
        closeAddEmpModal();
        document.getElementById('f-id').disabled = false;
        saveBtn.onclick = saveEmployee;
        await refreshStateAndRender();
        renderEmpTable();
      } else {
        showNotifBar('error', res?.error || 'Update failed.');
      }
    };
  }
}

function openRemoveEmpModal(empId) {
  const emp = appState?.employees?.find(e => e.id === empId);
  if (!emp) return;
  archiveTargetId = null;
  removeTargetId = empId;
  setModalHeader('Remove Employee');
  document.getElementById('delete-emp-modal').dataset.mode = 'remove';
  const modalBody = document.querySelector('#delete-emp-modal .modal-body');
  if (modalBody) {
    modalBody.innerHTML = '' +
      '<p style="font-size:16px;margin-bottom:8px;">Remove <strong>' + emp.name + '</strong>?</p>' +
      '<p style="font-size:13px;color:var(--red);margin-bottom:16px;">This action is PERMANENT! All data will be deleted and archived.</p>' +
      '<div style="display:flex;gap:10px;justify-content:center;">' +
        '<button class="btn" onclick="closeDeleteEmpModal()" style="flex:1;">Cancel</button>' +
        '<button class="btn btn-danger" id="remove-confirm-btn" onclick="confirmRemoveEmployee()" style="flex:1;">Permanently Remove</button>' +
      '</div>';
  }
  document.getElementById('delete-emp-modal').style.display = 'flex';
}

function closeDeleteEmpModal() {
  document.getElementById('delete-emp-modal').style.display = 'none';
  archiveTargetId = null;
  removeTargetId = null;
}

async function confirmRemoveEmployee() {
  if (!removeTargetId || !appState) return;
  const emp = (appState.employees || []).find(e => e.id === removeTargetId);
  if (!emp) { showNotifBar('error', 'Employee not found.'); closeDeleteEmpModal(); return; }
  const confirmBtn = document.getElementById('remove-confirm-btn');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<span class="loading-spinner-sm" style="margin-right:6px;vertical-align:middle;"></span> Removing...';
  }
  const res = await api('/api/employees/' + encodeURIComponent(removeTargetId), { method: 'DELETE' });
  closeDeleteEmpModal();
  if (res && res.success) {
    showNotifBar('success', 'Employee removed and archived.');
    await refreshStateAndRender();
    renderEmpTable();
    renderAll();
  } else {
    showNotifBar('error', 'Failed to remove employee.');
  }
}

function toggleArchived() {
  const section = document.getElementById('archived-section');
  const arrow = document.getElementById('archived-arrow');
  if (!section) return;
  archivedVisible = !archivedVisible;
  section.style.display = archivedVisible ? 'block' : 'none';
  if (arrow) arrow.textContent = archivedVisible ? 'v' : '>';
  if (archivedVisible) renderArchivedEmployees();
}

function renderArchivedEmployees() {
  const tbody = document.getElementById('archived-table-body');
  if (!tbody || !appState) return;
  const archived = appState.archivedEmployees || [];
  if (!archived.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--subtle);">No archived employees.</td></tr>';
    return;
  }
  let html = '';
  archived.forEach(a => {
    html += '<tr><td><span style="font-family:var(--font-mono);font-size:12px;">' + (a.id || '') + '</span></td><td>' + (a.name || '') + '</td><td>' + (a.dept || '') + '</td><td><span class="tag t-archived">' + (a.status || 'Archived') + '</span></td><td>' + (a.joining || '—') + '</td><td>' + (a.exit || '—') + '</td><td><button class="btn btn-sm" onclick="unarchiveEmployee(\'' + (a.id || '') + '\')">Restore</button></td></tr>';
  });
  tbody.innerHTML = html;
}

async function unarchiveEmployee(id) {
  const res = await api('/api/employees/' + encodeURIComponent(id) + '/unarchive', { method: 'POST' });
  if (res && res.success) {
    showNotifBar('success', 'Employee restored!');
    await refreshStateAndRender();
    renderArchivedEmployees();
    renderEmpTable();
  } else {
    showNotifBar('error', 'Failed to restore employee.');
  }
}

async function undoArchive(empName) {
  if (!pendingUndoArchiveId) { showNotifBar('warning', 'Nothing to undo.'); return; }
  const res = await api('/api/employees/' + encodeURIComponent(pendingUndoArchiveId) + '/unarchive', { method: 'POST' });
  if (res && res.success) {
    showNotifBar('success', 'Undo successful! ' + empName + ' has been restored.');
    pendingUndoArchiveId = null;
    pendingUndoArchiveName = null;
    if (pendingUndoTimeout) { clearTimeout(pendingUndoTimeout); pendingUndoTimeout = null; }
    await refreshStateAndRender();
    renderEmpTable();
    renderArchivedEmployees();
  } else {
    showNotifBar('error', 'Undo failed.');
  }
}

// ── Admin: Export Functions ──

function exportCSV() {
  if (!appState || !appState.attendanceLogs) { showNotifBar('warning', 'No data to export.'); return; }
  const rows = [['ID','Employee','Dept','Date','Login','Logout','Hours','Status','Device']];
  (appState.attendanceLogs || []).forEach(l => {
    rows.push([
      l.emp_id, l.emp_name, l.department,
      l.login_date || getDateFromISO(l.login_time),
      formatTime(l.login_time),
      l.logout_time ? formatTime(l.logout_time) : 'Active',
      (l.working_hours || 0).toFixed(1),
      l.status || '',
      l.computer_name || ''
    ]);
  });
  const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
  downloadFile(csv, 'attendance_records_' + new Date().toISOString().split('T')[0] + '.csv', 'text/csv');
  showNotifBar('success', 'CSV exported!');
}

function exportExcel(type) {
  if (typeof XLSX === 'undefined') { showNotifBar('warning', 'XLSX library not loaded.'); return; }
  if (!appState) { showNotifBar('warning', 'No data loaded.'); return; }
  const wb = XLSX.utils.book_new();
  const filename = type + '_' + new Date().toISOString().split('T')[0];
  try {
    if (type === 'records') {
      const data = (appState.attendanceLogs || []).map(l => ({
        ID: l.emp_id, Employee: l.emp_name, Department: l.department,
        Date: l.login_date || getDateFromISO(l.login_time),
        Login: formatTime(l.login_time),
        Logout: l.logout_time ? formatTime(l.logout_time) : 'Active',
        Hours: (l.working_hours || 0).toFixed(1),
        Status: l.status || '',
        Device: l.computer_name || ''
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, 'Records');
    } else if (type === 'employees') {
      const data = (appState.employees || []).filter(e => e.active).map(e => ({
        ID: e.id, Name: e.name, Department: e.dept,
        Designation: e.designation || '', Email: e.email || '',
        Phone: e.phone || '', Birthday: e.bday || '',
        'Joining Date': e.joining || '',
        'CL Balance': e.cl || 0, 'SL Balance': e.sl || 0
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, 'Employees');
    }
    XLSX.writeFile(wb, filename + '.xlsx');
    showNotifBar('success', type.charAt(0).toUpperCase() + type.slice(1) + ' exported!');
  } catch (e) {
    showNotifBar('error', 'Export failed: ' + e.message);
  }
}

// ── Admin: Reports ──

function setReport(type, btnEl) {
  if (btnEl) {
    document.querySelectorAll('.rtab').forEach(b => b.classList.remove('active'));
    btnEl.classList.add('active');
  }
  if (!appState) return;
  const logs = appState.attendanceLogs || [];
  const employees = appState.employees || [];
  const deptFilter = document.getElementById('rpt-dept')?.value || '';
  const now = new Date();
  let filteredLogs = [];
  let title = '';
  if (type === 'daily') {
    const today = now.toISOString().split('T')[0];
    filteredLogs = logs.filter(l => (l.login_date || getDateFromISO(l.login_time)) === today);
    title = 'Daily Report — ' + now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  } else if (type === 'weekly') {
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    const weekEnd = new Date(monday);
    weekEnd.setDate(monday.getDate() + 6);
    filteredLogs = logs.filter(l => {
      const d = l.login_date || getDateFromISO(l.login_time);
      return d >= monday.toISOString().split('T')[0] && d <= weekEnd.toISOString().split('T')[0];
    });
    title = 'Weekly Report — ' + monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' - ' + weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } else {
    const monthStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    filteredLogs = logs.filter(l => (l.login_date || getDateFromISO(l.login_time)).startsWith(monthStr));
    title = 'Monthly Report — ' + now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  if (deptFilter) filteredLogs = filteredLogs.filter(l => l.department === deptFilter);
  document.getElementById('rpt-title').textContent = title;
  document.getElementById('rpt-table-title').textContent = 'Attendance Details';
  _reportRows = filteredLogs;
  renderReportTable(filteredLogs, employees);
  renderReportSummary(filteredLogs, employees);
}

function renderReportSummary(logs, employees) {
  const summaryEl = document.getElementById('rpt-summary');
  if (!summaryEl) return;
  const activeEmps = employees.filter(e => e.active).length;
  const uniquePresent = new Set(logs.filter(l => ['Present', 'Late', 'Half-Day', 'Active'].includes(l.status)).map(l => l.emp_id));
  summaryEl.innerHTML = '<strong>' + logs.length + '</strong> sessions · <strong>' + uniquePresent.size + '</strong> employees present out of <strong>' + activeEmps + '</strong> active';
  // Department bars
  renderReportBars(logs, employees);
}

function renderReportBars(logs, employees) {
  const attBars = document.getElementById('rpt-att-bars');
  const hrBars = document.getElementById('rpt-hr-bars');
  if (!attBars || !hrBars) return;
  const deptData = {};
  employees.filter(e => e.active).forEach(e => {
    if (!deptData[e.dept]) deptData[e.dept] = { total: 0, present: new Set(), hours: 0 };
    deptData[e.dept].total++;
  });
  logs.forEach(l => {
    if (deptData[l.department]) {
      if (['Present', 'Late', 'Half-Day', 'Active'].includes(l.status)) {
        deptData[l.department].present.add(l.emp_id);
      }
      deptData[l.department].hours += l.working_hours || 0;
    }
  });
  let attHtml = '', hrHtml = '';
  Object.entries(deptData).forEach(([dept, data]) => {
    const pct = data.total > 0 ? Math.round(data.present.size / data.total * 100) : 0;
    const color = pct >= 80 ? 'bf-green' : pct >= 50 ? 'bf-amber' : 'bf-red';
    attHtml += '<div class="bar-row"><span class="bar-label">' + dept + '</span><div class="bar-track"><div class="bar-fill ' + color + '" style="width:' + pct + '%"></div></div><span class="bar-val">' + pct + '%</span></div>';
    const avgHours = data.present.size > 0 ? (data.hours / data.present.size).toFixed(1) : '0';
    const hrPct = Math.min(100, (parseFloat(avgHours) / 9) * 100);
    hrHtml += '<div class="bar-row"><span class="bar-label">' + dept + '</span><div class="bar-track"><div class="bar-fill bf-blue" style="width:' + hrPct + '%"></div></div><span class="bar-val">' + avgHours + 'h</span></div>';
  });
  attBars.innerHTML = attHtml || '<p style="color:var(--subtle);font-size:13px;">No data</p>';
  hrBars.innerHTML = hrHtml || '<p style="color:var(--subtle);font-size:13px;">No data</p>';
}

function renderReportTable(logs, employees) {
  const thead = document.getElementById('rpt-thead');
  const tbody = document.getElementById('rpt-table');
  if (!thead || !tbody) return;
  thead.innerHTML = '<th>Employee</th><th>ID</th><th>Dept</th><th>Date</th><th>Login</th><th>Logout</th><th>Hours</th><th>Status</th>';
  if (!logs.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--subtle);">No records for this period.</td></tr>';
    return;
  }
  let html = '';
  logs.forEach(l => {
    const tagClass = (l.status || 'Active').toLowerCase().replace(/[-\s]/g, '');
    html += '<tr><td>' + (l.emp_name || '') + '</td><td><span style="font-family:var(--font-mono);font-size:12px;">' + (l.emp_id || '') + '</span></td><td><span class="chip ' + (DEPT_COLORS[l.department] || 'c-eng') + '">' + (l.department || '') + '</span></td><td>' + (l.login_date || getDateFromISO(l.login_time) || '') + '</td><td><span style="font-family:var(--font-mono);color:#16a34a;font-weight:600;">' + formatTime(l.login_time) + '</span></td><td><span style="font-family:var(--font-mono);color:#dc2626;font-weight:600;">' + (l.logout_time ? formatTime(l.logout_time) : '<span style="color:#d97706;">Active</span>') + '</span></td><td>' + (l.working_hours > 0 ? l.working_hours.toFixed(1) + 'h' : '—') + '</td><td><span class="tag t-' + tagClass + '">' + (l.status || 'Active') + '</span></td></tr>';
  });
  tbody.innerHTML = html;
}

// ── Admin: Composer (stub) ──

function closeComposeModal() {
  document.getElementById('compose-modal').style.display = 'none';
}

function clearCompose() { /* stub */ }
function toggleCcBccModal() { /* stub */ }
function toggleComposeView(view) { /* stub */ }
function wrapTag(id, tag) { /* stub */ }
function wrapHtml(id, html) { /* stub */ }
function applyEmailTemplate(val) { /* stub */ }
function sendCustomEmail() { /* stub */ }

// ── Dark Mode Toggle ──

function toggleDarkMode() {
  const isDark = document.body.classList.toggle('dark-mode');
  localStorage.setItem('darkMode', isDark);
  document.querySelectorAll('.dark-toggle-btn').forEach(b => b.textContent = isDark ? 'L' : 'D');
}

// ── CSS animation for login spinner ──
const __styleForLogin = document.createElement('style');
__styleForLogin.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
document.head.appendChild(__styleForLogin);
n// ── Employee lookup helper (used by initApp for session restoration) ──

function findEmployeeByIdOrEmail(uid) {
  if (!appState || !appState.employees) return null;
  const normalized = (uid || "").toLowerCase().trim();
  let emp = appState.employees.find(e => e.id === uid);
  if (!emp) emp = appState.employees.find(e => e.id && e.id.toLowerCase() === normalized);
  if (!emp) emp = appState.employees.find(e => e.email && e.email.toLowerCase() === normalized);
  return emp || null;
}



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
