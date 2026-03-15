"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten, onDocumentCreated }  = require("firebase-functions/v2/firestore");
const { onSchedule }         = require("firebase-functions/v2/scheduler");
const { defineSecret }       = require("firebase-functions/params");
const crypto = require("crypto");
const JSZip = require("jszip");
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
const AUDIO_GENERATING_STALE_MS = 20 * 60 * 1000;
const DAILY_BRIEFING_LIMIT = 100;
const BRIEFING_ADMIN_PASSWORD = "";

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
    discussion_questions_safe:    { type: "array", items: { type: "string" } },
    // reference singular fields
    editorial_approach:           { type: "string" },
    contents_overview:            { type: "array", items: { type: "string" } },
    production_notes:             { type: "string" },
    notable_features:             { type: "array", items: { type: "string" } },
    ideal_for:                    { type: "string" }
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
          "You are a precise book discussion assistant for fiction, non-fiction, and reference books.",
          "Create a college-level book briefing.",
          "Search the web for accurate, up-to-date information about this book.",
          "First decide if the book is fiction, non-fiction, or reference, then populate the genre-appropriate fields.",
          "For fiction, provide both spoiler and spoiler-free versions of certain fields as instructed.",
          "Reference books are primarily consulted rather than read straight through.",
          "If the book straddles reference and non-fiction, classify by primary use and note the ambiguity in confidence_note.",
          "Verify specific factual claims before asserting them, especially content divisions, volume scope, edition details, recipes, techniques, and reference-book section breakdowns.",
          "Treat Unknown or blank metadata as missing, not as evidence.",
          "Inline source references inside JSON string values are allowed when they help anchor verified facts.",
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
  return callPerplexityForBook(book, pplxKey);
}

// ── onCall: manual generate (user-triggered) ─────────────────────────────────

exports.generateBriefing = onCall({ secrets: [geminiApiKey, perplexityApiKey] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const uid = request.auth.uid;
  const book = sanitizeBook(request.data && request.data.book);
  const adminPassword = cleanText(request.data && request.data.adminPassword);
  if (!book.title) {
    throw new HttpsError("invalid-argument", "Book title is required.");
  }

  const quota = await reserveBriefingQuota(uid, adminPassword);
  if (!quota.allowed) {
    throw new HttpsError(
      "resource-exhausted",
      `Daily Book Briefing limit reached (${DAILY_BRIEFING_LIMIT}).`,
      { reason: `Daily Book Briefing limit reached (${DAILY_BRIEFING_LIMIT}).` }
    );
  }

  let research;
  try {
    research = await callBriefingForBook(book, geminiApiKey.value(), perplexityApiKey.value());
  } catch (error) {
    throw new HttpsError("internal", error.message);
  }

  return { research };
});

