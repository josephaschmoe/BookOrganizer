const token = (window.location.pathname.split("/share/")[1] || "").split("?")[0].trim();

window.addEventListener("DOMContentLoaded", async function() {
  refreshAboutCopy();
  if (!token) { showError("Invalid share link."); return; }
  restoreShareDetailExpanded();
  await loadSharedShelf();
});

// ── Load data ─────────────────────────────────────────────────────────────────
async function loadSharedShelf() {
  document.getElementById("appRoot").innerHTML = loadingHtml("Loading shelf\u2026");
  try {
    const fn = functions.httpsCallable("getSharedShelf");
    const result = await fn({ token });
    applySharedPayload(result.data || {});
  } catch (err) {
    if (err && err.code === "functions/failed-precondition") {
      try {
        const bookResult = await functions.httpsCallable("getSharedBook")({ token });
        applySharedPayload(bookResult.data || {});
        return;
      } catch (bookErr) {
        const isBookNotFound = bookErr.code === "functions/not-found";
        showError(isBookNotFound
          ? "This share link is no longer active."
          : "Could not load this shared book. Please try again later.");
        return;
      }
    }
    const isNotFound = err.code === "functions/not-found";
    showError(isNotFound
      ? "This share link is no longer active."
      : "Could not load this share. Please try again later.");
  }
}

function applySharedPayload(data) {
  sharedBooks = data.books || (data.book ? [data.book] : []);
  sharedCache = data.researchCache || {};
  sharedAudioCache = data.briefingAudioCache || {};
  sharedShareType = data.shareType === "book" ? "book" : "shelf";
  sharedShelfName = data.resourceName || data.shelfName || (sharedShareType === "book" ? "Shared Book" : "Shared Shelf");
  sharedAllowWikiAI = Boolean(data.allowWikiAI);
  sharedAllowBriefingAudio = Boolean(data.allowBriefingAudio);
  selectedBookId = data.selectedBookId || (sharedShareType === "book" && sharedBooks[0] ? sharedBooks[0].id : null);
  currentSort = sharedBooks.some(function(book) { return Number.isFinite(Number(book && book.customOrder)); })
    ? "custom"
    : "added";
  document.getElementById("headerShelfName").textContent = sharedShelfName;
  document.title = "TomeShelf \u2014 " + sharedShelfName;
  renderLayout();
}

function applyShareDetailExpanded() {
  const enabled = shareDetailExpanded && window.innerWidth > 900;
  document.body.classList.toggle("share-detail-expanded", enabled);
  const btn = document.getElementById("shareDetailToggle");
  if (btn) {
    btn.title = enabled ? "Shrink detail panel" : "Expand detail panel";
    btn.setAttribute("aria-label", enabled ? "Shrink detail panel" : "Expand detail panel");
  }
}

function setShareDetailExpanded(expanded) {
  shareDetailExpanded = Boolean(expanded);
  applyShareDetailExpanded();
  try { localStorage.setItem("tomeshelf-share-detail-expanded", shareDetailExpanded ? "1" : "0"); } catch (e) {}
}

function toggleShareDetailExpanded() {
  setShareDetailExpanded(!shareDetailExpanded);
}

function restoreShareDetailExpanded() {
  try {
    shareDetailExpanded = localStorage.getItem("tomeshelf-share-detail-expanded") === "1";
  } catch (e) {
    shareDetailExpanded = false;
  }
  applyShareDetailExpanded();
}

function loadingHtml(msg) {
  return '<div class="state-container"><div class="spinner"></div>' +
    '<div class="state-title">' + esc(msg) + '</div></div>';
}

function showError(msg) {
  document.getElementById("appRoot").innerHTML =
    '<div class="state-container">' +
    '<div class="state-icon">\uD83D\uDCDA</div>' +
    '<div class="state-title">' + esc(sharedShareType === "book" ? "Book Unavailable" : "Shelf Unavailable") + '</div>' +
    '<div class="state-body">' + esc(msg) + '</div>' +
    '</div>';
}

