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
        recs = recs.filter(function(l){ return l.status === 'Present' || l.status === 'Active'; });
      } else {
        recs = recs.filter(function(l){ return l.status === statusF; });
      }
    }
    rows = recs.map(function(l){ return { _type:'log', _id:l.id, emp_id:l.emp_id, emp_name:l.emp_name, department:l.department, login_time:l.login_time, logout_time:l.logout_time, working_hours:l.working_hours, status:l.status }; });

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
    showNotifBar('info', empName + ' has been archived.', {
      label: 'Undo',
      onClick() {
        undoArchive(empName);
      }
    });
  } else {
    showNotifBar('error', 'Failed to archive ' + emp.name + '.');
  }
  archiveTargetId = null;
}

async function deleteEmployee(employeeId) {
  if (typeof SupabaseDB === 'undefined' || !SupabaseDB.supabase) return { error: 'Database not connected.' };
  const sb = SupabaseDB.supabase;
  // Save to archived_employees BEFORE deleting (so data is preserved for history)
  const { data: emp } = await sb.from('employees').select('*').eq('id', employeeId).limit(1);
  if (emp && emp.length > 0) {
    try {
      await sb.from('archived_employees').insert({
        id: employeeId,
        original_id: employeeId,
        name: emp[0].name,
        dept: emp[0].dept,
        status: 'Deleted',
        joining: emp[0].joining || '',
        exit: new Date().toISOString().split('T')[0],
        employee_data: emp[0]
      });
    } catch (_) { /* archived_employees insert is best-effort */ }
  }
  // Delete child records first; silently skip errors (tables may be empty or unlinked)
  try { await sb.from('attendance_logs').delete().eq('emp_id', employeeId); } catch (_) {}
  try { await sb.from('attendance').delete().eq('id', employeeId); } catch (_) {}
  try { await sb.from('leave_requests').delete().eq('emp_id', employeeId); } catch (_) {}
  // Delete the employee record
  const { error } = await sb.from('employees').delete().eq('id', employeeId);
  if (error) return { error: error.message };
  return { success: true };
}

function openRemoveEmpModal(empId) {
  if (!appState) return;
  const emp = (appState.employees || []).find(e => e.id === empId);
  if (!emp) return;
  removeTargetId = empId;
  archiveTargetId = null;
  setModalHeader('Remove Employee');
  document.getElementById('delete-emp-modal').dataset.mode = 'remove';
  const modalBody = document.querySelector('#delete-emp-modal .modal-body');
  if (modalBody) {
    modalBody.innerHTML = '' +
      '<p style="font-size:16px;margin-bottom:8px;">Permanently remove <strong>' + emp.name + '</strong>?</p>' +
      '<p style="font-size:13px;color:var(--red);margin-bottom:16px;">This will delete all attendance records and leave requests for <strong>' + emp.id + '</strong>. This action <strong>cannot</strong> be undone.</p>' +
      '<div style="display:flex;gap:10px;justify-content:center;">' +
        '<button class="btn" onclick="closeDeleteEmpModal()" style="flex:1;">Cancel</button>' +
        '<button class="btn btn-danger" id="remove-confirm-btn" onclick="confirmRemoveEmployee()" style="flex:1;">Remove Permanently</button>' +
      '</div>';
  }
  document.getElementById('delete-emp-modal').style.display = 'flex';
}

async function confirmRemoveEmployee() {
  if (!removeTargetId || !appState) return;
  const emp = (appState.employees || []).find(e => e.id === removeTargetId);
  if (!emp) { showNotifBar('error', 'Employee not found.'); closeDeleteEmpModal(); return; }
  const confirmBtn = document.getElementById('remove-confirm-btn');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.style.background = '#dc2626';
    confirmBtn.style.color = '#fff';
    confirmBtn.innerHTML = '<span class="loading-spinner-sm" style="margin-right:6px;vertical-align:middle;"></span> Removing...';
  }
  const res = await deleteEmployee(removeTargetId);
  closeDeleteEmpModal();
  await refreshStateAndRender();
  if (res && res.success) {
    showNotifBar('info', emp.name + ' has been removed.');
  } else {
    showNotifBar('error', (res && res.error) || 'Failed to remove ' + emp.name + '.');
  }
  removeTargetId = null;
}

async function undoArchive(empName) {
  if (!pendingUndoArchiveId) return;
  const id = pendingUndoArchiveId;
  // Clear the undo timer
  if (pendingUndoTimeout) {
    clearTimeout(pendingUndoTimeout);
    pendingUndoTimeout = null;
  }
  pendingUndoArchiveId = null;
  pendingUndoArchiveName = null;
  showNotifBar('info', 'Restoring ' + empName + '…');
  const res = await api('/api/employees/' + id + '/unarchive', { method: 'POST' });
  await refreshStateAndRender();
  if (res && res.success) {
    showNotifBar('success', empName + ' has been restored.');
  } else {
    showNotifBar('error', 'Failed to restore ' + empName + '.');
  }
}

function closeDeleteEmpModal() {
  const modal = document.getElementById('delete-emp-modal');
  if (modal) { modal.style.display = 'none'; modal.dataset.mode = ''; }
  archiveTargetId = null;
  removeTargetId = null;
}

function openAddEmpModal() {
  document.getElementById('add-emp-modal').dataset.mode = 'add';
  document.getElementById('add-emp-modal').dataset.editId = '';
  document.getElementById('add-emp-title').innerText = 'Add New Employee';
  document.getElementById('add-emp-save-btn').innerText = 'Save Employee';
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
  document.getElementById('add-emp-title').innerText = 'Edit Employee';
  document.getElementById('add-emp-save-btn').innerText = 'Update Employee';
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

// closeAddEmpModal defined later (extended version)

function saveEmployee() {
  var saveBtn = document.getElementById('add-emp-save-btn');
  if (saveBtn && saveBtn.disabled) return; // Prevent double-submit

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
  if (!name || !id || !dept) { showNotifBar('warning', 'Please fill in all required fields (*)'); return; }
  if (mode === 'add') {
    if (appState && (appState.employees || []).some(e => e.id === id)) { showNotifBar('warning', 'Employee ID already exists.'); return; }
    // Disable button to prevent double-submit
    if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<span class="loading-spinner-sm" style="margin-right:6px;vertical-align:middle;"></span> Saving...'; }
    api('/api/employees', { method: 'POST', body: { id, name, dept, email, phone, bday, joining, designation, cl, sl, password: pwd || 'emp123' } }).then(async res => {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = 'Save Employee'; }
      if (res && res.success) {
        closeAddEmpModal();
        await refreshStateAndRender();
        showNotifBar('success', 'Employee ' + name + ' added successfully!');
      } else {
        console.error('[Auth] Failed to create employee:', id, res);
        closeAddEmpModal();
        showNotifBar('error', (res && res.error) || 'Failed to add employee. Check database connection.');
      }
    });
  } else {
    // Build update body - only include password if a new one was entered
    const updateBody = { name, dept, email, phone, bday, joining, designation, cl, sl };
    if (pwd && pwd.length > 0) {
      updateBody.password = pwd;
    }
    // Disable button to prevent double-submit
    if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<span class="loading-spinner-sm" style="margin-right:6px;vertical-align:middle;"></span> Updating...'; }
    api('/api/employees/' + editId, { method: 'PUT', body: updateBody }).then(async res => {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = 'Update Employee'; }
      if (res && res.success) {
        closeAddEmpModal();
        await refreshStateAndRender();
        showNotifBar('success', 'Employee ' + name + ' updated successfully!');
      } else {
        console.error('[Auth] Failed to update employee:', editId, res);
        closeAddEmpModal();
        showNotifBar('error', (res && res.error) || 'Failed to update employee.');
      }
    });
  }
}

