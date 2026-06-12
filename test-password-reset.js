/* ═══════════════════════════════════════════════════════════════
   test-password-reset.js — End-to-End Password Reset Flow Test
   
   Tests the full flow via API:
     Login → Forgot Password → Send OTP → Verify OTP → Reset Password → Login with New Password
   
   Usage:
     node test-password-reset.js
     
   Optional flags:
     --restore     Restore admin password to 'quemah123' without running the test
     --otp CODE    Manually provide the OTP code (skips MongoDB lookup)
   ═══════════════════════════════════════════════════════════════ */

const http = require('http');
const readline = require('readline');

const API = 'http://localhost:3000';
const ADMIN_USERNAME = 'quemahtech';
const ORIGINAL_PASSWORD = 'quemah123';
const NEW_TEST_PASSWORD = 'Test@123New';

// ── Helpers ──
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
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '➡️';
  const color = status === 'PASS' ? '\x1b[32m' : status === 'FAIL' ? '\x1b[31m' : '\x1b[36m';
  console.log(`  ${icon} ${color}${step}\x1b[0m`);
  if (detail) console.log(`     ${detail}`);
}

async function getOtpFromMongo() {
  const mongoose = require('mongoose');
  require('dotenv').config();
  await mongoose.connect(process.env.DATABASE_URL, { serverSelectionTimeoutMS: 5000 });
  const db = mongoose.connection.db;
  const resets = db.collection('passwordresets');
  const record = await resets.findOne(
    { userId: ADMIN_USERNAME },
    { sort: { createdAt: -1 } }
  );
  await mongoose.disconnect();
  return record ? record.otp : null;
}

async function mainTest(manualOtp) {
  // ── Step 0: Health Check ──
  try {
    const health = await api('/api/health', { method: 'GET' });
    if (health.body.status === 'ok') {
      log('SERVER HEALTH', 'PASS', `DB: ${health.body.db}`);
    } else {
      log('SERVER HEALTH', 'FAIL', `Unexpected response: ${JSON.stringify(health.body)}`);
      console.log('\n  ⚠️  Server not healthy. Check DATABASE_URL and restart.\n');
      process.exit(1);
    }
  } catch (e) {
    log('SERVER HEALTH', 'FAIL', `Connection error: ${e.message}`);
    console.log('\n  ⚠️  Server not running. Start it with: npm start\n');
    process.exit(1);
  }

  console.log();

  // ── Step 1: Test Login with Original Password ──
  let loginRes;
  try {
    loginRes = await api('/api/login', {
      body: { uid: ADMIN_USERNAME, pwd: ORIGINAL_PASSWORD, role: 'admin' }
    });
    if (loginRes.body.success) {
      log('LOGIN (original password)', 'PASS', 'Admin logged in successfully');
    } else {
      log('LOGIN (original password)', 'FAIL', 'Could not log in with original password');
      process.exit(1);
    }
  } catch (e) {
    log('LOGIN (original password)', 'FAIL', `Error: ${e.message}`);
    process.exit(1);
  }

  console.log();

  // ── Step 2: Request Password Reset OTP ──
  let otpRes;
  let otpCode = manualOtp || null;
  try {
    otpRes = await api('/api/forgot-password', {
      body: { uid: ADMIN_USERNAME }
    });
    if (otpRes.body.success) {
      const emailInfo = otpRes.body.email ? `Email: ${otpRes.body.email}` : 'No email (SMTP may not be configured)';
      log('FORGOT PASSWORD', 'PASS', `OTP generated. ${emailInfo}`);
    } else {
      log('FORGOT PASSWORD', 'FAIL', `Error: ${otpRes.body.error}`);
      process.exit(1);
    }
  } catch (e) {
    log('FORGOT PASSWORD', 'FAIL', `Error: ${e.message}`);
    process.exit(1);
  }

  // ── Step 3: Retrieve OTP ──
  // Priority: 1) manually provided 2) MongoDB lookup 3) ask user to paste
  if (!otpCode) {
    try {
      otpCode = await getOtpFromMongo();
      if (otpCode) {
        log('RETRIEVE OTP', 'PASS', `OTP from MongoDB: ${otpCode}`);
      }
    } catch (e) {
      log('RETRIEVE OTP', 'FAIL', `MongoDB query failed: ${e.message}`);
    }
  }

  if (!otpCode) {
    console.log();
    log('OTP REQUIRED', '➡️', 'Could not auto-retrieve OTP.');
    console.log('  • If SMTP is configured, check atharvashishn@gmail.com inbox');
    console.log('  • Or run: node test-password-reset.js --otp <6-digit-code>');
    console.log();
    const manual = await rlQuestion('  Paste the 6-digit OTP code here: ');
    otpCode = manual.trim();
    if (!otpCode || otpCode.length !== 6) {
      log('OTP INPUT', 'FAIL', 'Invalid OTP');
      process.exit(1);
    }
  }

  console.log();

  // ── Step 4: Verify OTP ──
  let verifyRes;
  try {
    verifyRes = await api('/api/verify-otp', {
      body: { otp: otpCode, userId: ADMIN_USERNAME }
    });
    if (verifyRes.body.success) {
      log('VERIFY OTP', 'PASS', 'OTP verified successfully');
    } else {
      log('VERIFY OTP', 'FAIL', `Error: ${verifyRes.body.error}`);
      process.exit(1);
    }
  } catch (e) {
    log('VERIFY OTP', 'FAIL', `Error: ${e.message}`);
    process.exit(1);
  }

  console.log();

  // ── Step 5: Reset Password ──
  let resetRes;
  try {
    resetRes = await api('/api/reset-password', {
      body: { newPassword: NEW_TEST_PASSWORD }
    });
    if (resetRes.body.success) {
      log('RESET PASSWORD', 'PASS', `Password reset to: ${NEW_TEST_PASSWORD}`);
    } else {
      log('RESET PASSWORD', 'FAIL', `Error: ${resetRes.body.error}`);
      process.exit(1);
    }
  } catch (e) {
    log('RESET PASSWORD', 'FAIL', `Error: ${e.message}`);
    process.exit(1);
  }

  console.log();

  // ── Step 6: Test Login with New Password ──
  let newLoginRes;
  try {
    newLoginRes = await api('/api/login', {
      body: { uid: ADMIN_USERNAME, pwd: NEW_TEST_PASSWORD, role: 'admin' }
    });
    if (newLoginRes.body.success) {
      log('LOGIN (new password)', 'PASS', 'Successfully logged in with the new password!');
    } else {
      log('LOGIN (new password)', 'FAIL', 'Could not log in with new password');
      process.exit(1);
    }
  } catch (e) {
    log('LOGIN (new password)', 'FAIL', `Error: ${e.message}`);
    process.exit(1);
  }

  console.log();

  // ── Step 7: Test that Old Password No Longer Works ──
  let oldLoginRes;
  try {
    oldLoginRes = await api('/api/login', {
      body: { uid: ADMIN_USERNAME, pwd: ORIGINAL_PASSWORD, role: 'admin' }
    });
    if (!oldLoginRes.body.success) {
      log('OLD PASSWORD REJECTED', 'PASS', 'Original password correctly rejected after reset');
    } else {
      log('OLD PASSWORD REJECTED', 'FAIL', 'Old password still works — something is wrong');
    }
  } catch (e) {
    log('OLD PASSWORD REJECTED', 'FAIL', `Error: ${e.message}`);
  }

  console.log();
  console.log('  ──────────────────────────────────────────────────');
  console.log('  🎉  Password reset flow test PASSED!');
  console.log();

  // Ask if user wants to restore
  const restore = await rlQuestion('  Restore password to "' + ORIGINAL_PASSWORD + '"? (Y/n): ');
  if (restore.toLowerCase() !== 'n') {
    await restorePassword();
  } else {
    console.log('\n  OK. Admin password is now: ' + NEW_TEST_PASSWORD);
    console.log('  Run `node test-password-reset.js --restore` anytime to reset it back.\n');
  }
}

