/**
 * Google Calendar Integration Service
 * 
 * Manages Google Calendar API integration for creating birthday events
 * and other calendar events when employees are added or updated.
 * 
 * Setup:
 * 1. Go to https://console.cloud.google.com
 * 2. Create a project (or select existing)
 * 3. Enable "Google Calendar API"
 * 4. Go to "Credentials" → "Create Credentials" → "Service Account"
 * 5. Name it e.g. "employee-management-calendar"
 * 6. After creation, go to "Keys" tab → "Add Key" → "JSON"
 * 7. Download the JSON key file and save it in this project directory
 * 8. Share your Google Calendar with the service account email
 *    (found in the JSON file under "client_email")
 * 9. Set the Calendar ID in the settings or use "primary" for your main calendar
 */

const fs = require('fs');
const path = require('path');

let googleapis = null;
try {
  googleapis = require('googleapis');
} catch (e) {
  console.warn('googleapis package not installed. Run: npm install googleapis');
}

const CALENDAR_CONFIG_PATH = path.join(__dirname, 'calendar-config.json');

// ── Calendar Config Management ──

function getCalendarConfig() {
  try {
    if (fs.existsSync(CALENDAR_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CALENDAR_CONFIG_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('Calendar config read error:', e.message);
  }
  return { serviceAccountPath: '', calendarId: 'primary', enabled: false };
}

function saveCalendarConfig(config) {
  try {
    fs.writeFileSync(CALENDAR_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Calendar config save error:', e.message);
    return false;
  }
}

// ── Auth ──

let authClient = null;

function getAuthClient() {
  if (authClient) return authClient;
  if (!googleapis) { console.warn('googleapis package not available'); return null; }

  // Vercel / serverless: service account file won't be on disk
  if (process.env.VERCEL) {
    console.warn('Google Calendar API not available on Vercel (no filesystem access to service account key)');
    return null;
  }

  const cfg = getCalendarConfig();
  if (!cfg.enabled || !cfg.serviceAccountPath) return null;

  const keyPath = path.resolve(__dirname, cfg.serviceAccountPath);
  if (!fs.existsSync(keyPath)) {
    console.error('Service account key file not found:', keyPath);
    return null;
  }

  try {
    const key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    authClient = new googleapis.google.auth.JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: ['https://www.googleapis.com/auth/calendar']
    });
    return authClient;
  } catch (e) {
    console.error('Failed to create auth client:', e.message);
    return null;
  }
}

// ── Create Birthday Event ──

/**
 * Creates a yearly recurring birthday event in the configured Google Calendar.
 * @param {Object} employee - { id, name, bday (YYYY-MM-DD), dept, designation }
 * @returns {Promise<Object>} { success, eventId?, error? }
 */
async function createBirthdayEvent(employee) {
  if (!employee || !employee.bday || !employee.name) {
    return { success: false, error: 'Missing employee name or birthday' };
  }

  const auth = getAuthClient();
  if (!auth) {
    const reason = !googleapis ? 'googleapis package not installed (run: npm install googleapis)' : 'Calendar not configured. Set up service account in Settings > Google Calendar Integration.';
    return { success: false, error: reason };
  }

  const cfg = getCalendarConfig();
  const calendarId = cfg.calendarId || 'primary';
  const calendar = googleapis.google.calendar({ version: 'v3', auth });

  // Parse birthday date
  const bdayParts = employee.bday.split('-');
  if (bdayParts.length !== 3) {
    return { success: false, error: 'Invalid birthday format. Expected YYYY-MM-DD.' };
  }

  const month = parseInt(bdayParts[1], 10);
  const day = parseInt(bdayParts[2], 10);
  const year = parseInt(bdayParts[0], 10);

  // Create event: all-day, yearly recurring, starting this year
  const startDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const event = {
    summary: `🎂 ${employee.name}'s Birthday`,
    description: `Birthday of ${employee.name}\nDepartment: ${employee.dept || '—'}\nDesignation: ${employee.designation || '—'}\nEmployee ID: ${employee.id || '—'}\n\nAuto-created by Quemahtech Employee Management System`,
    start: {
      date: startDate,
      timeZone: 'Asia/Kolkata'
    },
    end: {
      date: startDate,
      timeZone: 'Asia/Kolkata'
    },
    recurrence: [
      `RRULE:FREQ=YEARLY;BYMONTH=${month};BYMONTHDAY=${day}`
    ],
    transparency: 'transparent', // Show as "Free" (not blocking time)
    colorId: '2', // Green (Google Calendar color)
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 1440 } // 1 day before
      ]
    }
  };

  try {
    const response = await calendar.events.insert({
      calendarId,
      requestBody: event
    });

    console.log(`Birthday event created for ${employee.name}: ${response.data.htmlLink}`);
    return {
      success: true,
      eventId: response.data.id,
      eventLink: response.data.htmlLink
    };
  } catch (e) {
    console.error(`Failed to create birthday event for ${employee.name}:`, e.message);
    return {
      success: false,
      error: e.message
    };
  }
}

/**
 * Deletes a birthday event by its event ID.
 * @param {string} eventId - Google Calendar event ID
 * @returns {Promise<Object>} { success, error? }
 */
async function deleteBirthdayEvent(eventId) {
  if (!eventId) return { success: false, error: 'No event ID provided' };

  const auth = getAuthClient();
  if (!auth) return { success: false, error: 'Calendar not configured or googleapis not installed' };

  const cfg = getCalendarConfig();
  const calendarId = cfg.calendarId || 'primary';
  const calendar = googleapis.google.calendar({ version: 'v3', auth });

  try {
    await calendar.events.delete({ calendarId, eventId });
    return { success: true };
  } catch (e) {
    console.error(`Failed to delete event ${eventId}:`, e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Lists all birthday events in the calendar (for verification/admin).
 * @returns {Promise<Array>} events
 */
async function listBirthdayEvents() {
  const auth = getAuthClient();
  if (!auth) return [];

  const cfg = getCalendarConfig();
  const calendarId = cfg.calendarId || 'primary';
  const calendar = googleapis.google.calendar({ version: 'v3', auth });

  try {
    const response = await calendar.events.list({
      calendarId,
      timeMin: new Date().toISOString(),
      maxResults: 100,
      singleEvents: false,
      orderBy: 'startTime'
    });
    return response.data.items || [];
  } catch (e) {
    console.error('Failed to list calendar events:', e.message);
    return [];
  }
}

module.exports = {
  getCalendarConfig,
  saveCalendarConfig,
  createBirthdayEvent,
  deleteBirthdayEvent,
  listBirthdayEvents,
  getAuthClient
};
