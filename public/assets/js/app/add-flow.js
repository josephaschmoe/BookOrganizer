// Add/edit flow slice extracted from page.js.

function renderMetadataRefreshPanel() {
  const banner = document.getElementById("metadataRefreshBanner");
  const existingSection = document.getElementById("metadataRefreshExistingSection");
  const existingGrid = document.getElementById("metadataRefreshExistingGrid");
  const refreshBtn = document.getElementById("metadataRefreshBtn");
  const doneBtn = document.getElementById("metadataRefreshDoneBtn");
  if (!banner || !existingSection || !existingGrid || !refreshBtn || !doneBtn) return;
  if (!isMetadataRefreshMode()) {
    banner.style.display = "none";
    banner.textContent = "";
    existingSection.style.display = "none";
    existingGrid.innerHTML = "";
    refreshBtn.style.display = "";
    doneBtn.style.display = "none";
    return;
  }
  const book = findBook(editingBookId);
  const photos = getMetadataRefreshablePhotos(book);
  banner.style.display = "";
  banner.textContent = "Refreshing metadata for this existing book. Use stored photos, new photos, ISBN, or manual search. Save updates this record instead of creating a duplicate.";
  refreshBtn.style.display = "none";
  doneBtn.style.display = "";
  if (!photos.length) {
    existingSection.style.display = "none";
    existingGrid.innerHTML = "";
    return;
  }
  existingSection.style.display = "";
  existingGrid.innerHTML = photos.map((photo) => `
    <div class="metadata-refresh-photo">
      <img src="${escapeAttribute(photo.url)}" alt="${escapeAttribute(photo.label)}" onclick="showMetadataRefreshPhotoLightbox('${escapeAttribute(photo.id)}')" style="cursor:zoom-in;" title="Tap to enlarge">
      <div class="metadata-refresh-photo-label">${esc(photo.label)}</div>
      <button class="btn btn-light btn-sm" type="button" onclick="useStoredMetadataPhoto('${escapeAttribute(photo.id)}')">Use Photo</button>
    </div>
  `).join("");
}

function populateMetadataRefreshFields(book) {
  if (!book) return;
  document.getElementById("isbnInput").value = book.isbn || "";
  document.getElementById("manTitle").value = book.title || "";
  document.getElementById("manAuthor").value = book.author || "";
  document.getElementById("manPublisher").value = book.publisher || "";
  document.getElementById("manYear").value = book.year || "";
  document.getElementById("manEdition").value = book.edition || "";
  document.getElementById("manContributor").value = book.contributor || "";
  document.getElementById("manSubjects").value = book.subjects || "";
  updateAuthorSortField(book.authorSort || book.author || "", true);
}

function startMetadataRefresh() {
  const book = editingBookId ? findBook(editingBookId) : null;
  if (!book) return;
  metadataRefreshContext = { bookId: book.id };
  _coverSourceTouched = false;
  document.getElementById("addModeSection").style.display = "";
  document.getElementById("saveBookBtn").textContent = "Update Metadata";
  document.getElementById("addPanelTitle").textContent = `Refresh Metadata: ${book.title.length > 28 ? book.title.slice(0, 28) + "â€¦" : book.title}`;
  chooseAddFlow("isbn", "photo");
  populateMetadataRefreshFields(book);
  renderMetadataRefreshPanel();
  setStatus("addStatus", "Metadata refresh is ready. Use a stored photo, new photo, ISBN lookup, or manual search.", "");
}

function stopMetadataRefresh() {
  if (!editingBookId) return;
  metadataRefreshContext = null;
  document.getElementById("addModeSection").style.display = "none";
  document.getElementById("saveBookBtn").textContent = "Save Changes";
  document.getElementById("addPanelTitle").textContent = `Editing: ${document.getElementById("editBookTitle").textContent || "Book"}`;
  pendingBook = null;
  pendingEditionLookupContext = null;
  manualSelectedResult = null;
  reviewData = null;
  photoFiles = [];
  photoFileSourceMeta = [];
  pendingCoverBlob = null;
  pendingCoverBlobPromise = null;
  _coverSourceTouched = false;
  document.getElementById("photoPreviewRow").innerHTML = "";
  if (_photoObjectUrl) {
    URL.revokeObjectURL(_photoObjectUrl);
    _photoObjectUrl = null;
  }
  clearManualSearch(false);
  document.getElementById("reviewSection").style.display = "none";
  document.getElementById("coverPreview").innerHTML = "";
  const manualCoverPreview = document.getElementById("manualCoverPreview");
  if (manualCoverPreview) manualCoverPreview.innerHTML = "";
  setStatus("photoStatus", "", "");
  setStatus("lookupStatus", "Enter an ISBN and click Find by ISBN, or use Scan.", "");
  renderMetadataRefreshPanel();
  setStatus("addStatus", "", "");
}

async function useStoredMetadataPhoto(photoId) {
  if (!isMetadataRefreshMode()) return;
  const book = findBook(editingBookId);
  if (!book) return;
  const photo = getMetadataRefreshablePhotos(book).find((entry) => entry.id === photoId);
  if (!photo) return;
  if (photoFiles.length >= 3) {
    setStatus("photoStatus", "You can use up to 3 photos for one book.", "error");
    return;
  }
  chooseAddFlow("isbn", "photo");
  setMobileSection("add");
  document.getElementById("reviewSection").style.display = "none";
  reviewData = null;
  setStatus("photoStatus", "Adding saved photoâ€¦", "");
  photoFiles = photoFiles.concat({
    __storedPhoto: true,
    id: photo.id,
    url: photo.url,
    storagePath: photo.storagePath || "",
    mimeType: "image/jpeg"
  });
  photoFileSourceMeta = photoFileSourceMeta.concat({
    kind: "stored",
    photoId: photo.id,
    url: photo.url,
    storagePath: photo.storagePath || "",
    sourceKind: photo.sourceKind || ""
  });
  if (_selectedPhotoCoverIndex >= photoFiles.length) _selectedPhotoCoverIndex = 0;
  refreshSelectedPhotoObjectUrl();
  renderPhotoThumbnails();
  updateSinglePhotoRefinementActions();
  const lookupSection = document.getElementById("photoLookupSection");
  if (lookupSection) {
    lookupSection.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  setStatus("photoStatus", `Saved photo added (${photoFiles.length}/3). Tap Analyze when ready.`, "success");
}

function showMetadataRefreshPhotoLightbox(photoId) {
  if (!isMetadataRefreshMode()) return;
  const book = findBook(editingBookId);
  if (!book) return;
  const photos = getMetadataRefreshablePhotos(book);
  const index = photos.findIndex((entry) => entry.id === photoId);
  if (index < 0) return;
  showCoverLightbox(photos[index].url, photos.map((entry) => entry.url), index);
}

function updateAuthorSortField(author, force = false) {
  const input = document.getElementById("bookAuthorSort");
  if (!input) return;
  const suggested = buildAuthorSortKey(author);
  if (force || !_authorSortTouched || !input.value.trim()) {
    input.value = suggested;
    input.dataset.auto = "1";
    if (force) _authorSortTouched = false;
  }
}

function markAuthorSortManual() {
  const input = document.getElementById("bookAuthorSort");
  if (!input) return;
  _authorSortTouched = true;
  input.dataset.auto = "0";
}

function syncAuthorSortFromManualAuthor() {
  const authorInput = document.getElementById("manAuthor");
  if (!authorInput) return;
  updateAuthorSortField(authorInput.value, false);
}

function switchTab(tab) {
  if (tab === "isbn" && editingBookId && !isMetadataRefreshMode()) {
    stopEditing();
    setStatus("addStatus", "", "");
  }
  currentTab = tab;
  document.getElementById("tabIsbn").style.display = tab === "isbn" ? "" : "none";
  document.getElementById("tabManual").style.display = tab === "manual" ? "" : "none";
  document.getElementById("tabBulk").style.display = tab === "bulk" ? "" : "none";
  document.querySelectorAll(".tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });
  document.querySelectorAll(".chooser-card").forEach((card) => {
    card.classList.toggle("active", card.dataset.chooserTab === tab);
  });
  pendingBook = null;
  clearManualSearch();
  document.getElementById("coverPreview").innerHTML = "";
  const manualCoverPreview = document.getElementById("manualCoverPreview");
  if (manualCoverPreview) manualCoverPreview.innerHTML = "";
  setStatus("lookupStatus", "Enter an ISBN and click Find by ISBN, or use Scan.", "");
  if (tab !== "manual") {
    clearManualSearch(false);
  }
  document.getElementById("bookMetaSection").style.display = tab === "manual" ? "" : "none";
  if (tab === "isbn") setSingleAddMode(singleAddMode || "photo");
  if (tab === "bulk") updateBulkModeCards();
  updateSpecificEditionAvailability();
  updateSinglePhotoRefinementActions();
  updateAddFlowStageLabel(tab);
  persistAddFlowState();
}

function chooseAddFlow(tab, mode = null) {
  if (tab && desktopAddPanelCollapsed && window.innerWidth >= 1024) {
    setDesktopAddPanelCollapsed(false);
  }
  switchTab(tab);
  if (tab === "isbn" && mode) setSingleAddMode(mode);
}

function goToAddFlow(tab, mode = null) {
  chooseAddFlow(tab, mode);
  setMobileSection("add");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function persistAddFlowState() {
  try {
    localStorage.setItem("tomeshelf-add-tab", currentTab || "isbn");
    localStorage.setItem("tomeshelf-single-add-mode", singleAddMode || "photo");
    localStorage.setItem("tomeshelf-bulk-mode", bulkBatchMode ? "batch" : (bulkTextMode ? "text" : "book"));
  } catch (e) {}
}

function restoreAddFlowState() {
  try {
    const tab = localStorage.getItem("tomeshelf-add-tab") || "isbn";
    const singleMode = localStorage.getItem("tomeshelf-single-add-mode") || "photo";
    const bulkMode = localStorage.getItem("tomeshelf-bulk-mode") || "book";
    switchTab(tab);
    if (tab === "isbn") setSingleAddMode(singleMode);
    if (tab === "bulk") toggleBulkPhotoMode(bulkMode);
  } catch (e) {}
}

function setSingleAddMode(mode) {
  singleAddMode = mode === "isbn" ? "isbn" : "photo";
  const showIsbn = singleAddMode === "isbn";
  document.getElementById("singleAddCardPhoto").classList.toggle("active", !showIsbn);
  document.getElementById("singleAddCardIsbn").classList.toggle("active", showIsbn);
  document.getElementById("singleAddPhotoPane").style.display = showIsbn ? "none" : "";
  document.getElementById("singleAddIsbnPane").style.display = showIsbn ? "" : "none";
  updateAddFlowStageLabel("isbn");
  persistAddFlowState();
}

function updateAddFlowStageLabel(tab = currentTab) {
  const el = document.getElementById("addFlowStageLabel");
  if (!el) return;
  if (tab === "manual") {
    el.textContent = "Selected workflow: Manual entry";
    return;
  }
  if (tab === "bulk") {
    el.textContent = "Selected workflow: Multi-book bulk load";
    return;
  }
  el.textContent = singleAddMode === "isbn"
    ? "Selected workflow: Identify one book by ISBN"
    : "Selected workflow: Identify one book from photos";
}

function applyUiDetailMode() {
  const compact = uiDetailMode === "compact";
  const icons = uiDetailMode === "icons";
  const compactLike = compact || icons;
  document.body.classList.toggle("ui-compact", compact);
  document.body.classList.toggle("ui-icons", icons);
  const select = document.getElementById("uiDetailModeSelect");
  if (select) select.value = uiDetailMode;
  const bulkBookBtn = document.getElementById("bulkModeBtnBook");
  const bulkBatchBtn = document.getElementById("bulkModeBtnBatch");
  const bulkTextBtn = document.getElementById("bulkModeBtnText");
  if (bulkBookBtn) bulkBookBtn.textContent = compactLike ? "Bookshelf Photo" : "Use Bookshelf Photo";
  if (bulkBatchBtn) bulkBatchBtn.textContent = compactLike ? "Batch Photos" : "Use Batch Photos";
  if (bulkTextBtn) bulkTextBtn.textContent = compactLike ? "Titles in Text" : "Use Text Extraction";
  refreshBookDetailActionPresentation();
  updateResearchButtons();
  if (selectedBookId) renderBriefingPanel();
}

function setUiDetailMode(mode) {
  uiDetailMode = (mode === "compact" || mode === "icons") ? mode : "guided";
  try { localStorage.setItem("tomeshelf-ui-detail-mode", uiDetailMode); } catch (e) {}
  applyUiDetailMode();
}

function restoreUiDetailMode() {
  try { uiDetailMode = localStorage.getItem("tomeshelf-ui-detail-mode") || "guided"; } catch (e) { uiDetailMode = "guided"; }
  if (uiDetailMode !== "compact" && uiDetailMode !== "icons") uiDetailMode = "guided";
  applyUiDetailMode();
}

function setDesktopAddPanelCollapsed(collapsed) {
  desktopAddPanelCollapsed = Boolean(collapsed) && window.innerWidth >= 1024;
  document.body.classList.toggle("desktop-add-collapsed", desktopAddPanelCollapsed);
  const btn = document.getElementById("addPanelToggle");
  if (btn) {
    btn.title = desktopAddPanelCollapsed ? "Expand add panel" : "Collapse add panel";
    btn.setAttribute("aria-label", btn.title);
  }
  try { localStorage.setItem("tomeshelf-add-panel-collapsed", desktopAddPanelCollapsed ? "1" : "0"); } catch (e) {}
}

function toggleDesktopAddPanel() {
  setDesktopAddPanelCollapsed(!desktopAddPanelCollapsed);
}

function restoreDesktopAddPanelState() {
  let collapsed = false;
  try { collapsed = localStorage.getItem("tomeshelf-add-panel-collapsed") === "1"; } catch (e) {}
  setDesktopAddPanelCollapsed(collapsed);
}

function setDesktopBriefingPanelExpanded(expanded) {
  desktopBriefingPanelExpanded = Boolean(expanded) && window.innerWidth >= 1024;
  document.body.classList.toggle("desktop-briefing-expanded", desktopBriefingPanelExpanded);
  const btn = document.getElementById("briefingPanelToggle");
  if (btn) {
    btn.title = desktopBriefingPanelExpanded ? "Shrink briefing panel" : "Expand briefing panel";
    btn.setAttribute("aria-label", btn.title);
  }
  try { localStorage.setItem("tomeshelf-briefing-panel-expanded", desktopBriefingPanelExpanded ? "1" : "0"); } catch (e) {}
}

function toggleDesktopBriefingPanel() {
  setDesktopBriefingPanelExpanded(!desktopBriefingPanelExpanded);
}

function restoreDesktopBriefingPanelState() {
  let expanded = false;
  try { expanded = localStorage.getItem("tomeshelf-briefing-panel-expanded") === "1"; } catch (e) {}
  setDesktopBriefingPanelExpanded(expanded);
}

window.addEventListener("resize", function() {
  const isMobileLayout = window.innerWidth < 1024;
  if (isMobileLayout) {
    document.body.classList.remove("desktop-add-collapsed");
    document.body.classList.remove("desktop-briefing-expanded");
  } else {
    document.body.classList.toggle("desktop-add-collapsed", desktopAddPanelCollapsed);
    document.body.classList.toggle("desktop-briefing-expanded", desktopBriefingPanelExpanded);
  }
  if (isMobileLayout && !wasMobileLayout) {
    setMobileSection(selectedBookId ? "briefing" : "catalog");
  }
  if (!isMobileLayout && wasMobileLayout) {
    document.querySelectorAll(".main > div").forEach((el) => el.classList.remove("mobile-active"));
  }
  wasMobileLayout = isMobileLayout;
});

async function loadApiConfig() {
  researchEnabled = Boolean(auth.currentUser);
  briefingAudioProAvailableToday = false;
  adminAccessState = {
    hasStoredAdminAccess: false,
    adminAccessValid: false,
    adminAccessDisabled: false,
    adminAccessStale: false
  };
  if (!researchEnabled) {
    setResearchStatus("Sign in to enable book briefings.", "error");
  } else {
    try {
      const result = await functions.httpsCallable("getBriefingAudioTtsStatus")({});
      briefingAudioProAvailableToday = Boolean(result.data && result.data.proAvailableToday);
      adminAccessState = {
        hasStoredAdminAccess: Boolean(result.data && result.data.hasStoredAdminAccess),
        adminAccessValid: Boolean(result.data && result.data.adminAccessValid),
        adminAccessDisabled: Boolean(result.data && result.data.adminAccessDisabled),
        adminAccessStale: Boolean(result.data && result.data.adminAccessStale)
      };
    } catch (error) {
      console.warn("[loadApiConfig] briefing audio TTS status unavailable:", error);
    }
    setResearchStatus("", "");
  }
}

function isAdminAccessTemporarilyDisabled(state) {
  const next = state || adminAccessState || {};
  return Boolean(
    next.adminAccessDisabled ||
    (next.hasStoredAdminAccess && !next.adminAccessValid && !next.adminAccessStale)
  );
}

async function lookupISBN(isbn) {
  const raw = (isbn || document.getElementById("isbnInput").value).trim().replace(/[^0-9X]/gi, "");
  if (!raw) {
    return setStatus("lookupStatus", "Please enter an ISBN.", "error");
  }

  setStatus("lookupStatus", "Looking up book data...", "");
  document.getElementById("coverPreview").innerHTML = "";
  pendingBook = null;

  try {
    const res = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${raw}&format=json&jscmd=data`);
    const data = await res.json();
    const key = `ISBN:${raw}`;

    if (data[key]) {
      const b = data[key];
      let coverUrl = (b.cover && (b.cover.medium || b.cover.small)) || "";

      // Open Library has the record but no cover â€” try Google Books for just the image
      if (!coverUrl) {
        try {
          const gbData = await fetchGbJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:${raw}&maxResults=1`);
          if (gbData && gbData.totalItems > 0) {
            const links = (gbData.items[0].volumeInfo || {}).imageLinks || {};
            const raw_url = links.thumbnail || links.smallThumbnail || "";
            coverUrl = raw_url.replace(/^http:\/\//, "https://");
          }
        } catch (e) { /* no cover is fine */ }
      }

      pendingBook = {
        isbn: raw,
        title: b.title || "",
        author: (b.authors || []).map((author) => author.name).join(", "),
        publisher: (b.publishers || []).map((publisher) => publisher.name).join(", "),
        year: (b.publish_date || "").match(/\d{4}/)?.[0] || "",
        subjects: (b.subjects || []).slice(0, 5).map((subject) => subject.name || subject).join("; "),
        edition: "",
        coverUrl,
        source: "Open Library"
      };
      showLookupResult();
      return;
    }
    const googleData = await fetchGbJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:${raw}&maxResults=8`);

    if (googleData && googleData.totalItems > 0) {
      const v = googleData.items[0].volumeInfo || {};
      pendingBook = {
        isbn: raw,
        title: v.title || "",
        author: (v.authors || []).join(", "),
        publisher: v.publisher || "",
        year: (v.publishedDate || "").match(/\d{4}/)?.[0] || "",
        subjects: (v.categories || []).join("; "),
        edition: "",
        coverUrl: ((v.imageLinks && (v.imageLinks.thumbnail || v.imageLinks.smallThumbnail)) || "").replace(/^http:\/\//, "https://"),
        source: "Google Books"
      };
      showLookupResult();
      return;
    }

    setStatus("lookupStatus", "Book not found. Try manual entry.", "error");
  } catch (error) {
    setStatus("lookupStatus", "Network error while looking up the ISBN.", "error");
  }
}

function showLookupResult() {
  document.getElementById("bookMetaSection").style.display = "";
  updateAuthorSortField(pendingBook.author || "", true);
  updateFillEditionButton();
  if (pendingBook.coverUrl) {
    document.getElementById("coverPreview").innerHTML = `<img src="${escapeAttribute(pendingBook.coverUrl)}" alt="Book cover" onclick="showCoverLightbox('${escapeAttribute(pendingBook.coverUrl)}')" style="cursor:zoom-in;" title="Click to enlarge">`;
  }
  setStatus(
    "lookupStatus",
    `Found: \"${pendingBook.title}\"${pendingBook.author ? " by " + pendingBook.author : ""} (${pendingBook.source})`,
    "success"
  );
}

async function searchManualBook(broad = false) {
  const searchInput = getManualSearchInput();
  const title = searchInput.title;
  const author = searchInput.author;

  if (!title && !author) {
    return setStatus("manualSearchStatus", "Enter a title or author to search.", "error");
  }

  setStatus("manualSearchStatus", broad ? "Trying broader searchâ€¦" : "Searching catalog sources...", "");
  renderManualSearchResults([]);

  try {
    const [openLibraryResults, googleResults] = await Promise.all([
      searchOpenLibrary(searchInput, broad),
      searchGoogleBooks(searchInput, broad)
    ]);
    const merged = rankAndSortManualResults(dedupeManualResults([...openLibraryResults, ...googleResults]), searchInput).slice(0, 12);
    manualSearchResults = merged;

    if (!merged.length) {
      return setStatus("manualSearchStatus",
        broad ? "No matches found even with a broader search. Try editing the title or author."
              : "No matches found. You can still enter the book manually.", "error");
    }

    renderManualSearchResults(merged, broad);
    setStatus("manualSearchStatus",
      broad ? `Broader search: ${merged.length} possible match${merged.length === 1 ? "" : "es"}. Choose one to fill the form.`
            : `Found ${merged.length} possible match${merged.length === 1 ? "" : "es"}. Choose one to fill the form.`, "success");
  } catch (error) {
    setStatus("manualSearchStatus", "Search failed. You can still enter the book manually.", "error");
  }
}

