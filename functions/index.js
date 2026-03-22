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
const briefingAdminPassword = defineSecret("BRIEFING_ADMIN_PASSWORD");

const MODEL = "gemini-2.5-flash";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const SCRIPT_MODEL = "gemini-2.5-pro";
const SCRIPT_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${SCRIPT_MODEL}:generateContent`;
const PRO_TTS_MODEL = "gemini-2.5-pro-preview-tts";
const FLASH_TTS_MODEL = "gemini-2.5-flash-preview-tts";
const DEFAULT_AUDIO_VOICE = "Kore";
const AUDIO_VOICES = new Set(["Kore", "Puck", "Charon"]);
const AUDIO_GENERATING_STALE_MS = 20 * 60 * 1000;
const DAILY_BRIEFING_LIMIT = 100;

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

const RESEARCH_FIELD_KEYS = Object.keys(researchSchema.properties);
const RESEARCH_ARRAY_FIELDS = new Set(RESEARCH_FIELD_KEYS.filter((key) => researchSchema.properties[key].type === "array"));
const RESEARCH_REQUIRED_FIELDS = new Set(researchSchema.required || []);

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
          // "For fiction, provide both spoiler and spoiler-free versions of certain fields as instructed.",
          "For fiction, provide only the spoiler-free briefing fields unless both variants already exist in cached data.",
          "Do not reveal major twists, endings, hidden identities, or late-stage character revelations in the spoiler-free fiction fields.",
          "Separate factual claims from interpretation when uncertainty exists.",
          "If the book is obscure, the title is ambiguous, or the details may be wrong, say so clearly in confidence_note.",
          "Return JSON only."
        ].join(" ")
      }]
    },
    contents: [{ role: "user", parts: [{ text: buildPromptSafeOnly(book) }] }],
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
          // "For fiction, provide both spoiler and spoiler-free versions of certain fields as instructed.",
          "For fiction, provide only the spoiler-free briefing fields unless both variants already exist in cached data.",
          "Do not reveal major twists, endings, hidden identities, or late-stage character revelations in the spoiler-free fiction fields.",
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
      { role: "user", content: buildPromptSafeOnly(book) }
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

  const text = extractPerplexityMessageText(parsedApi);
  if (!text) throw new Error("No content in Perplexity response");

  let research;
  try {
    research = parseResearchJson(text);
  } catch (error) {
    console.error("Perplexity non-JSON content preview:", text.slice(0, 1200));
    try {
      research = salvageResearchJson(text);
      research.confidence_note = [
        String(research.confidence_note || "").trim(),
        "Recovered from a malformed Perplexity JSON reply; some fields may be incomplete."
      ].filter(Boolean).join(" ");
      research.recovered_from_malformed_json = true;
    } catch {
      research = buildPerplexityFallbackResearch(text, error);
    }
  }
  research.generated_at = new Date().toISOString();
  research.model = `perplexity-${PERPLEXITY_MODEL}`;
  return research;
}

// ── Route to the right model based on publication year ───────────────────────

async function callBriefingForBook(book, geminiKey, pplxKey) {
  return callPerplexityForBook(book, pplxKey);
}

// ── onCall: manual generate (user-triggered) ─────────────────────────────────

exports.generateBriefing = onCall({ secrets: [geminiApiKey, perplexityApiKey, briefingAdminPassword] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const uid = request.auth.uid;
  const book = sanitizeBook(request.data && request.data.book);
  const adminPassword = cleanText(request.data && request.data.adminPassword);
  if (!book.title) {
    throw new HttpsError("invalid-argument", "Book title is required.");
  }

  let adminState = await getAdminAccessState(uid);
  let overrideGranted = adminState.isValid;
  if (!overrideGranted && adminPassword && adminPassword === briefingAdminPassword.value()) {
    await grantAdminAccess(uid);
    adminState = await getAdminAccessState(uid);
    overrideGranted = adminState.isValid;
  }

  const quota = await reserveBriefingQuota(uid, { allowOverride: overrideGranted });
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

  return {
    research,
    adminOverrideGranted: overrideGranted,
    adminAccessValid: adminState.isValid,
    adminAccessDisabled: adminState.isDisabled,
    adminAccessStale: adminState.isStale
  };
});

exports.resolveEditionMetadata = onCall({ secrets: [perplexityApiKey] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const input = sanitizeEditionLookupInput(request.data || {});
  const extractedIsbn = cleanPossibleIsbn(input.extracted.isbn_13 || input.extracted.isbn_10 || "");
  if (!input.book.title && !input.extracted.title) {
    throw new HttpsError("invalid-argument", "Book title is required.");
  }
  if (extractedIsbn.length === 10 || extractedIsbn.length === 13) {
    throw new HttpsError("failed-precondition", "A valid ISBN was read from the image, so edition lookup is not needed.");
  }

  try {
    const metadata = await callPerplexityForEditionMetadata(input, perplexityApiKey.value());
    return { metadata };
  } catch (error) {
    throw new HttpsError("internal", error.message || "Edition lookup failed.");
  }
});

exports.generateBriefingAudio = onCall({ secrets: [briefingAdminPassword] }, async (request) => {
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
    const adminState = await getAdminAccessState(uid);
    const ttsStatus = await getProTtsAvailabilityStatus();
    const preferredTtsModel = adminState.isValid && ttsStatus.available ? PRO_TTS_MODEL : FLASH_TTS_MODEL;
    const ttsFallbackReason = adminState.isValid
      ? (ttsStatus.available ? "" : "daily-rate-limit")
      : "admin-required";
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
        audioUrl: signed.audioUrl,
        proAvailableToday: ttsStatus.available,
        adminAccessValid: adminState.isValid,
        adminAccessDisabled: adminState.isDisabled,
        adminAccessStale: adminState.isStale
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
        metadata: currentVariant,
        proAvailableToday: ttsStatus.available,
        adminAccessValid: adminState.isValid,
        adminAccessDisabled: adminState.isDisabled,
        adminAccessStale: adminState.isStale
      };
    }

    const now = new Date().toISOString();
    const generatingMetadata = {
      status: "generating",
      voice: normalizedVoice,
      generatedAt: now,
      sourceBriefingGeneratedAt,
      ttsModel: preferredTtsModel,
      ttsFallbackReason
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
      requestedTtsModel: preferredTtsModel,
      requestedTtsFallbackReason: ttsFallbackReason,
      createdAt: now,
      updatedAt: now
    });

    return {
      ok: true,
      queued: true,
      jobId,
      spoilerMode: variantKey,
      metadata: generatingMetadata,
      proAvailableToday: ttsStatus.available,
      adminAccessValid: adminState.isValid,
      adminAccessDisabled: adminState.isDisabled,
      adminAccessStale: adminState.isStale
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
    ttsModel: variant.ttsModel || "",
    ttsFallbackReason: variant.ttsFallbackReason || "",
    durationSec: variant.durationSec || 0,
    generatedAt: variant.generatedAt || "",
    ...signed
  };
});

exports.getBriefingAudioTtsStatus = onCall({ secrets: [briefingAdminPassword] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const adminState = await getAdminAccessState(request.auth.uid);
  const status = await getProTtsAvailabilityStatus();
  return {
    proAvailableToday: status.available,
    fallbackDayKey: status.dayKey,
    activeTtsModel: adminState.isValid && status.available ? PRO_TTS_MODEL : FLASH_TTS_MODEL,
    adminAccessValid: adminState.isValid,
    adminAccessDisabled: adminState.isDisabled,
    adminAccessStale: adminState.isStale,
    hasStoredAdminAccess: adminState.hasStoredAccess
  };
});

exports.getAdminAccessStatus = onCall({ secrets: [briefingAdminPassword] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const adminState = await getAdminAccessState(request.auth.uid);
  return {
    adminAccessValid: adminState.isValid,
    adminAccessDisabled: adminState.isDisabled,
    adminAccessStale: adminState.isStale,
    hasStoredAdminAccess: adminState.hasStoredAccess
  };
});

exports.setAdminAccess = onCall({ secrets: [briefingAdminPassword] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const adminPassword = cleanText(request.data && request.data.adminPassword);
  if (!adminPassword || adminPassword !== briefingAdminPassword.value()) {
    throw new HttpsError("permission-denied", "Administrative access password was not accepted.");
  }
  await grantAdminAccess(request.auth.uid);
  return {
    ok: true,
    adminAccessValid: true,
    adminAccessDisabled: false,
    adminAccessStale: false,
    hasStoredAdminAccess: true
  };
});

exports.setAdminAccessEnabled = onCall({ secrets: [briefingAdminPassword] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const enabled = Boolean(request.data && request.data.enabled);
  await setAdminAccessEnabled(request.auth.uid, enabled);
  const adminState = await getAdminAccessState(request.auth.uid);
  return {
    ok: true,
    adminAccessValid: adminState.isValid,
    adminAccessDisabled: adminState.isDisabled,
    adminAccessStale: adminState.isStale,
    hasStoredAdminAccess: adminState.hasStoredAccess
  };
});

exports.removeAdminAccess = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  await removeAdminAccessGrant(request.auth.uid);
  return {
    ok: true,
    adminAccessValid: false,
    adminAccessDisabled: false,
    adminAccessStale: false,
    hasStoredAdminAccess: false
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

exports.deleteBackupExport = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const uid = request.auth.uid;
  const backupId = cleanText((request.data || {}).backupId || "");
  if (!backupId) {
    throw new HttpsError("invalid-argument", "backupId is required.");
  }

  const jobRef = backupJobRef(uid, backupId);
  const jobSnap = await jobRef.get();
  if (!jobSnap.exists) {
    throw new HttpsError("not-found", "Backup not found.");
  }

  const job = jobSnap.data() || {};
  const status = cleanText(job.status || "");
  if (status === "queued" || status === "running") {
    throw new HttpsError("failed-precondition", "This backup is still being prepared.");
  }

  const backupPath = cleanText(job.backupPath || "");
  if (backupPath) {
    try {
      await admin.storage().bucket().file(backupPath).delete({ ignoreNotFound: true });
    } catch (error) {
      console.warn("[deleteBackupExport] storage delete failed:", backupPath, error && error.message ? error.message : error);
    }
  }

  await jobRef.set({
    status: "deleted",
    deletedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    downloadUrl: "",
    backupPath: ""
  }, { merge: true });

  return { ok: true };
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
    const requestedTtsModel = cleanText(job.requestedTtsModel || FLASH_TTS_MODEL);
    const requestedTtsFallbackReason = cleanText(job.requestedTtsFallbackReason || "");

    await jobRef.set({
      status: "running",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, { merge: true });

    try {
      if (!bookId) throw new Error("bookId is required.");
      console.log(`[processBriefingAudioJob] start uid=${uid} jobId=${jobId} bookId=${bookId} spoilerMode=${spoilerMode}`);
      const result = await buildBriefingAudio(
        uid,
        bookId,
        spoilerMode,
        voice,
        forceRefresh,
        geminiApiKey.value(),
        requestedTtsModel,
        requestedTtsFallbackReason
      );
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
    "- fiction: novels, stories, narrative poetry, dramatic monologues, epic poetry, and poetry collections",
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

function buildPromptSafeOnly(book) {
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
    // Preserved for easy restoration:
    // "--- If fiction: provide BOTH spoiler and spoiler-free versions of these four fields ---",
    // "summary_spoiler: full plot synopsis with spoilers in one or two paragraphs.",
    "summary_safe: describe only the premise, setup, and tensions established early in the book — no major reveals, twists, endings, hidden identities, or late-stage character revelations.",
    // "key_elements_spoiler: 3 to 6 bullet-style strings about characters including arcs and fates.",
    "key_elements_safe: 3 to 6 bullet-style strings introducing characters without revealing spoilers, fates, or hidden roles.",
    // "craft_analysis_spoiler: one or two paragraphs about style, structure, symbols, or technique — may reference plot freely.",
    "craft_analysis_safe: one or two paragraphs about style and technique without revealing plot points, twists, or late-stage character revelations.",
    // "discussion_questions_spoiler: 6 strong seminar questions that may reference the full plot.",
    "discussion_questions_safe: 6 strong seminar questions safe for someone who has not finished the book — do not reveal major plot twists, endings, or character revelations.",
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
    "Return JSON only — no markdown fences, no backticks, no text before or after the JSON object."
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
    contributor: cleanText(source.contributor),
    illustrationNote: cleanText(source.illustrationNote),
    isbn:      cleanText(source.isbn),
    subjects:  cleanText(source.subjects),
    notes:     cleanText(source.notes)
  };
}

function sanitizeEditionLookupInput(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const extracted = source.extracted && typeof source.extracted === "object" ? source.extracted : {};
  const candidate = source.candidate && typeof source.candidate === "object" ? source.candidate : {};
  return {
    book: sanitizeBook(source.book),
    extracted: {
      title: cleanText(extracted.title),
      subtitle: cleanText(extracted.subtitle),
      authors: Array.isArray(extracted.authors) ? extracted.authors.map(cleanText).filter(Boolean).slice(0, 6) : [],
      publisher: cleanText(extracted.publisher),
      published_year: normalizeYearText(extracted.published_year) || cleanText(extracted.published_year),
      edition: cleanText(extracted.edition),
      contributors: Array.isArray(extracted.contributors) ? extracted.contributors.map(cleanText).filter(Boolean).slice(0, 8) : [],
      illustration_note: cleanText(extracted.illustration_note),
      source_visible: Array.isArray(extracted.source_visible) ? extracted.source_visible.map(cleanText).filter(Boolean).slice(0, 6) : []
    },
    candidate: {
      title: cleanText(candidate.title),
      author: cleanText(candidate.author),
      publisher: cleanText(candidate.publisher),
      year: normalizeYearText(candidate.year) || cleanText(candidate.year),
      edition: cleanText(candidate.edition),
      contributor: cleanText(candidate.contributor),
      source: cleanText(candidate.source)
    }
  };
}

const editionMetadataSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    author: { type: "string" },
    publisher: { type: "string" },
    year: { type: "string" },
    edition: { type: "string" },
    contributor: { type: "string" },
    illustration_note: { type: "string" },
    confidence_note: { type: "string" }
  },
  required: ["title", "author", "publisher", "year", "edition", "contributor", "illustration_note", "confidence_note"]
};

function buildEditionResolutionPrompt(input) {
  const book = input.book || {};
  const extracted = input.extracted || {};
  const candidate = input.candidate || {};
  const hasExtractedContext = Boolean(
    extracted.title
    || (Array.isArray(extracted.authors) && extracted.authors.length)
    || extracted.publisher
    || extracted.published_year
    || extracted.edition
    || (Array.isArray(extracted.contributors) && extracted.contributors.length)
    || extracted.illustration_note
  );
  return [
    "Resolve the most likely specific edition of a book using web-grounded search.",
    "Return only conservative bibliographic fields you can support from reliable sources.",
    "Prefer filling missing edition-sensitive metadata rather than restating obvious fields.",
    "If a field cannot be verified confidently, return an empty string for that field.",
    "",
    ...(hasExtractedContext ? [
      "Use only the metadata read directly from the user's image as search evidence.",
      "Do not use API candidate data or current form values as evidence when they conflict with the extracted image metadata.",
      ""
    ] : [
      "Current saved / selected metadata:",
      `title: ${book.title || ""}`,
      `author: ${book.author || ""}`,
      `publisher: ${book.publisher || ""}`,
      `year: ${book.year || ""}`,
      `edition: ${book.edition || ""}`,
      `contributor: ${book.contributor || ""}`,
      `illustration note: ${book.illustrationNote || ""}`,
      `isbn: ${book.isbn || ""}`,
      ""
    ]),
    "Image-extracted metadata:",
    `title: ${extracted.title || ""}`,
    `subtitle: ${extracted.subtitle || ""}`,
    `authors: ${(extracted.authors || []).join(", ")}`,
    `publisher: ${extracted.publisher || ""}`,
    `published_year: ${extracted.published_year || ""}`,
    `edition: ${extracted.edition || ""}`,
    `contributors: ${(extracted.contributors || []).join(", ")}`,
    `illustration_note: ${extracted.illustration_note || ""}`,
    `seen_on: ${(extracted.source_visible || []).join(", ")}`,
    "",
    ...(hasExtractedContext ? [] : [
      "Best API candidate already selected in the app:",
      `title: ${candidate.title || ""}`,
      `author: ${candidate.author || ""}`,
      `publisher: ${candidate.publisher || ""}`,
      `year: ${candidate.year || ""}`,
      `edition: ${candidate.edition || ""}`,
      `contributor: ${candidate.contributor || ""}`,
      `source: ${candidate.source || ""}`,
      ""
    ]),
    "Instructions:",
    "- Search the web for the likely edition that matches the extracted image metadata.",
    "- Use contributor credits such as illustrator, editor, translator, or introduction-by when they help identify the edition.",
    "- Use publisher and publication year heavily when the image provides them.",
    "- Keep title and author only if they are clearly supported.",
    "- edition should be a concise statement such as 'First edition' or '1930 Scribner illustrated edition' only if that wording can be supported.",
    "- contributor should be the most relevant single edition-specific contributor.",
    "- illustration_note may restate a verified illustration clue if it is specific and helpful.",
    "- confidence_note should briefly say what evidence supported the result or why the edition remains uncertain.",
    "- Return JSON only."
  ].join("\n");
}

async function callPerplexityForEditionMetadata(input, apiKey) {
  const payload = {
    model: PERPLEXITY_MODEL,
    messages: [
      {
        role: "system",
        content: [
          "You are a careful bibliographic edition resolver.",
          "Search the web to identify the most likely specific edition of a book.",
          "Prefer conservative accuracy over completeness.",
          "Only fill fields that can be supported by reliable web sources.",
          "Return JSON only."
        ].join(" ")
      },
      { role: "user", content: buildEditionResolutionPrompt(input) }
    ],
    max_tokens: 900,
    temperature: 0.2,
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
    try { apiError = JSON.parse(rawText); } catch {}
    console.error("Perplexity edition metadata error", response.status, JSON.stringify(apiError));
    throw new Error(`Perplexity request failed (HTTP ${response.status})`);
  }

  let parsedApi;
  try { parsedApi = JSON.parse(rawText); }
  catch { throw new Error("Perplexity returned unreadable JSON"); }

  const text = extractPerplexityMessageText(parsedApi);
  if (!text) throw new Error("No content in Perplexity response");

  let metadata;
  try {
    metadata = parseResearchJson(text);
  } catch (error) {
    metadata = salvageResearchJson(text);
  }

  return {
    title: cleanText(metadata.title),
    author: cleanText(metadata.author),
    publisher: cleanText(metadata.publisher),
    year: normalizeYearText(metadata.year) || cleanText(metadata.year),
    edition: cleanText(metadata.edition),
    contributor: cleanText(metadata.contributor),
    illustration_note: cleanText(metadata.illustration_note),
    confidence_note: cleanText(metadata.confidence_note)
  };
}

function cleanText(value) {
  return String(value || "").trim().slice(0, 600);
}

function romanToInteger(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw || /[^IVXLCDM]/.test(raw)) return null;
  const numerals = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  let prev = 0;
  for (let i = raw.length - 1; i >= 0; i -= 1) {
    const current = numerals[raw[i]];
    if (!current) return null;
    if (current < prev) total -= current;
    else {
      total += current;
      prev = current;
    }
  }
  return total;
}

function normalizeYearText(value) {
  const raw = cleanText(value);
  if (!raw) return "";
  const digitMatch = raw.match(/\b(1[4-9]\d{2}|20\d{2}|2100)\b/);
  if (digitMatch) return digitMatch[1];
  const romanMatch = raw.match(/\b[MCDLXVI]+\b/i);
  if (!romanMatch) return "";
  const romanYear = romanToInteger(romanMatch[0]);
  return romanYear && romanYear >= 1400 && romanYear <= 2100 ? String(romanYear) : "";
}

function todayUsageKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function pacificDayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

async function getProTtsAvailabilityStatus() {
  const dayKey = pacificDayKey();
  const snap = await ttsProStatusRef().get();
  const data = snap.exists ? (snap.data() || {}) : {};
  const unavailable = data.dayKey === dayKey && data.proUnavailableToday === true;
  return {
    available: !unavailable,
    dayKey
  };
}

async function markProTtsUnavailableToday(details = {}) {
  const now = new Date().toISOString();
  const dayKey = pacificDayKey();
  await ttsProStatusRef().set({
    dayKey,
    proUnavailableToday: true,
    reason: details.reason || "daily-rate-limit",
    model: PRO_TTS_MODEL,
    updatedAt: now
  }, { merge: true });
  return { available: false, dayKey };
}

function currentAdminAccessVersion() {
  return crypto.createHash("sha256").update(String(briefingAdminPassword.value() || "")).digest("hex").slice(0, 24);
}

async function getAdminAccessState(uid) {
  const snap = await adminAccessRef(uid).get();
  const data = snap.exists ? (snap.data() || {}) : {};
  const storedVersion = cleanText(data.accessVersion || "");
  const currentVersion = currentAdminAccessVersion();
  const hasStoredAccess = snap.exists;
  const isDisabled = hasStoredAccess && data.disabled === true;
  const versionMatches = hasStoredAccess && storedVersion === currentVersion;
  return {
    hasStoredAccess,
    isValid: versionMatches && !isDisabled,
    isDisabled,
    isStale: hasStoredAccess && Boolean(storedVersion) && storedVersion !== currentVersion,
    data
  };
}

async function grantAdminAccess(uid) {
  const now = new Date().toISOString();
  await adminAccessRef(uid).set({
    accessVersion: currentAdminAccessVersion(),
    disabled: false,
    grantedAt: now,
    updatedAt: now
  }, { merge: true });
}

async function setAdminAccessEnabled(uid, enabled) {
  const ref = adminAccessRef(uid);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Administrative access has not been granted for this account.");
  }
  await ref.set({
    disabled: !enabled,
    updatedAt: new Date().toISOString()
  }, { merge: true });
}

async function removeAdminAccessGrant(uid) {
  await adminAccessRef(uid).delete().catch(() => {});
}

async function reserveBriefingQuota(uid, options = {}) {
  if (options && options.allowOverride) {
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
        ttsFallbackReason: entry.ttsFallbackReason || "",
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
  const bookPhotosCol = db.collection("users").doc(uid).collection("bookPhotos");

  const [catalogSnap, briefingsSnap, briefingAudioSnap, bookPhotosSnap] = await Promise.all([
    catalogRef.get(),
    briefingsCol.get(),
    briefingAudioCol.get(),
    bookPhotosCol.get()
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
  const bookPhotos = {};
  bookPhotosSnap.forEach((doc) => {
    const data = doc.data() || {};
    bookPhotos[doc.id] = Array.isArray(data.photos) ? data.photos : [];
  });
  const sanitizedBriefingAudio = sanitizeBriefingAudioForBackup(briefingAudio);
  console.log(`[buildBackupZipForUser] loaded books=${books.length} briefings=${Object.keys(briefings).length} briefingAudio=${Object.keys(sanitizedBriefingAudio).length} bookPhotos=${Object.keys(bookPhotos).length}`);

  const manifest = {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    app: "TomeShelf",
    sections: {
      books: true,
      shelves: true,
      briefings: true,
      briefingAudio: true,
      bookPhotos: true,
      assets: true
    },
    books,
    bookPhotos,
    shelves,
    briefings,
    briefingAudio: sanitizedBriefingAudio,
    assets: []
  };
  const exportStats = {
    coversAdded: 0,
    coversSkipped: 0,
    bookPhotosAdded: 0,
    bookPhotosSkipped: 0,
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

    const photoList = Array.isArray(bookPhotos[bookId]) ? bookPhotos[bookId] : [];
    for (const photo of photoList) {
      const photoId = String(photo && photo.id || "");
      if (!photoId) continue;
      const storagePath = String(photo && photo.storagePath || "");
      const ext = extensionFromPath(storagePath || String(photo && photo.url || ""), ".jpg") || ".jpg";
      const pathInZip = `files/book-photos/${bookId}/${photoId}${ext}`;
      try {
        if (storagePath && await addStorageFileToZip(zip, storagePath, pathInZip)) {
          manifest.assets.push({
            assetId: `book-photo-${bookId}-${photoId}`,
            bookId,
            photoId,
            kind: "book-photo",
            contentType: ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg",
            pathInZip,
            sourcePath: storagePath
          });
          exportStats.bookPhotosAdded++;
        } else {
          exportStats.bookPhotosSkipped++;
        }
      } catch (error) {
        exportStats.bookPhotosSkipped++;
        console.warn(`[buildBackupZipForUser] additional photo export skipped for ${bookId}/${photoId}:`, error && error.message ? error.message : error);
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

  console.log(`[buildBackupZipForUser] assets prepared coversAdded=${exportStats.coversAdded} coversSkipped=${exportStats.coversSkipped} bookPhotosAdded=${exportStats.bookPhotosAdded} bookPhotosSkipped=${exportStats.bookPhotosSkipped} audioAdded=${exportStats.audioAdded} audioSkipped=${exportStats.audioSkipped}`);
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

function adminAccessRef(uid) {
  return db.collection("users").doc(uid).collection("settings").doc("adminAccess");
}

function ttsProStatusRef() {
  return db.collection("_system").doc("ttsProStatus");
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
  const raw = String(text || "").trim();
  const withoutFence = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(withoutFence);
  } catch {
    const starts = [withoutFence.indexOf("{"), withoutFence.indexOf("[")].filter((index) => index >= 0);
    const start = starts.length ? Math.min(...starts) : -1;
    if (start >= 0) {
      const open = withoutFence[start];
      const close = open === "{" ? "}" : "]";
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let i = start; i < withoutFence.length; i++) {
        const ch = withoutFence[i];
        if (inString) {
          if (escaped) escaped = false;
          else if (ch === "\\") escaped = true;
          else if (ch === "\"") inString = false;
          continue;
        }
        if (ch === "\"") {
          inString = true;
          continue;
        }
        if (ch === open) depth += 1;
        else if (ch === close) {
          depth -= 1;
          if (depth === 0) {
            return JSON.parse(withoutFence.slice(start, i + 1));
          }
        }
      }
    }
    throw new Error("Could not parse JSON.");
  }
}

function salvageResearchJson(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("No text to salvage.");

  const keyMatches = [];
  for (const key of RESEARCH_FIELD_KEYS) {
    const pattern = new RegExp(`"${key}"\\s*:`, "g");
    let match;
    while ((match = pattern.exec(raw)) !== null) {
      keyMatches.push({ key, index: match.index, end: pattern.lastIndex });
    }
  }
  if (!keyMatches.length) throw new Error("No known briefing fields found in malformed JSON.");

  keyMatches.sort((a, b) => a.index - b.index);
  const out = {};

  for (let i = 0; i < keyMatches.length; i++) {
    const current = keyMatches[i];
    if (Object.prototype.hasOwnProperty.call(out, current.key)) continue;

    const nextIndex = i + 1 < keyMatches.length ? keyMatches[i + 1].index : raw.lastIndexOf("}");
    const sliceEnd = nextIndex > current.end ? nextIndex : raw.length;
    let valueText = raw.slice(current.end, sliceEnd).trim();
    valueText = valueText.replace(/,\s*$/, "").trim();
    if (!valueText) continue;

    if (RESEARCH_ARRAY_FIELDS.has(current.key)) {
      if (!valueText.startsWith("[")) continue;
      let candidate = valueText;
      if (!candidate.endsWith("]")) candidate += "]";
      candidate = candidate.replace(/,\s*\]$/, "]");
      try {
        const parsed = JSON.parse(candidate);
        if (Array.isArray(parsed)) out[current.key] = parsed;
      } catch {
        continue;
      }
      continue;
    }

    if (!valueText.startsWith("\"")) continue;
    let candidate = valueText;
    if (!candidate.endsWith("\"")) candidate += "\"";
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed === "string") out[current.key] = parsed;
    } catch {
      continue;
    }
  }

  const hasRequired = Array.from(RESEARCH_REQUIRED_FIELDS).every((key) => {
    const value = out[key];
    if (RESEARCH_ARRAY_FIELDS.has(key)) return Array.isArray(value) && value.length > 0;
    return typeof value === "string" && value.trim().length > 0;
  });

  if (!hasRequired) {
    throw new Error("Malformed JSON did not contain enough recoverable briefing fields.");
  }

  return out;
}

function extractListItemsFromLooseText(text, { maxItems = 6, questionsOnly = false } = {}) {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const out = [];
  for (const line of lines) {
    const match = line.match(/^(?:[-*•]\s+|\d+[.)]\s+)(.+)$/);
    const value = (match ? match[1] : (questionsOnly ? "" : line)).trim();
    if (!value) continue;
    if (questionsOnly && !/[?]$/.test(value)) continue;
    if (value.length < 3) continue;
    out.push(value);
    if (out.length >= maxItems) break;
  }
  return out;
}

function buildPerplexityFallbackResearch(text, error) {
  const raw = String(text || "").replace(/\r\n/g, "\n").trim();
  const preview = raw || "Perplexity returned an empty text response after the API call succeeded.";
  const bulletItems = extractListItemsFromLooseText(preview, { maxItems: 6 });
  const questionItems = extractListItemsFromLooseText(preview, { maxItems: 6, questionsOnly: true });
  const parseMessage = cleanText(error && error.message);

  return {
    genre: "non-fiction",
    quick_take: "Warning: Perplexity returned text instead of valid JSON. Displaying the raw reply below as best as possible; formatting may be imperfect.",
    major_themes: bulletItems.length ? bulletItems : ["Raw Perplexity output was preserved because structured JSON parsing failed."],
    historical_context: "This briefing was reconstructed from an unstructured Perplexity reply after schema parsing failed.",
    impact: "The underlying response may still be useful, but section placement is approximate because the model did not follow the required JSON format.",
    confidence_note: parseMessage
      ? `Perplexity did not return valid JSON (${parseMessage}). The app preserved the raw reply instead of discarding it, so some sections may be incomplete or misfiled.`
      : "Perplexity did not return valid JSON. The app preserved the raw reply instead of discarding it, so some sections may be incomplete or misfiled.",
    summary: preview,
    key_elements: bulletItems,
    craft_analysis: "Unstructured Perplexity response shown in the Overview section above.",
    discussion_questions: questionItems,
    key_takeaways: bulletItems,
    raw_response_text: preview,
    fallback_reason: "perplexity-invalid-json"
  };
}

function extractPerplexityMessageText(parsedApi) {
  const content = ((parsedApi.choices || [])[0] || {}).message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part.text === "string") return part.text;
      if (part && typeof part.content === "string") return part.content;
      return "";
    }).filter(Boolean).join("\n");
  }
  if (content && typeof content.text === "string") return content.text;
  return "";
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

function audioVariantFromDoc(doc, variantKey) {
  const variants = doc && typeof doc.variants === "object" ? doc.variants : {};
  const variant = variants[variantKey];
  return variant && typeof variant === "object" ? variant : null;
}

function userSharesCol(uid) {
  return db.collection("users").doc(uid).collection("shares");
}

function normalizeShareType(value) {
  return String(value || "").trim().toLowerCase() === "book" ? "book" : "shelf";
}

function buildShareRecord({
  token,
  uid,
  type,
  resourceId,
  resourceName,
  includePersonalNotes,
  allowWikiAI,
  allowBriefingAudio,
  includeAdditionalPhotos,
  createdAt,
  updatedAt,
  status = "active"
}) {
  const shareType = normalizeShareType(type);
  return {
    token,
    ownerUid: uid,
    type: shareType,
    resourceId: String(resourceId || "").trim(),
    resourceName: String(resourceName || "").trim(),
    includePersonalNotes: Boolean(includePersonalNotes),
    allowWikiAI: Boolean(allowWikiAI),
    allowBriefingAudio: Boolean(allowBriefingAudio),
    includeAdditionalPhotos: shareType === "book" ? Boolean(includeAdditionalPhotos) : true,
    createdAt: Number(createdAt) || Date.now(),
    updatedAt: Number(updatedAt) || Number(createdAt) || Date.now(),
    status: status === "revoked" ? "revoked" : "active"
  };
}

function buildPublicShareLinkDoc(share) {
  return {
    ownerUid: share.ownerUid,
    type: share.type,
    shareId: share.token,
    resourceId: share.resourceId,
    resourceName: share.resourceName,
    includePersonalNotes: share.includePersonalNotes,
    allowWikiAI: share.allowWikiAI,
    allowBriefingAudio: share.allowBriefingAudio,
    includeAdditionalPhotos: share.includeAdditionalPhotos,
    createdAt: share.createdAt,
    updatedAt: share.updatedAt,
    status: share.status,
    shelfId: share.type === "shelf" ? share.resourceId : null,
    bookId: share.type === "book" ? share.resourceId : null
  };
}

async function getCatalogData(uid) {
  const catalogSnap = await db.collection("users").doc(uid).collection("catalog").doc("data").get();
  if (!catalogSnap.exists) throw new HttpsError("not-found", "Catalog not found.");
  return catalogSnap.data() || {};
}

async function listActiveShareDocs(uid) {
  const snap = await userSharesCol(uid).where("status", "==", "active").get();
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
}

function getShareResourceNameFromCatalog(data, requestedType, resourceId) {
  if (requestedType === "book") {
    const book = (data.books || []).find((entry) => entry && entry.id === resourceId);
    if (!book) throw new HttpsError("not-found", "Book not found.");
    return String(book.title || "").trim() || "Shared Book";
  }
  const shelf = (data.shelves || []).find((entry) => entry && entry.id === resourceId);
  if (!shelf) throw new HttpsError("not-found", "Shelf not found.");
  return String(shelf.name || "").trim() || "Shared Shelf";
}

async function findActiveShareByResource(uid, type, resourceId) {
  const shareType = normalizeShareType(type);
  const snap = await userSharesCol(uid)
    .where("status", "==", "active")
    .where("type", "==", shareType)
    .where("resourceId", "==", String(resourceId || "").trim())
    .limit(1)
    .get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...(snap.docs[0].data() || {}) };
}

async function resolveShareToken(token) {
  const tokenDoc = await db.collection("shareLinks").doc(token).get();
  if (!tokenDoc.exists) throw new HttpsError("not-found", "Share link not found or expired.");
  const data = tokenDoc.data() || {};
  if (String(data.status || "active").trim().toLowerCase() === "revoked") {
    throw new HttpsError("not-found", "Share link not found or expired.");
  }
  const ownerUid = String(data.ownerUid || "").trim();
  if (!ownerUid) throw new HttpsError("not-found", "Share link is invalid.");
  if (data.type) {
    return buildShareRecord({
      token,
      uid: ownerUid,
      type: data.type,
      resourceId: data.resourceId || (data.type === "book" ? data.bookId : data.shelfId),
      resourceName: data.resourceName || "",
      includePersonalNotes: data.includePersonalNotes,
      allowWikiAI: data.allowWikiAI,
      allowBriefingAudio: data.allowBriefingAudio,
      includeAdditionalPhotos: data.includeAdditionalPhotos,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      status: data.status || "active"
    });
  }
  return buildShareRecord({
    token,
    uid: ownerUid,
    type: "shelf",
    resourceId: data.shelfId,
    resourceName: "",
    includePersonalNotes: data.includePersonalNotes,
    allowWikiAI: data.allowWikiAI,
    allowBriefingAudio: data.allowBriefingAudio,
    includeAdditionalPhotos: true,
    createdAt: data.createdAt,
    updatedAt: data.createdAt,
    status: "active"
  });
}

function sanitizeSharedAudioDoc(data) {
  const variants = data && typeof data.variants === "object" ? data.variants : {};
  const sanitized = {};
  Object.entries(variants).forEach(([key, value]) => {
    if (!value || typeof value !== "object" || value.status !== "ready") return;
    sanitized[key] = {
      status: value.status,
      voice: value.voice || DEFAULT_AUDIO_VOICE,
      generatedAt: value.generatedAt || "",
      ttsModel: value.ttsModel || "",
      ttsFallbackReason: value.ttsFallbackReason || "",
      durationSec: value.durationSec || 0,
      sourceBriefingGeneratedAt: value.sourceBriefingGeneratedAt || ""
    };
  });
  return Object.keys(sanitized).length ? { variants: sanitized } : null;
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
    "Aim for roughly 600 to 850 words and about 4 to 6 minutes of listening time.",
    "Keep the tone engaged and intelligent, but not gushy, breathless, or promotional.",
    "If the source material suggests mixed, weak, or negative reception, make that clear in a calm, matter-of-fact way.",
    "Do not overpraise the book unless the source material strongly supports it.",
    isFiction
      ? "For fiction, focus on atmosphere, character arc, structure, and prose."
      : (isReference
          ? "For reference books, focus on organization, usability, standout features, and the book as a practical object."
          : "For non-fiction, focus on utility, argument quality, key ideas, and real-world application."),
    safeMode === "spoiler"
      ? "Spoilers are allowed. Discuss the full work plainly."
      : "Do not reveal endings, twists, or late-stage character fates beyond the spoiler-safe briefing.",
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
    isReference ? "Notable Features" : "",
    isReference ? listToNarrationLines(discussionList) : "",
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
          "Sound thoughtful and confident, but never gushy, breathless, or promotional.",
          "Maintain critical distance: if the material suggests limitations, mixed execution, or poor reception, say so plainly.",
          "Do not imply acclaim, brilliance, or importance unless the supplied material clearly supports it.",
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
  try {
    console.warn("[extractAudioBase64] No inline audio found. Response summary:", JSON.stringify({
      candidateCount: Array.isArray(data && data.candidates) ? data.candidates.length : 0,
      firstCandidateKeys: data && data.candidates && data.candidates[0] ? Object.keys(data.candidates[0]) : [],
      partSummaries: parts.map((part) => ({
        keys: part ? Object.keys(part) : [],
        hasInlineData: Boolean(part && part.inlineData),
        inlineMimeType: part && part.inlineData ? part.inlineData.mimeType || "" : "",
        textPreview: part && typeof part.text === "string" ? part.text.slice(0, 160) : ""
      }))
    }));
  } catch (error) {}
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

function parseWavBuffer(wavBuffer) {
  if (!Buffer.isBuffer(wavBuffer) || wavBuffer.length < 44) {
    throw new Error("Invalid WAV audio buffer.");
  }
  if (wavBuffer.toString("ascii", 0, 4) !== "RIFF" || wavBuffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Unsupported WAV container.");
  }

  let offset = 12;
  let fmt = null;
  let dataOffset = -1;
  let dataSize = -1;

  while (offset + 8 <= wavBuffer.length) {
    const chunkId = wavBuffer.toString("ascii", offset, offset + 4);
    const chunkSize = wavBuffer.readUInt32LE(offset + 4);
    const chunkDataOffset = offset + 8;
    if (chunkDataOffset + chunkSize > wavBuffer.length) break;

    if (chunkId === "fmt ") {
      fmt = {
        audioFormat: wavBuffer.readUInt16LE(chunkDataOffset),
        channels: wavBuffer.readUInt16LE(chunkDataOffset + 2),
        sampleRate: wavBuffer.readUInt32LE(chunkDataOffset + 4),
        byteRate: wavBuffer.readUInt32LE(chunkDataOffset + 8),
        blockAlign: wavBuffer.readUInt16LE(chunkDataOffset + 12),
        bitsPerSample: wavBuffer.readUInt16LE(chunkDataOffset + 14)
      };
    } else if (chunkId === "data") {
      dataOffset = chunkDataOffset;
      dataSize = chunkSize;
      break;
    }

    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (!fmt || dataOffset < 0 || dataSize < 0) {
    throw new Error("Incomplete WAV audio buffer.");
  }
  if (fmt.audioFormat !== 1) {
    throw new Error("Only PCM WAV audio is supported.");
  }

  return {
    channels: fmt.channels,
    sampleRate: fmt.sampleRate,
    bitsPerSample: fmt.bitsPerSample,
    pcm: wavBuffer.subarray(dataOffset, dataOffset + dataSize)
  };
}

function concatWavBuffers(wavBuffers) {
  if (!Array.isArray(wavBuffers) || !wavBuffers.length) {
    throw new Error("No WAV buffers to concatenate.");
  }
  const parts = wavBuffers.map(parseWavBuffer);
  const first = parts[0];

  for (const part of parts.slice(1)) {
    if (
      part.channels !== first.channels ||
      part.sampleRate !== first.sampleRate ||
      part.bitsPerSample !== first.bitsPerSample
    ) {
      throw new Error("WAV chunk format mismatch.");
    }
  }

  const pcm = Buffer.concat(parts.map((part) => part.pcm));
  return pcmToWavBuffer(pcm, first.sampleRate, first.channels, first.bitsPerSample);
}

function getWavDurationSec(wavBuffer) {
  const parsed = parseWavBuffer(wavBuffer);
  const bytesPerSample = parsed.bitsPerSample / 8;
  const frameSize = parsed.channels * bytesPerSample;
  if (!frameSize || !parsed.sampleRate) return 0;
  return Math.max(1, Math.round(parsed.pcm.length / frameSize / parsed.sampleRate));
}

function splitNarrationScript(script) {
  const normalized = String(script || "").trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  if (paragraphs.length < 4) return [normalized];
  const minChunkChars = 180;
  const targetChunks = 4;
  const chunks = [];
  let paragraphIndex = 0;

  for (let chunkIndex = 0; chunkIndex < targetChunks && paragraphIndex < paragraphs.length; chunkIndex++) {
    const remainingParagraphs = paragraphs.length - paragraphIndex;
    const remainingChunks = targetChunks - chunkIndex;
    if (remainingChunks === 1) {
      chunks.push(paragraphs.slice(paragraphIndex).join("\n\n").trim());
      break;
    }

    const remainingTotalLength = paragraphs
      .slice(paragraphIndex)
      .reduce((sum, part) => sum + part.length, 0);
    const targetSize = Math.max(minChunkChars, Math.ceil(remainingTotalLength / remainingChunks));

    let current = paragraphs[paragraphIndex];
    paragraphIndex += 1;

    while (paragraphIndex < paragraphs.length) {
      const futureParagraphs = paragraphs.length - paragraphIndex;
      if (futureParagraphs < (remainingChunks - 1)) break;

      const nextParagraph = paragraphs[paragraphIndex];
      const candidate = `${current}\n\n${nextParagraph}`;

      if (current.length < minChunkChars) {
        current = candidate;
        paragraphIndex += 1;
        continue;
      }

      const currentDistance = Math.abs(current.length - targetSize);
      const candidateDistance = Math.abs(candidate.length - targetSize);
      if (candidate.length > targetSize && candidateDistance > currentDistance) {
        break;
      }

      current = candidate;
      paragraphIndex += 1;
    }

    chunks.push(current.trim());
  }

  return chunks.filter(Boolean);
}

async function fetchWithRetryAndTimeout(url, options, { maxRetries = 0, baseDelayMs = 1500, timeoutMs = 300000 } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const fetchOptions = timeoutMs > 0
        ? { ...options, signal: AbortSignal.timeout(timeoutMs) }
        : options;
      const res = await fetch(url, fetchOptions);
      const isRateLimited = res.status === 429;
      const isTransient = isRateLimited || res.status >= 500;
      if (!isTransient || attempt === maxRetries) return res;
      const wait = isRateLimited
        ? baseDelayMs * 3 * Math.pow(2, attempt)
        : baseDelayMs * Math.pow(2, attempt);
      console.warn(`[fetchWithRetryAndTimeout] HTTP ${res.status} on attempt ${attempt + 1}, retrying in ${wait}ms.`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    } catch (error) {
      if (attempt === maxRetries) throw error;
      const wait = baseDelayMs * Math.pow(2, attempt);
      const reason = error && error.message ? error.message : String(error);
      console.warn(`[fetchWithRetryAndTimeout] Network error on attempt ${attempt + 1}: ${reason}. Retrying in ${wait}ms.`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

function ttsApiUrlForModel(modelName) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;
}

async function synthesizeNarrationAudio(script, voice, apiKey, modelName) {
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
    response = await fetchWithRetryAndTimeout(ttsApiUrlForModel(modelName), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(payload)
    }, { maxRetries: 0, baseDelayMs: 2000, timeoutMs: 300000 });
  } catch (error) {
    const detail = error && error.message ? ` ${error.message}` : "";
    throw new Error(`Unable to reach Gemini TTS API.${detail}`.trim());
  }

  const rawText = await response.text();
  if (!response.ok) {
    let apiError = {};
    try { apiError = JSON.parse(rawText); } catch { /* ignore */ }
    console.error("Gemini TTS error", response.status, JSON.stringify(apiError));
    const error = new Error(`Narration audio request failed (HTTP ${response.status})`);
    error.httpStatus = response.status;
    error.apiError = apiError;
    throw error;
  }

  let parsedApi;
  try { parsedApi = JSON.parse(rawText); }
  catch { throw new Error("Gemini returned unreadable audio output."); }

  const pcm = Buffer.from(extractAudioBase64(parsedApi), "base64");
  return pcmToWavBuffer(pcm);
}

async function buildBriefingAudio(uid, bookId, spoilerMode, voice, forceRefresh, apiKey, requestedTtsModel = FLASH_TTS_MODEL, requestedTtsFallbackReason = "") {
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
  let activeTtsModel = requestedTtsModel === PRO_TTS_MODEL ? PRO_TTS_MODEL : FLASH_TTS_MODEL;
  let ttsFallbackReason = cleanText(requestedTtsFallbackReason || "");

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
        sourceBriefingGeneratedAt,
        ttsModel: activeTtsModel,
        ttsFallbackReason
      }
    }
  }, { merge: true });

  try {
    console.log(`[buildBriefingAudio] generating script via ${SCRIPT_MODEL} variant=${variantKey}`);
    const script = await generateNarrationScript(book, briefing, variantKey, apiKey);
    console.log(`[buildBriefingAudio] script ready chars=${script.length}`);
    const scriptChunks = splitNarrationScript(script);
    console.log(`[buildBriefingAudio] synthesizing ${scriptChunks.length} narration chunk(s) via ${activeTtsModel} voice=${normalizedVoice} originalChars=${script.length}`);
    const wavChunks = [];
    for (let i = 0; i < scriptChunks.length; i++) {
      console.log(`[buildBriefingAudio] synthesizing chunk ${i + 1}/${scriptChunks.length} chars=${scriptChunks[i].length}`);
      try {
        wavChunks.push(await synthesizeNarrationAudio(scriptChunks[i], normalizedVoice, apiKey, activeTtsModel));
      } catch (error) {
        if (activeTtsModel === PRO_TTS_MODEL && error && error.httpStatus === 429) {
          await markProTtsUnavailableToday({ reason: "daily-rate-limit" });
          activeTtsModel = FLASH_TTS_MODEL;
          ttsFallbackReason = "daily-rate-limit";
          console.warn(`[buildBriefingAudio] Pro TTS rate limited on chunk ${i + 1}; falling back to ${activeTtsModel} for the rest of the day.`);
          wavChunks.push(await synthesizeNarrationAudio(scriptChunks[i], normalizedVoice, apiKey, activeTtsModel));
        } else {
          throw error;
        }
      }
      if (i < scriptChunks.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
    const wavBuffer = wavChunks.length === 1 ? wavChunks[0] : concatWavBuffers(wavChunks);
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
      ttsModel: activeTtsModel,
      ttsFallbackReason,
      durationSec: getWavDurationSec(wavBuffer),
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
          ttsModel: activeTtsModel,
          ttsFallbackReason,
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

async function getStorageDownloadUrl(objectPath) {
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
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}?alt=media&token=${token}`;
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
    contributors:   { type: "array", items: { type: "string" } },
    imprint_or_city:{ type: "string" },
    illustration_note: { type: "string" },
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

  const legacyImages = request.data && request.data.images;
  const imageInputs = Array.isArray(request.data && request.data.imageInputs)
    ? request.data.imageInputs
    : legacyImages;
  if (!Array.isArray(imageInputs) || imageInputs.length === 0 || imageInputs.length > 3) {
    throw new HttpsError("invalid-argument", "Provide 1 to 3 images.");
  }

  // Step 1: Send images to Gemini for bibliographic extraction
  const imageParts = await Promise.all(imageInputs.map(async (img) => {
    if (img && typeof img.data === "string" && img.data.trim()) {
      return {
        inline_data: {
          mime_type: img.mimeType || "image/jpeg",
          data: img.data
        }
      };
    }

    const storagePath = String(img && img.storagePath || "").trim();
    const remoteUrl = String(img && img.url || "").trim();
    let buffer = null;
    let mimeType = String(img && img.mimeType || "").trim() || "image/jpeg";

    if (storagePath) {
      try {
        const download = await admin.storage().bucket().file(storagePath).download();
        buffer = download && download[0] ? download[0] : null;
      } catch (error) {
        console.warn("[analyzeBookPhoto] storagePath download failed:", storagePath, error.message);
      }
    }

    if (!buffer && remoteUrl) {
      const response = await fetchWithRetry(remoteUrl, {}, { maxRetries: 1, baseDelayMs: 500 });
      if (!response.ok) {
        throw new HttpsError("failed-precondition", "Could not load one of the saved photos for analysis.");
      }
      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
      const contentType = response.headers.get("content-type");
      if (contentType) mimeType = contentType;
    }

    if (!buffer) {
      throw new HttpsError("failed-precondition", "Could not load one of the saved photos for analysis.");
    }

    return {
      inline_data: {
        mime_type: mimeType,
        data: buffer.toString("base64")
      }
    };
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
            "title, subtitle, author names, publisher, imprint/city, publication year, edition or printing info.",
            "Also extract edition-useful contributor credits when visible, such as illustrator, editor, translator, or introduction by.",
            "If the page mentions illustration details such as number of illustrations or colour plates, capture that in illustration_note.",
            "Only report what you can actually read in the images.",
            "Use empty string for fields you cannot determine.",
            "Use contributors as an array of contributor strings exactly as they appear when readable.",
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
    published_year: normalizeYearText(extracted.published_year) || extracted.published_year || null,
    edition:        extracted.edition || null,
    contributors:   Array.isArray(extracted.contributors) ? extracted.contributors.filter(Boolean) : [],
    imprint_or_city: extracted.imprint_or_city || null,
    illustration_note: extracted.illustration_note || null,
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

  // Fallback: metadata-aware search
  if (candidates.length === 0 && extracted.title) {
    await searchByMetadata(extracted, candidates);
  }

  // Score and sort candidates
  for (const c of candidates) {
    c.confidence = scoreCandidate(c, extracted);
  }
  dedupeCandidates(candidates);
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
  return searchByMetadata({ title, authors: author ? [author] : [] }, candidates);
}

async function searchByMetadata(extracted, candidates) {
  const title = cleanMetadataText(extracted && extracted.title);
  const author = cleanMetadataText(extracted && Array.isArray(extracted.authors) ? extracted.authors[0] : "");
  const publisher = cleanMetadataText(extracted && extracted.publisher);
  const contributor = cleanMetadataText(extracted && Array.isArray(extracted.contributors) ? extracted.contributors[0] : "");
  const year = cleanYear(extracted && extracted.published_year);

  // Google Books by title + author
  try {
    const gbQueries = [];
    const structured = [];
    if (title) structured.push(`intitle:${title}`);
    if (author) structured.push(`inauthor:${author}`);
    if (structured.length) gbQueries.push(structured.join(" "));
    const broadTerms = [title, author, publisher, contributor, year].filter(Boolean);
    if (broadTerms.length) gbQueries.push(broadTerms.join(" "));

    for (const query of gbQueries.slice(0, 2)) {
      const res = await fetch(
        `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=8`
      );
      const data = await res.json();
      for (const item of (data.items || []).slice(0, 8)) {
        candidates.push(formatGBCandidate(item));
      }
    }
  } catch (e) { console.error("GB title search:", e.message); }

  // Open Library by title
  try {
    const q = encodeURIComponent([title, author, publisher, contributor].filter(Boolean).join(" "));
    const res = await fetch(`https://openlibrary.org/search.json?q=${q}&limit=8`);
    const data = await res.json();
    for (const doc of (data.docs || []).slice(0, 8)) {
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
  const contributors = extractContributorCredits([
    v.subtitle || "",
    v.description || ""
  ]);
  return {
    source: "google_books",
    title: v.title || "",
    subtitle: v.subtitle || "",
    authors: v.authors || [],
    publisher: v.publisher || "",
    publishedDate: v.publishedDate || "",
    contributors,
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
    contributors: dedupeStringList([
      ...extractContributorCredits([book.by_statement || "", typeof book.notes === "string" ? book.notes : ""]),
      ...((book.contributors || []).map((entry) => entry && (entry.name || entry.role || "")).filter(Boolean))
    ]),
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
    contributors: dedupeStringList([
      ...(Array.isArray(doc.contributor) ? doc.contributor : []),
      ...extractContributorCredits([doc.subtitle || ""])
    ]),
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
  const cIsbn = cleanPossibleIsbn(candidate.isbn_13 || candidate.isbn_10);
  const eIsbn = cleanPossibleIsbn(extracted.isbn_13 || extracted.isbn_10);
  if (cIsbn && eIsbn && cIsbn === eIsbn) {
    score += 0.58;
    weight += 0.58;
  }

  // Title similarity
  if (extracted.title && candidate.title) {
    score += wordOverlap(extracted.title, candidate.title) * 0.22;
    weight += 0.22;
  }

  // Author match
  if (extracted.authors.length > 0 && candidate.authors.length > 0) {
    score += wordOverlap(extracted.authors[0], candidate.authors[0]) * 0.12;
    weight += 0.12;
  }

  if (extracted.publisher && candidate.publisher) {
    score += textIncludesOverlap(extracted.publisher, candidate.publisher) * 0.05;
    weight += 0.05;
  }

  const yearScore = yearSimilarity(extracted.published_year, candidate.publishedDate);
  if (yearScore >= 0) {
    score += yearScore * 0.04;
    weight += 0.04;
  }

  const contributorScore = listOverlap(extracted.contributors, candidate.contributors);
  if (contributorScore >= 0) {
    score += contributorScore * 0.04;
    weight += 0.04;
  }

  if (extracted.edition && candidate.edition) {
    score += textIncludesOverlap(extracted.edition, candidate.edition) * 0.03;
    weight += 0.03;
  }

  let normalized = weight > 0 ? score / weight : 0;
  if (extracted.publisher && candidate.publisher) {
    const publisherOverlap = textIncludesOverlap(extracted.publisher, candidate.publisher);
    if (publisherOverlap < 0.2) normalized -= 0.05;
  }
  if (extracted.published_year && candidate.publishedDate) {
    const candidateYear = cleanYear(candidate.publishedDate);
    const extractedYear = cleanYear(extracted.published_year);
    if (candidateYear && extractedYear && Math.abs(Number(candidateYear) - Number(extractedYear)) > 5) {
      normalized -= 0.04;
    }
  }
  return Math.max(0, Math.min(1, normalized));
}

function wordOverlap(a, b) {
  if (!a || !b) return 0;
  const aWords = new Set(normalizeSearchText(a).split(/\s+/).filter(Boolean));
  const bWords = new Set(normalizeSearchText(b).split(/\s+/).filter(Boolean));
  let overlap = 0;
  for (const w of aWords) {
    if (bWords.has(w)) overlap++;
  }
  return overlap / Math.max(aWords.size, bWords.size);
}

function normalizeSearchText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function cleanMetadataText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanYear(value) {
  return normalizeYearText(value);
}

function cleanPossibleIsbn(value) {
  return String(value || "").replace(/[^0-9X]/gi, "").toUpperCase();
}

function textIncludesOverlap(a, b) {
  const aNorm = normalizeSearchText(a);
  const bNorm = normalizeSearchText(b);
  if (!aNorm || !bNorm) return -1;
  if (aNorm === bNorm) return 1;
  if (aNorm.includes(bNorm) || bNorm.includes(aNorm)) return 0.8;
  return wordOverlap(aNorm, bNorm);
}

function yearSimilarity(extractedYear, candidateDate) {
  const a = cleanYear(extractedYear);
  const b = cleanYear(candidateDate);
  if (!a || !b) return -1;
  const delta = Math.abs(Number(a) - Number(b));
  if (delta === 0) return 1;
  if (delta <= 1) return 0.8;
  if (delta <= 3) return 0.5;
  if (delta <= 5) return 0.25;
  return 0;
}

function listOverlap(a, b) {
  const left = dedupeStringList(Array.isArray(a) ? a : []);
  const right = dedupeStringList(Array.isArray(b) ? b : []);
  if (!left.length || !right.length) return -1;
  let best = 0;
  left.forEach((leftItem) => {
    right.forEach((rightItem) => {
      best = Math.max(best, textIncludesOverlap(leftItem, rightItem));
    });
  });
  return best;
}

function dedupeStringList(values) {
  const seen = new Set();
  const out = [];
  (Array.isArray(values) ? values : []).forEach((value) => {
    const cleaned = cleanMetadataText(value);
    const key = normalizeSearchText(cleaned);
    if (!cleaned || !key || seen.has(key)) return;
    seen.add(key);
    out.push(cleaned);
  });
  return out;
}

function extractContributorCredits(textParts) {
  const patterns = [
    /\billustrated by\s+([^.;,\n]+)/ig,
    /\bwith illustrations by\s+([^.;,\n]+)/ig,
    /\bedited by\s+([^.;,\n]+)/ig,
    /\btranslation by\s+([^.;,\n]+)/ig,
    /\btranslated by\s+([^.;,\n]+)/ig,
    /\bintroduction by\s+([^.;,\n]+)/ig,
    /\bwith introduction by\s+([^.;,\n]+)/ig
  ];
  const found = [];
  (Array.isArray(textParts) ? textParts : []).forEach((text) => {
    const source = String(text || "");
    patterns.forEach((pattern) => {
      let match;
      while ((match = pattern.exec(source))) {
        found.push(match[1]);
      }
      pattern.lastIndex = 0;
    });
  });
  return dedupeStringList(found);
}

function dedupeCandidates(candidates) {
  const seen = new Map();
  const deduped = [];
  (Array.isArray(candidates) ? candidates : []).forEach((candidate) => {
    if (!candidate) return;
    const key = cleanPossibleIsbn(candidate.isbn_13 || candidate.isbn_10)
      || `${normalizeSearchText(candidate.title)}|${normalizeSearchText((candidate.authors || [])[0] || "")}|${cleanYear(candidate.publishedDate)}`;
    if (!key) {
      deduped.push(candidate);
      return;
    }
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, candidate);
      deduped.push(candidate);
      return;
    }
    if ((candidate.confidence || 0) > (existing.confidence || 0)) {
      const index = deduped.indexOf(existing);
      if (index >= 0) deduped[index] = candidate;
      seen.set(key, candidate);
    }
  });
  candidates.length = 0;
  candidates.push(...deduped);
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
 * createShareLink — generates a public read-only share token for one shelf or book.
 * One active token per resource.
 */
exports.createShareLink = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const uid = request.auth.uid;
  const requestedType = normalizeShareType((request.data || {}).type || "");
  const legacyShelfId = String((request.data || {}).shelfId || "").trim();
  const resourceId = String((request.data || {}).resourceId || legacyShelfId).trim();
  const includePersonalNotes = Boolean((request.data || {}).includePersonalNotes);
  const allowWikiAI = Boolean((request.data || {}).allowWikiAI);
  const allowBriefingAudio = Boolean((request.data || {}).allowBriefingAudio);
  const includeAdditionalPhotos = Boolean((request.data || {}).includeAdditionalPhotos);

  if (!resourceId) {
    throw new HttpsError("invalid-argument", `${requestedType === "book" ? "bookId" : "shelfId"} is required.`);
  }

  const data = await getCatalogData(uid);
  const resourceName = getShareResourceNameFromCatalog(data, requestedType, resourceId);

  const existingShare = await findActiveShareByResource(uid, requestedType, resourceId);
  const legacyShareMap = data.shareLinks && typeof data.shareLinks === "object" ? data.shareLinks : {};
  const legacyToken = !existingShare && requestedType === "shelf"
    ? Object.keys(legacyShareMap).find((candidate) => {
        const item = legacyShareMap[candidate];
        return item && String(item.shelfId || "").trim() === resourceId;
      })
    : "";
  const token = crypto.randomBytes(16).toString("hex");
  const createdAt = Date.now();
  const share = buildShareRecord({
    token,
    uid,
    type: requestedType,
    resourceId,
    resourceName,
    includePersonalNotes,
    allowWikiAI,
    allowBriefingAudio,
    includeAdditionalPhotos,
    createdAt,
    updatedAt: createdAt,
    status: "active"
  });

  const batch = db.batch();
  if (existingShare && existingShare.token) {
    batch.delete(db.collection("shareLinks").doc(existingShare.token));
    batch.set(userSharesCol(uid).doc(existingShare.token), {
      ...existingShare,
      status: "revoked",
      updatedAt: createdAt,
      revokedAt: createdAt
    }, { merge: true });
  }
  if (legacyToken) {
    batch.delete(db.collection("shareLinks").doc(legacyToken));
    batch.set(userSharesCol(uid).doc(legacyToken), buildShareRecord({
      token: legacyToken,
      uid,
      type: "shelf",
      resourceId,
      resourceName,
      includePersonalNotes: legacyShareMap[legacyToken] && legacyShareMap[legacyToken].includePersonalNotes,
      allowWikiAI: legacyShareMap[legacyToken] && legacyShareMap[legacyToken].allowWikiAI,
      allowBriefingAudio: legacyShareMap[legacyToken] && legacyShareMap[legacyToken].allowBriefingAudio,
      includeAdditionalPhotos: true,
      createdAt: legacyShareMap[legacyToken] && legacyShareMap[legacyToken].createdAt,
      updatedAt: createdAt,
      status: "revoked",
      revokedAt: createdAt
    }), { merge: true });
  }
  batch.set(db.collection("shareLinks").doc(token), buildPublicShareLinkDoc(share));
  batch.set(userSharesCol(uid).doc(token), share);
  await batch.commit();

  return {
    token,
    share
  };
});

/**
 * restoreShareLink — restores a revoked share token and reactivates its original URL.
 * If another token is currently active for the same resource, it is revoked first.
 */
exports.restoreShareLink = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const uid = request.auth.uid;
  const token = String((request.data || {}).token || "").trim();
  if (!token) throw new HttpsError("invalid-argument", "token is required.");

  const ownerShareSnap = await userSharesCol(uid).doc(token).get();
  if (!ownerShareSnap.exists) {
    throw new HttpsError("not-found", "Saved share history not found.");
  }

  const ownerShareData = ownerShareSnap.data() || {};
  const requestedType = normalizeShareType(ownerShareData.type || "");
  const resourceId = String(ownerShareData.resourceId || (requestedType === "book" ? ownerShareData.bookId : ownerShareData.shelfId) || "").trim();
  if (!resourceId) {
    throw new HttpsError("failed-precondition", "Saved share history is missing its resource.");
  }

  const ownerShare = buildShareRecord({
    token,
    uid,
    type: requestedType,
    resourceId,
    resourceName: ownerShareData.resourceName || "",
    includePersonalNotes: ownerShareData.includePersonalNotes,
    allowWikiAI: ownerShareData.allowWikiAI,
    allowBriefingAudio: ownerShareData.allowBriefingAudio,
    includeAdditionalPhotos: ownerShareData.includeAdditionalPhotos,
    createdAt: ownerShareData.createdAt,
    updatedAt: ownerShareData.updatedAt,
    status: ownerShareData.status || "active"
  });

  if (ownerShare.status !== "revoked") {
    throw new HttpsError("failed-precondition", "That share link is already active.");
  }

  const data = await getCatalogData(uid);
  const resourceName = getShareResourceNameFromCatalog(data, requestedType, resourceId);
  const createdAt = Date.now();
  const restoredShare = buildShareRecord({
    token,
    uid,
    type: requestedType,
    resourceId,
    resourceName,
    includePersonalNotes: ownerShareData.includePersonalNotes,
    allowWikiAI: ownerShareData.allowWikiAI,
    allowBriefingAudio: ownerShareData.allowBriefingAudio,
    includeAdditionalPhotos: ownerShareData.includeAdditionalPhotos,
    createdAt: ownerShareData.createdAt,
    updatedAt: createdAt,
    status: "active"
  });

  const tokenDoc = await db.collection("shareLinks").doc(token).get();
  if (tokenDoc.exists) {
    const tokenData = tokenDoc.data() || {};
    const tokenOwner = String(tokenData.ownerUid || "").trim();
    if (tokenOwner && tokenOwner !== uid) {
      throw new HttpsError("already-exists", "That share URL is no longer available.");
    }
  }

  const existingShare = await findActiveShareByResource(uid, requestedType, resourceId);
  const replacedToken = existingShare && existingShare.token && existingShare.token !== token
    ? existingShare.token
    : "";

  const batch = db.batch();
  if (replacedToken) {
    batch.delete(db.collection("shareLinks").doc(replacedToken));
    batch.set(userSharesCol(uid).doc(replacedToken), {
      ...existingShare,
      status: "revoked",
      updatedAt: createdAt,
      revokedAt: createdAt
    }, { merge: true });
  }

  batch.set(db.collection("shareLinks").doc(token), buildPublicShareLinkDoc(restoredShare));
  batch.set(userSharesCol(uid).doc(token), {
    ...restoredShare,
    revokedAt: admin.firestore.FieldValue.delete()
  }, { merge: true });

  await batch.commit();
  return {
    restored: true,
    replacedToken,
    share: restoredShare
  };
});

