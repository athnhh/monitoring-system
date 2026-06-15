# 🚀 Deploying Quemahtech EMS to Render.com

This guide walks you through deploying the **Node.js backend** to Render.com with **Firebase Firestore**.

---

## 📦 What You'll Need

| Item | Where to Get It |
|------|-----------------|
| **GitHub account** | [github.com](https://github.com) |
| **Render account** | [render.com](https://render.com) (free tier) |
| **Firebase Project** | Already set up at `quemahtech-e9148` |
| **Service account JSON** | Already saved as `firebase-service-account.json` |

---

## ✅ Step 1 — Push Code to GitHub

```bash
git add .
git commit -m "Firebase migration complete"
git push origin main
```

> Make sure `render.yaml` is in the root of your repo (it already is).

---

## ✅ Step 2 — Deploy via Render Blueprint (render.yaml)

1. Go to [dashboard.render.com/blueprints](https://dashboard.render.com/blueprints)
2. Click **"New Blueprint"** → Connect your GitHub repo
3. Render will detect `render.yaml` and prompt you:
   - **Name**: `quemahtech-ems`
   - **Region**: Pick one close to you (e.g. **Oregon** or **Singapore** for India)
   - **Plan**: Free
4. Click **"Apply"** — Render will start deploying
   - The first deploy will fail because the Firebase service account is not yet uploaded to Render

---

## ✅ Step 3 — Add Firebase Service Account to Render

1. Go to your [Render Dashboard](https://dashboard.render.com) → Click the `quemahtech-ems` service
2. Click the **Environment** tab
3. Scroll to **Secret Files** → Click **"Add Secret File"**
4. **File Name**: `firebase-service-account.json`
5. **File Contents**: Open your local `firebase-service-account.json`, **copy the entire contents**, and paste it here
6. Click **"Save"**
7. Click **"Save Changes"** at the bottom — Render will auto-redeploy

> The env var `FIREBASE_SERVICE_ACCOUNT_PATH: firebase-service-account.json` is already set in `render.yaml`.

---

## ✅ Step 4 — Get Your Live URL

Once the deploy succeeds, Render gives you a URL like:

```
https://quemahtech-ems.onrender.com
```

Test that the backend is working:
```
https://quemahtech-ems.onrender.com/api/health
```
✅ Expected: `{"status":"ok","db":"connected"}`

---

## ✅ Step 5 — Open the App

Visit your Render URL (`https://quemahtech-ems.onrender.com`) in a browser.

Log in with:
- **Admin**: username `quemahtech` / password `quemah123`
- **Employee**: `EMP001` / `emp123`

> The frontend is served from the same origin, so `API_BASE` is automatically set to `window.location.origin`. No extra configuration needed.

---

## 📌 Free Tier Notes

| Limitation | Impact |
|------------|--------|
| **15-min spin-down** | After 15 min of inactivity, the service sleeps. First request after sleep is slow (~5s cold start). |
| **Socket.io disconnects** | WebSocket connections drop when the service spins down. Socket.io client auto-reconnects. |
| **750 hours/month** | One free service running 24/7 uses ~744 hours. Fine for a single service. |

> 🔧 **Option**: Use [UptimeRobot](https://uptimerobot.com/) (free) to ping your URL every 10 minutes to prevent spin-down.

---

## 🔄 Redeploying After Changes

Push to `main` → Render auto-redeploys:

```bash
git add .
git commit -m "Your change description"
git push origin main
```

Or trigger a manual deploy from the Render Dashboard → **Manual Deploy** → **Deploy latest commit**.

---

## ❓ Troubleshooting

| Problem | Solution |
|---------|----------|
| `Cannot connect to Firestore` | The service account JSON is missing or invalid on Render. Check Environment → Secret Files. |
| `405 / HTML instead of JSON` | The frontend is hitting the wrong URL. Since frontend & backend are on the same origin, this shouldn't happen. |
| App shows "Database not connected" | The Firebase service account on Render is missing or invalid. Re-upload it. |
| **First load is slow** | Normal — Render's free plan spins down after 15 min of inactivity (~5s cold start). |
