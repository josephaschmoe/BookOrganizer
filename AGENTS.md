# AGENTS.md

This file provides guidance to coding agents working in this repository.

## Workflow

**Do not use worktrees by default.** Work directly on the current branch in the main repo. Only create a worktree if explicitly asked.

**Deploy pattern:**
```bash
firebase deploy --only hosting    # frontend-only changes
firebase deploy --only functions  # Cloud Function changes
firebase deploy --only firestore  # rules/indexes only
firebase deploy                   # everything
```

If a frontend change introduces or depends on a new/updated callable, deploy `hosting` and `functions` together in the same release.

**Always check the current git commit before deploying.** Deploying from a stale base can overwrite features.

Commit and push to GitHub at natural stopping points. GitHub is the source of truth.

---

## Project

**TomeShelf** - A personal book catalog with a vintage aesthetic, AI-powered research briefings, and cloud sync.

- **Live URL:** https://schmoeslibrary-ff6c2.web.app (also https://tome-shelf.littleofinterest.com)
- **Firebase project:** `schmoeslibrary-ff6c2`
- **GitHub:** https://github.com/josephaschmoe/BookOrganizer
- **Primary branch:** `main`

---

## Key Files

| File | Purpose |
|---|---|
| `public/index.html` | Main app entrypoint; loads shared/app CSS and JS assets |
| `public/share.html` | Public read-only share entrypoint; loads shared/share CSS and JS assets |
| `public/assets/css/common.css` | Shared styles used by main app and share page |
| `public/assets/css/index.css` | Main app-specific styles |
| `public/assets/css/share.css` | Share page-specific styles |
| `public/assets/js/shared/` | Shared frontend utilities used by both entrypoints |
| `public/assets/js/app/` | Main app JS modules |
| `public/assets/js/share/` | Share page JS modules |
| `functions/index.js` | All Cloud Functions |
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
| Frontend | Vanilla HTML/CSS/JS split into static assets, no build step, no npm |

---

## Firestore Data Model

```text
users/{uid}/
  catalog/data              - books[], shelves[], pendingBriefingIds[]
  briefings/{bookId}        - briefing text, generated_at, model
  briefingAudio/{bookId}    - audio metadata: voice, duration, variants, TTS model
  bookPhotos/{bookId}       - photos[]: { id, type, caption, storagePath, url }
  briefingAudioJobs/{jobId} - async TTS job state
  backupExports/{jobId}     - async backup ZIP job state
  adminAccess/{uid}         - admin grant: enabled, grantedAt, grantedBy
  shares/{token}            - normalized share records for shelves and books

shareLinks/{token}          - public lookup docs for shelf/book shares; legacy shelf tokens must remain valid
system/ttsProStatus         - daily Pro TTS availability flag
system/briefingUsage        - daily per-user briefing quota tracking
```

**Firebase Storage paths:**
```text
users/{uid}/covers/{bookId}           - cover images
users/{uid}/book-photos/{bookId}/{id} - additional book photos
users/{uid}/briefing-audio/{filename} - WAV audio files
users/{uid}/backup-exports/{jobId}    - backup ZIP files
```

`catalog/data` is the single source of truth for books/shelves. Briefings, audio, photos, and shares live outside it in their own subcollections/collections.

Active shelf selection: `localStorage` key `tomeshelf-active-shelf-{uid}`.

---

## Cloud Functions (`functions/index.js`)

| Export | Type | Purpose |
|---|---|---|
| `generateBriefing` | onCall | Generate a book briefing via Perplexity (primary) or Gemini (fallback) |
| `generateBriefingAudio` | onCall | Queue/trigger TTS audio generation |
| `getBriefingAudio` | onCall | Get playable URL for stored audio |
| `getBriefingAudioTtsStatus` | onCall | Check Pro TTS daily availability |
| `analyzeBookPhoto` | onCall | Identify a book from up to 3 photos using Gemini |
| `resolveEditionMetadata` | onCall | Perplexity-based edition enrichment for specific-edition flows |
| `identifyBooksInImage` | onCall | Bulk identify books from a shelf photo |
| `resolveWikipediaArticles` | onCall | AI fallback for Wikipedia article lookup (authenticated) |
| `resolveWikipediaArticlesShared` | onCall | Same, for share page viewers |
| `createShareLink` | onCall | Generate a public read-only shelf or book share token |
| `getSharedShelf` | onCall | Fetch all data for a shared shelf |
| `getSharedBook` | onCall | Fetch one shared book view |
| `getSharedBriefingAudio` | onCall | Get audio URL for share page viewers |
| `revokeShareLink` | onCall | Delete/revoke a share token |
| `getAdminAccessStatus` | onCall | Check/return admin access state |
| `setAdminAccess` | onCall | Grant admin access |
| `setAdminAccessEnabled` | onCall | Enable/disable admin access |
| `removeAdminAccess` | onCall | Revoke admin access |
| `requestBackupExport` | onCall | Kick off a backup ZIP export job |
| `deleteBackupExport` | onCall | Delete a backup job record and Storage file |
| `onBooksChanged` | onDocumentWritten | Firestore trigger that queues briefings for new books |
| `processPendingBriefings` | onSchedule | Generates briefings for queued books |
| `processBackupExportJob` | onDocumentCreated | Builds and stores backup ZIPs |
| `processBriefingAudioJob` | onDocumentCreated | Synthesizes and stores audio |
| `cleanupExpiredBackupExports` | onSchedule | Deletes expired backup ZIPs from Storage |

