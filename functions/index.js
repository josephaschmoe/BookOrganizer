"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten }  = require("firebase-functions/v2/firestore");
const { onSchedule }         = require("firebase-functions/v2/scheduler");
const { defineSecret }       = require("firebase-functions/params");
const crypto = require("crypto");
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();

const geminiApiKey      = defineSecret("GEMINI_API_KEY");
const perplexityApiKey  = defineSecret("PERPLEXITY_API_KEY");

const MODEL = "gemini-2.5-flash";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const SCRIPT_MODEL = "gemini-2.5-pro";
const SCRIPT_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${SCRIPT_MODEL}:generateContent`;
const TTS_MODEL = "gemini-2.5-pro-preview-tts";
const TTS_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent`;
const DEFAULT_AUDIO_VOICE = "Kore";
const AUDIO_VOICES = new Set(["Kore", "Puck", "Charon"]);

const PERPLEXITY_MODEL   = "sonar-pro";
const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";

// Books published 2024 or later get Perplexity (web-grounded, post-cutoff)
function isRecentBook(book) {
  const year = parseInt(String(book.year || ""), 10);
  return !isNaN(year) && year >= 2024;
}

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

// ── Retry helper for transient API errors ────────────────────────────────────
// Retries on 429 (rate-limit) and 5xx (transient server errors).
// Returns the final Response object; caller decides whether it's ok.

async function fetchWithRetry(url, options, { maxRetries = 2, baseDelayMs = 1200 } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, options);
    const isTransient = res.status === 429 || res.status >= 500;
    if (!isTransient || attempt === maxRetries) return res;
    const wait = baseDelayMs * Math.pow(2, attempt); // 1.2s, 2.4s
    console.warn(`[fetchWithRetry] HTTP ${res.status} on attempt ${attempt + 1}, retrying in ${wait}ms…`);
    await new Promise(r => setTimeout(r, wait));
  }
}

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

  const geminiResponse = await fetchWithRetry(API_URL, {
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

// ── Perplexity Sonar briefing helper (web-grounded, for recent books) ────────

async function callPerplexityForBook(book, apiKey) {
  const payload = {
    model: PERPLEXITY_MODEL,
    messages: [
      {
        role: "system",
        content: [
          "You are a precise book discussion assistant for both fiction and non-fiction.",
          "Create a college-level book briefing.",
          "Search the web for accurate, up-to-date information about this book.",
          "First decide if the book is fiction or non-fiction, then populate the genre-appropriate fields.",
          "For fiction, provide both spoiler and spoiler-free versions of certain fields as instructed.",
          "Separate factual claims from interpretation when uncertainty exists.",
          "If the book is obscure, the title is ambiguous, or the details may be wrong, say so clearly in confidence_note.",
          "Return valid JSON only — no markdown fences, no backticks, no extra text before or after the JSON object."
        ].join(" ")
      },
      { role: "user", content: buildPrompt(book) }
    ],
    max_tokens: 6144,
    temperature: 0.4,
    return_images: false,
    return_related_questions: false
  };

  const response = await fetchWithRetry(PERPLEXITY_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify(payload)
  });

  const rawText = await response.text();
  if (!response.ok) {
    let apiError = {};
    try { apiError = JSON.parse(rawText); } catch { /* ignore */ }
    console.error("Perplexity API error", response.status, JSON.stringify(apiError));
    throw new Error(`Perplexity request failed (HTTP ${response.status})`);
  }

  let parsedApi;
  try { parsedApi = JSON.parse(rawText); }
  catch { throw new Error("Perplexity returned unreadable JSON"); }

  const text = ((parsedApi.choices || [])[0] || {}).message?.content || "";
  if (!text) throw new Error("No content in Perplexity response");

  const research = parseResearchJson(text);
  research.generated_at = new Date().toISOString();
  research.model = `perplexity-${PERPLEXITY_MODEL}`;
  return research;
}

// ── Route to the right model based on publication year ───────────────────────

async function callBriefingForBook(book, geminiKey, pplxKey) {
  return isRecentBook(book)
    ? callPerplexityForBook(book, pplxKey)
    : callGeminiForBook(book, geminiKey);
}

// ── onCall: manual generate (user-triggered) ─────────────────────────────────

exports.generateBriefing = onCall({ secrets: [geminiApiKey, perplexityApiKey] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const book = sanitizeBook(request.data && request.data.book);
  if (!book.title) {
    throw new HttpsError("invalid-argument", "Book title is required.");
  }

  let research;
  try {
    research = await callBriefingForBook(book, geminiApiKey.value(), perplexityApiKey.value());
  } catch (error) {
    throw new HttpsError("internal", error.message);
  }

  return { research };
});

exports.generateBriefingAudio = onCall({
  secrets: [geminiApiKey],
  timeoutSeconds: 300,
  memory: "1GiB"
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const uid = request.auth.uid;
  const bookId = cleanText((request.data || {}).bookId || "");
  const spoilerMode = cleanText((request.data || {}).spoilerMode || "");
  const voice = cleanText((request.data || {}).voice || DEFAULT_AUDIO_VOICE);
  const forceRefresh = Boolean((request.data || {}).forceRefresh);

  if (!bookId) {
    throw new HttpsError("invalid-argument", "bookId is required.");
  }

  try {
    const result = await buildBriefingAudio(uid, bookId, spoilerMode, voice, forceRefresh, geminiApiKey.value());
    const signed = result.metadata && result.metadata.audioPath
      ? await getPlayableAudioUrl(result.metadata.audioPath)
      : { audioUrl: "" };
    return {
      ok: true,
      spoilerMode: result.variantKey,
      metadata: result.metadata,
      cached: result.cached,
      audioUrl: signed.audioUrl
    };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error("[generateBriefingAudio] failed:", error && error.message ? error.message : error);
    return {
      ok: false,
      error: error && error.message ? error.message : "Unknown audio generation error."
    };
  }
});

exports.getBriefingAudio = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const uid = request.auth.uid;
  const bookId = cleanText((request.data || {}).bookId || "");
  const requestedMode = cleanText((request.data || {}).spoilerMode || "");
  if (!bookId) throw new HttpsError("invalid-argument", "bookId is required.");

  const briefingSnap = await db.collection("users").doc(uid).collection("briefings").doc(bookId).get();
  if (!briefingSnap.exists) throw new HttpsError("not-found", "Briefing not found.");
  const isFiction = String((briefingSnap.data() || {}).genre || "").toLowerCase() !== "non-fiction";
  const variantKey = normalizeSpoilerMode(requestedMode, isFiction);

  const audioSnap = await briefingAudioDocRef(uid, bookId).get();
  if (!audioSnap.exists) throw new HttpsError("not-found", "Audio has not been generated for this book.");
  const variant = audioVariantFromDoc(audioSnap.data(), variantKey);
  if (!variant || variant.status !== "ready" || !variant.audioPath) {
    throw new HttpsError("not-found", "Audio has not been generated for this mode.");
  }

  const signed = await getPlayableAudioUrl(variant.audioPath);
  return {
    spoilerMode: variantKey,
    voice: variant.voice || DEFAULT_AUDIO_VOICE,
    durationSec: variant.durationSec || 0,
    generatedAt: variant.generatedAt || "",
    ...signed
  };
});