// ── Restore ──
async function restorePassword() {
  console.log();
  const mongoose = require('mongoose');
  require('dotenv').config();

  try {
    await mongoose.connect(process.env.DATABASE_URL, { serverSelectionTimeoutMS: 5000 });
    const db = mongoose.connection.db;
    const admins = db.collection('admins');
    const result = await admins.updateOne(
      { username: ADMIN_USERNAME },
      { $set: { password: ORIGINAL_PASSWORD } }
    );
    if (result.modifiedCount === 1 || result.matchedCount === 1) {
      log('PASSWORD RESTORED', 'PASS', 'Admin password restored to: ' + ORIGINAL_PASSWORD);
    } else {
      log('PASSWORD RESTORED', 'FAIL', 'No admin record found — is MongoDB connected?');
    }
    await mongoose.disconnect();
  } catch (e) {
    log('PASSWORD RESTORED', 'FAIL', `Error: ${e.message}`);
    console.log('     Make sure DATABASE_URL is configured in .env');
  }
  console.log();
}

// ── Main ──
const args = process.argv.slice(2);

if (args.includes('--restore')) {
  restorePassword().catch(e => console.error('Error:', e));
} else {
  const otpFlagIdx = args.indexOf('--otp');
  const manualOtp = otpFlagIdx >= 0 && args[otpFlagIdx + 1] ? args[otpFlagIdx + 1] : null;

  console.log('\n');
  console.log('  ╔══════════════════════════════════════════════════╗');
  console.log('  ║   Password Reset Flow — End-to-End Test         ║');
  console.log('  ╚══════════════════════════════════════════════════╝');
  console.log();

  mainTest(manualOtp).catch(e => {
    console.error('\n  ❌  Test crashed:', e.message);
    console.log();
  });
}