function leaveReqCard(l) {
  const typeColor = l.type === 'CL' ? 'c-eng' : l.type === 'SL' ? 'c-mkt' : 'c-it';
  const statusTag = l.status === 'Pending' ? '<span class="tag t-late">Pending</span>' : l.status === 'Approved' ? '<span class="tag t-present">Approved</span>' : '<span class="tag t-absent">Rejected</span>';
  const actions = l.status === 'Pending'
    ? '<button class="btn btn-sm btn-success" onclick="handleLeave(\'' + l.id + '\',\'Approved\')">Approve</button><button class="btn btn-sm btn-danger" onclick="handleLeave(\'' + l.id + '\',\'Rejected\')">Reject</button>'
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
  if (!pending.length) { el.innerHTML = '<p style="color:var(--subtle);font-size:13px;">No pending requests</p>'; return; }
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
      if (res && res.warning) showNotifBar('warning', res.warning);
      showNotifBar('success', 'Leave for ' + req.empName + ' Approved!');
      addAdminNotif('Leave request from ' + req.empName + ' has been Approved.');
      addEmpNotif('Your ' + req.type + ' leave request has been Approved!', req.empId);
    } else {
      showNotifBar('info', 'Leave for ' + req.empName + ' Rejected.');
      addEmpNotif('Your ' + req.type + ' leave request has been Rejected.', req.empId);
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
    showNotifBar('success', 'Leave balances updated for ' + emp.name + '.');
  });
}

function setReport(type, btn) {
  if (!appState) return;
  const logs = appState.attendanceLogs || [];
  const employees = appState.employees || [];
  const leaveReqs = appState.leaveRequests || [];
  document.querySelectorAll('.rtab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const now = new Date();
  const today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  const deptF = document.getElementById('rpt-dept')?.value || '';
  let recs = [];
  let title = '';
  let isDaily = false;
  let reportDate = '';
  if (type === 'daily') {
    reportDate = today;
    recs = logs.filter(l => (l.login_date || getDateFromISO(l.login_time)) === today);
    title = 'Daily Report — ' + formatDate(today);
    isDaily = true;
  } else if (type === 'weekly') {
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const ws = weekStart.getFullYear() + '-' + String(weekStart.getMonth() + 1).padStart(2, '0') + '-' + String(weekStart.getDate()).padStart(2, '0');
    recs = logs.filter(l => (l.login_date || getDateFromISO(l.login_time)) >= ws);
    title = 'Weekly Report — Current Week';
  } else {
    const mn = today.slice(0, 7);
    recs = logs.filter(l => (l.login_date || getDateFromISO(l.login_time)).startsWith(mn));
    title = 'Monthly Report — ' + new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

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

  // ── Apply department filter to records ──
  if (deptF) {
    recs = recs.filter(function(l) { return l.department === deptF; });
  }

  // ── Build the report rows ──
  var reportRows = [];

  if (isDaily) {
    // Daily: show ALL active employees (present + leave + absent) like the Records page
    var loggedIds = new Set();
    var empHours = {};
    recs.forEach(function(l) {
      loggedIds.add(l.emp_id);
      if (!empHours[l.emp_id]) empHours[l.emp_id] = 0;
      empHours[l.emp_id] = Math.max(empHours[l.emp_id], l.working_hours || 0);
    });
    // Map log entries to rows
    reportRows = recs.map(function(l) {
      return { _type:'log', _id:l.id, emp_id:l.emp_id, emp_name:l.emp_name, department:l.department, login_time:l.login_time, logout_time:l.logout_time, working_hours:l.working_hours, status:l.status };
    });
    // Add absent + leave employees (also respecting dept filter)
    var leaveIds = _onLeaveIds(reportDate);
    var onLeaveSet = new Set(leaveIds);
    var otherEmps = employees.filter(function(e) {
      var _today = new Date().toISOString().split('T')[0];
      return e.active && !loggedIds.has(e.id) && (!deptF || e.dept === deptF) && (e.joining ? e.joining <= reportDate : reportDate >= _today);
    });
    for (var i = 0; i < otherEmps.length; i++) {
      var emp = otherEmps[i];
      reportRows.push({
        _type:'absent', emp_id:emp.id, emp_name:emp.name, department:emp.dept,
        login_time:null, logout_time:null, working_hours:0,
        status: onLeaveSet.has(emp.id) ? 'Leave' : 'Absent'
      });
    }
    // Sort: present/active first, leave second, absent last
    reportRows.sort(function(a,b) {
      var order = { Leave:1, Absent:2 };
      return (order[a.status] || 0) - (order[b.status] || 0);
    });
  } else {
    // Weekly/Monthly: just use logs as-is
    reportRows = recs.map(function(l) {
      return { _type:'log', _id:l.id, emp_id:l.emp_id, emp_name:l.emp_name, department:l.department, login_time:l.login_time, logout_time:l.logout_time, working_hours:l.working_hours, status:l.status };
    });
  }

  // ── Stats ──
  setText('rpt-title', title);
  setText('rpt-table-title', 'Attendance Records (' + reportRows.length + ')');

  var presentSet = new Set();
  var lateSet = new Set();
  var absentCount = 0;
  var leaveCount = 0;
  var totalHours = 0;
  var empWithHours = new Set();

  for (var i = 0; i < reportRows.length; i++) {
    var r = reportRows[i];
    if (r.status === 'Absent') absentCount++;
    else if (r.status === 'Leave') leaveCount++;
    else {
      presentSet.add(r.emp_id);
      if (r.status === 'Late') lateSet.add(r.emp_id);
    }
    if (r.working_hours > 0) {
      totalHours += r.working_hours;
      empWithHours.add(r.emp_id);
    }
  }

  var presentCount = presentSet.size;
  var lateCount = lateSet.size;
  var avgHrs = empWithHours.size > 0 ? (totalHours / empWithHours.size).toFixed(1) : '0.0';

  var sumEl = document.getElementById('rpt-summary');
  if (sumEl) {
    sumEl.innerHTML = '<div class="sum-item"><span>Present</span><strong class="green-v">' + presentCount + '</strong></div>' +
      '<div class="sum-item"><span>Absent</span><strong class="red-v">' + absentCount + '</strong></div>' +
      '<div class="sum-item"><span>On Leave</span><strong class="blue-v">' + leaveCount + '</strong></div>' +
      '<div class="sum-item"><span>Late</span><strong class="amber-v">' + lateCount + '</strong></div>' +
      '<div class="sum-item"><span>Avg Hours</span><strong>' + avgHrs + 'h</strong></div>' +
      '<div class="sum-item"><span>Total Sessions</span><strong>' + recs.length + '</strong></div>';
  }

  // ── Department attendance rate bars (using ALL employees per dept, not just logged ones) ──
  var colors = ['bf-blue', 'bf-green', 'bf-amber', 'bf-red', 'bf-purple', 'bf-green'];
  var attEl = document.getElementById('rpt-att-bars');
  var hrEl = document.getElementById('rpt-hr-bars');

  if (attEl || hrEl) {
    var deptData = {};
    employees.filter(function(e) { return e.active; }).forEach(function(emp) {
      if (!deptData[emp.dept]) deptData[emp.dept] = { total: 0, present: 0, hoursTotal: 0, hoursCount: 0 };
      deptData[emp.dept].total++;
      if (presentSet.has(emp.id)) deptData[emp.dept].present++;
    });
    // Also count logs via attendance records for hours
    recs.forEach(function(l) {
      if (deptData[l.department] && l.working_hours > 0) {
        deptData[l.department].hoursTotal += l.working_hours;
        deptData[l.department].hoursCount++;
      }
    });

    var deptEntries = Object.keys(deptData).map(function(d) { return [d, deptData[d]]; });

    if (attEl) {
      attEl.innerHTML = deptEntries.map(function(kv, i) {
        var d = kv[0], v = kv[1];
        var pct = v.total > 0 ? Math.round(v.present / v.total * 100) : 0;
        return '<div class="bar-row"><span class="bar-label">' + d + '</span><div class="bar-track"><div class="bar-fill ' + colors[i % colors.length] + '" style="width:' + pct + '%"></div></div><span class="bar-val">' + pct + '%</span></div>';
      }).join('');
    }
    if (hrEl) {
      hrEl.innerHTML = deptEntries.map(function(kv, i) {
        var d = kv[0], v = kv[1];
        var avg = v.hoursCount > 0 ? (v.hoursTotal / v.hoursCount).toFixed(1) : '0.0';
        var pct = Math.min(Math.round(parseFloat(avg) / 10 * 100), 100);
        return '<div class="bar-row"><span class="bar-label">' + d + '</span><div class="bar-track"><div class="bar-fill ' + colors[i % colors.length] + '" style="width:' + pct + '%"></div></div><span class="bar-val">' + avg + 'h</span></div>';
      }).join('');
    }
  }

  // ── Render table ──
  var thead = document.getElementById('rpt-thead');
  var tbody = document.getElementById('rpt-table');
  if (thead) thead.innerHTML = '<th>ID</th><th>Employee</th><th>Dept</th><th>Date</th><th>Login</th><th>Logout</th><th>Duration</th><th>Status</th>';
  if (tbody) {
    smartTableSync(tbody, reportRows, function(r) {
      var hasLogin = !!r.login_time;
      var hasLogout = !!r.logout_time;
      var isAbsent = (r.status === 'Absent' || r.status === 'Leave');
      var tagClass = r.status.toLowerCase().replace(/[-\s]/g, '');
      return '<tr data-id="' + (r._id || 'rpt-' + r.emp_id) + '">' +
        '<td><span style="font-family:var(--font-mono);font-size:12px;color:var(--muted);font-weight:600;">' + r.emp_id + '</span></td>' +
        '<td>' +
          '<div style="display:flex;align-items:center;gap:10px;">' +
            '<div class="av ' + AV_COLORS[Math.max(0, employees.findIndex(function(e){ return e.id === r.emp_id; })) % AV_COLORS.length] + '" style="flex-shrink:0;">' + r.emp_name.charAt(0) + '</div>' +
            '<span style="font-weight:600;font-size:14px;color:var(--text);display:flex;align-items:center;gap:6px;">' +
              (isAbsent ? '' : hasLogout ? '' : '<span class="pulse-dot" style="width:8px;height:8px;"></span>') +
              '<span>' + r.emp_name + '</span></span>' +
          '</div>' +
        '</td>' +
        '<td><span class="chip ' + (DEPT_COLORS[r.department] || 'c-eng') + '">' + r.department + '</span></td>' +
        '<td>' + (hasLogin ? formatDate(getDateFromISO(r.login_time)) : isDaily ? formatDate(reportDate) : '—') + '</td>' +
        '<td>' + (hasLogin ? '<span style="font-family:var(--font-mono);font-size:13px;font-weight:600;color:#16a34a;">' + formatTime(r.login_time) + '</span>' : '<span style="color:var(--subtle);">—</span>') + '</td>' +
        '<td>' + (hasLogout ? '<span style="font-family:var(--font-mono);font-size:13px;font-weight:600;color:#dc2626;">' + formatTime(r.logout_time) + '</span>' : isAbsent ? '<span style="color:var(--subtle);">—</span>' : '<span style="color:#d97706;font-weight:600;">Active</span>') + '</td>' +
        '<td>' + (r.working_hours > 0 ? '<strong style="font-size:14px;">' + r.working_hours.toFixed(1) + 'h</strong>' : '<span style="color:var(--subtle);">—</span>') + '</td>' +
        '<td><span class="tag t-' + tagClass + '">' + r.status + '</span></td></tr>';
    }, function(r) { return r.emp_id + '-' + (r._id || ''); });
  }
}

function changeAdminPwd() {
  const cur = document.getElementById('a-cur-pwd').value.trim();
  const newPwd = document.getElementById('a-new-pwd').value.trim();
  const conf = document.getElementById('a-conf-pwd').value.trim();
  if (!cur || !newPwd || !conf) { showNotifBar('warning', 'Please fill in all fields.'); return; }
  if (newPwd.length < 6) { showNotifBar('warning', 'New password must be at least 6 characters.'); return; }
  if (newPwd !== conf) { showNotifBar('warning', 'Passwords do not match.'); return; }
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
      showNotifBar('success', 'Admin password updated successfully!');
    } else {
      showNotifBar('error', (res && res.error) || 'Failed to update password.');
    }
  });
}