---

## AI Models

| Function | Model |
|---|---|
| `generateBriefing` | `perplexity-sonar-pro` (falls back to `gemini-2.5-flash`) |
| `analyzeBookPhoto` | `gemini-2.5-flash` |
| `resolveEditionMetadata` | `perplexity-sonar-pro` |
| `identifyBooksInImage` - Books/Batch mode | `gemini-3.1-pro-preview` |
| `identifyBooksInImage` - Titles in Text mode | `gemini-2.5-flash` |
| `resolveWikipediaArticles*` | `gemini-2.5-flash` |
| Narration script generation | `gemini-2.5-pro` |
| TTS synthesis (primary) | `gemini-2.5-pro-preview-tts` |
| TTS synthesis (fallback) | `gemini-2.5-flash-preview-tts` |

**Briefing quota:** 100/day per user; admin access bypasses this. Batches <= 25 books generate immediately via `onBooksChanged`; larger batches are written to `pendingBriefingIds` and picked up by `processPendingBriefings`.

---

## Frontend Architecture

Static-asset frontend, no build step. The app still uses global JS state and browser-loaded scripts; there is no framework or reactive system.

Current layout:
- `public/index.html` loads the main app shell plus files from `public/assets/css/` and `public/assets/js/app/`
- `public/share.html` loads the public share shell plus files from `public/assets/css/` and `public/assets/js/share/`
- `public/assets/js/shared/` contains utilities shared by both entrypoints
- Runtime behavior still depends on script load order and globally visible functions for inline event handlers

**Key global state:**
- `books[]` - in-memory array of all book objects for the active account
- `shelves[]` - named shelf definitions
- `researchCache{}` - `{bookId: briefingData}`, populated from `briefings/`
- `briefingAudioCache{}` - audio metadata per book
- `bookPhotoCache{}` - `{bookId: photos[]}`, populated from `bookPhotos/`
- `backupJobsCache{}` - backup export job state
- `pendingEditionLookupContext` - transient add-flow state for photo/manual matching
- `specificEditionMode` - add-flow toggle for work-level vs edition-level metadata
- `_booksOwnedByUid` - guards against cross-user writes
- `selectedBookId` / `editingBookId` - currently viewed/edited book
- `adminAccessState{}` - current admin access flags

**Key functions:**
- `loadCatalogData()` - loads `catalog/data` plus related subcollections; runs on auth change
- `persistCatalog()` - writes `catalog/data` (books/shelves/pending only)
- `searchManualBook()` - searches Open Library / Google Books from manual form input
- `submitPhotoLookup()` - analyzes one book from up to 3 images
- `acceptReviewMatch()` - accepts a photo lookup match; behavior differs by `specificEditionMode`
- `fillEditionDetails()` - manual Perplexity edition lookup; only valid in specific-edition mode

---

## Add Flow Rules

The main add flow now has two user-facing bibliographic modes:

- `Quick Add` - catalog the book fast; best when exact edition details are not needed
- `Specific Edition` - capture this exact edition when enough detail can be confirmed

### Quick Add (`Specific Edition` off)
- Goal is only `title`, `author`, and original publication year when it can be confidently determined.
- Do **not** call Perplexity in this mode.
- Photo/manual/API matches are for work identification and cover choice only.
- If only an edition year is available, do not silently treat it as original publication year.
- Saving in this mode should strip publisher, edition, contributor, illustration note, subjects, and ISBN unless the user is on a true ISBN-authoritative path that explicitly requires them.

### Specific Edition (`Specific Edition` on)
- Treat this as an evidence-first edition flow, not just a richer search mode.
- Non-ISBN photo flow may use `resolveEditionMetadata` / Perplexity automatically.
- Publisher, edition, contributor, and illustration-note fields are relevant in this mode.
- For non-ISBN photo flows, extracted page metadata and Perplexity enrichment are the primary bibliographic source.
- Catalog/API matches are mainly for comparison, duplicate detection, and optional cover art unless exact ISBN authority exists.
- If there is no exact ISBN authority, API matches must not override image-extracted bibliographic fields.
- In batch photo flows, a confirmed item can still be added without a catalog match if extracted data plus Perplexity provide strong enough edition evidence.

### ISBN authority
- If a valid ISBN is visible in the image and the selected API result contains that exact ISBN, the ISBN/API path can be treated as authoritative.
- Exact ISBN authority permits retaining ISBN and edition metadata.
- A visible/extracted ISBN by itself is not enough; the selected result must also carry that ISBN.