// ── Firestore trigger: auto-generate or queue on new books ───────────────────

exports.onBooksChanged = onDocumentWritten(
  { document: "users/{uid}/catalog/data", secrets: [geminiApiKey, perplexityApiKey] },
  async (event) => {
    const before = event.data.before.exists ? event.data.before.data() : {};
    const after  = event.data.after.exists  ? event.data.after.data()  : {};

    const beforeIds = new Set((before.books || []).map(b => b.id));

    const uid         = event.params.uid;
    const dataRef     = db.collection("users").doc(uid).collection("catalog").doc("data");
    const briefingsCol = db.collection("users").doc(uid).collection("briefings");

    // Check which new books already have a briefing doc in the subcollection.
    const candidateBooks = (after.books || []).filter(b => b.id && !beforeIds.has(b.id));
    if (!candidateBooks.length) return;

    // Fetch existing briefing docs in one batch (up to 30 ids per call)
    const existingSnaps = await Promise.all(candidateBooks.map(b => briefingsCol.doc(b.id).get()));
    const existingIds   = new Set(existingSnaps.filter(s => s.exists).map(s => s.id));

    // Only act on genuinely new books that have no briefing yet.
    const newBooks = candidateBooks.filter(b => !existingIds.has(b.id));
    if (!newBooks.length) return;

    if (newBooks.length <= THRESHOLD) {
      // Generate immediately, one at a time with a short delay
      const failedIds = [];
      for (const book of newBooks) {
        try {
          const research = await callBriefingForBook(sanitizeBook(book), geminiApiKey.value(), perplexityApiKey.value());
          await briefingsCol.doc(book.id).set(research);
        } catch (err) {
          console.error(`[onBooksChanged] Failed briefing for "${book.title}":`, err.message);
          failedIds.push(book.id);
        }
        await new Promise(r => setTimeout(r, 3000));
      }
      // Queue any failures for the scheduled retry function (runs every 2 hours)
      if (failedIds.length) {
        const existing = Array.isArray(after.pendingBriefingIds) ? after.pendingBriefingIds : [];
        const toQueue  = failedIds.filter(id => !existing.includes(id));
        if (toQueue.length) {
          await dataRef.update({ pendingBriefingIds: [...existing, ...toQueue] });
        }
      }
    } else {
      // Too many to generate inline — queue them for the scheduled function
      const existing = Array.isArray(after.pendingBriefingIds) ? after.pendingBriefingIds : [];
      const toQueue  = newBooks.map(b => b.id).filter(id => !existing.includes(id));
      if (toQueue.length) {
        await dataRef.update({ pendingBriefingIds: [...existing, ...toQueue] });
      }
    }
  }
);

// ── Scheduled: drain the pending queue every 2 hours ─────────────────────────