function getManualSearchInput() {
  const specificEdition = isSpecificEditionModeEnabled();
  return {
    title: document.getElementById("manTitle").value.trim(),
    author: document.getElementById("manAuthor").value.trim(),
    publisher: specificEdition ? document.getElementById("manPublisher").value.trim() : "",
    year: document.getElementById("manYear").value.trim(),
    edition: specificEdition ? document.getElementById("manEdition").value.trim() : "",
    contributor: specificEdition ? document.getElementById("manContributor").value.trim() : ""
  };
}

function normalizeCatalogSearchInput(searchOrTitle, author = "", broad = false) {
  if (searchOrTitle && typeof searchOrTitle === "object" && !Array.isArray(searchOrTitle)) {
    return {
      title: String(searchOrTitle.title || "").trim(),
      author: String(searchOrTitle.author || "").trim(),
      publisher: String(searchOrTitle.publisher || "").trim(),
      year: String(searchOrTitle.year || "").trim(),
      edition: String(searchOrTitle.edition || "").trim(),
      contributor: String(searchOrTitle.contributor || "").trim(),
      broad: Boolean(author)
    };
  }
  return {
    title: String(searchOrTitle || "").trim(),
    author: String(author || "").trim(),
    publisher: "",
    year: "",
    edition: "",
    contributor: "",
    broad: Boolean(broad)
  };
}

async function searchOpenLibrary(searchOrTitle, author, broad = false) {
  const search = normalizeCatalogSearchInput(searchOrTitle, author, broad);
  const params = new URLSearchParams();
  if (search.broad) {
    params.set("q", [search.title, search.author, search.publisher, search.contributor, search.year].filter(Boolean).join(" "));
  } else {
    if (search.title) params.set("title", search.title);
    if (search.author) params.set("author", search.author);
  }
  params.set("limit", "8");

  const response = await fetch(`https://openlibrary.org/search.json?${params.toString()}`);
  const data = await response.json();
  const docs = Array.isArray(data.docs) ? data.docs : [];

  return docs.slice(0, 8).map((doc) => ({
    key: `ol-${doc.key || doc.cover_edition_key || Math.random().toString(36).slice(2)}` ,
    title: doc.title || "",
    author: Array.isArray(doc.author_name) ? doc.author_name.join(", ") : "",
    publisher: Array.isArray(doc.publisher) ? doc.publisher[0] || "" : "",
    year: doc.first_publish_year ? String(doc.first_publish_year) : "",
    firstPublishedYear: doc.first_publish_year ? String(doc.first_publish_year) : "",
    edition: doc.edition_count ? `${doc.edition_count} edition${doc.edition_count === 1 ? "" : "s"}` : "",
    contributors: Array.isArray(doc.contributor) ? doc.contributor.filter(Boolean) : [],
    subjects: Array.isArray(doc.subject) ? doc.subject.slice(0, 5).join("; ") : "",
    isbn: Array.isArray(doc.isbn) ? doc.isbn[0] || "" : "",
    coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : "",
    source: "Open Library"
  }));
}

// â”€â”€ Google Books API key rotation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// When one key hits its daily quota (403/429), the next key is tried automatically.
// Add a second key below to enable rotation. Keys reset at midnight Pacific time.
const _gbKeys = [
  "AIzaSyCJ5d8DPCrDZnJuQr9tWvyK0KHEo3ibuYg",  // key 1
  "AIzaSyAO92owqis5fAAJhrrJmpgKEHndAyDTBmE"   // key 2 (separate project)
];
const _programmableSearchCx = "e7336eb50664d4bba";
let _gbActiveKey = 0;

// Fetch Google Books JSON with automatic key rotation on 403 / 429.
// Pass the full URL *without* a key parameter â€” the key is appended here.
async function fetchGbJson(urlWithoutKey) {
  const startKey = _gbActiveKey;  // snapshot so mutations inside the loop don't skew subsequent keyIdx
  for (let attempt = 0; attempt < _gbKeys.length; attempt++) {
    const keyIdx = (startKey + attempt) % _gbKeys.length;
    if (!_gbKeys[keyIdx]) continue;
    const res = await fetch(`${urlWithoutKey}&key=${_gbKeys[keyIdx]}`).catch(() => null);
    if (!res) continue;
    if (res.status === 403 || res.status === 429) {
      // Log the full error body so we can read the 'reason' field
      const errBody = await res.clone().text().catch(() => "");
      console.error(`[GB key${keyIdx + 1}] HTTP ${res.status} â€”`, errBody);
      _gbActiveKey = (keyIdx + 1) % _gbKeys.length;  // rotate for all subsequent calls
      continue;
    }
    if (!res.ok) return null;
    return res.json().catch(() => null);
  }
  return null;  // all keys exhausted
}

async function fetchProgrammableSearchJson(urlWithoutKey) {
  if (!_programmableSearchCx) return null;
  const startKey = _gbActiveKey;
  for (let attempt = 0; attempt < _gbKeys.length; attempt++) {
    const keyIdx = (startKey + attempt) % _gbKeys.length;
    if (!_gbKeys[keyIdx]) continue;
    const joiner = urlWithoutKey.includes("?") ? "&" : "?";
    const res = await fetch(`${urlWithoutKey}${joiner}cx=${encodeURIComponent(_programmableSearchCx)}&key=${_gbKeys[keyIdx]}`).catch(() => null);
    if (!res) continue;
    if (res.status === 403 || res.status === 429) {
      const errBody = await res.clone().text().catch(() => "");
      console.error(`[CSE key${keyIdx + 1}] HTTP ${res.status} -`, errBody);
      _gbActiveKey = (keyIdx + 1) % _gbKeys.length;
      continue;
    }
    if (!res.ok) return null;
    return res.json().catch(() => null);
  }
  return null;
}
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function extractContributorCreditsFromText(textParts) {
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
  return dedupeStringArray(found);
}

async function searchGoogleBooks(searchOrTitle, author, broad = false) {
  const search = normalizeCatalogSearchInput(searchOrTitle, author, broad);
  const terms = [];
  if (search.broad) {
    if (search.title) terms.push(search.title);
    if (search.author) terms.push(search.author);
    if (search.publisher) terms.push(search.publisher);
    if (search.contributor) terms.push(search.contributor);
    if (search.year) terms.push(search.year);
  } else {
    if (search.title) terms.push(`intitle:${search.title}`);
    if (search.author) terms.push(`inauthor:${search.author}`);
  }
  if (!terms.length) {
    return [];
  }

  const data = await fetchGbJson(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(terms.join(" "))}&maxResults=8`);
  const items = Array.isArray(data && data.items) ? data.items : [];

  return items.slice(0, 8).map((item) => {
    const info = item.volumeInfo || {};
    return {
      key: `gb-${item.id || Math.random().toString(36).slice(2)}` ,
      title: info.title || "",
      author: Array.isArray(info.authors) ? info.authors.join(", ") : "",
      publisher: info.publisher || "",
      year: (info.publishedDate || "").match(/\d{4}/)?.[0] || "",
      edition: "",
      contributors: extractContributorCreditsFromText([info.subtitle || "", info.description || ""]),
      subjects: Array.isArray(info.categories) ? info.categories.join("; ") : "",
      isbn: extractGoogleIsbn(info.industryIdentifiers || []),
      coverUrl: (() => {
        const il = info.imageLinks || {};
        return (il.thumbnail || il.smallThumbnail || "").replace(/^http:\/\//, "https://")
          || (item.id ? `https://books.google.com/books/content?id=${item.id}&printsec=frontcover&img=1&zoom=1&source=gbs_api` : "");
      })(),
      source: "Google Books"
    };
  });
}

function extractGoogleIsbn(identifiers) {
  const isbn13 = identifiers.find((item) => item.type === "ISBN_13");
  if (isbn13 && isbn13.identifier) {
    return isbn13.identifier;
  }
  const isbn10 = identifiers.find((item) => item.type === "ISBN_10");
  return isbn10 && isbn10.identifier ? isbn10.identifier : "";
}

function dedupeManualResults(results) {
  const seen = new Map();
  const out = [];
  for (const item of results) {
    const key = `${(item.title || "").toLowerCase()}|${(item.author || "").toLowerCase()}|${(item.year || "").toLowerCase()}`;
    if (seen.has(key)) {
      // If the kept result has no cover but this duplicate does, use it
      const kept = seen.get(key);
      if (!kept.coverUrl && item.coverUrl) kept.coverUrl = item.coverUrl;
    } else {
      const copy = { ...item };
      seen.set(key, copy);
      out.push(copy);
    }
  }
  return out;
}

function scoreManualResult(result, searchInput) {
  let score = 0;
  let weight = 0;
  const titleScore = compareWordOverlap(searchInput.title, result.title);
  const authorScore = compareWordOverlap(searchInput.author, result.author);
  const publisherScore = compareWordOverlap(searchInput.publisher, result.publisher);
  const yearScore = compareYearCloseness(searchInput.year, result.year);
  const contributorScore = compareListOverlap(searchInput.contributor ? [searchInput.contributor] : [], result.contributors);
  const editionScore = compareWordOverlap(searchInput.edition, result.edition);

  if (searchInput.title) {
    score += titleScore * 0.22;
    weight += 0.22;
  }
  if (searchInput.author) {
    score += authorScore * 0.12;
    weight += 0.12;
  }
  if (searchInput.publisher) {
    score += Math.max(0, publisherScore) * 0.05;
    weight += 0.05;
  }
  if (searchInput.year) {
    score += Math.max(0, yearScore) * 0.04;
    weight += 0.04;
  }
  if (searchInput.contributor) {
    score += Math.max(0, contributorScore) * 0.04;
    weight += 0.04;
  }
  if (searchInput.edition) {
    score += Math.max(0, editionScore) * 0.03;
    weight += 0.03;
  }

  let normalized = weight > 0 ? score / weight : 0;
  if (searchInput.publisher && publisherScore >= 0 && publisherScore < 0.2) normalized -= 0.05;
  if (searchInput.year && yearScore >= 0 && yearScore < 0.25) normalized -= 0.04;
  return Math.max(0, Math.min(1, normalized));
}

function rankAndSortManualResults(results, searchInput) {
  return (Array.isArray(results) ? results : [])
    .map((result) => ({ ...result, confidence: scoreManualResult(result, searchInput) }))
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
}

async function searchProgrammableCoverImages(title, author) {
  if (!_programmableSearchCx) return [];
  const query = [title, author, "book cover"].filter(Boolean).join(" ");
  if (!query) return [];
  const data = await fetchProgrammableSearchJson(
    `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&searchType=image&safe=active&num=10`
  );
  const items = Array.isArray(data && data.items) ? data.items : [];
  return items.map((item, index) => ({
    key: `cse-${index}-${item.link || Math.random().toString(36).slice(2)}`,
    title: title || item.title || "",
    author: author || "",
    publisher: "",
    year: "",
    edition: "",
    subjects: "",
    isbn: "",
    coverUrl: item.link || "",
    source: "Google Image Search",
    sourcePageUrl: (item.image && item.image.contextLink) || "",
    shouldIngest: true
  })).filter((item) => item.coverUrl);
}

function renderManualSearchResults(results, broad = false) {
  const container = document.getElementById("manualSearchResults");
  manualSearchResults = results;
  manualSelectedResult = null;

  if (!results.length) {
    container.style.display = "none";
    container.innerHTML = "";
    return;
  }

  container.style.display = "";
  container.innerHTML = results.map((result, index) => {
    const metaParts = isSpecificEditionModeEnabled()
      ? [result.author, result.year, result.publisher, result.source]
      : [result.author, result.year, result.source];
    const meta  = metaParts.filter(Boolean).map((item) => esc(item)).join(" | ");
    const thumb = result.coverUrl ? `<img src="${escapeAttribute(result.coverUrl)}" alt="" onclick="event.stopPropagation();showCoverLightbox('${escapeAttribute(result.coverUrl)}')" style="cursor:zoom-in;" title="Click to enlarge">` : "ðŸ“–";
    return `
    <button class="search-result-item" type="button" onclick="selectManualSearchResult(${index})" style="display:flex;gap:8px;align-items:center;">
      <div class="bulk-book-thumb" style="flex-shrink:0;">${thumb}</div>
      <div style="min-width:0;flex:1;text-align:left;">
        <div class="search-result-title">${esc(result.title || "Untitled")}</div>
        <div class="search-result-meta">${meta}</div>
      </div>
    </button>`;
  }).join("");
  if (!broad) {
    container.innerHTML += `<div style="padding:5px 12px 4px;text-align:right;border-top:1px dashed var(--tan);">
      <button class="btn btn-light btn-sm" type="button" onclick="searchManualBook(true)" style="font-size:0.75rem;">None of these? Try broader search â†’</button>
    </div>`;
  }
}

function selectManualSearchResult(index) {
  const result = manualSearchResults[index];
  if (!result) {
    return;
  }

  manualSelectedResult = result;
  const specificEdition = isSpecificEditionModeEnabled();
  const isPhotoNonIsbnFlow = Boolean(
    specificEdition &&
    pendingEditionLookupContext
    && pendingEditionLookupContext.mode === "photo-non-isbn"
    && !pendingEditionLookupContext.exactIsbnAuthority
  );
  if (isPhotoNonIsbnFlow) {
    const fillIfBlank = function(id, value) {
      const el = document.getElementById(id);
      const next = String(value || "").trim();
      if (!el || !next || String(el.value || "").trim()) return;
      el.value = next;
    };
    pendingEditionLookupContext.candidate = {
      title: result.title || "",
      author: result.author || "",
      publisher: result.publisher || "",
      year: result.year || "",
      edition: result.edition || "",
      contributor: Array.isArray(result.contributors) ? (result.contributors[0] || "") : "",
      source: result.source || ""
    };
    fillIfBlank("manTitle", result.title);
    fillIfBlank("manAuthor", result.author);
    fillIfBlank("manPublisher", result.publisher);
    fillIfBlank("manYear", result.year);
    fillIfBlank("manEdition", result.edition);
    fillIfBlank("manContributor", Array.isArray(result.contributors) ? (result.contributors[0] || "") : "");
    fillIfBlank("manSubjects", result.subjects);
    if (pendingEditionLookupContext.book) {
      pendingEditionLookupContext.book = {
        ...pendingEditionLookupContext.book,
        title: document.getElementById("manTitle").value.trim(),
        author: document.getElementById("manAuthor").value.trim(),
        publisher: document.getElementById("manPublisher").value.trim(),
        year: document.getElementById("manYear").value.trim(),
        edition: document.getElementById("manEdition").value.trim(),
        contributor: document.getElementById("manContributor").value.trim(),
        illustrationNote: pendingEditionLookupContext.book.illustrationNote || ""
      };
    }
    updateAuthorSortField(document.getElementById("manAuthor").value || result.author || "", true);
    refreshSelectedPhotoObjectUrl();
    _selectedCoverSource = result.coverUrl ? "database" : "photo";
    renderManualCoverPreview(result.coverUrl || "");
    updateFillEditionButton();
    setStatus("manualSearchStatus", `Selected match from ${result.source}. Missing edition fields were filled from this result, while image and Perplexity evidence stays primary unless an exact ISBN is confirmed.`, "success");
    return;
  }
  const isPhotoWorkFlow = Boolean(
    !specificEdition
    && pendingEditionLookupContext
    && pendingEditionLookupContext.mode === "photo-work"
  );
  if (isPhotoWorkFlow) {
    pendingEditionLookupContext.candidate = {
      title: result.title || "",
      author: result.author || "",
      publisher: "",
      year: result.year || "",
      edition: "",
      contributor: "",
      source: result.source || ""
    };
    const baseBook = pendingEditionLookupContext.book || {};
    document.getElementById("manTitle").value = baseBook.title || document.getElementById("manTitle").value || "";
    document.getElementById("manAuthor").value = baseBook.author || document.getElementById("manAuthor").value || "";
    document.getElementById("manPublisher").value = "";
    document.getElementById("manYear").value = baseBook.year || document.getElementById("manYear").value || "";
    document.getElementById("manEdition").value = "";
    document.getElementById("manContributor").value = "";
    document.getElementById("manSubjects").value = "";
    updateAuthorSortField(baseBook.author || document.getElementById("manAuthor").value || "", true);
    refreshSelectedPhotoObjectUrl();
    _selectedCoverSource = result.coverUrl ? "database" : "photo";
    renderManualCoverPreview(result.coverUrl || "");
    updateFillEditionButton();
    setStatus("manualSearchStatus", `Selected cover/match from ${result.source}. Saved metadata will stay from the image.`, "success");
    return;
  } else if (!specificEdition) {
    pendingEditionLookupContext = null;
  } else {
  pendingEditionLookupContext = {
    book: {
      title: result.title || "",
      author: result.author || "",
      publisher: result.publisher || "",
      year: result.year || "",
      edition: result.edition || "",
      contributor: Array.isArray(result.contributors) ? (result.contributors[0] || "") : "",
      illustrationNote: ""
    },
    extracted: null,
    candidate: {
      title: result.title || "",
      author: result.author || "",
      publisher: result.publisher || "",
      year: result.year || "",
      edition: result.edition || "",
      contributor: Array.isArray(result.contributors) ? (result.contributors[0] || "") : "",
      source: result.source || ""
    },
    enrichment: {}
  };
  }
  document.getElementById("manTitle").value = result.title || "";
  document.getElementById("manAuthor").value = result.author || "";
  document.getElementById("manPublisher").value = specificEdition ? (result.publisher || "") : "";
  document.getElementById("manYear").value = result.year || "";
  document.getElementById("manEdition").value = specificEdition ? (result.edition || "") : "";
  document.getElementById("manContributor").value = specificEdition ? (Array.isArray(result.contributors) ? (result.contributors[0] || "") : "") : "";
  document.getElementById("manSubjects").value = specificEdition ? (result.subjects || "") : "";
  updateAuthorSortField(result.author || "", true);
  refreshSelectedPhotoObjectUrl();
  renderManualCoverPreview(result.coverUrl || "");
  updateFillEditionButton();
  setStatus("manualSearchStatus", specificEdition
    ? `Filled details from ${result.source}. You can still edit anything before saving.`
    : `Filled title, author, and year from ${result.source}. You can still edit anything before saving.`, "success");
}

function clearManualSearch(resetStatus = true) {
  manualSearchResults = [];
  manualSelectedResult = null;
  pendingEditionLookupContext = null;
  renderManualSearchResults([]);
  ["manTitle", "manAuthor", "manPublisher", "manYear", "manEdition", "manContributor", "manSubjects"].forEach((id) => {
    const element = document.getElementById(id);
    if (element) element.value = "";
  });
  updateAuthorSortField("", true);
  document.getElementById("coverPreview").innerHTML = "";
  const manualCover = document.getElementById("manualCoverPreview");
  if (manualCover) manualCover.innerHTML = "";
  updateFillEditionButton();
  if (resetStatus) {
    setStatus("manualSearchStatus", defaultManualSearchStatus(), "");
  }
}

function updateFillEditionButton() {
  const btn = document.getElementById("fillEditionBtn");
  if (!btn) return;
  if (!isSpecificEditionModeEnabled()) {
    btn.style.display = "none";
    btn.disabled = true;
    btn.textContent = "Fill Edition Details";
    return;
  }
  const context = pendingEditionLookupContext && typeof pendingEditionLookupContext === "object"
    ? pendingEditionLookupContext
    : null;
  const title = document.getElementById("manTitle") ? document.getElementById("manTitle").value.trim() : "";
  const author = document.getElementById("manAuthor") ? document.getElementById("manAuthor").value.trim() : "";
  const isbnAuthoritative = Boolean(context && context.exactIsbnAuthority);
  const hasPhotoAutoEnrichment = Boolean(
    context
    && context.mode === "photo-non-isbn"
    && context.enrichment
    && ["title", "author", "publisher", "year", "edition", "contributor", "illustration_note", "confidence_note"]
      .some((key) => String(context.enrichment[key] || "").trim())
  );
  btn.style.display = hasPhotoAutoEnrichment ? "none" : "";
  btn.disabled = editionLookupInFlight || isbnAuthoritative || (!title && !author && !(pendingBook && pendingBook.title));
  btn.textContent = editionLookupInFlight
    ? "Looking Up Edition..."
    : (isbnAuthoritative ? "ISBN Metadata In Use" : "Fill Edition Details");
}

