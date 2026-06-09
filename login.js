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
    localStorage.setItem('loggedIn', 'true');
    localStorage.setItem('userRole', 'admin');
    localStorage.setItem('userId', uid);
    localStorage.setItem('rememberMe', rememberMe ? 'true' : 'false');
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
      localStorage.setItem('loggedIn', 'true');
      localStorage.setItem('userRole', 'employee');
      localStorage.setItem('userId', emp.id);
      localStorage.setItem('rememberMe', rememberMe ? 'true' : 'false');
      loadEmployeeData(emp);
      switchPage('page-employee');
      autoAttendancePunchIn(emp);
      showNotifBar('success', 'Welcome back, ' + emp.name.split(' ')[0] + '!', '👋');
      return;
    }
  }

  // Fallback to localStorage-based auth (offline mode)
  const expectedAdminPwd = localStorage.getItem('adminPassword') || 'quemah123';
  if (currentRole === 'admin' && uid === 'quemahtech' && pwd === expectedAdminPwd) {
    localStorage.setItem('loggedIn', 'true');
    localStorage.setItem('userRole', 'admin');
    localStorage.setItem('userId', uid);
    localStorage.setItem('rememberMe', rememberMe ? 'true' : 'false');
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
        localStorage.setItem('loggedIn', 'true');
        localStorage.setItem('userRole', 'employee');
        localStorage.setItem('userId', emp.id);
        localStorage.setItem('rememberMe', rememberMe ? 'true' : 'false');
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
  localStorage.removeItem('loggedIn');
  localStorage.removeItem('userRole');
  localStorage.removeItem('userId');
  localStorage.removeItem('rememberMe');
  currentUser = null;
  document.getElementById('uid').value = '';
  document.getElementById('pwd').value = '';
  switchPage('page-login');
}

// ── Session Restore ──
async function restoreSession() {
  const loggedIn = localStorage.getItem('loggedIn');
  const userId = localStorage.getItem('userId');
  if (loggedIn !== 'true') return;

  try { await refreshState(); } catch (e) { /* use cached data */ }

  if (userId === 'quemahtech') {
    switchPage('page-admin');
    renderRecords();
    return;
  }

  if (userId) {
    const emp = employees.find(e => e.id.toLowerCase() === userId.toLowerCase());
    if (emp) {
      currentUser = emp;
      loadEmployeeData(emp);
      switchPage('page-employee');
      autoAttendancePunchIn(emp);
    }
  }
}

// ── Forgot Password Flow ──
function openForgotModal() {
  document.getElementById('forgot-modal').style.display = 'flex';
  document.getElementById('forgot-uid').value = '';
  document.getElementById('forgot-phone').value = '';
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
  if (!uid || !phone) { showNotifBar('warning', 'Please enter both Username/ID and phone details.', '⚠️'); return; }

  let userFound = false;
  let userEmail = '';
  let userName = '';

  if (uid === 'quemahtech') {
    userFound = true;
    userEmail = 'admin@test.com';
    userName = 'Administrator';
  } else {
    const emp = employees.find(e => e.id.toLowerCase() === uid.toLowerCase() && e.active);
    if (emp) {
      const cleanPhone = emp.phone ? emp.phone.replace(/\\s+/g, '') : '';
      const last4 = cleanPhone.substring(cleanPhone.length - 4);
      if (last4 === phone) { userFound = true; userEmail = emp.email || ''; userName = emp.name; }
    }
  }

  if (!userFound) { showNotifBar('error', 'User details or phone number not matched.', '❌'); return; }

  resetUserId = uid;
  const otp = String(Math.floor(1000 + Math.random() * 9000));
  localStorage.setItem('resetOtp', otp);
  localStorage.setItem('resetOtpExpiry', Date.now() + 300000);
  document.getElementById('otp-modal').dataset.fallbackOtp = otp;

  if (userEmail) {
    const otpHtml = '<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;"><div style="background:#0f2744;padding:20px;text-align:center;border-radius:10px 10px 0 0;"><h1 style="color:#f59e0b;margin:0;font-size:20px;">🛡️ TEST</h1><p style="color:#94a3b8;margin:4px 0 0;font-size:12px;">Employee Management System</p></div><div style="padding:24px;background:#fff;border:1px solid #e2e8f0;border-radius:0 0 10px 10px;"><h2 style="color:#0f2744;margin:0 0 8px;">Password Reset</h2><p style="color:#475569;font-size:14px;margin:0 0 16px;">Hi <strong>' + userName + '</strong>, use the OTP below to reset your password.</p><div style="background:#f8fafc;border:2px dashed #f59e0b;border-radius:8px;padding:16px;text-align:center;margin-bottom:16px;"><span style="font-size:32px;font-weight:700;letter-spacing:8px;color:#0f2744;font-family:monospace;">' + otp + '</span></div><p style="color:#94a3b8;font-size:12px;margin:0;">If you didn\'t request this, please ignore this email.</p></div></div>';
    api('/api/send-email', {
      method: 'POST',
      body: { to: userEmail, subject: 'TEST — Password Reset OTP', html: otpHtml }
    }).then(res => {
      if (res.success) { showNotifBar('success', 'OTP sent to ' + userEmail + '!', '📧'); }
      else { showNotifBar('warning', 'Email failed. OTP shown below.', '📱'); showOtpFallback(otp); }
    }).catch(() => {
      showNotifBar('warning', 'Email failed. OTP shown below.', '📱');
      showOtpFallback(otp);
    });
  } else {
    showNotifBar('warning', 'No email on record. OTP shown below.', '📱');
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
  if (otpHelp) { otpHelp.innerText = '⚠️ Email unavailable — use this code:  ' + otp; otpHelp.style.display = 'block'; }
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
    localStorage.setItem('adminPassword', pwd);
    showNotifBar('success', 'Admin password reset successful!', '🔑');
  } else {
    const emp = employees.find(e => e.id === resetUserId && e.active);
    if (emp) { emp.password = pwd; saveToLocalStorage(); showNotifBar('success', 'Employee password reset successful!', '🔑'); }
  }
  document.getElementById('newpwd-modal').style.display = 'none';
  resetUserId = null;
}
