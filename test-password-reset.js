const http = require('http');
const readline = require('readline');
const admin = require('firebase-admin');
const path = require('path');

const API = 'http://localhost:3000';
const ADMIN_USERNAME = 'quemahtech';
const ORIGINAL_PASSWORD = 'quemah123';
const NEW_TEST_PASSWORD = 'Test@123New';

function rlQuestion(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(query, ans => { rl.close(); resolve(ans); }));
}

function api(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(path, API);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: opts.method || 'POST',
      headers: { 'Content-Type': 'application/json' }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: { raw: data } });
        }
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(JSON.stringify(opts.body));
    req.end();
  });
}

function log(step, status, detail) {
  const icon = status === 'PASS' ? '\u2705' : status === 'FAIL' ? '\u274C' : '\u27A1\uFE0F';
  const color = status === 'PASS' ? '\x1b[32m' : status === 'FAIL' ? '\x1b[31m' : '\x1b[36m';
  console.log(`  ${icon} ${color}${step}\x1b[0m`);
  if (detail) console.log(`     ${detail}`);
}

async function getFirestore() {
  require('dotenv').config();
  const SA_PATH = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || 'firebase-service-account.json';
  if (admin.apps.length === 0) {
    const sa = require(path.resolve(__dirname, SA_PATH));
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  }
  return admin.firestore();
}

async function getOtpFromFirestore() {
  const db = await getFirestore();
  const snap = await db.collection('passwordResets')
    .where('userId', '==', ADMIN_USERNAME)
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();
  if (!snap.empty) {
    const data = snap.docs[0].data();
    return data.otp || null;
  }
  return null;
}

async function restorePassword() {
  console.log();
  try {
    const db = await getFirestore();
    const ref = db.collection('admins').doc(ADMIN_USERNAME);
    const doc = await ref.get();
    if (doc.exists) {
      await ref.update({ password: ORIGINAL_PASSWORD });
      log('PASSWORD RESTORED', 'PASS', 'Admin password restored to: ' + ORIGINAL_PASSWORD);
    } else {
      log('PASSWORD RESTORED', 'FAIL', 'No admin record found in Firestore');
    }
  } catch (e) {
    log('PASSWORD RESTORED', 'FAIL', 'Error: ' + e.message);
  }
  console.log();
}

