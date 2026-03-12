"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten }  = require("firebase-functions/v2/firestore");
const { onSchedule }         = require("firebase-functions/v2/scheduler");
const { defineSecret }       = require("firebase-functions/params");
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();

const geminiApiKey = defineSecret("GEMINI_API_KEY");

const MODEL = "gemini-2.5-flash";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const BULK_MODEL = "gemini-3.1-pro-preview";
const BULK_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${BULK_MODEL}:generateContent`;

const THRESHOLD = 25; // generate immediately below this; queue above

const researchSchema = {
  type: "object",
  properties: {
    genre:                        { type: "string" },
    quick_take:                   { type: "string" },
    major_themes:                 { type: "array", items: { type: "string" } },
    historical_context:           { type: "string" },
    impact:                       { type: "string" },
    confidence_note:              { type: "string" },
    key_takeaways:                { type: "array", items: { type: "string" } },
    // non-fiction singular fields
    summary:                      { type: "string" },
    key_elements:                 { type: "array", items: { type: "string" } },
    craft_analysis:               { type: "string" },
    discussion_questions:         { type: "array", items: { type: "string" } },
    // fiction spoiler/safe paired fields
    summary_spoiler:              { type: "string" },
    summary_safe:                 { type: "string" },
    key_elements_spoiler:         { type: "array", items: { type: "string" } },
    key_elements_safe:            { type: "array", items: { type: "string" } },
    craft_analysis_spoiler:       { type: "string" },
    craft_analysis_safe:          { type: "string" },
    discussion_questions_spoiler: { type: "array", items: { type: "string" } },
    discussion_questions_safe:    { type: "array", items: { type: "string" } }
  },
  required: [
    "genre", "quick_take", "major_themes",
    "historical_context", "impact", "confidence_note"
  ]
};

// ── Shared Gemini briefing helper ────────────────────────────────────────────

async function callGeminiForBook(book, apiKey) {
  const payload = {
    system_instruction: {
      parts: [{
        text: [
          "You are a precise book discussion assistant for both fiction and non-fiction.",
          "Create a college-level book briefing.",
          "First decide if the book is fiction or non-fiction, then populate the genre-appropriate fields.",
          "For fiction, provide both spoiler and spoiler-free versions of certain fields as instructed.",
          "Separate factual claims from interpretation when uncertainty exists.",
          "If the book is obscure, the title is ambiguous, or the details may be wrong, say so clearly in confidence_note.",
          "Return JSON only."
        ].join(" ")
      }]
    },
    contents: [{ role: "user", parts: [{ text: buildPrompt(book) }] }],
    generationConfig: {
      temperature: 0.4,
      topP: 0.9,
      topK: 32,
      maxOutputTokens: 6144,
      responseMimeType: "application/json",
      responseJsonSchema: researchSchema,
      thinkingConfig: { thinkingBudget: 0 }
    }
  };

  const geminiResponse = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(payload)
  });

  const rawText = await geminiResponse.text();
  if (!geminiResponse.ok) {
    let apiError = {};
    try { apiError = JSON.parse(rawText); } catch { /* ignore */ }
    console.error("Gemini API error", geminiResponse.status, JSON.stringify(apiError));
    throw new Error(`Gemini request failed (HTTP ${geminiResponse.status})`);
  }

  let parsedApi;
  try { parsedApi = JSON.parse(rawText); }
  catch { throw new Error("Gemini returned unreadable JSON"); }

  const research = parseResearchJson(extractCandidateText(parsedApi));
  research.generated_at = new Date().toISOString();
  research.model = MODEL;
  return research;
}

// ── onCall: manual generate (user-triggered) ─────────────────────────────────

exports.generateBriefing = onCall({ secrets: [geminiApiKey] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const book = sanitizeBook(request.data && request.data.book);
  if (!book.title) {
    throw new HttpsError("invalid-argument", "Book title is required.");
  }

  let research;
  try {
    research = await callGeminiForBook(book, geminiApiKey.value());
  } catch (error) {
    if (error.message.includes("Unable to reach")) {
      throw new HttpsError("unavailable", "Unable to reach Gemini API.");
    }
    throw new HttpsError("internal", error.message);
  }

  return { research };
});

// ── Firestore trigger: auto-generate or queue on new books ───────────────────

exports.onBooksChanged = onDocumentWritten(
  { document: "users/{uid}/catalog/data", secrets: [geminiApiKey] },
  async (event) => {
    const before = event.data.before.exists ? event.data.before.data() : {};
    const after  = event.data.after.exists  ? event.data.after.data()  : {};

    const beforeIds  = new Set((before.books || []).map(b => b.id));
    const afterCache = after.researchCache || {};

    // Only act on genuinely new books that have no briefing yet.
    // This guard also prevents infinite loops when we write researchCache back.
    const newBooks = (after.books || []).filter(
      b => b.id && !beforeIds.has(b.id) && !afterCache[b.id]
    );
    if (!newBooks.length) return;

    const uid = event.params.uid;
    const ref = db.collection("users").doc(uid).collection("catalog").doc("data");

    if (newBooks.length <= THRESHOLD) {
      // Generate immediately, one at a time with a short delay
      const cache = { ...afterCache };
      for (const book of newBooks) {
        try {
          const research = await callGeminiForBook(sanitizeBook(book), geminiApiKey.value());
          cache[book.id] = research;
          await ref.update({ researchCache: cache });
        } catch (err) {
          console.error(`[onBooksChanged] Failed briefing for "${book.title}":`, err.message);
        }
        await new Promise(r => setTimeout(r, 3000));
      }
    } else {
      // Too many to generate inline — queue them for the scheduled function
      const existing = Array.isArray(after.pendingBriefingIds) ? after.pendingBriefingIds : [];
      const toQueue  = newBooks.map(b => b.id).filter(id => !existing.includes(id));
      if (toQueue.length) {
        await ref.update({ pendingBriefingIds: [...existing, ...toQueue] });
      }
    }
  }
);

// ── Scheduled: drain the pending queue every 2 hours ─────────────────────────

exports.processPendingBriefings = onSchedule(
  { schedule: "every 2 hours", secrets: [geminiApiKey] },
  async () => {
    // List all users and check each one's catalog for a pending queue
    const usersSnap = await db.collection("users").listDocuments();
    for (const userRef of usersSnap) {
      const catalogRef = userRef.collection("catalog").doc("data");
      const snap = await catalogRef.get();
      if (!snap.exists) continue;

      const data    = snap.data();
      const pending = Array.isArray(data.pendingBriefingIds) ? data.pendingBriefingIds : [];
      if (!pending.length) continue;

      const cache     = { ...(data.researchCache || {}) };
      const remaining = [...pending];

      for (const id of [...pending]) {
        // Skip if already generated (e.g. user manually generated it)
        if (cache[id]) {
          remaining.splice(remaining.indexOf(id), 1);
          continue;
        }
        // Skip if book no longer exists (was deleted while queued)
        const book = (data.books || []).find(b => b.id === id);
        if (!book) {
          remaining.splice(remaining.indexOf(id), 1);
          continue;
        }

        try {
          cache[id] = await callGeminiForBook(sanitizeBook(book), geminiApiKey.value());
          remaining.splice(remaining.indexOf(id), 1);
          await catalogRef.update({ researchCache: cache, pendingBriefingIds: remaining });
        } catch (err) {
          console.error(`[processPendingBriefings] Failed for "${book.title}":`, err.message);
        }
        await new Promise(r => setTimeout(r, 3500));
      }
    }
  }
);

// ────────────────────────────────────────────────────────────────────────────

function buildPrompt(book) {
  return [
    "Create a structured, college-level book briefing.",
    "Write as though leading a strong classroom or book club discussion.",
    "Use the supplied metadata only as guidance; do not invent certainty.",
    "",
    "Book metadata:",
    `Title: ${book.title || "Unknown"}`,
    `Author: ${book.author || "Unknown"}`,
    `Year: ${book.year || "Unknown"}`,
    `Publisher: ${book.publisher || "Unknown"}`,
    `Edition: ${book.edition || "Unknown"}`,
    `ISBN: ${book.isbn || "Unknown"}`,
    `Subjects: ${book.subjects || "Unknown"}`,
    `Notes: ${book.notes || "None"}`,
    "",
    "Return valid JSON. First, set genre, then populate the fields for that genre.",
    "",
    '--- Always ---',
    'genre: "fiction" or "non-fiction" — decide based on the book.',
    "quick_take: 2 to 4 spoiler-free sentences summarizing what the book is and why it matters.",
    "major_themes: 3 to 6 concise bullet-style strings.",
    "historical_context: one paragraph.",
    "impact: one paragraph on why the work matters and how it lands.",
    "confidence_note: mention ambiguity, factual uncertainty, or edition limits when relevant.",
    "",
    "--- If fiction: provide BOTH spoiler and spoiler-free versions of these four fields ---",
    "summary_spoiler: full plot synopsis with spoilers in one or two paragraphs.",
    "summary_safe: premise and setup only — no major reveals, twists, or endings.",
    "key_elements_spoiler: 3 to 6 bullet-style strings about characters including arcs and fates.",
    "key_elements_safe: 3 to 6 bullet-style strings introducing characters without revealing spoilers.",
    "craft_analysis_spoiler: one or two paragraphs about style, structure, symbols, or technique — may reference plot freely.",
    "craft_analysis_safe: one or two paragraphs about style and technique without revealing plot points.",
    "discussion_questions_spoiler: 6 strong seminar questions that may reference the full plot.",
    "discussion_questions_safe: 6 strong seminar questions safe for someone who has not finished the book.",
    "Do NOT populate the singular summary, key_elements, craft_analysis, or discussion_questions fields for fiction.",
    "",
    "--- If non-fiction: use these singular fields (no spoiler variants needed) ---",
    "summary: the core argument, thesis, and structure of the book in one or two paragraphs.",
    "key_elements: 3 to 6 bullet-style strings about key concepts, figures, or frameworks.",
    "craft_analysis: one or two paragraphs about methodology, argument quality, evidence, and structure.",
    "discussion_questions: 6 strong seminar questions.",
    "key_takeaways: 3 to 6 bullet-style strings of actionable insights or lessons.",
    "Do NOT populate the _spoiler or _safe paired fields for non-fiction."
  ].join("\n");
}

function sanitizeBook(book) {
  const source = book && typeof book === "object" ? book : {};
  return {
    title:     cleanText(source.title),
    author:    cleanText(source.author),
    year:      cleanText(source.year),
    publisher: cleanText(source.publisher),
    edition:   cleanText(source.edition),
    isbn:      cleanText(source.isbn),
    subjects:  cleanText(source.subjects),
    notes:     cleanText(source.notes)
  };
}

function cleanText(value) {
  return String(value || "").trim().slice(0, 600);
}

function extractCandidateText(data) {
  const parts = (((data || {}).candidates || [])[0] || {}).content?.parts || [];
  const text = parts.map((part) => part.text || "").join("").trim();
  if (!text) { throw new Error("No candidate text."); }
  return text;
}

function parseResearchJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) { return JSON.parse(match[0]); }
    throw new Error("Could not parse JSON.");
  }
}

// ═══════════════════════════════════════════════════════════════
// Photo-based book lookup — accepts images, extracts metadata
// via Gemini, then queries Google Books / Open Library
// ═══════════════════════════════════════════════════════════════

const extractionSchema = {
  type: "object",
  properties: {
    isbn_13:        { type: "string" },
    isbn_10:        { type: "string" },
    title:          { type: "string" },
    subtitle:       { type: "string" },
    authors:        { type: "array", items: { type: "string" } },
    publisher:      { type: "string" },
    published_year: { type: "string" },
    edition:        { type: "string" },
    confidence:     { type: "number" },
    source_visible: { type: "array", items: { type: "string" } },
    notes:          { type: "string" }
  },
  required: ["title", "confidence", "source_visible"]
};

exports.analyzeBookPhoto = onCall({
  secrets: [geminiApiKey],
  maxInstances: 10,
  timeoutSeconds: 60
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const images = request.data && request.data.images;
  if (!Array.isArray(images) || images.length === 0 || images.length > 3) {
    throw new HttpsError("invalid-argument", "Provide 1 to 3 images.");
  }

  // Step 1: Send images to Gemini for bibliographic extraction
  const imageParts = images.map((img) => ({
    inline_data: {
      mime_type: img.mimeType || "image/jpeg",
      data: img.data
    }
  }));

  const payload = {
    contents: [{
      role: "user",
      parts: [
        ...imageParts,
        {
          text: [
            "Extract all visible bibliographic metadata from these book images.",
            "Look for: ISBN (on barcode, copyright page, or back cover),",
            "title, subtitle, author names, publisher, publication year, edition info.",
            "Only report what you can actually read in the images.",
            "Use empty string for fields you cannot determine.",
            "For confidence: 0.0 to 1.0 where 1.0 means all key fields are clearly readable.",
            "For source_visible: list what each image shows,",
            "e.g. 'title page', 'copyright page', 'front cover', 'back cover barcode'.",
            "If a barcode is visible, carefully read the ISBN digits beneath or from the barcode.",
            "Return JSON only."
          ].join(" ")
        }
      ]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1024,
      responseMimeType: "application/json",
      responseJsonSchema: extractionSchema,
      thinkingConfig: { thinkingBudget: 0 }
    }
  };

  let extracted;
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": geminiApiKey.value()
      },
      body: JSON.stringify(payload)
    });
    const rawText = await res.text();
    if (!res.ok) {
      console.error("Gemini extraction error", res.status, rawText.slice(0, 500));
      throw new Error(`HTTP ${res.status}`);
    }
    extracted = parseResearchJson(extractCandidateText(JSON.parse(rawText)));
  } catch (error) {
    console.error("Gemini extraction failed:", error.message);
    throw new HttpsError("internal", "Image analysis failed.");
  }

  // Normalize extracted fields (empty string → null for scalars)
  extracted = {
    isbn_13:        extracted.isbn_13 || null,
    isbn_10:        extracted.isbn_10 || null,
    title:          extracted.title || null,
    subtitle:       extracted.subtitle || null,
    authors:        Array.isArray(extracted.authors) ? extracted.authors.filter(Boolean) : [],
    publisher:      extracted.publisher || null,
    published_year: extracted.published_year || null,
    edition:        extracted.edition || null,
    confidence:     typeof extracted.confidence === "number" ? extracted.confidence : null,
    source_visible: Array.isArray(extracted.source_visible) ? extracted.source_visible : [],
    notes:          extracted.notes || null
  };

  // Step 2: Query book databases
  const candidates = [];
  const cleanIsbn = (v) => String(v || "").replace(/[^0-9X]/gi, "");
  const isbn = cleanIsbn(extracted.isbn_13) || cleanIsbn(extracted.isbn_10);
  const isValidIsbn = isbn.length === 10 || isbn.length === 13;

  if (isValidIsbn) {
    await searchByIsbn(isbn, candidates);
  }

  // Fallback: title + author search
  if (candidates.length === 0 && extracted.title) {
    await searchByTitleAuthor(extracted.title, extracted.authors[0] || "", candidates);
  }

  // Score and sort candidates
  for (const c of candidates) {
    c.confidence = scoreCandidate(c, extracted);
  }
  candidates.sort((a, b) => b.confidence - a.confidence);

  const bestMatch = candidates.length > 0 && candidates[0].confidence >= 0.3
    ? candidates[0] : null;

  const message = bestMatch
    ? `Found: "${bestMatch.title}" (${bestMatch.source.replace(/_/g, " ")})`
    : candidates.length > 0
      ? "Possible matches found — review candidates below."
      : extracted.title
        ? "No database match. Using extracted metadata."
        : "Could not read enough from the images. Try clearer photos of the title page or copyright page.";

  return {
    success: true,
    method: "photo_lookup",
    message,
    extracted,
    candidates: candidates.slice(0, 8),
    bestMatch
  };
});

// --- Book database search helpers ---

async function searchByIsbn(isbn, candidates) {
  // Google Books by ISBN
  try {
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
    const data = await res.json();
    if (data.totalItems > 0) {
      for (const item of (data.items || []).slice(0, 3)) {
        candidates.push(formatGBCandidate(item));
      }
    }
  } catch (e) { console.error("GB ISBN search:", e.message); }

  // Open Library by ISBN
  try {
    const res = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
    const data = await res.json();
    const book = data[`ISBN:${isbn}`];
    if (book) {
      candidates.push(formatOLApiCandidate(book, isbn));
    }
  } catch (e) { console.error("OL ISBN search:", e.message); }
}

async function searchByTitleAuthor(title, author, candidates) {
  // Google Books by title + author
  try {
    const terms = [];
    if (title) terms.push(`intitle:${title}`);
    if (author) terms.push(`inauthor:${author}`);
    const res = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(terms.join(" "))}&maxResults=5`
    );
    const data = await res.json();
    for (const item of (data.items || []).slice(0, 5)) {
      candidates.push(formatGBCandidate(item));
    }
  } catch (e) { console.error("GB title search:", e.message); }

  // Open Library by title
  try {
    const q = encodeURIComponent(title + (author ? " " + author : ""));
    const res = await fetch(`https://openlibrary.org/search.json?q=${q}&limit=5`);
    const data = await res.json();
    for (const doc of (data.docs || []).slice(0, 3)) {
      candidates.push(formatOLSearchCandidate(doc));
    }
  } catch (e) { console.error("OL title search:", e.message); }
}