// ── Layout ────────────────────────────────────────────────────────────────────
function renderLayout() {
  if (sharedShareType === "book") {
    document.getElementById("appRoot").innerHTML =
      '<div class="share-layout" style="grid-template-columns:minmax(0,1fr);max-width:980px;">' +
        '<div class="panel share-detail-col detail-panel detail-visible" id="detailCol" style="position:static;">' +
          '<div class="panel-header">' +
            '<span>Book Details &amp; Discussion Guide</span>' +
            '<div class="nav-group">' +
              '<button class="panel-focus-toggle" id="shareDetailToggle" type="button" onclick="toggleShareDetailExpanded()" title="Expand detail panel" aria-label="Expand detail panel">&#8596;</button>' +
            '</div>' +
          '</div>' +
          '<div class="panel-body" id="detailBody"></div>' +
        '</div>' +
      '</div>';
    applyShareDetailExpanded();
    renderBookDetail();
    return;
  }
  document.getElementById("appRoot").innerHTML =
    '<div class="share-layout">' +
      '<div class="panel share-list-col" id="listCol">' +
        '<div class="panel-header">' +
          '<span id="listColTitle">' + esc(sharedShelfName) + '</span>' +
        '</div>' +
        '<div class="shelf-toolbar">' +
          '<input type="search" id="filterInput" placeholder="Search\u2026" oninput="applyFilter(this.value)">' +
          '<select id="sortSelect" onchange="applySort(this.value)">' +
            '<option value="added">Recently added</option>' +
            '<option value="custom">Custom order</option>' +
            '<option value="title">Title A\u2013Z</option>' +
            '<option value="author">Author A\u2013Z</option>' +
            '<option value="has-photos">Contains Addtl Photos</option>' +
            '<option value="year">Year</option>' +
            '<option value="rating">Rating</option>' +
          '</select>' +
          '<span class="book-count-label" id="countLabel"></span>' +
        '</div>' +
        '<div class="book-list" id="bookList"></div>' +
      '</div>' +
      '<div class="panel share-detail-col detail-panel" id="detailCol">' +
        '<div class="panel-header">' +
          '<button class="back-btn" onclick="goBackToList()" title="Back">&#8592;</button>' +
          '<span>Book Details &amp; Discussion Guide</span>' +
          '<div class="nav-group">' +
            '<button class="panel-focus-toggle" id="shareDetailToggle" type="button" onclick="toggleShareDetailExpanded()" title="Expand detail panel" aria-label="Expand detail panel">&#8596;</button>' +
            '<button class="nav-btn" id="prevBookBtn" onclick="navigateBook(-1)" title="Previous book" disabled>&#8592;</button>' +
            '<button class="nav-btn" id="nextBookBtn" onclick="navigateBook(1)"  title="Next book"     disabled>&#8594;</button>' +
          '</div>' +
        '</div>' +
        '<div class="panel-body" id="detailBody">' +
          '<div class="briefing-empty"><p>Choose a book to view its details and discussion guide.</p></div>' +
        '</div>' +
      '</div>' +
    '</div>';

  applyShareDetailExpanded();
  const sortSelect = document.getElementById("sortSelect");
  if (sortSelect) sortSelect.value = currentSort;
  renderBookList();
  if (selectedBookId) renderBookDetail();
  _attachDetailSwipe();
}

// ── Book list ─────────────────────────────────────────────────────────────────
function filteredSortedBooks() {
  let list = sharedBooks.slice();

  if (currentFilter) {
    const q = currentFilter.toLowerCase();
    list = list.filter(function(b) {
      return (b.title || "").toLowerCase().includes(q) ||
             (b.author || "").toLowerCase().includes(q) ||
             (b.subjects || "").toLowerCase().includes(q);
    });
  }

  if (currentSort === "has-photos") {
    list = list.filter(function(book) {
      return Array.isArray(book && book.additionalPhotos) && book.additionalPhotos.length > 0;
    });
  }

  list.sort(compareSharedBooksBySort);
  return list;
}

function compareSharedBooksBySort(a, b) {
  if (currentSort === "has-photos") return (a.title || "").localeCompare(b.title || "");
  if (currentSort === "author") {
    const aKey = String(a.authorSort || "").trim() || buildSharedAuthorSortKey(a.author || "");
    const bKey = String(b.authorSort || "").trim() || buildSharedAuthorSortKey(b.author || "");
    const authorDiff = aKey.localeCompare(bKey);
    if (authorDiff !== 0) return authorDiff;
    return (a.title || "").localeCompare(b.title || "");
  }
  if (currentSort === "year")   return (parseInt(b.year) || 0) - (parseInt(a.year) || 0);
  if (currentSort === "rating") return (Number(b.rating) || 0) - (Number(a.rating) || 0);
  if (currentSort === "title")  return (a.title || "").localeCompare(b.title || "");
  if (currentSort === "custom") {
    const aHas = Number.isFinite(Number(a && a.customOrder));
    const bHas = Number.isFinite(Number(b && b.customOrder));
    if (aHas && bHas) {
      const diff = Number(a.customOrder) - Number(b.customOrder);
      if (diff !== 0) return diff;
    } else if (aHas !== bHas) {
      return aHas ? -1 : 1;
    }
  }
  return Number(b.addedAt || 0) - Number(a.addedAt || 0);
}

function loadSharedBookPhotoSectionState(bookId) {
  if (Object.prototype.hasOwnProperty.call(sharedBookPhotoSectionCollapsed, bookId)) {
    return Boolean(sharedBookPhotoSectionCollapsed[bookId]);
  }
  var collapsed = true;
  try {
    var raw = localStorage.getItem("tomeshelf-shared-book-photo-collapsed");
    var parsed = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object" && Object.prototype.hasOwnProperty.call(parsed, bookId)) {
      collapsed = Boolean(parsed[bookId]);
      sharedBookPhotoSectionCollapsed[bookId] = collapsed;
    }
  } catch (e) {}
  return collapsed;
}

function saveSharedBookPhotoSectionState() {
  try {
    localStorage.setItem("tomeshelf-shared-book-photo-collapsed", JSON.stringify(sharedBookPhotoSectionCollapsed));
  } catch (e) {}
}

function loadSharedHasPhotosModeSectionState() {
  try {
    sharedHasPhotosModeSectionCollapsed = localStorage.getItem("tomeshelf-shared-has-photos-collapsed") === "1";
  } catch (e) {
    sharedHasPhotosModeSectionCollapsed = false;
  }
  return sharedHasPhotosModeSectionCollapsed;
}

