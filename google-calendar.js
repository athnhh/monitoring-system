/**
 * google-calendar.js — Google Calendar API integration
 *
 * Creates yearly recurring birthday events for employees
 * using a Google service account.
 *
 * Environment variables:
 *   GOOGLE_SERVICE_ACCOUNT_CREDENTIALS — JSON string of the service account key
 *   GOOGLE_CALENDAR_ID                 — Calendar ID (defaults to 'primary')
 *
 * Usage:
 *   const { createBirthdayEvent } = require('./google-calendar');
 *   const eventId = await createBirthdayEvent('John Doe', '1990-05-15');
 */

const { google } = require('googleapis');

// ── Auth helpers ──

function getCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_CREDENTIALS is not set');

  // Try parsing as JSON string first
  try {
    return JSON.parse(raw);
  } catch (_) {
    // Not valid JSON — maybe it's a file path
    const fs = require('fs');
    if (fs.existsSync(raw)) {
      return JSON.parse(fs.readFileSync(raw, 'utf8'));
    }
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_CREDENTIALS must be a valid JSON string or a path to a JSON key file.'
    );
  }
}

let _auth = null;

function getAuth() {
  if (_auth) return _auth;
  const creds = getCredentials();
  _auth = new google.auth.JWT(
    creds.client_email,
    null,
    creds.private_key,
    ['https://www.googleapis.com/auth/calendar'],
    null
  );
  return _auth;
}

// ── Calendar helpers ──

function getCalendarId() {
  return process.env.GOOGLE_CALENDAR_ID || 'primary';
}

// ── Public API ──

/**
 * Creates an all-day, yearly recurring birthday event for an employee.
 *
 * @param {string} name     - Employee name (e.g. "John Doe")
 * @param {string} birthday - Birthday in YYYY-MM-DD format (e.g. "1990-05-15")
 * @param {string} [calendarId] - Optional calendar ID override; defaults to GOOGLE_CALENDAR_ID or 'primary'
 * @returns {Promise<{eventId: string, htmlLink: string}>}
 */
async function createBirthdayEvent(name, birthday, calendarId) {
  const calId = calendarId || getCalendarId();
  const auth = getAuth();
  const calendar = google.calendar({ version: 'v3', auth });

  // Parse the birthday to extract month and day
  const parts = birthday.split('-');
  if (parts.length !== 3) {
    throw new Error(`Invalid birthday format: "${birthday}". Expected YYYY-MM-DD.`);
  }
  const [, month, day] = parts;

  // Use current year for the start date so the yearly recurrence works correctly
  const currentYear = new Date().getFullYear();
  const eventDate = `${currentYear}-${month}-${day}`;

  const event = {
    summary: `🎂 ${name}'s Birthday`,
    description: `Birthday of ${name} — auto-created by Quemahtech EMS`,
    start: {
      date: eventDate,
      timeZone: 'Asia/Kolkata',
    },
    end: {
      date: eventDate,
      timeZone: 'Asia/Kolkata',
    },
    recurrence: ['RRULE:FREQ=YEARLY'],
    transparency: 'transparent', // Shows as "Free" on the calendar
    colorId: '6', // Tangerine / orange color
  };

  const response = await calendar.events.insert({
    calendarId: calId,
    resource: event,
  });

  return {
    eventId: response.data.id,
    htmlLink: response.data.htmlLink,
  };
}

/**
 * Creates birthday events for multiple employees in parallel.
 * Errors for individual employees are caught and logged; does not throw.
 *
 * @param {Array<{name: string, bday: string, id: string}>} employees
 * @param {string} [calendarId]
 * @returns {Promise<{created: number, errors: Array<{id: string, name: string, error: string}>}>}
 */
async function syncAllBirthdays(employees, calendarId) {
  const results = { created: 0, errors: [] };

  if (!employees || employees.length === 0) {
    return results;
  }

  const promises = employees
    .filter(emp => emp.bday && emp.name)
    .map(async (emp) => {
      try {
        await createBirthdayEvent(emp.name, emp.bday, calendarId);
        results.created++;
      } catch (err) {
        results.errors.push({
          id: emp.id || 'unknown',
          name: emp.name,
          error: err.message,
        });
      }
    });

  await Promise.allSettled(promises);
  return results;
}

module.exports = {
  createBirthdayEvent,
  syncAllBirthdays,
};
