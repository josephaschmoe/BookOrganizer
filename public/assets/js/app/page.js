function safeLoad(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;
  }
}

function sanitizeBookPhotoEntry(photo, fallbackIndex) {
  const source = photo && typeof photo === "object" ? photo : {};
  const url = String(source.url || "").trim();
  if (!url) return null;
  const caption = String(source.caption || "").trim().slice(0, 160);
  const type = String(source.type || "").trim().slice(0, 40) || "other";
  const storagePath = String(source.storagePath || "").trim();
  const createdAt = String(source.createdAt || "").trim() || new Date().toISOString();
  const sortOrder = Number(source.sortOrder);
  return {
    id: String(source.id || `photo-${fallbackIndex || 0}`),
    url,
    caption,
    type,
    storagePath,
    createdAt,
    sortOrder: Number.isFinite(sortOrder) ? sortOrder : (fallbackIndex || 0)
  };
}

function sanitizeBookPhotoList(photos) {
  return (Array.isArray(photos) ? photos : [])
    .map(function(photo, index) { return sanitizeBookPhotoEntry(photo, index); })
    .filter(Boolean)
    .sort(function(a, b) {
      return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0)
        || String(a.createdAt || "").localeCompare(String(b.createdAt || ""))
        || String(a.id || "").localeCompare(String(b.id || ""));
    });
}

function getBookPhotos(bookId) {
  return sanitizeBookPhotoList(bookPhotoCache[bookId] || []);
}

function normalizeShareRecord(token, share) {
  const source = share && typeof share === "object" ? share : {};
  const type = String(source.type || "").trim().toLowerCase() === "book" ? "book" : "shelf";
  const resourceId = String(source.resourceId || (type === "book" ? source.bookId : source.shelfId) || "").trim();
  return {
    token: String(token || source.token || "").trim(),
    ownerUid: String(source.ownerUid || "").trim(),
    type,
    resourceId,
    resourceName: String(source.resourceName || source.shelfName || source.bookTitle || "").trim(),
    includePersonalNotes: Boolean(source.includePersonalNotes),
    allowWikiAI: Boolean(source.allowWikiAI),
    allowBriefingAudio: Boolean(source.allowBriefingAudio),
    includeAdditionalPhotos: type === "book" ? Boolean(source.includeAdditionalPhotos) : true,
    createdAt: Number(source.createdAt) || Date.now(),
    updatedAt: Number(source.updatedAt) || Number(source.createdAt) || Date.now(),
    status: String(source.status || "active").trim().toLowerCase() === "revoked" ? "revoked" : "active"
  };
}

function activeShareRecords() {
  return Object.values(shareRecords).filter(function(share) {
    return share && share.status === "active" && share.token;
  });
}

function shelfShareRecords() {
  return activeShareRecords().filter(function(share) { return share.type === "shelf"; });
}

function bookShareRecords() {
  return activeShareRecords().filter(function(share) { return share.type === "book"; });
}

function activeShareForResource(type, resourceId) {
  const normalizedType = type === "book" ? "book" : "shelf";
  const id = String(resourceId || "").trim();
  return activeShareRecords().find(function(share) {
    return share.type === normalizedType && share.resourceId === id;
  }) || null;
}

function deriveLegacyShareRecords(legacyMap) {
  const source = legacyMap && typeof legacyMap === "object" ? legacyMap : {};
  const out = {};
  Object.keys(source).forEach(function(token) {
    const item = source[token];
    if (!item || typeof item !== "object") return;
    const shelfId = String(item.shelfId || "").trim();
    if (!shelfId) return;
    out[token] = normalizeShareRecord(token, {
      token,
      type: "shelf",
      resourceId: shelfId,
      resourceName: item.shelfName || "",
      includePersonalNotes: item.includePersonalNotes,
      allowWikiAI: item.allowWikiAI,
      allowBriefingAudio: item.allowBriefingAudio,
      includeAdditionalPhotos: true,
      createdAt: item.createdAt,
      updatedAt: item.createdAt,
      status: "active"
    });
  });
  return out;
}

async function backfillLegacyShareRecords(uid, legacyRecords, existingRecords = {}) {
  const tokens = Object.keys(legacyRecords || {});
  if (!uid || !tokens.length) return;
  const batch = db.batch();
  let hasWrites = false;
  tokens.forEach(function(token) {
    if (existingRecords[token]) return;
    batch.set(db.collection("users").doc(uid).collection("shares").doc(token), legacyRecords[token], { merge: true });
    hasWrites = true;
  });
  if (!hasWrites) return;
  try {
    await batch.commit();
  } catch (error) {
    console.warn("[backfillLegacyShareRecords] failed:", error);
  }
}

function uiIconsModeEnabled() {
  return uiDetailMode === "icons";
}

