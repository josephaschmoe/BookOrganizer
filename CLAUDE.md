# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Workflow

**Do not use worktrees by default.** Work directly on the current branch in the main repo. Only create a worktree if explicitly asked.

**Deploy pattern:**
```bash
firebase deploy --only hosting    # frontend-only changes (~15s)
firebase deploy --only functions  # Cloud Function changes
firebase deploy --only firestore  # rules/indexes only
firebase deploy                   # everything
```

**Always check the current git commit before deploying.** Deploying from a stale base can overwrite features.

Commit and push to GitHub at natural stopping points. GitHub is the source of truth.

---

## Project

**TomeShelf** — A personal book catalog with a vintage aesthetic, AI-powered research briefings, and cloud sync.

- **Live URL:** https://schmoeslibrary-ff6c2.web.app (also https://tome-shelf.littleofinterest.com)
- **Firebase project:** `schmoeslibrary-ff6c2`
- **GitHub:** https://github.com/josephaschmoe/BookOrganizer
- **Primary branch:** `main`

---

## Key Files

| File | Purpose |
|---|---|
| `public/index.html` | Entire frontend — all CSS, HTML, and JS in one file (~10k+ lines) |
| `public/share.html` | Read-only shared shelf viewer (standalone page, no auth) |
| `functions/index.js` | All Cloud Functions (~2900+ lines) |
| `firestore.rules` | Firestore security rules |
| `storage.rules` | Firebase Storage security rules |
| `firebase.json` | Hosting + Functions + Firestore + Storage config |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Hosting | Firebase Hosting |
| Auth | Firebase Auth (Google Sign-In + Anonymous guest mode) |
| Database | Cloud Firestore |
| Storage | Firebase Storage (covers, book photos, audio) |
| AI backend | Firebase Cloud Functions (Node.js) + Google Gemini + Perplexity |
| Frontend | Vanilla HTML/CSS/JS — **single file**, no build step, no npm |

---

## Firestore Data Model

```
users/{uid}/
  catalog/data          — books[], shelves[], pendingBriefingIds[], shareLinks{}
  briefings/{bookId}    — briefing text, generated_at, model (one doc per book)
  briefingAudio/{bookId}— audio metadata: voice, duration, variants, TTS model
  bookPhotos/{bookId}   — photos[]: { id, type, caption, storagePath, url }
  briefingAudioJobs/{jobId} — async TTS job state
  backupExports/{jobId} — async backup ZIP job state
  adminAccess/{uid}     — admin grant: enabled, grantedAt, grantedBy

shareLinks/{token}      — public read; ownerUid, shelfId, options
system/ttsProStatus     — daily Pro TTS availability flag
system/briefingUsage    — daily per-user briefing quota tracking
```

**Firebase Storage paths:**
```
users/{uid}/covers/{bookId}           — cover images
users/{uid}/book-photos/{bookId}/{id} — additional book photos
users/{uid}/briefing-audio/{filename} — WAV audio files
users/{uid}/backup-exports/{jobId}    — backup ZIP files
```

`catalog/data` is the single source of truth for books/shelves. Briefings, audio, and photos live in their own subcollections — no size limits.

Active shelf selection: `localStorage` key `tomeshelf-active-shelf-{uid}`.

---

## Cloud Functions (functions/index.js)

| Export | Type | Purpose |
|---|---|---|
| `generateBriefing` | onCall | Generate a book briefing via Perplexity (primary) or Gemini (fallback) |
| `generateBriefingAudio` | onCall | Queue/trigger TTS audio generation |
| `getBriefingAudio` | onCall | Get playable URL for stored audio |
| `getBriefingAudioTtsStatus` | onCall | Check Pro TTS daily availability |
| `analyzeBookPhoto` | onCall | Identify a book from up to 3 photos using Gemini |
| `identifyBooksInImage` | onCall | Bulk identify books from a shelf photo (Gemini) |
| `resolveWikipediaArticles` | onCall | AI fallback for Wikipedia article lookup (authenticated) |
| `resolveWikipediaArticlesShared` | onCall | Same, for share page viewers |
| `createShareLink` | onCall | Generate a public read-only shelf share token |
| `getSharedShelf` | onCall | Fetch all data for a shared shelf (no auth required) |
| `getSharedBriefingAudio` | onCall | Get audio URL for share page viewers |
| `revokeShareLink` | onCall | Delete a share token |
| `getAdminAccessStatus` | onCall | Check/return admin access state |
| `setAdminAccess` | onCall | Grant admin access |
| `setAdminAccessEnabled` | onCall | Enable/disable admin access |
| `removeAdminAccess` | onCall | Revoke admin access |
| `requestBackupExport` | onCall | Kick off a backup ZIP export job |
| `deleteBackupExport` | onCall | Delete a backup job record + Storage file |
| `onBooksChanged` | onDocumentWritten | Firestore trigger → queue briefings for new books |
| `processPendingBriefings` | onSchedule | Every 2h: generate briefings for queued books |
| `processBackupExportJob` | onDocumentCreated | Build and store backup ZIP when job doc is created |
| `processBriefingAudioJob` | onDocumentCreated | Synthesize and store audio when job doc is created |
| `cleanupExpiredBackupExports` | onSchedule | Daily: delete expired backup ZIPs from Storage |