/**
 * getSharedShelf — unauthenticated endpoint; returns filtered shelf data for a share token.
 */
exports.getSharedShelf = onCall(async (request) => {
  const token = String((request.data || {}).token || "").trim();
  if (!token) throw new HttpsError("invalid-argument", "token is required.");

  const share = await resolveShareToken(token);
  if (share.type !== "shelf") throw new HttpsError("failed-precondition", "This share link is for a single book.");

  const catalogRef = db.collection("users").doc(share.ownerUid).collection("catalog");
  const briefingsCol = db.collection("users").doc(share.ownerUid).collection("briefings");
  const briefingAudioCol = db.collection("users").doc(share.ownerUid).collection("briefingAudio");
  const bookPhotosCol = db.collection("users").doc(share.ownerUid).collection("bookPhotos");

  const catalogSnap = await catalogRef.doc("data").get();
  if (!catalogSnap.exists) throw new HttpsError("not-found", "Library not found.");

  const catalogData = catalogSnap.data();
  const shelf = (catalogData.shelves || []).find((s) => s.id === share.resourceId);
  if (!shelf) throw new HttpsError("not-found", "Shelf no longer exists.");

  const shelfBooks = (catalogData.books || [])
    .filter((b) => (b.listShelfId || "default") === share.resourceId)
    .map((b) => {
      const out = { ...b };
      if (!share.includePersonalNotes) delete out.personalNotes;
      return out;
    });

  // Fetch briefings only for books on this shelf (avoids reading the whole subcollection).
  const shelfBookIds = new Set(shelfBooks.map((b) => b.id));
  const bookPhotoSnaps = await Promise.all(
    [...shelfBookIds].map(id => bookPhotosCol.doc(id).get())
  );
  const photoMap = {};
  bookPhotoSnaps.forEach((snap) => {
    if (!snap.exists) return;
    const data = snap.data() || {};
    photoMap[snap.id] = Array.isArray(data.photos) ? data.photos : [];
  });
  shelfBooks.forEach((book) => {
    book.additionalPhotos = Array.isArray(photoMap[book.id]) ? photoMap[book.id] : [];
  });

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
  if (share.allowBriefingAudio && shelfBookIds.size) {
    const audioSnaps = await Promise.all([...shelfBookIds].map((id) => briefingAudioCol.doc(id).get()));
    audioSnaps.forEach((snap) => {
      if (!snap.exists) return;
      const sanitized = sanitizeSharedAudioDoc(snap.data() || {});
      if (sanitized) briefingAudioCache[snap.id] = sanitized;
    });
  }

  return {
    shareType: "shelf",
    resourceName: shelf.name,
    shelfName: shelf.name,
    shelfId: share.resourceId,
    includePersonalNotes: share.includePersonalNotes,
    includeAdditionalPhotos: true,
    allowWikiAI: Boolean(share.allowWikiAI),
    allowBriefingAudio: Boolean(share.allowBriefingAudio),
    books: shelfBooks,
    researchCache: filteredCache,
    briefingAudioCache
  };
});