function empTab(tabName, btnElement) {
  sessionStorage.setItem('empLastTab', tabName);
  if (tabName === 'leaves') {
    clearedNavBadges.add('nav-badge-emp-leaves'); _saveClearedBadges();
    const el = document.getElementById('nav-badge-emp-leaves');
    if (el) { el.classList.add('hidden'); el.textContent = ''; }
  }
  switchTab('#page-employee', 'emp', tabName, btnElement, () => {
    const uid = sessionStorage.getItem('userId');
    const emp = (appState.employees || []).find(e => e.id === uid);
    if (tabName === 'dashboard' && emp) renderEmpDashboard(emp);
    if (tabName === 'history') renderEmpHistory();
  });
}

function renderEmpDashboard(emp) {
  if (!appState) return;
  const logs = appState.attendanceLogs || [];
  const announcements = appState.announcements || [];
  const myLogs = logs.filter(l => l.emp_id === emp.id);
  const now = new Date();
  const monthStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const thisMonth = myLogs.filter(l => (l.login_date || getDateFromISO(l.login_time)).startsWith(monthStr));
  // Count unique days present
  const presentDays = new Set();
  const lateDays = new Set();
  thisMonth.forEach(l => {
    const d = l.login_date || getDateFromISO(l.login_time);
    if (['Present', 'Late', 'Half-Day', 'Active'].includes(l.status)) {
      presentDays.add(d);
      if (l.status === 'Late') lateDays.add(d);
    }
  });
  const hours = thisMonth.reduce((a, l) => a + (l.working_hours || 0), 0);
  setText('ms-present', presentDays.size);
  setText('ms-absent', Math.max(0, 22 - presentDays.size));
  setText('ms-hours', hours.toFixed(1) + 'h');
  setText('ms-late', lateDays.size);

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
    const mySessions = myLogs.slice(0, 20);
    smartTableSync(logEl, mySessions, l => {
      const d = l.login_date || getDateFromISO(l.login_time);
      const dateObj = new Date(d + 'T00:00:00');
      return '<tr data-log-id="' + l.id + '" class="session-row">' +
        '<td style="font-weight:500;">' + formatDate(d) + '</td>' +
        '<td style="color:var(--muted);font-size:13px;">' + DAYS[dateObj.getDay()] + '</td>' +
        '<td><span style="font-family:var(--font-mono);font-size:13px;font-weight:600;color:#16a34a;">' + formatTime(l.login_time) + '</span></td>' +
        '<td><span style="font-family:var(--font-mono);font-size:13px;font-weight:600;color:#dc2626;">' + (l.logout_time ? formatTime(l.logout_time) : '<span style="color:#d97706;font-weight:600;">Active</span>') + '</span></td>' +
        '<td style="color:var(--subtle);">—</td>' +
        '<td><strong style="font-size:14px;">' + (l.working_hours > 0 ? l.working_hours.toFixed(1) + 'h' : '—') + '</strong></td>' +
        '<td><span class="tag t-' + l.status.toLowerCase().replace(/[-\s]/g, '') + '">' + l.status + '</span></td></tr>';
    }, l => 'session-' + l.id);
  }

  renderMyLeaveHistory(emp);
  renderAnnouncementsEmp(announcements);
}