function actionIconSvg(kind) {
  const stroke = "currentColor";
  if (kind === "edit") {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="' + stroke + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  }
  if (kind === "remove") {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="' + stroke + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
  }
  if (kind === "share") {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="' + stroke + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M12 16V3"/><path d="m7 8 5-5 5 5"/></svg>';
  }
  if (kind === "generate") {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="' + stroke + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6l3 2"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6l-3-2"/></svg>';
  }
  if (kind === "listen") {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="' + stroke + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13v3a4 4 0 0 0 4 4h1v-8H8a4 4 0 0 0-4 4Z"/><path d="M20 13v3a4 4 0 0 1-4 4h-1v-8h1a4 4 0 0 1 4 4Z"/><path d="M8 12a4 4 0 1 1 8 0"/></svg>';
  }
  if (kind === "photos") {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="' + stroke + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h4l2-2h4l2 2h4v12H4Z"/><circle cx="12" cy="13" r="3"/><path d="M19 3v4"/><path d="M17 5h4"/></svg>';
  }
  if (kind === "wiki") {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M16.1 5.2h4.3v.8l-1 .2c-.3.1-.5.2-.7.4-.2.2-.4.6-.6 1.1l-4.1 11.1h-.8L10 9.9 6.5 18.8h-.8L1.8 7.7c-.2-.5-.4-.9-.6-1.1-.2-.2-.5-.4-.9-.4L0 6.1v-.8h6.1v.8l-.8.1c-.3 0-.5.1-.7.2-.1.1-.2.3-.2.5 0 .2 0 .4.1.7l2.6 7.8 2.7-6.9-.5-1.5c-.2-.5-.4-.8-.6-1-.2-.2-.5-.3-.9-.4l-.6-.1v-.8h6.5v.8l-.9.1c-.4 0-.6.1-.7.2-.1.1-.2.2-.2.4 0 .2.1.5.2.9l2.7 7.7 2.4-6.7c.2-.6.4-1 .4-1.3 0-.3-.1-.5-.3-.7-.2-.1-.5-.2-.9-.3l-.8-.1v-.8Z"/></svg>';
  }
  return "";
}

function setActionButtonPresentation(button, label, iconKind, options = {}) {
  if (!button) return;
  const iconMode = uiIconsModeEnabled() && !options.forceText;
  button.classList.toggle("icon-action-btn", iconMode);
  button.title = label;
  button.setAttribute("aria-label", label);
  if (iconMode) {
    button.innerHTML = actionIconSvg(iconKind);
  } else {
    button.textContent = label;
  }
}

function refreshBookDetailActionPresentation() {
  setActionButtonPresentation(document.getElementById("editBookDetailBtn"), "Edit", "edit");
  setActionButtonPresentation(document.getElementById("removeBookDetailBtn"), "Remove", "remove");
  const shareBtn = document.getElementById("shareBookDetailBtn");
  setActionButtonPresentation(shareBtn, shareBtn && shareBtn.textContent ? shareBtn.textContent.trim() : "Share Book", "share");
  const wikiBtn = document.getElementById("wikiLookupBtn");
  setActionButtonPresentation(wikiBtn, wikiBtn && wikiBtn.textContent ? wikiBtn.textContent.trim() : "Wikipedia", "wiki");
  const searchBtn = document.getElementById("searchReviewsBtn");
  if (searchBtn) {
    searchBtn.classList.remove("icon-action-btn");
    searchBtn.textContent = "Search Reviews";
    searchBtn.title = "Search Reviews";
    searchBtn.setAttribute("aria-label", "Search Reviews");
  }
}

function formatBookPhotoTypeLabel(value) {
  const type = String(value || "").trim();
  if (!type || type === "other") return "Other";
  return type.replace(/[-_]+/g, " ").replace(/\b\w/g, function(ch) { return ch.toUpperCase(); });
}

function bookHasAdditionalPhotos(book) {
  return Boolean(book && book.id && getBookPhotos(book.id).length);
}

function loadBookPhotoSectionState(bookId) {
  if (Object.prototype.hasOwnProperty.call(bookPhotoSectionCollapsed, bookId)) {
    return Boolean(bookPhotoSectionCollapsed[bookId]);
  }
  let collapsed = true;
  try {
    const raw = localStorage.getItem("tomeshelf-book-photo-collapsed");
    const parsed = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object" && Object.prototype.hasOwnProperty.call(parsed, bookId)) {
      collapsed = Boolean(parsed[bookId]);
      bookPhotoSectionCollapsed[bookId] = collapsed;
    }
  } catch (e) {}
  return collapsed;
}

function saveBookPhotoSectionState() {
  try {
    localStorage.setItem("tomeshelf-book-photo-collapsed", JSON.stringify(bookPhotoSectionCollapsed));
  } catch (e) {}
}

function loadHasPhotosModeSectionState() {
  try {
    hasPhotosModeSectionCollapsed = localStorage.getItem("tomeshelf-has-photos-collapsed") === "1";
  } catch (e) {
    hasPhotosModeSectionCollapsed = false;
  }
  return hasPhotosModeSectionCollapsed;
}

function saveHasPhotosModeSectionState() {
  try {
    localStorage.setItem("tomeshelf-has-photos-collapsed", hasPhotosModeSectionCollapsed ? "1" : "0");
  } catch (e) {}
}

function toggleBookPhotoSection(bookId) {
  const sortMode = document.getElementById("sortSelect") ? document.getElementById("sortSelect").value : "";
  if (sortMode === "has-photos") {
    hasPhotosModeSectionCollapsed = !loadHasPhotosModeSectionState();
    saveHasPhotosModeSectionState();
    renderBriefingPanel();
    return;
  }
  bookPhotoSectionCollapsed[bookId] = !loadBookPhotoSectionState(bookId);
  saveBookPhotoSectionState();
  renderBriefingPanel();
}