function applyEditionMetadataToForm(metadata) {
  if (!metadata || typeof metadata !== "object") return 0;
  let applied = 0;
  const fillIfBlank = function(id, value) {
    const el = document.getElementById(id);
    const next = String(value || "").trim();
    if (!el || !next || String(el.value || "").trim()) return;
    el.value = next;
    applied += 1;
  };
  fillIfBlank("manTitle", metadata.title);
  fillIfBlank("manAuthor", metadata.author);
  fillIfBlank("manPublisher", metadata.publisher);
  fillIfBlank("manYear", metadata.year);
  fillIfBlank("manEdition", metadata.edition);
  fillIfBlank("manContributor", metadata.contributor);
  return applied;
}

function mergeEditionMetadataIntoPendingBook(metadata) {
  if (!pendingBook || !metadata || typeof metadata !== "object") return;
  if (!pendingBook.title && metadata.title) pendingBook.title = metadata.title;
  if (!pendingBook.author && metadata.author) pendingBook.author = metadata.author;
  if (!pendingBook.publisher && metadata.publisher) pendingBook.publisher = metadata.publisher;
  if (!pendingBook.year && metadata.year) pendingBook.year = metadata.year;
  if (!pendingBook.edition && metadata.edition) pendingBook.edition = metadata.edition;
  if (!pendingBook.contributor && metadata.contributor) pendingBook.contributor = metadata.contributor;
  if (!pendingBook.illustrationNote && metadata.illustration_note) pendingBook.illustrationNote = metadata.illustration_note;
}

async function fillEditionDetails() {
  if (editionLookupInFlight) return;
  if (!isSpecificEditionModeEnabled()) {
    setStatus("addStatus", "Specific Edition is off, so edition lookup is not needed.", "success");
    updateFillEditionButton();
    return;
  }
  if (pendingEditionLookupContext && pendingEditionLookupContext.exactIsbnAuthority) {
    setStatus("addStatus", "A valid ISBN was read from the image, so catalog metadata is already authoritative for this book.", "success");
    updateFillEditionButton();
    return;
  }
  const baseBook = {
    title: (pendingBook && pendingBook.title) || document.getElementById("manTitle").value.trim(),
    author: (pendingBook && pendingBook.author) || document.getElementById("manAuthor").value.trim(),
    publisher: (pendingBook && pendingBook.publisher) || document.getElementById("manPublisher").value.trim(),
    year: (pendingBook && pendingBook.year) || document.getElementById("manYear").value.trim(),
    edition: (pendingBook && pendingBook.edition) || document.getElementById("manEdition").value.trim(),
    contributor: (pendingBook && pendingBook.contributor) || document.getElementById("manContributor").value.trim(),
    illustrationNote: (pendingBook && pendingBook.illustrationNote) || ""
  };
  if (!baseBook.title) {
    setStatus("addStatus", "Title is required before filling edition details.", "error");
    return;
  }

  editionLookupInFlight = true;
  updateFillEditionButton();
  setStatus("addStatus", `Looking up edition details for "${baseBook.title}"...`, "");

  try {
    const fn = functions.httpsCallable("resolveEditionMetadata");
    const result = await fn({
      book: baseBook,
      extracted: pendingEditionLookupContext && pendingEditionLookupContext.extracted ? pendingEditionLookupContext.extracted : null,
      candidate: pendingEditionLookupContext && pendingEditionLookupContext.candidate ? pendingEditionLookupContext.candidate : null
    });
    const metadata = result.data && result.data.metadata ? result.data.metadata : {};
    const applied = applyEditionMetadataToForm(metadata);
    mergeEditionMetadataIntoPendingBook(metadata);
    if (pendingEditionLookupContext) {
      pendingEditionLookupContext.book = { ...(pendingEditionLookupContext.book || {}), ...baseBook };
      pendingEditionLookupContext.enrichment = metadata;
    } else {
      pendingEditionLookupContext = { book: baseBook, extracted: null, candidate: null, enrichment: metadata };
    }
    if (applied > 0 || metadata.illustration_note) {
      setStatus("addStatus", metadata.confidence_note
        ? `Edition details filled. ${metadata.confidence_note}`
        : "Edition details filled from web-grounded search.", "success");
    } else {
      setStatus("addStatus", metadata.confidence_note || "No additional edition details were found.", "success");
    }
  } catch (error) {
    setStatus("addStatus", getCallableErrorMessage(error, "Edition lookup failed."), "error");
  } finally {
    editionLookupInFlight = false;
    updateFillEditionButton();
  }
}

function metadataRefreshConflictFields(existingBook, nextBook) {
  const labels = {
    title: "Title",
    author: "Author",
    year: "Year",
    publisher: "Publisher",
    edition: "Edition",
    contributor: "Contributor",
    illustrationNote: "Illustration Note",
    subjects: "Subjects",
    isbn: "ISBN"
  };
  return Object.keys(labels).map((field) => {
    const existingValue = String(existingBook && existingBook[field] || "").trim();
    const nextValue = String(nextBook && nextBook[field] || "").trim();
    if (!existingValue || !nextValue || normalizeCompareText(existingValue) === normalizeCompareText(nextValue)) return null;
    return { field, label: labels[field], existingValue, nextValue };
  }).filter(Boolean);
}

function applyMetadataRefreshMerge(existingBook, nextBook) {
  const merged = { ...existingBook, ...nextBook };
  ["title", "author", "year", "publisher", "edition", "contributor", "illustrationNote", "subjects", "isbn"].forEach((field) => {
    const existingValue = String(existingBook && existingBook[field] || "").trim();
    const nextValue = String(nextBook && nextBook[field] || "").trim();
    if (existingValue && !nextValue) merged[field] = existingValue;
  });
  return merged;
}

function confirmMetadataRefreshConflicts(existingBook, nextBook) {
  const conflicts = metadataRefreshConflictFields(existingBook, nextBook);
  if (!conflicts.length) return true;
  const summary = conflicts.map((item) => `${item.label}: "${item.existingValue}" -> "${item.nextValue}"`).join("\n");
  return confirm(
    "This refresh will replace existing metadata fields.\n\n" +
    summary +
    "\n\nChoose OK to apply these metadata changes, or Cancel to keep reviewing."
  );
}

async function saveRefreshLookupPhotosAsAdditional(bookId, files, sources, coverIndex, photoCoverSelected) {
  const entries = Array.isArray(files) ? files : [];
  const sourceEntries = Array.isArray(sources) ? sources : [];
  const existing = getBookPhotos(bookId);
  const uploads = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const source = sourceEntries[index] || { kind: isStoredPhotoItem(entry) ? "stored" : "new" };
    if (source.kind !== "new") continue;
    if (photoCoverSelected && index === coverIndex) continue;
    try {
      const compressed = await compressImageForCover(entry, 1400);
      const photoId = Math.random().toString(36).slice(2, 10);
      const uploaded = await uploadBookPhotoToStorage(bookId, photoId, compressed);
      uploads.push({
        id: photoId,
        url: uploaded.url,
        storagePath: uploaded.storagePath,
        caption: "",
        type: "other",
        createdAt: new Date().toISOString(),
        sortOrder: existing.length + uploads.length
      });
    } catch (error) {
      console.warn("[saveRefreshLookupPhotosAsAdditional] skipped new refresh photo:", error);
    }
  }

  if (uploads.length) {
    await saveBookPhotos(bookId, existing.concat(uploads));
  }
}

async function saveReplacedRefreshCoverAsAdditional(bookId, entries, coverIndex, photoCoverSelected, existingCoverUrl, finalCoverUrl) {
  const previousCoverUrl = String(existingCoverUrl || "").trim();
  const nextCoverUrl = String(finalCoverUrl || "").trim();
  if (!previousCoverUrl || !nextCoverUrl || previousCoverUrl === nextCoverUrl) return;

  const list = Array.isArray(entries) ? entries : [];
  const selectedCoverEntry = list[Math.max(0, Math.min(coverIndex, list.length - 1))] || null;
  const replacingWithNewLocalPhoto = Boolean(
    photoCoverSelected
    && selectedCoverEntry
    && !isStoredPhotoItem(selectedCoverEntry.item)
  );
  const previousCoverEntry = list.find(function(entry) {
    const source = entry && entry.source ? entry.source : {};
    const sourceKind = String(source.sourceKind || "").trim();
    const sourceUrl = String(source.url || (isStoredPhotoItem(entry && entry.item) ? entry.item.url : "") || "").trim();
    if (source.kind !== "stored") return false;
    if (!sourceUrl || sourceUrl !== previousCoverUrl) return false;
    if (sourceKind === "stored-photo") return false;
    if (sourceKind === "external-cover" && !replacingWithNewLocalPhoto) return false;
    return true;
  });
  if (!previousCoverEntry) return;

  const currentPhotos = getBookPhotos(bookId);
  if (currentPhotos.some(function(photo) {
    return String(photo.url || "").trim() === previousCoverUrl;
  })) {
    return;
  }

  try {
    const response = await fetch(previousCoverUrl);
    if (!response.ok) {
      throw new Error(`Could not reuse previous cover (${response.status}).`);
    }
    const compressed = await compressImageForCover(await response.blob(), 1400);
    const photoId = Math.random().toString(36).slice(2, 10);
    const uploaded = await uploadBookPhotoToStorage(bookId, photoId, compressed);
    await saveBookPhotos(bookId, currentPhotos.concat({
      id: photoId,
      url: uploaded.url,
      storagePath: uploaded.storagePath,
      caption: "Previous cover",
      type: "other",
      createdAt: new Date().toISOString(),
      sortOrder: currentPhotos.length
    }));
  } catch (error) {
    console.warn("[saveReplacedRefreshCoverAsAdditional] skipped previous cover:", error);
  }
}

async function addBook() {
  const editingBook = editingBookId ? findBook(editingBookId) : null;
  const metadataRefreshMode = isMetadataRefreshMode();
  const condition = document.getElementById("bookCondition").value;
  const shelf = document.getElementById("bookShelf").value.trim();
  const notes = document.getElementById("bookNotes").value.trim();
  const readingStatus = document.getElementById("bookReadingStatus").value;
  const startDate = document.getElementById("bookStartDate").value;
  const finishDate = document.getElementById("bookFinishDate").value;
  const personalNotes = document.getElementById("bookPersonalNotes").value.trim();
  const rating = _formRating;
  const isEditing = Boolean(editingBook);
  const specificEdition = isSpecificEditionModeEnabled();
  const selectedManualResult = manualSelectedResult;
  const photoLookupContext = pendingEditionLookupContext;
  const photoLookupHasIsbn = Boolean(photoLookupContext && photoLookupContext.extractedHasIsbn);
  const photoLookupExactIsbnAuthority = Boolean(photoLookupContext && photoLookupContext.exactIsbnAuthority);
  const photoCoverSelected = _selectedCoverSource === "photo";
  const selectedCoverItem = photoFiles.length
    ? (photoFiles[Math.max(0, Math.min(_selectedPhotoCoverIndex, photoFiles.length - 1))] || null)
    : null;
  const selectedNewCoverFile = getSelectedPhotoFile();
  const selectedStoredCoverUrl = selectedCoverItem && isStoredPhotoItem(selectedCoverItem)
    ? String(selectedCoverItem.url || "").trim()
    : "";
  const selectedLookupFiles = photoFiles.filter((item) => !isStoredPhotoItem(item));
  const selectedLookupEntries = photoFiles.map(function(item, index) {
    return {
      item,
      source: photoFileSourceMeta[index] || { kind: isStoredPhotoItem(item) ? "stored" : "new" }
    };
  });
  const selectedLookupCoverIndex = _selectedPhotoCoverIndex;
  let savedAsQuickAddFallback = false;
  const originalTitle = editingBook ? String(editingBook.title || "").trim() : "";
  const originalAuthor = editingBook ? String(editingBook.author || "").trim() : "";
  const existingCoverUrl = editingBook ? String(editingBook.coverUrl || "").trim() : "";

  if ((!isEditing || metadataRefreshMode) && photoCoverSelected && (!metadataRefreshMode || _coverSourceTouched) && pendingCoverBlobPromise) {
    try {
      pendingCoverBlob = await pendingCoverBlobPromise;
    } catch (error) {
      console.warn("Waiting for selected cover photo failed:", error);
      pendingCoverBlob = null;
    } finally {
      pendingCoverBlobPromise = null;
    }
  }

  let book;
  if (isEditing && !metadataRefreshMode) {
    // Edit mode: bibliographic fields are locked â€” preserve everything from the saved book
    book = { ...editingBook };
    book.subjects = document.getElementById("bookSubjectTags").value.trim();
    book.authorSort = document.getElementById("bookAuthorSort").value.trim();
  } else if (currentTab === "isbn") {
    if (!pendingBook) {
      return setStatus("addStatus", "Look up an ISBN first.", "error");
    }
    book = { ...pendingBook };
    if (specificEdition && !photoLookupExactIsbnAuthority && photoLookupContext && photoLookupContext.enrichment && photoLookupContext.enrichment.illustration_note) {
      book.illustrationNote = book.illustrationNote || String(photoLookupContext.enrichment.illustration_note || "").trim();
    }
    if (specificEdition && !photoLookupExactIsbnAuthority && photoLookupContext && photoLookupContext.enrichment && photoLookupContext.enrichment.confidence_note) {
      book.source = "Photo Lookup + Perplexity";
    }
    if (!specificEdition) {
      const extracted = photoLookupContext && photoLookupContext.extracted ? photoLookupContext.extracted : null;
      const candidateForCover = photoLookupContext && photoLookupContext.candidate ? {
        title: photoLookupContext.candidate.title || "",
        authors: photoLookupContext.candidate.author ? [photoLookupContext.candidate.author] : [],
        publishedDate: photoLookupContext.candidate.year || "",
        coverUrl: book.coverUrl || "",
        source: photoLookupContext.candidate.source || ""
      } : null;
      if (!photoLookupContext) {
        book = buildQuickAddBook(book, { keepEditionMetadata: true, year: book.year });
      } else {
        book = photoLookupExactIsbnAuthority
          ? buildQuickAddBook(book, { keepEditionMetadata: true, year: book.year })
          : (extracted
            ? buildWorkLevelPhotoBook(candidateForCover, extracted, false)
            : buildQuickAddBook(book, { keepEditionMetadata: false, year: getQuickAddOriginalYear(candidateForCover) }));
      }
      if (_selectedCoverSource === "photo" && pendingCoverBlob) {
        book.coverUrl = "";
      } else if (_selectedCoverSource !== "photo" && pendingBook && pendingBook.coverUrl) {
        book.coverUrl = pendingBook.coverUrl;
      }
    }
    book.authorSort = document.getElementById("bookAuthorSort").value.trim();
  } else {
    const title = document.getElementById("manTitle").value.trim();
    if (!title) {
      return setStatus("addStatus", "Title is required.", "error");
    }
    const apiCoverForPhotoFlow = photoLookupContext && !photoLookupExactIsbnAuthority && selectedManualResult && !photoCoverSelected
      ? (selectedManualResult.coverUrl || "")
      : "";
    if (specificEdition) {
      book = {
        title,
        author: document.getElementById("manAuthor").value.trim(),
        authorSort: document.getElementById("bookAuthorSort").value.trim(),
        publisher: document.getElementById("manPublisher").value.trim(),
        year: document.getElementById("manYear").value.trim(),
        edition: document.getElementById("manEdition").value.trim(),
        contributor: document.getElementById("manContributor").value.trim(),
        illustrationNote: photoLookupContext && photoLookupContext.enrichment
          ? String(photoLookupContext.enrichment.illustration_note || "").trim()
          : "",
        subjects: document.getElementById("manSubjects").value.trim(),
        isbn: (selectedManualResult && !photoLookupContext) ? selectedManualResult.isbn || "" : "",
        source: photoLookupContext
          ? (photoLookupExactIsbnAuthority ? "Photo Lookup (ISBN)" : (photoLookupContext.enrichment && photoLookupContext.enrichment.confidence_note ? "Photo Lookup + Perplexity" : "Photo Lookup"))
          : (selectedManualResult ? selectedManualResult.source || "Manual" : "Manual"),
        coverUrl: photoCoverSelected ? "" : (apiCoverForPhotoFlow || ((selectedManualResult && !photoLookupContext) ? selectedManualResult.coverUrl || "" : ""))
      };
    } else {
      book = {
        title,
        author: document.getElementById("manAuthor").value.trim(),
        authorSort: document.getElementById("bookAuthorSort").value.trim(),
        publisher: "",
        year: document.getElementById("manYear").value.trim(),
        edition: "",
        contributor: "",
        illustrationNote: "",
        subjects: "",
        isbn: "",
        source: photoLookupContext ? "Photo Lookup" : (selectedManualResult ? selectedManualResult.source || "Manual" : "Manual"),
        coverUrl: photoCoverSelected ? "" : (apiCoverForPhotoFlow || ((selectedManualResult && !photoLookupContext) ? selectedManualResult.coverUrl || "" : ""))
      };
    }
  }

  if ((!isEditing || metadataRefreshMode) && specificEdition && !hasStrongEditionSaveEvidence(book, photoLookupContext, selectedManualResult)) {
    const saveAsQuickAdd = confirm(
      "This exact edition is not confirmed yet.\n\nChoose OK to save this as Quick Add.\nChoose Cancel to continue reviewing edition details."
    );
    if (!saveAsQuickAdd) {
      setStatus("addStatus", "Continue reviewing edition details before saving this as Specific Edition.", "");
      return;
    }
    const fallbackMatch = photoLookupContext && photoLookupContext.candidate ? {
      source: photoLookupContext.candidate.source || "",
      publishedDate: photoLookupContext.candidate.year || "",
      year: photoLookupContext.candidate.year || ""
    } : selectedManualResult;
    book = buildQuickAddBook(book, {
      keepEditionMetadata: photoLookupExactIsbnAuthority && currentTab === "isbn",
      year: photoLookupContext && !photoLookupExactIsbnAuthority
        ? getQuickAddOriginalYear(fallbackMatch)
        : String(book.year || "").trim()
    });
    savedAsQuickAddFallback = true;
  }

  const duplicate = findDuplicateBookForSave(book, specificEdition && !savedAsQuickAddFallback);

  if (duplicate && !_allowDuplicateOverride) {
    const el = document.getElementById("addStatus");
    el.className = "lookup-status warning";
    el.innerHTML = `"${esc(duplicate.title)}" is already in your catalog${specificEdition && !savedAsQuickAddFallback ? " as this edition" : ""}. <button type="button" class="btn btn-light" style="padding:2px 10px;font-size:0.8rem;" onclick="allowDuplicateAdd()">Add Anyway</button>`;
    return;
  }
  _allowDuplicateOverride = false;

  if (metadataRefreshMode && editingBook) {
    book = applyMetadataRefreshMerge(editingBook, book);
    if (!confirmMetadataRefreshConflicts(editingBook, book)) {
      setStatus("addStatus", "Metadata refresh was not saved.", "");
      return;
    }
  }

  book.condition = condition;
  book.shelf = shelf;
  book.notes = notes;
  book.readingStatus = normalizeReadingStatus(readingStatus);
  book.startDate = normalizeDateInput(startDate);
  book.finishDate = normalizeDateInput(finishDate);
  book.personalNotes = personalNotes;
  book.rating = rating >= 1 && rating <= 5 ? rating : 0;
  const nextShelfId = document.getElementById("bookListShelfId").value || currentShelfId;
  const previousShelfId = editingBook ? (editingBook.listShelfId || "default") : null;
  book.listShelfId = nextShelfId;
  book.addedAt = editingBook ? editingBook.addedAt : Date.now();
  book.id = editingBook ? editingBook.id : Math.random().toString(36).slice(2);
  if (!editingBook) {
    book.customOrder = getNextCustomOrderForShelf(nextShelfId);
  } else if (previousShelfId !== nextShelfId) {
    book.customOrder = getNextCustomOrderForShelf(nextShelfId);
  }
  const willReplaceExistingCover = Boolean(
    metadataRefreshMode
    && _coverSourceTouched
    && photoCoverSelected
    && existingCoverUrl
    && (
      (selectedStoredCoverUrl && selectedStoredCoverUrl !== existingCoverUrl)
      || (!selectedStoredCoverUrl && selectedCoverItem)
    )
  );
  if (willReplaceExistingCover && isUserOwnedCoverUrl(existingCoverUrl)) {
    try {
      const existingPhotos = getBookPhotos(book.id);
      const alreadySaved = existingPhotos.some(function(photo) {
        return String(photo.caption || "").trim() === "Previous cover";
      });
      if (!alreadySaved) {
        const copyFn = functions.httpsCallable("copyCurrentCoverToBookPhoto");
        const result = await copyFn({
          bookId: book.id,
          caption: "Previous cover"
        });
        if (result && result.data && Array.isArray(result.data.photos)) {
          bookPhotoCache[book.id] = sanitizeBookPhotoList(result.data.photos);
        }
      }
    } catch (error) {
      console.warn("Saving replaced metadata refresh cover failed:", error);
    }
  }
  if (metadataRefreshMode) {
    if (!_coverSourceTouched) {
      book.coverUrl = existingCoverUrl;
      pendingCoverBlob = null;
      pendingCoverBlobPromise = null;
    } else if (photoCoverSelected) {
      if (selectedStoredCoverUrl) {
        book.coverUrl = selectedStoredCoverUrl;
        pendingCoverBlob = null;
        pendingCoverBlobPromise = null;
      } else if (selectedNewCoverFile) {
        try {
          let coverBlob = pendingCoverBlob;
          if (!coverBlob) {
            coverBlob = await compressImageForCover(selectedNewCoverFile);
          }
          pendingCoverBlob = null;
          pendingCoverBlobPromise = null;
          book.coverUrl = coverBlob ? await uploadCoverToStorage(book.id, coverBlob) : existingCoverUrl;
        } catch (error) {
          console.warn("[addBook] refresh cover upload failed:", error);
          book.coverUrl = existingCoverUrl;
        }
      }
    }
  }
  book = normalizeBook(book);

  if (editingBookId) {
    const index = books.findIndex((entry) => entry.id === editingBookId);
    if (index >= 0) {
      books[index] = book;
    }
  } else {
    books.unshift(book);
  }

  await saveBooks();

  // If a photo was used for identification and no cover was found, upload the compressed photo
  if (pendingCoverBlob && !book.coverUrl && !editingBook) {
    const blobToUpload = pendingCoverBlob;
    pendingCoverBlob = null;
    try {
      const url = await uploadCoverToStorage(book.id, blobToUpload);
      const idx = books.findIndex((b) => b.id === book.id);
      if (idx >= 0) { books[idx].coverUrl = url; }
      await saveBooks();
    } catch (e) {
      console.warn("Cover photo upload failed:", e);
    }
  } else {
    pendingCoverBlob = null;
  }

  if (!editingBook && selectedLookupFiles.length > 1) {
    try {
      await saveSelectedLookupPhotosAsAdditional(
        book.id,
        selectedLookupFiles,
        selectedLookupCoverIndex,
        photoCoverSelected
      );
    } catch (error) {
      console.warn("Saving additional lookup photos failed:", error);
    }
  } else if (metadataRefreshMode && selectedLookupEntries.length > 0) {
    try {
      await saveRefreshLookupPhotosAsAdditional(
        book.id,
        selectedLookupEntries.map(function(entry) { return entry.item; }),
        selectedLookupEntries.map(function(entry) { return entry.source; }),
        selectedLookupCoverIndex,
        photoCoverSelected
      );
    } catch (error) {
      console.warn("Saving metadata refresh lookup photos failed:", error);
    }
  }

  if (editingBook && metadataRefreshMode && (String(book.title || "").trim() !== originalTitle || String(book.author || "").trim() !== originalAuthor)) {
    const idx = books.findIndex((entry) => entry.id === book.id);
    if (idx >= 0) books[idx].briefingNeedsRegeneration = true;
    book.briefingNeedsRegeneration = true;
    await saveBooks();
  }

  stopEditing();
  clearForm();
  pendingEditionLookupContext = null;
  renderCatalog();
  if (selectedBookId === book.id) {
    renderBriefingPanel();
    updateResearchButtons();
  }
  const saveMessage = isEditing
    ? `Updated "${book.title}".`
    : (savedAsQuickAddFallback ? `Added "${book.title}" to the catalog as Quick Add.` : `Added "${book.title}" to the catalog.`);
  setStatus("addStatus", saveMessage, "success");
  if (!isEditing) showToast(savedAsQuickAddFallback ? `Added "${book.title}" as Quick Add` : `Added "${book.title}"`);
  setTimeout(() => setStatus("addStatus", "", ""), 3000);
  setMobileSection("catalog");
}