function renderEmpHistory() {
  if (!appState) return;
  const logs = appState.attendanceLogs || [];
  const employees = appState.employees || [];
  const monthInp = document.getElementById('hist-month');
  const monthInpNow = new Date();
  const monthStr = monthInp?.value || monthInpNow.getFullYear() + '-' + String(monthInpNow.getMonth() + 1).padStart(2, '0');
  const uid = sessionStorage.getItem('userId');
  const emp = findEmployeeByIdOrEmail(uid) || employees[0];
  if (!emp) return;
  const myLogs = logs.filter(l => l.emp_id === emp.id && (l.login_date || getDateFromISO(l.login_time)).startsWith(monthStr));
  const presentDays = new Set();
  myLogs.forEach(l => {
    if (['Present', 'Late', 'Half-Day', 'Active'].includes(l.status)) {
      presentDays.add(l.login_date || getDateFromISO(l.login_time));
    }
  });
  const totalHrs = myLogs.reduce((a, l) => a + (l.working_hours || 0), 0);
  const summEl = document.getElementById('hist-summary');
  if (summEl) summEl.innerHTML = '<div class="sum-item"><span>Sessions</span><strong>' + myLogs.length + '</strong></div><div class="sum-item"><span>Present Days</span><strong class="green-v">' + presentDays.size + '</strong></div><div class="sum-item"><span>Total Hours</span><strong>' + totalHrs.toFixed(1) + 'h</strong></div>';
  const tbody = document.getElementById('hist-table');
  if (tbody) {
    smartTableSync(tbody, myLogs, l => {
      const d = l.login_date || getDateFromISO(l.login_time);
      const dateObj = new Date(d + 'T00:00:00');
      return '<tr data-log-id="' + l.id + '" class="session-row">' +
        '<td style="font-weight:500;">' + formatDate(d) + '</td>' +
        '<td style="color:var(--muted);font-size:13px;">' + DAYS[dateObj.getDay()] + '</td>' +
        '<td><span style="font-family:var(--font-mono);font-size:13px;font-weight:600;color:#16a34a;">' + formatTime(l.login_time) + '</span></td>' +
        '<td><span style="font-family:var(--font-mono);font-size:13px;font-weight:600;color:#dc2626;">' + (l.logout_time ? formatTime(l.logout_time) : '<span style="color:#d97706;font-weight:600;">Active</span>') + '</span></td>' +
        '<td style="color:var(--subtle);">—</td>' +
        '<td><strong style="font-size:14px;">' + (l.working_hours > 0 ? l.working_hours.toFixed(1) + 'h' : '—') + '</strong></td>' +
        '<td><span class="tag t-' + l.status.toLowerCase().replace(/[-\s]/g, '') + '">' + l.status + '</span></td></tr>';
    }, l => 'session-' + l.id);
  }
}

function empPunchIn() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-IN', { hour12: true, hour: '2-digit', minute: '2-digit' });
  const h = now.getHours();
  if (h >= 18) {
    showNotifBar('error', 'Cannot sign in after 6:00 PM. Contact admin if you need a correction.');
    return;
  }
  if (!appState) { showNotifBar('error', 'App data not loaded. Please refresh the page.'); return; }
  const uid = sessionStorage.getItem('userId');
  if (!uid) { showNotifBar('error', 'Session expired. Please log in again.'); return; }
  const emp = findEmployeeByIdOrEmail(uid);
  if (!emp) { showNotifBar('error', 'Employee record not found for ID: ' + uid + '. Try logging in with your Employee ID.'); return; }
  api('/api/attendance/login', {
    method: 'POST',
    body: { empId: emp.id, empName: emp.name, department: emp.dept, computerName: navigator.platform || 'Web Browser' }
  }).then(async res => {
    if (res && res.success) {
      const pill = document.getElementById('emp-pill');
      if (pill) { pill.className = 'status-pill sp-in'; pill.innerHTML = '<div class="status-dot sd-g"></div>Signed In'; }
      showNotifBar('success', 'Signed In at ' + timeStr);
      appendTimeline('in', 'Signed In', timeStr);
      if (h >= 14) showNotifBar('warning', 'Login after 2:00 PM — this session is flagged as Half-Day.');
    } else {
      showNotifBar('error', (res && res.error) || 'Failed to sign in.');
    }
    await refreshStateAndRender();
  });
}

function empPunchOut() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-IN', { hour12: true, hour: '2-digit', minute: '2-digit' });
  if (!appState) { showNotifBar('error', 'App data not loaded. Please refresh the page.'); return; }
  const uid = sessionStorage.getItem('userId');
  if (!uid) { showNotifBar('error', 'Session expired. Please log in again.'); return; }
  const emp = findEmployeeByIdOrEmail(uid);
  if (!emp) { showNotifBar('error', 'Employee record not found for ID: ' + uid + '. Try logging in with your Employee ID.'); return; }
  api('/api/attendance/logout', {
    method: 'POST',
    body: { empId: emp.id }
  }).then(async res => {
    if (res && res.success) {
      const pill = document.getElementById('emp-pill');
      if (pill) { pill.className = 'status-pill sp-out'; pill.innerHTML = '<div class="status-dot sd-r"></div>Signed Out'; }
      if (breakInterval) { clearInterval(breakInterval); breakInterval = null; document.getElementById('break-btn').innerText = 'Start Break'; document.getElementById('break-timer-wrap').style.display = 'none'; }
      showNotifBar('info', 'Signed Out at ' + timeStr);
      appendTimeline('out', 'Signed Out', timeStr);
    } else {
      showNotifBar('error', (res && res.error) || 'Failed to sign out.');
    }
    await refreshStateAndRender();
  });
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

// ── Auto Sign-Out at 6 PM ──
// Periodically checks if the current time has reached/passed 18:00 (6 PM).
// If so, and the employee still has an active session, automatically signs them out.
let _autoSignOutInterval = null;

function startAutoSignOutTimer(emp) {
  // Clear any existing timer first
  stopAutoSignOutTimer();

  // Check immediately in case we're already past 6 PM
  checkAutoSignOut(emp);

  // Then check every 30 seconds (accounts for page being open from before 6 PM)
  _autoSignOutInterval = setInterval(() => checkAutoSignOut(emp), 30000);
}

function stopAutoSignOutTimer() {
  if (_autoSignOutInterval) {
    clearInterval(_autoSignOutInterval);
    _autoSignOutInterval = null;
  }
}

async function checkAutoSignOut(emp) {
  const now = new Date();
  const h = now.getHours();

  // Only run at/after 6 PM (18:00)
  if (h < 18) return;

  if (!emp || !appState || !appState.attendanceLogs) return;

  // Check if this employee has an active session (no logout_time)
  const activeSession = appState.attendanceLogs.find(
    l => l.emp_id === emp.id && !l.logout_time
  );
  if (!activeSession) {
    // Already signed out - stop the timer
    stopAutoSignOutTimer();
    return;
  }

  console.log('[AutoSignOut] Auto-signing out', emp.name, 'at', formatTime(now.toISOString()));

  // Call the sign-out API
  const res = await api('/api/attendance/logout', {
    method: 'POST',
    body: { empId: emp.id }
  });

  if (res && res.success) {
    // Update the UI pill
    const pill = document.getElementById('emp-pill');
    if (pill) {
      pill.className = 'status-pill sp-out';
      pill.innerHTML = '<div class="status-dot sd-r"></div>Signed Out';
    }

    // Clear break timer if any
    if (typeof breakInterval !== 'undefined' && breakInterval) {
      clearInterval(breakInterval);
      breakInterval = null;
      const breakBtn = document.getElementById('break-btn');
      if (breakBtn) breakBtn.innerText = 'Start Break';
      const wrap = document.getElementById('break-timer-wrap');
      if (wrap) wrap.style.display = 'none';
    }

    showNotifBar('info', 'Auto signed out at 6:00 PM.');
    appendTimeline('out', 'Auto Signed Out', formatTime(now.toISOString()));

    // Stop the timer since we've signed out
    stopAutoSignOutTimer();
  } else {
    console.warn('[AutoSignOut] API call failed, will retry on next interval');
  }

  await refreshStateAndRender();
}