function openBookPhotoLightbox(bookId, index) {
  const photos = getBookPhotos(bookId);
  const galleryUrls = photos.map(function(photo) { return photo.url; }).filter(Boolean);
  const active = photos[index] && photos[index].url ? photos[index].url : (galleryUrls[0] || "");
  if (!active) return;
  showCoverLightbox(active, galleryUrls, index);
}

function stopEditing() {
  editingBookId = null;
  metadataRefreshContext = null;
  document.getElementById("saveBookBtn").textContent = "Add to Catalog";
  document.getElementById("cancelEditBtn").style.display = "none";
  document.getElementById("editBackBtn").style.display = "none";
  document.getElementById("addPanelTitle").textContent = "Add to Catalog";
  // Restore add mode UI
  document.getElementById("addModeSection").style.display = "";
  document.getElementById("editModeHeader").style.display = "none";
  document.getElementById("bookSubjectTagsGroup").style.display = "none";
  const refreshBtn = document.getElementById("metadataRefreshBtn");
  const doneBtn = document.getElementById("metadataRefreshDoneBtn");
  const banner = document.getElementById("metadataRefreshBanner");
  const existingSection = document.getElementById("metadataRefreshExistingSection");
  const existingGrid = document.getElementById("metadataRefreshExistingGrid");
  if (refreshBtn) refreshBtn.style.display = "";
  if (doneBtn) doneBtn.style.display = "none";
  if (banner) {
    banner.style.display = "none";
    banner.textContent = "";
  }
  if (existingSection) existingSection.style.display = "none";
  if (existingGrid) existingGrid.innerHTML = "";
}

function cancelEdit() {
  const wasEditing = Boolean(editingBookId);
  clearForm();
  setStatus("addStatus", "", "");
  if (wasEditing && selectedBookId) {
    setMobileSection("briefing");
  }
}

function normalizeBook(book) {
  const source = book && typeof book === "object" ? book : {};
  const ratingValue = Number(source.rating);
  const customOrderValue = Number(source.customOrder);
  const authorSort = String(source.authorSort || "").trim() || buildAuthorSortKey(source.author || "");

  return {
    ...source,
    notes: String(source.notes || "").trim(),
    personalNotes: String(source.personalNotes || "").trim(),
    contributor: String(source.contributor || "").trim(),
    illustrationNote: String(source.illustrationNote || "").trim(),
    authorSort,
    readingStatus: normalizeReadingStatus(source.readingStatus),
    startDate: normalizeDateInput(source.startDate),
    finishDate: normalizeDateInput(source.finishDate),
    rating: ratingValue >= 1 && ratingValue <= 5 ? ratingValue : 0,
    listShelfId: source.listShelfId || "default",
    customOrder: Number.isFinite(customOrderValue) ? customOrderValue : null,
    additionalPhotos: sanitizeBookPhotoList(source.additionalPhotos),
    briefingNeedsRegeneration: Boolean(source.briefingNeedsRegeneration)
  };
}

function isMetadataRefreshMode() {
  return Boolean(editingBookId && metadataRefreshContext && metadataRefreshContext.bookId === editingBookId);
}

function isStoredPhotoItem(item) {
  return Boolean(item && typeof item === "object" && item.__storedPhoto);
}

function getPhotoItemPreviewUrl(item) {
  if (!item) return "";
  if (isStoredPhotoItem(item)) return String(item.url || "").trim();
  return URL.createObjectURL(item);
}

function isUserOwnedCoverUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return false;
  const decoded = (() => {
    try { return decodeURIComponent(raw); } catch (error) { return raw; }
  })();
  return /\/users\/[^/]+\/covers\//i.test(decoded);
}

function getMetadataRefreshablePhotos(book) {
  const list = [];
  if (!book) return list;
  if (String(book.coverUrl || "").trim()) {
    list.push({
      id: "cover",
      url: book.coverUrl,
      label: isUserOwnedCoverUrl(book.coverUrl) ? "Current Cover" : "Current Cover (External)",
      sourceKind: isUserOwnedCoverUrl(book.coverUrl) ? "stored-cover" : "external-cover",
      storagePath: auth.currentUser && book.id ? `users/${auth.currentUser.uid}/covers/${book.id}.jpg` : ""
    });
  }
  getBookPhotos(book.id).forEach((photo) => {
    if (!photo || !photo.url) return;
    list.push({
      id: photo.id,
      url: photo.url,
      label: photo.caption ? photo.caption : (photo.type || "Photo"),
      sourceKind: "stored-photo",
      storagePath: photo.storagePath || ""
    });
  });
  return list;
}


function hasCustomOrder(book) {
  return Number.isFinite(Number(book && book.customOrder));
}

function compareBooksByCustomOrder(a, b) {
  const aHas = hasCustomOrder(a);
  const bHas = hasCustomOrder(b);
  if (aHas && bHas) {
    const diff = Number(a.customOrder) - Number(b.customOrder);
    if (diff !== 0) return diff;
  } else if (aHas !== bHas) {
    return aHas ? -1 : 1;
  }
  const addedDiff = Number(b.addedAt || 0) - Number(a.addedAt || 0);
  if (addedDiff !== 0) return addedDiff;
  return (a.title || "").localeCompare(b.title || "");
}

