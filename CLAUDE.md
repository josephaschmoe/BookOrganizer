# TomeShelf — Claude Project Context

## Workflow

**Do not use worktrees by default.** Work directly on the current branch in the main repo. Only create a worktree if explicitly asked (e.g. "use a worktree for this").

**Preferred deploy pattern:**
- Frontend-only changes → `firebase deploy --only hosting` (fast, ~15s)
- Function changes → `firebase deploy --only functions`
- Everything → `firebase deploy`

**Always check what base commit the working directory is on before deploying.** Deploying from an outdated base can overwrite features.

Commit and push to GitHub at natural stopping points. GitHub is the source of truth.

---

## Project

**TomeShelf** — A personal book catalog with a vintage aesthetic, AI-powered research briefings, and cloud sync.

- **Live URL:** https://schmoeslibrary-ff6c2.web.app
- **Firebase project:** `schmoeslibrary-ff6c2`
- **GitHub:** https://github.com/josephaschmoe/BookOrganizer
- **Primary branch:** `main`

---

## Tech Stack

| Layer | Technology |
|---|---|
| Hosting | Firebase Hosting |
| Auth | Firebase Auth (Google Sign-In only) |
| Database | Cloud Firestore |
| AI backend | Firebase Cloud Functions (Node.js) + Google Gemini |
| Frontend | Vanilla HTML/CSS/JS — **single file** (`public/index.html`), no build step |

---

## Key Files

| File | Purpose |
|---|---|
| `public/index.html` | Entire frontend — all CSS, HTML, and JS in one file |
| `functions/index.js` | Cloud Functions: `generateBriefing`, `analyzeBookPhoto`, `identifyBooksInImage` |
| `firebase.json` | Hosting + Functions + Firestore + Storage config |
| `firestore.rules` | Firestore security rules |
| `storage.rules` | Firebase Storage security rules |

---

## AI Models (in functions/index.js)

- `gemini-2.5-flash` — Research briefings and photo book lookup (`generateBriefing`, `analyzeBookPhoto`)
- `gemini-3.1-pro-preview` — Bulk Load shelf identification (`identifyBooksInImage`)

---

## Firestore Data Model

All user data lives at `users/{uid}/catalog/data`:

```js
{
  books: [
    {
      id, title, author, isbn, publisher, year, edition, subjects,
      coverUrl, condition, shelf, notes, personalNotes,
      readingStatus, startDate, finishDate, rating, addedAt,
      shelfId   // references a TomeShelf by id
    }
  ],
  shelves: [
    { id, name }   // TomeShelves — named collections
  ],
  researchCache: {
    [bookId]: { ...briefingData, generated_at, model }
  }
}
```

Active shelf selection is stored in `localStorage` (key: `tomeshelf-active-shelf-{uid}`).

---

## Features

- **Barcode scanning** — Native `BarcodeDetector` API with `html5-qrcode` fallback
- **Photo book lookup** — Up to 3 images → Gemini extracts metadata → Open Library + Google Books search
- **Bulk Load (beta)** — Photograph a whole bookshelf → Gemini identifies all visible titles → auto-search each
- **TomeShelves** — Named shelf collections; assignable per book; filterable in catalog
- **AI Briefings** — College-level discussion guides with spoiler/safe toggle for fiction
- **Account Settings** — Accessible via Google avatar; includes JSON export and permanent account deletion
- **Import/Export** — JSON, CSV, Goodreads CSV (auto-enriched via Open Library + Google Books)

---

## Design Conventions

- **Aesthetic:** Vintage parchment — warm creams, browns, gold accents
- **Fonts:** Playfair Display (headings), EB Garamond (body), Courier Prime (monospace/labels)
- **CSS variables:** `--cream`, `--parchment`, `--tan`, `--brown`, `--dark`, `--ink`, `--red`, `--gold`, `--green`
- **No frameworks** — pure vanilla JS, no build pipeline, no npm on the frontend
- **Mobile-first** — bottom nav bar on < 1024px, full 3-column layout on desktop
- **Single-file frontend** — all styles, markup, and scripts stay in `public/index.html`