function allowDuplicateAdd() {
  _allowDuplicateOverride = true;
  addBook();
}

function clearForm() {
  _allowDuplicateOverride = false;
  _authorSortTouched = false;
  stopEditing();
  ["isbnInput", "manTitle", "manAuthor", "manPublisher", "manYear", "manEdition", "manContributor", "manSubjects", "bookAuthorSort", "bookSubjectTags", "bookShelf", "bookNotes", "bookPersonalNotes", "bookStartDate", "bookFinishDate"].forEach((id) => {
    const element = document.getElementById(id);
    if (element) {
      element.value = "";
      if (id === "bookAuthorSort") element.dataset.auto = "1";
    }
  });
  document.getElementById("bookCondition").value = "";
  document.getElementById("bookReadingStatus").value = "";
  const shelfSel = document.getElementById("bookListShelfId");
  if (shelfSel) shelfSel.value = currentShelfId;
  setFormRating(0);
  document.getElementById("coverPreview").innerHTML = "";
  pendingBook = null;
  pendingCoverBlob = null;
  pendingCoverBlobPromise = null;
  _coverSourceTouched = false;
  pendingEditionLookupContext = null;
  setStatus("lookupStatus", "Enter an ISBN and click Look up, or use Scan.", "");
  // Clear photo lookup / review state
  photoFiles = [];
  photoFileSourceMeta = [];
  reviewData = null;
  document.getElementById("photoPreviewRow").innerHTML = "";
  document.getElementById("reviewSection").style.display = "none";
  setStatus("photoStatus", "", "");
  // Hide metadata section unless user is actively on manual tab
  document.getElementById("bookMetaSection").style.display = currentTab === "manual" ? "" : "none";
  setStatus("manualSearchStatus", defaultManualSearchStatus(), "");
  applyCatalogGranularityMode();
  updateFillEditionButton();
}

function startEditBook(id) {
  const book = findBook(id);
  if (!book) return;

  editingBookId = id;
  metadataRefreshContext = null;

  // Switch to edit mode: hide add tabs, show read-only book header
  document.getElementById("addModeSection").style.display = "none";
  document.getElementById("editModeHeader").style.display = "";
  document.getElementById("bookSubjectTagsGroup").style.display = "";
  document.getElementById("bookMetaSection").style.display = "";

  // Populate read-only header
  const coverThumb = document.getElementById("editBookCoverThumb");
  coverThumb.innerHTML = book.coverUrl
    ? `<img src="${escapeAttribute(book.coverUrl)}" alt="">`
    : "ðŸ“–";
  document.getElementById("editBookTitle").textContent = book.title || "";
  document.getElementById("editBookAuthor").textContent = book.author || "";
  const metaParts = [book.publisher, book.year, book.edition].filter(Boolean);
  document.getElementById("editBookMeta").textContent = metaParts.join(" Â· ");

  // Populate editable fields (in display order)
  setFormRating(book.rating || 0);
  document.getElementById("bookReadingStatus").value = book.readingStatus || "";
  document.getElementById("bookStartDate").value = book.startDate || "";
  document.getElementById("bookFinishDate").value = book.finishDate || "";
  document.getElementById("bookSubjectTags").value = book.subjects || "";
  updateAuthorSortField(book.authorSort || book.author || "", true);
  document.getElementById("bookPersonalNotes").value = book.personalNotes || "";
  document.getElementById("bookCondition").value = book.condition || "";
  document.getElementById("bookShelf").value = book.shelf || "";
  document.getElementById("bookNotes").value = book.notes || "";
  const shelfSel = document.getElementById("bookListShelfId");
  if (shelfSel) shelfSel.value = book.listShelfId || "default";

  const shortTitle = book.title.length > 28 ? book.title.slice(0, 28) + "â€¦" : book.title;
  document.getElementById("editBackBtn").style.display = "";
  document.getElementById("addPanelTitle").textContent = `Editing: ${shortTitle}`;
  document.getElementById("saveBookBtn").textContent = "Save Changes";
  document.getElementById("cancelEditBtn").style.display = "inline-flex";
  renderMetadataRefreshPanel();
  setMobileSection("add");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function openCamera() {
  document.getElementById("cameraModal").classList.add("open");
  document.getElementById("scanStatus").textContent = "Opening camera\u2026 If a barcode will not lock in, use Photo Instead.";

  if ("BarcodeDetector" in window) {
    // Native BarcodeDetector (Chrome, Edge)
    document.getElementById("cameraFeed").style.display = "";
    document.querySelector("#cameraModal .scan-line").style.display = "";
    document.getElementById("html5qrScanRegion").style.display = "none";

    try {
      // Try rear camera first, fall back to any camera
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      } catch {
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
      }
      const video = document.getElementById("cameraFeed");
      video.srcObject = cameraStream;
      const detector = new BarcodeDetector({ formats: ["ean_13", "ean_8"] });
      document.getElementById("scanStatus").textContent = "Scanning for barcode\u2026 If it will not read, use Photo Instead.";
      scanInterval = setInterval(async () => {
        try {
          const barcodes = await detector.detect(video);
          for (const barcode of barcodes) {
            const value = String(barcode.rawValue || "").replace(/[^0-9X]/gi, "");
            if (value.length === 10 || value.length === 13) {
              document.getElementById("scanStatus").textContent = `ISBN found: ${value}`;
              closeCamera();
              document.getElementById("isbnInput").value = value;
              switchTab("isbn");
              await lookupISBN(value);
              return;
            }
          }
        } catch {}
      }, 400);
    } catch (err) {
      console.error("Camera error:", err);
      document.getElementById("scanStatus").textContent =
        err.name === "NotAllowedError" ? "Camera permission denied. In Chrome: tap the lock icon in the address bar â†’ Site settings â†’ Camera â†’ Allow, then reload."
        : err.name === "NotFoundError" ? "No camera found on this device."
        : `Camera error: ${err.message}`;
    }

  } else if (typeof Html5Qrcode !== "undefined") {
    // Fallback: html5-qrcode library (Safari, Firefox, etc.)
    document.getElementById("cameraFeed").style.display = "none";
    document.querySelector("#cameraModal .scan-line").style.display = "none";
    document.getElementById("html5qrScanRegion").style.display = "";

    try {
      html5QrScanner = new Html5Qrcode("html5qrScanRegion");
      document.getElementById("scanStatus").textContent = "Scanning for barcode\u2026 If it will not read, use Photo Instead.";
      let scanHandled = false;
      await html5QrScanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 150 }, aspectRatio: 1.5 },
        (decodedText) => {
          if (scanHandled) return;
          const value = decodedText.replace(/[^0-9X]/gi, "");
          if (value.length === 10 || value.length === 13) {
            scanHandled = true;
            document.getElementById("scanStatus").textContent = `ISBN found: ${value}`;
            // Defer close/lookup so we're not stopping the scanner inside its own callback
            setTimeout(() => {
              closeCamera();
              document.getElementById("isbnInput").value = value;
              switchTab("isbn");
              lookupISBN(value);
            }, 100);
          }
        },
        () => {} // per-frame scan miss â€” ignore
      );
    } catch {
      document.getElementById("scanStatus").textContent = "Camera access failed. Try Photo Instead.";
    }

  } else {
    document.getElementById("scanStatus").textContent = "Barcode scanning not available in this browser. Use Photo Instead.";
  }
}

function cleanPossibleIsbn(value) {
  return String(value || "").replace(/[^0-9X]/gi, "").toUpperCase();
}

function extractIsbnFromPhotoLookupResult(data) {
  const extracted = data && data.extracted ? data.extracted : {};
  const bestMatch = data && data.bestMatch ? data.bestMatch : {};
  const candidates = [
    extracted.isbn_13,
    extracted.isbn_10,
    bestMatch.isbn_13,
    bestMatch.isbn_10
  ];
  for (const candidate of candidates) {
    const cleaned = cleanPossibleIsbn(candidate);
    if (cleaned.length === 10 || cleaned.length === 13) return cleaned;
  }
  return "";
}

function buildPhotoDerivedBookFromExtracted(extracted, enrichment = {}) {
  const safeExtracted = extracted && typeof extracted === "object" ? extracted : {};
  const safeEnrichment = enrichment && typeof enrichment === "object" ? enrichment : {};
  const extractedTitle = ((safeExtracted.title || "") + (safeExtracted.subtitle ? ": " + safeExtracted.subtitle : "")).trim();
  return {
    title: extractedTitle || String(safeEnrichment.title || "").trim(),
    author: (Array.isArray(safeExtracted.authors) ? safeExtracted.authors.join(", ") : "") || String(safeEnrichment.author || "").trim(),
    publisher: String(safeExtracted.publisher || "").trim() || String(safeEnrichment.publisher || "").trim(),
    year: cleanYearValue(safeExtracted.published_year) || cleanYearValue(safeEnrichment.year) || String(safeExtracted.published_year || "").trim() || String(safeEnrichment.year || "").trim(),
    edition: String(safeExtracted.edition || "").trim() || String(safeEnrichment.edition || "").trim(),
    contributor: (Array.isArray(safeExtracted.contributors) ? (safeExtracted.contributors[0] || "") : "") || String(safeEnrichment.contributor || "").trim(),
    illustrationNote: String(safeExtracted.illustration_note || "").trim() || String(safeEnrichment.illustration_note || "").trim(),
    isbn: cleanMatchIsbn(safeExtracted.isbn_13 || safeExtracted.isbn_10 || ""),
    subjects: "",
    source: safeEnrichment && String(safeEnrichment.confidence_note || "").trim() ? "Photo Lookup + Perplexity" : "Photo Lookup",
    coverUrl: ""
  };
}

function populateManualFormFromBook(book) {
  const source = book && typeof book === "object" ? book : {};
  document.getElementById("manTitle").value = source.title || "";
  document.getElementById("manAuthor").value = source.author || "";
  document.getElementById("manPublisher").value = source.publisher || "";
  document.getElementById("manYear").value = source.year || "";
  document.getElementById("manEdition").value = source.edition || "";
  document.getElementById("manContributor").value = source.contributor || "";
  document.getElementById("manSubjects").value = source.subjects || "";
  updateAuthorSortField(source.author || "", true);
}

function startBarcodePhotoFallback() {
  try { localStorage.setItem("_cameraActive", Date.now().toString()); } catch (e) {}
  closeCamera();
  const input = document.getElementById("barcodePhotoInput");
  if (!input) return;
  input.value = "";
  input.click();
}

async function handleBarcodePhotoSelection(input) {
  const file = input && input.files && input.files[0] ? input.files[0] : null;
  if (!file) {
    try { localStorage.removeItem("_cameraActive"); } catch (e) {}
    return;
  }
  try { localStorage.removeItem("_cameraActive"); } catch (e) {}
  input.value = "";

  switchTab("isbn");
  setStatus("lookupStatus", "Reading ISBN from barcode photo\u2026", "");

  try {
    const image = await resizeImage(file, 1600);
    if (!image) throw new Error("Could not read that photo.");

    const analyzePhotoFn = functions.httpsCallable("analyzeBookPhoto");
    const result = await analyzePhotoFn({ images: [image] });
    const data = result.data || {};
    const isbn = extractIsbnFromPhotoLookupResult(data);
    if (!isbn) {
      throw new Error("Could not read a valid ISBN from that photo. Try a clearer photo of the barcode and the digits beneath it.");
    }

    document.getElementById("isbnInput").value = isbn;
    setStatus("lookupStatus", `ISBN found from photo: ${isbn}`, "success");
    await lookupISBN(isbn);
  } catch (error) {
    setStatus("lookupStatus", getCallableErrorMessage(error, "Could not read a valid ISBN from that photo."), "error");
  }
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (document.getElementById("coverLightbox").classList.contains("open")) {
      closeCoverLightbox();
    } else if (document.getElementById("bookPhotoMetaModal").classList.contains("open")) {
      closeBookPhotoMetaModal();
    } else if (document.getElementById("bookPhotoSourceModal").classList.contains("open")) {
      closeBookPhotoSourceModal();
    } else if (document.getElementById("coverSourceModal").classList.contains("open")) {
      closeCoverSourceModal();
    } else {
      document.getElementById("aboutModal").classList.remove("open");
      if (document.getElementById("cameraModal").classList.contains("open")) {
        closeCamera();
      }
      if (selectionMode) exitSelectionMode();
      closeMoveMenu();
    }
  } else if (document.getElementById("coverLightbox").classList.contains("open")) {
    if (e.key === "ArrowRight" && _coverLightboxItems.length > 1) {
      navigateCoverLightbox(1);
      e.preventDefault();
    } else if (e.key === "ArrowLeft" && _coverLightboxItems.length > 1) {
      navigateCoverLightbox(-1);
      e.preventDefault();
    }
  }
});

function startPhotoCamera() {
  // Record the timestamp so onAuthStateChanged can detect a camera-return null event.
  // On iOS, opening the native camera can cause a full page reload on return, which
  // briefly fires auth null before Firebase restores the cached session.
  try { localStorage.setItem("_cameraActive", Date.now().toString()); } catch(e) {}
  if (currentTab !== "isbn") switchTab("isbn");
  if (singleAddMode !== "photo") setSingleAddMode("photo");
  setMobileSection("add");
  persistAddFlowState();
  document.getElementById("photoCameraInput").click();
}

function startPhotoLookup() {
  if (photoFiles.length >= 3) {
    setStatus("photoStatus", "You can use up to 3 photos for one book.", "error");
    return;
  }
  document.getElementById("photoInput").click();
}

function getSelectedPhotoFile() {
  if (!photoFiles.length) return null;
  const index = Math.max(0, Math.min(_selectedPhotoCoverIndex, photoFiles.length - 1));
  const selected = photoFiles[index] || photoFiles[0] || null;
  return isStoredPhotoItem(selected) ? null : selected;
}

function refreshSelectedPhotoObjectUrl() {
  if (_photoObjectUrl && /^blob:/i.test(_photoObjectUrl)) {
    URL.revokeObjectURL(_photoObjectUrl);
  }
  _photoObjectUrl = null;
  if (!photoFiles.length) return;
  const index = Math.max(0, Math.min(_selectedPhotoCoverIndex, photoFiles.length - 1));
  const selectedItem = photoFiles[index] || photoFiles[0] || null;
  if (!selectedItem) return;
  if (isStoredPhotoItem(selectedItem)) {
    _photoObjectUrl = String(selectedItem.url || "").trim();
    return;
  }
  const selectedFile = getSelectedPhotoFile();
  if (selectedFile) {
    _photoObjectUrl = URL.createObjectURL(selectedFile);
  }
}

function selectPhotoCover(index) {
  if (index < 0 || index >= photoFiles.length) return;
  _selectedPhotoCoverIndex = index;
  _selectedCoverSource = "photo";
  _coverSourceTouched = true;
  refreshSelectedPhotoObjectUrl();
  const selectedFile = getSelectedPhotoFile();
  if (selectedFile) {
    pendingCoverBlob = null;
    pendingCoverBlobPromise = compressImageForCover(selectedFile)
      .then((blob) => {
        pendingCoverBlob = blob;
        return blob;
      })
      .catch((error) => {
        console.warn("Selected cover photo compression failed:", error);
        return null;
      });
  } else {
    pendingCoverBlob = null;
    pendingCoverBlobPromise = null;
  }
  if (currentTab === "manual") {
    renderManualCoverPreview((pendingBook && pendingBook.coverUrl) || "");
  } else if (reviewData) {
    showReviewSection(reviewData);
  } else if (pendingBook && pendingBook.coverUrl) {
    renderManualCoverPreview(pendingBook.coverUrl);
  }
  renderPhotoThumbnails();
  updateSinglePhotoRefinementActions();
}

function updateSinglePhotoRefinementActions() {
  const row = document.getElementById("singlePhotoRefineActions");
  if (!row) return;
  const canRefine = currentTab === "manual"
    && photoFiles.length > 0
    && pendingEditionLookupContext
    && /^photo-/.test(String(pendingEditionLookupContext.mode || ""));
  if (!canRefine) {
    row.style.display = "none";
    row.innerHTML = "";
    return;
  }
  row.style.display = "";
  row.innerHTML = `
    <button class="btn btn-light btn-sm" type="button" onclick="startPhotoLookup()">Add Another Photo</button>
    <button class="btn btn-secondary btn-sm" type="button" onclick="submitPhotoLookup()">Re-analyze ${photoFiles.length} Photo${photoFiles.length !== 1 ? "s" : ""}</button>
  `;
}