function compareBooksBySort(a, b, sort) {
  if (sort === "has-photos") {
    return (a.title || "").localeCompare(b.title || "");
  }
  if (sort === "title") {
    return (a.title || "").localeCompare(b.title || "");
  }
  if (sort === "author") {
    const authorDiff = (a.authorSort || buildAuthorSortKey(a.author || "")).localeCompare(b.authorSort || buildAuthorSortKey(b.author || ""));
    if (authorDiff !== 0) return authorDiff;
    return (a.title || "").localeCompare(b.title || "");
  }
  if (sort === "year") {
    return Number(b.year || 0) - Number(a.year || 0);
  }
  if (sort === "rating") {
    return Number(b.rating || 0) - Number(a.rating || 0);
  }
  if (sort === "custom") {
    return compareBooksByCustomOrder(a, b);
  }
  return Number(b.addedAt || 0) - Number(a.addedAt || 0);
}

function getShelfBooks(shelfId) {
  return books.filter(function(book) {
    return (book.listShelfId || "default") === shelfId;
  });
}

function getShelfBooksSorted(shelfId, sort) {
  return getShelfBooks(shelfId).slice().sort(function(a, b) {
    return compareBooksBySort(a, b, sort);
  });
}

function getNextCustomOrderForShelf(shelfId) {
  return getShelfBooks(shelfId).reduce(function(max, book) {
    return hasCustomOrder(book) ? Math.max(max, Number(book.customOrder)) : max;
  }, -1) + 1;
}

function reindexShelfCustomOrder(shelfId, orderedBooks) {
  const list = Array.isArray(orderedBooks) ? orderedBooks : getShelfBooksSorted(shelfId, "custom");
  list.forEach(function(book, index) {
    book.customOrder = index;
  });
}

function ensureShelfCustomOrderInitialized(shelfId) {
  const ordered = getShelfBooksSorted(shelfId, "custom");
  reindexShelfCustomOrder(shelfId, ordered);
  return ordered;
}

function getSelectedBooksInDisplayOrder() {
  const orderedIds = _filteredBookIds.filter(function(id) { return selectedBookIds.has(id); });
  if (orderedIds.length) {
    return orderedIds.map(function(id) { return findBook(id); }).filter(Boolean);
  }
  return [...selectedBookIds].map(function(id) { return findBook(id); }).filter(Boolean);
}

function handleSortChange() {
  clearBookDragState();
  renderCatalog();
  renderBriefingPanel();
  updateSelectionBar();
}

function canUseDragReorder() {
  const sortSelect = document.getElementById("sortSelect");
  const searchInput = document.getElementById("searchInput");
  const isDesktop = window.innerWidth >= 1024;
  const customSortActive = sortSelect && sortSelect.value === "custom";
  const hasSearch = searchInput && searchInput.value.trim() !== "";
  return Boolean(isDesktop && customSortActive && !selectionMode && !filterStatus && !hasSearch);
}

function clearBookDragIndicators() {
  document.querySelectorAll(".book-card.dragging, .book-card.drag-target-before, .book-card.drag-target-after").forEach(function(card) {
    card.classList.remove("dragging", "drag-target-before", "drag-target-after");
  });
}

function clearBookDragState() {
  dragReorderState.bookId = null;
  dragReorderState.targetBookId = null;
  dragReorderState.position = null;
  clearBookDragIndicators();
}

function setBookDragTarget(targetBookId, position) {
  dragReorderState.targetBookId = targetBookId || null;
  dragReorderState.position = position || null;
  document.querySelectorAll(".book-card.drag-target-before, .book-card.drag-target-after").forEach(function(card) {
    card.classList.remove("drag-target-before", "drag-target-after");
  });
  if (!targetBookId || !position) return;
  const card = document.querySelector(`.book-card[data-book-id="${CSS.escape(targetBookId)}"]`);
  if (!card) return;
  card.classList.add(position === "before" ? "drag-target-before" : "drag-target-after");
}

function autoScrollWhileDragging(clientY) {
  if (!dragReorderState.bookId) return;
  const edge = 90;
  const fromTop = clientY;
  const fromBottom = window.innerHeight - clientY;
  let delta = 0;
  if (fromTop < edge) {
    delta = -Math.ceil(((edge - fromTop) / edge) * 18);
  } else if (fromBottom < edge) {
    delta = Math.ceil(((edge - fromBottom) / edge) * 18);
  }
  if (delta !== 0) {
    window.scrollBy(0, delta);
  }
}