exports.generateBriefingAudio = onCall(async (request) => {
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
    const { briefing } = await loadBookAndBriefing(uid, bookId);
    const isFiction = String(briefing.genre || "").toLowerCase() !== "non-fiction";
    const variantKey = normalizeSpoilerMode(spoilerMode, isFiction);
    const normalizedVoice = normalizeVoice(voice);
    const sourceBriefingGeneratedAt = String(briefing.generated_at || "");
    const audioRef = briefingAudioDocRef(uid, bookId);
    const audioSnap = await audioRef.get();
    const audioDoc = audioSnap.exists ? (audioSnap.data() || {}) : {};
    const currentVariant = audioVariantFromDoc(audioDoc, variantKey);

    if (
      !forceRefresh &&
      currentVariant &&
      currentVariant.status === "ready" &&
      currentVariant.voice === normalizedVoice &&
      currentVariant.sourceBriefingGeneratedAt === sourceBriefingGeneratedAt &&
      currentVariant.audioPath
    ) {
      const signed = await getPlayableStorageUrl(currentVariant.audioPath);
      return {
        ok: true,
        queued: false,
        cached: true,
        spoilerMode: variantKey,
        metadata: currentVariant,
        audioUrl: signed.audioUrl
      };
    }

    if (
      !forceRefresh &&
      currentVariant &&
      currentVariant.status === "generating" &&
      !isGeneratingVariantStale(currentVariant) &&
      currentVariant.voice === normalizedVoice &&
      currentVariant.sourceBriefingGeneratedAt === sourceBriefingGeneratedAt
    ) {
      return {
        ok: true,
        queued: true,
        spoilerMode: variantKey,
        metadata: currentVariant
      };
    }

    const now = new Date().toISOString();
    const generatingMetadata = {
      status: "generating",
      voice: normalizedVoice,
      generatedAt: now,
      sourceBriefingGeneratedAt
    };
    await audioRef.set({
      updatedAt: now,
      variants: {
        [variantKey]: generatingMetadata
      }
    }, { merge: true });

    const jobId = db.collection("_").doc().id;
    await briefingAudioJobRef(uid, jobId).set({
      status: "queued",
      bookId,
      spoilerMode: variantKey,
      voice: normalizedVoice,
      forceRefresh,
      createdAt: now,
      updatedAt: now
    });

    return {
      ok: true,
      queued: true,
      jobId,
      spoilerMode: variantKey,
      metadata: generatingMetadata
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
  const isFiction = String((briefingSnap.data() || {}).genre || "").toLowerCase() === "fiction";
  const variantKey = normalizeSpoilerMode(requestedMode, isFiction);

  const audioSnap = await briefingAudioDocRef(uid, bookId).get();
  if (!audioSnap.exists) throw new HttpsError("not-found", "Audio has not been generated for this book.");
  const variant = audioVariantFromDoc(audioSnap.data(), variantKey);
  if (!variant || variant.status !== "ready" || !variant.audioPath) {
    throw new HttpsError("not-found", "Audio has not been generated for this mode.");
  }

  const signed = await getPlayableStorageUrl(variant.audioPath);
  return {
    spoilerMode: variantKey,
    voice: variant.voice || DEFAULT_AUDIO_VOICE,
    durationSec: variant.durationSec || 0,
    generatedAt: variant.generatedAt || "",
    ...signed
  };
});

exports.requestBackupExport = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const uid = request.auth.uid;
  const backupId = db.collection("_").doc().id;
  const now = new Date().toISOString();
  await backupJobRef(uid, backupId).set({
    status: "queued",
    createdAt: now,
    updatedAt: now
  });
  return { ok: true, backupId };
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
      for (let idx = 0; idx < newBooks.length; idx++) {
        const book = newBooks[idx];
        const quota = await reserveBriefingQuota(uid);
        if (!quota.allowed) {
          failedIds.push(...newBooks.slice(idx).map((entry) => entry.id));
          break;
        }
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

        const quota = await reserveBriefingQuota(userRef.id);
        if (!quota.allowed) {
          await dataRef.update({ pendingBriefingIds: remaining });
          break;
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

exports.processBackupExportJob = onDocumentCreated(
  {
    document: "users/{uid}/backupJobs/{backupId}",
    timeoutSeconds: 540,
    memory: "1GiB"
  },
  async (event) => {
    const uid = event.params.uid;
    const backupId = event.params.backupId;
    const jobRef = backupJobRef(uid, backupId);
    await jobRef.set({
      status: "running",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, { merge: true });

    try {
      console.log(`[processBackupExportJob] start uid=${uid} backupId=${backupId}`);
      const result = await buildBackupZipForUser(uid);
      const downloadable = await getPlayableStorageUrl(result.backupPath);
      const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
      await jobRef.set({
        status: "ready",
        finishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        backupPath: result.backupPath,
        downloadUrl: downloadable.audioUrl,
        schemaVersion: result.manifest.schemaVersion,
        assetCount: Array.isArray(result.manifest.assets) ? result.manifest.assets.length : 0,
        bookCount: Array.isArray(result.manifest.books) ? result.manifest.books.length : 0,
        exportStats: result.exportStats || {},
        expiresAt
      }, { merge: true });
      console.log(`[processBackupExportJob] ready backupId=${backupId}`);
    } catch (error) {
      console.error("[processBackupExportJob] failed:", error && error.message ? error.message : error);
      await jobRef.set({
        status: "error",
        finishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        error: error && error.message ? error.message : "Backup export failed."
      }, { merge: true });
    }
  }
);

exports.processBriefingAudioJob = onDocumentCreated(
  {
    document: "users/{uid}/briefingAudioJobs/{jobId}",
    timeoutSeconds: 540,
    memory: "1GiB",
    secrets: [geminiApiKey]
  },
  async (event) => {
    const uid = event.params.uid;
    const jobId = event.params.jobId;
    const jobRef = briefingAudioJobRef(uid, jobId);
    const job = event.data && typeof event.data.data === "function" ? (event.data.data() || {}) : {};
    const bookId = cleanText(job.bookId || "");
    const spoilerMode = cleanText(job.spoilerMode || "safe");
    const voice = cleanText(job.voice || DEFAULT_AUDIO_VOICE);
    const forceRefresh = Boolean(job.forceRefresh);

    await jobRef.set({
      status: "running",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, { merge: true });

    try {
      if (!bookId) throw new Error("bookId is required.");
      console.log(`[processBriefingAudioJob] start uid=${uid} jobId=${jobId} bookId=${bookId} spoilerMode=${spoilerMode}`);
      const result = await buildBriefingAudio(uid, bookId, spoilerMode, voice, forceRefresh, geminiApiKey.value());
      await jobRef.set({
        status: "ready",
        finishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        bookId,
        spoilerMode: result.variantKey,
        cached: Boolean(result.cached),
        audioPath: result.metadata && result.metadata.audioPath ? result.metadata.audioPath : "",
        durationSec: result.metadata && result.metadata.durationSec ? result.metadata.durationSec : 0
      }, { merge: true });
      console.log(`[processBriefingAudioJob] ready uid=${uid} jobId=${jobId} bookId=${bookId} spoilerMode=${result.variantKey}`);
    } catch (error) {
      console.error("[processBriefingAudioJob] failed:", error && error.message ? error.message : error);
      await jobRef.set({
        status: "error",
        finishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        error: error && error.message ? error.message : "Audio generation failed."
      }, { merge: true });
    }
  }
);

exports.cleanupExpiredBackupExports = onSchedule(
  { schedule: "every 24 hours" },
  async () => {
    const nowIso = new Date().toISOString();
    const expiredSnap = await db.collectionGroup("backupJobs")
      .where("status", "==", "ready")
      .where("expiresAt", "<=", nowIso)
      .get();

    for (const doc of expiredSnap.docs) {
      const data = doc.data() || {};
      const backupPath = String(data.backupPath || "");
      if (backupPath) {
        try { await admin.storage().bucket().file(backupPath).delete({ ignoreNotFound: true }); } catch (error) {
          console.warn("[cleanupExpiredBackupExports] storage delete failed:", backupPath, error && error.message ? error.message : error);
        }
      }
      await doc.ref.set({
        status: "expired",
        updatedAt: new Date().toISOString(),
        downloadUrl: "",
        backupPath: ""
      }, { merge: true });
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
    'genre: "fiction", "non-fiction", or "reference" — decide based on the book\'s primary purpose.',
    "- fiction: novels, stories, narrative poetry",
    "- non-fiction: books that argue, analyze, or narrate (history, biography, memoir, criticism, science)",
    "- reference: books primarily consulted rather than read (cookbooks, field guides, how-to, craft manuals, travel guides, practical references)",
    "quick_take: 2 to 4 spoiler-free sentences summarizing what the book is and why it matters.",
    "major_themes: 3 to 6 concise bullet-style strings.",
    "historical_context: one paragraph.",
    "impact: one paragraph on why the work matters and how it lands.",
    "confidence_note: mention ambiguity, factual uncertainty, edition limits, and classification ambiguity when relevant.",
    "If the book straddles reference and non-fiction, classify by primary use and note the ambiguity in confidence_note.",
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
    "Do NOT populate the singular non-fiction or reference fields for fiction.",
    "",
    "--- If non-fiction: use these singular fields (no spoiler variants needed) ---",
    "summary: the core argument, thesis, and structure of the book in one or two paragraphs.",
    "key_elements: 3 to 6 bullet-style strings about key concepts, figures, or frameworks.",
    "craft_analysis: one or two paragraphs about methodology, argument quality, evidence, and structure.",
    "discussion_questions: 6 strong seminar questions.",
    "key_takeaways: 3 to 6 bullet-style strings of actionable insights or lessons.",
    "Do NOT populate the fiction or reference fields for non-fiction.",
    "",
    "--- If reference (cookbooks, field guides, how-to, craft manuals, catalogs, practical guides): use these singular fields ---",
    "editorial_approach: one or two paragraphs on the book's organizational logic, target audience, and overall philosophy or point of view.",
    "contents_overview: 3 to 6 bullet-style strings describing the major sections, categories, recipe types, or structural components.",
    "production_notes: one paragraph on format, visual design, photography or illustration quality, writing style, and usability as a practical object.",
    "notable_features: 3 to 6 bullet-style strings on what makes this book distinctive — signature recipes or entries, unusual techniques, cultural specificity, standout design choices.",
    "ideal_for: 2 to 4 sentences describing the best audience for this book and how they would realistically use it.",
    "Do NOT populate the fiction or non-fiction fields for reference.",
    "",
    "--- Additional Perplexity Verification Rules ---",
    "Use web search to verify factual claims about publication history, plot content, chapter or canto coverage, character identities, edition-specific details, and the practical scope of reference books.",
    "Treat metadata fields with values like Unknown, None, or blank as missing hints rather than evidence.",
    "For claims about specific contents, volume divisions, chapter ranges, canto ranges, subtitles, edition details, recipes, techniques, or section breakdowns, only state them if you found a confirming source.",
    "If you cannot verify a specific claim, say so explicitly in the relevant field and in confidence_note.",
    "Within JSON string values, you may include compact inline source references like [Source: https://example.com] or [Sources: https://a, https://b] for verified factual claims.",
    "If a factual claim is only weakly supported, prefer uncertainty language over confident synthesis."
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

function todayUsageKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

async function reserveBriefingQuota(uid, adminPassword = "") {
  const override = cleanText(adminPassword) === BRIEFING_ADMIN_PASSWORD;
  if (override) {
    return { allowed: true, overridden: true, limit: DAILY_BRIEFING_LIMIT };
  }

  const dayKey = todayUsageKey();
  const ref = db.collection("users").doc(uid).collection("briefingUsage").doc(dayKey);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? (snap.data() || {}) : {};
    const count = Number(data.count || 0);
    if (count >= DAILY_BRIEFING_LIMIT) {
      return { allowed: false, overridden: false, limit: DAILY_BRIEFING_LIMIT, count, dayKey };
    }
    tx.set(ref, {
      count: count + 1,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    return { allowed: true, overridden: false, limit: DAILY_BRIEFING_LIMIT, count: count + 1, dayKey };
  });
}

function sanitizeBriefingAudioForBackup(audioCache) {
  const out = {};
  Object.entries(audioCache || {}).forEach(([bookId, doc]) => {
    const variants = doc && typeof doc.variants === "object" ? doc.variants : {};
    const sanitizedVariants = {};
    Object.entries(variants).forEach(([variant, entry]) => {
      if (!entry || typeof entry !== "object") return;
      sanitizedVariants[variant] = {
        status: entry.status || "",
        voice: entry.voice || "",
        generatedAt: entry.generatedAt || "",
        sourceBriefingGeneratedAt: entry.sourceBriefingGeneratedAt || "",
        scriptModel: entry.scriptModel || "",
        ttsModel: entry.ttsModel || "",
        durationSec: entry.durationSec || 0,
        audioPath: entry.audioPath || ""
      };
      if (entry.error) sanitizedVariants[variant].error = entry.error;
    });
    if (Object.keys(sanitizedVariants).length) {
      out[bookId] = {
        updatedAt: doc && doc.updatedAt ? doc.updatedAt : "",
        variants: sanitizedVariants
      };
    }
  });
  return out;
}

function extensionFromPath(filePath, fallback = "") {
  const match = String(filePath || "").match(/(\.[a-z0-9]+)(?:\?|$)/i);
  return match ? match[1].toLowerCase() : fallback;
}

async function addStorageFileToZip(zip, storagePath, pathInZip) {
  const file = admin.storage().bucket().file(storagePath);
  const [exists] = await file.exists();
  if (!exists) return false;
  const [buffer] = await file.download();
  zip.file(pathInZip, buffer);
  return true;
}

async function buildBackupZipForUser(uid) {
  console.log(`[buildBackupZipForUser] start uid=${uid}`);
  const catalogRef = db.collection("users").doc(uid).collection("catalog").doc("data");
  const briefingsCol = db.collection("users").doc(uid).collection("briefings");
  const briefingAudioCol = db.collection("users").doc(uid).collection("briefingAudio");

  const [catalogSnap, briefingsSnap, briefingAudioSnap] = await Promise.all([
    catalogRef.get(),
    briefingsCol.get(),
    briefingAudioCol.get()
  ]);

  if (!catalogSnap.exists) {
    throw new HttpsError("not-found", "Catalog not found.");
  }

  const catalogData = catalogSnap.data() || {};
  const books = Array.isArray(catalogData.books) ? catalogData.books : [];
  const shelves = Array.isArray(catalogData.shelves) ? catalogData.shelves : [];
  const briefings = {};
  briefingsSnap.forEach((doc) => { briefings[doc.id] = doc.data(); });
  const briefingAudio = {};
  briefingAudioSnap.forEach((doc) => { briefingAudio[doc.id] = doc.data(); });
  const sanitizedBriefingAudio = sanitizeBriefingAudioForBackup(briefingAudio);
  console.log(`[buildBackupZipForUser] loaded books=${books.length} briefings=${Object.keys(briefings).length} briefingAudio=${Object.keys(sanitizedBriefingAudio).length}`);

  const manifest = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    app: "TomeShelf",
    sections: {
      books: true,
      shelves: true,
      briefings: true,
      briefingAudio: true,
      assets: true
    },
    books,
    shelves,
    briefings,
    briefingAudio: sanitizedBriefingAudio,
    assets: []
  };
  const exportStats = {
    coversAdded: 0,
    coversSkipped: 0,
    audioAdded: 0,
    audioSkipped: 0
  };

  const zip = new JSZip();

  for (const book of books) {
    const bookId = String(book && book.id || "");
    if (!bookId) continue;

    for (const ext of [".jpg", ".jpeg", ".png", ".webp"]) {
      const coverStoragePath = `users/${uid}/covers/${bookId}${ext}`;
      const pathInZip = `files/covers/${bookId}${ext}`;
      try {
        if (await addStorageFileToZip(zip, coverStoragePath, pathInZip)) {
          manifest.assets.push({
            assetId: `cover-${bookId}`,
            bookId,
            kind: "cover",
            contentType: ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg",
            pathInZip,
            sourcePath: coverStoragePath
          });
          exportStats.coversAdded++;
          break;
        }
      } catch (error) {
        exportStats.coversSkipped++;
        console.warn(`[buildBackupZipForUser] cover export skipped for ${bookId}:`, error && error.message ? error.message : error);
      }
    }

    const audioDoc = sanitizedBriefingAudio[bookId];
    const variants = audioDoc && typeof audioDoc.variants === "object" ? audioDoc.variants : {};
    for (const [variant, entry] of Object.entries(variants)) {
      if (!entry || entry.status !== "ready" || !entry.audioPath) continue;
      const ext = extensionFromPath(entry.audioPath, ".wav") || ".wav";
      const pathInZip = `files/audio/${bookId}-${variant}${ext}`;
      try {
        if (await addStorageFileToZip(zip, entry.audioPath, pathInZip)) {
          manifest.assets.push({
            assetId: `audio-${bookId}-${variant}`,
            bookId,
            kind: "audio",
            variant,
            contentType: ext === ".mp3" ? "audio/mpeg" : ext === ".ogg" ? "audio/ogg" : "audio/wav",
            pathInZip,
            sourcePath: entry.audioPath
          });
          exportStats.audioAdded++;
        } else {
          exportStats.audioSkipped++;
          console.warn(`[buildBackupZipForUser] audio file missing for ${bookId}/${variant}: ${entry.audioPath}`);
        }
      } catch (error) {
        exportStats.audioSkipped++;
        console.warn(`[buildBackupZipForUser] audio export skipped for ${bookId}/${variant}:`, error && error.message ? error.message : error);
      }
    }
  }

  console.log(`[buildBackupZipForUser] assets prepared coversAdded=${exportStats.coversAdded} coversSkipped=${exportStats.coversSkipped} audioAdded=${exportStats.audioAdded} audioSkipped=${exportStats.audioSkipped}`);
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  console.log("[buildBackupZipForUser] generating zip buffer");
  const archiveBuffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });
  console.log(`[buildBackupZipForUser] zip generated bytes=${archiveBuffer.length}`);

  const backupPath = `users/${uid}/backups/tomeshelf-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
  const file = admin.storage().bucket().file(backupPath);
  console.log(`[buildBackupZipForUser] saving zip path=${backupPath}`);
  await file.save(archiveBuffer, {
    resumable: false,
    metadata: {
      contentType: "application/zip",
      cacheControl: "private, max-age=3600"
    }
  });
  console.log(`[buildBackupZipForUser] zip saved path=${backupPath}`);

  return {
    backupPath,
    manifest,
    exportStats
  };
}

function backupJobRef(uid, backupId) {
  return db.collection("users").doc(uid).collection("backupJobs").doc(backupId);
}

function briefingAudioJobRef(uid, jobId) {
  return db.collection("users").doc(uid).collection("briefingAudioJobs").doc(jobId);
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

function isGeneratingVariantStale(variant) {
  if (!variant || variant.status !== "generating") return false;
  const stamp = Date.parse(String(variant.generatedAt || variant.updatedAt || ""));
  if (!Number.isFinite(stamp)) return false;
  return (Date.now() - stamp) > AUDIO_GENERATING_STALE_MS;
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
  const genre = String(briefing.genre || "").toLowerCase();
  const isFiction = genre === "fiction";
  const isReference = genre === "reference";
  const safeMode = normalizeSpoilerMode(spoilerMode, isFiction);
  const summaryText = isFiction
    ? (safeMode === "spoiler" ? briefing.summary_spoiler : briefing.summary_safe)
    : (isReference ? briefing.editorial_approach : briefing.summary);
  const keyElems = isFiction
    ? (safeMode === "spoiler" ? briefing.key_elements_spoiler : briefing.key_elements_safe)
    : (isReference ? briefing.contents_overview : briefing.key_elements);
  const craftText = isFiction
    ? (safeMode === "spoiler" ? briefing.craft_analysis_spoiler : briefing.craft_analysis_safe)
    : (isReference ? briefing.production_notes : briefing.craft_analysis);
  const discussionList = isFiction
    ? (safeMode === "spoiler" ? briefing.discussion_questions_spoiler : briefing.discussion_questions_safe)
    : (isReference ? briefing.notable_features : briefing.discussion_questions);

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
      : (isReference
          ? "For reference books, focus on organization, usability, standout features, and the book as a practical object."
          : "For non-fiction, focus on utility, argument quality, key ideas, and real-world application."),
    safeMode === "spoiler"
      ? "Spoilers are allowed. Discuss the full work plainly."
      : "Do not reveal endings, twists, or late-stage character fates beyond the spoiler-safe briefing.",
    "For discussion questions, pose each question naturally to the listener and offer a brief exploratory answer.",
    "Return only the finished narration script in plain text.",
    "",
    "Quick Take",
    String(briefing.quick_take || ""),
    "",
    isFiction ? "Plot Summary" : (isReference ? "Editorial Approach" : "Overview"),
    String(summaryText || ""),
    "",
    "Major Themes",
    listToNarrationLines(briefing.major_themes),
    "",
    isFiction ? "Characters" : (isReference ? "Contents Overview" : "Key Concepts and Figures"),
    listToNarrationLines(keyElems),
    "",
    "Historical and Cultural Context",
    String(briefing.historical_context || ""),
    "",
    isFiction ? "Literary Analysis" : (isReference ? "Production Notes" : "Analysis and Methodology"),
    String(craftText || ""),
    "",
    !isFiction ? (isReference ? "Ideal For" : "Key Takeaways") : "",
    !isFiction ? (isReference ? String(briefing.ideal_for || "") : listToNarrationLines(briefing.key_takeaways)) : "",
    !isFiction ? "" : "",
    "Impact",
    String(briefing.impact || ""),
    "",
    isReference ? "Notable Features" : "Discussion Questions",
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
  const isFiction = String(briefing.genre || "").toLowerCase() === "fiction";
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

async function getPlayableStorageUrl(objectPath) {
  const file = admin.storage().bucket().file(objectPath);
  const [exists] = await file.exists();
  if (!exists) throw new HttpsError("not-found", "Storage file not found.");
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
  const encodedPath = encodeURIComponent(objectPath);
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

  const signed = await getPlayableStorageUrl(variant.audioPath);
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