// --- Candidate normalization ---

function formatGBCandidate(item) {
  const v = item.volumeInfo || {};
  const ids = v.industryIdentifiers || [];
  const isbn13 = (ids.find((i) => i.type === "ISBN_13") || {}).identifier || "";
  const isbn10 = (ids.find((i) => i.type === "ISBN_10") || {}).identifier || "";
  return {
    source: "google_books",
    title: v.title || "",
    subtitle: v.subtitle || "",
    authors: v.authors || [],
    publisher: v.publisher || "",
    publishedDate: v.publishedDate || "",
    isbn_13: isbn13,
    isbn_10: isbn10,
    description: (v.description || "").slice(0, 500),
    coverUrl: v.imageLinks ? (v.imageLinks.thumbnail || v.imageLinks.smallThumbnail || "") : "",
    pageCount: v.pageCount || 0,
    categories: v.categories || [],
    confidence: 0
  };
}

function formatOLApiCandidate(book, isbn) {
  return {
    source: "open_library",
    title: book.title || "",
    subtitle: book.subtitle || "",
    authors: (book.authors || []).map((a) => a.name),
    publisher: (book.publishers || []).map((p) => p.name).join(", "),
    publishedDate: book.publish_date || "",
    isbn_13: isbn.length === 13 ? isbn : "",
    isbn_10: isbn.length === 10 ? isbn : "",
    description: typeof book.notes === "string" ? book.notes.slice(0, 500) : "",
    coverUrl: book.cover ? (book.cover.medium || book.cover.small || "") : "",
    pageCount: book.number_of_pages || 0,
    categories: (book.subjects || []).slice(0, 5).map((s) => s.name || s),
    confidence: 0
  };
}

