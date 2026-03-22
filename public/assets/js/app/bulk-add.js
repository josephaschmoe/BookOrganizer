// Bulk Load — photo → AI identify → search → review → add
// ═══════════════════════════════════════════════════════════════

function startBulkCamera()  { try { localStorage.setItem("_cameraActive", Date.now().toString()); } catch(e) {} persistAddFlowState(); document.getElementById("bulkCameraInput").click(); }
function startBulkGallery() { document.getElementById("bulkGalleryInput").click(); }
function startBulkBatchCamera()  { try { localStorage.setItem("_cameraActive", Date.now().toString()); } catch(e) {} persistAddFlowState(); document.getElementById("bulkBatchCameraInput").click(); }
function startBulkBatchGallery() { document.getElementById("bulkBatchGalleryInput").click(); }
function startBulkTextCamera()  { try { localStorage.setItem("_cameraActive", Date.now().toString()); } catch(e) {} persistAddFlowState(); document.getElementById("bulkTextCameraInput").click(); }
function startBulkTextGallery() { document.getElementById("bulkTextGalleryInput").click(); }

function toggleBulkPhotoMode(mode) {
  const bookExpand = document.getElementById("bulkBookModeExpand");
  const batchExpand = document.getElementById("bulkBatchModeExpand");
  const textExpand = document.getElementById("bulkTextModeExpand");
  const pasteWrap = document.getElementById("bulkPasteTextSection");
  let activeMode = "";
  if (mode === "book") {
    const open = bookExpand.style.display === "none";
    bookExpand.style.display = open ? "" : "none";
    batchExpand.style.display = "none";
    textExpand.style.display = "none";
    activeMode = open ? "book" : "";
  } else if (mode === "batch") {
    const open = batchExpand.style.display === "none";
    batchExpand.style.display = open ? "" : "none";
    bookExpand.style.display = "none";
    textExpand.style.display = "none";
    activeMode = open ? "batch" : "";
  } else {
    const open = textExpand.style.display === "none";
    textExpand.style.display = open ? "" : "none";
    bookExpand.style.display = "none";
    batchExpand.style.display = "none";
    activeMode = open ? "text" : "";
  }
  if (pasteWrap && activeMode !== "text") pasteWrap.style.display = "none";
  updateBulkModeCards(activeMode);
  if (activeMode) {
    bulkBatchMode = activeMode === "batch";
    bulkTextMode = activeMode === "text";
    bulkPasteMode = false;
  }
  updateSpecificEditionAvailability();
  persistAddFlowState();
}

function revokeBulkObjectUrls() {
  bulkObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  bulkObjectUrls = [];
}

function resetBulkFlowState() {
  bulkFoundBooks = [];
  bulkIncorrectQueue = [];
  bulkCorrectionIdx = 0;
  bulkCorrSearchResults = [];
  bulkCorrSelectedResult = null;
  bulkSecondPassActive = false;
  bulkSecondPassFailures = [];
  bulkTextMode = false;
  bulkBatchMode = false;
  bulkPasteMode = false;
  bulkAllowDuplicateOverride = false;
  bulkProgress = { total: 0, processed: 0, stage: "", manual: 0, duplicates: 0 };
  revokeBulkObjectUrls();
  updateBulkModeCards();
  renderBulkProgress();
  renderBulkSummary();
  renderBulkMobileProgress();
  const bulkCorrProgress = document.getElementById("bulkCorrProgress");
  const bulkCorrActionMeta = document.getElementById("bulkCorrActionMeta");
  const pasteWrap = document.getElementById("bulkPasteTextSection");
  if (bulkCorrProgress) bulkCorrProgress.innerHTML = "";
  if (bulkCorrActionMeta) bulkCorrActionMeta.textContent = "";
  if (pasteWrap) pasteWrap.style.display = "none";
  updateSpecificEditionAvailability();
}

function updateBulkModeCards(activeMode = "") {
  document.getElementById("bulkModeCardBook").classList.toggle("active", activeMode === "book");
  document.getElementById("bulkModeCardBatch").classList.toggle("active", activeMode === "batch");
  document.getElementById("bulkModeCardText").classList.toggle("active", activeMode === "text");
}

function setBulkProgress(update = {}) {
  bulkProgress = { ...bulkProgress, ...update };
  renderBulkProgress();
}

function renderBulkProgress() {
  const wrap = document.getElementById("bulkProgress");
  const stage = document.getElementById("bulkProgressStage");
  const count = document.getElementById("bulkProgressCount");
  const fill = document.getElementById("bulkProgressFill");
  const total = Number(bulkProgress.total || 0);
  const processed = Math.min(Number(bulkProgress.processed || 0), total || 0);
  if (!wrap || !stage || !count || !fill) return;
  const show = total > 0 || Boolean(bulkProgress.stage);
  wrap.classList.toggle("is-visible", show);
  stage.textContent = bulkProgress.stage || "";
  count.textContent = total > 0 ? `${processed} of ${total}` : "";
  fill.style.width = total > 0 ? `${Math.max(0, Math.min(100, (processed / total) * 100))}%` : "0%";
}

function renderBulkSummary() {
  const el = document.getElementById("bulkSummary");
  if (!el) return;
  const confirmed = bulkFoundBooks.filter((b) => b.correct).length;
  const rejected = bulkFoundBooks.filter((b) => !b.correct).length;
  const unmatched = bulkFoundBooks.filter((b) => b.correct && !canSaveBulkEntryDirectly(b)).length;
  const pills = [];
  if (bulkFoundBooks.length) pills.push(`${bulkFoundBooks.length} found`);
  if (confirmed || bulkFoundBooks.length) pills.push(`${confirmed} confirmed`);
  if (rejected) pills.push(`${rejected} excluded`);
  if (unmatched) pills.push(`${unmatched} unmatched`);
  if (bulkIncorrectQueue.length) pills.push(`${bulkIncorrectQueue.length} manual`);
  if (bulkProgress.duplicates) pills.push(`${bulkProgress.duplicates} merged`);
  el.innerHTML = pills.map((pill) => `<span class="bulk-summary-pill">${esc(pill)}</span>`).join("");
  el.style.display = pills.length ? "" : "none";
}

function renderBulkMobileProgressLegacy() {
  const progressEl = document.getElementById("bulkMobileProgress");
  const actionMeta = document.getElementById("bulkActionMeta");
  if (!progressEl || !actionMeta) return;

  const total = bulkFoundBooks.length;
  const confirmed = bulkFoundBooks.filter((b) => b.correct && b.result).length;
  const manual = bulkFoundBooks.filter((b) => !b.correct || !b.result).length + bulkIncorrectQueue.length;
  progressEl.innerHTML = `
    <span>${total} review item${total !== 1 ? "s" : ""}</span>
    <span>${confirmed} confirmed · ${manual} manual</span>
  `;
  actionMeta.textContent = `${confirmed} confirmed · ${manual} manual`;
}

function renderBulkMobileProgress() {
  const progressEl = document.getElementById("bulkMobileProgress");
  const actionMeta = document.getElementById("bulkActionMeta");
  if (!progressEl || !actionMeta) return;

  const total = bulkFoundBooks.length;
  const confirmed = bulkFoundBooks.filter((b) => canSaveBulkEntryDirectly(b)).length;
  const manual = bulkFoundBooks.filter((b) => !b.correct || !canSaveBulkEntryDirectly(b)).length + bulkIncorrectQueue.length;
  progressEl.innerHTML = `
    <span>${total} review item${total !== 1 ? "s" : ""}</span>
    <span>${confirmed} confirmed | ${manual} manual</span>
  `;
  actionMeta.textContent = `${confirmed} confirmed | ${manual} manual`;
}

function toggleBulkPasteSection() {
  const wrap = document.getElementById("bulkPasteTextSection");
  if (!wrap) return;
  const open = wrap.style.display === "none";
  wrap.style.display = open ? "" : "none";
  if (open) {
    const input = document.getElementById("bulkPasteTextInput");
    if (input) input.focus();
  }
}

function clearBulkPasteText() {
  const input = document.getElementById("bulkPasteTextInput");
  if (input) input.value = "";
  setBulkStatus("", "");
}

