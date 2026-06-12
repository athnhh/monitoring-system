# 🚀 Deploying Quemahtech EMS to Render.com

This guide walks you through deploying the **Node.js backend** to Render.com so your app has a live API endpoint that the frontend can talk to from anywhere.

---

## 📦 What You'll Need

| Item | Where to Get It |
|------|-----------------|
| **GitHub account** | [github.com](https://github.com) |
| **Render account** | [render.com](https://render.com) (free tier) |
| **Firebase Project** | [console.firebase.google.com](https://console.firebase.google.com) (free tier) |
| **Gmail App Password** | [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) |

---

## ✅ Step 1 — Push Code to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

> Make sure `render.yaml` and `DEPLOY.md` are in the root of your repo.

---

## ✅ Step 2 — Set up Firebase

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → Create a project (or use existing)
2. Go to **Project Settings** → **Service Accounts** → **Generate New Private Key**
3. Download the JSON file and save it as `firebase-service-account.json` in the project root
4. Enable **Firestore Database** in the Firebase Console (choose a region)

---

## ✅ Step 3 — Get a Gmail App Password

1. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
2. If you don't see this option, enable **2-Step Verification** first
3. Select **"Mail"** and **"Windows Computer"** → **"Generate"**
4. Copy the 16-character password (looks like `abcd efgh ijkl mnop`)

---

## ✅ Step 4 — Deploy via Render Blueprint

1. Go to [dashboard.render.com/blueprints](https://dashboard.render.com/blueprints)
2. Click **"New Blueprint"** → Connect your GitHub repo
3. Render will detect `render.yaml` and prompt you:
   - **Name**: `quemahtech-ems`
   - **Region**: Pick one close to you
   - **Plan**: Free
4. After creation, go to your **Dashboard** → Click the service

---

## ✅ Step 5 — Set Environment Variables

In your Render service dashboard, go to **Environment** and set these synced variables:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | Your MongoDB Atlas connection string (from Step 2) |
| `SMTP_USER` | `atharvashishn@gmail.com` |
| `SMTP_PASS` | Your Gmail App Password (from Step 3) |

Then click **"Save Changes"** → The service will auto-redeploy.

---

## ✅ Step 6 — Get Your Live Backend URL

Once deployed, Render gives you a URL like:

```
https://quemahtech-ems.onrender.com
```

1. Click the link to open it
2. Test the health endpoint: `https://quemahtech-ems.onrender.com/api/health`
   - You should see: `{"status":"ok","db":"connected"}`

---

## ✅ Step 7 — Configure the Frontend

Now update `index.html` to point to your live backend. Open the file and **uncomment** the `API_BASE` line:

```html
<script>
  window.APP_CONFIG = {
    API_BASE: 'https://quemahtech-ems.onrender.com',   // ← UNCOMMENT THIS
    ADMIN_EMAIL: 'atharvashishn@gmail.com'
  };
</script>
```

Then push the change to GitHub so your frontend knows where to find the backend.

---

## ✅ Step 8 — Test Login

Open your live app URL in a browser:

- **Admin**: username `quemahtech` / password `quemah123`
- **Employee**: you'll need to add employees via the admin panel

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

Whenever you push to `main` (on GitHub), Render auto-redeploys:

```bash
git add .
git commit -m "Your change description"
git push origin main
```

You can also trigger a manual deploy from the Render Dashboard → **Manual Deploy** → **Deploy latest commit**.

---

## 🧪 Testing SMTP After Deployment

Once deployed, test the SMTP config:

```bash
curl -X POST https://quemahtech-ems.onrender.com/api/test-smtp
```

Expected response:
```json
{"success":true,"message":"SMTP connection verified"}
```

---

## ❓ Troubleshooting

| Problem | Solution |
|---------|----------|
| `Cannot connect to MongoDB` | Check `DATABASE_URL` in Render env vars. Ensure `0.0.0.0/0` is allowed in Atlas Network Access. |
| `SMTP connection failed` | Verify `SMTP_USER` and `SMTP_PASS` are set. Gmail requires an **App Password**, not your regular password. |
| `405 / HTML instead of JSON` | The frontend `API_BASE` is pointing to the wrong URL. Check `window.APP_CONFIG.API_BASE` matches your Render URL. |
| `Socket.io not connecting` | Check browser console for errors. Ensure `API_BASE` is set correctly — Socket.io uses that URL now. |
| App shows "Database not connected" | The MongoDB connection string is wrong or Atlas isn't allowing connections. |