function formatOLSearchCandidate(doc) {
  return {
    source: "open_library",
    title: doc.title || "",
    subtitle: "",
    authors: Array.isArray(doc.author_name) ? doc.author_name : [],
    publisher: Array.isArray(doc.publisher) ? doc.publisher[0] || "" : "",
    publishedDate: doc.first_publish_year ? String(doc.first_publish_year) : "",
    isbn_13: Array.isArray(doc.isbn) ? (doc.isbn.find((i) => i.length === 13) || "") : "",
    isbn_10: Array.isArray(doc.isbn) ? (doc.isbn.find((i) => i.length === 10) || "") : "",
    description: "",
    coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : "",
    pageCount: 0,
    categories: Array.isArray(doc.subject) ? doc.subject.slice(0, 5) : [],
    confidence: 0
  };
}

// --- Candidate scoring ---

function scoreCandidate(candidate, extracted) {
  let score = 0;
  let weight = 0;

  // ISBN match is very strong signal
  const cIsbn = (candidate.isbn_13 || candidate.isbn_10 || "").replace(/[^0-9X]/gi, "");
  const eIsbn = (extracted.isbn_13 || extracted.isbn_10 || "").replace(/[^0-9X]/gi, "");
  if (cIsbn && eIsbn && cIsbn === eIsbn) {
    score += 0.5;
    weight += 0.5;
  }

  // Title similarity
  if (extracted.title && candidate.title) {
    score += wordOverlap(extracted.title, candidate.title) * 0.3;
    weight += 0.3;
  }

  // Author match
  if (extracted.authors.length > 0 && candidate.authors.length > 0) {
    score += wordOverlap(extracted.authors[0], candidate.authors[0]) * 0.2;
    weight += 0.2;
  }

  return weight > 0 ? score / weight : 0;
}