async function mainTest(manualOtp) {
  try {
    const health = await api('/api/health', { method: 'GET' });
    if (health.body.status === 'ok') {
      log('SERVER HEALTH', 'PASS', 'DB: ' + health.body.db);
    } else {
      log('SERVER HEALTH', 'FAIL', 'Unexpected response: ' + JSON.stringify(health.body));
      process.exit(1);
    }
  } catch (e) {
    log('SERVER HEALTH', 'FAIL', 'Connection error: ' + e.message);
    console.log('\n  \u26A0\uFE0F  Server not running. Start it with: npm start\n');
    process.exit(1);
  }

  console.log();

  let loginRes;
  try {
    loginRes = await api('/api/auth/login', {
      body: { uid: ADMIN_USERNAME, pwd: ORIGINAL_PASSWORD, role: 'admin' }
    });
    if (loginRes.body.success) {
      log('LOGIN (original password)', 'PASS', 'Admin logged in successfully');
    } else {
      log('LOGIN (original password)', 'FAIL', 'Could not log in with original password');
      process.exit(1);
    }
  } catch (e) {
    log('LOGIN (original password)', 'FAIL', 'Error: ' + e.message);
    process.exit(1);
  }

  console.log();

  let otpRes;
  let otpCode = manualOtp || null;
  try {
    otpRes = await api('/api/auth/forgot-password', {
      body: { uid: ADMIN_USERNAME }
    });
    if (otpRes.body.success) {
      const emailInfo = otpRes.body.email ? 'Email: ' + otpRes.body.email : 'No email (SMTP may not be configured)';
      log('FORGOT PASSWORD', 'PASS', 'OTP generated. ' + emailInfo);
    } else {
      log('FORGOT PASSWORD', 'FAIL', 'Error: ' + otpRes.body.error);
      process.exit(1);
    }
  } catch (e) {
    log('FORGOT PASSWORD', 'FAIL', 'Error: ' + e.message);
    process.exit(1);
  }

  if (!otpCode) {
    try {
      otpCode = await getOtpFromFirestore();
      if (otpCode) {
        log('RETRIEVE OTP', 'PASS', 'OTP from Firestore: ' + otpCode);
      }
    } catch (e) {
      log('RETRIEVE OTP', 'FAIL', 'Firestore query failed: ' + e.message);
    }
  }

  if (!otpCode) {
    console.log();
    log('OTP REQUIRED', '\u27A1\uFE0F', 'Could not auto-retrieve OTP.');
    console.log('  \u2022 If SMTP is configured, check atharvashishn@gmail.com inbox');
    console.log('  \u2022 Or run: node test-password-reset.js --otp <6-digit-code>');
    console.log();
    const manual = await rlQuestion('  Paste the 6-digit OTP code here: ');
    otpCode = manual.trim();
    if (!otpCode || otpCode.length !== 6) {
      log('OTP INPUT', 'FAIL', 'Invalid OTP');
      process.exit(1);
    }
  }

  console.log();

  let verifyRes;
  try {
    verifyRes = await api('/api/auth/verify-otp', {
      body: { otp: otpCode, userId: ADMIN_USERNAME }
    });
    if (verifyRes.body.success) {
      log('VERIFY OTP', 'PASS', 'OTP verified successfully');
    } else {
      log('VERIFY OTP', 'FAIL', 'Error: ' + verifyRes.body.error);
      process.exit(1);
    }
  } catch (e) {
    log('VERIFY OTP', 'FAIL', 'Error: ' + e.message);
    process.exit(1);
  }

  console.log();

  let resetRes;
  try {
    resetRes = await api('/api/auth/reset-password', {
      body: { newPassword: NEW_TEST_PASSWORD }
    });
    if (resetRes.body.success) {
      log('RESET PASSWORD', 'PASS', 'Password reset to: ' + NEW_TEST_PASSWORD);
    } else {
      log('RESET PASSWORD', 'FAIL', 'Error: ' + resetRes.body.error);
      process.exit(1);
    }
  } catch (e) {
    log('RESET PASSWORD', 'FAIL', 'Error: ' + e.message);
    process.exit(1);
  }

  console.log();

  let newLoginRes;
  try {
    newLoginRes = await api('/api/auth/login', {
      body: { uid: ADMIN_USERNAME, pwd: NEW_TEST_PASSWORD, role: 'admin' }
    });
    if (newLoginRes.body.success) {
      log('LOGIN (new password)', 'PASS', 'Successfully logged in with the new password!');
    } else {
      log('LOGIN (new password)', 'FAIL', 'Could not log in with new password');
      process.exit(1);
    }
  } catch (e) {
    log('LOGIN (new password)', 'FAIL', 'Error: ' + e.message);
    process.exit(1);
  }

  console.log();

  let oldLoginRes;
  try {
    oldLoginRes = await api('/api/auth/login', {
      body: { uid: ADMIN_USERNAME, pwd: ORIGINAL_PASSWORD, role: 'admin' }
    });
    if (!oldLoginRes.body.success) {
      log('OLD PASSWORD REJECTED', 'PASS', 'Original password correctly rejected after reset');
    } else {
      log('OLD PASSWORD REJECTED', 'FAIL', 'Old password still works');
    }
  } catch (e) {
    log('OLD PASSWORD REJECTED', 'FAIL', 'Error: ' + e.message);
  }

  console.log();
  console.log('  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  console.log('  \uD83C\uDF89  Password reset flow test PASSED!');
  console.log();

  const restore = await rlQuestion('  Restore password to "' + ORIGINAL_PASSWORD + '"? (Y/n): ');
  if (restore.toLowerCase() !== 'n') {
    await restorePassword();
  } else {
    console.log('\n  OK. Admin password is now: ' + NEW_TEST_PASSWORD);
    console.log('  Run `node test-password-reset.js --restore` anytime to reset it back.\n');
  }
}

const args = process.argv.slice(2);

if (args.includes('--restore')) {
  restorePassword().catch(e => console.error('Error:', e));
} else {
  const otpFlagIdx = args.indexOf('--otp');
  const manualOtp = otpFlagIdx >= 0 && args[otpFlagIdx + 1] ? args[otpFlagIdx + 1] : null;

  console.log('\n');
  console.log('  \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557');
  console.log('  \u2551   Password Reset Flow \u2014 End-to-End Test         \u2551');
  console.log('  \u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d');
  console.log();

  mainTest(manualOtp).catch(e => {
    console.error('\n  \u274C  Test crashed:', e.message);
    console.log();
  });
}