function saveSharedHasPhotosModeSectionState() {
  try {
    localStorage.setItem("tomeshelf-shared-has-photos-collapsed", sharedHasPhotosModeSectionCollapsed ? "1" : "0");
  } catch (e) {}
}

function toggleSharedBookPhotoSection(bookId) {
  if (currentSort === "has-photos") {
    sharedHasPhotosModeSectionCollapsed = !loadSharedHasPhotosModeSectionState();
    saveSharedHasPhotosModeSectionState();
    renderBookDetail();
    return;
  }
  sharedBookPhotoSectionCollapsed[bookId] = !loadSharedBookPhotoSectionState(bookId);
  saveSharedBookPhotoSectionState();
  renderBookDetail();
}

function openSharedBookPhotoLightbox(index) {
  var book = sharedBooks.find(function(entry) { return entry.id === selectedBookId; });
  if (!book) return;
  var photos = Array.isArray(book.additionalPhotos) ? book.additionalPhotos : [];
  var galleryUrls = photos.map(function(photo) { return photo && photo.url ? photo.url : ""; }).filter(Boolean);
  var active = photos[index] && photos[index].url ? photos[index].url : (galleryUrls[0] || "");
  if (!active) return;
  showCoverLightbox(active, galleryUrls, index);
}

function renderBookList() {
  const list = filteredSortedBooks();
  const countEl = document.getElementById("countLabel");
  if (countEl) countEl.textContent = list.length + " book" + (list.length === 1 ? "" : "s");

  const container = document.getElementById("bookList");
  if (!container) return;

  if (!list.length) {
    container.innerHTML = '<div class="empty-state"><p>' +
      (currentFilter ? "No books match your search." : "No books on this shelf.") +
      '</p></div>';
    return;
  }

  container.innerHTML = list.map(function(book) {
    const isSelected = book.id === selectedBookId;
    const rating = Number(book.rating || 0);
    const stars = rating ? "&#9733;".repeat(rating) + "&#9734;".repeat(5 - rating) : "";
    const condClass = book.condition ? "cond-" + book.condition.toLowerCase() : "";
    const statusClass = book.readingStatus
      ? "status-" + book.readingStatus.toLowerCase().replace(/[^a-z0-9]+/g, "-") : "";
    const thumb = book.coverUrl
      ? '<img src="' + escapeAttribute(book.coverUrl) + '" alt="" onerror="this.parentElement.innerHTML=bookIconSVG()">'
      : bookIconSVG();

    return '<div class="book-card' + (isSelected ? " selected" : "") + '" ' +
      'data-book-id="' + escapeAttribute(book.id) + '" ' +
      'onclick="selectBook(\'' + escapeAttribute(book.id) + '\')">' +
      '<div class="book-cover-thumb">' + thumb + '</div>' +
      '<div class="book-info">' +
        '<div class="book-title">' + esc(book.title) + '</div>' +
        (book.author ? '<div class="book-author">' + esc(book.author) + '</div>' : '') +
        '<div class="book-meta">' +
          (book.year ? '<span>' + esc(book.year) + '</span>' : '') +
          (book.condition ? '<span class="condition-badge ' + condClass + '">' + esc(book.condition) + '</span>' : '') +
          (book.readingStatus ? '<span class="condition-badge ' + statusClass + '">' + esc(book.readingStatus) + '</span>' : '') +
        '</div>' +
        (rating ? '<div class="rating-display">' + stars + '</div>' : '') +
      '</div>' +
    '</div>';
  }).join("");
}

function applyFilter(q) {
  currentFilter = q.trim();
  renderBookList();
}

function applySort(val) {
  currentSort = val;
  renderBookList();
  renderBookDetail();
}

// ── Book selection ────────────────────────────────────────────────────────────
function selectBook(id) {
  selectedBookId = id;
  showSpoilers = false;

  // Mobile: show detail col, hide list col
  const listCol   = document.getElementById("listCol");
  const detailCol = document.getElementById("detailCol");
  if (window.innerWidth <= 900) {
    listCol.classList.add("detail-visible");
    detailCol.classList.add("detail-visible");
  }

  renderBookList();
  renderBookDetail();
}

function goBackToList() {
  const listCol   = document.getElementById("listCol");
  const detailCol = document.getElementById("detailCol");
  listCol.classList.remove("detail-visible");
  detailCol.classList.remove("detail-visible");
  const lastId = selectedBookId;
  selectedBookId = null;
  renderBookList();
  if (lastId) {
    requestAnimationFrame(function() {
      const card = document.querySelector('.book-card[data-book-id="' + lastId + '"]');
      if (card) card.scrollIntoView({ block: "center", behavior: "instant" });
    });
  }
}

function sharedAudioVariant(bookId, spoilerMode) {
  const audioDoc = sharedAudioCache[bookId];
  const variants = audioDoc && typeof audioDoc.variants === "object" ? audioDoc.variants : {};
  const variant = variants[spoilerMode];
  return variant && typeof variant === "object" ? variant : null;
}

function sharedAudioKey(bookId, spoilerMode) {
  return bookId + ":" + spoilerMode;
}

