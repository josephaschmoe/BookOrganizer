# Book Organizer — Firebase Setup Guide

## Architecture Overview

This app runs entirely on static hosting (no Node.js server required) with Firebase
providing all backend services:

| Feature | How it works |
|---|---|
| Catalog save / load | Firestore database (cloud, per user) |
| Google sign-in | Firebase Authentication |
| Book briefings (Gemini AI) | Firebase Cloud Function (proxies Gemini API key securely) |
| Hosting | Firebase Hosting (serves `public/index.html`) |

### Why not just a static web server?

A plain static host can serve the HTML and run the ISBN lookup, manual entry, barcode
scanning, and catalog management — but it cannot persist data across devices or browsers
(only `localStorage`), and it cannot call the Gemini API without exposing your API key in
the browser. Firebase solves both problems.

### Is the Gemini API key secure?

Yes. The key lives in a Firebase Secret (set via CLI, stored encrypted). The browser never
sees it. The flow is:

```
Browser → Cloud Function (holds GEMINI_API_KEY) → Gemini API
                ↑
          key lives here, never sent to browser
```

The Cloud Function also requires the user to be signed in before it will call Gemini, so
even if someone found your function URL they couldn't use it without your Google credentials.

### Does this cost money?

- **Firestore, Hosting, Auth** — free on the Spark plan. A personal book catalog uses a
  tiny fraction of the free limits.
- **Cloud Functions** — requires the Blaze (pay-as-you-go) plan, which needs a credit card
  on file. At personal use levels the bill is effectively $0.
- **Gemini API** — free tier allows 1,500 requests/day, more than enough.

---

## Project File Structure

```
BookOrganizer/
├── public/
│   └── index.html          ← The app (edit this file going forward)
├── functions/
│   ├── index.js            ← Cloud Function: Gemini proxy
│   └── package.json        ← Function dependencies
├── firebase.json           ← Firebase project config
├── .firebaserc             ← Your project ID (set automatically by CLI)
├── firestore.rules         ← Security rules: each user can only access their own data
└── firestore.indexes.json  ← Empty placeholder (no custom indexes needed)
```

> **Note:** `book-catalog.html` and `server.js` in the root are legacy files from the
> original Node.js implementation. They are not deployed. All future edits go in
> `public/index.html`.

---

## Step-by-Step Setup

### Step 1 — Create the Firebase project

1. Go to <https://console.firebase.google.com>
2. Click **Add project**
3. Name it (e.g. `my-library`)
4. Disable Google Analytics (not needed)
5. Click **Create project**

---

### Step 2 — Enable Google Sign-In

1. In the console, go to **Authentication → Sign-in method**
2. Click **Google**, toggle it **Enabled**
3. Set a support email (your Gmail address)
4. Click **Save**

---

### Step 3 — Enable Firestore

1. Go to **Firestore Database → Create database**
2. Choose **Production mode** (security rules are already in `firestore.rules`)
3. Pick a region close to you (e.g. `us-east1`)
4. Click **Enable**

---

### Step 4 — Register a web app and get your config

1. Go to **Project settings** (gear icon) → **Your apps**
2. Click the **`</>`** (Web) icon
3. Name it (e.g. `my-library-web`) — skip the Firebase Hosting checkbox here
4. Copy the `firebaseConfig` object shown
5. Open `public/index.html` and replace the `YOUR_*` placeholder values:

```js
const firebaseConfig = {
  apiKey:            "AIza...",
  authDomain:        "my-library-abc123.firebaseapp.com",
  projectId:         "my-library-abc123",
  storageBucket:     "my-library-abc123.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123456789:web:abc..."
};
```

---

### Step 5 — Upgrade to Blaze plan

Cloud Functions require a billing account, but personal usage costs nothing in practice.

1. Go to **Project settings → Usage and billing**
2. Click **Modify plan → Blaze (pay as you go)**
3. Add a credit card

---

### Step 6 — Install Firebase CLI and log in

```powershell
npm install -g firebase-tools
firebase login
```

**Important:** Run `firebase login` from the project folder. If you get:

```
Error: Invalid project id: YOUR_PROJECT_ID
```