function handlePhotoSelection(input) {
  const incomingFiles = Array.from(input.files || []).filter((file) => file && /^image\//.test(file.type || ""));
  const openSlots = Math.max(0, 3 - photoFiles.length);
  const files = photoFiles.concat(incomingFiles.slice(0, openSlots));
  if (!files.length) {
    // User cancelled (e.g. dismissed camera without taking a photo)
    try { localStorage.removeItem("_cameraActive"); } catch(e) {}
    return;
  }
  try { localStorage.removeItem("_cameraActive"); } catch(e) {}
  // Set photoFiles and render thumbnails synchronously so they appear
  // immediately in the same microtask as the onchange event.  The async
  // arrayBuffer() buffering approach introduced a gap during which timing
  // issues (auth restore, bfcache events) could prevent thumbnails from
  // appearing.  createImageBitmap() in resizeImage() reads the file data
  // directly when Analyze is tapped â€” no upfront buffering needed.
  if (currentTab !== "isbn") switchTab("isbn");
  if (singleAddMode !== "photo") setSingleAddMode("photo");
  setMobileSection("add");
  photoFiles = files;
  photoFileSourceMeta = photoFileSourceMeta.concat(incomingFiles.slice(0, openSlots).map(() => ({ kind: "new" })));
  if (_selectedPhotoCoverIndex >= photoFiles.length) {
    _selectedPhotoCoverIndex = 0;
  }
  refreshSelectedPhotoObjectUrl();
  renderPhotoThumbnails();
  updateSinglePhotoRefinementActions();
  if (incomingFiles.length > openSlots) {
    setStatus("photoStatus", "You can use up to 3 photos for one book. Extra photos were not added.", "error");
  } else if (photoFiles.length === 3) {
    setStatus("photoStatus", "3 photos selected. That is the maximum for one book.", "success");
  }
  // Reset gallery inputs so the same file can be re-selected again later.
  // Do NOT reset the camera input â€” each shot is always unique content
  // (so reset is unnecessary), and clearing it on some iOS versions can
  // silently invalidate the File object before createImageBitmap() reads
  // it when the user taps Analyze.
  if (input.id !== "photoCameraInput") {
    input.value = "";
  }
}

function renderPhotoThumbnails() {
  const container = document.getElementById("photoPreviewRow");
  if (!photoFiles.length) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = photoFiles.map((file, i) => {
    const url = getPhotoItemPreviewUrl(file);
    const sourceLabel = isStoredPhotoItem(file) ? "Saved" : "";
    return `<div class="photo-thumb${i === _selectedPhotoCoverIndex ? " selected-cover" : ""}">
      <img src="${url}" alt="Photo ${i + 1}">
      ${sourceLabel ? `<div class="metadata-refresh-photo-label" style="margin-bottom:4px;">${sourceLabel}</div>` : ""}
      <button type="button" class="photo-cover-btn" onclick="selectPhotoCover(${i})" title="Use as cover">${i === _selectedPhotoCoverIndex ? "Cover" : "Set Cover"}</button>
      <button type="button" onclick="removePhoto(${i})" title="Remove">\u2715</button>
    </div>`;
  }).join("") +
    (photoFiles.length < 3
      ? `<button class="btn btn-light btn-sm" type="button" onclick="startPhotoLookup()" title="Add another photo">+</button> `
      : "") +
    `<button class="btn btn-secondary btn-sm" type="button" onclick="submitPhotoLookup()">Analyze</button>`;
}

function removePhoto(index) {
  photoFiles.splice(index, 1);
  photoFileSourceMeta.splice(index, 1);
  if (_selectedPhotoCoverIndex >= photoFiles.length) {
    _selectedPhotoCoverIndex = Math.max(0, photoFiles.length - 1);
  }
  refreshSelectedPhotoObjectUrl();
  renderPhotoThumbnails();
  updateSinglePhotoRefinementActions();
  if (!photoFiles.length) {
    setStatus("photoStatus", "", "");
  }
}

async function resizeImage(file, maxDim) {
  // Primary path: createImageBitmap works directly with File/Blob objects without
  // needing an objectURL, and is more reliable on iOS/WebKit than the img-element approach.
  if (typeof createImageBitmap !== "undefined") {
    try {
      const bitmap = await createImageBitmap(file);
      let { width, height } = bitmap;
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      return { data: canvas.toDataURL("image/jpeg", 0.85).split(",")[1], mimeType: "image/jpeg" };
    } catch (e) {
      console.warn("[resizeImage] createImageBitmap failed, falling back to img element:", e.message);
    }
  }
  // Fallback: img element + objectURL
  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(objectUrl);
      resolve({ data: canvas.toDataURL("image/jpeg", 0.85).split(",")[1], mimeType: "image/jpeg" });
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };
    img.src = objectUrl;
  });
}