function clearSharedAudioUrlState(bookId, spoilerMode) {
  const key = sharedAudioKey(bookId, spoilerMode);
  delete sharedAudioUrls[key];
  delete sharedAudioLoading[key];
  delete sharedAudioUrlErrors[key];
}

function retrySharedAudioUrl(bookId, spoilerMode) {
  clearSharedAudioUrlState(bookId, spoilerMode);
  ensureSharedAudioUrl(bookId, spoilerMode);
  if (selectedBookId === bookId) renderBookDetail();
}

async function ensureSharedAudioUrl(bookId, spoilerMode) {
  const key = sharedAudioKey(bookId, spoilerMode);
  if (sharedAudioUrls[key]) return sharedAudioUrls[key];
  if (sharedAudioLoading[key]) return "";
  sharedAudioLoading[key] = true;
  delete sharedAudioUrlErrors[key];
  try {
    const fn = functions.httpsCallable("getSharedBriefingAudio");
    const result = await fn({ token, bookId, spoilerMode });
    const audioUrl = result.data && result.data.audioUrl ? result.data.audioUrl : "";
    if (audioUrl) sharedAudioUrls[key] = audioUrl;
    else sharedAudioUrlErrors[key] = "Audio player URL was not returned.";
    if (selectedBookId === bookId) renderBookDetail();
    return audioUrl;
  } catch (err) {
    console.error("[ensureSharedAudioUrl]", err);
    sharedAudioUrlErrors[key] = err && (err.message || err.code) ? String(err.message || err.code) : "Audio player could not be loaded.";
    if (selectedBookId === bookId) renderBookDetail();
    return "";
  } finally {
    delete sharedAudioLoading[key];
  }
}