function wordOverlap(a, b) {
  if (!a || !b) return 0;
  const aWords = new Set(a.toLowerCase().split(/\s+/));
  const bWords = new Set(b.toLowerCase().split(/\s+/));
  let overlap = 0;
  for (const w of aWords) {
    if (bWords.has(w)) overlap++;
  }
  return overlap / Math.max(aWords.size, bWords.size);
}

// ═══════════════════════════════════════════════════════════════
// Bulk Load — identify every book visible in a shelf/stack photo
// ═══════════════════════════════════════════════════════════════

const bulkBooksSchema = {
  type: "object",
  properties: {
    books: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title:  { type: "string" },
          author: { type: "string" }
        },
        required: ["title", "author"]
      }
    }
  },
  required: ["books"]
};

exports.identifyBooksInImage = onCall({
  secrets: [geminiApiKey],
  maxInstances: 5,
  timeoutSeconds: 90
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const image = request.data && request.data.image;
  const mode  = (request.data && request.data.mode) === "text" ? "text" : "books";

  if (!image || !image.data) {
    throw new HttpsError("invalid-argument", "An image is required.");
  }

  // "text" mode: find book titles mentioned in an article / reading list / bibliography.
  // "books" mode: identify book spines / covers visible in a photo.
  const promptText = mode === "text"
    ? [
        "This image contains text — it may be an article, review, reading list, bibliography, or similar.",
        "Find every book title and author name mentioned in the text.",
        "Include a book even if only the title is visible; use an empty string for author when not given.",
        "Focus on proper book titles, not incidental words.",
        "Return ONLY a JSON object: { \"books\": [ { \"title\": \"...\", \"author\": \"...\" } ] }.",
        "If no book titles are found, return { \"books\": [] }.",
        "Do not include any other text outside the JSON."
      ].join(" ")
    : [
        "Examine this image carefully and identify every book you can see.",
        "For each book, extract the title and the author's name.",
        "Include every book visible — even if partially obscured — as long as you can read the title.",
        "If the author name is not visible for a book, use an empty string for author.",
        "Return ONLY a JSON object: { \"books\": [ { \"title\": \"...\", \"author\": \"...\" } ] }.",
        "If no books are identifiable, return { \"books\": [] }.",
        "Do not include any other text outside the JSON."
      ].join(" ");

  // Text reading is well within gemini-2.5-flash; shelf photos need the heavier model.
  const apiUrl = mode === "text" ? API_URL : BULK_API_URL;

  const payload = {
    contents: [{
      role: "user",
      parts: [
        { inline_data: { mime_type: image.mimeType || "image/jpeg", data: image.data } },
        { text: promptText }
      ]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
      responseJsonSchema: bulkBooksSchema
    }
  };

  let res;
  try {
    res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": geminiApiKey.value() },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    throw new HttpsError("unavailable", "Unable to reach Gemini API.");
  }

  const rawText = await res.text();
  if (!res.ok) {
    console.error("Gemini bulk ID error", res.status, rawText.slice(0, 500));
    throw new HttpsError("internal", `Gemini request failed (HTTP ${res.status}).`);
  }

  let parsed;
  try {
    parsed = parseResearchJson(extractCandidateText(JSON.parse(rawText)));
  } catch (err) {
    console.error("Gemini bulk ID parse error:", err.message);
    throw new HttpsError("internal", "Could not parse Gemini response.");
  }

  const books = Array.isArray(parsed.books)
    ? parsed.books.filter((b) => b && String(b.title || "").trim())
    : [];
  return { books };
});
