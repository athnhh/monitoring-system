/**
 * server.js — Quemahtech EMS HTTP Server
 *
 * Serves the static frontend AND handles calendar API routes.
 * Run with:
 *   GOOGLE_SERVICE_ACCOUNT_CREDENTIALS='{...}' GOOGLE_CALENDAR_ID=primary node server.js
 *
 * Or via start.bat (reads .env if you install dotenv).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// ── Load .env if available (optional; dotenv is a dev dependency) ──
try {
  require('dotenv').config();
} catch (_) {
  // dotenv not installed — rely on shell env vars
}

// ── Import calendar module (lazy — errors handled per route) ──
let calendar = null;
function getCalendar() {
  if (!calendar) {
    calendar = require('./google-calendar');
  }
  return calendar;
}

// ── MIME types for static files ──

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.webp': 'image/webp',
  '.csv':  'text/csv',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const ROOT = __dirname;

// ── Helpers ──

function sendJSON(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve({}); }
    });
  });
}

// ── Route handlers ──

async function handleCalendarConfig(req, res, method) {
  if (method === 'GET') {
    const hasCreds = !!process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS;
    sendJSON(res, 200, {
      enabled: hasCreds,
      calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
      serviceAccountPath: hasCreds ? '(configured via env)' : '—',
    });
    return;
  }

  if (method === 'POST') {
    const body = await parseBody(req);
    // Config is stored in env vars — server restart required to change
    sendJSON(res, 200, {
      success: true,
      message: 'Calendar configuration is managed via environment variables (GOOGLE_SERVICE_ACCOUNT_CREDENTIALS, GOOGLE_CALENDAR_ID). Restart the server to apply changes.',
    });
    return;
  }

  sendJSON(res, 405, { error: 'Method not allowed' });
}

async function handleCreateBirthday(req, res) {
  const body = await parseBody(req);

  if (!body.name || !body.birthday) {
    sendJSON(res, 400, { error: 'Missing required fields: name, birthday' });
    return;
  }

  try {
    const cal = getCalendar();
    const result = await cal.createBirthdayEvent(
      body.name,
      body.birthday,
      body.calendarId || undefined
    );
    sendJSON(res, 200, {
      success: true,
      eventId: result.eventId,
      htmlLink: result.htmlLink,
    });
  } catch (err) {
    console.error('[Calendar] Failed to create birthday event:', err.message);
    sendJSON(res, 500, {
      success: false,
      error: err.message,
    });
  }
}

async function handleSyncBirthdays(req, res) {
  try {
    const cal = getCalendar();
    const body = await parseBody(req);
    const employees = body.employees || [];

    if (employees.length === 0) {
      sendJSON(res, 200, { success: true, created: 0, errors: [], message: 'No employees to sync.' });
      return;
    }

    const result = await cal.syncAllBirthdays(employees, body.calendarId);
    sendJSON(res, 200, {
      success: true,
      created: result.created,
      errors: result.errors,
      message: `Created ${result.created} birthday event(s).${result.errors.length ? ' ' + result.errors.length + ' error(s).' : ''}`,
    });
  } catch (err) {
    console.error('[Calendar] Sync all birthdays failed:', err.message);
    sendJSON(res, 500, { success: false, error: err.message });
  }
}

// ── Static file serving ──

function serveStaticFile(res, urlPath) {
  // Default to index.html
  let filePath = urlPath === '/' ? '/index.html' : urlPath;

  // Strip query strings
  filePath = filePath.split('?')[0];

  const fullPath = path.join(ROOT, filePath);

  // Security: ensure we don't serve files outside the project root
  if (!fullPath.startsWith(ROOT)) {
    sendJSON(res, 403, { error: 'Forbidden' });
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      // SPA fallback — serve index.html for unknown routes
      fs.readFile(path.join(ROOT, 'index.html'), (err2, indexData) => {
        if (err2) {
          sendJSON(res, 404, { error: 'Not found' });
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(indexData);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

// ── Router ──

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const method = req.method;

  // CORS headers for API routes
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // ── API Routes ──
    if (pathname === '/api/calendar-config') {
      await handleCalendarConfig(req, res, method);
      return;
    }

    if (pathname === '/api/calendar/birthday' && method === 'POST') {
      await handleCreateBirthday(req, res);
      return;
    }

    if (pathname === '/api/calendar/sync-birthdays' && method === 'POST') {
      await handleSyncBirthdays(req, res);
      return;
    }

    // ── Static files (including index.html SPA fallback) ──
    serveStaticFile(res, pathname);
  } catch (err) {
    console.error('[Server] Unhandled error:', err.message);
    sendJSON(res, 500, { error: 'Internal server error' });
  }
}

// ── Start ──

const PORT = parseInt(process.env.PORT, 10) || 3000;

const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   Quemahtech EMS — Calendar Server          ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║   http://localhost:${PORT}                     ║`);
  console.log(`║   Port: ${PORT}                               ║`);
  const hasCreds = !!process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS;
  console.log(`║   Calendar: ${hasCreds ? '✅ Configured' : '❌ Not configured (set GOOGLE_SERVICE_ACCOUNT_CREDENTIALS)'}  ║`);
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
});