exports.getSharedBook = onCall(async (request) => {
  const token = cleanText((request.data || {}).token || "");
  if (!token) throw new HttpsError("invalid-argument", "token is required.");

  const share = await resolveShareToken(token);
  if (share.type !== "book") throw new HttpsError("failed-precondition", "This share link is for a shelf.");

  const catalogData = await getCatalogData(share.ownerUid);
  const rawBook = (catalogData.books || []).find((entry) => entry && entry.id === share.resourceId);
  if (!rawBook) throw new HttpsError("not-found", "Book no longer exists.");

  const book = { ...rawBook };
  if (!share.includePersonalNotes) delete book.personalNotes;

  const [briefingSnap, audioSnap, photoSnap] = await Promise.all([
    db.collection("users").doc(share.ownerUid).collection("briefings").doc(share.resourceId).get(),
    db.collection("users").doc(share.ownerUid).collection("briefingAudio").doc(share.resourceId).get(),
    db.collection("users").doc(share.ownerUid).collection("bookPhotos").doc(share.resourceId).get()
  ]);

  const photoData = photoSnap.exists ? (photoSnap.data() || {}) : {};
  book.additionalPhotos = share.includeAdditionalPhotos && Array.isArray(photoData.photos) ? photoData.photos : [];

  const researchCache = {};
  if (briefingSnap.exists) {
    researchCache[share.resourceId] = briefingSnap.data() || {};
  } else {
    const researchSnap = await db.collection("users").doc(share.ownerUid).collection("catalog").doc("research").get();
    const legacyCache = (researchSnap.exists && researchSnap.data().researchCache)
      ? researchSnap.data().researchCache
      : (catalogData.researchCache || {});
    if (legacyCache[share.resourceId]) researchCache[share.resourceId] = legacyCache[share.resourceId];
  }

  const briefingAudioCache = {};
  if (share.allowBriefingAudio && audioSnap.exists) {
    const sanitized = sanitizeSharedAudioDoc(audioSnap.data() || {});
    if (sanitized) briefingAudioCache[share.resourceId] = sanitized;
  }

  return {
    shareType: "book",
    resourceName: share.resourceName || book.title || "Shared Book",
    book,
    books: [book],
    selectedBookId: share.resourceId,
    includePersonalNotes: share.includePersonalNotes,
    includeAdditionalPhotos: share.includeAdditionalPhotos,
    allowWikiAI: Boolean(share.allowWikiAI),
    allowBriefingAudio: Boolean(share.allowBriefingAudio),
    researchCache,
    briefingAudioCache
  };
});

