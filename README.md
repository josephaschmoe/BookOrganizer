# TomeShelf

A personal book catalog with a vintage aesthetic and AI-powered research briefings. Scan barcodes or photograph whole bookshelves to add books, organise your collection into named shelves, and generate structured discussion guides using Google Gemini — all synced to the cloud via Firebase.

## Features

- **Book Catalog** — Add, edit, and search books with title, author, year, publisher, edition, ISBN, subjects, cover art, condition, shelf location, reading status, dates, rating, and notes
- **TomeShelves** — Organise books into multiple named shelves (e.g. Reading List, Cookbooks, Old books from mom & dad); create, rename, and delete shelves; last-viewed shelf restored on next open
- **Bulk Load (beta)** — Photograph a bookshelf; AI identifies the titles and searches for each book automatically; review and correct before adding
- **Barcode Scanning** — Scan ISBN barcodes with your phone camera; falls back to `html5-qrcode` on browsers without native `BarcodeDetector` support
- **Cover Lookup** — Finds covers via Open Library and Google Books across all entry methods (ISBN scan, manual search, bulk load, CSV import)
- **AI Research Briefings** — Generate college-level discussion guides (plot summary, themes, characters, literary analysis, discussion questions) via Google Gemini 2.5 Flash
- **Cloud Sync** — Catalog and briefing cache stored in Firestore, isolated per Google account
- **Account Settings** — Click your Google avatar to access Sign Out or Account Settings; Account Settings lets you export a JSON backup or permanently delete your account and all associated data
- **Import / Export** — Export to JSON or CSV; import from JSON, this app's CSV, or a Goodreads export CSV (auto-enriched from Open Library and Google Books)
- **Mobile-first UI** — Bottom navigation bar, hardware back button support, safe-area insets for iPhone home bar
- **Vintage design** — Parchment-toned palette with Playfair Display, EB Garamond, and Courier Prime typefaces

## Tech Stack

| Layer | Technology |
|---|---|
| Hosting | Firebase Hosting |
| Auth | Firebase Auth (Google Sign-In) |
| Database | Cloud Firestore |
| AI backend | Firebase Cloud Functions + Google Gemini 2.5 Flash |
| Frontend | Vanilla HTML/CSS/JS — single file, no build step |

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/josephaschmoe/BookOrganizer.git
cd BookOrganizer
```

### 2. Create a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and create a new project
2. **Authentication** → Sign-in method → enable **Google**
3. **Firestore Database** → Create database (start in production mode)
4. **Project Settings** → Add a Web App → copy the config values

### 3. Add Firebase config to the app

Open `public/index.html` and fill in your project's values in the `firebaseConfig` block near the top of the `<script>` section:

```js
const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};
```

### 4. Install the Firebase CLI

```bash
npm install -g firebase-tools
firebase login
firebase use --add   # select your project
```

### 5. Enable AI briefings (optional)

Research briefings require a [Google Gemini API key](https://aistudio.google.com/apikey) and a Firebase **Blaze (pay-as-you-go)** plan for Cloud Functions.

```bash
cd functions
npm install
cd ..
firebase functions:secrets:set GEMINI_API_KEY   # paste your key when prompted
```

The app works without this — the Generate button simply won't be available.

### 6. Deploy

```bash
firebase deploy
```

Or deploy only the frontend:

```bash
firebase deploy --only hosting
```

## Data Storage

All catalog data, briefing cache, and shelf definitions are stored in **Cloud Firestore** under each user's Google account (`users/{uid}/catalog/data`). The active shelf selection is persisted to `localStorage` per user. No other data is stored locally.

## License

Personal use.
