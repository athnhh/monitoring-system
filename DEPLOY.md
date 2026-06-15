# 🚀 Deploying Quemahtech EMS to Render.com

This guide walks you through deploying the **Node.js backend** to Render.com with a **Firebase Firestore** database so your app has a live API endpoint accessible from anywhere.

---

## 📦 What You'll Need

| Item | Where to Get It |
|------|-----------------|
| **GitHub account** | [github.com](https://github.com) |
| **Render account** | [render.com](https://render.com) (free tier) |
| **Firebase Project** | [console.firebase.google.com](https://console.firebase.google.com) (free tier) |

---

## ✅ Step 1 — Push Code to GitHub

```bash
git add .
git commit -m "Ready for deployment"
git push origin main
```

> Make sure `render.yaml` and `DEPLOY.md` are in the root of your repo.

---

## ✅ Step 2 — Set up Firebase Firestore

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → Create a project (or use existing)
2. Go to **Project Settings** → **Service Accounts** → **Generate New Private Key**
3. Download the JSON file and save it as `firebase-service-account.json` in the project root
4. Enable **Firestore Database** in the Firebase Console (choose a region)
5. Set Firestore security rules to allow only Admin SDK access (the service account bypasses rules)

---

## ✅ Step 3 — Deploy via Render Blueprint (render.yaml)

1. Go to [dashboard.render.com/blueprints](https://dashboard.render.com/blueprints)
2. Click **"New Blueprint"** → Connect your GitHub repo
3. Render will detect `render.yaml` and prompt you:
   - **Name**: `quemahtech-ems`
   - **Region**: Pick one close to you (e.g. Oregon)
   - **Plan**: Free
4. Click **"Apply"** — Render will start deploying

---

## ✅ Step 4 — Add Firebase Service Account to Render

After the initial deploy fails (expected — Firebase service account needs to be configured):

1. Go to your Render Dashboard → Click the service → **Environment** tab
2. Click **"Add Secret File"** → File Name: `firebase-service-account.json`
3. Paste the entire contents of your Firebase service account JSON
4. Click **"Save"**

The env var `FIREBASE_SERVICE_ACCOUNT_PATH` is already set in `render.yaml`.

Then click **"Save Changes"** → The service will auto-redeploy.

---

## ✅ Step 5 — Get Your Live Backend URL

Once deployed, Render gives you a URL like:

```
https://quemahtech-ems.onrender.com
```

1. Click the link to open it
2. Test the health endpoint: `https://quemahtech-ems.onrender.com/api/health`
   - You should see: `{"status":"ok","db":"connected"}`

---

## ✅ Step 6 — Configure the Frontend

If you're not deploying everything to a single origin (e.g., frontend on GitHub Pages + backend on Render), set `API_BASE` in `index.html` to your Render URL:

```html
<script>
  window.APP_CONFIG = {
    API_BASE: 'https://quemahtech-ems.onrender.com',   // ← Your Render URL
    ADMIN_EMAIL: 'atharvashishn@gmail.com'
  };
</script>
```

The frontend now automatically detects `localhost` vs production. For custom backends, override `API_BASE` as above.

---

## ✅ Step 7 — Test Login

Open your live app URL in a browser:

- **Admin**: username `quemahtech` / password `quemah123`
- **Employee**: add employees via the admin panel first

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

Whenever you push to `main` on GitHub, Render auto-redeploys:

```bash
git add .
git commit -m "Your change description"
git push origin main
```

You can also trigger a manual deploy from the Render Dashboard → **Manual Deploy** → **Deploy latest commit**.

---

## ❓ Troubleshooting

| Problem | Solution |
|---------|----------|
| `Cannot connect to Firestore` | Check the Firebase service account JSON is correctly uploaded as a Secret File on Render |
| `405 / HTML instead of JSON` | The frontend `API_BASE` is pointing to the wrong URL. Check `window.APP_CONFIG.API_BASE` matches your Render URL. |
| `Socket.io not connecting` | Check browser console for errors. Ensure `API_BASE` is set correctly. |
| App shows "Database not connected" | The Firebase service account is missing or invalid. Check FIREBASE_SERVICE_ACCOUNT_PATH. |
| `MongoDB` errors in logs | The code no longer uses MongoDB — ensure you're running the latest code after the Firebase migration. |