function parseBulkPastedText(text) {
  const raw = String(text || "").replace(/\r/g, "\n").trim();
  if (!raw) return [];
  const sourceLines = raw.includes("\n")
    ? raw.split(/\n+/)
    : raw.split(/\s*;\s*/);
  const seen = new Set();
  const entries = [];
  sourceLines.forEach((line) => {
    const cleaned = String(line || "")
      .replace(/^[\s>*-]+/, "")
      .replace(/^\d+[\).\s-]+/, "")
      .trim();
    if (!cleaned) return;
    const match = cleaned.match(/^(.+?)\s+by\s+(.+)$/i);
    const title = match ? match[1].trim() : cleaned;
    const author = match ? match[2].trim() : "";
    const key = `${normalizeCompareText(title)}||${normalizeCompareText(author)}`;
    if (!normalizeCompareText(title) || seen.has(key)) return;
    seen.add(key);
    entries.push({ title, author });
  });
  return entries;
}

async function searchCatalogForBulkEntries(aiBooks) {
  setBulkStatus(`Found ${aiBooks.length} book${aiBooks.length !== 1 ? "s" : ""} - searching catalog for each...`, "");
  const found = [];
  for (let i = 0; i < aiBooks.length; i++) {
    const { title, author } = aiBooks[i];
    setBulkStatus(`Searching ${i + 1} of ${aiBooks.length}: "${title}"...`, "");
    let searchResult = null;
    let candidates = [];
    try {
      const [olHits, gbHits] = await Promise.all([
        searchOpenLibrary(title, author || "").catch(() => []),
        searchGoogleBooks(title, author || "").catch(() => [])
      ]);
      const merged = dedupeManualResults([...gbHits, ...olHits]);
      candidates = merged.slice(0, 6);
      if (merged.length) searchResult = merged[0];

      if (!searchResult || !searchResult.coverUrl) {
        const plainQ = encodeURIComponent([title, author].filter(Boolean).join(" "));
        const plainData = await fetchGbJson(`https://www.googleapis.com/books/v1/volumes?q=${plainQ}&maxResults=5`);
        if (plainData) {
          const plainItems = Array.isArray(plainData.items) ? plainData.items : [];
          for (const item of plainItems) {
            const info = item.volumeInfo || {};
            const il = info.imageLinks || {};
            const coverUrl = (il.thumbnail || il.smallThumbnail || "").replace(/^http:\/\//, "https://")
              || (item.id ? `https://books.google.com/books/content?id=${item.id}&printsec=frontcover&img=1&zoom=1&source=gbs_api` : "");
            if (coverUrl) {
              if (!searchResult) {
                searchResult = {
                  title: info.title || title,
                  author: Array.isArray(info.authors) ? info.authors.join(", ") : (author || ""),
                  publisher: info.publisher || "",
                  year: (info.publishedDate || "").match(/\d{4}/)?.[0] || "",
                  firstPublishedYear: "",
                  edition: info.contentVersion || "",
                  subjects: Array.isArray(info.categories) ? info.categories.join("; ") : "",
                  isbn: extractGoogleIsbn(info.industryIdentifiers || []),
                  coverUrl,
                  source: "Google Books"
                };
              } else {
                searchResult.coverUrl = coverUrl;
              }
              break;
            }
          }
        }
      }
    } catch (_) {}
    found.push({
      aiTitle: title,
      aiAuthor: author || "",
      result: searchResult,
      candidates,
      showCandidates: false,
      correct: true
    });
  }
  return found;
}

async function runBulkPastedText() {
  const input = document.getElementById("bulkPasteTextInput");
  const entries = parseBulkPastedText(input ? input.value : "");
  if (!entries.length) {
    setBulkStatus("Paste at least one title to analyze.", "error");
    return;
  }
  resetBulkFlowState();
  bulkTextMode = true;
  bulkPasteMode = true;
  updateBulkModeCards("text");
  updateSpecificEditionAvailability();
  try {
    showBulkSection("intro");
    const found = await searchCatalogForBulkEntries(entries);
    bulkFoundBooks = found;
    renderBulkResults();
    showBulkSection("results");
    setBulkStatus("", "");
  } catch (error) {
    setBulkStatus(error.message || "Could not process the pasted text.", "error");
  }
}

function handleBulkPhotoSelection(input, textMode = false) {
  const file = input.files && input.files[0];
  input.value = "";
  if (!file) return;
  // Always a fresh start — clear any state left over from a prior session
  resetBulkFlowState();
  bulkTextMode = textMode;
  bulkPasteMode = false;
  // Collapse both expand rows
  document.getElementById("bulkBookModeExpand").style.display = "none";
  document.getElementById("bulkBatchModeExpand").style.display = "none";
  document.getElementById("bulkTextModeExpand").style.display = "none";
  updateBulkModeCards(textMode ? "text" : "book");
  updateSpecificEditionAvailability();
  runBulkAnalysisV2(file);
}

function handleBulkBatchSelection(input) {
  const files = Array.from(input.files || []).filter((file) => file && /^image\//.test(file.type || ""));
  input.value = "";
  if (!files.length) return;
  if (files.length > 20) {
    setBulkStatus("Select up to 20 photos at a time.", "error");
    return;
  }
  resetBulkFlowState();
  bulkBatchMode = true;
  bulkPasteMode = false;
  document.getElementById("bulkBookModeExpand").style.display = "none";
  document.getElementById("bulkBatchModeExpand").style.display = "none";
  document.getElementById("bulkTextModeExpand").style.display = "none";
  updateBulkModeCards("batch");
  updateSpecificEditionAvailability();
  runBulkBatchAnalysis(files);
}

async function runBulkAnalysis(file) {
  if (bulkLoadInFlight) return;
  bulkLoadInFlight = true;
  showBulkSection("intro");
  setBulkStatus("Preparing image...", "");

  try {
    const image = await resizeImage(file, 1600);
    if (!image) {
      setBulkStatus("Could not read the image. Please try another photo.", "error");
      return;
    }

    setBulkStatus(bulkTextMode ? "Sending image to AI - scanning for titles..." : "Sending image to AI - identifying books...", "");
    const identifyFn = functions.httpsCallable("identifyBooksInImage");
    const result = await identifyFn({ image, mode: bulkTextMode ? "text" : "books" });
    const aiBooks = (result.data.books || []).filter(b => b.title);

    if (!aiBooks.length) {
      setBulkStatus("No books could be identified. Try a clearer photo with visible titles or covers.", "error");
      return;
    }

    setBulkStatus(`Found ${aiBooks.length} book${aiBooks.length !== 1 ? "s" : ""} - searching catalog for each...`, "");

    const found = [];
    for (let i = 0; i < aiBooks.length; i++) {
      const { title, author } = aiBooks[i];
      setBulkStatus(`Searching ${i + 1} of ${aiBooks.length}: "${title}"...`, "");
      let searchResult = null;
      let candidates = [];
      try {
        const [olHits, gbHits] = await Promise.all([
          searchOpenLibrary(title, author || "").catch(() => []),
          searchGoogleBooks(title, author || "").catch(() => [])
        ]);
        const merged = dedupeManualResults([...gbHits, ...olHits]);
        candidates = merged.slice(0, 6);
        if (merged.length) searchResult = merged[0];

        // If no result or no cover, retry with a plain-text GB query (no intitle:/inauthor: operators)
        // — handles cases where the AI returns a different author name format than GB expects
        if (!searchResult || !searchResult.coverUrl) {
          const plainQ = encodeURIComponent([title, author].filter(Boolean).join(" "));
          const plainData = await fetchGbJson(`https://www.googleapis.com/books/v1/volumes?q=${plainQ}&maxResults=5`);
          if (plainData) {
            const plainItems = Array.isArray(plainData.items) ? plainData.items : [];
            for (const item of plainItems) {
              const info = item.volumeInfo || {};
              const il = info.imageLinks || {};
              const coverUrl = (il.thumbnail || il.smallThumbnail || "").replace(/^http:\/\//, "https://")
                || (item.id ? `https://books.google.com/books/content?id=${item.id}&printsec=frontcover&img=1&zoom=1&source=gbs_api` : "");
              if (coverUrl) {
                if (!searchResult) {
                  searchResult = {
                    title: info.title || title,
                    author: Array.isArray(info.authors) ? info.authors.join(", ") : (author || ""),
                    publisher: info.publisher || "",
                    year: (info.publishedDate || "").match(/\d{4}/)?.[0] || "",
                    edition: info.contentVersion || "",
                    subjects: Array.isArray(info.categories) ? info.categories.join("; ") : "",
                    isbn: extractGoogleIsbn(info.industryIdentifiers || []),
                    coverUrl,
                    source: "Google Books"
                  };
                } else {
                  searchResult.coverUrl = coverUrl;
                }
                break;
              }
            }
          }
        }
      } catch (_) { /* no result is fine */ }
      found.push({
        aiTitle: title,
        aiAuthor: author || "",
        result: searchResult,
        candidates,
        showCandidates: false,
        correct: true
      });
    }

    bulkFoundBooks = found;
    renderBulkResults();
    showBulkSection("results");
    setBulkStatus("", "");

  } catch (err) {
    setBulkStatus(err.message || "Analysis failed. Please try again.", "error");
  } finally {
    bulkLoadInFlight = false;
  }
}

function normalizeBatchBestMatch(match) {
  if (!match) return null;
  return {
    title: match.title || "",
    author: Array.isArray(match.authors) ? match.authors.join(", ") : "",
    publisher: match.publisher || "",
    year: (match.publishedDate || "").match(/\d{4}/)?.[0] || "",
    edition: match.edition || "",
    contributors: Array.isArray(match.contributors) ? match.contributors.filter(Boolean) : [],
    contributor: Array.isArray(match.contributors) ? (match.contributors[0] || "") : "",
    illustrationNote: match.illustration_note || "",
    subjects: Array.isArray(match.categories) ? match.categories.join("; ") : "",
    isbn: match.isbn_13 || match.isbn_10 || "",
    coverUrl: match.coverUrl || "",
    source: match.source === "google_books" ? "Google Books" : "Open Library",
    confidence: typeof match.confidence === "number" ? match.confidence : 0
  };
}

function batchCandidateKey(match) {
  if (!match) return "";
  return cleanMatchIsbn(match.isbn) || `${normalizeMatchText(match.title)}||${normalizeMatchText(match.author)}`;
}

function normalizeBatchCandidates(candidates = []) {
  const seen = new Set();
  const out = [];
  candidates.forEach((candidate) => {
    const normalized = normalizeBatchBestMatch(candidate);
    if (!normalized) return;
    const key = batchCandidateKey(normalized);
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    out.push(normalized);
  });
  return out;
}

function buildBatchBookEntry(data, file, objectUrl, index) {
  const match = normalizeBatchBestMatch(data && data.bestMatch);
  const candidates = normalizeBatchCandidates(data && data.candidates);
  const extracted = data && data.extracted ? data.extracted : null;
  const exactIsbnAuthority = match ? resultContainsExactIsbn(match, extracted && (extracted.isbn_13 || extracted.isbn_10)) : false;
  return {
    aiTitle: match?.title || extracted?.title || file.name || `Photo ${index + 1}`,
    aiAuthor: match?.author || (Array.isArray(extracted?.authors) ? extracted.authors.join(", ") : ""),
    result: match,
    candidates,
    correct: true,
    extracted,
    enrichment: {},
    exactIsbnAuthority,
    coverSource: match && match.coverUrl ? "database" : "photo",
    showCandidates: false,
    sourcePhotoFile: file,
    sourcePhotoUrl: objectUrl,
    sourcePhotoName: file.name || `Photo ${index + 1}`,
    sourcePhotoIndex: index
  };
}

async function runBulkAnalysisV2(file) {
  if (bulkLoadInFlight) return;
  bulkLoadInFlight = true;
  showBulkSection("intro");
  setBulkStatus("Preparing image...", "");

  try {
    const image = await resizeImage(file, 1600);
    if (!image) {
      setBulkStatus("Could not read the image. Please try another photo.", "error");
      return;
    }

    setBulkStatus(bulkTextMode ? "Sending image to AI - scanning for titles..." : "Sending image to AI - identifying books...", "");
    const identifyFn = functions.httpsCallable("identifyBooksInImage");
    const result = await identifyFn({ image, mode: bulkTextMode ? "text" : "books" });
    const aiBooks = (result.data.books || []).filter((b) => b.title);

    if (!aiBooks.length) {
      setBulkStatus("No books could be identified. Try a clearer photo with visible titles or covers.", "error");
      return;
    }

    bulkFoundBooks = await searchCatalogForBulkEntries(aiBooks);
    renderBulkResults();
    showBulkSection("results");
    setBulkStatus("", "");
  } catch (err) {
    setBulkStatus(err.message || "Analysis failed. Please try again.", "error");
  } finally {
    bulkLoadInFlight = false;
  }
}

function buildBulkSaveBook(entry, specificEdition) {
  const result = entry && entry.result ? entry.result : {};
  const extracted = entry && entry.extracted ? entry.extracted : {};
  const enrichment = entry && entry.enrichment ? entry.enrichment : {};
  const exactIsbnAuthority = Boolean(entry && entry.exactIsbnAuthority);
  const extractedDerived = buildPhotoDerivedBookFromExtracted(extracted, enrichment);
  const extractedContributor = Array.isArray(extracted.contributors) ? (extracted.contributors[0] || "") : "";
  const authoritativeBook = {
    title: result.title || extractedDerived.title || entry.aiTitle || "",
    author: result.author || extractedDerived.author || entry.aiAuthor || "",
    publisher: result.publisher || extractedDerived.publisher || "",
    year: result.year || extractedDerived.year || "",
    edition: result.edition || extractedDerived.edition || "",
    contributor: result.contributor || extractedDerived.contributor || extractedContributor || "",
    illustrationNote: result.illustrationNote || extractedDerived.illustrationNote || "",
    subjects: result.subjects || extractedDerived.subjects || "",
    isbn: cleanMatchIsbn(extracted.isbn_13 || extracted.isbn_10) || cleanMatchIsbn(result.isbn),
    source: "Photo Lookup (ISBN)",
    coverUrl: entry && entry.coverSource === "photo" && entry.sourcePhotoFile ? "" : (result.coverUrl || "")
  };
  const evidenceFirstBook = {
    title: extractedDerived.title || result.title || entry.aiTitle || "",
    author: extractedDerived.author || result.author || entry.aiAuthor || "",
    publisher: extractedDerived.publisher || result.publisher || "",
    year: extractedDerived.year || "",
    edition: extractedDerived.edition || "",
    contributor: extractedDerived.contributor || extractedContributor || "",
    illustrationNote: extractedDerived.illustrationNote || "",
    subjects: extractedDerived.subjects || "",
    isbn: "",
    source: String(enrichment && enrichment.confidence_note || "").trim() ? "Photo Lookup + Perplexity" : "Photo Lookup",
    coverUrl: entry && entry.coverSource === "photo" && entry.sourcePhotoFile ? "" : (result.coverUrl || "")
  };
  if (specificEdition) {
    return normalizeBook(exactIsbnAuthority ? authoritativeBook : evidenceFirstBook);
  }
  const quickAddCandidate = {
    title: result.title || "",
    authors: result.author ? [result.author] : [],
    publishedDate: getBookshelfPhotoSaveYear(entry) || result.year || "",
    firstPublishedYear: getBookshelfPhotoSaveYear(entry) || result.firstPublishedYear || "",
    coverUrl: result.coverUrl || "",
    source: result.source || ""
  };
  return normalizeBook(
    exactIsbnAuthority
      ? buildQuickAddBook(authoritativeBook, { keepEditionMetadata: true, year: authoritativeBook.year })
      : buildWorkLevelPhotoBook(quickAddCandidate, extracted, false)
  );
}

function bulkEntryAddKey(entry, specificEdition) {
  const book = buildBulkSaveBook(entry, specificEdition);
  const isbn = cleanMatchIsbn(book.isbn);
  if (isbn) return `isbn:${isbn}`;
  if (!specificEdition) {
    return `work:${normalizeCompareText(book.title)}||${normalizeCompareText(book.author)}`;
  }
  return [
    "edition",
    normalizeCompareText(book.title),
    normalizeCompareText(book.author),
    normalizeCompareText(book.publisher),
    normalizeCompareText(book.year),
    normalizeCompareText(book.edition),
    normalizeCompareText(book.contributor),
    normalizeCompareText(book.illustrationNote)
  ].join("||");
}

function canSaveBulkEntryDirectly(entry) {
  if (!entry || !entry.correct) return false;
  if (!isBatchSpecificEditionModeEnabled()) return Boolean(entry.result);
  const book = buildBulkSaveBook(entry, true);
  return hasStrongEditionSaveEvidence(book, {
    extracted: entry.extracted || null,
    candidate: entry.result || null,
    enrichment: entry.enrichment || {}
  }, entry.result || null);
}

function dedupeBulkBatchResults(items) {
  return Array.isArray(items) ? items.filter((item) => String(item && item.aiTitle || "").trim()) : [];
}

async function runBulkBatchAnalysis(files) {
  if (bulkLoadInFlight) return;
  bulkLoadInFlight = true;
  setBulkProgress({ total: files.length, processed: 0, stage: "Preparing photos", manual: 0, duplicates: 0 });
  showBulkSection("intro");
  setBulkStatus(`Preparing ${files.length} photo${files.length !== 1 ? "s" : ""}...`, "");

  try {
    const resizedImages = await Promise.all(files.map((file) => resizeImage(file, 1600)));
    const analyzePhotoFn = functions.httpsCallable("analyzeBookPhoto");
    const found = [];
    const failures = [];
    let cursor = 0;
    let completed = 0;
    const concurrency = Math.min(2, files.length);

    async function worker() {
      while (cursor < files.length) {
        const index = cursor++;
        const file = files[index];
        const image = resizedImages[index];
        completed++;
        setBulkProgress({ total: files.length, processed: completed - 1, stage: "Analyzing batch photos" });
        setBulkStatus(`Analyzing ${completed} of ${files.length}: "${file.name}"...`, "");

        const objectUrl = URL.createObjectURL(file);
        bulkObjectUrls.push(objectUrl);

        if (!image) {
          failures.push({
            aiTitle: file.name,
            aiAuthor: "",
            sourcePhotoName: file.name,
            sourcePhotoUrl: objectUrl,
            sourcePhotoIndex: index,
            sourcePhotoFile: file,
            correctionMode: isBatchSpecificEditionModeEnabled() ? "edition" : "search"
          });
          setBulkProgress({ manual: failures.length });
          continue;
        }

        try {
          const result = await analyzePhotoFn({ images: [image] });
          const entry = buildBatchBookEntry(result.data || {}, file, objectUrl, index);
          if (isBatchSpecificEditionModeEnabled() && !entry.exactIsbnAuthority && entry.extracted && entry.extracted.title) {
            setBulkStatus(`Analyzing ${completed} of ${files.length}: "${file.name}" - enriching edition details with Perplexity...`, "");
            try {
              const enrichFn = functions.httpsCallable("resolveEditionMetadata");
              const enrichResult = await enrichFn({
                book: buildPhotoDerivedBookFromExtracted(entry.extracted),
                extracted: entry.extracted,
                candidate: null
              });
              entry.enrichment = enrichResult.data && enrichResult.data.metadata ? enrichResult.data.metadata : {};
            } catch (error) {
              console.warn("[runBulkBatchAnalysis] edition normalization failed:", error);
            }
          }
          found.push(entry);
          setBulkProgress({ processed: completed });
        } catch (_) {
          failures.push({
            aiTitle: file.name,
            aiAuthor: "",
            sourcePhotoName: file.name,
            sourcePhotoUrl: objectUrl,
            sourcePhotoIndex: index,
            sourcePhotoFile: file,
            correctionMode: isBatchSpecificEditionModeEnabled() ? "edition" : "search"
          });
          setBulkProgress({ processed: completed, manual: failures.length });
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    bulkFoundBooks = dedupeBulkBatchResults(found);
    bulkIncorrectQueue = failures;
    setBulkProgress({
      total: files.length,
      processed: files.length,
      stage: "Ready for review",
      manual: failures.length,
      duplicates: Math.max(0, found.length - bulkFoundBooks.length)
    });

    if (!bulkFoundBooks.length && !bulkIncorrectQueue.length) {
      setBulkStatus("No books could be identified from the selected photos.", "error");
      return;
    }
    if (!bulkFoundBooks.length && bulkIncorrectQueue.length > 0) {
      setBulkStatus(`Processed ${files.length} photo${files.length !== 1 ? "s" : ""}. Manual review needed.`, "success");
      startBulkCorrection();
      return;
    }

    renderBulkResults();
    document.querySelectorAll("#bulkBookCards .bulk-pull-hint").forEach((el) => { el.style.display = "none"; });
    showBulkSection("results");

    const dedupedCount = found.length - bulkFoundBooks.length;
    const statusBits = [`Processed ${files.length} photo${files.length !== 1 ? "s" : ""}.`];
    if (dedupedCount > 0) statusBits.push(`Merged ${dedupedCount} duplicate result${dedupedCount !== 1 ? "s" : ""}.`);
    if (bulkIncorrectQueue.length > 0) statusBits.push(`${bulkIncorrectQueue.length} need manual review.`);
    setBulkStatus(statusBits.join(" "), bulkFoundBooks.length ? "success" : "");
  } catch (err) {
    setBulkStatus(err.message || "Batch photo analysis failed.", "error");
  } finally {
    bulkLoadInFlight = false;
  }
}

function setBulkStatus(msg, type) { setStatus("bulkStatus", msg, type); }

function showBulkSection(section) {
  document.getElementById("bulkIntroSection").style.display      = section === "intro"       ? "" : "none";
  document.getElementById("bulkResultsSection").style.display    = section === "results"     ? "" : "none";
  document.getElementById("bulkSecondPassSection").style.display = section === "secondpass"  ? "" : "none";
  document.getElementById("bulkCorrectionSection").style.display = section === "correction"  ? "" : "none";
}

function renderBulkResultsLegacy() {
  const correctCount = bulkFoundBooks.filter(b => b.correct).length;
  document.getElementById("bulkResultsHdr").textContent = bulkTextMode
    ? `${bulkFoundBooks.length} book${bulkFoundBooks.length !== 1 ? "s" : ""} found in text — toggle any to exclude`
    : `${bulkFoundBooks.length} book${bulkFoundBooks.length !== 1 ? "s" : ""} identified — toggle any that are incorrect`;

  document.getElementById("bulkBookCards").innerHTML = bulkFoundBooks.map((b, i) => {
    const r = b.result;
    const cue = describeBulkMatch(b);
    const currentCandidateKey = batchCandidateKey(r);
    const alternateCandidates = Array.isArray(b.candidates)
      ? b.candidates.filter((candidate) => batchCandidateKey(candidate) !== currentCandidateKey)
      : [];
    const selectedCoverUrl = b.coverSource === "photo"
      ? (b.sourcePhotoUrl || (r && r.coverUrl) || "")
      : ((r && r.coverUrl) || b.sourcePhotoUrl || "");
    const cover  = selectedCoverUrl ? `<img src="${escapeAttribute(selectedCoverUrl)}" alt="" onclick="showCoverLightbox('${escapeAttribute(selectedCoverUrl)}')" style="cursor:zoom-in;" title="Click to enlarge">` : "📖";
    const title  = esc(r ? r.title  : b.aiTitle);
    const author = esc(r ? r.author : b.aiAuthor);
    const meta   = r ? [r.publisher, r.year].filter(Boolean).join(" · ") : "(no catalog match)";
    const showCoverChoice = bulkBatchMode && b.sourcePhotoUrl;
    const pickerEvents = `onpointerdown="bulkCoverThumbDown(event,this)" onpointerup="bulkCoverThumbUp(event,this)" onpointercancel="bulkCoverThumbCancel(event,this)" onpointermove="bulkCoverThumbMove(event,this)" oncontextmenu="return false"`;
    const coverChoiceHtml = showCoverChoice ? `
        <div class="bulk-cover-choice">
          ${r && r.coverUrl ? `<div class="cover-choice-thumb${b.coverSource !== "photo" ? " selected" : ""}" data-src="database" data-index="${i}" data-imgurl="${escapeAttribute(r.coverUrl)}" ${pickerEvents}>
            <img src="${escapeAttribute(r.coverUrl)}" alt="Database cover" draggable="false">
            <span>Found cover</span>
          </div>` : ""}
          <div class="cover-choice-thumb${b.coverSource === "photo" ? " selected" : ""}" data-src="photo" data-index="${i}" data-imgurl="${escapeAttribute(b.sourcePhotoUrl)}" ${pickerEvents}>
            <img src="${escapeAttribute(b.sourcePhotoUrl)}" alt="Uploaded photo" draggable="false">
            <span>Your photo</span>
          </div>
        </div>
        <div class="bulk-cover-choice-hint">${r && r.coverUrl ? "Tap to choose cover · hold to preview either image" : "Using your uploaded photo as the cover · hold to preview"}</div>
      ` : "";
    const candidatesHtml = !bulkTextMode && alternateCandidates.length ? `
        <button class="bulk-candidate-toggle" type="button" onclick="toggleBulkCandidates(${i})">${b.showCandidates ? "Hide" : "View"} other matches (${alternateCandidates.length})</button>
        ${b.showCandidates ? `<div class="bulk-candidate-list">
          ${alternateCandidates.map((candidate, candidateIndex) => {
            const candidateCue = describeBulkMatch({ ...b, result: candidate });
            const thumb = candidate.coverUrl
              ? `<div class="candidate-item-thumb"><img src="${escapeAttribute(candidate.coverUrl)}" alt="" onclick="event.stopPropagation();showCoverLightbox('${escapeAttribute(candidate.coverUrl)}')"></div>`
              : `<div class="candidate-item-thumb">📖</div>`;
            return `<button class="candidate-item" type="button" onclick="selectBulkCandidate(${i},${candidateIndex})">
              ${thumb}
              <div class="candidate-item-text">
                <strong>${esc(candidate.title)}</strong>
                <span>${[candidate.author, candidate.year, candidate.source].filter(Boolean).map(esc).join(" | ")}</span>
                <span class="candidate-reason">${esc(candidateCue.badge)} - ${esc(candidateCue.detail)}</span>
              </div>
            </button>`;
          }).join("")}
        </div>` : ""}
      ` : "";
    return `<div class="bulk-book-card${b.correct ? " is-correct" : " is-incorrect"}" id="bulkCard${i}">
      <div class="bulk-book-thumb">${cover}</div>
      <div class="bulk-book-info">
        <div class="bulk-book-title">${title}</div>
        <div class="bulk-book-author">${author}</div>
        <div class="bulk-book-meta">${esc(meta)}</div>
        ${renderExtractedMetadataBlock(b.extracted, { compact: true })}
        <div class="bulk-book-reason">
          <span class="match-cue ${cue.tone}">${esc(cue.badge)}</span>
          <span class="match-reason-detail">${esc(cue.detail)}</span>
        </div>
        ${coverChoiceHtml}
        ${candidatesHtml}
        ${(!bulkSecondPassActive && !bulkTextMode) ? `<div class="bulk-pull-hint" id="bulkHint${i}"${b.correct ? ' style="display:none"' : ''}>← pull this book for cover photo</div>` : ''}
      </div>
      <div class="bulk-toggle-btns">
        <button class="bulk-toggle-btn${b.correct ? " active-correct" : ""}" onclick="toggleBulkBook(${i},true)"  title="Correct">✓</button>
        <button class="bulk-toggle-btn${!b.correct ? " active-incorrect" : ""}" onclick="toggleBulkBook(${i},false)" title="Incorrect">✗</button>
      </div>
    </div>`;
  }).join("");

  if (bulkBatchMode) {
    document.getElementById("bulkResultsHdr").textContent =
      `${bulkFoundBooks.length} book${bulkFoundBooks.length !== 1 ? "s" : ""} found from batch photos â€” toggle any that are incorrect`;
  }
  renderBulkSummary();
  renderBulkMobileProgress();
  updateBulkAddBtn();
  document.getElementById("bulkActionRow").style.display = "";
}

function renderBulkResults() {
  const specificEdition = isBatchSpecificEditionModeEnabled();
  const correctCount = bulkFoundBooks.filter((b) => b.correct).length;
  document.getElementById("bulkResultsHdr").textContent = bulkTextMode
    ? `${bulkFoundBooks.length} book${bulkFoundBooks.length !== 1 ? "s" : ""} found in text - toggle any to exclude`
    : `${bulkFoundBooks.length} book${bulkFoundBooks.length !== 1 ? "s" : ""} identified - toggle any that are incorrect`;

  document.getElementById("bulkBookCards").innerHTML = bulkFoundBooks.map((b, i) => {
    const r = b.result;
    const displayBook = buildBulkSaveBook(b, specificEdition);
    const cue = describeBulkMatch(b);
    const currentCandidateKey = batchCandidateKey(r);
    const alternateCandidates = Array.isArray(b.candidates)
      ? b.candidates.filter((candidate) => batchCandidateKey(candidate) !== currentCandidateKey)
      : [];
    const selectedCoverUrl = b.coverSource === "photo"
      ? (b.sourcePhotoUrl || (r && r.coverUrl) || "")
      : ((r && r.coverUrl) || b.sourcePhotoUrl || "");
    const cover = selectedCoverUrl
      ? `<img src="${escapeAttribute(selectedCoverUrl)}" alt="" onclick="showCoverLightbox('${escapeAttribute(selectedCoverUrl)}')" style="cursor:zoom-in;" title="Click to enlarge">`
      : "BOOK";
    const title = esc((specificEdition ? displayBook.title : (r ? r.title : b.aiTitle)) || "");
    const author = esc((specificEdition ? displayBook.author : (r ? r.author : b.aiAuthor)) || "");
    const metaParts = specificEdition
      ? [displayBook.publisher, displayBook.year, displayBook.edition].filter(Boolean)
      : (r ? [r.publisher, r.year].filter(Boolean) : []);
    const meta = metaParts.length ? metaParts.join(" | ") : (r ? "(catalog match selected)" : "(no catalog match)");
    const showCoverChoice = bulkBatchMode && b.sourcePhotoUrl;
    const pickerEvents = `onpointerdown="bulkCoverThumbDown(event,this)" onpointerup="bulkCoverThumbUp(event,this)" onpointercancel="bulkCoverThumbCancel(event,this)" onpointermove="bulkCoverThumbMove(event,this)" oncontextmenu="return false"`;
    const evidenceNote = specificEdition && !b.exactIsbnAuthority
      ? `<div class="bulk-book-meta">Saving extracted page metadata${b.enrichment && String(b.enrichment.confidence_note || "").trim() ? " with Perplexity enrichment" : ""}; catalog matches are for comparison and cover choice.</div>`
      : "";
    const coverChoiceHtml = showCoverChoice ? `
        <div class="bulk-cover-choice">
          ${r && r.coverUrl ? `<div class="cover-choice-thumb${b.coverSource !== "photo" ? " selected" : ""}" data-src="database" data-index="${i}" data-imgurl="${escapeAttribute(r.coverUrl)}" ${pickerEvents}>
            <img src="${escapeAttribute(r.coverUrl)}" alt="Database cover" draggable="false">
            <span>Found cover</span>
          </div>` : ""}
          <div class="cover-choice-thumb${b.coverSource === "photo" ? " selected" : ""}" data-src="photo" data-index="${i}" data-imgurl="${escapeAttribute(b.sourcePhotoUrl)}" ${pickerEvents}>
            <img src="${escapeAttribute(b.sourcePhotoUrl)}" alt="Uploaded photo" draggable="false">
            <span>Your photo</span>
          </div>
        </div>
        <div class="bulk-cover-choice-hint">${r && r.coverUrl ? "Tap to choose cover | hold to preview either image" : "Using your uploaded photo as the cover | hold to preview"}</div>
      ` : "";
    const candidatesHtml = !bulkTextMode && alternateCandidates.length ? `
        <button class="bulk-candidate-toggle" type="button" onclick="toggleBulkCandidates(${i})">${b.showCandidates ? "Hide" : "View"} other matches (${alternateCandidates.length})</button>
        ${b.showCandidates ? `<div class="bulk-candidate-list">
          ${alternateCandidates.map((candidate, candidateIndex) => {
            const candidateCue = describeBulkMatch({ ...b, result: candidate });
            const thumb = candidate.coverUrl
              ? `<div class="candidate-item-thumb"><img src="${escapeAttribute(candidate.coverUrl)}" alt="" onclick="event.stopPropagation();showCoverLightbox('${escapeAttribute(candidate.coverUrl)}')"></div>`
              : `<div class="candidate-item-thumb">BOOK</div>`;
            return `<button class="candidate-item" type="button" onclick="selectBulkCandidate(${i},${candidateIndex})">
              ${thumb}
              <div class="candidate-item-text">
                <strong>${esc(candidate.title)}</strong>
                <span>${[candidate.author, candidate.year, candidate.source].filter(Boolean).map(esc).join(" | ")}</span>
                <span class="candidate-reason">${esc(candidateCue.badge)} - ${esc(candidateCue.detail)}</span>
              </div>
            </button>`;
          }).join("")}
        </div>` : ""}
      ` : "";
    return `<div class="bulk-book-card${b.correct ? " is-correct" : " is-incorrect"}" id="bulkCard${i}">
      <div class="bulk-book-thumb">${cover}</div>
      <div class="bulk-book-info">
        <div class="bulk-book-title">${title}</div>
        <div class="bulk-book-author">${author}</div>
        <div class="bulk-book-meta">${esc(meta)}</div>
        ${renderExtractedMetadataBlock(b.extracted, { compact: true })}
        ${specificEdition ? renderEnrichmentMetadataBlock(b, displayBook, { compact: true }) : ""}
        ${evidenceNote}
        <div class="bulk-book-reason">
          <span class="match-cue ${cue.tone}">${esc(cue.badge)}</span>
          <span class="match-reason-detail">${esc(cue.detail)}</span>
        </div>
        ${coverChoiceHtml}
        ${candidatesHtml}
        ${(!bulkSecondPassActive && !bulkTextMode) ? `<div class="bulk-pull-hint" id="bulkHint${i}"${b.correct ? ' style="display:none"' : ''}>&lt;- pull this book for cover photo</div>` : ""}
      </div>
      <div class="bulk-toggle-btns">
        <button class="bulk-toggle-btn${b.correct ? " active-correct" : ""}" onclick="toggleBulkBook(${i},true)" title="Correct">OK</button>
        <button class="bulk-toggle-btn${!b.correct ? " active-incorrect" : ""}" onclick="toggleBulkBook(${i},false)" title="Incorrect">X</button>
      </div>
    </div>`;
  }).join("");

  if (bulkBatchMode) {
    document.getElementById("bulkResultsHdr").textContent =
      `${bulkFoundBooks.length} book${bulkFoundBooks.length !== 1 ? "s" : ""} found from batch photos - toggle any that are incorrect`;
  }
  renderBulkSummary();
  renderBulkMobileProgress();
  updateBulkAddBtn();
  document.getElementById("bulkActionRow").style.display = "";
}

function toggleBulkBook(index, correct) {
  bulkFoundBooks[index].correct = correct;
  const card = document.getElementById(`bulkCard${index}`);
  card.className = `bulk-book-card${correct ? " is-correct" : " is-incorrect"}`;
  const [btnOk, btnNo] = card.querySelectorAll(".bulk-toggle-btn");
  btnOk.className = `bulk-toggle-btn${correct  ? " active-correct" : ""}`;
  btnNo.className = `bulk-toggle-btn${!correct ? " active-incorrect" : ""}`;
  if (!bulkSecondPassActive && !bulkBatchMode) {
    const hint = document.getElementById(`bulkHint${index}`);
    if (hint) hint.style.display = correct ? "none" : "";
  }
  renderBulkSummary();
  renderBulkMobileProgress();
  updateBulkAddBtn();
}

function toggleBulkCandidates(index) {
  if (!bulkFoundBooks[index]) return;
  bulkFoundBooks[index].showCandidates = !bulkFoundBooks[index].showCandidates;
  renderBulkResults();
}

function selectBulkCandidate(bookIndex, alternateIndex) {
  const entry = bulkFoundBooks[bookIndex];
  if (!entry || !Array.isArray(entry.candidates)) return;
  const currentKey = batchCandidateKey(entry.result);
  const alternates = entry.candidates.filter((candidate) => batchCandidateKey(candidate) !== currentKey);
  const selected = alternates[alternateIndex];
  if (!selected) return;
  entry.result = selected;
  entry.exactIsbnAuthority = resultContainsExactIsbn(selected, entry.extracted && (entry.extracted.isbn_13 || entry.extracted.isbn_10));
  entry.coverSource = selected.coverUrl ? "database" : "photo";
  entry.showCandidates = false;
  renderBulkResults();
}

function updateBulkAddBtn() {
  const n = bulkFoundBooks.filter((b) => canSaveBulkEntryDirectly(b)).length;
  const btn = document.getElementById("bulkAddCorrectBtn");
  btn.textContent = `Add ${n} Confirmed Book${n !== 1 ? "s" : ""}`;
  btn.disabled = n === 0;
}

function allowBulkDuplicateAdd() {
  bulkAllowDuplicateOverride = true;
  addCorrectBulkBooks();
}

async function addCorrectBulkBooks() {
  const editionAware = isBatchSpecificEditionModeEnabled();
  const toAdd    = bulkFoundBooks.filter((b) => canSaveBulkEntryDirectly(b));
  const noMatch  = bulkFoundBooks.filter((b) => b.correct && !canSaveBulkEntryDirectly(b));
  const incorrect = bulkFoundBooks.filter(b => !b.correct);

  let addedCount = 0, skippedCount = 0;
  const addedIds = new Set();
  const existingBooks = books.slice();
  const duplicateEntries = [];

  for (const b of toAdd) {
    const dupKey = bulkEntryAddKey(b, editionAware);
    if (addedIds.has(dupKey)) continue;
    const prospectiveBook = normalizeBook({
      ...buildBulkSaveBook(b, editionAware),
      condition: "",
      shelf: "",
      notes: "",
      readingStatus: "",
      startDate: "",
      finishDate: "",
      personalNotes: "",
      rating: 0,
      listShelfId: currentShelfId,
      addedAt: Date.now(),
      id: "bulk-preview"
    });
    const already = findDuplicateBookForSave(prospectiveBook, editionAware);
    if (already) {
      duplicateEntries.push({ entry: b, existing: already });
      continue;
    }
    addedIds.add(dupKey);
  }

  if (duplicateEntries.length && !bulkAllowDuplicateOverride) {
    const names = duplicateEntries.slice(0, 2).map(function(item) {
      const duplicateTitle = buildBulkSaveBook(item.entry, editionAware).title || item.entry.aiTitle || "";
      return `"${duplicateTitle}"`;
    }).join(", ");
    const more = duplicateEntries.length > 2 ? ` and ${duplicateEntries.length - 2} more` : "";
    const el = document.getElementById("bulkResultStatus");
    el.className = "lookup-status warning";
    el.innerHTML = `${names}${more} ${duplicateEntries.length === 1 ? "is" : "are"} already in your catalog. <button class="btn btn-light btn-sm" type="button" onclick="allowBulkDuplicateAdd()">Add Anyway</button>`;
    showBulkSection("results");
    return;
  }

  addedIds.clear();

  for (const b of toAdd) {
    const dupKey = bulkEntryAddKey(b, editionAware);
    if (addedIds.has(dupKey)) { skippedCount++; continue; }
    const bookId = Math.random().toString(36).slice(2);
    const usePhotoCover = bulkBatchMode && b.coverSource === "photo" && b.sourcePhotoFile;
    const bulkBook = buildBulkSaveBook(b, editionAware);
    const newBook = normalizeBook({
      ...bulkBook, condition: "", shelf: "", notes: "",
      readingStatus: "", startDate: "", finishDate: "",
      personalNotes: "", rating: 0, listShelfId: currentShelfId,
      coverUrl: usePhotoCover ? "" : (bulkBook.coverUrl || ""),
      addedAt: Date.now(), id: bookId
    });
    newBook.customOrder = getNextCustomOrderForShelf(currentShelfId);
    books.unshift(newBook);
    if (usePhotoCover) {
      try {
        const blob = await compressImageForCover(b.sourcePhotoFile);
        const url = await uploadCoverToStorage(bookId, blob);
        const idx = books.findIndex((entry) => entry.id === bookId);
        if (idx >= 0) {
          books[idx].coverUrl = url;
        }
      } catch (e) {
        console.warn("Bulk cover photo upload failed:", e);
      }
    }
    addedIds.add(dupKey);
    addedCount++;
  }
  bulkAllowDuplicateOverride = false;

  if (addedCount > 0) { await saveBooks(); renderCatalog(); }

  const failures = [
    ...incorrect.map((b) => ({
      ...b,
      correctionMode: editionAware ? "edition" : "search"
    })),
    ...noMatch.map((b)  => ({
      ...b,
      correctionMode: editionAware ? "edition" : "search"
    }))
  ];
  const carryFailures = bulkBatchMode ? [...bulkIncorrectQueue, ...failures] : failures;

  let statusMsg = `Added ${addedCount} book${addedCount !== 1 ? "s" : ""} to TomeShelf.`;
  if (skippedCount) statusMsg += ` (${skippedCount} already in catalog.)`;
  if (addedCount > 0) showToast(statusMsg);

  if (bulkTextMode) {
    // Text mode: add and done — no second pass or manual correction
    setStatus("bulkResultStatus", statusMsg, "success");
    setTimeout(() => { setStatus("bulkResultStatus", "", ""); resetBulkLoad(); }, 2500);
  } else if (bulkSecondPassActive) {
    // Second-pass mode: accumulate failures and return to second-pass section
    bulkSecondPassFailures.push(...failures);
    setStatus("bulkSecondPassStatus", statusMsg, "success");
    showBulkSection("secondpass");
  } else if (bulkBatchMode && carryFailures.length > 0) {
    bulkIncorrectQueue = carryFailures;
    setStatus("bulkResultStatus", statusMsg, "success");
    startBulkCorrection();
  } else if (failures.length > 0) {
    // First pass with failures: enter second-pass mode
    bulkIncorrectQueue = failures;
    bulkSecondPassActive = true;
    showBulkSecondPassSection(statusMsg);
  } else {
    setStatus("bulkResultStatus", statusMsg, "success");
    setTimeout(() => { setStatus("bulkResultStatus", "", ""); resetBulkLoad(); }, 2500);
  }
}

// ── Second-pass flow ──

function showBulkSecondPassSection(statusMsg) {
  const n = bulkIncorrectQueue.length;
  document.getElementById("bulkSecondPassHdr").textContent =
    `${n} book${n !== 1 ? "s" : ""} need${n === 1 ? "s" : ""} another look`;
  document.getElementById("bulkSecondPassList").innerHTML = bulkIncorrectQueue.map(b =>
    `<div class="bulk-second-pass-card">
      <div class="bulk-second-pass-title">${esc(b.aiTitle)}</div>
      ${b.aiAuthor ? `<div class="bulk-second-pass-author">${esc(b.aiAuthor)}</div>` : ""}
    </div>`
  ).join("");
  setStatus("bulkSecondPassStatus", statusMsg, "success");
  showBulkSection("secondpass");
}

function startBulkSecondPassCamera()  { document.getElementById("bulkSecondPassCameraInput").click(); }
function startBulkSecondPassGallery() { document.getElementById("bulkSecondPassGalleryInput").click(); }

function handleBulkSecondPassPhoto(input) {
  const file = input.files && input.files[0];
  input.value = "";
  if (!file) return;
  runBulkAnalysisV2(file);
}

function endBulkSecondPass() {
  bulkIncorrectQueue = bulkSecondPassFailures;
  bulkSecondPassActive = false;
  if (bulkIncorrectQueue.length > 0) {
    startBulkCorrection();
  } else {
    setBulkStatus("All done! Your library has been updated.", "success");
    resetBulkLoad();
    setTimeout(() => setBulkStatus("", ""), 3000);
  }
}

function resetBulkLoad() {
  resetBulkFlowState();
  setBulkStatus("", "");
  showBulkSection("intro");
}

// ── Correction flow ──

function startBulkCorrection() {
  if (bulkSecondPassActive) {
    // Combine original first-pass failures with any second-pass failures so far
    bulkIncorrectQueue = [...bulkIncorrectQueue, ...bulkSecondPassFailures];
    bulkSecondPassActive = false;
  }
  bulkCorrectionIdx = 0;
  renderBulkCorrectionForm();
  showBulkSection("correction");
}

function renderBulkCorrectionProgress(curr, total) {
  const progressEl = document.getElementById("bulkCorrProgress");
  const actionMeta = document.getElementById("bulkCorrActionMeta");
  if (!progressEl || !actionMeta) return;
  const remaining = Math.max(0, total - curr - 1);
  progressEl.innerHTML = `
    <span>Reviewing ${curr + 1} of ${total}</span>
    <span>${remaining} remaining</span>
  `;
  actionMeta.textContent = `${remaining} remaining after this step`;
}

function getCurrentBulkCorrectionItem() {
  return bulkIncorrectQueue[bulkCorrectionIdx] || null;
}

function isBulkCorrectionEditionMode(item = getCurrentBulkCorrectionItem()) {
  return Boolean(isBatchSpecificEditionModeEnabled() && item && item.correctionMode === "edition");
}

function buildBulkCorrectionDraft(item = getCurrentBulkCorrectionItem()) {
  const extracted = item && item.extracted ? item.extracted : {};
  const enrichment = item && item.enrichment ? item.enrichment : {};
  const derived = buildPhotoDerivedBookFromExtracted(extracted, enrichment);
  return {
    title: String(derived.title || (item && item.aiTitle) || "").trim(),
    author: String(derived.author || (item && item.aiAuthor) || "").trim(),
    publisher: String(derived.publisher || "").trim(),
    year: String(derived.year || "").trim(),
    edition: String(derived.edition || "").trim(),
    contributor: String(derived.contributor || "").trim(),
    illustrationNote: String(derived.illustrationNote || "").trim()
  };
}

function syncBulkCorrectionAddButton() {
  const addBtn = document.getElementById("bulkCorrAddBtn");
  if (!addBtn) return;
  if (isBulkCorrectionEditionMode()) {
    addBtn.disabled = !document.getElementById("bulkCorrTitle").value.trim();
  } else {
    addBtn.disabled = !bulkCorrSelectedResult;
  }
}

function renderBulkCorrectionForm() {
  const total = bulkIncorrectQueue.length;
  const curr  = bulkCorrectionIdx;
  if (curr >= total) { finishBulkCorrection(); return; }

  const item = bulkIncorrectQueue[curr];
  const editionMode = isBulkCorrectionEditionMode(item);
  const draft = buildBulkCorrectionDraft(item);
  const editionFields = document.getElementById("bulkEditionReviewFields");
  document.getElementById("bulkCorrectionHdr").textContent =
    `Reviewing book ${curr + 1} of ${total}`;
  renderBulkCorrectionProgress(curr, total);
  document.getElementById("bulkAiSaw").textContent =
    `AI saw: "${item.aiTitle}"${item.aiAuthor ? ` by ${item.aiAuthor}` : ""}`;
  const photoWrap = document.getElementById("bulkCorrPhotoWrap");
  const photo = document.getElementById("bulkCorrPhoto");
  const caption = document.getElementById("bulkCorrPhotoCaption");
  if (item.sourcePhotoUrl) {
    photo.src = item.sourcePhotoUrl;
    photo.onclick = () => showCoverLightbox(item.sourcePhotoUrl);
    caption.textContent = item.sourcePhotoName || "";
    photoWrap.style.display = "";
  } else {
    photo.src = "";
    photo.onclick = null;
    caption.textContent = "";
    photoWrap.style.display = "none";
  }
  document.getElementById("bulkCorrTitle").value  = editionMode ? draft.title : item.aiTitle;
  document.getElementById("bulkCorrAuthor").value = editionMode ? draft.author : item.aiAuthor;
  if (editionFields) editionFields.style.display = editionMode ? "" : "none";
  if (editionMode) {
    document.getElementById("bulkCorrPublisher").value = draft.publisher;
    document.getElementById("bulkCorrYear").value = draft.year;
    document.getElementById("bulkCorrEdition").value = draft.edition;
    document.getElementById("bulkCorrContributor").value = draft.contributor;
    document.getElementById("bulkCorrIllustrationNote").value = draft.illustrationNote;
  }
  document.getElementById("bulkCorrSearchResults").style.display = "none";
  document.getElementById("bulkCorrSearchResults").innerHTML = "";
  bulkCorrSearchResults = [];
  bulkCorrSelectedResult = null;
  document.getElementById("bulkCorrAddBtn").textContent = editionMode ? "Add Reviewed Book" : "Add to Catalog";
  setStatus(
    "bulkCorrStatus",
    editionMode
      ? "Review the extracted edition details. Search is optional unless you need comparison metadata or alternate cover art."
      : "",
    ""
  );
  setStatus("bulkCorrAddStatus", "", "");

  const skipBtn = document.getElementById("bulkCorrSkipBtn");
  if (skipBtn) skipBtn.textContent = curr < total - 1 ? "Skip →" : "Skip (Done)";
  syncBulkCorrectionAddButton();
}

async function bulkCorrectionSearch(broad = false) {
  const title  = document.getElementById("bulkCorrTitle").value.trim();
  const author = document.getElementById("bulkCorrAuthor").value.trim();
  if (!title && !author) {
    return setStatus("bulkCorrStatus", "Enter a title or author to search.", "error");
  }
  setStatus("bulkCorrStatus", broad ? "Trying broader search…" : "Searching…", "");
  document.getElementById("bulkCorrSearchResults").style.display = "none";
  bulkCorrSelectedResult = null;
  syncBulkCorrectionAddButton();

  try {
    const [olResults, gbResults] = await Promise.all([
      searchOpenLibrary(title, author, broad),
      searchGoogleBooks(title, author, broad)
    ]);
    bulkCorrSearchResults = dedupeManualResults([...olResults, ...gbResults]).slice(0, 10);
    if (!bulkCorrSearchResults.length) {
      return setStatus("bulkCorrStatus",
        broad ? "No matches even with broader search. Edit the title/author or skip."
              : "No matches found. Edit the title/author and try again, or skip.", "error");
    }
    renderBulkCorrResults(broad);
    setStatus("bulkCorrStatus",
      broad ? `Broader: ${bulkCorrSearchResults.length} result${bulkCorrSearchResults.length !== 1 ? "s" : ""} — pick one.`
            : `${bulkCorrSearchResults.length} result${bulkCorrSearchResults.length !== 1 ? "s" : ""} — pick one.`, "success");
  } catch (err) {
    setStatus("bulkCorrStatus", "Search failed. Try again or skip.", "error");
  }
}

function renderBulkCorrResults(broad = false) {
  const el = document.getElementById("bulkCorrSearchResults");
  const currentItem = bulkIncorrectQueue[bulkCorrectionIdx] || null;
  el.innerHTML = bulkCorrSearchResults.map((r, i) => {
    const meta  = [r.author, r.year, r.publisher, r.source].filter(Boolean).join(" · ");
    const cue = describeCorrectionResult(currentItem, r);
    const thumb = r.coverUrl ? `<img src="${escapeAttribute(r.coverUrl)}" alt="" onclick="event.stopPropagation();showCoverLightbox('${escapeAttribute(r.coverUrl)}')" style="cursor:zoom-in;" title="Click to enlarge">` : "📖";
    return `<div class="search-result-item" onclick="selectBulkCorrResult(${i})" style="cursor:pointer;display:flex;gap:8px;align-items:center;">
      <div class="bulk-book-thumb" style="flex-shrink:0;">${thumb}</div>
      <div style="min-width:0;flex:1;">
        <div class="search-result-title">${esc(r.title)}</div>
        <div class="search-result-meta">${esc(meta)}</div>
        <div class="search-result-cue">
          <span class="match-cue ${cue.tone}">${esc(cue.badge)}</span>
          <span class="match-reason-detail">${esc(cue.detail)}</span>
        </div>
      </div>
    </div>`;
  }).join("");
  if (!broad) {
    el.innerHTML += `<div style="padding:5px 12px 4px;text-align:right;border-top:1px dashed var(--tan);">
      <button class="btn btn-light btn-sm" type="button" onclick="bulkCorrectionSearch(true)" style="font-size:0.75rem;">None of these? Try broader search →</button>
    </div>`;
  }
  el.style.display = "";
}

function selectBulkCorrResult(index) {
  bulkCorrSelectedResult = bulkCorrSearchResults[index];
  setStatus("bulkCorrStatus", `Selected: "${bulkCorrSelectedResult.title}"`, "success");
  // highlight chosen row
  document.querySelectorAll("#bulkCorrSearchResults .search-result-item").forEach((el, i) => {
    el.style.background = i === index ? "var(--parchment)" : "";
  });
  syncBulkCorrectionAddButton();
}

function clearBulkCorrSearch() {
  bulkCorrSearchResults = [];
  bulkCorrSelectedResult = null;
  document.getElementById("bulkCorrSearchResults").innerHTML = "";
  document.getElementById("bulkCorrSearchResults").style.display = "none";
  setStatus("bulkCorrStatus", "", "");
  syncBulkCorrectionAddButton();
}

async function addBulkCorrectionBook() {
  const item = getCurrentBulkCorrectionItem();
  if (!item) return;
  const editionMode = isBulkCorrectionEditionMode(item);
  const r = bulkCorrSelectedResult;
  if (!editionMode && !r) return;
  const manualBook = {
    title: document.getElementById("bulkCorrTitle").value.trim(),
    author: document.getElementById("bulkCorrAuthor").value.trim(),
    publisher: editionMode ? document.getElementById("bulkCorrPublisher").value.trim() : "",
    year: editionMode ? document.getElementById("bulkCorrYear").value.trim() : "",
    edition: editionMode ? document.getElementById("bulkCorrEdition").value.trim() : "",
    contributor: editionMode ? document.getElementById("bulkCorrContributor").value.trim() : "",
    illustrationNote: editionMode ? document.getElementById("bulkCorrIllustrationNote").value.trim() : ""
  };
  let bookToSave;
  if (editionMode) {
    const exactIsbnAuthority = Boolean(
      r && resultContainsExactIsbn(r, item.extracted && (item.extracted.isbn_13 || item.extracted.isbn_10))
    );
    const extractedDerived = buildPhotoDerivedBookFromExtracted(item.extracted || {}, item.enrichment || {});
    bookToSave = normalizeBook({
      title: manualBook.title || extractedDerived.title || item.aiTitle || "",
      author: manualBook.author || extractedDerived.author || item.aiAuthor || "",
      publisher: manualBook.publisher || (exactIsbnAuthority ? (r.publisher || "") : (extractedDerived.publisher || "")),
      year: manualBook.year || (exactIsbnAuthority ? cleanYearValue(r.year || r.publishedDate) : (extractedDerived.year || "")),
      edition: manualBook.edition || (exactIsbnAuthority ? (r.edition || "") : (extractedDerived.edition || "")),
      contributor: manualBook.contributor || (exactIsbnAuthority ? (r.contributor || "") : (extractedDerived.contributor || "")),
      illustrationNote: manualBook.illustrationNote || extractedDerived.illustrationNote || "",
      subjects: exactIsbnAuthority ? (r.subjects || "") : (extractedDerived.subjects || ""),
      isbn: exactIsbnAuthority ? cleanMatchIsbn(item.extracted && (item.extracted.isbn_13 || item.extracted.isbn_10) || r.isbn) : "",
      source: exactIsbnAuthority ? "Photo Lookup (ISBN)" : (String(item.enrichment && item.enrichment.confidence_note || "").trim() ? "Photo Lookup + Perplexity" : "Photo Lookup"),
      coverUrl: item.sourcePhotoFile ? "" : ((r && r.coverUrl) || "")
    });
    if (!hasStrongEditionSaveEvidence(bookToSave, {
      extracted: item.extracted || null,
      candidate: r || null,
      enrichment: item.enrichment || {}
    }, r || null)) {
      const saveAsQuickAdd = confirm(
        "This exact edition is not confirmed yet.\n\nChoose OK to save this as Quick Add.\nChoose Cancel to continue reviewing edition details."
      );
      if (!saveAsQuickAdd) {
        setStatus("bulkCorrAddStatus", "Continue reviewing edition details before saving.", "");
        return;
      }
      bookToSave = buildQuickAddBook(bookToSave, {
        keepEditionMetadata: exactIsbnAuthority,
        year: exactIsbnAuthority ? String(bookToSave.year || "").trim() : getQuickAddOriginalYear(r || null)
      });
    }
  } else {
    bookToSave = normalizeBook({ ...r });
  }
  const already = findDuplicateBookForSave(bookToSave, editionMode);
  if (already) {
    setStatus("bulkCorrAddStatus", "Already in catalog — skipping.", "error");
  } else {
    const newBook = normalizeBook({
      ...bookToSave, condition: "", shelf: "", notes: "",
      readingStatus: "", startDate: "", finishDate: "",
      personalNotes: "", rating: 0, listShelfId: currentShelfId,
      addedAt: Date.now(), id: Math.random().toString(36).slice(2)
    });
    newBook.customOrder = getNextCustomOrderForShelf(currentShelfId);
    books.unshift(newBook);
    if (editionMode && item.sourcePhotoFile) {
      try {
        const blob = await compressImageForCover(item.sourcePhotoFile);
        const url = await uploadCoverToStorage(newBook.id, blob);
        const idx = books.findIndex((entry) => entry.id === newBook.id);
        if (idx >= 0) books[idx].coverUrl = url;
      } catch (error) {
        console.warn("Bulk correction cover photo upload failed:", error);
      }
    }
    await saveBooks();
    renderCatalog();
    setStatus("bulkCorrAddStatus", `Added "${newBook.title}".`, "success");
    showToast(`Added "${newBook.title}"`);
  }
  await new Promise(r => setTimeout(r, 700));
  bulkCorrectionIdx++;
  renderBulkCorrectionForm();
}

function bulkCorrectionSkip() {
  bulkCorrectionIdx++;
  renderBulkCorrectionForm();
}

function finishBulkCorrection() {
  setBulkStatus("All done! Your library has been updated.", "success");
  resetBulkLoad();
  setTimeout(() => setBulkStatus("", ""), 3000);
}