// ── Book detail ───────────────────────────────────────────────────────────────
function renderBookDetail() {
  const detailBody = document.getElementById("detailBody");
  if (!detailBody) return;
  const book = sharedBooks.find(function(b) { return b.id === selectedBookId; });
  if (!book) {
    detailBody.innerHTML = '<div class="briefing-empty"><p>Choose a book to view its details and discussion guide.</p></div>';
    return;
  }

  const rating = Number(book.rating || 0);
  const stars = rating ? "&#9733;".repeat(rating) + "&#9734;".repeat(5 - rating) : "";
  const condClass = book.condition ? "cond-" + book.condition.toLowerCase() : "";
  const statusClass = book.readingStatus
    ? "status-" + book.readingStatus.toLowerCase().replace(/[^a-z0-9]+/g, "-") : "";
  const readingDates = [
    book.startDate  ? "Started " + book.startDate  : "",
    book.finishDate ? "Finished " + book.finishDate : ""
  ].filter(Boolean);

  const coverHtml = book.coverUrl
    ? '<img src="' + escapeAttribute(book.coverUrl) + '" alt="" ' +
        'onerror="this.parentElement.innerHTML=bookIconSVG()" ' +
        'onclick="showCoverLightbox(\'' + escapeAttribute(book.coverUrl) + '\')" ' +
        'style="cursor:zoom-in;" title="Click to enlarge">'
    : bookIconSVG();
  const photoSectionHtml = renderSharedBookPhotoSection(Array.isArray(book.additionalPhotos) ? book.additionalPhotos : []);

  // ── Book detail header ──
  let headerHtml =
    '<div class="book-detail-header">' +
      '<div class="book-detail-cover">' + coverHtml + '</div>' +
      '<div class="book-detail-info">' +
        '<div class="book-detail-title">' + esc(book.title) + '</div>' +
        (book.author ? '<div class="book-detail-author">' + esc(book.author) + '</div>' : '') +
        '<div class="book-detail-meta">' +
          (book.year      ? '<span>Year ' + esc(book.year)      + '</span>' : '') +
          (book.publisher ? '<span>'       + esc(book.publisher) + '</span>' : '') +
          (book.isbn      ? '<span>ISBN '  + esc(book.isbn)      + '</span>' : '') +
          (book.edition   ? '<span>'       + esc(book.edition)   + '</span>' : '') +
        '</div>' +
        '<div class="book-detail-meta">' +
          (book.condition    ? '<span class="condition-badge ' + condClass    + '">' + esc(book.condition)    + '</span>' : '') +
          (book.readingStatus ? '<span class="condition-badge ' + statusClass + '">' + esc(book.readingStatus) + '</span>' : '') +
        '</div>' +
        (readingDates.length ? '<div class="book-detail-meta">' + readingDates.map(function(d) { return '<span>' + esc(d) + '</span>'; }).join("") + '</div>' : '') +
        (rating ? '<div class="rating-display" style="margin-top:6px;" aria-label="' + rating + ' out of 5 stars">' + stars + ' ' + rating + '/5</div>' : '') +
        (book.subjects ? '<div class="book-detail-meta">Subjects: ' + esc(book.subjects) + '</div>' : '') +
        (book.notes        ? '<div class="book-detail-notes">' + esc(book.notes) + '</div>' : '') +
        (book.personalNotes ? '<div class="book-detail-personal-notes"><strong>Your notes:</strong> ' + esc(book.personalNotes) + '</div>' : '') +
      '</div>' +
    '</div>' +
    photoSectionHtml;

  // ── Action buttons ──
  const briefing  = sharedCache[book.id];
  const genre = briefing ? (briefing.genre || "").toLowerCase() : "";
  const isFiction = genre === "fiction";
  const isReference = genre === "reference";
  const spoilerToggleHtml = '';
  const spoilerMode = "safe";
  const audioVariant = sharedAllowBriefingAudio && briefing ? sharedAudioVariant(book.id, spoilerMode) : null;
  const audioKey = sharedAudioKey(book.id, spoilerMode);
  const audioUrl = sharedAudioUrls[audioKey] || "";
  const audioUrlError = sharedAudioUrlErrors[audioKey] || "";

  if (audioVariant && audioVariant.status === "ready" && !audioUrl) {
    ensureSharedAudioUrl(book.id, spoilerMode);
  }

  const actionsHtml =
    '<div class="book-detail-action-row">' +
      '<button class="btn btn-light btn-sm" type="button" onclick="lookupWikipedia()">Wikipedia</button>' +
      '<button class="btn btn-light btn-sm" type="button" onclick="searchReviewsShared()">Search Reviews</button>' +
      (audioVariant
        ? '<button class="btn btn-light btn-sm" type="button" onclick="ensureSharedAudioUrl(\'' + escapeAttribute(book.id) + '\', \'' + spoilerMode + '\')">' +
            (audioUrl ? 'Play Audio' : 'Listen') +
          '</button>'
        : '') +
      spoilerToggleHtml +
    '</div>';

  // ── Briefing content ──
  let briefingHtml;
  if (!briefing) {
    briefingHtml = '<div class="briefing-empty"><p>No discussion guide available for this book.</p></div>';
  } else {
    const s = false;
    const summaryText    = isFiction ? (s ? briefing.summary_spoiler   : briefing.summary_safe)   : (isReference ? briefing.editorial_approach : briefing.summary);
    const keyElems       = isFiction ? (s ? briefing.key_elements_spoiler : briefing.key_elements_safe) : (isReference ? briefing.contents_overview : briefing.key_elements);
    const craftText      = isFiction ? (s ? briefing.craft_analysis_spoiler : briefing.craft_analysis_safe) : (isReference ? briefing.production_notes : briefing.craft_analysis);
    const discussionList = isFiction ? (s ? briefing.discussion_questions_spoiler : briefing.discussion_questions_safe) : (isReference ? briefing.notable_features : briefing.discussion_questions);

    const takeawaysHtml = (!isFiction && !isReference && briefing.key_takeaways && briefing.key_takeaways.length)
      ? '<div class="briefing-section"><h3>Key Takeaways</h3>' + renderList(briefing.key_takeaways, "briefing-list") + '</div>' : "";
    const idealForHtml = (isReference && briefing.ideal_for)
      ? '<div class="briefing-section"><h3>Ideal For</h3><p>' + paragraphize(briefing.ideal_for) + '</p></div>' : "";
    const audioHtml = !audioVariant ? ""
      : '<div class="briefing-section"><h3>Audio Overview</h3>' +
          '<p>Voice: ' + esc(audioVariant.voice || "Kore") +
            (audioVariant.durationSec ? ' &middot; Approx. ' + Math.max(1, Math.round(audioVariant.durationSec / 60)) + ' min' : '') +
          '</p>' +
          (audioUrl
            ? '<audio controls preload="none" style="width:100%;margin-top:8px;"><source src="' + escapeAttribute(audioUrl) + '" type="audio/wav"></audio>'
            : audioUrlError
              ? '<p style="color:#b33;">' + esc(audioUrlError) + '</p>' +
                '<button class="btn btn-light btn-sm" type="button" onclick="retrySharedAudioUrl(\'' + escapeAttribute(book.id) + '\', \'' + spoilerMode + '\')">Retry Player</button>'
            : '<p>Loading audio player...</p>') +
        '</div>';

    briefingHtml =
      '<div class="briefing-scroll">' +
        audioHtml +
        '<div class="briefing-section"><h3>Quick Take</h3><p>' + esc(briefing.quick_take) + '</p></div>' +
        '<div class="briefing-section"><h3>' + (isFiction ? "Plot Summary" : (isReference ? "Editorial Approach" : "Overview")) + '</h3><p>' + paragraphize(summaryText) + '</p></div>' +
        '<div class="briefing-section"><h3>Major Themes</h3>' + renderList(briefing.major_themes, "briefing-list") + '</div>' +
        '<div class="briefing-section"><h3>' + (isFiction ? "Characters" : (isReference ? "Contents Overview" : "Key Concepts &amp; Figures")) + '</h3>' + renderList(keyElems, "briefing-list") + '</div>' +
        '<div class="briefing-section"><h3>Historical and Cultural Context</h3><p>' + paragraphize(briefing.historical_context) + '</p></div>' +
        '<div class="briefing-section"><h3>' + (isFiction ? "Literary Analysis" : (isReference ? "Production Notes" : "Analysis &amp; Methodology")) + '</h3><p>' + paragraphize(craftText) + '</p></div>' +
        takeawaysHtml +
        idealForHtml +
        '<div class="briefing-section"><h3>Impact</h3><p>' + paragraphize(briefing.impact) + '</p></div>' +
        '<div class="briefing-section"><h3>' + (isReference ? "Notable Features" : "Discussion Questions") + '</h3>' + renderList(discussionList, "questions-list") + '</div>' +
        '<div class="briefing-section"><h3>Confidence Note</h3><p>' + paragraphize(briefing.confidence_note) + '</p>' +
          '<div class="book-research-meta">' +
            '<span>Generated ' + esc((briefing.generated_at || "").slice(0, 10)) + '</span>' +
            '<span>' + esc(briefing.model || "") + '</span>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  detailBody.innerHTML = headerHtml + actionsHtml + briefingHtml;
  updateNavArrows();
}

function toggleSpoilers(checked) {
  showSpoilers = checked;
  renderBookDetail();
}

function formatSharedBookPhotoTypeLabel(value) {
  var type = String(value || "").trim();
  if (!type || type === "other") return "Other";
  return type.replace(/[-_]+/g, " ").replace(/\b\w/g, function(ch) { return ch.toUpperCase(); });
}

function renderSharedBookPhotoSection(photos) {
  if (!Array.isArray(photos) || !photos.length) {
    return '<div class="book-photo-section">' +
      '<div class="book-photo-section-header"><div class="book-photo-section-header-main"><div class="book-photo-section-title">Additional Photos</div></div></div>' +
      '<div class="book-photo-empty">No additional photos shared for this book.</div>' +
    '</div>';
  }
  var collapsed = currentSort === "has-photos"
    ? loadSharedHasPhotosModeSectionState()
    : loadSharedBookPhotoSectionState(selectedBookId || "");
  return '<div class="book-photo-section">' +
    '<div class="book-photo-section-header"><div class="book-photo-section-header-main"><div class="book-photo-section-title">Additional Photos</div><button class="btn btn-light btn-sm book-photo-toggle" type="button" onclick="toggleSharedBookPhotoSection(\'' + escapeAttribute(selectedBookId || "") + '\')">' + (collapsed ? 'Show' : 'Hide') + '</button></div></div>' +
    (collapsed ? '' : '<div class="book-photo-grid">' +
      photos.map(function(photo, index) {
        const type = esc(formatSharedBookPhotoTypeLabel((photo && photo.type) || "other"));
        const caption = photo && photo.caption ? '<div class="book-photo-card-caption">' + esc(photo.caption) + '</div>' : '';
        const altText = photo && photo.caption ? esc(photo.caption) : type;
        return '<div class="book-photo-card" onclick="openSharedBookPhotoLightbox(' + index + ')" title="Click to enlarge">' +
          '<img src="' + escapeAttribute((photo && photo.url) || "") + '" alt="' + altText + '" onerror="this.closest(\'.book-photo-card\').style.display=\'none\'">' +
          '<div class="book-photo-card-meta">' +
            '<div class="book-photo-card-type">' + type + '</div>' +
            caption +
          '</div>' +
        '</div>';
      }).join("") +
    '</div>') +
  '</div>';
}

// ── Book navigation ───────────────────────────────────────────────────────────
function navigateBook(delta) {
  if (!selectedBookId) return;
  const list = filteredSortedBooks();
  const idx  = list.findIndex(function(b) { return b.id === selectedBookId; });
  if (idx === -1) return;
  const newIdx = idx + delta;
  if (newIdx < 0 || newIdx >= list.length) return;
  selectedBookId = list[newIdx].id;
  showSpoilers = false;
  renderBookList();
  renderBookDetail();
  updateNavArrows();
}

function updateNavArrows() {
  const prev = document.getElementById("prevBookBtn");
  const next = document.getElementById("nextBookBtn");
  if (!prev || !next) return;
  const list = filteredSortedBooks();
  const idx  = list.findIndex(function(b) { return b.id === selectedBookId; });
  prev.disabled = idx <= 0;
  next.disabled = idx === -1 || idx >= list.length - 1;
}

function _attachDetailSwipe() {
  var sx = 0, sy = 0;
  var panel = document.getElementById("detailCol");
  if (!panel) return;
  panel.addEventListener("touchstart", function(e) {
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
  }, { passive: true });
  panel.addEventListener("touchend", function(e) {
    var dx = e.changedTouches[0].clientX - sx;
    var dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > Math.abs(dy) * 1.5 && Math.abs(dx) > 60) {
      if (dx < 0) navigateBook(1);
      else        navigateBook(-1);
    }
  }, { passive: true });
}