function autoAttendancePunchIn(emp) {
  // Check for an active session
  const logs = appState ? appState.attendanceLogs || [] : [];
  const activeLogs = logs.filter(l => l.emp_id === emp.id && !l.logout_time);
  if (activeLogs.length > 0) {
    const pill = document.getElementById('emp-pill');
    if (pill) { pill.className = 'status-pill sp-in'; pill.innerHTML = '<div class="status-dot sd-g"></div>Signed In'; }
  }
  // Start the auto sign-out timer regardless (it will check time internally)
  startAutoSignOutTimer(emp);
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
  const emp = findEmployeeByIdOrEmail(uid) || employees[0];
  if (!emp) return;
  let msg = days + ' working day(s) requested.';
  if (currentLeaveType === 'CL') msg += ' Your CL balance: ' + emp.cl + ' days.' + (emp.cl < days ? ' (' + (days - emp.cl) + ' day(s) will become Unpaid).' : '');
  else if (currentLeaveType === 'SL') msg += ' Your SL balance: ' + emp.sl + ' days. Note: Each SL day = 0.5 SL + 0.5 Unpaid.';
  note.innerText = msg;
}

function submitLeaveRequest() {
  const from = document.getElementById('leave-from')?.value;
  const to = document.getElementById('leave-to')?.value;
  const reason = document.getElementById('leave-reason')?.value.trim();
  if (!from || !to) { showNotifBar('warning', 'Please select leave dates.'); return; }
  if (!reason) { showNotifBar('warning', 'Please provide a reason.'); return; }
  if (!appState) return;
  const employees = appState.employees || [];
  const uid = sessionStorage.getItem('userId');
  const emp = findEmployeeByIdOrEmail(uid) || employees[0];
  if (!emp) { showNotifBar('error', 'Employee not found. Please log in again.'); return; }
  let days = 0;
  const d1 = new Date(from), d2 = new Date(to);
  for (let d = new Date(d1); d <= d2; d.setDate(d.getDate() + 1)) { if (d.getDay() !== 0 && d.getDay() !== 6) days++; }
  const newReq = { empId: emp.id, empName: emp.name, dept: emp.dept, type: currentLeaveType, from, to, days, reason, status: 'Pending' };
  api('/api/leave-requests', { method: 'POST', body: newReq }).then(async () => {
    await refreshStateAndRender();
    showNotifBar('success', 'Leave request submitted! Awaiting admin approval.');
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
  const emp = findEmployeeByIdOrEmail(uid);
  if (!emp) return;
  if (newPwd.length < 6) { showNotifBar('warning', 'New password must be at least 6 characters.'); return; }
  if (newPwd !== conf) { showNotifBar('warning', 'Passwords do not match.'); return; }
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
      showNotifBar('success', 'Password updated successfully!');
    } else {
      showNotifBar('error', (res && res.error) || 'Failed to update password.');
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
    sendBtn.textContent = 'Generating...';
  }
  try {
    const res = await api('/api/auth/forgot-password', {
      method: 'POST',
      body: { uid }
    });
    if (res && res.success && res.tempPassword) {
      const statusEl = document.getElementById('fp-status-message');
      if (statusEl) {
        statusEl.innerHTML = '<strong>' + (res.message || 'Temporary password generated. Use it to log in.') + '</strong>';
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
        sendBtn.textContent = 'Generate New Password';
      }
    } else {
      showNotifBar('error', (res && res.error) || 'Failed to generate reset password.');
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.textContent = 'Generate Reset Password';
      }
    }
  } catch (e) {
    showNotifBar('error', 'Server unreachable: ' + e.message);
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Generate Reset Password';
    }
  }
}

async function api(url, opts = {}) {
  // Auto-initialize SupabaseClient if not ready yet
  if (typeof SupabaseClient !== 'undefined' && !SupabaseClient.ready) {
    const inited = SupabaseClient.init();
    if (inited) {
      console.log('[SBClient] Auto-initialized on first API call');
    }
  }
  // Use SupabaseClient directly (stateless, no server needed)
  if (typeof SupabaseClient !== 'undefined' && SupabaseClient.ready) {
    const result = await SupabaseClient.call(opts.method || 'GET', url, opts.body || null);
    if (result) return result;
  }
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
  const unreadNotifs = (appState.adminNotifications || []).filter(n => !n.isRead).length;
  const dashCount = pendingLeaves + unreadNotifs;
  updateBadge('nav-badge-dash', dashCount);

  // ── Employee nav badges ──
  const uid = sessionStorage.getItem('userId');
  if (uid) {
    const myPendingLeaves = (appState.leaveRequests || [])
      .filter(l => l.empId === uid && l.status === 'Pending').length;
    updateBadge('nav-badge-emp-leaves', myPendingLeaves);
    updateEmpNotifBadge();
  }
}

function updateBadge(id, count) {
  const el = document.getElementById(id);
  if (!el) return;
  // If user has cleared this badge via tab click, don't re-show it
  if (clearedNavBadges.has(id)) return;
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
  const btn = badge.closest('.notif-bell-btn');
  if (!appState || !appState.adminNotifications) { badge.textContent = '0'; badge.style.display = 'none'; if (btn) btn.classList.remove('bell-pulse'); return; }
  const unreadCount = appState.adminNotifications.filter(n => !n.isRead).length;
  badge.textContent = unreadCount;
  badge.style.display = unreadCount > 0 ? 'flex' : 'none';
  if (btn) btn.classList.toggle('bell-pulse', unreadCount > 0);
}

function updateEmpNotifBadge() {
  const badge = document.getElementById('emp-notif-count');
  if (!badge) return;
  const btn = badge.closest('.notif-bell-btn');
  if (!appState || !appState.empNotifications) { badge.textContent = '0'; badge.style.display = 'none'; if (btn) btn.classList.remove('bell-pulse'); return; }
  const uid = sessionStorage.getItem('userId');
  const relevant = appState.empNotifications.filter(n => n.target === 'emp' || n.user_id === uid);
  const unreadCount = relevant.filter(n => !n.isRead).length;
  badge.textContent = unreadCount;
  badge.style.display = unreadCount > 0 ? 'flex' : 'none';
  if (btn) btn.classList.toggle('bell-pulse', unreadCount > 0);
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
  const panel = document.getElementById('notif-panel');
  if (adminNotifPanelOpen) {
    renderAdminNotifPanel();
    requestAnimationFrame(() => {
      if (adminNotifPanelOpen) {
        panel.classList.add('open');
        markAdminNotifsRead();
      }
    });
  } else {
    panel.classList.remove('open');
    closeNotifPanels();
  }
}

function toggleEmpNotifPanel() {
  empNotifPanelOpen = !empNotifPanelOpen;
  const panel = document.getElementById('emp-notif-panel');
  if (empNotifPanelOpen) {
    renderEmpNotifPanel();
    requestAnimationFrame(() => {
      if (empNotifPanelOpen) {
        panel.classList.add('open');
        markEmpNotifsRead();
      }
    });
  } else {
    panel.classList.remove('open');
    closeNotifPanels();
  }
}

async function markAdminNotifsRead() {
  if (appState && appState.adminNotifications) {
    appState.adminNotifications.forEach(n => { n.isRead = true; n.unread = false; });
  }
  updateAdminNotifBadge();
  updateNavBadges();
  await api('/api/notifications/mark-read', { method: 'POST', body: { userId: ADMIN_USERNAME } });
}

async function markEmpNotifsRead() {
  if (appState && appState.empNotifications) {
    appState.empNotifications.forEach(n => { n.isRead = true; n.unread = false; });
  }
  updateEmpNotifBadge();
  updateNavBadges();
  const uid = sessionStorage.getItem('userId');
  await api('/api/notifications/mark-read', { method: 'POST', body: { userId: uid } });
}

function renderAdminNotifPanel() {
  const body = document.getElementById('notif-panel-body');
  if (!body) return;
  const all = (appState && appState.adminNotifications) || [];
  const notifs = all.filter(n => !n.isRead);
  if (!notifs.length) {
    body.innerHTML = '<p style="color:var(--subtle);font-size:13px;text-align:center;padding:20px;">No new notifications.</p>';
    return;
  }
  smartListSync(body, notifs, n =>
    '<div class="notif-item unread" onclick="dismissAdminNotif(\'' + (n._id || n.id || n.text) + '\')">' +
      '<div style="flex:1">' + n.text + '</div>' +
      '<div class="notif-item-time">' + (n.time || '') + '</div>' +
      '<span class="notif-dismiss" title="Dismiss">&times;</span>' +
    '</div>',
    n => n._id || n.id || n.text + (n.time || '')
  );
}

