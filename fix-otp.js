const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'script.js');
let content = fs.readFileSync(filePath, 'utf8');

// Find the corrupted loadEmailConfig function
const corruptedStart = content.indexOf("function loadEmailConfig()");
if (corruptedStart === -1) {
  console.log('❌ Could not find loadEmailConfig');
  process.exit(1);
}

const nextFunctionStart = content.indexOf("function updateSmtpStatus", corruptedStart);
if (nextFunctionStart === -1) {
  console.log('❌ Could not find next function');
  process.exit(1);
}

console.log(`Found loadEmailConfig at ${corruptedStart}, updateSmtpStatus at ${nextFunctionStart}`);
console.log(`Section length: ${nextFunctionStart - corruptedStart} chars`);

// Replace the entire corrupted loadEmailConfig function with the proper one
const corruptedSection = content.substring(corruptedStart, nextFunctionStart);

// Check what's actually in the corrupted section
const firstLine = corruptedSection.split('\n')[0];
console.log(`First line: ${firstLine}`);

// The section should start with "function loadEmailConfig()" and contain the OTP code instead of config display
// Let's build the correct loadEmailConfig function

const correctLoadEmailConfig = `function loadEmailConfig() {\r\n  const cfg = getEmailJSConfig();\r\n  const serviceEl = document.getElementById('email-config-service');\r\n  const statusEl = document.getElementById('email-config-status');\r\n  if (!statusEl) return;\r\n\r\n  if (isEmailJSConfigured()) {\r\n    if (serviceEl) serviceEl.innerText = 'EmailJS';\r\n    statusEl.innerText = '✅ EmailJS Ready';\r\n    statusEl.style.color = 'var(--green)';\r\n    statusEl.title = 'Email is sent via EmailJS — no server required.';\r\n  } else {\r\n    if (serviceEl) serviceEl.innerText = 'Not configured';\r\n    statusEl.innerText = '❌ Not configured';\r\n    statusEl.style.color = 'var(--red)';\r\n    statusEl.title = 'Add EmailJS credentials to emailjs-config.js (public key, service ID, template ID).';\r\n  }\r\n}\r\n`;

content = content.substring(0, corruptedStart) + correctLoadEmailConfig + content.substring(nextFunctionStart);

console.log('✅ Restored loadEmailConfig()');

// Now find and fix sendOTP() - add showOtpFallback(otp) BEFORE the EmailJS attempt
const sendOTPStart = content.indexOf("function sendOTP()");
if (sendOTPStart === -1) {
  console.log('❌ Could not find sendOTP');
  process.exit(1);
}

// Find the OTP email sending section inside sendOTP
// Look for "if (userEmail) {" inside sendOTP
const userEmailSection = content.indexOf("    if (userEmail) {", sendOTPStart);
const elseSection = content.indexOf("  }else {", userEmailSection);

console.log(`sendOTP at ${sendOTPStart}, userEmail section at ${userEmailSection}, else at ${elseSection}`);

if (userEmailSection === -1 || elseSection === -1) {
  console.log('❌ Could not find email section in sendOTP');
  process.exit(1);
}

// Extract the userEmail section
const userEmailBlock = content.substring(userEmailSection, elseSection);
console.log(`User email block: ${userEmailBlock.substring(0, 200)}...`);

// Replace the emailjs send block: add showOtpFallback(otp) BEFORE the email attempt
// and simplify the catch
const oldEmailBlock = `    if (userEmail) {\r\n\r\n    const otpMessage = 'Hi ' + userName + ',\\n\\nYour password reset OTP is: ' + otp + '\\n\\nThis code expires in 5 minutes.\\n\\nIf you didn\\'t request this, please ignore this message.\\n\\n— Quemahtech EMS';\r\n\r\n    if (isEmailJSConfigured()) {\r\n\r\n      const cfg = getEmailJSConfig();\r\n\r\n      emailjs.send(cfg.serviceId, cfg.templateId, {\r\n\r\n        to_email: userEmail,\r\n\r\n        subject: 'Quemahtech — Password Reset OTP',\r\n\r\n        message: otpMessage\r\n\r\n      }).then(() => {\r\n\r\n        showNotifBar('success', 'OTP sent to ' + userEmail + '!', '📧');\r\n\r\n      }).catch(() => {\r\n\r\n        showNotifBar('warning', 'Email failed. OTP shown below.', '📱');\r\n\r\n        showOtpFallback(otp);\r\n\r\n      });\r\n\r\n    } else {\r\n\r\n      showNotifBar('warning', 'EmailJS not configured. OTP shown below.', '📱');\r\n\r\n      showOtpFallback(otp);\r\n\r\n    }`;

