/* ═══════════════════════════════════
   EMPLOYEE JS — Employee portal functions
═══════════════════════════════════ */

// ── Employee Tab Navigation ──
function empTab(tabName, btnElement) {
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
    return '<div class=\"bar-row\"><span class=\"bar-label\">' + d + '</span><div class=\"bar-track\"><div class=\"bar-fill ' + colors[i] + '\" style=\"width:' + pct + '%\"></div></div><span class=\"bar-val\">' + hrs + 'h</span></div>';
  }).join('');

  // Recent log
  const logEl = document.getElementById('emp-log');
  if (logEl) logEl.innerHTML = myRecs.slice(0, 7).map(r => {
    const dateObj = new Date(r.date);
    return '<tr><td>' + formatDate(r.date) + '</td><td style=\"color:var(--muted);font-size:12px;\">' + DAYS[dateObj.getDay()] + '</td><td><span style=\"font-family:var(--font-mono);font-size:12px;\">' + (r.in || '—') + '</span></td><td><span style=\"font-family:var(--font-mono);font-size:12px;\">' + (r.out || '—') + '</span></td><td style=\"font-size:12px;\">—</td><td><strong>' + (r.hours > 0 ? r.hours.toFixed(1) + 'h' : '—') + '</strong></td><td><span class=\"tag t-' + r.status.toLowerCase().replace('-', '').replace(' ', '') + '\">' + r.status + '</span></td></tr>';
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
  if (summEl) summEl.innerHTML = '<div class=\"sum-item\"><span>Working Days</span><strong>' + recs.length + '</strong></div><div class=\"sum-item\"><span>Present</span><strong class=\"green-v\">' + present + '</strong></div><div class=\"sum-item\"><span>Total Hours</span><strong>' + hours.toFixed(1) + 'h</strong></div>';
  const tbody = document.getElementById('hist-table');
  if (tbody) tbody.innerHTML = recs.map(r => {
    const dateObj = new Date(r.date);
    return '<tr><td>' + formatDate(r.date) + '</td><td style=\"color:var(--muted);\">' + DAYS[dateObj.getDay()] + '</td><td><span style=\"font-family:var(--font-mono);font-size:12px;\">' + (r.in || '—') + '</span></td><td><span style=\"font-family:var(--font-mono);font-size:12px;\">' + (r.out || '—') + '</span></td><td>—</td><td><strong>' + (r.hours > 0 ? r.hours.toFixed(1) + 'h' : '—') + '</strong></td><td><span class=\"tag t-' + r.status.toLowerCase().replace('-', '').replace(' ', '') + '\">' + r.status + '</span></td></tr>';
  }).join('');
}

// ── Punch Actions ──
function empPunchIn() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-IN', { hour12: true, hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toISOString().split('T')[0];
  const pill = document.getElementById('emp-pill');
  if (pill) { pill.className = 'status-pill sp-in'; pill.innerHTML = '<div class=\"status-dot sd-g\"></div>Signed In'; }
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
  if (pill) { pill.className = 'status-pill sp-out'; pill.innerHTML = '<div class=\"status-dot sd-r\"></div>Not signed in'; }
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
    if (pillEl) { pillEl.className = 'status-pill sp-break'; pillEl.innerHTML = '<div class=\"status-dot sd-a\"></div>On Break'; }
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
    if (pillEl) { pillEl.className = 'status-pill sp-in'; pillEl.innerHTML = '<div class=\"status-dot sd-g\"></div>Signed In'; }
  }
}

function appendTimeline(type, text, time) {
  const tl = document.getElementById('today-timeline');
  if (!tl) return;
  if (tl.children.length === 1 && tl.children[0].style.color === 'var(--subtle)') tl.innerHTML = '';
  const colors = { in: '#22c55e', out: '#ef4444', break: 'var(--amber)' };
  const item = document.createElement('li');
  item.className = 'timeline-item';
  item.innerHTML = '<div class=\"timeline-dot td-' + type + '\" style=\"background:' + (colors[type] || colors.in) + '\"></div><div class=\"timeline-content\">' + text + '<div class=\"timeline-time\">' + time + '</div></div>';
  tl.prepend(item);
}

function autoAttendancePunchIn(emp) {
  const today = new Date().toISOString().split('T')[0];
  const existingRec = attendanceRecords.find(r => r.id === emp.id && r.date === today);
  if (!existingRec || !existingRec.in) {
    setTimeout(() => empPunchIn(), 700);
  } else {
    const pill = document.getElementById('emp-pill');
    if (pill && existingRec.in) { pill.className = 'status-pill sp-in'; pill.innerHTML = '<div class=\"status-dot sd-g\"></div>Signed In'; }
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
    return '<div class=\"leave-req-card\" style=\"flex-wrap:wrap;\"><div style=\"flex:1;\"><div style=\"font-size:13px;font-weight:600;\"><span class=\"chip ' + typeColor + '\">' + l.type + '</span> ' + formatDate(l.from) + ' – ' + formatDate(l.to) + '</div><div style=\"font-size:12px;color:var(--muted);\">' + l.days + ' day(s) | ' + l.reason + '</div></div><span class=\"tag t-' + l.status.toLowerCase() + '\">' + l.status + '</span></div>';
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