async function submitPhotoLookup() {
  if (!photoFiles.length || photoLookupInFlight) return;

  photoLookupInFlight = true;
  setStatus("photoStatus", "Analyzing images\u2026", "");
  const hasStoredPhotos = photoFiles.some((item) => isStoredPhotoItem(item));

  try {
    const imageInputs = (await Promise.all(photoFiles.map(async (item) => {
      if (isStoredPhotoItem(item)) {
        return {
          storagePath: String(item.storagePath || "").trim(),
          url: String(item.url || "").trim(),
          mimeType: String(item.mimeType || "image/jpeg").trim() || "image/jpeg"
        };
      }
      return await resizeImage(item, 1600);
    }))).filter(Boolean);
    if (!imageInputs.length) {
      setStatus("photoStatus", "Could not read the selected images.", "error");
      return;
    }

    setStatus("photoStatus", "Reading metadata from the image\u2026", "");

    const analyzePhotoFn = functions.httpsCallable("analyzeBookPhoto");
    const inlineImages = imageInputs.filter((item) => item && typeof item.data === "string" && item.data.trim());
    const result = await analyzePhotoFn({
      imageInputs,
      images: inlineImages
    });
    const data = result.data;
    const extracted = data && data.extracted ? data.extracted : null;
    const isbnAuthoritative = extractedHasValidIsbn(extracted);

    if (isSpecificEditionModeEnabled() && !isbnAuthoritative && extracted && extracted.title) {
      setStatus("photoStatus", "Normalizing extracted metadata\u2026", "");
      let enrichment = {};
      try {
        const fn = functions.httpsCallable("resolveEditionMetadata");
        const enrichResult = await fn({
          book: buildPhotoDerivedBookFromExtracted(extracted),
          extracted,
          candidate: null
        });
        enrichment = enrichResult.data && enrichResult.data.metadata ? enrichResult.data.metadata : {};
      } catch (error) {
        console.warn("[submitPhotoLookup] edition normalization failed:", error);
      }

      const photoDerivedBook = buildPhotoDerivedBookFromExtracted(extracted, enrichment);
      switchTab("manual");
      pendingBook = null;
      reviewData = null;
      manualSelectedResult = null;
      pendingEditionLookupContext = {
        mode: "photo-non-isbn",
        extractedHasIsbn: false,
        extracted,
        candidate: null,
        enrichment
      };
      populateManualFormFromBook(photoDerivedBook);
      document.getElementById("bookMetaSection").style.display = "";
      refreshSelectedPhotoObjectUrl();
      document.getElementById("reviewSection").style.display = "none";
      updateFillEditionButton();
      _selectedCoverSource = "photo";
      renderManualCoverPreview("");
      setStatus(
        "manualSearchStatus",
        (enrichment && String(enrichment.confidence_note || "").trim())
          ? `Image metadata normalized. ${String(enrichment.confidence_note).trim()} Click Search to look for likely matches and cover options.`
          : "Image metadata loaded into the form. Click Search to look for likely matches and cover options.",
        "success"
      );
      setStatus("photoStatus", "Image metadata loaded into the form.", "success");
      updateSinglePhotoRefinementActions();
      const selectedPhotoFile = getSelectedPhotoFile();
      if (selectedPhotoFile) {
        pendingCoverBlob = null;
        compressImageForCover(selectedPhotoFile).then((blob) => {
          pendingCoverBlob = blob;
        }).catch((error) => {
          console.warn("[submitPhotoLookup] cover compression failed:", error);
        });
      }
    } else {
      reviewData = data;
      showReviewSection(data);
      setStatus("photoStatus", data.message, data.bestMatch ? "success" : "");
    }
  } catch (error) {
    const message = error && error.message ? String(error.message) : "Photo analysis failed.";
    if (hasStoredPhotos && /Provide 1 to 3 images/i.test(message)) {
      setStatus("photoStatus", "Saved-photo analysis needs the updated cloud function. Deploy Functions, then try Analyze again.", "error");
    } else {
      setStatus("photoStatus", message, "error");
    }
  } finally {
    photoLookupInFlight = false;
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Review Section â€” show match results, let user pick a candidate
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function showReviewSection(data) {
  const section = document.getElementById("reviewSection");
  const card = document.getElementById("reviewCard");
  const list = document.getElementById("candidateList");

  if (!data || (!data.bestMatch && !data.candidates.length && !(data.extracted && data.extracted.title))) {
    section.style.display = "none";
    return;
  }

  // Refresh photo object URL for cover picker (revoke stale one first)
  refreshSelectedPhotoObjectUrl();

  section.style.display = "";
  const display = data.bestMatch || (data.candidates.length > 0 ? data.candidates[0] : null);

  if (display) {
    card.innerHTML = renderReviewCard(display);
  } else if (data.extracted && data.extracted.title) {
    card.innerHTML = renderExtractedCard(data.extracted);
  }

  // Show other candidates if multiple
  if (data.candidates.length > 1) {
    list.innerHTML = `<div class="section-label" style="margin-top:10px;">Other matches</div>` +
      data.candidates.slice(1).map((c, i) => {
        const cue = describeReviewMatch(c, data.extracted);
        const thumb = c.coverUrl
          ? `<div class="candidate-item-thumb"><img src="${escapeAttribute(c.coverUrl)}" alt="" onerror="this.parentElement.textContent='ðŸ“–'"></div>`
          : `<div class="candidate-item-thumb">ðŸ“–</div>`;
        return `<button class="candidate-item" type="button" onclick="selectCandidate(${i + 1})">
          ${thumb}
          <div class="candidate-item-text">
            <strong>${esc(c.title)}</strong>
            <span>${[c.authors.join(", "), c.publishedDate, c.source.replace(/_/g, " ")].filter(Boolean).map(esc).join(" | ")}</span>
            <span class="candidate-reason">${esc(cue.badge)} - ${esc(cue.detail)}</span>
          </div>
        </button>`;
      }).join("");
    list.style.display = "";
  } else {
    list.innerHTML = "";
    list.style.display = "none";
  }
}

function getBriefingAudioVariant(bookId, spoilerMode) {
  const audioDoc = briefingAudioCache[bookId];
  const variants = audioDoc && typeof audioDoc.variants === "object" ? audioDoc.variants : {};
  const variant = variants[spoilerMode];
  return variant && typeof variant === "object" ? variant : null;
}

function isDailyRateLimitFallbackAudio(variant) {
  return Boolean(
    variant &&
    variant.status === "ready" &&
    variant.ttsModel === FLASH_TTS_MODEL
  );
}

function currentSpoilerModeForBook(book, briefing) {
  const isFiction = briefing && (briefing.genre || "").toLowerCase() === "fiction";
  return isFiction && hasFictionSpoilerPair(briefing) && document.getElementById("spoilerToggle")?.checked ? "spoiler" : "safe";
}

function hasFictionSpoilerPair(briefing) {
  if (!briefing || (briefing.genre || "").toLowerCase() !== "fiction") return false;
  return hasBriefingText(briefing.summary_safe)
    && hasBriefingText(briefing.summary_spoiler)
    && hasBriefingList(briefing.key_elements_safe)
    && hasBriefingList(briefing.key_elements_spoiler)
    && hasBriefingText(briefing.craft_analysis_safe)
    && hasBriefingText(briefing.craft_analysis_spoiler)
    && hasBriefingList(briefing.discussion_questions_safe)
    && hasBriefingList(briefing.discussion_questions_spoiler);
}

function hasBriefingText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasBriefingList(value) {
  return Array.isArray(value) && value.some((item) => typeof item === "string" && item.trim().length > 0);
}

function currentAudioKey(bookId, spoilerMode) {
  return bookId + ":" + spoilerMode;
}

function isBriefingAudioGeneratingStale(variant) {
  if (!variant || variant.status !== "generating") return false;
  const stamp = Date.parse(String(variant.generatedAt || variant.updatedAt || ""));
  if (!Number.isFinite(stamp)) return false;
  return (Date.now() - stamp) > AUDIO_GENERATING_STALE_MS;
}

function clearBriefingAudioUrlState(bookId, spoilerMode) {
  const key = currentAudioKey(bookId, spoilerMode);
  delete briefingAudioUrls[key];
  delete briefingAudioUrlErrors[key];
}

function getCallableErrorMessage(error, fallback) {
  if (!error) return fallback;
  if (typeof error.details === "string" && error.details.trim()) return error.details.trim();
  if (error.details && typeof error.details.reason === "string" && error.details.reason.trim()) {
    return error.details.reason.trim();
  }
  if (typeof error.message === "string" && error.message.trim() && error.message.trim().toLowerCase() !== "internal") {
    return error.message.trim();
  }
  return fallback;
}

function setAuthOverlayVisible(visible) {
  const overlay = document.getElementById("authOverlay");
  if (!overlay) return;
  overlay.classList.toggle("is-hidden", !visible);
  overlay.style.display = visible ? "flex" : "none";
}

async function ensureBriefingAudioUrl(bookId, spoilerMode, variant) {
  if (!variant || variant.status !== "ready" || !variant.audioPath) return "";
  const key = currentAudioKey(bookId, spoilerMode);
  if (briefingAudioUrls[key]) return briefingAudioUrls[key];
  if (briefingAudioUrlErrors[key]) return "";
  try {
    const fn = functions.httpsCallable("getBriefingAudio");
    const result = await fn({ bookId, spoilerMode });
    const url = result.data && result.data.audioUrl ? result.data.audioUrl : "";
    if (url) {
      briefingAudioUrls[key] = url;
      delete briefingAudioUrlErrors[key];
      if (selectedBookId === bookId) renderBriefingPanel();
    }
    return url;
  } catch (error) {
    const message = getCallableErrorMessage(error, "Could not load audio.");
    briefingAudioUrlErrors[key] = message;
    console.error("[ensureBriefingAudioUrl] signed URL fetch failed:", error);
    if (selectedBookId === bookId) renderBriefingPanel();
    return "";
  }
}

async function waitForBriefingAudioError(bookId, spoilerMode, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const variant = getBriefingAudioVariant(bookId, spoilerMode);
    if (variant && variant.status === "error" && variant.error) return variant.error;
    await new Promise(function(resolve) { setTimeout(resolve, 150); });
  }
  return "";
}

async function refreshBriefingAudioDoc(bookId) {
  if (!auth.currentUser || !bookId) return null;
  const snap = await db.collection("users").doc(auth.currentUser.uid).collection("briefingAudio").doc(bookId).get();
  const previousDoc = briefingAudioCache[bookId];
  if (!snap.exists) {
    if (briefingAudioCache[bookId] !== undefined) {
      delete briefingAudioCache[bookId];
      delete briefingAudioUrls[bookId + ":safe"];
      delete briefingAudioUrls[bookId + ":spoiler"];
      delete briefingAudioUrlErrors[bookId + ":safe"];
      delete briefingAudioUrlErrors[bookId + ":spoiler"];
      renderBriefingPanel();
      updateResearchButtons();
    }
    return null;
  }

  const nextDoc = snap.data() || {};
  if (JSON.stringify(previousDoc) !== JSON.stringify(nextDoc)) {
    briefingAudioCache[bookId] = nextDoc;
    handleSelectedBriefingAudioUpdate(bookId, previousDoc, nextDoc);
    renderBriefingPanel();
    updateResearchButtons();
  }
  return nextDoc;
}

async function pollBriefingAudioStatus(bookId, spoilerMode, timeoutMs = 45000) {
  const pollKey = currentAudioKey(bookId, spoilerMode);
  const token = Date.now() + Math.random();
  briefingAudioPollState[pollKey] = token;
  const started = Date.now();

  while (briefingAudioPollState[pollKey] === token && (Date.now() - started) < timeoutMs) {
    try {
      await refreshBriefingAudioDoc(bookId);
    } catch (error) {
      console.error("[pollBriefingAudioStatus] refresh failed:", error);
    }

    const variant = getBriefingAudioVariant(bookId, spoilerMode);
    if (variant && variant.status === "ready") {
      delete briefingAudioPollState[pollKey];
      await ensureBriefingAudioUrl(bookId, spoilerMode, variant);
      return variant;
    }
    if (variant && variant.status === "error") {
      delete briefingAudioPollState[pollKey];
      return variant;
    }

    await new Promise(function(resolve) { setTimeout(resolve, 1500); });
  }

  if (briefingAudioPollState[pollKey] === token) {
    delete briefingAudioPollState[pollKey];
  }
  return getBriefingAudioVariant(bookId, spoilerMode);
}

function retryBriefingAudioUrl(bookId, spoilerMode) {
  const variant = getBriefingAudioVariant(bookId, spoilerMode);
  clearBriefingAudioUrlState(bookId, spoilerMode);
  renderBriefingPanel();
  if (variant && variant.status === "ready") {
    ensureBriefingAudioUrl(bookId, spoilerMode, variant);
  }
}

function handleSelectedBriefingAudioUpdate(bookId, previousDoc, nextDoc) {
  if (!selectedBookId || selectedBookId !== bookId) return;
  const book = findBook(bookId);
  const briefing = book && researchCache[bookId];
  if (!book || !briefing) return;
  const spoilerMode = currentSpoilerModeForBook(book, briefing);
  const prevVariants = previousDoc && typeof previousDoc.variants === "object" ? previousDoc.variants : {};
  const nextVariants = nextDoc && typeof nextDoc.variants === "object" ? nextDoc.variants : {};
  const prevVariant = prevVariants[spoilerMode] && typeof prevVariants[spoilerMode] === "object" ? prevVariants[spoilerMode] : null;
  const nextVariant = nextVariants[spoilerMode] && typeof nextVariants[spoilerMode] === "object" ? nextVariants[spoilerMode] : null;
  if (!nextVariant) return;
  if (nextVariant.ttsFallbackReason === "daily-rate-limit") {
    briefingAudioProAvailableToday = false;
  }
  if (nextVariant.status === "ready" && (!prevVariant || prevVariant.status !== "ready")) {
    const readyMessage = nextVariant.ttsFallbackReason === "daily-rate-limit"
      ? `Audio overview ready for "${book.title}". Lower quality audio was used due to today's Pro TTS rate limit.`
      : nextVariant.ttsFallbackReason === "admin-required"
        ? `Audio overview ready for "${book.title}" using Flash TTS. Administrative access is required for Pro audio.`
      : `Audio overview ready for "${book.title}".`;
    setResearchStatus(readyMessage, "success");
  } else if (nextVariant.status === "error" && (!prevVariant || prevVariant.status !== "error")) {
    setResearchStatus(nextVariant.error || "Audio generation failed.", "error");
  }
}

async function generateBriefingAudioForSelected(forceRefresh) {
  const book = selectedBookId ? findBook(selectedBookId) : null;
  const briefing = book && researchCache[book.id];
  if (!book || !briefing) {
    setResearchStatus("Generate the book briefing first.", "error");
    return;
  }
  if (!researchEnabled) {
    setResearchStatus("Sign in to enable book briefing audio.", "error");
    return;
  }
  if (briefingAudioRequestInFlight) return;

  const spoilerMode = currentSpoilerModeForBook(book, briefing);
  const isFiction = (briefing.genre || "").toLowerCase() === "fiction";
  if (isFiction && spoilerMode === "spoiler" && !forceRefresh) {
    const proceed = confirm("This audio overview may reveal major plot points. Generate spoiler-inclusive audio?");
    if (!proceed) return;
  }

  const existingVariant = getBriefingAudioVariant(book.id, spoilerMode);
  if (existingVariant && existingVariant.status === "ready" && existingVariant.audioPath && !forceRefresh) {
    await ensureBriefingAudioUrl(book.id, spoilerMode, existingVariant);
    renderBriefingPanel();
    return;
  }
  if (!forceRefresh) {
    const proceed = confirm(`Generate audio for "${book.title}"? This uses paid audio generation credits.`);
    if (!proceed) return;
  }

  briefingAudioRequestInFlight = true;
  updateResearchButtons();
  setResearchStatus(`Preparing audio overview for "${book.title}". You can keep using TomeShelf and come back to this book when it is ready.`, "");
  renderBriefingPanel();

  try {
    const fn = functions.httpsCallable("generateBriefingAudio");
    const result = await fn({ bookId: book.id, spoilerMode, forceRefresh });
    if (result.data && result.data.ok === false) {
      throw new Error(result.data.error || "Audio generation failed.");
    }
    const metadata = result.data && result.data.metadata;
    const resolvedMode = result.data && result.data.spoilerMode ? result.data.spoilerMode : spoilerMode;
    const audioUrl = result.data && result.data.audioUrl ? result.data.audioUrl : "";
    if (result.data && typeof result.data.proAvailableToday === "boolean") {
      briefingAudioProAvailableToday = result.data.proAvailableToday;
    }
    if (result.data && typeof result.data.adminAccessValid === "boolean") {
      adminAccessState.adminAccessValid = Boolean(result.data.adminAccessValid);
      adminAccessState.adminAccessDisabled = Boolean(result.data.adminAccessDisabled);
      adminAccessState.adminAccessStale = Boolean(result.data.adminAccessStale);
      adminAccessState.hasStoredAdminAccess = Boolean(result.data.hasStoredAdminAccess)
        || adminAccessState.adminAccessValid
        || adminAccessState.adminAccessDisabled
        || adminAccessState.adminAccessStale;
    }
    if (!metadata || typeof metadata !== "object") {
      throw new Error("The server returned empty audio metadata. Please try again.");
    }
    if (metadata.ttsFallbackReason === "daily-rate-limit") {
      briefingAudioProAvailableToday = false;
    }
    const currentDoc = briefingAudioCache[book.id] && typeof briefingAudioCache[book.id] === "object" ? briefingAudioCache[book.id] : {};
    const variants = currentDoc.variants && typeof currentDoc.variants === "object" ? currentDoc.variants : {};
    briefingAudioCache[book.id] = {
      ...currentDoc,
      variants: {
        ...variants,
        [resolvedMode]: metadata
      }
    };
    clearBriefingAudioUrlState(book.id, resolvedMode);
    if (audioUrl) {
      briefingAudioUrls[currentAudioKey(book.id, resolvedMode)] = audioUrl;
    }
    renderBriefingPanel();
    if (result.data && result.data.queued) {
      const queuedMessage = metadata.ttsFallbackReason === "daily-rate-limit"
        ? `Preparing audio overview for "${book.title}". Lower quality audio is being used due to today's Pro TTS rate limit.`
        : metadata.ttsFallbackReason === "admin-required"
          ? `Preparing audio overview for "${book.title}" with Flash TTS. Administrative access is required for Pro audio.`
          : `Preparing audio overview for "${book.title}". You can keep using TomeShelf and come back to this book when it is ready.`;
      setResearchStatus(queuedMessage, "");
      pollBriefingAudioStatus(book.id, resolvedMode).catch(function(error) {
        console.error("[generateBriefingAudioForSelected] audio status poll failed:", error);
      });
    } else {
      const readyMessage = metadata.ttsFallbackReason === "daily-rate-limit"
        ? `Audio overview ready for "${book.title}". Lower quality audio was used due to today's Pro TTS rate limit.`
        : metadata.ttsFallbackReason === "admin-required"
          ? `Audio overview ready for "${book.title}" using Flash TTS. Administrative access is required for Pro audio.`
          : `Audio overview ready for "${book.title}".`;
      setResearchStatus(readyMessage, "success");
    }
  } catch (error) {
    const latestVariant = getBriefingAudioVariant(book.id, spoilerMode);
    const storedError = latestVariant && latestVariant.status === "error" ? latestVariant.error : "";
    setResearchStatus(storedError || getCallableErrorMessage(error, "Audio generation failed."), "error");
    renderBriefingPanel();
  } finally {
    briefingAudioRequestInFlight = false;
    updateResearchButtons();
  }
}

function normalizeMatchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compareWordOverlap(a, b) {
  const aNorm = normalizeMatchText(a);
  const bNorm = normalizeMatchText(b);
  if (!aNorm || !bNorm) return 0;
  const aWords = new Set(aNorm.split(" ").filter(Boolean));
  const bWords = new Set(bNorm.split(" ").filter(Boolean));
  if (!aWords.size || !bWords.size) return 0;
  let overlap = 0;
  aWords.forEach((word) => {
    if (bWords.has(word)) overlap += 1;
  });
  return overlap / Math.max(aWords.size, bWords.size);
}

function dedupeStringArray(values) {
  const seen = new Set();
  const out = [];
  (Array.isArray(values) ? values : []).forEach((value) => {
    const cleaned = String(value || "").trim();
    const key = normalizeMatchText(cleaned);
    if (!cleaned || !key || seen.has(key)) return;
    seen.add(key);
    out.push(cleaned);
  });
  return out;
}

function compareListOverlap(left, right) {
  const a = dedupeStringArray(Array.isArray(left) ? left : []);
  const b = dedupeStringArray(Array.isArray(right) ? right : []);
  if (!a.length || !b.length) return -1;
  let best = 0;
  a.forEach((leftItem) => {
    b.forEach((rightItem) => {
      best = Math.max(best, compareWordOverlap(leftItem, rightItem));
    });
  });
  return best;
}

function cleanYearValue(value) {
  const raw = String(value || "").trim();
  const digitMatch = raw.match(/\b(1[4-9]\d{2}|20\d{2}|2100)\b/);
  if (digitMatch) return digitMatch[1];
  const romanMatch = raw.match(/\b[MCDLXVI]+\b/i);
  if (!romanMatch) return "";
  const numerals = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  let prev = 0;
  const roman = romanMatch[0].toUpperCase();
  for (let i = roman.length - 1; i >= 0; i -= 1) {
    const current = numerals[roman[i]];
    if (!current) return "";
    if (current < prev) total -= current;
    else {
      total += current;
      prev = current;
    }
  }
  return total >= 1400 && total <= 2100 ? String(total) : "";
}

function compareYearCloseness(left, right) {
  const a = cleanYearValue(left);
  const b = cleanYearValue(right);
  if (!a || !b) return -1;
  const diff = Math.abs(Number(a) - Number(b));
  if (diff === 0) return 1;
  if (diff <= 1) return 0.75;
  if (diff <= 3) return 0.5;
  if (diff <= 5) return 0.25;
  return 0;
}

function cleanMatchIsbn(value) {
  return String(value || "").replace(/[^0-9X]/gi, "").toUpperCase();
}

function normalizeCompareText(value) {
  return String(value || "").trim().toLowerCase();
}

function resultContainsExactIsbn(result, isbn) {
  const target = cleanMatchIsbn(isbn);
  if (!target || !result || typeof result !== "object") return false;
  return [result.isbn, result.isbn_13, result.isbn_10].some((value) => cleanMatchIsbn(value) === target);
}

function getExtractedContextIsbn(context) {
  if (!context || typeof context !== "object") return "";
  const extracted = context.extracted || null;
  return cleanMatchIsbn(extracted && (extracted.isbn_13 || extracted.isbn_10));
}

function hasExactIsbnAuthority(context, candidate = null) {
  const extractedIsbn = getExtractedContextIsbn(context);
  if (!extractedIsbn) return false;
  const target = candidate || (context && context.candidate) || null;
  return resultContainsExactIsbn(target, extractedIsbn);
}

function getQuickAddOriginalYear(match) {
  if (!match || typeof match !== "object") return "";
  if (cleanYearValue(match.firstPublishedYear)) return cleanYearValue(match.firstPublishedYear);
  const source = normalizeCompareText(match.source || "");
  if (!source.includes("open library") && !source.includes("open_library")) return "";
  return cleanYearValue(match.publishedDate || match.year || "");
}

function getBulkQuickAddOriginalYear(entry) {
  if (!entry || typeof entry !== "object") return "";
  const direct = getQuickAddOriginalYear(entry.result || null);
  if (direct) return direct;
  const alternates = Array.isArray(entry.candidates) ? entry.candidates : [];
  for (const candidate of alternates) {
    const candidateYear = getQuickAddOriginalYear(candidate);
    if (!candidateYear) continue;
    const sameTitle = compareWordOverlap((entry.result && entry.result.title) || entry.aiTitle || "", candidate.title || "") >= 0.85;
    const sameAuthor = compareWordOverlap((entry.result && entry.result.author) || entry.aiAuthor || "", candidate.author || "") >= 0.75;
    if (sameTitle && (sameAuthor || !((entry.result && entry.result.author) || entry.aiAuthor || "").trim())) {
      return candidateYear;
    }
  }
  return "";
}

function getBookshelfPhotoSaveYear(entry) {
  const originalYear = getBulkQuickAddOriginalYear(entry);
  if (originalYear) return originalYear;
  if (!entry || bulkBatchMode || bulkTextMode) return "";
  const resultYear = cleanYearValue(entry && entry.result && entry.result.year);
  if (!resultYear) return "";
  const cue = describeBulkMatch(entry);
  if (cue.tone === "strong" || cue.tone === "likely") {
    return resultYear;
  }
  return "";
}

function buildQuickAddBook(book, options = {}) {
  const source = book && typeof book === "object" ? book : {};
  const keepEditionMetadata = Boolean(options.keepEditionMetadata);
  const year = options.year === undefined ? String(source.year || "").trim() : String(options.year || "").trim();
  if (keepEditionMetadata) {
    return {
      ...source,
      year
    };
  }
  return {
    ...source,
    publisher: "",
    edition: "",
    contributor: "",
    illustrationNote: "",
    subjects: "",
    isbn: "",
    year
  };
}

function buildAuthoritativePhotoBook(match, extracted) {
  const extractedIsbn = cleanMatchIsbn(extracted && (extracted.isbn_13 || extracted.isbn_10));
  return {
    isbn: extractedIsbn || cleanMatchIsbn(match && (match.isbn_13 || match.isbn_10)),
    title: match ? (match.title + (match.subtitle ? ": " + match.subtitle : "")) : ((extracted && extracted.title) || ""),
    author: match && Array.isArray(match.authors) && match.authors.length
      ? match.authors.join(", ")
      : (extracted && Array.isArray(extracted.authors) ? extracted.authors.join(", ") : ""),
    publisher: match && match.publisher ? match.publisher : (extracted && extracted.publisher ? extracted.publisher : ""),
    year: cleanYearValue(match && match.publishedDate) || cleanYearValue(extracted && extracted.published_year) || "",
    subjects: Array.isArray(match && match.categories) ? match.categories.join("; ") : "",
    edition: extracted && extracted.edition ? extracted.edition : "",
    contributor: (extracted && Array.isArray(extracted.contributors) ? (extracted.contributors[0] || "") : "")
      || (match && Array.isArray(match.contributors) ? (match.contributors[0] || "") : ""),
    illustrationNote: extracted && extracted.illustration_note ? extracted.illustration_note : "",
    coverUrl: match && match.coverUrl ? match.coverUrl : "",
    source: "Photo Lookup (ISBN)"
  };
}

function hasStrongPhotoEditionEvidence(context) {
  if (!context || typeof context !== "object") return false;
  if (hasExactIsbnAuthority(context)) return true;
  const enrichment = context.enrichment && typeof context.enrichment === "object" ? context.enrichment : {};
  const enrichmentFields = [
    enrichment.publisher,
    enrichment.year,
    enrichment.edition,
    enrichment.contributor,
    enrichment.illustration_note
  ].filter((value) => String(value || "").trim()).length;
  if (enrichmentFields >= 2) return true;

  const extracted = context.extracted && typeof context.extracted === "object" ? context.extracted : {};
  const extractedFields = [
    extracted.publisher,
    cleanYearValue(extracted.published_year),
    extracted.edition,
    Array.isArray(extracted.contributors) && extracted.contributors.length ? extracted.contributors.join(" ") : "",
    extracted.illustration_note
  ].filter((value) => String(value || "").trim()).length;
  const visible = Array.isArray(extracted.source_visible) ? extracted.source_visible.join(" ").toLowerCase() : "";
  const hasEditionPages = /title page|copyright page|colophon|back cover/.test(visible);
  return extractedFields >= 3 || (hasEditionPages && extractedFields >= 2);
}

function hasStrongEditionSaveEvidence(book, context, selectedResult) {
  if (hasExactIsbnAuthority(context)) return true;
  if (hasStrongPhotoEditionEvidence(context)) return true;
  const source = book && typeof book === "object" ? book : {};
  const directFields = [
    source.publisher,
    source.year,
    source.edition,
    source.contributor,
    source.illustrationNote
  ].filter((value) => String(value || "").trim()).length;
  if (selectedResult) {
    const extracted = context && context.extracted && typeof context.extracted === "object" ? context.extracted : {};
    const enrichment = context && context.enrichment && typeof context.enrichment === "object" ? context.enrichment : {};
    const candidate = context && context.candidate && typeof context.candidate === "object" ? context.candidate : {};
    let corroboration = 0;
    if (compareWordOverlap(source.publisher || enrichment.publisher || extracted.publisher, selectedResult.publisher || candidate.publisher) >= 0.7) corroboration += 1;
    if (compareYearCloseness(source.year || enrichment.year || extracted.published_year, selectedResult.year || selectedResult.publishedDate || candidate.year) >= 0.75) corroboration += 1;
    if (compareWordOverlap(source.edition || enrichment.edition || extracted.edition, selectedResult.edition || candidate.edition) >= 0.7) corroboration += 1;
    if (compareWordOverlap(source.contributor || enrichment.contributor || (Array.isArray(extracted.contributors) ? extracted.contributors[0] : ""), selectedResult.contributor || (Array.isArray(selectedResult.contributors) ? selectedResult.contributors[0] : "") || candidate.contributor) >= 0.7) corroboration += 1;
    if (selectedResult && directFields >= 2) return true;
    if (corroboration >= 2 && directFields >= 1) return true;
  }
  return directFields >= 3;
}

function hasDistinctEditionEvidence(book) {
  const source = book && typeof book === "object" ? book : {};
  return Boolean(
    cleanMatchIsbn(source.isbn)
    || String(source.publisher || "").trim()
    || cleanYearValue(source.year)
    || String(source.edition || "").trim()
    || String(source.contributor || "").trim()
    || String(source.illustrationNote || "").trim()
  );
}

function sameWorkKey(left, right) {
  return normalizeCompareText(left && left.title) === normalizeCompareText(right && right.title)
    && normalizeCompareText(left && left.author) === normalizeCompareText(right && right.author);
}

function isSameEditionRecord(left, right) {
  if (!sameWorkKey(left, right)) return false;
  const leftIsbn = cleanMatchIsbn(left && left.isbn);
  const rightIsbn = cleanMatchIsbn(right && right.isbn);
  if (leftIsbn && rightIsbn) return leftIsbn === rightIsbn;
  if (leftIsbn || rightIsbn) return false;

  const markers = ["publisher", "year", "edition", "contributor", "illustrationNote"];
  let comparable = 0;
  for (const marker of markers) {
    const a = normalizeCompareText(left && left[marker]);
    const b = normalizeCompareText(right && right[marker]);
    if (a && b) {
      comparable += 1;
      if (a !== b) return false;
    } else if (a || b) {
      return false;
    }
  }
  if (comparable > 0) return true;
  return !hasDistinctEditionEvidence(left) && !hasDistinctEditionEvidence(right);
}

function findDuplicateBookForSave(book, editionAware) {
  return books.find((entry) => {
    if (editingBookId && entry.id === editingBookId) return false;
    if (editionAware) return isSameEditionRecord(book, entry);
    if (book.isbn && entry.isbn) return entry.isbn === book.isbn;
    return sameWorkKey(book, entry);
  });
}

function isSpecificEditionModeEnabled() {
  return Boolean(specificEditionMode);
}

function isBatchSpecificEditionModeEnabled() {
  return isSpecificEditionModeEnabled() && currentTab === "bulk" && bulkBatchMode;
}

function updateSpecificEditionAvailability() {
  const toggle = document.getElementById("specificEditionToggle");
  const helper = document.getElementById("catalogGranularityHelper");
  if (!toggle || !helper) return;
  const disabledForBulk = currentTab === "bulk" && (bulkTextMode || bulkPasteMode || (!bulkBatchMode && !bulkTextMode));
  toggle.disabled = disabledForBulk;
  if (disabledForBulk) {
    helper.textContent = bulkTextMode || bulkPasteMode
      ? "Titles in Text always uses Quick Add review. Specific Edition is only available for Batch Photos."
      : "Bookshelf Photo assumes edition usually does not matter. Specific Edition is only available for Batch Photos.";
    return;
  }
  helper.textContent = isSpecificEditionModeEnabled()
    ? "Specific Edition uses page evidence first. Non-ISBN photo flows keep extracted page metadata primary unless an exact ISBN match is confirmed."
    : "Quick Add saves title, author, and original-publication year when it can be trusted. Exact ISBN matches still keep full edition metadata.";
}

function defaultManualSearchStatus() {
  return isSpecificEditionModeEnabled()
    ? "Search by title and optionally author, or type details manually."
    : "Search by title and author, or type the basic details manually.";
}

function stripBookToCoreCatalogMetadata(book) {
  return buildQuickAddBook(book, { keepEditionMetadata: false });
}

function buildWorkLevelPhotoBook(match, extracted, exactIsbnAuthority) {
  const extractedTitle = extracted
    ? ((extracted.title || "") + (extracted.subtitle ? ": " + extracted.subtitle : "")).trim()
    : "";
  const extractedAuthor = extracted && Array.isArray(extracted.authors) ? extracted.authors.join(", ") : "";
  return {
    isbn: "",
    title: (match && (match.title || "").trim()) || extractedTitle,
    author: match && Array.isArray(match.authors) && match.authors.length ? match.authors.join(", ") : extractedAuthor,
    publisher: "",
    year: getQuickAddOriginalYear(match),
    subjects: "",
    edition: "",
    contributor: "",
    illustrationNote: "",
    coverUrl: match && match.coverUrl ? match.coverUrl : "",
    source: exactIsbnAuthority ? "Photo Lookup (ISBN)" : "Photo Lookup"
  };
}

function applyCatalogGranularityMode() {
  const toggle = document.getElementById("specificEditionToggle");
  if (toggle) toggle.checked = isSpecificEditionModeEnabled();
  updateSpecificEditionAvailability();
  const yearLabel = document.getElementById("manYearLabel");
  if (yearLabel) yearLabel.textContent = isSpecificEditionModeEnabled() ? "Year Published" : "Original Publication Year";
  const yearInput = document.getElementById("manYear");
  if (yearInput) yearInput.placeholder = isSpecificEditionModeEnabled() ? "e.g. 1952" : "e.g. 1923";
  const photoHelper = document.getElementById("singlePhotoHelper");
  if (photoHelper) {
    photoHelper.textContent = isSpecificEditionModeEnabled()
      ? "Add up to 3 photos. Best results: cover, title page, and copyright/publisher page. ISBN is best when available."
      : "Add up to 3 photos. Quick Add focuses on title, author, and original-publication year unless an exact ISBN match is confirmed.";
  }
  ["manPublisherGroup", "manEditionGroup", "manContributorGroup", "manSubjectsGroup"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = isSpecificEditionModeEnabled() ? "" : "none";
  });
  const status = document.getElementById("manualSearchStatus");
  if (status && !String(status.textContent || "").trim()) {
    status.textContent = defaultManualSearchStatus();
  }
  updateFillEditionButton();
}

function setSpecificEditionMode(enabled) {
  specificEditionMode = Boolean(enabled);
  try { localStorage.setItem("tomeshelf-specific-edition-mode", specificEditionMode ? "1" : "0"); } catch (e) {}
  applyCatalogGranularityMode();
}

function restoreSpecificEditionMode() {
  try { specificEditionMode = localStorage.getItem("tomeshelf-specific-edition-mode") === "1"; } catch (e) { specificEditionMode = false; }
  applyCatalogGranularityMode();
}

function hasValidMatchIsbn(value) {
  const cleaned = cleanMatchIsbn(value);
  return cleaned.length === 10 || cleaned.length === 13;
}

function extractedHasValidIsbn(extracted) {
  if (!extracted || typeof extracted !== "object") return false;
  return hasValidMatchIsbn(extracted.isbn_13) || hasValidMatchIsbn(extracted.isbn_10);
}

function describeReviewMatch(match, extracted) {
  const titleScore = compareWordOverlap(extracted && extracted.title, match && match.title);
  const authorScore = compareWordOverlap(
    extracted && Array.isArray(extracted.authors) ? extracted.authors[0] : "",
    match && Array.isArray(match.authors) ? match.authors[0] : ""
  );
  const candidateIsbn = cleanMatchIsbn(match && (match.isbn_13 || match.isbn_10));
  const extractedIsbn = cleanMatchIsbn(extracted && (extracted.isbn_13 || extracted.isbn_10));
  const publisherScore = compareWordOverlap(extracted && extracted.publisher, match && match.publisher);
  const contributorScore = compareListOverlap(extracted && extracted.contributors, match && match.contributors);
  const yearScore = compareYearCloseness(extracted && extracted.published_year, match && match.publishedDate);
  const reasons = [];

  if (candidateIsbn && extractedIsbn && candidateIsbn === extractedIsbn) reasons.push("ISBN agrees");
  if (titleScore >= 0.85) reasons.push("title aligns");
  else if (titleScore >= 0.45) reasons.push("title partly aligns");
  if (authorScore >= 0.8) reasons.push("author aligns");
  else if (authorScore >= 0.45) reasons.push("author partly aligns");
  if (publisherScore >= 0.7) reasons.push("publisher aligns");
  else if (publisherScore >= 0.4) reasons.push("publisher partly aligns");
  if (yearScore >= 1) reasons.push("year aligns");
  else if (yearScore >= 0.5) reasons.push("year is close");
  if (contributorScore >= 0.7) reasons.push("contributor aligns");
  else if (contributorScore >= 0.4) reasons.push("contributor partly aligns");
  if (!reasons.length && match && match.source) reasons.push(`${String(match.source).replace(/_/g, " ")} candidate`);

  const confidence = typeof match?.confidence === "number" ? match.confidence : 0;
  let tone = "uncertain";
  let badge = "Possible match";
  if ((candidateIsbn && extractedIsbn && candidateIsbn === extractedIsbn) || confidence >= 0.85 || (titleScore >= 0.85 && authorScore >= 0.8)) {
    tone = "strong";
    badge = "Strong match";
  } else if (confidence >= 0.55 || titleScore >= 0.65 || (titleScore >= 0.45 && authorScore >= 0.45)) {
    tone = "likely";
    badge = "Likely match";
  }

  return {
    tone,
    badge,
    detail: reasons.join("; ")
  };
}