window.addEventListener("keydown", function(e) {
  if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement && document.activeElement.tagName)) return;
  if (document.getElementById("coverLightbox").classList.contains("open")) {
    if (e.key === "ArrowRight" && _coverLightboxItems.length > 1) { navigateCoverLightbox(1); e.preventDefault(); }
    else if (e.key === "ArrowLeft" && _coverLightboxItems.length > 1) { navigateCoverLightbox(-1); e.preventDefault(); }
    else if (e.key === "Escape") { closeCoverLightbox(); e.preventDefault(); }
    return;
  }
  if (!selectedBookId) return;
  if (e.key === "ArrowRight") { navigateBook(1);  e.preventDefault(); }
  else if (e.key === "ArrowLeft")  { navigateBook(-1); e.preventDefault(); }
});

window.addEventListener("resize", function() {
  applyShareDetailExpanded();
});

// ── Cover lightbox ─────────────────────────────────────────────────────────────
function showCoverLightbox(url, galleryUrls, galleryIndex) {
  _coverLightboxItems = prepareLightboxItems(galleryUrls);
  _coverLightboxIndex = _coverLightboxItems.length
    ? Math.max(0, Math.min(Number(galleryIndex) || 0, _coverLightboxItems.length - 1))
    : -1;
  var activeUrl = _coverLightboxIndex >= 0 ? _coverLightboxItems[_coverLightboxIndex] : url;
  var prevBtn = document.getElementById("coverLightboxPrevBtn");
  var nextBtn = document.getElementById("coverLightboxNextBtn");
  if (prevBtn) prevBtn.style.display = _coverLightboxItems.length > 1 ? "" : "none";
  if (nextBtn) nextBtn.style.display = _coverLightboxItems.length > 1 ? "" : "none";
  if (prevBtn) prevBtn.disabled = _coverLightboxIndex <= 0;
  if (nextBtn) nextBtn.disabled = _coverLightboxIndex === -1 || _coverLightboxIndex >= _coverLightboxItems.length - 1;
  url = activeUrl || url;
  let largeUrl = url;
  if (/books\.google(?:usercontent)?\.com|googleusercontent\.com|books\.google\.com/.test(url) || /zoom=\d+/.test(url)) {
    largeUrl = url.replace(/zoom=\d+/, "zoom=0").replace(/[&?]edge=curl/, "");
  }
  const img = document.getElementById("coverLightboxImg");
  img.style.minWidth = "";
  img.onload = function() {
    if (img.src !== url && img.naturalWidth === 575 && img.naturalHeight === 750) {
      img.onload = null;
      img.style.minWidth = "min(80vw, 350px)";
      img.src = url;
    }
  };
  img.onerror = function() {
    if (img.src !== url) {
      img.onerror = null;
      img.src = url;
    }
  };
  img.src = largeUrl;
  document.getElementById("coverLightbox").classList.add("open");
}

