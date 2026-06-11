# Quemahtech EMS — Firebase Firestore Setup (GitHub Pages)

This app stores all employee, attendance, and notification data in **Firebase Firestore** so it persists across refreshes, devices, and browsers when deployed as static files (GitHub Pages).

## Architecture

| File | Role |
|------|------|
| `index.html` | Single-page app shell |
| `shared.css`, `login.css`, `admin.css`, `employee.css` | Styles |
| `firebase-config.js` | Your Firebase Web App credentials |
| `firebase.js` | Firestore load/save + realtime listener |
| `shared.js` | Global state, session restore, persistence |
| `login.js` | Authentication |
| `admin.js` / `employee.js` | Dashboard logic |
| `employees.json` | Optional one-time seed data |

## 1. Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/) → **Add project**.
2. **Build** → **Add app** → **Web** (`</>`) → register app.
3. Copy the `firebaseConfig` object into `firebase-config.js` (replace all `YOUR_*` placeholders).

## 2. Enable Firestore

1. **Build** → **Firestore Database** → **Create database**.
2. Choose a region (e.g. `asia-south1` for India).
3. Start in **production mode** (you will set rules below).

## 3. Firestore Security Rules

For an internal team tool (custom app login, not Firebase Auth), use open rules **only if the Firestore data is not sensitive** or restrict by IP/VPN. For production, migrate to Firebase Authentication.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /ems/{document=**} {
      allow read, write: if true;
    }
  }
}
```

Publish rules in the Firebase Console → Firestore → **Rules** tab.

## 4. Database Schema

Single document at path `ems/state`:

| Field | Type | Description |
|-------|------|-------------|
| `adminPassword` | string | Admin login password (username: `quemahtech`) |
| `employees` | array | Active employee records |
| `archivedEmployees` | array | Terminated/archived employees |
| `attendanceRecords` | array | All punch-in/out history |
| `leaveRequests` | array | Leave applications |
| `announcements` | array | Admin broadcasts |
| `adminNotifications` | array | Admin notification feed |
| `empNotifications` | array | Employee notification feed |
| `departments` | array | Department name list |
| `updatedAt` | timestamp | Server timestamp for sync |

### Employee object

```json
{
  "id": "EMP001",
  "name": "Rahul Sharma",
  "dept": "Engineering",
  "email": "rahul@example.com",
  "phone": "+91 9876543210",
  "bday": "1990-05-15",
  "joining": "2023-01-10",
  "designation": "Developer",
  "cl": 7.5,
  "sl": 3.0,
  "ul": 0,
  "active": true,
  "password": "emp123"
}
```

### Attendance record

```json
{
  "id": "EMP001",
  "name": "Rahul Sharma",
  "dept": "Engineering",
  "date": "2026-06-11",
  "in": "09:05",
  "out": "18:00",
  "hours": 8.92,
  "status": "Present",
  "notes": ""
}
```

## 5. Authentication Flow

| Role | Username | Password source |
|------|----------|-----------------|
| Admin | `quemahtech` | `adminPassword` in Firestore |
| Employee | Employee ID (e.g. `EMP001`) | `password` on employee record |

**Session persistence** (survives refresh):

- `localStorage`: `loggedIn`, `userRole`, `userId`, `rememberMe`, `adminLastTab`, `empLastTab`
- `sessionStorage`: same keys when "Remember me" is unchecked
- On startup, `restoreSession()` loads the correct dashboard and last tab.

**Logout** clears all session keys.

## 6. Deploy to GitHub Pages

1. Commit `firebase-config.js` with your Web App config (API keys are safe to expose; protect with Firestore rules).
2. Push to GitHub → **Settings** → **Pages** → deploy from `main` branch, root folder.
3. Open your Pages URL — data syncs via Firestore in real time across devices.

Optional: run `node build.js` and publish the `dist/` folder instead.

## 7. Optional: Seed from `employees.json`

If Firestore is empty on first load, the app tries to load `employees.json` from the same origin. Copy structure from `data.json` or create:

```json
{
  "adminPassword": "quemah123",
  "employees": [ ... ],
  "departments": ["Engineering", "HR", "IT"]
}
```

First save pushes data to Firestore.

## 8. Local development (with Node server)

For email, Google Calendar, and file backup:

```bash
npm install
node server.js
```

Open `http://localhost:3000`. The server uses `data.json` when Firestore client is not configured; with `firebase-config.js` filled in, the browser uses Firestore directly.

## 9. Multi-device sync

- All writes call `saveToLocalStorage()` → debounced Firestore `set()`.
- `firebase.js` subscribes with `onSnapshot` — changes on any device update all open sessions within seconds.
- Local cache (`ems_data` in localStorage) is a fast offline fallback.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Data lost on refresh | Configure `firebase-config.js` and Firestore rules |
| Login page after refresh | Check "Remember me" or ensure session keys exist in localStorage |
| `Firebase: firebase-config.js not configured` | Replace placeholders in `firebase-config.js` |
| Permission denied in Firestore | Update security rules (step 3) |
| CORS / API errors on GitHub Pages | Expected for `/api/*` — use Firestore client mode |