function describeExtractedReview(extracted) {
  const visible = Array.isArray(extracted && extracted.source_visible)
    ? extracted.source_visible.filter(Boolean).slice(0, 2)
    : [];
  const confidence = typeof extracted?.confidence === "number" ? extracted.confidence : 0;
  const reasons = [];
  if (cleanMatchIsbn(extracted && (extracted.isbn_13 || extracted.isbn_10))) reasons.push("ISBN was readable");
  if (visible.length) reasons.push(`read from ${visible.join(" + ")}`);
  if (extracted && extracted.publisher) reasons.push("publisher was readable");
  if (extracted && extracted.published_year) reasons.push("year was readable");
  if (extracted && Array.isArray(extracted.contributors) && extracted.contributors.length) reasons.push("contributor credit was readable");
  if (!reasons.length && extracted && extracted.title) reasons.push("metadata was extracted from the photo");
  return {
    tone: confidence >= 0.65 ? "likely" : "neutral",
    badge: confidence >= 0.65 ? "Extracted clearly" : "Needs review",
    detail: reasons.join("; ")
  };
}

function describeBulkMatch(entry) {
  if (!entry || !entry.result) {
    return {
      tone: "uncertain",
      badge: "Needs manual review",
      detail: "No catalog match was confirmed"
    };
  }

  const result = entry.result;
  const titleScore = compareWordOverlap(entry.aiTitle, result.title);
  const authorScore = compareWordOverlap(entry.aiAuthor, result.author);
  const publisherScore = compareWordOverlap(entry && entry.extracted && entry.extracted.publisher, result.publisher);
  const contributorScore = compareListOverlap(entry && entry.extracted && entry.extracted.contributors, result.contributors);
  const yearScore = compareYearCloseness(entry && entry.extracted && entry.extracted.published_year, result.year);
  const reasons = [];
  if (result.isbn) reasons.push("catalog ISBN found");
  if (titleScore >= 0.85) reasons.push("title aligns");
  else if (titleScore >= 0.45) reasons.push("title partly aligns");
  if (authorScore >= 0.8) reasons.push("author aligns");
  else if (authorScore >= 0.45) reasons.push("author partly aligns");
  if (publisherScore >= 0.7) reasons.push("publisher aligns");
  if (yearScore >= 1) reasons.push("year aligns");
  else if (yearScore >= 0.5) reasons.push("year is close");
  if (contributorScore >= 0.7) reasons.push("contributor aligns");
  if (!reasons.length && result.source) reasons.push(`matched via ${result.source}`);

  const confidence = typeof result.confidence === "number" ? result.confidence : 0;
  let tone = "uncertain";
  let badge = "Possible match";
  if (confidence >= 0.85 || (titleScore >= 0.85 && (!entry.aiAuthor || authorScore >= 0.8)) || (result.isbn && titleScore >= 0.45)) {
    tone = "strong";
    badge = "Strong match";
  } else if (confidence >= 0.55 || titleScore >= 0.65 || (titleScore >= 0.45 && authorScore >= 0.45)) {
    tone = "likely";
    badge = "Likely match";
  }

  return {
    tone,
    badge,
    detail: reasons.join("; ")
  };
}

function describeCorrectionResult(input, result) {
  const titleScore = compareWordOverlap(input && input.aiTitle, result && result.title);
  const authorScore = compareWordOverlap(input && input.aiAuthor, result && result.author);
  const publisherScore = compareWordOverlap(input && input.publisher, result && result.publisher);
  const contributorScore = compareListOverlap(input && input.contributors, result && result.contributors);
  const yearScore = compareYearCloseness(input && input.year, result && result.year);
  const reasons = [];
  if (result && result.isbn) reasons.push("catalog ISBN found");
  if (titleScore >= 0.85) reasons.push("title aligns");
  else if (titleScore >= 0.45) reasons.push("title partly aligns");
  if (authorScore >= 0.8) reasons.push("author aligns");
  else if (authorScore >= 0.45) reasons.push("author partly aligns");
  if (publisherScore >= 0.7) reasons.push("publisher aligns");
  if (yearScore >= 1) reasons.push("year aligns");
  else if (yearScore >= 0.5) reasons.push("year is close");
  if (contributorScore >= 0.7) reasons.push("contributor aligns");
  if (!reasons.length && result && result.source) reasons.push(`matched via ${result.source}`);

  let tone = "uncertain";
  let badge = "Possible match";
  if ((result && result.isbn && titleScore >= 0.45) || (titleScore >= 0.85 && (!input?.aiAuthor || authorScore >= 0.8))) {
    tone = "strong";
    badge = "Strong match";
  } else if (titleScore >= 0.65 || (titleScore >= 0.45 && authorScore >= 0.45)) {
    tone = "likely";
    badge = "Likely match";
  }

  return { tone, badge, detail: reasons.join("; ") };
}

function renderExtractedMetadataBlock(extracted, options = {}) {
  if (!extracted || typeof extracted !== "object") return "";
  const lines = [];
  if (extracted.title) lines.push({ key: "Title", value: extracted.title });
  if (Array.isArray(extracted.authors) && extracted.authors.length) {
    lines.push({ key: "Author", value: extracted.authors.join(", ") });
  }
  if (extracted.publisher) lines.push({ key: "Publisher", value: extracted.publisher });
  if (extracted.published_year) lines.push({ key: "Year", value: extracted.published_year });
  if (extracted.edition) lines.push({ key: "Edition", value: extracted.edition });
  if (Array.isArray(extracted.contributors) && extracted.contributors.length) {
    lines.push({ key: "Contributor", value: extracted.contributors.join(", ") });
  }
  if (extracted.illustration_note) lines.push({ key: "Illustration Note", value: extracted.illustration_note });
  if (Array.isArray(extracted.source_visible) && extracted.source_visible.length) {
    lines.push({ key: "Seen On", value: extracted.source_visible.join(", ") });
  }
  if (!lines.length) return "";
  const compact = options.compact ? " compact" : "";
  const label = options.label || "Read from image";
  return `
    <div class="extracted-meta-block${compact}">
      <div class="extracted-meta-label">${esc(label)}</div>
      ${lines.map((line) => `<div class="extracted-meta-line"><span class="extracted-meta-key">${esc(line.key)}:</span> ${esc(line.value)}</div>`).join("")}
    </div>`;
}

function renderEnrichmentMetadataBlock(entry, displayBook, options = {}) {
  const enrichment = entry && entry.enrichment && typeof entry.enrichment === "object" ? entry.enrichment : null;
  if (!enrichment) return "";
  const extracted = entry && entry.extracted && typeof entry.extracted === "object" ? entry.extracted : {};
  const extractedTitle = ((extracted.title || "") + (extracted.subtitle ? `: ${extracted.subtitle}` : "")).trim();
  const extractedAuthor = Array.isArray(extracted.authors) ? extracted.authors.join(", ") : "";
  const extractedContributor = Array.isArray(extracted.contributors) ? extracted.contributors.join(", ") : "";
  const lines = [];
  if (displayBook && displayBook.title && normalizeCompareText(displayBook.title) !== normalizeCompareText(extractedTitle)) {
    lines.push({ key: "Title", value: displayBook.title });
  }
  if (displayBook && displayBook.author && normalizeCompareText(displayBook.author) !== normalizeCompareText(extractedAuthor)) {
    lines.push({ key: "Author", value: displayBook.author });
  }
  if (displayBook && displayBook.publisher && normalizeCompareText(displayBook.publisher) !== normalizeCompareText(extracted.publisher)) {
    lines.push({ key: "Publisher", value: displayBook.publisher });
  }
  if (displayBook && displayBook.year && cleanYearValue(displayBook.year) !== cleanYearValue(extracted.published_year)) {
    lines.push({ key: "Year", value: displayBook.year });
  }
  if (displayBook && displayBook.edition && normalizeCompareText(displayBook.edition) !== normalizeCompareText(extracted.edition)) {
    lines.push({ key: "Edition", value: displayBook.edition });
  }
  if (displayBook && displayBook.contributor && normalizeCompareText(displayBook.contributor) !== normalizeCompareText(extractedContributor)) {
    lines.push({ key: "Contributor", value: displayBook.contributor });
  }
  if (displayBook && displayBook.illustrationNote && normalizeCompareText(displayBook.illustrationNote) !== normalizeCompareText(extracted.illustration_note)) {
    lines.push({ key: "Illustration Note", value: displayBook.illustrationNote });
  }
  const confidenceNote = String(enrichment.confidence_note || "").trim();
  if (!lines.length && !confidenceNote) return "";
  const compact = options.compact ? " compact" : "";
  const label = options.label || "Perplexity enrichment";
  return `
    <div class="extracted-meta-block${compact}">
      <div class="extracted-meta-label">${esc(label)}</div>
      ${lines.map((line) => `<div class="extracted-meta-line"><span class="extracted-meta-key">${esc(line.key)}:</span> ${esc(line.value)}</div>`).join("")}
      ${confidenceNote ? `<div class="extracted-meta-line"><span class="extracted-meta-key">Note:</span> ${esc(confidenceNote)}</div>` : ""}
    </div>`;
}

function renderReviewCard(match) {
  const hasDatabaseCover = Boolean(match.coverUrl);
  const hasPhoto = Boolean(_photoObjectUrl);
  const showPicker = hasDatabaseCover && hasPhoto;
  const usingPhotoCover = _selectedCoverSource === "photo";
  const cue = describeReviewMatch(match, reviewData && reviewData.extracted);
  const exactIsbnAuthority = resultContainsExactIsbn(match, reviewData && reviewData.extracted && (reviewData.extracted.isbn_13 || reviewData.extracted.isbn_10));
  const modeCue = exactIsbnAuthority
    ? '<div class="review-source">ISBN confirmed â€” using catalog metadata</div>'
    : '<div class="review-source">Using image metadata â€” match is for comparison and cover choice</div>';

  let coverHtml = "";
  if (showPicker) {
    if (_selectedCoverSource !== "photo" && _selectedCoverSource !== "database") {
      _selectedCoverSource = "database";
    }
    const _dbUrl = escapeAttribute(match.coverUrl);
    const _phUrl = escapeAttribute(_photoObjectUrl);
    const _pe = `onpointerdown="coverThumbDown(event,this)" onpointerup="coverThumbUp(event,this)" onpointercancel="coverThumbCancel(event,this)" onpointermove="coverThumbMove(event,this)" oncontextmenu="return false"`;
    coverHtml = `
      <div class="cover-choice">
        <div class="cover-choice-thumb${usingPhotoCover ? "" : " selected"}" data-src="database" data-imgurl="${_dbUrl}" ${_pe}>
          <img src="${_dbUrl}" alt="Database cover" onerror="this.style.visibility='hidden'" draggable="false">
          <span>Database</span>
        </div>
        <div class="cover-choice-thumb${usingPhotoCover ? " selected" : ""}" data-src="photo" data-imgurl="${_phUrl}" ${_pe}>
          <img src="${_phUrl}" alt="My photo" draggable="false">
          <span>My Photo</span>
        </div>
      </div>
      <p class="cover-choice-hint">Tap to select &middot; Hold to preview</p>`;
  } else if (hasDatabaseCover) {
    _selectedCoverSource = "database";
    coverHtml = `<img src="${escapeAttribute(match.coverUrl)}" alt="Cover" class="review-cover" onclick="showCoverLightbox('${escapeAttribute(match.coverUrl)}')" style="cursor:zoom-in;" title="Click to enlarge">`;
  } else if (hasPhoto) {
    _selectedCoverSource = "photo";
    coverHtml = `
      <div>
        <img src="${escapeAttribute(_photoObjectUrl)}" alt="My photo" class="review-cover" onclick="showCoverLightbox('${escapeAttribute(_photoObjectUrl)}')" style="cursor:zoom-in;" title="Click to enlarge">
        <p class="cover-choice-hint">Using your uploaded photo as the cover</p>
      </div>`;
  }

  return `
    <div class="review-card-inner${showPicker ? " has-cover-picker" : ""}">
      ${coverHtml}
      <div class="review-card-body">
        <div class="review-title">${esc(match.title)}${match.subtitle ? ": " + esc(match.subtitle) : ""}</div>
        <div class="review-meta">${esc(match.authors.join(", "))}</div>
        <div class="review-meta">${[match.publisher, match.publishedDate].filter(Boolean).map(esc).join(" | ")}</div>
        ${Array.isArray(match.contributors) && match.contributors.length ? `<div class="review-meta">${esc(match.contributors.join(", "))}</div>` : ""}
        <div class="review-meta">ISBN: ${esc(match.isbn_13 || match.isbn_10 || "N/A")}</div>
        ${modeCue}
        <div class="review-source">Source: ${esc(match.source.replace(/_/g, " "))}</div>
        ${renderExtractedMetadataBlock(reviewData && reviewData.extracted)}
        <div class="match-reason-row">
          <span class="match-cue ${cue.tone}">${esc(cue.badge)}</span>
          <span class="match-reason-detail">${esc(cue.detail)}</span>
        </div>
      </div>
    </div>`;
}

function renderExtractedCard(extracted) {
  const cue = describeExtractedReview(extracted);
  return `
    <div class="review-card-inner">
      <div class="review-card-body">
        <div class="review-title">${esc(extracted.title || "Unknown Title")}${extracted.subtitle ? ": " + esc(extracted.subtitle) : ""}</div>
        <div class="review-meta">${esc((extracted.authors || []).join(", ") || "Unknown Author")}</div>
        ${extracted.publisher ? `<div class="review-meta">${esc(extracted.publisher)}</div>` : ""}
        ${extracted.published_year ? `<div class="review-meta">Year: ${esc(extracted.published_year)}</div>` : ""}
        ${Array.isArray(extracted.contributors) && extracted.contributors.length ? `<div class="review-meta">${esc(extracted.contributors.join(", "))}</div>` : ""}
        ${extracted.illustration_note ? `<div class="review-meta">${esc(extracted.illustration_note)}</div>` : ""}
        <div class="review-source">Extracted from photos (no database match)</div>
        ${renderExtractedMetadataBlock(extracted)}
        <div class="match-reason-row">
          <span class="match-cue ${cue.tone}">${esc(cue.badge)}</span>
          <span class="match-reason-detail">${esc(cue.detail)}</span>
        </div>
      </div>
    </div>`;
}

function selectCandidate(index) {
  if (!reviewData || !reviewData.candidates[index]) return;
  // Swap the chosen candidate into position 0 so the previous top pick
  // stays visible in the "Other matches" list and can be re-selected.
  const tmp = reviewData.candidates[0];
  reviewData.candidates[0] = reviewData.candidates[index];
  reviewData.candidates[index] = tmp;
  reviewData.bestMatch = reviewData.candidates[0];
  showReviewSection(reviewData);
}

function selectCoverSource(src) {
  _selectedCoverSource = src;
  _coverSourceTouched = true;
  document.querySelectorAll(".cover-choice-thumb").forEach(el => {
    el.classList.toggle("selected", el.dataset.src === src);
  });
}

function renderManualCoverPreview(databaseCoverUrl = "") {
  const containers = ["coverPreview", "manualCoverPreview"]
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  if (!containers.length) return;
  const dbUrl = String(databaseCoverUrl || "").trim();
  const photoUrl = String(_photoObjectUrl || "").trim();
  const hasDatabaseCover = Boolean(dbUrl);
  const hasPhoto = Boolean(photoUrl);
  const setHtml = function(html) {
    containers.forEach((container) => {
      container.innerHTML = html;
    });
  };

  if (hasDatabaseCover && hasPhoto) {
    if (_selectedCoverSource !== "photo" && _selectedCoverSource !== "database") {
      _selectedCoverSource = "database";
    }
    const escapedDbUrl = escapeAttribute(dbUrl);
    const escapedPhotoUrl = escapeAttribute(photoUrl);
    const pickerEvents = `onpointerdown="coverThumbDown(event,this)" onpointerup="coverThumbUp(event,this)" onpointercancel="coverThumbCancel(event,this)" onpointermove="coverThumbMove(event,this)" oncontextmenu="return false"`;
    setHtml(`
      <div class="cover-choice">
        <div class="cover-choice-thumb${_selectedCoverSource !== "photo" ? " selected" : ""}" data-src="database" data-imgurl="${escapedDbUrl}" ${pickerEvents}>
          <img src="${escapedDbUrl}" alt="Database cover" onerror="this.style.visibility='hidden'" draggable="false">
          <span>Database</span>
        </div>
        <div class="cover-choice-thumb${_selectedCoverSource === "photo" ? " selected" : ""}" data-src="photo" data-imgurl="${escapedPhotoUrl}" ${pickerEvents}>
          <img src="${escapedPhotoUrl}" alt="My photo" draggable="false">
          <span>My Photo</span>
        </div>
      </div>
      <p class="cover-choice-hint">Tap to choose Â· Hold to preview</p>`);
    return;
  }

  if (hasDatabaseCover) {
    _selectedCoverSource = "database";
    setHtml(`<img src="${escapeAttribute(dbUrl)}" alt="Book cover option" onclick="showCoverLightbox('${escapeAttribute(dbUrl)}')" style="cursor:zoom-in;" title="Click to enlarge">`);
    return;
  }

  if (hasPhoto) {
    _selectedCoverSource = "photo";
    setHtml(`<img src="${escapeAttribute(photoUrl)}" alt="Uploaded book photo" onclick="showCoverLightbox('${escapeAttribute(photoUrl)}')" style="cursor:zoom-in;" title="Click to enlarge">`);
    return;
  }

  setHtml("");
}

// Long-press handlers for cover choice thumbnails.
// Short tap  (< COVER_LONG_PRESS_MS) â†’ select that cover.
// Long press (â‰¥ COVER_LONG_PRESS_MS) â†’ open lightbox for full-size preview.
function coverThumbDown(e, el) {
  e.preventDefault(); // suppress ghost click and iOS image save sheet
  _coverThumbFired  = false;
  _coverThumbStartX = e.clientX;
  _coverThumbStartY = e.clientY;
  el.setPointerCapture(e.pointerId); // route move/up/cancel to this element
  _coverThumbTimer = setTimeout(() => {
    _coverThumbFired = true;
    const url = el.dataset.imgurl;
    if (url) showCoverLightbox(url);
  }, COVER_LONG_PRESS_MS);
}
function coverThumbMove(e, el) {
  if (!_coverThumbTimer) return;
  const dx = e.clientX - _coverThumbStartX;
  const dy = e.clientY - _coverThumbStartY;
  if (Math.sqrt(dx * dx + dy * dy) > 10) {
    // Finger moved â€” treat as scroll gesture, cancel the press
    clearTimeout(_coverThumbTimer);
    _coverThumbTimer = null;
  }
}
function coverThumbUp(e, el) {
  if (_coverThumbTimer) { clearTimeout(_coverThumbTimer); _coverThumbTimer = null; }
  if (!_coverThumbFired) selectCoverSource(el.dataset.src); // short tap
  _coverThumbFired = false;
}
function coverThumbCancel(e, el) {
  clearTimeout(_coverThumbTimer);
  _coverThumbTimer = null;
  _coverThumbFired = false;
}

function selectBulkCoverSource(index, src) {
  if (!bulkFoundBooks[index]) return;
  bulkFoundBooks[index].coverSource = src;
  renderBulkResults();
}

function bulkCoverThumbDown(e, el) {
  e.preventDefault();
  _coverThumbFired = false;
  _coverThumbStartX = e.clientX;
  _coverThumbStartY = e.clientY;
  el.setPointerCapture(e.pointerId);
  _coverThumbTimer = setTimeout(() => {
    _coverThumbFired = true;
    const url = el.dataset.imgurl;
    if (url) showCoverLightbox(url);
  }, COVER_LONG_PRESS_MS);
}

function bulkCoverThumbMove(e, el) {
  if (!_coverThumbTimer) return;
  const dx = e.clientX - _coverThumbStartX;
  const dy = e.clientY - _coverThumbStartY;
  if (Math.sqrt(dx * dx + dy * dy) > 10) {
    clearTimeout(_coverThumbTimer);
    _coverThumbTimer = null;
  }
}

function bulkCoverThumbUp(e, el) {
  if (_coverThumbTimer) { clearTimeout(_coverThumbTimer); _coverThumbTimer = null; }
  if (!_coverThumbFired) selectBulkCoverSource(Number(el.dataset.index), el.dataset.src);
  _coverThumbFired = false;
}

function bulkCoverThumbCancel(e, el) {
  clearTimeout(_coverThumbTimer);
  _coverThumbTimer = null;
  _coverThumbFired = false;
}