### Cover choice
- Cover choice is independent of metadata authority.
- If the user chooses their uploaded photo as the cover, that choice must win over API cover URLs.
- Do not let API "no cover available" placeholders displace an uploaded photo.
- Save paths that use a photo cover must wait for any pending cover-compression/upload preparation instead of racing ahead with an empty `coverUrl`.

### Single-book photo UX
- Single-book photo lookup supports up to 3 photos total; do not regress this to a replace-only picker.
- The user can explicitly designate which selected photo is the cover. That designated photo is the one used when `My Photo` is chosen as the cover source.
- When multiple photos are used for one book, the non-cover photos should be saved as additional book photos with the record.
- After the first photo is loaded, the UI should keep the user in the add flow and show `Analyze` plus `Add Another Photo`.
- After analysis, the user must still be able to add another photo and rerun analysis without restarting the flow.

### Existing-book metadata refresh
- Existing books support a separate `Refresh Metadata` flow; do not collapse this back into “re-add the book.”
- Metadata refresh must update the existing record in place, not create a duplicate.
- Refresh may reuse saved additional photos, the current cover, new photos, ISBN lookup, or manual search.
- Existing populated bibliographic fields should not be replaced silently; blank fields may be filled automatically, but replacing populated metadata requires explicit confirmation.
- In metadata refresh, retaining the existing cover is the default. Using a photo for analysis must not replace the saved cover unless the user explicitly changes cover choice.
- If metadata refresh changes `title` or `author`, set the book up for manual `Regenerate`; do not auto-regenerate the briefing.
- Changes limited to year, publisher, edition, ISBN, subjects, cover, or extra photos should not independently force briefing regeneration.

### Saved and external photo analysis
- Metadata refresh can analyze saved book photos without re-uploading them from the browser.
- Saved-photo analysis should support both user-owned Storage photos and externally hosted current-cover URLs.
- Using an external current cover for analysis must not ingest or store it locally unless the user explicitly replaces the cover with a local photo later.
- Because saved-photo analysis now depends on backend support in `analyzeBookPhoto`, changes to this path require deploying both hosting and functions when the callable request/response contract changes.

### Cover replacement
- The replace-cover modal should offer `Camera`, `Upload Photo`, and `Search Online`.
- Camera and upload should both route through the same cover upload/save path so behavior stays consistent.

### Mobile camera return
- Native mobile camera capture can background or reload the page, especially on iOS.
- Before opening any native camera input for add flows, persist enough UI state to restore the add panel and the current add-flow mode on return.
- When the app regains focus from a camera capture, prefer restoring the add flow over falling back to the catalog/library view.
- Changes to camera handlers must be tested with phone portrait behavior in mind; avoid timing gaps where the accepted photo returns the user to the main catalog before the selected image and `Analyze` button render.

### Bookshelf-photo year handling
- `Bookshelf Photo` is still a non-edition flow by default, but should save a year when there is strong enough evidence.
- Prefer Open Library `first_publish_year` as the original-publication year when available.
- If `first_publish_year` is unavailable, a strong or likely bookshelf match may use a reasonable matched year rather than leaving it blank.
- Do not weaken the existing rule for other flows: edition/publication year should not silently become original-publication year unless the mode-specific logic explicitly allows it.

---

## Design Conventions

- **Aesthetic:** Vintage parchment - warm creams, browns, gold accents
- **Fonts:** Playfair Display (headings), EB Garamond (body), Courier Prime (monospace/labels)
- **CSS variables:** `--cream`, `--parchment`, `--tan`, `--brown`, `--dark`, `--ink`, `--red`, `--gold`, `--green`
- **No frameworks** - pure vanilla JS
- **Mobile-first** - bottom nav on small screens; multi-column layout on desktop
- **No build-step rule** - keep frontend code as static browser-loaded assets under `public/`; do not introduce a bundler/framework without explicit approval
- **Entrypoint rule** - `public/index.html` and `public/share.html` remain the two HTML entrypoints
- **Separation rule** - shared utilities belong in `public/assets/js/shared/`; main-app-only code belongs in `public/assets/js/app/`; share-only code belongs in `public/assets/js/share/`

---

## Critical Patterns

**Cross-user write guard:** Every write to Firestore must check `_booksOwnedByUid`. If `user.uid !== _booksOwnedByUid`, abort and log an error.

**Firestore migration order:** When moving data between Firestore paths:
1. Deploy the write to the new location first.
2. Then deploy migration/backfill logic.
3. Only then stop writing to the old location.

Never remove an old write path in the same deploy as adding the new one without first migrating existing data.

**Share migration compatibility:** Existing public shelf share URLs must continue to work unchanged. `shareLinks/{token}` is the compatibility/public lookup layer; `users/{uid}/shares/{token}` is the management layer. Do not rotate legacy shelf tokens during migration.

**Backup ZIP schema version:** `schemaVersion` in `buildBackupZipForUser` must be bumped when new sections are added to the ZIP manifest.