---

## AI Models

| Function | Model |
|---|---|
| `generateBriefing` | `perplexity-sonar-pro` (falls back to `gemini-2.5-flash`) |
| `analyzeBookPhoto` | `gemini-2.5-flash` |
| `identifyBooksInImage` — Books/Batch mode | `gemini-3.1-pro-preview` |
| `identifyBooksInImage` — Titles in Text mode | `gemini-2.5-flash` |
| `resolveWikipediaArticles*` | `gemini-2.5-flash` |
| Narration script generation | `gemini-2.5-pro` |
| TTS synthesis (primary) | `gemini-2.5-pro-preview-tts` |
| TTS synthesis (fallback) | `gemini-2.5-flash-preview-tts` |

**Briefing quota:** 100/day per user; admin access bypasses this. Batches ≤ 25 books generate immediately via `onBooksChanged`; larger batches are written to `pendingBriefingIds` and picked up by `processPendingBriefings` (runs every 2h). This threshold is `THRESHOLD = 25` in `index.html`.

---

## Frontend Architecture (public/index.html)

Single-file, no build step. All state is global JS variables; there is no framework or reactive system.

**Key global state:**
- `books[]` — in-memory array of all book objects for the active account
- `shelves[]` — named shelf definitions
- `researchCache{}` — `{bookId: briefingData}`, populated from `briefings/` subcollection listener
- `briefingAudioCache{}` — audio metadata per bookId
- `bookPhotoCache{}` — `{bookId: photos[]}`, populated from `bookPhotos/` subcollection listener
- `backupJobsCache{}` — backup export job state
- `shareLinks{}` — active share tokens per shelf
- `_booksOwnedByUid` — guards against cross-user writes (critical: always check before writing)
- `pendingBriefingIds[]` — IDs queued for background briefing generation
- `selectedBookId` / `editingBookId` — currently viewed/edited book
- `adminAccessState{}` — `{ granted, enabled, grantedAt }`

**Key functions:**
- `loadCatalogData()` — loads `catalog/data` + all subcollections; runs on auth state change
- `subscribeToBackgroundUpdates(uid)` — sets up 5 Firestore snapshot listeners (catalog, briefings, briefingAudio, backupJobs, bookPhotos)
- `persistCatalog()` — writes `catalog/data` (books/shelves/pending/shareLinks only — not briefings/audio/photos)
- `saveBriefing(bookId, data)` — writes one doc to `briefings/{bookId}`
- `deleteBook(id)` / `deleteSelectedBooks()` — also deletes `briefings/{id}` and `bookPhotos/{id}` docs

**Listener teardown variables:** `_catalogUnsubscribe`, `_briefingsUnsubscribe`, `_briefingAudioUnsubscribe`, `_backupJobsUnsubscribe`, `_bookPhotosUnsubscribe` — always unsubscribe before setting up new listeners on auth change.

---

## Design Conventions

- **Aesthetic:** Vintage parchment — warm creams, browns, gold accents
- **Fonts:** Playfair Display (headings), EB Garamond (body), Courier Prime (monospace/labels)
- **CSS variables:** `--cream`, `--parchment`, `--tan`, `--brown`, `--dark`, `--ink`, `--red`, `--gold`, `--green`
- **No frameworks** — pure vanilla JS; no npm on the frontend
- **Mobile-first** — bottom nav bar on `< 1024px`; full 3-column layout on desktop
- **Single-file rule** — all styles, markup, and scripts stay in `public/index.html`; `share.html` is its own standalone file

---

## Critical Patterns

**Cross-user write guard:** Every write to Firestore must check `_booksOwnedByUid`. If `user.uid !== _booksOwnedByUid`, abort and log an error. `persistCatalog` and `saveBriefing` already do this — follow the same pattern in new write paths.

**Firestore migration order:** When moving data between Firestore paths:
1. Deploy the write to the new location first
2. Then deploy migration-on-load to copy existing data
3. Only then stop writing to the old location
Never remove an old write path in the same deploy as adding the new one without first migrating existing data.

**Backup ZIP schema version:** `schemaVersion` in `buildBackupZipForUser` must be bumped when new sections are added to the ZIP manifest (currently `2`).