function updateBookDragTargetFromPoint(clientX, clientY) {
  if (!dragReorderState.bookId) return;
  const cards = [...document.querySelectorAll("#bookGrid .book-card[data-book-id]")].filter(function(card) {
    return card.dataset.bookId !== dragReorderState.bookId;
  });
  if (!cards.length) {
    setBookDragTarget(null, null);
    return;
  }

  const directTarget = document.elementFromPoint(clientX, clientY);
  const targetCard = directTarget && directTarget.closest ? directTarget.closest(".book-card[data-book-id]") : null;
  if (targetCard && targetCard.dataset.bookId !== dragReorderState.bookId) {
    const rect = targetCard.getBoundingClientRect();
    setBookDragTarget(targetCard.dataset.bookId, clientY < rect.top + rect.height / 2 ? "before" : "after");
    return;
  }

  const firstRect = cards[0].getBoundingClientRect();
  if (clientY < firstRect.top + firstRect.height / 2) {
    setBookDragTarget(cards[0].dataset.bookId, "before");
    return;
  }
  const lastCard = cards[cards.length - 1];
  setBookDragTarget(lastCard.dataset.bookId, "after");
}

function startBookDrag(event, bookId) {
  if (!canUseDragReorder()) {
    event.preventDefault();
    return;
  }
  dragReorderState.bookId = bookId;
  dragReorderState.targetBookId = null;
  dragReorderState.position = null;
  const card = event.target.closest(".book-card");
  if (card) card.classList.add("dragging");
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", bookId);
  }
}

function endBookDrag() {
  clearBookDragState();
}

function handleBookGridDragOver(event) {
  if (!dragReorderState.bookId || !canUseDragReorder()) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  autoScrollWhileDragging(event.clientY);
  updateBookDragTargetFromPoint(event.clientX, event.clientY);
}

async function handleBookGridDrop(event) {
  if (!dragReorderState.bookId || !canUseDragReorder()) return;
  event.preventDefault();
  const draggedBookId = dragReorderState.bookId;
  const targetBookId = dragReorderState.targetBookId;
  const position = dragReorderState.position;
  clearBookDragIndicators();

  if (!targetBookId || !position || draggedBookId === targetBookId) {
    clearBookDragState();
    return;
  }

  const ordered = ensureShelfCustomOrderInitialized(currentShelfId);
  const draggedIndex = ordered.findIndex(function(book) { return book.id === draggedBookId; });
  if (draggedIndex === -1) {
    clearBookDragState();
    return;
  }

  const draggedBook = ordered.splice(draggedIndex, 1)[0];
  let insertAt = ordered.findIndex(function(book) { return book.id === targetBookId; });
  if (insertAt === -1) {
    ordered.push(draggedBook);
  } else {
    if (position === "after") insertAt += 1;
    ordered.splice(insertAt, 0, draggedBook);
  }

  reindexShelfCustomOrder(currentShelfId, ordered);
  await persistCatalog();
  clearBookDragState();
  renderCatalog();
}

function normalizeReadingStatus(value) {
  const allowed = ["Want to Read", "Currently Reading", "Read", "Did Not Finish"];
  return allowed.includes(value) ? value : "";
}

function normalizeDateInput(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : "";
}

function openAbout() {
  document.getElementById("aboutModal").classList.add("open");
}

function closeAbout(e) {
  if (!e || e.target === document.getElementById("aboutModal")) {
    document.getElementById("aboutModal").classList.remove("open");
  }
}

function openAboutMore() {
  document.getElementById("aboutModal").classList.remove("open");
  document.getElementById("aboutMoreModal").classList.add("open");
}

function closeAboutMore(e) {
  if (!e || e.target === document.getElementById("aboutMoreModal")) {
    document.getElementById("aboutMoreModal").classList.remove("open");
  }
}

function backToAbout() {
  document.getElementById("aboutMoreModal").classList.remove("open");
  document.getElementById("aboutModal").classList.add("open");
}

function toggleDataMenu() {
  document.getElementById("dataMenu").classList.toggle("open");
}

document.addEventListener("click", (e) => {
  if (!e.target.closest(".data-menu-wrap")) {
    const m = document.getElementById("dataMenu");
    if (m) m.classList.remove("open");
  }
  if (!e.target.closest(".account-menu-wrap")) {
    closeAccountMenu();
  }
});




function setStatus(id, message, type) {
  const element = document.getElementById(id);
  element.textContent = message;
  element.className = `${id === "briefingStatus" ? "research-status" : "lookup-status"}${type ? " " + type : ""}`;
}

function formatAudioDuration(durationSec) {
  const total = Math.max(0, Math.round(Number(durationSec) || 0));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function setResearchStatus(message, type) {
  setStatus("briefingStatus", message, type);
}



function closeCamera() {
  // Close modal immediately so the user sees it dismiss
  document.getElementById("cameraModal").classList.remove("open");

  // Native BarcodeDetector cleanup
  clearInterval(scanInterval);
  scanInterval = null;
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
  // html5-qrcode fallback cleanup â€” stop() is async, so chain clear() after it
  if (html5QrScanner) {
    const scanner = html5QrScanner;
    html5QrScanner = null;
    scanner.stop().then(() => scanner.clear()).catch(() => {});
  }
}


// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Photo Lookup â€” capture/select images â†’ Cloud Function â†’ review
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•




// â”€â”€ Swipe navigation on the book detail panel â”€â”€
(function () {
  let sx = 0, sy = 0;
  const panel = document.getElementById("briefingPanel");
  panel.addEventListener("touchstart", (e) => {
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
  }, { passive: true });
  panel.addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    // Only fire for mostly-horizontal swipes of at least 60px
    if (Math.abs(dx) > Math.abs(dy) * 1.5 && Math.abs(dx) > 60) {
      if (dx < 0) navigateBook(1);   // swipe left  â†’ next
      else         navigateBook(-1); // swipe right â†’ previous
    }
  }, { passive: true });
})();