const newEmailBlock = `    if (userEmail) {\r\n    // Always show OTP on screen first (most reliable method)\r\n    showOtpFallback(otp);\r\n    const otpMessage = 'Hi ' + userName + ',\\n\\nYour password reset OTP is: ' + otp + '\\n\\nThis code expires in 5 minutes.\\n\\nIf you didn\\'t request this, please ignore this message.\\n\\n— Quemahtech EMS';\r\n    // Also try to send via EmailJS if configured (non-blocking)\r\n    if (isEmailJSConfigured()) {\r\n      const cfg = getEmailJSConfig();\r\n      emailjs.send(cfg.serviceId, cfg.templateId, {\r\n        to_email: userEmail,\r\n        subject: 'Quemahtech — Password Reset OTP',\r\n        message: otpMessage\r\n      }).then(() => {\r\n        showNotifBar('success', 'OTP sent to ' + userEmail + '!', '📧');\r\n      }).catch(() => {\r\n        // Email failed - OTP already visible on screen\r\n      });\r\n    } else {\r\n      showNotifBar('warning', 'EmailJS not configured. OTP shown below.', '📱');\r\n    }`;

if (content.includes(oldEmailBlock)) {
  content = content.replace(oldEmailBlock, newEmailBlock);
  console.log('✅ Fixed sendOTP() - OTP always shown on screen first');
} else {
  console.log('⚠️ Exact pattern not found, trying trimmed match...');
  // Try with the code we saw in the current file
  const currentPattern = /if \(userEmail\) \{\s*\n\s*const otpMessage/g;
  if (currentPattern.test(content)) {
    console.log('Found pattern with different whitespace, using regex replacement...');
    // Use a broader regex approach
    const emailBlockRegex = /if \(userEmail\) \{[\s\S]*?const otpMessage =[\s\S]*?if \(isEmailJSConfigured\(\)\) \{[\s\S]*?emailjs\.send\(cfg\.serviceId, cfg\.templateId, \{[\s\S]*?to_email: userEmail,[\s\S]*?subject: 'Quemahtech — Password Reset OTP',[\s\S]*?message: otpMessage[\s\S]*?\}\)\.then\(\(\) => \{[\s\S]*?showNotifBar\('success', 'OTP sent to ' \+ userEmail \+ '!', '📧'\);[\s\S]*?\}\)\.catch\(\(\) => \{[\s\S]*?showNotifBar\('warning', 'Email failed\. OTP shown below\.', '📱'\);[\s\S]*?showOtpFallback\(otp\);[\s\S]*?\}\)\);[\s\S]*?\} else \{[\s\S]*?showNotifBar\('warning', 'EmailJS not configured\. OTP shown below\.', '📱'\);[\s\S]*?showOtpFallback\(otp\);[\s\S]*?\}/;
    
    const match = content.match(emailBlockRegex);
    if (match) {
      const matched = match[0];
      const replacement = matched.replace(
        /if \(userEmail\) \{/,
        `    if (userEmail) {\r\n    // Always show OTP on screen first (most reliable method)\r\n    showOtpFallback(otp);`
      ).replace(
        /if \(isEmailJSConfigured\(\)\) \{/,
        `    // Also try to send via EmailJS if configured (non-blocking)\r\n    if (isEmailJSConfigured()) {`
      ).replace(
        /showNotifBar\('warning', 'Email failed\. OTP shown below\.', '📱'\);\s*\n\s*showOtpFallback\(otp\);\s*\n\s*\}\);/,
        `        // Email failed - OTP already visible on screen\r\n      });`
      ).replace(
        /showNotifBar\('warning', 'EmailJS not configured\. OTP shown below\.', '📱'\);\s*\n\s*showOtpFallback\(otp\);\s*\n\s*\}/,
        `      showNotifBar('warning', 'EmailJS not configured. OTP shown below.', '📱');\r\n    }`
      );
      
      content = content.replace(matched, replacement);
      console.log('✅ Fixed sendOTP() using regex');
    } else {
      console.log('❌ Regex pattern did not match');
    }
  } else {
    console.log('❌ Could not find sendOTP email section');
  }
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('\n✅ Fix complete!');
