# TomeShelf

A personal book catalog with a vintage aesthetic and AI-powered research briefings. Scan barcodes, photograph books or entire bookshelves, select batches of individual book photos, or capture text listing titles to add books in bulk. Organise your collection into named shelves, generate structured discussion guides via Perplexity, share read-only shelf links with anyone, and sync everything to the cloud via Firebase.

**Live:** https://tome-shelf.littleofinterest.com

## Features

- **Book Catalog** — Add, edit, and search books with title, author, year, publisher, edition, ISBN, subjects, cover art, condition, shelf location, reading status, dates, rating, and notes
- **TomeShelves** — Organise books into multiple named shelves (e.g. Reading List, Cookbooks, Borrowed); create, rename, and delete shelves; last-viewed shelf restored on next open
- **Custom Sort Order** — Manually reorder books within a shelf using move-up / move-down controls; custom order persists and is respected on shared shelf links
- **Multi-book Selection** — Select any or all books on a shelf; move the selection to another shelf or delete in bulk with confirmation; deleted books (single or bulk) can be immediately restored via an Undo button in the confirmation toast
- **Barcode Scanning** — Scan ISBN barcodes with your phone camera; falls back to `html5-qrcode` on browsers without native `BarcodeDetector` support; additional photo fallback uses Gemini vision to extract ISBNs from barcode images
- **Photo Book Lookup** — Photograph a book's cover, spine, title page, or copyright page (up to 3 images); also accepts a photo of any text mentioning the book. Gemini extracts metadata, then searches Open Library and Google Books to confirm and fill in details. When multiple candidates are found, all are shown with cover thumbnails; selecting an alternate candidate swaps it to the top while keeping the previous pick accessible
- **Bulk Load** — Add many books at once without entering them one by one:
  - **Books** — photograph a bookshelf, stack of covers, or any group of books; AI reads every visible spine and cover
  - **Batch Photos** — select up to 20 individual book photos at once; each image is treated as one book; AI identifies each independently; alternate search candidates shown per item; long-press the cover thumbnail to choose between the book photo and API cover art; manual correction fallback for unmatched items
  - **Titles in Text** — photograph an article, reading list, or bibliography; AI extracts every book title mentioned in the text
  - After AI identification, review a ✓/✗ card list before anything is added; Books mode includes a second-pass cover photo step and manual correction fallback for unmatched titles
- **Cover Images** — Finds covers via Open Library and Google Books across all entry methods; automatic API key rotation when daily quota is reached
- **Cover Search** — When adding or replacing a cover, choose to upload a photo or search online; search fetches covers from Open Library and Google Books and presents them as a thumbnail grid; tap any thumbnail to open a full lightbox preview, then apply the cover with one tap
- **Search Results** — Cover thumbnails appear inline in all search result lists; "Try Broader Search" button relaxes field-level query operators when initial results don't match; each candidate shows a plain-language match-quality cue (title/author word overlap, ISBN match, AI confidence) so you can quickly judge which result to pick
- **Wikipedia Lookup** — On any book's detail page, tap the Wikipedia button to pull up an in-app modal showing the Wikipedia article summary, thumbnail, and Wikidata description for the book. Uses a two-pass strategy: first a direct REST lookup verified against the book type and author name (fast, no AI cost); if that finds nothing, falls back to a Gemini Cloud Function that identifies the exact Wikipedia article titles for both the book and author. Shows the book article if one exists; falls back to the author's page with a notice; shows a "Search Wikipedia" link if neither is found
- **Auto-Generated Briefings** — College-level discussion guides generated automatically in the background when books are added:
  - Small batches (≤ 25 books) generate immediately via a Firestore trigger; larger batches are queued for a scheduled function that runs every 2 hours
  - All briefings use **Perplexity Sonar Pro** with web-grounded verification and structured output; if Perplexity returns malformed JSON the app salvages whatever fields it can or displays the raw reply rather than discarding the response
  - Supports three genre modes: **fiction** (spoiler-free by default — plot/characters/analysis/discussion questions), **non-fiction** (themes/key concepts/analysis/takeaways), and **reference** (editorial approach/contents overview/production notes/notable features/ideal-for)
  - The Regenerate button appears only when a book's existing briefing was generated by an older or less appropriate model
  - Daily generation limit (100 briefings/day) with admin override
- **Audio Briefings** — Generate a narrated audio version of any briefing on demand:
  - Gemini 2.5 Pro writes a concise narration script (~600–850 words, ~4–6 minutes); Gemini 2.5 Pro TTS synthesises it to speech and stores a WAV file in Firebase Storage
  - Long scripts are automatically split into chunks for synthesis and concatenated into a single WAV; duration is calculated from the actual WAV header
  - When Gemini 2.5 Pro TTS hits its daily rate limit, synthesis automatically falls back to Gemini 2.5 Flash TTS for the rest of the day. A notice appears when lower-quality audio was used, with a "Regenerate Higher Quality Audio" button once Pro TTS is available again; Pro TTS also requires Admin Access to be active
  - After queuing audio, the app polls for completion and updates the panel automatically when ready
  - Three voice options: Kore, Puck, Charon
  - Fiction titles produce separate safe and spoiler-inclusive audio variants; spoiler audio requires confirmation before generating
  - Audio metadata (voice, duration, status, TTS model used) is stored per book in `users/{uid}/briefingAudio/{bookId}`; the listen button appears automatically once audio is ready
  - Share links can optionally expose audio to viewers (per-share toggle; off by default)