function navigateCoverLightbox(delta) {
  if (_coverLightboxItems.length <= 1) return;
  var nextIndex = _coverLightboxIndex + delta;
  if (nextIndex < 0 || nextIndex >= _coverLightboxItems.length) return;
  showCoverLightbox(_coverLightboxItems[nextIndex], _coverLightboxItems, nextIndex);
}

function closeCoverLightbox() {
  document.getElementById("coverLightbox").classList.remove("open");
  var prevBtn = document.getElementById("coverLightboxPrevBtn");
  var nextBtn = document.getElementById("coverLightboxNextBtn");
  if (prevBtn) prevBtn.style.display = "none";
  if (nextBtn) nextBtn.style.display = "none";
  _coverLightboxItems = [];
  _coverLightboxIndex = -1;
  const img = document.getElementById("coverLightboxImg");
  img.style.minWidth = "";
  img.src = "";
}

(function attachCoverLightboxSwipe() {
  var lightbox = document.getElementById("coverLightbox");
  if (!lightbox) return;
  lightbox.addEventListener("touchstart", function(e) {
    if (!e.touches || !e.touches.length) return;
    _coverLightboxTouchX = e.touches[0].clientX;
    _coverLightboxTouchY = e.touches[0].clientY;
  }, { passive: true });
  lightbox.addEventListener("touchend", function(e) {
    if (_coverLightboxItems.length <= 1 || !e.changedTouches || !e.changedTouches.length) return;
    var dx = e.changedTouches[0].clientX - _coverLightboxTouchX;
    var dy = e.changedTouches[0].clientY - _coverLightboxTouchY;
    if (Math.abs(dx) > Math.abs(dy) * 1.5 && Math.abs(dx) > 50) {
      if (dx < 0) navigateCoverLightbox(1);
      else navigateCoverLightbox(-1);
    }
  }, { passive: true });
})();