// â”€â”€ Arrow-key navigation when detail panel is in focus â”€â”€
window.addEventListener("keydown", (e) => {
  if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;
  if (document.getElementById("coverLightbox").classList.contains("open")) return;
  const bp = document.getElementById("briefingPanel");
  const isDetailVisible = window.innerWidth >= 1024 || (bp && bp.classList.contains("mobile-active"));
  if (!isDetailVisible || !selectedBookId) return;
  if (e.key === "ArrowRight") { navigateBook(1);  e.preventDefault(); }
  else if (e.key === "ArrowLeft") { navigateBook(-1); e.preventDefault(); }
});


const BACKUP_SCHEMA_VERSION = 2;


async function initializeApp(cameraReturn = false) {
  refreshAboutCopy();
  // On camera return (full page reload after taking a photo) stay on the Add tab
  // so the captured photo â€” delivered via onchange after the reload â€” is visible.
  // On normal init, navigate to Catalog.
  restoreUiDetailMode();
  restoreSpecificEditionMode();
  restoreDesktopAddPanelState();
  restoreDesktopBriefingPanelState();
  if (cameraReturn) restoreAddFlowState();
  setMobileSection(cameraReturn ? "add" : "catalog");
  renderCatalog();
  renderBriefingPanel();
  updateResearchButtons();
  await loadApiConfig();
  await loadCatalogData();
  catalogLoading = false;
  updateShelfLabel();
  updateShelfSelector();
  renderCatalog();
  renderBriefingPanel();
  updateResearchButtons();
}

async function signInWithGoogle() {
  document.getElementById("authError").textContent = "";
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await auth.signInWithPopup(provider);
  } catch (error) {
    if (error.code !== "auth/popup-closed-by-user") {
      document.getElementById("authError").textContent = "Sign-in failed. Please try again.";
    }
  }
}

async function addBookPhotoAssetsToZip(zip, manifest, bookId) {
  const photos = getBookPhotos(bookId);
  for (const photo of photos) {
    if (!photo || !photo.url) continue;
    try {
      const blob = await fetchBlobForBackup(photo.url);
      const contentType = blob.type || guessContentTypeFromUrl(photo.url);
      const ext = extFromContentType(contentType, extFromPath(photo.url, ".jpg")) || ".jpg";
      const pathInZip = `files/book-photos/${bookId}/${photo.id}${ext}`;
      zip.file(pathInZip, blob);
      manifest.assets.push({
        assetId: `book-photo-${bookId}-${photo.id}`,
        bookId,
        photoId: photo.id,
        kind: "book-photo",
        contentType,
        pathInZip,
        sourcePath: photo.storagePath || "",
        sourceUrl: photo.url
      });
    } catch (error) {
      console.warn("[exportJSON] additional photo export skipped:", bookId, photo.id, error);
    }
  }
}

async function tryAsGuest() {
  document.getElementById("authError").textContent = "";
  try {
    await auth.signInAnonymously();
  } catch (error) {
    document.getElementById("authError").textContent = "Could not start guest session. Please try again.";
  }
}

// Called from the guest banner or Account Settings â€” links the anonymous session to Google.
// If the Google account already has TomeShelf data, offers to sign in and discard guest data.
async function signInFromGuest() {
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await auth.currentUser.linkWithPopup(provider);
    // Linking succeeded: UID unchanged, Firestore data carries over automatically.
    // onAuthStateChanged fires and updates the header / hides banner.
  } catch (error) {
    if (error.code === "auth/credential-already-in-use") {
      const proceed = confirm(
        "This Google account already has a TomeShelf library.\n\n" +
        "Signing in will load your existing library. Books added during this guest session won't be transferred.\n\n" +
        "Sign in anyway?"
      );
      if (proceed) {
        // Sign in with the Google credential from the failed link attempt
        await auth.signInWithCredential(error.credential);
      }
    } else if (error.code !== "auth/popup-closed-by-user") {
      alert("Sign-in failed. Please try again.");
    }
  }
}