It means `.firebaserc` still has the placeholder value. Open `.firebaserc` and change it to:

```json
{
  "projects": {}
}
```

Then retry `firebase login`. A browser window will open for Google authentication.

---

### Step 7 — Connect the CLI to your project

```powershell
firebase use --add
```

- Select your project from the list
- When asked **"What alias do you want to use?"** — type `default` and press Enter

This writes your real project ID into `.firebaserc` automatically.

---

### Step 8 — Get a Gemini API key

1. Go to <https://aistudio.google.com>
2. Click **Get API key → Create API key**
3. Copy the key

Also verify the API is enabled in Google Cloud:

1. Go to <https://console.cloud.google.com/apis>
2. Search for **Generative Language API**
3. Make sure it is **Enabled** for your project

---

### Step 9 — Store the Gemini key as a Firebase Secret

```powershell
firebase functions:secrets:set GEMINI_API_KEY
```

Paste your Gemini API key when prompted. It is stored encrypted and never appears in your
code or deployed files.

If the function was already deployed before you set the secret, grant it access and redeploy:

```powershell
firebase functions:secrets:grant GEMINI_API_KEY
firebase deploy --only functions
```

---

### Step 10 — Install function dependencies

```powershell
cd functions
npm install
cd ..
```

When asked **"How many days do you want to keep container images before they're deleted?"**
— press **Enter** to accept the default of 1 day.

---

### Step 11 — Deploy

```powershell
firebase deploy
```

This deploys everything in one shot:
- `public/index.html` → Firebase Hosting
- `functions/index.js` → Cloud Function
- `firestore.rules` → Firestore security rules

At the end you'll see your live URL, something like:

```
Hosting URL: https://my-library-abc123.web.app
```

---

## First Use

1. Open the live URL
2. The sign-in overlay appears — click **Sign in with Google**
3. Use the same Google account you used to set up Firebase
4. Your catalog loads (empty on first use)
5. Book briefings are available immediately

---

## Subsequent Deploys

After making changes to the app:

```powershell
# Deploy everything
firebase deploy

# Or selectively
firebase deploy --only hosting       # HTML/CSS/JS changes
firebase deploy --only functions     # Cloud Function changes
firebase deploy --only firestore     # Firestore rules changes
```

If an HTML/CSS/JS change depends on a new or updated callable, deploy Hosting and Functions together in the same release.

---

## Troubleshooting

### Cloud Function returns 500

Check the logs for the actual error:

```powershell
firebase functions:log
```

Or in the console: **Functions → Logs**

Common causes:

| Symptom in logs | Fix |
|---|---|
| Secret not found / permission denied | Run `firebase functions:secrets:grant GEMINI_API_KEY` then redeploy |
| Gemini API error HTTP 403 | Enable **Generative Language API** in Google Cloud Console |
| Gemini API error HTTP 429 | Free tier rate limit hit — wait and retry |
| No logs at all | Function may not have deployed — check `firebase deploy` output for errors |

### Sign-in doesn't work / auth error

Make sure the domain of your hosted app is listed in Firebase Auth's authorized domains:

1. **Authentication → Settings → Authorized domains**
2. Your `*.web.app` and `*.firebaseapp.com` domains are added automatically
3. If using a custom domain, add it here

### Data not saving

Open browser DevTools console. If you see a Firestore permission error, the security rules
may not have deployed. Run:

```powershell
firebase deploy --only firestore
```

### "Invalid project id" on login

See Step 6 above — clear `.firebaserc` before running `firebase login`.

---

## Data Storage Notes

- Each user's catalog is stored at `users/{uid}/catalog/data` in Firestore
- Firestore has a 1 MB document limit per document — sufficient for hundreds of books plus
  all their briefings
- `localStorage` is kept as a read cache so the app shows your last-known catalog
  immediately on load while Firestore syncs in the background
- Use **Export JSON** regularly as a personal backup

## Security Notes

- Firestore rules allow only `request.auth.uid == userId` — no other user or anonymous
  request can read or write your catalog
- The Cloud Function rejects any call without a valid Firebase Auth token
- Your Gemini API key is never in the browser or in any deployed file — it lives only in
  Firebase Secrets