- **Duplicate Detection** — Adding a book with the same title and author as an existing entry shows a warning with an "Add Anyway" option, allowing legitimate multiple editions
- **Guest Mode** — Try the full app without signing in; books are saved to Firestore under an anonymous account. Sign in with Google at any time to permanently link the library to your account
- **Cloud Sync** — Catalog and briefing cache stored in Firestore, isolated per account; real-time sync means background-generated briefings appear automatically without a page reload
- **Account Settings** — Export a full backup ZIP (catalog JSON + all cover images) or permanently delete your account and all associated data; the Backups section shows job history with download links for completed exports; completed or failed exports can be individually deleted from the list. Admin Access management: grant, enable/disable, or remove admin privileges (admin access unlocks Pro TTS and bypasses the daily briefing quota)
- **Shelf Sharing** — Generate a public, read-only share link for any shelf; viewers need no account. Per-share controls: include personal notes (off by default), enable AI-powered Wikipedia lookup for viewers, and enable audio briefings for viewers. One active link per shelf at a time; revoke from the shelf settings or Account Settings at any time. All active links visible and manageable in Account Settings. The shared detail panel has an expand toggle for a wider reading view (state persists). Cover lightbox automatically attempts a higher-resolution Google Books image before falling back to the original
- **Import / Export** — Export a full backup ZIP (catalog + covers), JSON, or CSV; import from ZIP, JSON, this app's CSV, or a Goodreads export CSV (auto-enriched from Open Library and Google Books)
- **Desktop Layout** — Three-column layout with collapsible Add panel (collapses to a narrow sidebar) and expandable Briefing panel (wider focus mode); states persist across sessions; compact UI mode hides helper text for a denser view; add-flow tab and sub-mode selection persist across sessions and survive camera launches
- **Mobile-first UI** — Bottom navigation bar, hardware back button support, safe-area insets for iPhone home bar
- **Vintage design** — Parchment-toned palette with Playfair Display, EB Garamond, and Courier Prime typefaces

## Tech Stack

| Layer | Technology |
|---|---|
| Hosting | Firebase Hosting |
| Auth | Firebase Auth (Google Sign-In + Anonymous) |
| Database | Cloud Firestore |
| AI backend | Firebase Cloud Functions (Node.js) + Google Gemini + Perplexity |
| Frontend | Vanilla HTML/CSS/JS — single file, no build step |

### AI Models

| Function | Model |
|---|---|
| `generateBriefing` — all books | perplexity-sonar-pro (falls back to gemini-2.5-flash when Perplexity is unavailable) |
| `analyzeBookPhoto` (single book) | gemini-2.5-flash |
| `identifyBooksInImage` — Books mode | gemini-3.1-pro-preview |
| `identifyBooksInImage` — Titles in Text mode | gemini-2.5-flash |
| `resolveWikipediaArticles` — Wikipedia lookup fallback (authenticated users) | gemini-2.5-flash |
| `resolveWikipediaArticlesShared` — Wikipedia lookup fallback (share viewers) | gemini-2.5-flash |
| `generateBriefingAudio` / `processBriefingAudioJob` — narration script | gemini-2.5-pro |
| `generateBriefingAudio` / `processBriefingAudioJob` — text-to-speech synthesis | gemini-2.5-pro-preview-tts (falls back to gemini-2.5-flash-preview-tts when daily rate-limited) |
| `requestBackupExport` / `processBackupExportJob` — backup ZIP generation | — |

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/josephaschmoe/BookOrganizer.git
cd BookOrganizer
```

### 2. Create a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and create a new project
2. **Authentication** → Sign-in method → enable **Google**
3. **Authentication** → Sign-in method → enable **Anonymous** (required for guest mode)
4. **Firestore Database** → Create database (start in production mode)
5. **Project Settings** → Add a Web App → copy the config values

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

### 5. Enable AI features (optional)

Research briefings and photo lookup require API keys and a Firebase **Blaze (pay-as-you-go)** plan for Cloud Functions.

```bash
cd functions
npm install
cd ..
firebase functions:secrets:set GEMINI_API_KEY            # Google Gemini — required for photo lookup, Wikipedia fallback, and audio briefings
firebase functions:secrets:set PERPLEXITY_API_KEY        # Perplexity — required for all book briefings
firebase functions:secrets:set BRIEFING_ADMIN_PASSWORD   # Optional — password to bypass the daily briefing quota
```

Get a Gemini API key at [Google AI Studio](https://aistudio.google.com/apikey). Get a Perplexity API key at [platform.perplexity.ai](https://platform.perplexity.ai). The app works without these keys — briefings and photo lookup won't be available, but all other features continue to work.

**Google Books API** — cover images are fetched via the Google Books API. Create an API key at [Google Cloud Console](https://console.cloud.google.com), enable the Books API, and add the key to the `_gbKeys` array in `public/index.html`. Adding a second key from a separate project enables automatic rotation when the daily quota is reached.

### 6. Deploy

```bash
firebase deploy
```

Or deploy separately:

```bash
firebase deploy --only hosting    # frontend only (~15 seconds)
firebase deploy --only functions  # Cloud Functions only
```

## Data Storage

All catalog data, briefing cache, and shelf definitions are stored in **Cloud Firestore** under each user's account (`users/{uid}/catalog/data`). Discussion guide text lives in `users/{uid}/briefings/{bookId}` (one doc per book). Audio metadata (voice, duration, status, per-variant) lives in `users/{uid}/briefingAudio/{bookId}`; the generated WAV files are stored in Firebase Storage under `users/{uid}/briefing-audio/`. This applies to both Google-authenticated and anonymous guest users. The active shelf selection is persisted to `localStorage` per user.

## License

Personal use.
