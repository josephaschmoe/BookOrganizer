# Book Organizer

A personal book catalog with a vintage aesthetic and AI-powered research briefings. Add books to your library, manage metadata, and generate college-level discussion guides using Google Gemini.

## Features

- **Book Catalog** — Add, edit, and delete books with fields for title, author, year, publisher, edition, ISBN, subjects, and notes
- **AI Research Briefings** — Generate structured discussion guides (plot summary, themes, characters, literary analysis, discussion questions) via Google Gemini 2.5 Flash
- **Research Cache** — Briefings are cached locally so repeat lookups are instant
- **Persistent Storage** — Catalog data saved to a local JSON file on the server
- **Vintage UI** — Parchment-toned design with Playfair Display and EB Garamond typefaces

## Tech Stack

- **Backend** — Node.js (no dependencies, standard library only)
- **Frontend** — Vanilla HTML/CSS/JS, single-file, no build step
- **AI** — Google Gemini 2.5 Flash via REST API

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/josephaschmoe/BookOrganizer.git
cd BookOrganizer
```

### 2. Add your Gemini API key (optional)

Research briefings require a [Google Gemini API key](https://aistudio.google.com/apikey). Create a `.env` file in the project root:

```
GEMINI_API_KEY=your_key_here
```

The app runs fine without a key — research features will simply be disabled.

### 3. Start the server

```bash
node server.js
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

The default port is `3000`. Override it with a `PORT` variable in `.env`.

## Data Storage

The catalog is saved to `catalog-data.json` in the project directory. This file is excluded from version control — your book list stays local.

## License

Personal use.