exports.getSharedBriefingAudio = onCall(async (request) => {
  const token = cleanText((request.data || {}).token || "");
  const bookId = cleanText((request.data || {}).bookId || "");
  const requestedMode = cleanText((request.data || {}).spoilerMode || "");

  if (!token) throw new HttpsError("invalid-argument", "token is required.");
  if (!bookId) throw new HttpsError("invalid-argument", "bookId is required.");

  const share = await resolveShareToken(token);
  if (!share.allowBriefingAudio) {
    throw new HttpsError("permission-denied", "Briefing audio is not enabled for this share link.");
  }

  const ownerUid = share.ownerUid;
  const catalogSnap = await db.collection("users").doc(ownerUid).collection("catalog").doc("data").get();
  if (!catalogSnap.exists) throw new HttpsError("not-found", "Library not found.");
  const catalogData = catalogSnap.data() || {};
  const allowed = share.type === "book"
    ? share.resourceId === bookId
    : (catalogData.books || []).some((book) => book && book.id === bookId && (book.listShelfId || "default") === share.resourceId);
  if (!allowed) {
    throw new HttpsError("permission-denied", share.type === "book"
      ? "This book is not part of the shared book link."
      : "This book is not part of the shared shelf.");
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

  const share = await resolveShareToken(token);
  if (!share.allowWikiAI) {
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

  let share;
  try {
    share = await resolveShareToken(token);
  } catch (error) {
    if (error && error.code === "not-found") return { revoked: false };
    throw error;
  }

  if (share.ownerUid !== uid) {
    throw new HttpsError("permission-denied", "Not your share link.");
  }

  const batch = db.batch();
  batch.delete(db.collection("shareLinks").doc(token));
  batch.set(userSharesCol(uid).doc(token), {
    ...share,
    status: "revoked",
    updatedAt: Date.now(),
    revokedAt: Date.now()
  }, { merge: true });

  await batch.commit();
  return { revoked: true };
});

exports.copyCurrentCoverToBookPhoto = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const uid = request.auth.uid;
  const bookId = cleanText((request.data || {}).bookId || "");
  const caption = cleanText((request.data || {}).caption || "Previous cover") || "Previous cover";
  if (!bookId) {
    throw new HttpsError("invalid-argument", "bookId is required.");
  }

  const bucket = admin.storage().bucket();
  const sourcePath = `users/${uid}/covers/${bookId}.jpg`;
  const sourceFile = bucket.file(sourcePath);
  const [exists] = await sourceFile.exists();
  if (!exists) {
    throw new HttpsError("not-found", "Current cover not found.");
  }

  const photoId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const destPath = `users/${uid}/book-photos/${bookId}/${photoId}.jpg`;
  const destFile = bucket.file(destPath);
  await sourceFile.copy(destFile);
  const [sourceMetadata] = await sourceFile.getMetadata().catch(() => [{}]);
  await destFile.setMetadata({
    contentType: sourceMetadata && sourceMetadata.contentType ? sourceMetadata.contentType : "image/jpeg",
    metadata: {
      firebaseStorageDownloadTokens: crypto.randomUUID()
    }
  });
  const url = await getStorageDownloadUrl(destPath);

  const ref = db.collection("users").doc(uid).collection("bookPhotos").doc(bookId);
  const snap = await ref.get();
  const existing = snap.exists && Array.isArray((snap.data() || {}).photos) ? (snap.data() || {}).photos : [];
  const photo = {
    id: photoId,
    url,
    storagePath: destPath,
    caption,
    type: "other",
    createdAt: new Date().toISOString(),
    sortOrder: existing.length
  };
  const photos = existing.concat(photo);
  await ref.set({
    photos,
    updatedAt: new Date().toISOString()
  }, { merge: true });

  return { ok: true, photo, photos };
});