function dismissAdminNotif(key) {
  const notifs = appState?.adminNotifications || [];
  const idx = notifs.findIndex(n => (n._id || n.id || n.text) === key);
  if (idx !== -1) {
    if (!notifs[idx].isRead) {
      notifs[idx].isRead = true;
      notifs[idx].unread = false;
      api('/api/notifications/mark-read', { method: 'POST', body: { userId: ADMIN_USERNAME } });
    }
  }
  updateAdminNotifBadge();
  renderAdminNotifPanel();
}

function renderEmpNotifPanel() {
  const body = document.getElementById('emp-notif-panel-body');
  if (!body) return;
  const uid = sessionStorage.getItem('userId');
  const allNotifs = (appState && appState.empNotifications) || [];
  const notifs = allNotifs.filter(n => (n.target === 'emp' || n.user_id === uid) && !n.isRead);
  if (!notifs.length) {
    body.innerHTML = '<p style="color:var(--subtle);font-size:13px;text-align:center;padding:20px;">No new notifications.</p>';
    return;
  }
  smartListSync(body, notifs, n =>
    '<div class="notif-item unread" onclick="dismissEmpNotif(\'' + (n._id || n.id || n.text) + '\')">' +
      '<div style="flex:1">' + n.text + '</div>' +
      '<div class="notif-item-time">' + (n.time || '') + '</div>' +
      '<span class="notif-dismiss" title="Dismiss">&times;</span>' +
    '</div>',
    n => n._id || n.id || n.text + (n.time || '')
  );
}

function dismissEmpNotif(key) {
  const allNotifs = appState?.empNotifications || [];
  const idx = allNotifs.findIndex(n => (n._id || n.id || n.text) === key);
  if (idx !== -1) {
    if (!allNotifs[idx].isRead) {
      allNotifs[idx].isRead = true;
      allNotifs[idx].unread = false;
      const uid = sessionStorage.getItem('userId');
      api('/api/notifications/mark-read', { method: 'POST', body: { userId: uid } });
    }
  }
  updateEmpNotifBadge();
  renderEmpNotifPanel();
}

function showNotifBar(type, msg, icon, actionBtn) {
  const bar = document.getElementById('notif-bar');
  const iconEl = document.getElementById('notif-icon');
  const textEl = document.getElementById('notif-text');
  if (!bar || !textEl) return;
  bar.className = 'notif-bar ' + type;
  if (iconEl) iconEl.textContent = icon || '';
  textEl.textContent = msg;
  // Add or update action button
  let actionEl = document.getElementById('notif-action-btn');
  if (actionBtn) {
    if (!actionEl) {
      actionEl = document.createElement('button');
      actionEl.id = 'notif-action-btn';
      actionEl.style.cssText = 'background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.25);border-radius:8px;color:#fff;cursor:pointer;font-size:13px;font-weight:600;padding:6px 14px;white-space:nowrap;flex-shrink:0;transition:all 0.15s;';
      actionEl.addEventListener('mouseenter', () => { actionEl.style.background = 'rgba(255,255,255,0.28)'; });
      actionEl.addEventListener('mouseleave', () => { actionEl.style.background = 'rgba(255,255,255,0.18)'; });
      // Insert before the close button
      const closeBtn = bar.querySelector('.notif-close');
      bar.insertBefore(actionEl, closeBtn);
    }
    actionEl.textContent = actionBtn.label;
    actionEl.onclick = (e) => {
      e.stopPropagation();
      actionBtn.onClick();
    };
    actionEl.style.display = 'inline-flex';
  } else if (actionEl) {
    actionEl.style.display = 'none';
    actionEl.onclick = null;
  }
  bar.style.display = 'flex';
  clearTimeout(bar._hideTimer);
  bar._hideTimer = setTimeout(hideNotifBar, 5000);
}

function hideNotifBar() {
  const bar = document.getElementById('notif-bar');
  if (bar) bar.style.display = 'none';
}

// ── Employee lookup: tries ID first, then email (for cases where sessionUserId is an email)
function findEmployeeByIdOrEmail(identifier) {
  if (!appState || !appState.employees) return null;
  if (!identifier) return null;
  return appState.employees.find(e => e.id === identifier) ||
         appState.employees.find(e => e.email && e.email.toLowerCase() === identifier.toLowerCase());
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

function formatTime(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function getDateFromISO(isoStr) {
  if (!isoStr) return '';
  return isoStr.slice(0, 10);
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

  console.log('[Auth] Login attempt for user:', uid, '(remember:', rememberMe, ')');

  if (!uid || !pwd) {
    document.getElementById('err-msg').style.display = 'flex';
    document.getElementById('err-msg-text').textContent = 'Please fill in all fields.';
    return;
  }

  document.getElementById('err-msg').style.display = 'none';

  const currentHour = new Date().getHours();
  if (uid !== ADMIN_USERNAME && uid.toLowerCase() !== ADMIN_EMAIL && currentHour >= 18) {
    console.log('[Auth] Login blocked: time restriction (hour=' + currentHour + ')');
    document.getElementById('err-msg').style.display = 'flex';
    document.getElementById('err-msg-text').textContent = 'Employee logins are blocked after 6:00 PM IST.';
    return;
  }

  const loginBtn = document.querySelector('.login-btn');
  setButtonLoading(loginBtn, true);

  // api() auto-initializes SupabaseClient if not ready
  const res = await api('/api/auth/login', {
    method: 'POST',
    body: { uid, pwd }
  });

  if (!res) {
    setButtonLoading(loginBtn, false, 'Sign In');
    document.getElementById('err-msg').style.display = 'flex';
    document.getElementById('err-msg-text').textContent = 'Cannot connect to database. Check Supabase config and ensure tables exist.';
    return;
  }

  if (res.success === false && res.error === 'TIME_BLOCK') {
    setButtonLoading(loginBtn, false, 'Sign In');
    document.getElementById('err-msg').style.display = 'flex';
    document.getElementById('err-msg-text').textContent = res.message || 'Employee logins are blocked after 6:00 PM IST.';
    return;
  }

  if (res && res.success) {
    const dbUserId = res.user && res.user.id ? res.user.id : uid;
    console.log('[Auth] Login SUCCESS for:', uid, 'role:', res.role, 'DB ID:', dbUserId);
    sessionStorage.setItem('userId', dbUserId);
    sessionStorage.setItem('userRole', res.role);
    if (rememberMe) {
      localStorage.setItem('rememberedUser', dbUserId);
      localStorage.setItem('rememberedRole', res.role);
      console.log('[Auth] Remember-me set for:', dbUserId);
    } else {
      localStorage.removeItem('rememberedUser');
      localStorage.removeItem('rememberedRole');
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
        showNotifBar('warning', 'First login after 2:00 PM — today will be flagged as Half-Day.');
      }

      const emp = findEmployeeByIdOrEmail(res.user && res.user.id);
      if (emp) {
        console.log('[Auth] Employee data found, showing page for:', emp.name);
        showEmployeePage(emp);
        hideLoading();
      } else {
        console.error('[Auth] Employee NOT found in appState after login. ID:', res.user && res.user.id);
        console.log('[Auth] Available employees:', (appState?.employees || []).map(e => e.id).join(', '));
        hideLoading();
        showNotifBar('error', 'Employee data not found. Check database connection.');
      }
    }
    return;
  }

  if (res) {
    console.log('[Auth] Login FAILED:', res.message || res.error);
    setButtonLoading(loginBtn, false, 'Sign In');
    document.getElementById('err-msg').style.display = 'flex';
    document.getElementById('err-msg-text').textContent = res.message || res.error || 'Invalid credentials. Please try again.';
    return;
  }

  console.error('[Auth] Login FAILED - no response from API (Supabase not reachable)');
  setButtonLoading(loginBtn, false, 'Sign In');
  document.getElementById('err-msg').style.display = 'flex';
  document.getElementById('err-msg-text').textContent = 'Unable to connect to database. Check your Supabase configuration.';
}

function logout() {
  if (currentRole === 'employee') {
    const uid = sessionStorage.getItem('userId');
    api('/api/auth/logout', { method: 'POST', body: { uid } });
  }
  stopAutoSignOutTimer();
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
  const empPanel = document.getElementById('emp-notif-panel');
  if (empPanel) {
    empPanel.classList.remove('open');
  }
}

async function showAdminPage() {
  document.getElementById('page-login').classList.remove('active');
  document.getElementById('page-admin').classList.add('active');
  initClock('admin-clock');
  markAdminNotifsRead();
  renderAll();
}

function showEmployeePage(emp) {
  document.getElementById('page-login').classList.remove('active');
  document.getElementById('page-employee').classList.add('active');
  document.getElementById('emp-topbar-name').textContent = emp.name;
  document.getElementById('emp-badge').textContent = emp.id;
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
  document.querySelectorAll('.dark-toggle-btn').forEach(b => b.textContent = isDark ? 'L' : 'D');
}

function switchTab(pageId, prefix, tabName, btnElement, onShow) {
  // Cancel any pending render from a previous rapid tab switch
  if (_pendingTabSwitch) {
    cancelAnimationFrame(_pendingTabSwitch);
    _pendingTabSwitch = null;
  }
  const tabClass = prefix === 'admin' ? 'atab' : 'etab';
  const tabs = document.querySelectorAll(pageId + ' .' + tabClass);
  const target = document.getElementById(prefix + '-' + tabName);
  if (!target) return;
  // Remove show from all tabs immediately — no delay
  tabs.forEach(t => t.classList.remove('show', 'tab-leaving'));
  // Show target tab instantly
  target.classList.add('show');
  // Update nav button active states instantly
  document.querySelectorAll(pageId + ' .nav-btn').forEach(b => b.classList.remove('active'));
  if (btnElement) btnElement.classList.add('active');
  // Defer heavy data rendering to next frame so tab switch is instantaneous
  if (onShow) {
    _pendingTabSwitch = requestAnimationFrame(() => {
      _pendingTabSwitch = null;
      onShow();
    });
  }
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
      const emp = findEmployeeByIdOrEmail(uid);
      if (emp) {
        const activeTab = sessionStorage.getItem('empLastTab') || 'dashboard';
        if (activeTab === 'dashboard') renderEmpDashboard(emp);
        else if (activeTab === 'history') renderEmpHistory();
      }
      updateNavBadges();
      updateEmpNotifBadge();
      renderEmpNotifPanel();
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
    '<td><button class="btn btn-sm" onclick="viewArchivedEmployee(\'' + (a.id || '') + '\')">View</button></td></tr>',
    a => a.id || a.name
  );
}