// â”€â”€ Account menu â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderAdminAccessSection() {
  const statusEl = document.getElementById("adminAccessStatus");
  const refreshBtn = document.getElementById("adminAccessRefreshBtn");
  const toggleBtn = document.getElementById("adminAccessToggleBtn");
  const infoBtn = document.getElementById("adminAccessInfoBtn");
  const removeBtn = document.getElementById("adminAccessRemoveBtn");
  if (!statusEl || !refreshBtn || !toggleBtn || !infoBtn || !removeBtn) return;

  const hasStored = Boolean(adminAccessState && adminAccessState.hasStoredAdminAccess);
  const isValid = Boolean(adminAccessState && adminAccessState.adminAccessValid);
  const isDisabled = isAdminAccessTemporarilyDisabled(adminAccessState);
  const isStale = Boolean(adminAccessState && adminAccessState.adminAccessStale);

  statusEl.style.display = "";
  statusEl.className = "admin-access-status";

  if (isValid) {
    statusEl.classList.add("success");
    statusEl.textContent = "Administrative access active.";
    refreshBtn.style.display = "none";
    toggleBtn.textContent = "Turn Off for Now";
    toggleBtn.style.display = "";
    infoBtn.style.display = "";
    removeBtn.style.display = "";
    return;
  }

  toggleBtn.style.display = "none";
  infoBtn.style.display = "none";
  refreshBtn.style.display = "";
  removeBtn.style.display = hasStored ? "" : "none";
  refreshBtn.textContent = hasStored ? "Re-enter Administrative Access" : "Enter Administrative Access";

  if (isStale) {
    statusEl.classList.add("warning");
    statusEl.textContent = "Administrative access needs to be refreshed. The backend password has changed.";
  } else if (isDisabled) {
    statusEl.textContent = "Administrative access is stored for this account but currently turned off.";
    toggleBtn.textContent = "Turn Back On";
    toggleBtn.style.display = "";
    infoBtn.style.display = "";
    refreshBtn.style.display = "none";
  } else {
    statusEl.textContent = "No administrative access stored for this account.";
    removeBtn.style.display = "none";
  }
}

async function refreshAdminAccessStatus() {
  if (!auth.currentUser || auth.currentUser.isAnonymous) {
    adminAccessState = {
      hasStoredAdminAccess: false,
      adminAccessValid: false,
      adminAccessDisabled: false,
      adminAccessStale: false
    };
    renderAdminAccessSection();
    return adminAccessState;
  }
  try {
    const result = await functions.httpsCallable("getAdminAccessStatus")({});
    adminAccessState = {
      hasStoredAdminAccess: Boolean(result.data && result.data.hasStoredAdminAccess),
      adminAccessValid: Boolean(result.data && result.data.adminAccessValid),
      adminAccessDisabled: Boolean(result.data && result.data.adminAccessDisabled),
      adminAccessStale: Boolean(result.data && result.data.adminAccessStale)
    };
  } catch (error) {
    console.warn("[refreshAdminAccessStatus] failed:", error);
  }
  renderAdminAccessSection();
  return adminAccessState;
}

async function promptForAdminAccess() {
  if (!auth.currentUser || auth.currentUser.isAnonymous) return;
  const entered = prompt("Administrative Access password:");
  if (!entered) return;
  try {
    const result = await functions.httpsCallable("setAdminAccess")({ adminPassword: entered });
    adminAccessState = {
      hasStoredAdminAccess: Boolean(result.data && result.data.hasStoredAdminAccess),
      adminAccessValid: Boolean(result.data && result.data.adminAccessValid),
      adminAccessDisabled: Boolean(result.data && result.data.adminAccessDisabled),
      adminAccessStale: Boolean(result.data && result.data.adminAccessStale)
    };
    renderAdminAccessSection();
    renderBriefingPanel();
    setResearchStatus("Administrative access enabled for this account.", "success");
  } catch (error) {
    renderAdminAccessSection();
    alert(getCallableErrorMessage(error, "Administrative access password was not accepted."));
  }
}

async function toggleAdministrativeAccess() {
  if (!auth.currentUser || auth.currentUser.isAnonymous) return;
  const enable = isAdminAccessTemporarilyDisabled(adminAccessState);
  try {
    const result = await functions.httpsCallable("setAdminAccessEnabled")({ enabled: enable });
    adminAccessState = {
      hasStoredAdminAccess: Boolean(result.data && result.data.hasStoredAdminAccess),
      adminAccessValid: Boolean(result.data && result.data.adminAccessValid),
      adminAccessDisabled: Boolean(result.data && result.data.adminAccessDisabled),
      adminAccessStale: Boolean(result.data && result.data.adminAccessStale)
    };
    renderAdminAccessSection();
    renderBriefingPanel();
    setResearchStatus(
      enable
        ? "Administrative access turned back on for this account."
        : "Administrative access turned off. Admin-only rules are now disabled until you turn it back on.",
      "success"
    );
  } catch (error) {
    alert(getCallableErrorMessage(error, "Could not update Administrative Access."));
  }
}

async function removeAdministrativeAccess() {
  if (!auth.currentUser || auth.currentUser.isAnonymous) return;
  if (!confirm("Remove Administrative Access from this account?")) return;
  try {
    await functions.httpsCallable("removeAdminAccess")({});
    adminAccessState = {
      hasStoredAdminAccess: false,
      adminAccessValid: false,
      adminAccessDisabled: false,
      adminAccessStale: false
    };
    renderAdminAccessSection();
    renderBriefingPanel();
  } catch (error) {
    alert(getCallableErrorMessage(error, "Could not remove Administrative Access."));
  }
}

function openAdminAccessInfoModal() {
  document.getElementById("adminAccessInfoModal").classList.add("open");
}

function closeAdminAccessInfoModal(event) {
  if (event && event.target !== document.getElementById("adminAccessInfoModal")) return;
  document.getElementById("adminAccessInfoModal").classList.remove("open");
}

function toggleAccountMenu() {
  const menu = document.getElementById("accountMenu");
  menu.classList.toggle("open");
}

function closeAccountMenu() {
  const menu = document.getElementById("accountMenu");
  if (menu) menu.classList.remove("open");
}