async function acceptReviewMatch() {
  const match = reviewData && reviewData.bestMatch;
  const extracted = reviewData && reviewData.extracted;
  const source = match || extracted;
  if (!source) return;
  const selectedPhotoUrl = String(_photoObjectUrl || "").trim();
  const specificEdition = isSpecificEditionModeEnabled();
  const extractedHasIsbn = extractedHasValidIsbn(extracted);
  const exactIsbnAuthority = match ? resultContainsExactIsbn(match, extracted && (extracted.isbn_13 || extracted.isbn_10)) : false;
  const extractedTitle = extracted
    ? ((extracted.title || "") + (extracted.subtitle ? ": " + extracted.subtitle : "")).trim()
    : "";
  const extractedAuthor = extracted && Array.isArray(extracted.authors) ? extracted.authors.join(", ") : "";
  const extractedPublisher = extracted && extracted.publisher ? extracted.publisher : "";
  const extractedYear = extracted && extracted.published_year ? extracted.published_year : "";
  const extractedEdition = extracted && extracted.edition ? extracted.edition : "";
  const extractedContributor = extracted && Array.isArray(extracted.contributors) ? (extracted.contributors[0] || "") : "";
  const extractedIllustrationNote = extracted && extracted.illustration_note ? extracted.illustration_note : "";

  if (!specificEdition) {
    pendingBook = exactIsbnAuthority
      ? buildAuthoritativePhotoBook(match, extracted)
      : buildWorkLevelPhotoBook(match, extracted, false);
  } else if (match) {
    if (exactIsbnAuthority) {
      pendingBook = buildAuthoritativePhotoBook(match, extracted);
    } else {
      pendingBook = {
        isbn: cleanMatchIsbn(extracted && (extracted.isbn_13 || extracted.isbn_10)) || "",
        title: extractedTitle || "",
        author: extractedAuthor || "",
        publisher: extractedPublisher || "",
        year: extractedYear || "",
        subjects: "",
        edition: extractedEdition || "",
        contributor: extractedContributor || "",
        illustrationNote: extractedIllustrationNote,
        coverUrl: match.coverUrl || "",
        source: "Photo Lookup"
      };
    }
  } else {
    pendingBook = {
      isbn: cleanMatchIsbn(extracted && (extracted.isbn_13 || extracted.isbn_10)) || "",
      title: extractedTitle,
      author: extractedAuthor,
      publisher: extractedPublisher,
      year: extractedYear,
      subjects: "",
      edition: extractedEdition,
      contributor: extractedContributor,
      illustrationNote: extractedIllustrationNote,
      coverUrl: "",
      source: exactIsbnAuthority ? "Photo Lookup (ISBN)" : "Photo Lookup"
    };
  }
  pendingEditionLookupContext = {
    mode: specificEdition ? (exactIsbnAuthority ? "photo-isbn" : "photo-non-isbn") : "photo-work",
    book: {
      title: pendingBook.title || "",
      author: pendingBook.author || "",
      publisher: pendingBook.publisher || "",
      year: pendingBook.year || "",
      edition: pendingBook.edition || "",
      contributor: pendingBook.contributor || "",
      illustrationNote: pendingBook.illustrationNote || ""
    },
    extractedHasIsbn: extractedHasIsbn,
    exactIsbnAuthority,
    extracted: extracted || null,
    candidate: match ? {
      title: match.title || "",
      author: Array.isArray(match.authors) ? match.authors.join(", ") : "",
      publisher: specificEdition ? (match.publisher || "") : "",
      year: cleanYearValue(match.publishedDate) || "",
      edition: "",
      contributor: specificEdition && Array.isArray(match.contributors) ? (match.contributors[0] || "") : "",
      source: match.source === "google_books" ? "Google Books" : "Open Library"
    } : null,
    enrichment: {}
  };

  // Capture photo file reference before dismissReview() clears photoFiles.
  // Use photo if: user explicitly chose it, or no database cover exists.
  const usePhoto = _selectedCoverSource === "photo" && photoFiles.length > 0;
  if (usePhoto) pendingBook.coverUrl = ""; // override database cover with user's photo
  const photoForCover = (usePhoto || !pendingBook.coverUrl) ? getSelectedPhotoFile() : null;

  // Also fill manual tab fields so the user can switch tabs if needed
  document.getElementById("manTitle").value = pendingBook.title;
  document.getElementById("manAuthor").value = pendingBook.author;
  document.getElementById("manPublisher").value = pendingBook.publisher;
  document.getElementById("manYear").value = pendingBook.year;
  document.getElementById("manEdition").value = pendingBook.edition;
  document.getElementById("manContributor").value = pendingBook.contributor || "";
  document.getElementById("manSubjects").value = pendingBook.subjects;
  updateFillEditionButton();

  // Update ISBN field and cover preview
  document.getElementById("isbnInput").value = pendingBook.isbn;
  if (pendingBook.coverUrl) {
    document.getElementById("coverPreview").innerHTML =
      `<img src="${escapeAttribute(pendingBook.coverUrl)}" alt="Book cover" onclick="showCoverLightbox('${escapeAttribute(pendingBook.coverUrl)}')" style="cursor:zoom-in;" title="Click to enlarge">`;
  } else if (usePhoto && selectedPhotoUrl) {
    document.getElementById("coverPreview").innerHTML =
      `<img src="${escapeAttribute(selectedPhotoUrl)}" alt="Uploaded book photo" onclick="showCoverLightbox('${escapeAttribute(selectedPhotoUrl)}')" style="cursor:zoom-in;" title="Click to enlarge">`;
  }

  showLookupResult();
  dismissReview(true);

  // Compress the photo in the background for use as cover if none was found
  if (photoForCover) {
    pendingCoverBlob = null;
    pendingCoverBlobPromise = null;
    try {
      pendingCoverBlobPromise = compressImageForCover(photoForCover);
      pendingCoverBlob = await pendingCoverBlobPromise;
      setStatus("lookupStatus",
        `Found: "${pendingBook.title}"${pendingBook.author ? " by " + pendingBook.author : ""} (${pendingBook.source}) â€” photo saved as cover`,
        "success");
    } catch (e) {
      console.warn("Photo compression failed:", e);
    } finally {
      pendingCoverBlobPromise = null;
    }
  }
}

function dismissReview(preserveEditionContext = false) {
  document.getElementById("reviewSection").style.display = "none";
  reviewData = null;
  if (!preserveEditionContext) pendingEditionLookupContext = null;
  photoFiles = [];
  photoFileSourceMeta = [];
  _selectedPhotoCoverIndex = 0;
  document.getElementById("photoPreviewRow").innerHTML = "";
  setStatus("photoStatus", "", "");
  if (_photoObjectUrl) { URL.revokeObjectURL(_photoObjectUrl); _photoObjectUrl = null; }
  _selectedCoverSource = "database";
  _coverSourceTouched = false;
  updateSinglePhotoRefinementActions();
  updateFillEditionButton();
}


// â”€â”€ Cover image upload helpers â”€â”€

function compressImageForCover(file, maxPx = 900) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objUrl);
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w > maxPx || h > maxPx) {
        if (w > h) { h = Math.round(h * maxPx / w); w = maxPx; }
        else        { w = Math.round(w * maxPx / h); h = maxPx; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Image compression failed"));
      }, "image/jpeg", 0.78);
    };
    img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error("Image load failed")); };
    img.src = objUrl;
  });
}

async function uploadCoverToStorage(bookId, blob) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not signed in");
  const ref = storage.ref(`users/${uid}/covers/${bookId}.jpg`);
  await ref.put(blob, { contentType: "image/jpeg" });
  const url = await ref.getDownloadURL();
  const cacheBust = `v=${Date.now()}`;
  return url.includes("?") ? `${url}&${cacheBust}` : `${url}?${cacheBust}`;
}

async function uploadBookPhotoToStorage(bookId, photoId, blob) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not signed in");
  const storagePath = `users/${uid}/book-photos/${bookId}/${photoId}.jpg`;
  const ref = storage.ref(storagePath);
  await ref.put(blob, { contentType: "image/jpeg" });
  return {
    url: await ref.getDownloadURL(),
    storagePath
  };
}

async function saveSelectedLookupPhotosAsAdditional(bookId, files, coverIndex, photoCoverSelected) {
  const selectedFiles = Array.isArray(files) ? files.filter(Boolean) : [];
  if (!bookId || selectedFiles.length <= 1) return;
  const additionalFiles = selectedFiles.filter((file, index) => {
    if (photoCoverSelected) return index !== coverIndex;
    return true;
  });
  if (!additionalFiles.length) return;
  const existing = getBookPhotos(bookId);
  const uploads = [];
  for (const [index, file] of additionalFiles.entries()) {
    const blob = await compressImageForCover(file, 1400);
    const photoId = Math.random().toString(36).slice(2, 10);
    const uploaded = await uploadBookPhotoToStorage(bookId, photoId, blob);
    uploads.push({
      id: photoId,
      url: uploaded.url,
      storagePath: uploaded.storagePath,
      caption: "",
      type: "other",
      createdAt: new Date().toISOString(),
      sortOrder: existing.length + index
    });
  }
  await saveBookPhotos(bookId, existing.concat(uploads));
}

async function saveBookPhotos(bookId, photos) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  if (_booksOwnedByUid && user.uid !== _booksOwnedByUid) throw new Error("Wrong signed-in user");
  const sanitized = sanitizeBookPhotoList(photos);
  const ref = db.collection("users").doc(user.uid).collection("bookPhotos").doc(bookId);
  if (!sanitized.length) {
    await ref.delete().catch(function(error) {
      if (error && error.code !== "not-found") throw error;
    });
    delete bookPhotoCache[bookId];
    return;
  }
  await ref.set({ photos: sanitized, updatedAt: new Date().toISOString() });
  bookPhotoCache[bookId] = sanitized;
}

function startBookPhotoUpload(bookId) {
  _bookPhotoUploadBookId = bookId;
  document.getElementById("bookPhotoSourceModal").classList.add("open");
}

function closeBookPhotoSourceModal(event) {
  if (event && event.target !== document.getElementById("bookPhotoSourceModal")) return;
  document.getElementById("bookPhotoSourceModal").classList.remove("open");
}

function startBookPhotoCamera() {
  try { localStorage.setItem("_cameraActive", Date.now().toString()); } catch (e) {}
  closeBookPhotoSourceModal();
  const input = document.getElementById("bookPhotoCameraInput");
  if (!input) return;
  input.value = "";
  input.click();
}

function startBookPhotoGallery() {
  closeBookPhotoSourceModal();
  const input = document.getElementById("bookPhotoUploadInput");
  if (!input) return;
  input.value = "";
  input.click();
}

function toggleBookPhotoOtherInput() {
  const selected = document.querySelector('input[name="bookPhotoType"]:checked');
  const wrap = document.getElementById("bookPhotoOtherWrap");
  if (!wrap) return;
  wrap.style.display = selected && selected.value === "other" ? "" : "none";
}

function openBookPhotoMetaModal(initialValues, options = {}) {
  const defaults = initialValues && typeof initialValues === "object" ? initialValues : {};
  const knownTypes = new Set(["inscription", "signature", "title-page", "copyright-page", "illustration", "binding-spine", "condition", "other"]);
  const storedType = String(defaults.type || "other").trim() || "other";
  const selectedType = knownTypes.has(storedType) ? storedType : "other";
  const otherValue = selectedType === "other" && storedType !== "other" ? storedType : "";
  document.getElementById("bookPhotoMetaTitle").textContent = options.title || "Photo Details";
  document.getElementById("bookPhotoCaptionInput").value = String(defaults.caption || "");
  document.getElementById("bookPhotoOtherInput").value = otherValue;
  document.querySelectorAll('input[name="bookPhotoType"]').forEach(function(input) {
    input.checked = input.value === selectedType;
  });
  toggleBookPhotoOtherInput();
  document.getElementById("bookPhotoMetaModal").classList.add("open");
  return new Promise(function(resolve) {
    _bookPhotoMetaResolver = resolve;
  });
}

function closeBookPhotoMetaModal(event) {
  if (event && event.target !== document.getElementById("bookPhotoMetaModal")) return;
  const resolve = _bookPhotoMetaResolver;
  _bookPhotoMetaResolver = null;
  document.getElementById("bookPhotoMetaModal").classList.remove("open");
  if (typeof resolve === "function") {
    const selected = document.querySelector('input[name="bookPhotoType"]:checked');
    const otherInput = document.getElementById("bookPhotoOtherInput");
    const rawType = selected ? selected.value : "other";
    const otherValue = String(otherInput && otherInput.value || "").trim();
    resolve({
      caption: String(document.getElementById("bookPhotoCaptionInput").value || "").trim(),
      type: rawType === "other" ? (otherValue || "other") : rawType
    });
  }
}

function saveBookPhotoMetaModal() {
  closeBookPhotoMetaModal();
}

async function editBookPhotoMeta(bookId, photoId) {
  const photos = getBookPhotos(bookId);
  const photo = photos.find(function(entry) { return entry.id === photoId; });
  if (!photo) return;
  const result = await openBookPhotoMetaModal(photo, { title: "Edit Photo Details" });
  const next = photos.map(function(entry) {
    return entry.id === photoId ? { ...entry, caption: result.caption, type: result.type } : entry;
  });
  await saveBookPhotos(bookId, next);
  renderBriefingPanel();
}

async function handleBookPhotoUpload(input) {
  const files = Array.from(input.files || []).filter((file) => file && /^image\//.test(file.type || ""));
  try { localStorage.removeItem("_cameraActive"); } catch (e) {}
  input.value = "";
  const bookId = _bookPhotoUploadBookId;
  _bookPhotoUploadBookId = null;
  if (!files.length || !bookId) return;
  const book = findBook(bookId);
  if (!book) return;
  setResearchStatus("Uploading additional photos...", "");
  try {
    const existing = getBookPhotos(bookId);
    const uploads = [];
    for (const [index, file] of files.entries()) {
      const blob = await compressImageForCover(file, 1400);
      const photoId = Math.random().toString(36).slice(2, 10);
      const uploaded = await uploadBookPhotoToStorage(bookId, photoId, blob);
      const meta = await openBookPhotoMetaModal({ caption: "", type: "other" }, {
        title: files.length > 1 ? `Photo ${index + 1} of ${files.length}` : "Photo Details"
      });
      uploads.push({
        id: photoId,
        url: uploaded.url,
        storagePath: uploaded.storagePath,
        caption: meta.caption,
        type: meta.type,
        createdAt: new Date().toISOString(),
        sortOrder: existing.length + index
      });
    }
    await saveBookPhotos(bookId, existing.concat(uploads));
    if (selectedBookId !== bookId) {
      selectedBookId = bookId;
    }
    renderBriefingPanel();
    setMobileSection("briefing");
    setResearchStatus("", "");
  } catch (error) {
    console.error("[handleBookPhotoUpload] failed:", error);
    setResearchStatus("Additional photo upload failed: " + error.message, "error");
  }
}

async function removeBookPhoto(bookId, photoId) {
  if (!confirm("Remove this additional photo?")) return;
  const photos = getBookPhotos(bookId);
  const photo = photos.find(function(entry) { return entry.id === photoId; });
  if (!photo) return;
  try {
    if (photo.storagePath) {
      await storage.ref(photo.storagePath).delete().catch(function(error) {
        console.warn("[removeBookPhoto] storage delete failed:", error);
      });
    }
    const next = photos
      .filter(function(entry) { return entry.id !== photoId; })
      .map(function(entry, index) { return { ...entry, sortOrder: index }; });
    await saveBookPhotos(bookId, next);
    renderBriefingPanel();
  } catch (error) {
    setResearchStatus("Could not remove that photo.", "error");
  }
}

function pickCoverForBook(bookId) {
  _coverUploadBookId = bookId;
  document.getElementById("coverSourceStep1").style.display = "";
  document.getElementById("coverSourceStep2").style.display = "none";
  document.getElementById("coverSearchGrid").innerHTML = "";
  document.getElementById("coverSearchStatus").textContent = "";
  document.getElementById("coverSourceModal").classList.add("open");
}

function pickCoverFromFile() {
  document.getElementById("coverSourceModal").classList.remove("open");
  document.getElementById("coverUploadInput").click();
}

function pickCoverFromCamera() {
  try { localStorage.setItem("_cameraActive", Date.now().toString()); } catch (e) {}
  document.getElementById("coverSourceModal").classList.remove("open");
  document.getElementById("coverCameraInput").click();
}

function closeCoverSourceModal() {
  document.getElementById("coverSourceModal").classList.remove("open");
  _coverUploadBookId = null;
  _coverSearchResults = [];
  _coverSearchMode = "library";
}

function openGoogleImagesForCover() {
  const book = findBook(_coverUploadBookId);
  if (!book) return;
  const query = [book.title || "", book.author || "", "book cover"].filter(Boolean).join(" ");
  const url = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`;
  window.open(url, "_blank", "noopener,noreferrer");
  const statusEl = document.getElementById("coverSearchStatus");
  if (statusEl) {
    statusEl.textContent = "Google Images opened in a new tab. If you find a cover you want, take a screenshot and use Upload Photo.";
    statusEl.className = "lookup-status";
  }
}

async function searchCoverImages() {
  const book = findBook(_coverUploadBookId);
  if (!book) return;
  document.getElementById("coverSourceStep1").style.display = "none";
  document.getElementById("coverSourceStep2").style.display = "";
  const statusEl = document.getElementById("coverSearchStatus");
  const grid = document.getElementById("coverSearchGrid");
  const actionsEl = document.getElementById("coverSearchActions");
  _coverSearchMode = "library";
  statusEl.textContent = "Searching...";
  grid.innerHTML = "";
  if (actionsEl) actionsEl.style.display = "none";
  try {
    const [olResults, gbResults] = await Promise.all([
      searchOpenLibrary(book.title, book.author || "", false),
      searchGoogleBooks(book.title, book.author || "", false)
    ]);
    const merged = dedupeManualResults([...olResults, ...gbResults]);
    const withCovers = merged.filter((r) => r.coverUrl);
    _coverSearchResults = withCovers;
    statusEl.textContent = "";
    if (!withCovers.length) {
      statusEl.textContent = "No covers found. Try Upload Photo or open Google Images.";
      if (actionsEl) actionsEl.style.display = "";
      return;
    }
    if (actionsEl) actionsEl.style.display = "";
    grid.innerHTML = withCovers.map((r, index) => {
      const sourceLabel = esc(r.source || "Cover");
      const sourceTitle = escapeAttribute([r.title || "", r.sourcePageUrl || ""].filter(Boolean).join("\n"));
      return (
        `<div class="cover-search-item" onclick="showCoverSearchLightbox(${index})" title="${sourceTitle}">` +
        `<img src="${escapeAttribute(r.coverUrl)}" alt="${sourceLabel}" onerror="this.closest('.cover-search-item').style.display='none'">` +
        `<div class="search-result-meta" style="padding-top:6px;text-align:center;">${sourceLabel}</div>` +
        `</div>`
      );
    }).join("");
  } catch (err) {
    statusEl.textContent = "Search failed. Please try again.";
    statusEl.className = "lookup-status error";
  }
}

function showCoverSearchLightbox(index) {
  const result = _coverSearchResults[index];
  if (!result || !result.coverUrl) return;
  const btn = document.getElementById("coverLightboxSelectBtn");
  btn.style.display = "";
  btn.dataset.index = String(index);
  showCoverLightbox(result.coverUrl);
}

async function ingestRemoteCoverToStorage(bookId, sourceUrl) {
  const res = await fetch(sourceUrl, { credentials: "omit" });
  if (!res.ok) {
    throw new Error(`Image download failed (${res.status})`);
  }
  const blob = await res.blob();
  if (!blob || !String(blob.type || "").startsWith("image/")) {
    throw new Error("Selected result did not return an image file");
  }
  const coverBlob = await compressImageForCover(blob);
  return uploadCoverToStorage(bookId, coverBlob);
}

async function selectCoverFromLightbox() {
  const index = Number(document.getElementById("coverLightboxSelectBtn").dataset.index);
  const bookId = _coverUploadBookId;
  const result = Number.isFinite(index) ? _coverSearchResults[index] : null;
  closeCoverLightbox();
  closeCoverSourceModal();
  const book = findBook(bookId);
  if (!book || !result || !result.coverUrl) return;
  setResearchStatus("Applying coverâ€¦", "");
  try {
    const finalUrl = result.shouldIngest
      ? await ingestRemoteCoverToStorage(bookId, result.coverUrl)
      : result.coverUrl;
    book.coverUrl = finalUrl;
    await saveBooks();
    renderCatalog();
    renderBriefingPanel();
    setResearchStatus("", "");
  } catch (e) {
    setResearchStatus("Could not download that web image. Try another result or upload a photo.", "error");
  }
}

async function handleCoverUpload(input) {
  const file = input.files[0];
  input.value = "";
  if (!file || !_coverUploadBookId) return;
  const bookId = _coverUploadBookId;
  _coverUploadBookId = null;
  const book = findBook(bookId);
  if (!book) return;
  setResearchStatus("Uploading coverâ€¦", "");
  try {
    const blob = await compressImageForCover(file);
    const url = await uploadCoverToStorage(bookId, blob);
    book.coverUrl = url;
    await saveBooks();
    renderCatalog();
    renderBriefingPanel();
    setResearchStatus("", "");
  } catch (e) {
    setResearchStatus("Cover upload failed: " + e.message, "error");
  }
}