function viewArchivedEmployee(archivedId) {
  if (!appState) return;
  const archived = (appState.archivedEmployees || []).find(a => a.id === archivedId);
  if (!archived) { showNotifBar('error', 'Archived employee not found.'); return; }
  const ed = archived.employee_data || {};
  // Use the add-emp-modal in read-only view mode
  const modal = document.getElementById('add-emp-modal');
  modal.dataset.mode = 'view';
  modal.dataset.editId = '';
  document.getElementById('add-emp-title').innerText = 'Archived Employee — ' + archived.name;
  document.getElementById('add-emp-save-btn').innerText = 'Read-Only';
  document.getElementById('add-emp-save-btn').disabled = true;
  modal.style.display = 'flex';
  // Populate all fields with archived data
  document.getElementById('f-name').value = archived.name || '';
  document.getElementById('f-name').disabled = true;
  document.getElementById('f-id').value = archived.id || '';
  document.getElementById('f-id').disabled = true;
  document.getElementById('f-email').value = ed.email || '';
  document.getElementById('f-email').disabled = true;
  document.getElementById('f-phone').value = ed.phone || '';
  document.getElementById('f-phone').disabled = true;
  document.getElementById('f-birthday').value = ed.bday || '';
  document.getElementById('f-birthday').disabled = true;
  document.getElementById('f-joining').value = archived.joining || ed.joining || '';
  document.getElementById('f-joining').disabled = true;
  document.getElementById('f-designation').value = ed.designation || '';
  document.getElementById('f-designation').disabled = true;
  document.getElementById('f-pwd').value = '';
  document.getElementById('f-pwd').placeholder = 'Data archived — password hidden';
  document.getElementById('f-pwd').disabled = true;
  document.getElementById('f-cl').value = ed.cl || 0;
  document.getElementById('f-cl').disabled = true;
  document.getElementById('f-sl').value = ed.sl || 0;
  document.getElementById('f-sl').disabled = true;
  // Departments
  renderDepartments();
  const deptSelect = document.getElementById('f-dept');
  if (deptSelect) {
    deptSelect.value = archived.dept || '';
    deptSelect.disabled = true;
  }
  // Show archive metadata banner
  const modalBody = modal.querySelector('.modal-body');
  const existingBanner = document.getElementById('archived-view-banner');
  if (!existingBanner) {
    const banner = document.createElement('div');
    banner.id = 'archived-view-banner';
    banner.style.cssText = 'background:var(--amber-bg, #fef3c7);border:1px solid var(--amber-border, #fde68a);border-radius:8px;padding:12px 14px;margin-bottom:16px;font-size:12px;color:var(--amber-text, #92400e);line-height:1.6;';
    banner.innerHTML = '<strong>Archived / Past Employee</strong> — This data is read-only for compliance and audit purposes. ' +
      'Archived on: <strong>' + (archived.exit ? formatDate(archived.exit) : '—') + '</strong> | ' +
      'Status: <strong>' + (archived.status || 'Archived') + '</strong>';
    modalBody.insertBefore(banner, modalBody.firstChild);
  }
}

function closeAddEmpModal() {
  document.getElementById('add-emp-modal').style.display = 'none';
  document.getElementById('f-id').disabled = false;
  // Re-enable all fields (for next use)
  ['f-name','f-id','f-email','f-phone','f-birthday','f-joining','f-designation','f-pwd','f-cl','f-sl','f-dept'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = false;
  });
  document.getElementById('f-pwd').placeholder = 'Default: emp123';
  document.getElementById('add-emp-save-btn').disabled = false;
  // Remove the archived view banner
  const banner = document.getElementById('archived-view-banner');
  if (banner) banner.remove();
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
  const selects = ['f-dept', 'rec-dept', 'emp-dept-filter', 'active-now-dept-filter', 'ann-recipient-select', 'rpt-dept'];
  selects.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    let allOption = '';
    if (id === 'ann-recipient-select') allOption = '<option value="all">All Employees</option>';
    else if (id !== 'f-dept') allOption = '<option value="">All Departments</option>';
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
  if (appState && appState.departments && appState.departments.includes(name)) { showNotifBar('warning', 'Department already exists.'); return; }
  input.value = '';
  await api('/api/departments', { method: 'POST', body: { name } });
  await refreshStateAndRender();
  showNotifBar('success', 'Department \'' + name + '\' added.');
}

async function removeDept(name) {
  if (!confirm('Remove department \'' + name + '\'?')) return;
  await api('/api/departments/' + encodeURIComponent(name), { method: 'DELETE' });
  await refreshStateAndRender();
  showNotifBar('info', 'Department \'' + name + '\' removed.');
}

function selectAnnRecipient(btn, val) {
  // No-op: recipient selection handled via <select id="ann-recipient-select">
}