exports.processPendingBriefings = onSchedule(
  { schedule: "every 2 hours", secrets: [geminiApiKey, perplexityApiKey] },
  async () => {
    // List all users and check each one's catalog for a pending queue
    const usersSnap = await db.collection("users").listDocuments();
    for (const userRef of usersSnap) {
      const dataRef      = userRef.collection("catalog").doc("data");
      const briefingsCol = userRef.collection("briefings");

      const dataSnap = await dataRef.get();
      if (!dataSnap.exists) continue;

      const data    = dataSnap.data();
      const pending = Array.isArray(data.pendingBriefingIds) ? data.pendingBriefingIds : [];
      if (!pending.length) continue;

      const remaining = [...pending];

      for (const id of [...pending]) {
        // Skip if book no longer exists (was deleted while queued)
        const book = (data.books || []).find(b => b.id === id);
        if (!book) {
          remaining.splice(remaining.indexOf(id), 1);
          continue;
        }
        // Skip if already generated (e.g. user manually generated it)
        const existingSnap = await briefingsCol.doc(id).get();
        if (existingSnap.exists) {
          remaining.splice(remaining.indexOf(id), 1);
          continue;
        }

        try {
          const research = await callBriefingForBook(sanitizeBook(book), geminiApiKey.value(), perplexityApiKey.value());
          remaining.splice(remaining.indexOf(id), 1);
          await Promise.all([
            briefingsCol.doc(id).set(research),
            dataRef.update({ pendingBriefingIds: remaining })
          ]);
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

function briefingAudioDocRef(uid, bookId) {
  return db.collection("users").doc(uid).collection("briefingAudio").doc(bookId);
}

function normalizeVoice(voice) {
  const value = cleanText(voice || DEFAULT_AUDIO_VOICE) || DEFAULT_AUDIO_VOICE;
  return AUDIO_VOICES.has(value) ? value : DEFAULT_AUDIO_VOICE;
}

function normalizeSpoilerMode(mode, isFiction) {
  if (!isFiction) return "safe";
  return String(mode || "").trim().toLowerCase() === "spoiler" ? "spoiler" : "safe";
}

function estimateDurationSec(text) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(60, Math.round((words / 150) * 60));
}

function audioVariantFromDoc(doc, variantKey) {
  const variants = doc && typeof doc.variants === "object" ? doc.variants : {};
  const variant = variants[variantKey];
  return variant && typeof variant === "object" ? variant : null;
}

async function loadBookAndBriefing(uid, bookId) {
  const catalogRef = db.collection("users").doc(uid).collection("catalog").doc("data");
  const briefingRef = db.collection("users").doc(uid).collection("briefings").doc(bookId);
  const [catalogSnap, briefingSnap] = await Promise.all([catalogRef.get(), briefingRef.get()]);

  if (!catalogSnap.exists) throw new HttpsError("not-found", "Catalog not found.");

  const catalogData = catalogSnap.data() || {};
  const rawBook = (catalogData.books || []).find((entry) => entry && entry.id === bookId);
  if (!rawBook) throw new HttpsError("not-found", "Book not found.");
  if (!briefingSnap.exists) throw new HttpsError("failed-precondition", "Generate the book briefing first.");

  return {
    book: sanitizeBook(rawBook),
    rawBook,
    briefing: briefingSnap.data() || {}
  };
}

function listToNarrationLines(items, prefix = "- ") {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  return list.length ? list.map((item) => `${prefix}${item}`).join("\n") : `${prefix}No details available.`;
}

function buildNarrationPrompt(book, briefing, spoilerMode) {
  const isFiction = String(briefing.genre || "").toLowerCase() !== "non-fiction";
  const safeMode = normalizeSpoilerMode(spoilerMode, isFiction);
  const summaryText = isFiction
    ? (safeMode === "spoiler" ? briefing.summary_spoiler : briefing.summary_safe)
    : briefing.summary;
  const keyElems = isFiction
    ? (safeMode === "spoiler" ? briefing.key_elements_spoiler : briefing.key_elements_safe)
    : briefing.key_elements;
  const craftText = isFiction
    ? (safeMode === "spoiler" ? briefing.craft_analysis_spoiler : briefing.craft_analysis_safe)
    : briefing.craft_analysis;
  const discussionList = isFiction
    ? (safeMode === "spoiler" ? briefing.discussion_questions_spoiler : briefing.discussion_questions_safe)
    : briefing.discussion_questions;

  return [
    `Book title: ${book.title || "Unknown"}`,
    `Author: ${book.author || "Unknown"}`,
    `Year: ${book.year || "Unknown"}`,
    `Genre: ${briefing.genre || "Unknown"}`,
    `Spoiler mode: ${safeMode}`,
    "",
    "Use the structured briefing below as source material. Expand every section into a polished solo audio overview.",
    "Treat each heading as a chapter marker with a natural spoken transition.",
    "Do not mention JSON, metadata, bullet points, or field names.",
    "Aim for roughly 1,000 to 1,400 words and about 8 to 10 minutes of listening time.",
    isFiction
      ? "For fiction, focus on atmosphere, character arc, structure, and prose."
      : "For non-fiction, focus on utility, argument quality, key ideas, and real-world application.",
    safeMode === "spoiler"
      ? "Spoilers are allowed. Discuss the full work plainly."
      : "Do not reveal endings, twists, or late-stage character fates beyond the spoiler-safe briefing.",
    "For discussion questions, pose each question naturally to the listener and offer a brief exploratory answer.",
    "Return only the finished narration script in plain text.",
    "",
    "Quick Take",
    String(briefing.quick_take || ""),
    "",
    isFiction ? "Plot Summary" : "Overview",
    String(summaryText || ""),
    "",
    "Major Themes",
    listToNarrationLines(briefing.major_themes),
    "",
    isFiction ? "Characters" : "Key Concepts and Figures",
    listToNarrationLines(keyElems),
    "",
    "Historical and Cultural Context",
    String(briefing.historical_context || ""),
    "",
    isFiction ? "Literary Analysis" : "Analysis and Methodology",
    String(craftText || ""),
    "",
    !isFiction ? "Key Takeaways" : "",
    !isFiction ? listToNarrationLines(briefing.key_takeaways) : "",
    !isFiction ? "" : "",
    "Impact",
    String(briefing.impact || ""),
    "",
    "Discussion Questions",
    listToNarrationLines(discussionList),
    "",
    "Confidence Note",
    String(briefing.confidence_note || "")
  ].filter(Boolean).join("\n");
}

async function generateNarrationScript(book, briefing, spoilerMode, apiKey) {
  const payload = {
    system_instruction: {
      parts: [{
        text: [
          "You are an expert literary podcaster creating a solo Audio Overview of a book.",
          "Do not summarize the summary. Expand each supplied section into a full discussion.",
          "Use a conversational, intellectual, accessible tone in the spirit of a public-radio deep dive.",
          "Use clear transitions such as moving into the narrative structure or historical context.",
          "Treat the provided headers as chapter markers.",
          "Return plain text only."
        ].join(" ")
      }]
    },
    contents: [{ role: "user", parts: [{ text: buildNarrationPrompt(book, briefing, spoilerMode) }] }],
    generationConfig: {
      temperature: 0.7,
      topP: 0.9,
      topK: 32,
      maxOutputTokens: 3072
    }
  };

  async function requestScript(url, modelName) {
    let response;
    try {
      response = await fetchWithRetry(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      throw new Error(`Unable to reach Gemini narration API on ${modelName}.`);
    }

    const rawText = await response.text();
    if (!response.ok) {
      let apiError = {};
      try { apiError = JSON.parse(rawText); } catch { /* ignore */ }
      const apiMessage = apiError && apiError.error && apiError.error.message
        ? apiError.error.message
        : `HTTP ${response.status}`;
      console.error(`Gemini script generation error (${modelName})`, response.status, JSON.stringify(apiError));
      const error = new Error(`Narration script request failed on ${modelName}: ${apiMessage}`);
      error.status = response.status;
      throw error;
    }

    let parsedApi;
    try { parsedApi = JSON.parse(rawText); }
    catch { throw new Error(`Gemini returned unreadable narration output on ${modelName}.`); }

    const script = extractCandidateText(parsedApi).trim();
    if (!script) throw new Error(`Gemini returned an empty narration script on ${modelName}.`);
    return { script, modelName };
  }

  try {
    const primary = await requestScript(SCRIPT_API_URL, SCRIPT_MODEL);
    return primary.script;
  } catch (error) {
    if (error && error.status === 400) {
      const fallback = await requestScript(API_URL, MODEL);
      return fallback.script;
    }
    throw error;
  }
}

function extractAudioBase64(data) {
  const parts = (((data || {}).candidates || [])[0] || {}).content?.parts || [];
  for (const part of parts) {
    const inlineData = part && part.inlineData;
    if (inlineData && inlineData.data) return inlineData.data;
  }
  throw new Error("No audio returned by Gemini TTS.");
}

function pcmToWavBuffer(pcmBuffer, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

async function synthesizeNarrationAudio(script, voice, apiKey) {
  const payload = {
    contents: [{ parts: [{ text: script }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: voice
          }
        }
      }
    }
  };

  let response;
  try {
    response = await fetchWithRetry(TTS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    throw new Error("Unable to reach Gemini TTS API.");
  }

  const rawText = await response.text();
  if (!response.ok) {
    let apiError = {};
    try { apiError = JSON.parse(rawText); } catch { /* ignore */ }
    console.error("Gemini TTS error", response.status, JSON.stringify(apiError));
    throw new Error(`Narration audio request failed (HTTP ${response.status})`);
  }

  let parsedApi;
  try { parsedApi = JSON.parse(rawText); }
  catch { throw new Error("Gemini returned unreadable audio output."); }

  const pcm = Buffer.from(extractAudioBase64(parsedApi), "base64");
  return pcmToWavBuffer(pcm);
}

async function buildBriefingAudio(uid, bookId, spoilerMode, voice, forceRefresh, apiKey) {
  console.log(`[buildBriefingAudio] start bookId=${bookId} spoilerMode=${spoilerMode || "safe"} forceRefresh=${forceRefresh ? "1" : "0"}`);
  const { book, briefing } = await loadBookAndBriefing(uid, bookId);
  console.log(`[buildBriefingAudio] loaded book="${book.title}" briefingModel=${briefing.model || "unknown"}`);
  const isFiction = String(briefing.genre || "").toLowerCase() !== "non-fiction";
  const variantKey = normalizeSpoilerMode(spoilerMode, isFiction);
  const audioRef = briefingAudioDocRef(uid, bookId);
  const audioSnap = await audioRef.get();
  const audioDoc = audioSnap.exists ? (audioSnap.data() || {}) : {};
  const currentVariant = audioVariantFromDoc(audioDoc, variantKey);
  const normalizedVoice = normalizeVoice(voice);
  const sourceBriefingGeneratedAt = String(briefing.generated_at || "");

  if (
    !forceRefresh &&
    currentVariant &&
    currentVariant.status === "ready" &&
    currentVariant.voice === normalizedVoice &&
    currentVariant.sourceBriefingGeneratedAt === sourceBriefingGeneratedAt &&
    currentVariant.audioPath
  ) {
    return {
      variantKey,
      metadata: currentVariant,
      cached: true
    };
  }

  const startedAt = new Date().toISOString();
  await audioRef.set({
    updatedAt: startedAt,
    variants: {
      [variantKey]: {
        status: "generating",
        voice: normalizedVoice,
        generatedAt: startedAt,
        sourceBriefingGeneratedAt
      }
    }
  }, { merge: true });

  try {
    console.log(`[buildBriefingAudio] generating script via ${SCRIPT_MODEL} variant=${variantKey}`);
    const script = await generateNarrationScript(book, briefing, variantKey, apiKey);
    console.log(`[buildBriefingAudio] script ready chars=${script.length}`);
    console.log(`[buildBriefingAudio] synthesizing audio via ${TTS_MODEL} voice=${normalizedVoice}`);
    const wavBuffer = await synthesizeNarrationAudio(script, normalizedVoice, apiKey);
    console.log(`[buildBriefingAudio] audio ready bytes=${wavBuffer.length}`);
    const audioPath = `users/${uid}/briefing-audio/${bookId}-${variantKey}.wav`;
    const file = admin.storage().bucket().file(audioPath);
    console.log(`[buildBriefingAudio] saving audio path=${audioPath}`);
    await file.save(wavBuffer, {
      resumable: false,
      metadata: {
        contentType: "audio/wav",
        cacheControl: "private, max-age=3600"
      }
    });
    console.log(`[buildBriefingAudio] storage save complete path=${audioPath}`);

    const metadata = {
      status: "ready",
      audioPath,
      voice: normalizedVoice,
      generatedAt: new Date().toISOString(),
      sourceBriefingGeneratedAt,
      scriptModel: SCRIPT_MODEL,
      ttsModel: TTS_MODEL,
      durationSec: estimateDurationSec(script),
      script
    };

    await audioRef.set({
      updatedAt: metadata.generatedAt,
      variants: { [variantKey]: metadata }
    }, { merge: true });
    console.log(`[buildBriefingAudio] metadata saved variant=${variantKey}`);

    return { variantKey, metadata, cached: false };
  } catch (error) {
    console.error(`[buildBriefingAudio] failed variant=${variantKey}:`, error && error.message ? error.message : error);
    await audioRef.set({
      updatedAt: new Date().toISOString(),
      variants: {
        [variantKey]: {
          status: "error",
          voice: normalizedVoice,
          generatedAt: startedAt,
          sourceBriefingGeneratedAt,
          error: error && error.message ? error.message : "Unknown audio generation error."
        }
      }
    }, { merge: true });
    throw error;
  }
}

async function getPlayableAudioUrl(audioPath) {
  const file = admin.storage().bucket().file(audioPath);
  const [exists] = await file.exists();
  if (!exists) throw new HttpsError("not-found", "Audio file not found.");
  const [metadata] = await file.getMetadata();
  let token = metadata && metadata.metadata && metadata.metadata.firebaseStorageDownloadTokens
    ? String(metadata.metadata.firebaseStorageDownloadTokens).split(",")[0].trim()
    : "";
  if (!token) {
    token = crypto.randomUUID();
    await file.setMetadata({
      metadata: {
        ...(metadata && metadata.metadata ? metadata.metadata : {}),
        firebaseStorageDownloadTokens: token
      }
    });
  }
  const bucket = admin.storage().bucket().name;
  const encodedPath = encodeURIComponent(audioPath);
  return {
    audioUrl: `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}?alt=media&token=${token}`
  };
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
    const res = await fetchWithRetry(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": geminiApiKey.value()
      },
      body: JSON.stringify(payload)
    }, { maxRetries: 2, baseDelayMs: 800 });
    const rawText = await res.text();
    if (!res.ok) {
      console.error("Gemini extraction error", res.status, rawText.slice(0, 500));
      throw new Error(`HTTP ${res.status}`);
    }
    // Also retry on empty candidates (occasional safety filter false positive)
    const parsed = JSON.parse(rawText);
    const parts = (((parsed || {}).candidates || [])[0] || {}).content?.parts || [];
    if (!parts.length) {
      // One extra attempt on a blank candidate response
      console.warn("[analyzeBookPhoto] Empty candidate on first try, retrying once…");
      const res2 = await fetchWithRetry(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": geminiApiKey.value() },
        body: JSON.stringify(payload)
      }, { maxRetries: 1, baseDelayMs: 1000 });
      const raw2 = await res2.text();
      if (!res2.ok) throw new Error(`HTTP ${res2.status}`);
      extracted = parseResearchJson(extractCandidateText(JSON.parse(raw2)));
    } else {
      extracted = parseResearchJson(extractCandidateText(parsed));
    }
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
// Wikipedia article resolver — returns exact Wikipedia page titles
// for a book and its primary author using Gemini knowledge
// ═══════════════════════════════════════════════════════════════

const wikiArticleSchema = {
  type: "object",
  properties: {
    book_article:   { type: "string" },
    author_article: { type: "string" }
  },
  required: ["book_article", "author_article"]
};

exports.resolveWikipediaArticles = onCall({ secrets: [geminiApiKey] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const title  = cleanText((request.data || {}).title  || "");
  const author = cleanText((request.data || {}).author || "");
  if (!title) throw new HttpsError("invalid-argument", "Book title is required.");

  const prompt = [
    `Book title: "${title}"`,
    `Author: "${author}"`,
    "",
    "Return the exact Wikipedia article titles for:",
    "1. book_article — the Wikipedia article specifically about this book.",
    "   Return empty string if no dedicated article exists or you are not confident.",
    "2. author_article — the Wikipedia article about the PRIMARY author.",
    "   If multiple authors are listed, use only the first/main one.",
    "   Return empty string if you are not confident.",
    "",
    "Rules:",
    "- Use the exact title as it appears in Wikipedia, including capitalisation,",
    "  punctuation, and any parenthetical disambiguation (e.g. \"The Road (novel)\",",
    "  \"What Is Life?\", \"Lincoln (novel)\").",
    "- Return empty string — never null — for any article you cannot confidently identify.",
    "- Return JSON only."
  ].join("\n");

  const payload = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 128,
      responseMimeType: "application/json",
      responseJsonSchema: wikiArticleSchema,
      thinkingConfig: { thinkingBudget: 0 }
    }
  };

  let res;
  try {
    res = await fetchWithRetry(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": geminiApiKey.value() },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    throw new HttpsError("unavailable", "Unable to reach Gemini API.");
  }

  const rawText = await res.text();
  if (!res.ok) {
    console.error("resolveWikipediaArticles Gemini error", res.status, rawText.slice(0, 300));
    throw new HttpsError("internal", `Gemini request failed (HTTP ${res.status}).`);
  }

  let parsed;
  try {
    parsed = parseResearchJson(extractCandidateText(JSON.parse(rawText)));
  } catch (err) {
    throw new HttpsError("internal", "Could not parse Gemini response.");
  }

  return {
    book_article:   String(parsed.book_article   || "").trim(),
    author_article: String(parsed.author_article || "").trim()
  };
});

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
    res = await fetchWithRetry(apiUrl, {
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

// ─── Share Link Functions ────────────────────────────────────────────────────

/**
 * createShareLink — generates a public read-only share token for one shelf.
 * One active token per shelf (revokes any prior token for the same shelf).
 */
exports.createShareLink = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const uid                = request.auth.uid;
  const shelfId            = String((request.data || {}).shelfId || "").trim();
  const includePersonalNotes = Boolean((request.data || {}).includePersonalNotes);
  const allowWikiAI          = Boolean((request.data || {}).allowWikiAI);
  const allowBriefingAudio   = Boolean((request.data || {}).allowBriefingAudio);

  if (!shelfId) throw new HttpsError("invalid-argument", "shelfId is required.");

  const catalogRef = db.collection("users").doc(uid).collection("catalog").doc("data");
  const snap = await catalogRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Catalog not found.");

  const data  = snap.data();
  const shelf = (data.shelves || []).find((s) => s.id === shelfId);
  if (!shelf) throw new HttpsError("not-found", "Shelf not found.");

  const existingLinks = data.shareLinks || {};
  const existingToken = Object.keys(existingLinks).find((t) => existingLinks[t].shelfId === shelfId);

  const token = crypto.randomBytes(16).toString("hex");
  const createdAt = Date.now();

  const batch = db.batch();

  if (existingToken) {
    batch.delete(db.collection("shareLinks").doc(existingToken));
  }

  batch.set(db.collection("shareLinks").doc(token), {
    ownerUid: uid,
    shelfId,
    includePersonalNotes,
    allowWikiAI,
    allowBriefingAudio,
    createdAt,
  });

  const updatedLinks = { ...existingLinks };
  if (existingToken) delete updatedLinks[existingToken];
  updatedLinks[token] = { shelfId, shelfName: shelf.name, includePersonalNotes, allowWikiAI, allowBriefingAudio, createdAt };
  batch.update(catalogRef, { shareLinks: updatedLinks });

  await batch.commit();
  return { token };
});

/**
 * getSharedShelf — unauthenticated endpoint; returns filtered shelf data for a share token.
 */
exports.getSharedShelf = onCall(async (request) => {
  const token = String((request.data || {}).token || "").trim();
  if (!token) throw new HttpsError("invalid-argument", "token is required.");

  const tokenDoc = await db.collection("shareLinks").doc(token).get();
  if (!tokenDoc.exists) throw new HttpsError("not-found", "Share link not found or expired.");

  const { ownerUid, shelfId, includePersonalNotes, allowWikiAI, allowBriefingAudio } = tokenDoc.data();

  const catalogRef   = db.collection("users").doc(ownerUid).collection("catalog");
  const briefingsCol = db.collection("users").doc(ownerUid).collection("briefings");
  const briefingAudioCol = db.collection("users").doc(ownerUid).collection("briefingAudio");

  const catalogSnap = await catalogRef.doc("data").get();
  if (!catalogSnap.exists) throw new HttpsError("not-found", "Library not found.");

  const catalogData = catalogSnap.data();
  const shelf = (catalogData.shelves || []).find((s) => s.id === shelfId);
  if (!shelf) throw new HttpsError("not-found", "Shelf no longer exists.");

  const shelfBooks = (catalogData.books || [])
    .filter((b) => (b.listShelfId || "default") === shelfId)
    .map((b) => {
      const out = { ...b };
      if (!includePersonalNotes) delete out.personalNotes;
      return out;
    });

  // Fetch briefings only for books on this shelf (avoids reading the whole subcollection).
  const shelfBookIds = new Set(shelfBooks.map((b) => b.id));
  const briefingSnaps = await Promise.all(
    [...shelfBookIds].map(id => briefingsCol.doc(id).get())
  );
  const filteredCache = {};
  briefingSnaps.forEach(snap => {
    if (snap.exists) filteredCache[snap.id] = snap.data();
  });

  // Legacy fallback for accounts not yet migrated to the subcollection.
  if (Object.keys(filteredCache).length === 0) {
    const researchSnap = await catalogRef.doc("research").get();
    const legacyCache  = (researchSnap.exists && researchSnap.data().researchCache)
      ? researchSnap.data().researchCache
      : (catalogData.researchCache || {});
    for (const [id, briefing] of Object.entries(legacyCache)) {
      if (shelfBookIds.has(id)) filteredCache[id] = briefing;
    }
  }

  let briefingAudioCache = {};
  if (allowBriefingAudio && shelfBookIds.size) {
    const audioSnaps = await Promise.all([...shelfBookIds].map((id) => briefingAudioCol.doc(id).get()));
    audioSnaps.forEach((snap) => {
      if (!snap.exists) return;
      const data = snap.data() || {};
      const variants = data.variants && typeof data.variants === "object" ? data.variants : {};
      const sanitized = {};
      Object.entries(variants).forEach(([key, value]) => {
        if (!value || typeof value !== "object" || value.status !== "ready") return;
        sanitized[key] = {
          status: value.status,
          voice: value.voice || DEFAULT_AUDIO_VOICE,
          generatedAt: value.generatedAt || "",
          durationSec: value.durationSec || 0,
          sourceBriefingGeneratedAt: value.sourceBriefingGeneratedAt || ""
        };
      });
      if (Object.keys(sanitized).length) briefingAudioCache[snap.id] = { variants: sanitized };
    });
  }

  return {
    shelfName: shelf.name,
    shelfId,
    includePersonalNotes,
    allowWikiAI: Boolean(allowWikiAI),
    allowBriefingAudio: Boolean(allowBriefingAudio),
    books: shelfBooks,
    researchCache: filteredCache,
    briefingAudioCache
  };
});

exports.getSharedBriefingAudio = onCall(async (request) => {
  const token = cleanText((request.data || {}).token || "");
  const bookId = cleanText((request.data || {}).bookId || "");
  const requestedMode = cleanText((request.data || {}).spoilerMode || "");

  if (!token) throw new HttpsError("invalid-argument", "token is required.");
  if (!bookId) throw new HttpsError("invalid-argument", "bookId is required.");

  const tokenDoc = await db.collection("shareLinks").doc(token).get();
  if (!tokenDoc.exists) throw new HttpsError("not-found", "Share link not found or expired.");
  if (!tokenDoc.data().allowBriefingAudio) {
    throw new HttpsError("permission-denied", "Briefing audio is not enabled for this share link.");
  }

  const ownerUid = tokenDoc.data().ownerUid;
  const shelfId = tokenDoc.data().shelfId;
  const catalogSnap = await db.collection("users").doc(ownerUid).collection("catalog").doc("data").get();
  if (!catalogSnap.exists) throw new HttpsError("not-found", "Library not found.");
  const catalogData = catalogSnap.data() || {};
  const onSharedShelf = (catalogData.books || []).some((book) => book && book.id === bookId && (book.listShelfId || "default") === shelfId);
  if (!onSharedShelf) {
    throw new HttpsError("permission-denied", "This book is not part of the shared shelf.");
  }

  const briefingSnap = await db.collection("users").doc(ownerUid).collection("briefings").doc(bookId).get();
  if (!briefingSnap.exists) throw new HttpsError("not-found", "Briefing not found.");
  const isFiction = String((briefingSnap.data() || {}).genre || "").toLowerCase() !== "non-fiction";
  const variantKey = normalizeSpoilerMode(requestedMode, isFiction);

  const audioSnap = await briefingAudioDocRef(ownerUid, bookId).get();
  if (!audioSnap.exists) throw new HttpsError("not-found", "Audio has not been generated for this book.");
  const variant = audioVariantFromDoc(audioSnap.data(), variantKey);
  if (!variant || variant.status !== "ready" || !variant.audioPath) {
    throw new HttpsError("not-found", "Audio has not been generated for this mode.");
  }

  const signed = await getPlayableAudioUrl(variant.audioPath);
  return {
    spoilerMode: variantKey,
    voice: variant.voice || DEFAULT_AUDIO_VOICE,
    durationSec: variant.durationSec || 0,
    generatedAt: variant.generatedAt || "",
    ...signed
  };
});

/**
 * resolveWikipediaArticlesShared — like resolveWikipediaArticles but for
 * share viewers. Validates token exists and has allowWikiAI: true before
 * calling Gemini; the token itself acts as the authorization credential.
 */
exports.resolveWikipediaArticlesShared = onCall({ secrets: [geminiApiKey] }, async (request) => {
  const token  = cleanText((request.data || {}).token  || "");
  const title  = cleanText((request.data || {}).title  || "");
  const author = cleanText((request.data || {}).author || "");

  if (!token) throw new HttpsError("invalid-argument", "token is required.");
  if (!title) throw new HttpsError("invalid-argument", "Book title is required.");

  const tokenDoc = await db.collection("shareLinks").doc(token).get();
  if (!tokenDoc.exists) throw new HttpsError("not-found", "Share link not found or expired.");
  if (!tokenDoc.data().allowWikiAI) {
    throw new HttpsError("permission-denied", "AI Wikipedia lookup is not enabled for this share link.");
  }

  const prompt = [
    `Book title: "${title}"`,
    `Author: "${author}"`,
    "",
    "Return the exact Wikipedia article titles for:",
    "1. book_article — the Wikipedia article specifically about this book.",
    "   Return empty string if no dedicated article exists or you are not confident.",
    "2. author_article — the Wikipedia article about the PRIMARY author.",
    "   If multiple authors are listed, use only the first/main one.",
    "   Return empty string if you are not confident.",
    "",
    "Rules:",
    "- Use the exact title as it appears in Wikipedia, including capitalisation,",
    "  punctuation, and any parenthetical disambiguation (e.g. \"The Road (novel)\",",
    "  \"What Is Life?\", \"Lincoln (novel)\").",
    "- Return empty string — never null — for any article you cannot confidently identify.",
    "- Return JSON only."
  ].join("\n");

  const payload = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 128,
      responseMimeType: "application/json",
      responseJsonSchema: wikiArticleSchema,
      thinkingConfig: { thinkingBudget: 0 }
    }
  };

  let res;
  try {
    res = await fetchWithRetry(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": geminiApiKey.value() },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    throw new HttpsError("unavailable", "Unable to reach Gemini API.");
  }

  const rawText = await res.text();
  if (!res.ok) {
    console.error("resolveWikipediaArticlesShared Gemini error", res.status, rawText.slice(0, 300));
    throw new HttpsError("internal", `Gemini request failed (HTTP ${res.status}).`);
  }

  let parsed;
  try {
    parsed = parseResearchJson(extractCandidateText(JSON.parse(rawText)));
  } catch (err) {
    throw new HttpsError("internal", "Could not parse Gemini response.");
  }

  return {
    book_article:   String(parsed.book_article   || "").trim(),
    author_article: String(parsed.author_article || "").trim()
  };
});

/**
 * revokeShareLink — deletes a share token (owner only).
 */
exports.revokeShareLink = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const uid   = request.auth.uid;
  const token = String((request.data || {}).token || "").trim();
  if (!token) throw new HttpsError("invalid-argument", "token is required.");

  const tokenDoc = await db.collection("shareLinks").doc(token).get();
  if (!tokenDoc.exists) return { revoked: false };

  if (tokenDoc.data().ownerUid !== uid) {
    throw new HttpsError("permission-denied", "Not your share link.");
  }

  const catalogRef = db.collection("users").doc(uid).collection("catalog").doc("data");
  const batch = db.batch();
  batch.delete(db.collection("shareLinks").doc(token));
  const update = {};
  update[`shareLinks.${token}`] = admin.firestore.FieldValue.delete();
  batch.update(catalogRef, update);

  await batch.commit();
  return { revoked: true };
});