async function signOutUser() {
  closeAccountMenu();
  const user = auth.currentUser;
  const isGuest = user && user.isAnonymous;
  const msg = isGuest
    ? "Leave guest session?\n\nAny books you've added will be lost unless you sign in with Google first."
    : "Sign out of TomeShelf?";
  if (!confirm(msg)) return;
  if (isGuest) {
    // Clean up orphaned anonymous Firestore data before signing out
    try { await db.collection("users").doc(user.uid).collection("catalog").doc("data").delete(); } catch (_) {}
  }
  _explicitSignOut = true;
  await auth.signOut();
}

async function openAccountSettings() {
  closeAccountMenu();
  const user = auth.currentUser;
  const isGuest = user && user.isAnonymous;
  const emailEl = document.getElementById("accountSettingsEmail");
  if (emailEl) emailEl.textContent = isGuest ? "Guest session â€” not signed in" : (user && (user.email || user.displayName) || "");
  const modeSelect = document.getElementById("uiDetailModeSelect");
  if (modeSelect) modeSelect.value = uiDetailMode;
  document.getElementById("accountSettingsGuestSection").style.display = isGuest ? "" : "none";
  document.getElementById("accountSettingsUserSection").style.display  = isGuest ? "none" : "";
  document.getElementById("accountSettingsDeleteSection").style.display = isGuest ? "none" : "";
  const backupsSection = document.getElementById("accountSettingsBackupsSection");
  if (backupsSection) {
    backupsSection.style.display = (!isGuest && user) ? "" : "none";
    if (!isGuest && user) _renderBackupJobsSection();
  }
  const shareSection = document.getElementById("accountSettingsShareSection");
  if (shareSection) {
    shareSection.style.display = (!isGuest && user) ? "" : "none";
    if (!isGuest && user) renderShareManagementSection();
  }
  await refreshAdminAccessStatus();
  document.getElementById("accountSettingsModal").classList.add("open");
}

function closeAccountSettings(event) {
  if (event && event.target !== document.getElementById("accountSettingsModal")) return;
  document.getElementById("accountSettingsModal").classList.remove("open");
}

async function confirmDeleteAccount() {
  const user = auth.currentUser;
  if (!user) return;

  // First confirmation
  const first = confirm(
    "Delete your TomeShelf account and ALL data?\n\n" +
    "This will permanently delete:\n" +
    "â€¢ All your books and shelves\n" +
    "â€¢ All research briefings\n" +
    "â€¢ All cover images\n" +
    "â€¢ Your TomeShelf account\n\n" +
    "This CANNOT be undone. Click OK to continue."
  );
  if (!first) return;

  // Second confirmation
  const second = confirm(
    "FINAL WARNING\n\n" +
    "Are you absolutely sure you want to permanently delete everything?\n\n" +
    "Click OK to permanently delete your account and all data."
  );
  if (!second) return;

  const uid = user.uid;
  document.getElementById("accountSettingsModal").classList.remove("open");

  // Show a status message on the auth overlay after deletion
  try {
    // 1. Delete Firestore catalog data
    await db.collection("users").doc(uid).collection("catalog").doc("data").delete();

    // 2. Delete Storage covers (list and delete each)
    try {
      const coverRef = storage.ref(`users/${uid}/covers`);
      const list = await coverRef.listAll();
      await Promise.all(list.items.map((item) => item.delete()));
    } catch (storageErr) {
      // Storage may not have covers folder â€” not fatal
    }

    try {
      const photosRootRef = storage.ref(`users/${uid}/book-photos`);
      const top = await photosRootRef.listAll();
      await Promise.all(top.prefixes.map(async function(folderRef) {
        const list = await folderRef.listAll();
        await Promise.all(list.items.map((item) => item.delete()));
      }));
    } catch (storageErr) {
      // Storage may not have additional book photos â€” not fatal
    }

    try {
      const photoDocs = await db.collection("users").doc(uid).collection("bookPhotos").get();
      if (!photoDocs.empty) {
        const batch = db.batch();
        photoDocs.forEach(function(doc) { batch.delete(doc.ref); });
        await batch.commit();
      }
    } catch (firestoreErr) {
      console.warn("Delete account bookPhotos cleanup failed:", firestoreErr);
    }

    // 3. Delete Firebase Auth account (may require recent login)
    try {
      await user.delete();
    } catch (authErr) {
      if (authErr.code === "auth/requires-recent-login") {
        // Re-authenticate then retry
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        await auth.signInWithPopup(provider);
        await auth.currentUser.delete();
      } else {
        throw authErr;
      }
    }

    // Clear local state and show sign-in screen
    books = [];
    shelves = [];
    researchCache = {};
    localStorage.removeItem(`activeShelf_${uid}`);
    // onAuthStateChanged will handle showing the auth overlay

  } catch (err) {
    console.error("Delete account error:", err);
    alert("Error deleting account: " + (err.message || err.code || err) + "\n\nPlease try again or contact support.");
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// Debounce timer for transient null auth events (e.g. returning from native camera).
// Firebase briefly fires null then re-fires the user when the app returns to foreground.
// Without this guard, that null event wipes all state mid-workflow.