function selectAnnPriority(btn, val) {
  document.querySelectorAll('.ann-prior-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  annSelectedPriority = val;
}

function sendAnnouncement() {
  const subject = document.getElementById('ann-subject').value.trim();
  const body = document.getElementById('ann-body').value.trim();
  if (!subject || !body) { showNotifBar('warning', 'Please enter subject and message.'); return; }
  const today = new Date().toISOString().split('T')[0];
  const recipVal = document.getElementById('ann-recipient-select')?.value || 'all';
  const ann = { date: today, subject, body, by: 'Admin', priority: annSelectedPriority, recipient: recipVal === 'all' ? 'All Employees' : 'Department: ' + recipVal };
  api('/api/announcements', { method: 'POST', body: ann }).then(async () => {
    await refreshStateAndRender();
    document.getElementById('ann-subject').value = '';
    document.getElementById('ann-body').value = '';
    document.getElementById('ann-charcount').textContent = '0';
    showNotifBar('success', 'Announcement sent!');
    // Broadcast announcement notification to all employees (single notification, no per-emp loop)
    api('/api/notifications', { method: 'POST', body: { text: 'New announcement: ' + subject, target: 'emp', userId: '' } }).then(async () => {
      await refreshStateAndRender();
    });
  });
}

function previewAnnouncement() {
  const subject = document.getElementById('ann-subject').value.trim() || '(No subject)';
  const body = document.getElementById('ann-body').value.trim() || '(No message)';
  showNotifBar('info', subject + ' — ' + body.substring(0, 100) + (body.length > 100 ? '…' : ''));
}

function renderAnnouncements() {
  if (!appState) return;
  const announcements = appState.announcements || [];
  const el = document.getElementById('announcements-list');
  if (!el) return;
  const badge = document.getElementById('ann-count-badge');
  if (badge) badge.textContent = announcements.length;
  if (!announcements.length) {
    el.innerHTML = '<div class="ann-empty-state"><span class="ann-empty-icon"></span><div class="ann-empty-text">No announcements yet</div><div class="ann-empty-sub">Your first announcement will appear here</div></div>';
    return;
  }
  smartListSync(el, announcements, a => {
    const cat = a.priority === 'urgent' ? 'ann-cat-urgent' : a.priority === 'high' ? 'ann-cat-high' : a.priority === 'low' ? 'ann-cat-general' : 'ann-cat-event';
    const pClass = 'priority-' + (a.priority || 'normal');
    return '<div class="announcement-card ' + pClass + '"><div class="ann-header"><div class="ann-header-left"><span class="ann-category-badge ' + cat + '">' + (a.priority || 'normal') + '</span><div class="ann-subject">' + a.subject + '</div></div></div><div class="ann-meta"><span class="ann-meta-item">' + formatDate(a.date) + '</span><span class="ann-meta-item">' + (a.by || 'Admin') + '</span><span class="ann-meta-item">' + (a.recipient || 'All Employees') + '</span></div><div class="ann-body">' + a.body.replace(/\n/g, '<br>') + '</div></div>';
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
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;"><span></span><span><strong>' + e.name + '</strong>\'s Birthday today!</span><a href="' + calendarUrl + '" target="_blank" style="margin-left:auto;font-size:12px;color:var(--accent);">Add to Calendar</a></div>';
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
  if (!to || !subject) { showNotifBar('warning', 'Please fill in To and Subject.'); return; }
  const text = '[' + subject + '] to ' + to + ': ' + (body || '').replace(/<[^>]*>/g, '').substring(0, 100);
  addAdminNotif(text);
  showNotifBar('success', 'Notification sent to admin panel!');
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
  statusEl.textContent = 'Real-time delivery active';
  statusEl.style.color = 'var(--green)';
}

function loadCalendarConfig() {
  const statusEl = document.getElementById('calendar-config-status');
  const saEl = document.getElementById('calendar-config-sa');
  const idEl = document.getElementById('calendar-config-id');
  api('/api/calendar-config').then(cfg => {
    if (cfg) {
      if (statusEl) statusEl.textContent = cfg.enabled ? 'Connected' : 'Not configured';
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
    showNotifBar('success', 'Calendar config saved!');
    loadCalendarConfig();
  } else {
    showNotifBar('error', 'Failed to save calendar config.');
  }
}

async function syncBirthdaysToCalendar() {
  const btn = document.querySelector('button[onclick="syncBirthdaysToCalendar()"]');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="loading-spinner-sm" style="margin-right:6px;vertical-align:middle;"></span> Syncing...';
  }
  showNotifBar('info', 'Syncing birthdays to calendar…');
  const res = await api('/api/calendar/sync-birthdays', { method: 'POST' });
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = 'Sync All Birthdays';
  }
  if (res && res.success) {
    let msg = res.created + ' birthday event(s) created!';
    if (res.errors && res.errors.length > 0) {
      msg += ' (' + res.errors.length + ' error(s))';
    }
    showNotifBar(res.errors && res.errors.length > 0 ? 'warning' : 'success', msg);
    if (res.errors && res.errors.length > 0) {
      console.warn('[Calendar] Sync errors:', res.errors);
    }
  } else {
    showNotifBar('error', 'Calendar sync failed: ' + (res?.error || 'server unreachable'));
  }
}

async function testCalendarConnection() {
  showNotifBar('info', 'Testing calendar connection…');
  const res = await api('/api/calendar-config');
  if (res && res.enabled) {
    showNotifBar('success', 'Calendar connection OK!');
  } else {
    showNotifBar('warning', 'Calendar not configured.');
  }
}

function exportCSV() {
  if (!appState) return;
  const logs = appState.attendanceLogs || [];
  const rows = [['ID','Name','Dept','Date','Login','Logout','Hours','Status']];
  logs.forEach(l => rows.push([l.emp_id, l.emp_name, l.department, getDateFromISO(l.login_time), formatTime(l.login_time), l.logout_time ? formatTime(l.logout_time) : '', l.working_hours || 0, l.status]));
  const csv = rows.map(r => r.join(',')).join('\n');
  downloadFile(csv, 'attendance_logs.csv', 'text/csv');
}

function exportExcel(type) {
  if (typeof XLSX === 'undefined') { showNotifBar('warning', 'XLSX library not loaded.'); return; }
  if (!appState) return;
  const logs = appState.attendanceLogs || [];
  const employees = appState.employees || [];
  try {
    if (type === 'records') {
      const data = logs.map(l => ({ ID: l.emp_id, Name: l.emp_name, Dept: l.department, Date: getDateFromISO(l.login_time), Login: formatTime(l.login_time), Logout: l.logout_time ? formatTime(l.logout_time) : 'Active', Hours: l.working_hours || 0, Status: l.status }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Attendance Logs');
      XLSX.writeFile(wb, 'attendance_logs.xlsx');
    } else if (type === 'employees') {
      const data = employees.filter(e => e.active).map(e => ({ ID: e.id, Name: e.name, Dept: e.dept, Email: e.email, Phone: e.phone, Designation: e.designation, CL: e.cl, SL: e.sl, UL: e.ul || 0 }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Employees');
      XLSX.writeFile(wb, 'employees.xlsx');
    }
    showNotifBar('success', 'Excel file exported!');
  } catch (e) {
    showNotifBar('error', 'Export failed: ' + e.message);
  }
}

function exportEmpCSV() {
  if (!appState) return;
  const logs = appState.attendanceLogs || [];
  const uid = sessionStorage.getItem('userId');
  const myLogs = logs.filter(l => l.emp_id === uid);
  const rows = [['Date','Day','Login','Logout','Hours','Status']];
  myLogs.forEach(l => {
    const d = getDateFromISO(l.login_time);
    const dateObj = new Date(d + 'T00:00:00');
    rows.push([d, DAYS[dateObj.getDay()], formatTime(l.login_time), l.logout_time ? formatTime(l.logout_time) : '', l.working_hours || 0, l.status]);
  });
  const csv = rows.map(r => r.join(',')).join('\n');
  downloadFile(csv, 'my_attendance_sessions.csv', 'text/csv');
  showNotifBar('success', 'CSV exported!');
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