// ── Wikipedia (Pass A: direct REST; Pass B: search URL fallback) ──────────────
async function lookupWikipedia() {
  const book = sharedBooks.find(function(b) { return b.id === selectedBookId; });
  if (!book) return;

  const modal   = document.getElementById("wikiModal");
  const content = document.getElementById("wikiModalContent");

  content.innerHTML =
    '<div style="padding:48px 20px;text-align:center;">' +
      '<div style="font-family:\'EB Garamond\',serif;font-size:1rem;color:var(--brown);">Checking Wikipedia\u2026</div>' +
    '</div>';
  modal.classList.add("open");

  try {
    const direct = await _wikiDirectBookLookup(book.title, book.author);
    if (direct) {
      content.innerHTML = renderWikiSummary(direct);
      return;
    }
    // Pass B — AI-assisted lookup if the share owner enabled it
    if (sharedAllowWikiAI) {
      content.innerHTML =
        '<div style="padding:48px 20px;text-align:center;">' +
          '<div style="font-family:\'EB Garamond\',serif;font-size:1rem;color:var(--brown);">Checking Wikipedia with AI\u2026</div>' +
        '</div>';
      try {
        const wikiAIFn = functions.httpsCallable("resolveWikipediaArticlesShared");
        const wikiResult = await wikiAIFn({ token, title: book.title, author: book.author || "" });
        const articles = wikiResult.data || {};
        const articleTitle = articles.book_article || articles.author_article || "";
        if (articleTitle) {
          const aiSummary = await _wikiGetSummary(articleTitle);
          if (aiSummary) {
            content.innerHTML = renderWikiSummary(aiSummary);
            return;
          }
        }
      } catch (aiErr) {
        console.warn("[lookupWikipedia] AI Pass B failed:", aiErr.message);
        // fall through to not-found state
      }
    }

    // Not found — show search link
    const searchUrl = "https://en.wikipedia.org/w/index.php?search=" +
      encodeURIComponent([book.title, book.author].filter(Boolean).join(" "));
    content.innerHTML =
      '<div class="wiki-not-found">' +
        '<div style="font-size:2rem;margin-bottom:12px;">\uD83D\uDCDA</div>' +
        '<div style="font-family:\'Playfair Display\',serif;color:var(--dark);font-size:1.05rem;margin-bottom:8px;">No Wikipedia page found for this book or author.</div>' +
        '<div style="font-family:\'EB Garamond\',serif;color:var(--brown);font-size:0.9rem;margin-bottom:20px;">' +
          'You can try searching Wikipedia directly \u2014 it may be listed under a different title.' +
        '</div>' +
        '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">' +
          '<a class="btn btn-secondary btn-sm" href="' + escapeAttribute(searchUrl) + '" target="_blank" rel="noopener noreferrer">Search Wikipedia &#8594;</a>' +
          '<button class="btn btn-light btn-sm" onclick="closeWikiModal()">Close</button>' +
        '</div>' +
      '</div>';
  } catch (err) {
    content.innerHTML =
      '<div class="wiki-not-found">' +
        '<div style="font-size:1.6rem;margin-bottom:10px;">\u26A0\uFE0F</div>' +
        '<div style="color:var(--dark);margin-bottom:6px;">Could not reach Wikipedia.</div>' +
        '<div style="color:var(--brown);font-size:0.88rem;margin-bottom:18px;">Please check your connection and try again.</div>' +
        '<button class="btn btn-light btn-sm" onclick="closeWikiModal()">Close</button>' +
      '</div>';
  }
}

function searchReviewsShared() {
  const book = sharedBooks.find(function(b) { return b.id === selectedBookId; });
  if (!book) return;
  const query = [book.title || "", book.author || "", "review"].filter(Boolean).join(" ");
  const url = "https://www.google.com/search?q=" + encodeURIComponent(query);
  window.open(url, "_blank", "noopener,noreferrer");
}

function renderWikiSummary(data, notice) {
  notice = notice || "";
  const thumb = data.thumbnail ? data.thumbnail.source : null;
  const thumbHtml = thumb ? '<img class="wiki-modal-thumb" src="' + escapeAttribute(thumb) + '" alt="">' : "";
  const title = esc(data.title || "");
  const description = esc(data.description || "");
  const articleUrl = (data.content_urls && data.content_urls.desktop && data.content_urls.desktop.page)
    || "https://en.wikipedia.org/wiki/" + encodeURIComponent(data.title || "");
  const paragraphs = (data.extract || "").split(/\n+/).map(function(p) { return p.trim(); }).filter(Boolean)
    .map(function(p) { return "<p>" + esc(p) + "</p>"; }).join("");
  const noticeHtml = notice ? '<div class="wiki-notice">' + esc(notice) + '</div>' : "";

  return '<div class="wiki-modal-header">' +
      thumbHtml +
      '<div style="min-width:0;flex:1;">' +
        '<div class="wiki-modal-title">' + title + '</div>' +
        (description ? '<div class="wiki-modal-description">' + description + '</div>' : '') +
      '</div>' +
    '</div>' +
    noticeHtml +
    '<div class="wiki-modal-body">' + paragraphs + '</div>' +
    '<div class="wiki-modal-footer">' +
      '<span class="wiki-attribution">Source: Wikipedia, the Free Encyclopedia</span>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">' +
        '<a class="btn btn-secondary btn-sm" href="' + escapeAttribute(articleUrl) + '" target="_blank" rel="noopener noreferrer">Read full article &#8594;</a>' +
        '<button class="btn btn-light btn-sm" onclick="closeWikiModal()">Close</button>' +
      '</div>' +
    '</div>';
}

function closeWikiModal(event) {
  if (event && event.target !== document.getElementById("wikiModal")) return;
  document.getElementById("wikiModal").classList.remove("open");
}

// ── About Modal ───────────────────────────────────────────────────────────────
function openAbout() {
  document.getElementById("aboutModal").classList.add("open");
}

function closeAbout(event) {
  if (event && event.target !== document.getElementById("aboutModal")) return;
  document.getElementById("aboutModal").classList.remove("open");
}

function openAboutMore() {
  document.getElementById("aboutModal").classList.remove("open");
  document.getElementById("aboutMoreModal").classList.add("open");
}

function closeAboutMore(event) {
  if (event && event.target !== document.getElementById("aboutMoreModal")) return;
  document.getElementById("aboutMoreModal").classList.remove("open");
}

function backToAbout() {
  document.getElementById("aboutMoreModal").classList.remove("open");
  document.getElementById("aboutModal").classList.add("open");
}


