// Catalog render slice extracted from page.js.

function setMobileSection(name) {
  if (window.innerWidth >= 1024) return;
  const map = { add: "addPanel", catalog: "catalogPanel", briefing: "briefingPanel" };
  Object.values(map).forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("mobile-active", id === map[name]);
  });
  // Briefing is a sub-view of Library â€” keep the Library button highlighted
  const navName = name === "briefing" ? "catalog" : name;
  document.querySelectorAll(".mobile-nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.section === navName);
  });
  // Push a history entry when entering briefing so the phone back button returns here
  if (name === "briefing") {
    history.pushState({ tomeshelfSection: "briefing" }, "");
  }
  // When returning to catalog, scroll the last-viewed book into view
  if (name === "catalog" && selectedBookId) {
    requestAnimationFrame(() => {
      const card = document.querySelector(`.book-card[data-book-id="${selectedBookId}"]`);
      if (card) card.scrollIntoView({ block: "center", behavior: "instant" });
    });
  }
  updateHeaderBadge();
}

// Intercept the phone/browser back button while briefing is open
window.addEventListener("popstate", function (e) {
  if (window.innerWidth >= 1024) return;
  const briefingPanel = document.getElementById("briefingPanel");
  if (briefingPanel && briefingPanel.classList.contains("mobile-active")) {
    setMobileSection("catalog");
  }
});


function renderCatalog() {
  const query = document.getElementById("searchInput").value.toLowerCase().trim();
  const sort = document.getElementById("sortSelect").value;

  const shelfBooks = getShelfBooks(currentShelfId);

  let list = shelfBooks.filter((book) => {
    if (filterStatus && book.readingStatus !== filterStatus) {
      return false;
    }
    if (!query) {
      return true;
    }
    return [book.title, book.author, book.subjects, book.notes, book.personalNotes, book.publisher, book.isbn, book.shelf, book.rating, book.readingStatus, book.startDate, book.finishDate]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });

  if (sort === "has-photos") {
    list = list.filter(function(book) { return bookHasAdditionalPhotos(book); });
  }

  list = [...list].sort((a, b) => compareBooksBySort(a, b, sort));

  renderStats();

  updateHeaderBadge(shelfBooks.length);

  const grid = document.getElementById("bookGrid");
  if (catalogLoading && !books.length) {
    grid.innerHTML = renderSkeletonCards(3);
    return;
  }
  if (!list.length) {
    grid.innerHTML = shelfBooks.length
      ? `<div class="empty-state"><p>No books match your search.</p><div class="empty-state-actions"><button class="btn btn-light btn-sm" type="button" onclick="document.getElementById('searchInput').value='';renderCatalog()">Clear search</button></div></div>`
      : `<div class="empty-state"><p>This shelf is empty. Start with one book, or use bulk load for a stack.</p><div class="empty-state-actions"><button class="btn btn-secondary btn-sm" type="button" onclick="goToAddFlow('isbn','photo')">Identify One Book</button><button class="btn btn-light btn-sm" type="button" onclick="goToAddFlow('bulk')">Add Many Books</button></div></div>`;
    return;
  }

  _filteredBookIds = list.map((b) => b.id);
  grid.innerHTML = list.map((book) => renderBookCard(book)).join("");
}

function renderBookCard(book) {
  const isSelected = book.id === selectedBookId;
  const condClass = book.condition ? `cond-${book.condition.toLowerCase()}` : "";
  const statusClass = book.readingStatus ? `status-${book.readingStatus.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : "";
  const rating = Number(book.rating || 0);
  const stars = rating ? `${"&#9733;".repeat(rating)}${"&#9734;".repeat(5 - rating)}` : "";
  const thumb = book.coverUrl
    ? `<img src="${escapeAttribute(book.coverUrl)}" alt="" onerror="handleCoverError(this)">`
    : bookIconSVG();

  const cardMeta = [
    book.year ? esc(book.year) : "",
    book.finishDate ? `Finished ${esc(book.finishDate)}` : ""
  ].filter(Boolean);

  const isSelChecked = selectionMode && selectedBookIds.has(book.id);
  const selClass = selectionMode ? (isSelChecked ? " in-selection-mode selection-checked" : " in-selection-mode") : (isSelected ? " selected" : "");
  const clickFn = `handleBookCardClick('${escapeAttribute(book.id)}')`;
  const dragEnabled = canUseDragReorder();
  const dragHandle = dragEnabled
    ? `<button class="drag-handle" type="button" draggable="true" title="Drag to reorder" aria-label="Drag to reorder" onmousedown="event.stopPropagation()" onclick="event.stopPropagation()" ondragstart="startBookDrag(event,'${escapeAttribute(book.id)}')" ondragend="endBookDrag()"></button>`
    : "";

  return `
    <div class="book-card${selClass}${dragEnabled ? " reorderable" : ""}" data-book-id="${escapeAttribute(book.id)}" onclick="${clickFn}">
      ${dragHandle}
      ${selectionMode ? `<div class="select-indicator">${isSelChecked ? "&#10003;" : ""}</div>` : ""}
      <div class="book-cover-thumb">${thumb}</div>
      <div class="book-info">
        <div class="book-title">${esc(book.title)}</div>
        ${book.author ? `<div class="book-author">${esc(book.author)}</div>` : ""}
        ${cardMeta.length ? `<div class="book-meta" style="margin-top:4px;">${cardMeta.map((m) => `<span>${m}</span>`).join("")}</div>` : ""}
        <div class="book-meta" style="margin-top:4px;">
          ${book.condition ? `<span class="condition-badge ${condClass}">${esc(book.condition)}</span>` : ""}
          ${book.readingStatus ? `<span class="condition-badge ${statusClass}">${esc(book.readingStatus)}</span>` : ""}
        </div>
        ${rating ? `<div class="rating-display" aria-label="${rating} out of 5 stars">${stars}</div>` : ""}
        ${pendingBriefingIds.includes(book.id) && !researchCache[book.id] ? `<div class="book-research-meta pending" style="margin-top:4px;">&#8987; Queued</div>` : ""}
      </div>
    </div>`;
}

// â”€â”€ Selection mode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function handleBookCardClick(id) {
  if (selectionMode) { toggleBookSelected(id); }
  else { openBriefing(id); }
}

function toggleSelectionMode() {
  clearBookDragState();
  selectionMode = !selectionMode;
  selectedBookIds = new Set();
  document.getElementById("selectModeBtn").classList.toggle("select-mode-active", selectionMode);
  closeMoveMenu();
  renderCatalog();
  updateSelectionBar();
}

function exitSelectionMode() {
  clearBookDragState();
  selectionMode = false;
  selectedBookIds = new Set();
  document.getElementById("selectModeBtn").classList.remove("select-mode-active");
  closeMoveMenu();
  document.getElementById("selectionActionBar").style.display = "none";
  renderCatalog();
}

function toggleBookSelected(id) {
  if (selectedBookIds.has(id)) {
    selectedBookIds.delete(id);
  } else {
    selectedBookIds.add(id);
  }
  // Update the card's classes in-place to avoid full re-render
  const card = document.querySelector(`.book-card[data-book-id="${CSS.escape(id)}"]`);
  if (card) {
    const checked = selectedBookIds.has(id);
    card.classList.toggle("selection-checked", checked);
    const indicator = card.querySelector(".select-indicator");
    if (indicator) indicator.innerHTML = checked ? "&#10003;" : "";
  }
  updateSelectionBar();
}

function updateSelectionBar() {
  const bar = document.getElementById("selectionActionBar");
  const count = selectedBookIds.size;
  if (!selectionMode || count === 0) {
    bar.style.display = "none";
    return;
  }
  bar.style.display = "flex";
  document.getElementById("selectionCount").textContent = `${count} selected`;
  // Show/hide Move to button: only useful when there are other shelves
  const otherShelves = shelves.filter(s => s.id !== currentShelfId);
  document.getElementById("moveToBtn").style.display = otherShelves.length ? "" : "none";
  const customSortActive = document.getElementById("sortSelect").value === "custom";
  document.getElementById("moveUpBtn").style.display = customSortActive ? "" : "none";
  document.getElementById("moveDownBtn").style.display = customSortActive ? "" : "none";
}

function selectAllVisible() {
  _filteredBookIds.forEach(id => selectedBookIds.add(id));
  renderCatalog();
  updateSelectionBar();
}

function toggleMoveMenu() {
  const menu = document.getElementById("moveMenu");
  const isOpen = menu.style.display !== "none";
  if (isOpen) { menu.style.display = "none"; return; }
  // Populate with other shelves
  const otherShelves = shelves.filter(s => s.id !== currentShelfId);
  if (!otherShelves.length) return;
  menu.innerHTML = otherShelves.map(s =>
    `<button type="button" onclick="moveSelectedBooks('${escapeAttribute(s.id)}')">${esc(s.name)}</button>`
  ).join("");
  menu.style.display = "block";
}

function closeMoveMenu() {
  const menu = document.getElementById("moveMenu");
  if (menu) menu.style.display = "none";
}

async function moveSelectedBooks(targetShelfId) {
  const orderedSelection = getSelectedBooksInDisplayOrder();
  if (!orderedSelection.length) return;
  const targetShelf = shelves.find(s => s.id === targetShelfId);
  let nextCustomOrder = getNextCustomOrderForShelf(targetShelfId);
  orderedSelection.forEach(function(book) {
    book.listShelfId = targetShelfId;
    book.customOrder = nextCustomOrder++;
  });
  await persistCatalog();
  const name = targetShelf ? targetShelf.name : "shelf";
  exitSelectionMode();
  showToast(`${orderedSelection.length} book${orderedSelection.length === 1 ? "" : "s"} moved to ${name}`);
}

async function moveSelectedBooksUp() {
  await moveSelectedBooksByDirection(-1);
}

async function moveSelectedBooksDown() {
  await moveSelectedBooksByDirection(1);
}

async function moveSelectedBooksByDirection(direction) {
  if (!selectedBookIds.size || document.getElementById("sortSelect").value !== "custom") return;
  const ordered = ensureShelfCustomOrderInitialized(currentShelfId);
  const selected = new Set(selectedBookIds);
  let changed = false;

  if (direction < 0) {
    for (let index = 1; index < ordered.length; index++) {
      if (selected.has(ordered[index].id) && !selected.has(ordered[index - 1].id)) {
        const temp = ordered[index - 1];
        ordered[index - 1] = ordered[index];
        ordered[index] = temp;
        changed = true;
      }
    }
  } else {
    for (let index = ordered.length - 2; index >= 0; index--) {
      if (selected.has(ordered[index].id) && !selected.has(ordered[index + 1].id)) {
        const temp = ordered[index + 1];
        ordered[index + 1] = ordered[index];
        ordered[index] = temp;
        changed = true;
      }
    }
  }

  if (!changed) return;
  reindexShelfCustomOrder(currentShelfId, ordered);
  await persistCatalog();
  renderCatalog();
  updateSelectionBar();
}

async function deleteSelectedBooks() {
  const ids = [...selectedBookIds];
  if (!ids.length) return;
  if (!confirm(`Delete ${ids.length} book${ids.length === 1 ? "" : "s"} from your catalog? This cannot be undone.`)) return;
  const removedBooks = cloneBookEntries(books.filter((b) => ids.includes(b.id)));
  const removedBriefings = cloneBriefingEntries(ids);
  const removedPhotos = cloneBookPhotoEntries(ids);
  const shareTokensToRevoke = ids.map(function(id) {
    const share = activeShareForResource("book", id);
    return share && share.token ? share.token : "";
  }).filter(Boolean);
  books = books.filter(b => !ids.includes(b.id));
  ids.forEach(id => {
    delete researchCache[id];
    delete bookPhotoCache[id];
  });
  pendingBriefingIds = pendingBriefingIds.filter(pid => !ids.includes(pid));
  const user = auth.currentUser;
  await persistCatalog();
  // Delete individual briefing docs from the subcollection
  if (user && _booksOwnedByUid === user.uid) {
    try {
      const batch = db.batch();
      ids.forEach(id => { batch.delete(db.collection("users").doc(user.uid).collection("briefings").doc(id)); });
      await batch.commit();
    } catch (err) { console.error("[deleteSelectedBooks] briefing delete failed:", err); }
  }
  shareTokensToRevoke.forEach(function(token) {
    functions.httpsCallable("revokeShareLink")({ token })
      .then(function() {
        if (shareRecords[token]) shareRecords[token].status = "revoked";
        renderShareManagementSection();
      })
      .catch(function(err) { console.warn("[deleteSelectedBooks] could not revoke book share:", err); });
  });
  if (ids.includes(selectedBookId)) {
    selectedBookId = null;
    renderBriefingPanel();
    if (window.innerWidth < 1024) setMobileSection("catalog");
  }
  exitSelectionMode();
  renderCatalog();
  scheduleBookPhotoCleanup(ids, removedPhotos);
  queueUndo(`${ids.length} book${ids.length === 1 ? "" : "s"} deleted`, async () => {
    await restoreBooksFromUndo(removedBooks, removedBriefings, {
      restoreToFront: true,
      bookPhotosToRestore: removedPhotos
    });
    showToast(`${ids.length} book${ids.length === 1 ? "" : "s"} restored`);
  });
}

let _toastTimer = null;
let _toastAction = null;
function showToast(message, actionLabel = "", actionFn = null) {
  let el = document.getElementById("toastNotification");
  if (!el) {
    el = document.createElement("div");
    el.id = "toastNotification";
    document.body.appendChild(el);
  }
  _toastAction = typeof actionFn === "function" ? actionFn : null;
  el.innerHTML = `<span>${esc(message)}</span>${actionLabel ? `<button class="toast-action-btn" type="button" onclick="runToastAction()">${esc(actionLabel)}</button>` : ""}`;
  el.classList.add("visible");
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    el.classList.remove("visible");
    _toastAction = null;
  }, actionLabel ? 6000 : 2500);
}

function runToastAction() {
  const action = _toastAction;
  _toastAction = null;
  const el = document.getElementById("toastNotification");
  if (el) el.classList.remove("visible");
  if (typeof action === "function") action();
}

function cloneBookEntries(entries = []) {
  return entries.map((entry) => ({ ...entry }));
}

function cloneBriefingEntries(ids = []) {
  const out = {};
  ids.forEach((id) => {
    if (researchCache[id]) out[id] = JSON.parse(JSON.stringify(researchCache[id]));
  });
  return out;
}

function cloneBookPhotoEntries(ids = []) {
  const out = {};
  ids.forEach((id) => {
    const photos = getBookPhotos(id);
    if (photos.length) out[id] = JSON.parse(JSON.stringify(photos));
  });
  return out;
}

async function restoreBooksFromUndo(booksToRestore = [], briefingsToRestore = {}, options = {}) {
  const restoreToFront = options.restoreToFront !== false;
  const removeIds = new Set((options.removeIds || []).filter(Boolean));
  const bookPhotosToRestore = options.bookPhotosToRestore && typeof options.bookPhotosToRestore === "object"
    ? options.bookPhotosToRestore
    : {};
  if (removeIds.size) {
    books = books.filter((book) => !removeIds.has(book.id));
    removeIds.forEach((id) => {
      delete researchCache[id];
      delete bookPhotoCache[id];
      pendingBriefingIds = pendingBriefingIds.filter((pid) => pid !== id);
    });
  }
  const restored = cloneBookEntries(booksToRestore);
  if (restoreToFront) books = [...restored, ...books];
  else books = [...books, ...restored];
  Object.entries(briefingsToRestore || {}).forEach(([id, briefing]) => {
    researchCache[id] = briefing;
  });
  Object.entries(bookPhotosToRestore).forEach(([id, photos]) => {
    bookPhotoCache[id] = sanitizeBookPhotoList(photos);
  });
  await persistCatalog();
  await Promise.all(Object.entries(briefingsToRestore || {}).map(([id, briefing]) => saveBriefing(id, briefing).catch(() => {})));
  await Promise.all(Object.entries(bookPhotosToRestore).map(([id, photos]) => saveBookPhotos(id, photos).catch(() => {})));
  renderCatalog();
  renderBriefingPanel();
}

function queueUndo(message, actionFn) {
  showToast(message, "Undo", actionFn);
}

function scheduleBookPhotoCleanup(bookIds, photosByBookId) {
  const ids = Array.isArray(bookIds) ? bookIds.filter(Boolean) : [];
  if (!ids.length) return;
  const user = auth.currentUser;
  const uid = user && _booksOwnedByUid === user.uid ? user.uid : "";
  if (!uid) return;
  window.setTimeout(function() {
    if (!auth.currentUser || auth.currentUser.uid !== uid) return;
    ids.forEach(function(id) {
      if (findBook(id)) return;
      db.collection("users").doc(uid).collection("bookPhotos").doc(id).delete()
        .catch(err => console.error("[scheduleBookPhotoCleanup] doc delete failed:", err));
      (photosByBookId[id] || []).forEach(function(photo) {
        if (!photo || !photo.storagePath) return;
        storage.ref(photo.storagePath).delete()
          .catch(err => console.error("[scheduleBookPhotoCleanup] storage delete failed:", err));
      });
    });
  }, 6500);
}

// â”€â”€ Close move menu when clicking outside â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
document.addEventListener("click", (e) => {
  const wrap = document.getElementById("moveMenu")?.closest(".move-menu-wrap");
  if (wrap && !wrap.contains(e.target)) closeMoveMenu();
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function deleteBook(id) {
  if (!confirm("Remove this book from the catalog?")) {
    return;
  }
  const removedBook = cloneBookEntries(books.filter((book) => book.id === id));
  const removedBriefings = cloneBriefingEntries([id]);
  const removedPhotos = getBookPhotos(id);
  const activeBookShare = activeShareForResource("book", id);
  books = books.filter((book) => book.id !== id);
  delete researchCache[id];
  delete bookPhotoCache[id];
  pendingBriefingIds = pendingBriefingIds.filter(pid => pid !== id);
  const user = auth.currentUser;
  await persistCatalog();
  // Delete the briefing doc from the subcollection
  if (user && _booksOwnedByUid === user.uid) {
    db.collection("users").doc(user.uid).collection("briefings").doc(id).delete()
      .catch(err => console.error("[deleteBook] briefing delete failed:", err));
  }
  if (activeBookShare && activeBookShare.token) {
    functions.httpsCallable("revokeShareLink")({ token: activeBookShare.token })
      .then(function() {
        if (shareRecords[activeBookShare.token]) shareRecords[activeBookShare.token].status = "revoked";
        renderShareManagementSection();
      })
      .catch(function(err) { console.warn("[deleteBook] could not revoke book share:", err); });
  }
  if (selectedBookId === id) {
    selectedBookId = null;
    renderBriefingPanel();
    if (window.innerWidth < 1024) setMobileSection("catalog");
  }
  renderCatalog();
  scheduleBookPhotoCleanup([id], { [id]: removedPhotos });
  queueUndo("Book removed from catalog", async () => {
    await restoreBooksFromUndo(removedBook, removedBriefings, {
      restoreToFront: true,
      bookPhotosToRestore: { [id]: removedPhotos }
    });
    showToast("Book restored");
  });
}

function findBook(id) {
  return books.find((book) => book.id === id) || null;
}

function openBriefing(id) {
  selectedBookId = id;
  renderCatalog();
  renderBriefingPanel();
  setMobileSection("briefing");
}

async function generateResearch(id, forceRefresh) {
  selectedBookId = id;
  renderBriefingPanel();
  await generateResearchForSelected(forceRefresh);
}
async function generateResearchForSelected(forceRefresh) {
  const book = selectedBookId ? findBook(selectedBookId) : null;
  if (!book) {
    setResearchStatus("Select a book first.", "error");
    return;
  }
  if (!researchEnabled) {
    setResearchStatus("Sign in to enable book briefings.", "error");
    return;
  }
  if (researchRequestInFlight) {
    return;
  }
  if (researchCache[book.id] && !forceRefresh) {
    renderBriefingPanel();
    return;
  }

  researchRequestInFlight = true;
  updateResearchButtons();
  setResearchStatus(`Generating a briefing for \"${book.title}\"...`, "");
  document.getElementById("briefingContent").innerHTML = `<div class="briefing-empty"><p>Perplexity is preparing a structured discussion guide.</p></div>`;

  try {
    const generateBriefingFn = functions.httpsCallable("generateBriefing");
    const result = await generateBriefingFn({
      book,
      adminPassword: ""
    });
    const research = result.data && result.data.research;
    if (result.data && typeof result.data.adminAccessValid === "boolean") {
      adminAccessState.adminAccessValid = Boolean(result.data.adminAccessValid);
      adminAccessState.adminAccessDisabled = Boolean(result.data.adminAccessDisabled);
      adminAccessState.adminAccessStale = Boolean(result.data.adminAccessStale);
      adminAccessState.hasStoredAdminAccess = Boolean(result.data.hasStoredAdminAccess)
        || adminAccessState.adminAccessValid
        || adminAccessState.adminAccessDisabled
        || adminAccessState.adminAccessStale;
    }
    if (!research || typeof research !== "object") {
      throw new Error("The server returned an empty briefing. Please try again.");
    }
    researchCache[book.id] = research;
    pendingBriefingIds = pendingBriefingIds.filter(pid => pid !== book.id);
    await saveBriefing(book.id, research);
    if (book.briefingNeedsRegeneration) {
      book.briefingNeedsRegeneration = false;
      await saveBooks();
    }
    // Re-stamp after the await: an onSnapshot from a concurrent background
    // write can arrive during the yield and overwrite researchCache with the
    // older Firestore state (no briefing yet), clearing what we just set.
    researchCache[book.id] = research;
    renderCatalog();
    renderBriefingPanel();
    setResearchStatus(`Briefing ready for \"${book.title}\".`, "success");
  } catch (error) {
    const message = getCallableErrorMessage(error, "Research request failed.");
    if (error && error.code === "resource-exhausted") {
      const entered = prompt(message + "\n\nAdmin Access: enter the password to enable administrative access for this account.");
      if (entered) {
        try {
          const generateBriefingFn = functions.httpsCallable("generateBriefing");
          const retryResult = await generateBriefingFn({
            book,
            adminPassword: entered
          });
          const retryResearch = retryResult.data && retryResult.data.research;
          if (retryResult.data && typeof retryResult.data.adminAccessValid === "boolean") {
            adminAccessState.adminAccessValid = Boolean(retryResult.data.adminAccessValid);
            adminAccessState.adminAccessDisabled = Boolean(retryResult.data.adminAccessDisabled);
            adminAccessState.adminAccessStale = Boolean(retryResult.data.adminAccessStale);
            adminAccessState.hasStoredAdminAccess = Boolean(retryResult.data.hasStoredAdminAccess)
              || adminAccessState.adminAccessValid
              || adminAccessState.adminAccessDisabled
              || adminAccessState.adminAccessStale;
          }
          if (!retryResearch || typeof retryResearch !== "object") {
            throw new Error("The server returned an empty briefing. Please try again.");
          }
          researchCache[book.id] = retryResearch;
          pendingBriefingIds = pendingBriefingIds.filter(pid => pid !== book.id);
          await saveBriefing(book.id, retryResearch);
          if (book.briefingNeedsRegeneration) {
            book.briefingNeedsRegeneration = false;
            await saveBooks();
          }
          researchCache[book.id] = retryResearch;
          renderCatalog();
          renderBriefingPanel();
          setResearchStatus(`Briefing ready for "${book.title}". Administrative access is active for this account.`, "success");
          return;
        } catch (overrideError) {
          setResearchStatus(getCallableErrorMessage(overrideError, "Admin Access failed."), "error");
          renderBriefingPanel();
          return;
        }
      }
      setResearchStatus(message, "error");
    } else {
      setResearchStatus(message, "error");
    }
    renderBriefingPanel();
  } finally {
    researchRequestInFlight = false;
    updateResearchButtons();
  }
}

function renderBriefingPanel() {
  const headerEl = document.getElementById("bookDetailHeader");
  const actionsEl = document.getElementById("bookDetailActions");
  const content = document.getElementById("briefingContent");
  const book = selectedBookId ? findBook(selectedBookId) : null;

  if (!book) {
    headerEl.innerHTML = "";
    actionsEl.style.display = "none";
    content.innerHTML = books.length
      ? `<div class="briefing-empty"><p>Choose a book to view its details and discussion guide.</p><div class="empty-state-actions"><button class="btn btn-light btn-sm" type="button" onclick="document.getElementById('searchInput').focus()">Search your shelf</button></div></div>`
      : `<div class="briefing-empty"><p>Add your first book to start building briefings and discussion guides.</p><div class="empty-state-actions"><button class="btn btn-secondary btn-sm" type="button" onclick="goToAddFlow('isbn','photo')">Identify One Book</button><button class="btn btn-light btn-sm" type="button" onclick="goToAddFlow('bulk')">Add Many Books</button></div></div>`;
    document.getElementById("spoilerToggleLabel").style.display = "none";
    updateResearchButtons();
    updateNavArrows();
    return;
  }

  // â”€â”€ Render book detail header â”€â”€
  const rating = Number(book.rating || 0);
  const stars = rating ? `${"&#9733;".repeat(rating)}${"&#9734;".repeat(5 - rating)}` : "";
  const condClass = book.condition ? `cond-${book.condition.toLowerCase()}` : "";
  const statusClass = book.readingStatus ? `status-${book.readingStatus.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : "";
  const readingDates = [
    book.startDate ? `Started ${book.startDate}` : "",
    book.finishDate ? `Finished ${book.finishDate}` : ""
  ].filter(Boolean);
  const coverHtml = book.coverUrl
    ? `<img src="${escapeAttribute(book.coverUrl)}" alt="" onerror="handleCoverError(this)" onclick="showCoverLightbox('${escapeAttribute(book.coverUrl)}')" style="cursor:zoom-in;" title="Click to enlarge"><button class="cover-replace-btn" type="button" onclick="event.stopPropagation();pickCoverForBook('${escapeAttribute(book.id)}')" title="Replace cover">Replace</button>`
    : `<div class="cover-add-btn" onclick="pickCoverForBook('${escapeAttribute(book.id)}')" title="Add cover image">${bookIconSVG()}<span class="cover-add-label">Add cover</span></div>`;

  headerEl.innerHTML = `
    <div class="book-detail-header">
      <div class="book-detail-cover">${coverHtml}</div>
      <div class="book-detail-info">
        <div class="book-detail-title">${esc(book.title)}</div>
        ${book.author ? `<div class="book-detail-author">${esc(book.author)}</div>` : ""}
        <div class="book-detail-meta">
          ${book.year ? `<span>Year ${esc(book.year)}</span>` : ""}
          ${book.publisher ? `<span>${esc(book.publisher)}</span>` : ""}
          ${book.isbn ? `<span>ISBN ${esc(book.isbn)}</span>` : ""}
          ${book.edition ? `<span>${esc(book.edition)}</span>` : ""}
          ${book.shelf ? `<span>Shelf ${esc(book.shelf)}</span>` : ""}
        </div>
        <div class="book-detail-meta">
          ${book.condition ? `<span class="condition-badge ${condClass}">${esc(book.condition)}</span>` : ""}
          ${book.readingStatus ? `<span class="condition-badge ${statusClass}">${esc(book.readingStatus)}</span>` : ""}
        </div>
        ${readingDates.length ? `<div class="book-detail-meta">${readingDates.map((d) => `<span>${esc(d)}</span>`).join("")}</div>` : ""}
        ${rating ? `<div class="rating-display" style="margin-top:6px;" aria-label="${rating} out of 5 stars">${stars} ${rating}/5</div>` : ""}
        ${book.subjects ? `<div class="book-detail-meta">Subjects: ${esc(book.subjects)}</div>` : ""}
        ${book.notes ? `<div class="book-detail-notes">${esc(book.notes)}</div>` : ""}
        ${book.personalNotes ? `<div class="book-detail-personal-notes"><strong>Your notes:</strong> ${esc(book.personalNotes)}</div>` : ""}
      </div>
    </div>
    ${renderBookPhotoSection(book, false)}`;

  // â”€â”€ Show action buttons and wire them â”€â”€
  actionsEl.style.display = "";
  document.getElementById("editBookDetailBtn").onclick = () => startEditBook(book.id);
  document.getElementById("removeBookDetailBtn").onclick = () => deleteBook(book.id);
  const shareBookBtn = document.getElementById("shareBookDetailBtn");
  if (shareBookBtn) {
    shareBookBtn.textContent = activeShareForResource("book", book.id) ? "Manage Share" : "Share Book";
    shareBookBtn.onclick = () => openShareDialogForSelectedBook();
  }
  refreshBookDetailActionPresentation();

  // â”€â”€ Render briefing content â”€â”€
  const briefing = researchCache[book.id];
  if (!briefing) {
    const isPending = pendingBriefingIds.includes(book.id);
    content.innerHTML = isPending
      ? `<div class="briefing-empty"><p>&#8987; Briefing queued â€” click Generate to create it now, or it will run automatically.</p></div>`
      : `<div class="briefing-empty"><p>No briefing has been generated yet for this book.</p></div>`;
    document.getElementById("spoilerToggleLabel").style.display = "none";
    updateResearchButtons();
    updateNavArrows();
    return;
  }

  const genre = (briefing.genre || "").toLowerCase();
  const isFiction = genre === "fiction";
  const isReference = genre === "reference";
  const spoilerToggle = document.getElementById("spoilerToggleLabel");
  const canToggleSpoilers = false; // Spoiler toggle intentionally disabled.
  spoilerToggle.style.display = "none";
  document.getElementById("spoilerToggle").checked = false;
  const showSpoilers = false;

  // Pick the right field variant based on genre and spoiler toggle
  const summaryText = isFiction
    ? (showSpoilers ? briefing.summary_spoiler : (briefing.summary_safe || briefing.summary))
    : (isReference ? briefing.editorial_approach : briefing.summary);
  const keyElems = isFiction
    ? (showSpoilers ? briefing.key_elements_spoiler : (briefing.key_elements_safe || briefing.key_elements))
    : (isReference ? briefing.contents_overview : briefing.key_elements);
  const craftText = isFiction
    ? (showSpoilers ? briefing.craft_analysis_spoiler : (briefing.craft_analysis_safe || briefing.craft_analysis))
    : (isReference ? briefing.production_notes : briefing.craft_analysis);
  const discussionList = isFiction
    ? (showSpoilers ? briefing.discussion_questions_spoiler : (briefing.discussion_questions_safe || briefing.discussion_questions))
    : (isReference ? briefing.notable_features : briefing.discussion_questions);
  const spoilerMode    = showSpoilers ? "spoiler" : "safe";
  const audioVariant   = getBriefingAudioVariant(book.id, spoilerMode);
  const audioKey       = currentAudioKey(book.id, spoilerMode);
  const audioUrl       = briefingAudioUrls[audioKey] || "";
  const audioUrlError  = briefingAudioUrlErrors[audioKey] || "";
  const isFlashRateLimitAudio = isDailyRateLimitFallbackAudio(audioVariant);
  const isAdminRequiredAudio = audioVariant && audioVariant.ttsFallbackReason === "admin-required";

  if (audioVariant && audioVariant.status === "ready" && audioVariant.audioPath && !audioUrl && !audioUrlError) {
    ensureBriefingAudioUrl(book.id, spoilerMode, audioVariant);
  }

  const takeawaysHtml = !isFiction && !isReference && briefing.key_takeaways && briefing.key_takeaways.length
    ? `<div class="briefing-section">
        <h3>Key Takeaways</h3>
        ${renderList(briefing.key_takeaways, "briefing-list")}
      </div>` : "";
  const idealForHtml = isReference && briefing.ideal_for
    ? `<div class="briefing-section">
        <h3>Ideal For</h3>
        <p>${paragraphize(briefing.ideal_for)}</p>
      </div>` : "";

  const audioHtml = !audioVariant ? ""
    : audioVariant.status === "generating"
      ? (isBriefingAudioGeneratingStale(audioVariant)
          ? `<div class="briefing-section">
              <h3>Audio Overview</h3>
              <p>A previous audio generation attempt appears to be stuck.</p>
              <button class="btn btn-light btn-sm" type="button" onclick="generateBriefingAudioForSelected(true)">Retry Audio</button>
            </div>`
          : `<div class="briefing-section"><h3>Audio Overview</h3><p>Preparing an audio version of this briefing...</p></div>`)
      : audioVariant.status === "error"
        ? `<div class="briefing-section">
            <h3>Audio Overview</h3>
            <p>${esc(audioVariant.error || "Audio generation failed.")}</p>
            <button class="btn btn-light btn-sm" type="button" onclick="generateBriefingAudioForSelected(true)">Retry Audio</button>
          </div>`
        : audioUrlError
          ? `<div class="briefing-section">
              <h3>Audio Overview</h3>
              <p>${esc(audioUrlError)}</p>
              <button class="btn btn-light btn-sm" type="button" onclick="retryBriefingAudioUrl('${escapeAttribute(book.id)}', '${spoilerMode}')">Retry Player</button>
            </div>`
        : `<div class="briefing-section">
            <h3>Audio Overview</h3>
            <p>Voice: ${esc(audioVariant.voice || "Kore")} ${audioVariant.durationSec ? `&middot; ${formatAudioDuration(audioVariant.durationSec)}` : ""}</p>
            ${isFlashRateLimitAudio ? `<p>Lower Quality Audio Due to Daily Rate Limit.</p>` : ""}
            ${isAdminRequiredAudio ? `<p>Flash TTS was used because Administrative Access is required for Pro audio.</p>` : ""}
            ${isFlashRateLimitAudio && briefingAudioProAvailableToday && adminAccessState.adminAccessValid
              ? `<button class="btn btn-light btn-sm" type="button" onclick="generateBriefingAudioForSelected(true)">Regenerate Higher Quality Audio</button>`
              : ""}
            ${audioUrl
              ? `<audio controls preload="none" style="width:100%;margin-top:8px;"><source src="${escapeAttribute(audioUrl)}" type="audio/wav"></audio>`
              : `<p>Loading audio player...</p>`}
          </div>`;

  content.innerHTML = `
    ${audioHtml}
    <div class="briefing-section">
      <h3>Quick Take</h3>
      <p>${esc(briefing.quick_take)}</p>
    </div>
    <div class="briefing-section">
      <h3>${isFiction ? "Plot Summary" : (isReference ? "Editorial Approach" : "Overview")}</h3>
      <p>${paragraphize(summaryText)}</p>
    </div>
    <div class="briefing-section">
      <h3>Major Themes</h3>
      ${renderList(briefing.major_themes, "briefing-list")}
    </div>
    <div class="briefing-section">
      <h3>${isFiction ? "Characters" : (isReference ? "Contents Overview" : "Key Concepts &amp; Figures")}</h3>
      ${renderList(keyElems, "briefing-list")}
    </div>
    <div class="briefing-section">
      <h3>Historical and Cultural Context</h3>
      <p>${paragraphize(briefing.historical_context)}</p>
    </div>
    <div class="briefing-section">
      <h3>${isFiction ? "Literary Analysis" : (isReference ? "Production Notes" : "Analysis &amp; Methodology")}</h3>
      <p>${paragraphize(craftText)}</p>
    </div>
    ${takeawaysHtml}
    ${idealForHtml}
    <div class="briefing-section">
      <h3>Impact</h3>
      <p>${paragraphize(briefing.impact)}</p>
    </div>
    <div class="briefing-section">
      <h3>${isReference ? "Notable Features" : "Discussion Questions"}</h3>
      ${renderList(discussionList, "questions-list")}
    </div>
    <div class="briefing-section">
      <h3>Confidence Note</h3>
      <p>${paragraphize(briefing.confidence_note)}</p>
      <div class="book-research-meta">
        <span>Generated ${(briefing.generated_at || "").slice(0, 10)}</span>
        <span>${esc(briefing.model || "")}</span>
      </div>
    </div>`;
  updateResearchButtons();
  updateNavArrows();
}

function navigateBook(delta) {
  if (!selectedBookId || !_filteredBookIds.length) return;
  const idx = _filteredBookIds.indexOf(selectedBookId);
  if (idx === -1) return;
  const newIdx = idx + delta;
  if (newIdx < 0 || newIdx >= _filteredBookIds.length) return;
  openBriefing(_filteredBookIds[newIdx]);
}

function updateNavArrows() {
  const prevBtn = document.getElementById("prevBookBtn");
  const nextBtn = document.getElementById("nextBookBtn");
  if (!prevBtn || !nextBtn) return;
  const idx = _filteredBookIds.indexOf(selectedBookId);
  const hasPrev = idx > 0;
  const hasNext = idx !== -1 && idx < _filteredBookIds.length - 1;
  prevBtn.disabled = !hasPrev;
  prevBtn.style.opacity = hasPrev ? "1" : "0.4";
  nextBtn.disabled = !hasNext;
  nextBtn.style.opacity = hasNext ? "1" : "0.4";
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Wikipedia Lookup  â€” Pass A: direct REST, Pass B: Gemini resolve
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// Wikidata short descriptions for book pages almost always contain one of these
// Pass B: Ask Gemini (via Cloud Function) for the exact Wikipedia article titles,
// then fetch them directly. Full title is sent â€” subtitle helps Gemini identify the book.
async function _wikiGeminiLookup(book) {
  const resolveWikiFn = functions.httpsCallable("resolveWikipediaArticles");
  let data;
  try {
    const result = await resolveWikiFn({ title: book.title, author: book.author || "" });
    data = result.data || {};
  } catch (err) {
    console.error("[_wikiGeminiLookup] Cloud Function error:", err);
    return null;
  }

  const { book_article, author_article } = data;

  if (book_article) {
    const s = await _wikiGetSummary(book_article);
    if (s) return { summary: s, notice: "" };
  }

  if (author_article) {
    const s = await _wikiGetSummary(author_article);
    if (s) return {
      summary: s,
      notice: "No Wikipedia article was found for this book \u2014 showing the author\u2019s page instead."
    };
  }

  return null;
}

async function lookupWikipedia() {
  const book = selectedBookId ? findBook(selectedBookId) : null;
  if (!book) return;

  const modal   = document.getElementById("wikiModal");
  const content = document.getElementById("wikiModalContent");

  const loadingHtml = (msg) => `
    <div style="padding:48px 20px;text-align:center;">
      <div style="font-family:'EB Garamond',serif;font-size:1rem;color:var(--brown);">${msg}</div>
    </div>`;

  content.innerHTML = loadingHtml("Checking Wikipedia\u2026");
  modal.classList.add("open");

  try {
    // Pass A: direct REST lookup by title + author verification â€” fast, no AI needed
    const direct = await _wikiDirectBookLookup(book.title, book.author);
    if (direct) {
      content.innerHTML = renderWikiSummary(direct);
      return;
    }

    // Pass B: Gemini identifies the exact Wikipedia article titles
    content.innerHTML = loadingHtml("Asking AI to identify the Wikipedia page\u2026");
    const gemini = await _wikiGeminiLookup(book);
    if (gemini) {
      content.innerHTML = renderWikiSummary(gemini.summary, gemini.notice);
      return;
    }

    content.innerHTML = renderWikiNotFound(book);
  } catch (err) {
    console.error("[lookupWikipedia]", err);
    content.innerHTML = `
      <div class="wiki-not-found">
        <div style="font-size:1.6rem;margin-bottom:10px;">\u26A0\uFE0F</div>
        <div style="color:var(--dark);margin-bottom:6px;">Could not reach Wikipedia.</div>
        <div style="color:var(--brown);font-size:0.88rem;margin-bottom:18px;">Please check your connection and try again.</div>
        <button class="btn btn-light btn-sm" onclick="closeWikipediaModal()">Close</button>
      </div>`;
  }
}

function searchReviewsForSelected() {
  const book = selectedBookId ? findBook(selectedBookId) : null;
  if (!book) return;
  const query = [book.title || "", book.author || "", "review"].filter(Boolean).join(" ");
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

function renderWikiSummary(data, notice = "") {
  const thumb       = data.thumbnail ? data.thumbnail.source : null;
  const thumbHtml   = thumb ? `<img class="wiki-modal-thumb" src="${escapeAttribute(thumb)}" alt="">` : "";
  const title       = esc(data.title || "");
  const description = esc(data.description || "");
  const articleUrl  = (data.content_urls && data.content_urls.desktop && data.content_urls.desktop.page)
                      || `https://en.wikipedia.org/wiki/${encodeURIComponent(data.title || "")}`;

  const paragraphs  = (data.extract || "")
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p)}</p>`)
    .join("");

  const noticeHtml = notice ? `<div class="wiki-notice">${esc(notice)}</div>` : "";

  return `
    <div class="wiki-modal-header">
      ${thumbHtml}
      <div style="min-width:0;flex:1;">
        <div class="wiki-modal-title">${title}</div>
        ${description ? `<div class="wiki-modal-description">${description}</div>` : ""}
      </div>
    </div>
    ${noticeHtml}
    <div class="wiki-modal-body">${paragraphs}</div>
    <div class="wiki-modal-footer">
      <span class="wiki-attribution">Source: Wikipedia, the Free Encyclopedia</span>
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
        <a class="btn btn-secondary btn-sm" href="${escapeAttribute(articleUrl)}" target="_blank" rel="noopener noreferrer">Read full article &#8594;</a>
        <button class="btn btn-light btn-sm" onclick="closeWikipediaModal()">Close</button>
      </div>
    </div>`;
}

function renderWikiNotFound(book) {
  const wikiSearchUrl = `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent([book.title, book.author].filter(Boolean).join(" "))}`;
  return `
    <div class="wiki-not-found">
      <div style="font-size:2rem;margin-bottom:12px;">ðŸ“š</div>
      <div style="font-family:'Playfair Display',serif;color:var(--dark);font-size:1.05rem;margin-bottom:8px;">No Wikipedia page found for this book or author.</div>
      <div style="font-family:'EB Garamond',serif;color:var(--brown);font-size:0.9rem;margin-bottom:20px;">
        You can try searching Wikipedia directly â€” it may be listed under a different title.
      </div>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
        <a class="btn btn-secondary btn-sm" href="${escapeAttribute(wikiSearchUrl)}" target="_blank" rel="noopener noreferrer">Search Wikipedia &#8594;</a>
        <button class="btn btn-light btn-sm" onclick="closeWikipediaModal()">Close</button>
      </div>
    </div>`;
}

function closeWikipediaModal(event) {
  if (event && event.target !== document.getElementById("wikiModal")) return;
  document.getElementById("wikiModal").classList.remove("open");
}

function updateResearchButtons() {
  const book = selectedBookId ? findBook(selectedBookId) : null;
  const btn = document.getElementById("generateBriefingBtn");
  const audioBtn = document.getElementById("listenBriefingBtn");
  const briefing = book && researchCache[book.id];
  const briefingNeedsRegeneration = Boolean(book && book.briefingNeedsRegeneration);
  const isPending = book && pendingBriefingIds.includes(book.id);
  const spoilerMode = book && briefing ? currentSpoilerModeForBook(book, briefing) : "safe";
  const audioVariant = book && briefing ? getBriefingAudioVariant(book.id, spoilerMode) : null;

  btn.style.display = "";
  if (researchRequestInFlight) {
    btn.disabled = true;
    btn.textContent = "Workingâ€¦";
    btn.onclick = null;
  } else if (isPending && !briefing) {
    btn.disabled = false;
    btn.textContent = "Generate";
    btn.onclick = () => generateResearchForSelected(false);
  } else if (briefing && !briefingNeedsRegeneration && (briefing.model || "gemini-2.5-flash") === expectedBriefingModel(book)) {
    // Briefing is current model for this book â€” hide regenerate button
    btn.style.display = "none";
  } else if (briefing) {
    // Wrong model or manually stale metadata â€” offer regenerate
    btn.disabled = false;
    btn.textContent = "Regenerate";
    btn.onclick = confirmRegenerate;
  } else {
    btn.disabled = !book;
    btn.textContent = "Generate";
    btn.onclick = () => generateResearchForSelected(false);
  }
  setActionButtonPresentation(btn, btn && btn.textContent ? btn.textContent.trim() : "Generate", "generate");

  if (!audioBtn) return;
  audioBtn.style.display = "";
  if (briefingAudioRequestInFlight) {
    audioBtn.disabled = true;
    audioBtn.textContent = "Working...";
    audioBtn.onclick = null;
  } else if (!book || !briefing) {
    audioBtn.disabled = true;
    audioBtn.textContent = "Listen";
    audioBtn.onclick = () => generateBriefingAudioForSelected(false);
  } else if (audioVariant && audioVariant.status === "ready") {
    audioBtn.disabled = false;
    audioBtn.textContent = "Play Audio";
    audioBtn.onclick = () => generateBriefingAudioForSelected(false);
  } else if (audioVariant && audioVariant.status === "generating") {
    if (isBriefingAudioGeneratingStale(audioVariant)) {
      audioBtn.disabled = false;
      audioBtn.textContent = "Retry Audio";
      audioBtn.onclick = () => generateBriefingAudioForSelected(true);
    } else {
      audioBtn.disabled = true;
      audioBtn.textContent = "Preparing...";
      audioBtn.onclick = null;
    }
  } else if (audioVariant && audioVariant.status === "error") {
    audioBtn.disabled = false;
    audioBtn.textContent = "Retry Audio";
    audioBtn.onclick = () => generateBriefingAudioForSelected(true);
  } else {
    audioBtn.disabled = false;
    audioBtn.textContent = "Listen";
    audioBtn.onclick = () => generateBriefingAudioForSelected(false);
  }
  setActionButtonPresentation(audioBtn, audioBtn && audioBtn.textContent ? audioBtn.textContent.trim() : "Listen", "listen");
}

function setFormRating(n) {
  _formRating = (_formRating === n && n !== 0) ? 0 : n;
  renderStarRating();
}

function renderStarRating() {
  document.querySelectorAll("#starRatingWidget .star-btn").forEach((btn) => {
    btn.classList.toggle("filled", Number(btn.dataset.value) <= _formRating);
  });
  const clearBtn = document.getElementById("clearRatingBtn");
  if (clearBtn) { clearBtn.classList.toggle("visible", _formRating > 0); }
}

function confirmRegenerate() {
  const book = selectedBookId ? findBook(selectedBookId) : null;
  const title = book ? `"${book.title}"` : "this book";
  if (confirm(`Regenerate the briefing for ${title}? This will replace the cached version.`)) {
    generateResearchForSelected(true);
  }
}

function showCoverLightbox(url, galleryUrls, galleryIndex) {
  _coverLightboxItems = prepareLightboxItems(galleryUrls);
  _coverLightboxIndex = _coverLightboxItems.length
    ? Math.max(0, Math.min(Number(galleryIndex) || 0, _coverLightboxItems.length - 1))
    : -1;
  const activeUrl = _coverLightboxIndex >= 0 ? _coverLightboxItems[_coverLightboxIndex] : url;
  const prevBtn = document.getElementById("coverLightboxPrevBtn");
  const nextBtn = document.getElementById("coverLightboxNextBtn");
  if (prevBtn) prevBtn.style.display = _coverLightboxItems.length > 1 ? "" : "none";
  if (nextBtn) nextBtn.style.display = _coverLightboxItems.length > 1 ? "" : "none";
  if (prevBtn) prevBtn.disabled = _coverLightboxIndex <= 0;
  if (nextBtn) nextBtn.disabled = _coverLightboxIndex === -1 || _coverLightboxIndex >= _coverLightboxItems.length - 1;
  url = activeUrl || url;
  let largeUrl = url;
  if (/covers\.openlibrary\.org/.test(url)) {
    // Open Library: upgrade -S / -M suffix to -L (always available)
    largeUrl = url.replace(/-[SM]\.jpg(\?|$)/, "-L.jpg$1");
  } else if (/books\.google\.com/.test(url) && /[?&]zoom=\d+/.test(url)) {
    // Google Books: try zoom=0 for full cover, strip edge=curl artifact
    largeUrl = url.replace(/zoom=\d+/, "zoom=0").replace(/[&?]edge=curl/, "");
  }
  const img = document.getElementById("coverLightboxImg");
  img.style.minWidth = ""; // reset any upscaling from previous lightbox open
  img.onload = function() {
    // Google Books "image not available" placeholder is exactly 575x750.
    // Detect it, fall back to the thumbnail, and upscale it so it's not tiny.
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
  const nextIndex = _coverLightboxIndex + delta;
  if (nextIndex < 0 || nextIndex >= _coverLightboxItems.length) return;
  showCoverLightbox(_coverLightboxItems[nextIndex], _coverLightboxItems, nextIndex);
}

function closeCoverLightbox() {
  document.getElementById("coverLightbox").classList.remove("open");
  document.getElementById("coverLightboxSelectBtn").style.display = "none";
  const prevBtn = document.getElementById("coverLightboxPrevBtn");
  const nextBtn = document.getElementById("coverLightboxNextBtn");
  if (prevBtn) prevBtn.style.display = "none";
  if (nextBtn) nextBtn.style.display = "none";
  _coverLightboxItems = [];
  _coverLightboxIndex = -1;
  const img = document.getElementById("coverLightboxImg");
  img.style.minWidth = "";
  img.src = "";
}

(function attachCoverLightboxSwipe() {
  const lightbox = document.getElementById("coverLightbox");
  if (!lightbox) return;
  lightbox.addEventListener("touchstart", function(e) {
    if (!e.touches || !e.touches.length) return;
    _coverLightboxTouchX = e.touches[0].clientX;
    _coverLightboxTouchY = e.touches[0].clientY;
  }, { passive: true });
  lightbox.addEventListener("touchend", function(e) {
    if (_coverLightboxItems.length <= 1 || !e.changedTouches || !e.changedTouches.length) return;
    const dx = e.changedTouches[0].clientX - _coverLightboxTouchX;
    const dy = e.changedTouches[0].clientY - _coverLightboxTouchY;
    if (Math.abs(dx) > Math.abs(dy) * 1.5 && Math.abs(dx) > 50) {
      if (dx < 0) navigateCoverLightbox(1);
      else navigateCoverLightbox(-1);
    }
  }, { passive: true });
})();

function renderBookPhotoSection(book, isReadOnly) {
  const photos = getBookPhotos(book.id);
  const iconMode = uiIconsModeEnabled();
  const photosActionLabel = uiIconsModeEnabled() ? "Add Photos" : "Add Photos: Camera or Gallery";
  const photosActionInner = uiIconsModeEnabled()
    ? actionIconSvg("photos")
    : '<span class="book-photo-add-label-full">Add Photos: Camera or Gallery</span><span class="book-photo-add-label-compact">Add Photos</span>';
  const sortMode = document.getElementById("sortSelect") ? document.getElementById("sortSelect").value : "";
  const isCollapsed = photos.length
    ? (sortMode === "has-photos" ? loadHasPhotosModeSectionState() : loadBookPhotoSectionState(book.id))
    : false;
  const cards = photos.map(function(photo, index) {
    const type = esc(formatBookPhotoTypeLabel(photo.type));
    const caption = photo.caption ? `<div class="book-photo-card-caption">${esc(photo.caption)}</div>` : "";
    const altText = photo.caption ? esc(photo.caption) : type;
    const editBtn = isReadOnly ? "" : `<button class="book-photo-edit-btn" type="button" title="Edit photo details" onclick="event.stopPropagation();editBookPhotoMeta('${escapeAttribute(book.id)}','${escapeAttribute(photo.id)}')">&#9998;</button>`;
    const deleteBtn = isReadOnly ? "" : `<button class="book-photo-delete-btn" type="button" title="Remove photo" onclick="event.stopPropagation();removeBookPhoto('${escapeAttribute(book.id)}','${escapeAttribute(photo.id)}')">&#10005;</button>`;
    return `
      <div class="book-photo-card" onclick="openBookPhotoLightbox('${escapeAttribute(book.id)}', ${index})" title="Click to enlarge">
        <img src="${escapeAttribute(photo.url)}" alt="${altText}" onerror="this.closest('.book-photo-card').style.display='none'">
        ${editBtn}
        ${deleteBtn}
        <div class="book-photo-card-meta">
          <div class="book-photo-card-type">${type}</div>
          ${caption}
        </div>
      </div>`;
  }).join("");
  return `
    <div class="book-photo-section">
      <div class="book-photo-section-header">
        <div class="book-photo-section-header-main">
          <div class="book-photo-section-title">Additional Photos</div>
          ${photos.length ? `<button class="btn btn-light btn-sm book-photo-toggle" type="button" onclick="toggleBookPhotoSection('${escapeAttribute(book.id)}')">${isCollapsed ? "Show" : "Hide"}</button>` : ""}
        </div>
        ${isReadOnly ? "" : `<div class="book-photo-actions"><button class="btn btn-light btn-sm${uiIconsModeEnabled() ? " icon-action-btn" : ""}" type="button" onclick="startBookPhotoUpload('${escapeAttribute(book.id)}')" title="${photosActionLabel}" aria-label="${photosActionLabel}">${photosActionInner}</button></div>`}
      </div>
      ${(!isReadOnly && !isCollapsed && !iconMode) ? `<div class="book-photo-helper">Use the camera for one page, or choose multiple images from your gallery at once.</div>` : ""}
      ${photos.length ? (isCollapsed ? "" : `<div class="book-photo-grid">${cards}</div>`) : `<div class="book-photo-empty">${isReadOnly ? "No additional photos shared for this book." : (iconMode ? "" : "Add inscription pages, signatures, title or copyright pages, illustrations, binding shots, or condition photos.")}</div>`}
    </div>`;
}

function renderStats() {
  const bar = document.getElementById("statsBar");
  const sb = books.filter(b => (b.listShelfId || "default") === currentShelfId);
  if (!sb.length) {
    bar.innerHTML = "";
    return;
  }
  const read = sb.filter((b) => b.readingStatus === "Read").length;
  const reading = sb.filter((b) => b.readingStatus === "Currently Reading").length;
  const want = sb.filter((b) => b.readingStatus === "Want to Read").length;
  const dnf = sb.filter((b) => b.readingStatus === "Did Not Finish").length;
  const parts = [
    `<span><strong>${sb.length}</strong> total</span>`,
    read ? `<span><strong>${read}</strong> read</span>` : "",
    reading ? `<span><strong>${reading}</strong> reading</span>` : "",
    want ? `<span><strong>${want}</strong> want to read</span>` : "",
    dnf ? `<span title="Did Not Finish"><strong>${dnf}</strong> dnf</span>` : ""
  ].filter(Boolean);
  bar.innerHTML = parts.join("");
}

function setFilter(status) {
  clearBookDragState();
  filterStatus = status;
  document.querySelectorAll(".filter-pill").forEach((pill) => {
    pill.classList.toggle("active", pill.dataset.status === status);
  });
  renderCatalog();
}

function handleCoverError(img) {
  img.parentElement.innerHTML = bookIconSVG();
}

function renderSkeletonCards(count = 3) {
  const card = `
    <div class="skeleton-card">
      <div class="skeleton skeleton-thumb"></div>
      <div class="skeleton-body">
        <div class="skeleton skeleton-line" style="width:68%"></div>
        <div class="skeleton skeleton-line" style="width:42%"></div>
        <div class="skeleton skeleton-line" style="width:55%;margin-top:10px"></div>
        <div class="skeleton skeleton-line" style="width:28%"></div>
      </div>
    </div>`;
  return Array.from({ length: count }, () => card).join("");
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Bookshelves
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function getShelfStorageKey(uid) {
  return `tomeshelf-shelf-${uid}`;
}

function loadSavedShelfId(uid) {
  try { return localStorage.getItem(getShelfStorageKey(uid)) || "default"; } catch (e) { return "default"; }
}

function saveCurrentShelfId() {
  const uid = auth.currentUser && auth.currentUser.uid;
  if (!uid) return;
  try { localStorage.setItem(getShelfStorageKey(uid), currentShelfId); } catch (e) {}
}

function openShelvesModal() {
  renderShelvesModal();
  document.getElementById("shelvesModal").classList.add("open");
}

function closeShelvesModal(e) {
  if (!e || e.target === document.getElementById("shelvesModal")) {
    document.getElementById("shelvesModal").classList.remove("open");
  }
}

// â”€â”€ Share Dialog â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function renderShelvesModal() {
  const list = document.getElementById("shelvesList");
  list.innerHTML = shelves.map(function(shelf) {
    const count = books.filter(function(b) { return (b.listShelfId || "default") === shelf.id; }).length;
    const isActive = shelf.id === currentShelfId;
    const shareActive = Boolean(activeShareForResource("shelf", shelf.id));
    return `
      <div class="shelf-item${isActive ? " active" : ""}" data-shelf-id="${escapeAttribute(shelf.id)}">
        <button class="shelf-item-name" type="button" onclick="switchShelf('${escapeAttribute(shelf.id)}')">
          ${esc(shelf.name)}
        </button>
        <span class="shelf-item-count">${count} book${count === 1 ? "" : "s"}</span>
        <div class="shelf-item-actions">
          <button class="btn btn-light btn-sm${shareActive ? " share-btn-active" : ""}" type="button"
            title="${shareActive ? "Manage share link" : "Share this shelf"}"
            onclick="openShareDialogForShelf('${escapeAttribute(shelf.id)}')">
            ${shareActive ? "&#128279;" : "Share"}
          </button>
          <button class="btn btn-light btn-sm" type="button" onclick="renameShelf('${escapeAttribute(shelf.id)}')">Rename</button>
          ${shelves.length > 1 ? `<button class="btn btn-danger btn-sm" type="button" onclick="deleteShelf('${escapeAttribute(shelf.id)}')">Delete</button>` : ""}
        </div>
      </div>`;
  }).join("");
}

function updateShelfLabel() {
  const shelf = shelves.find(function(s) { return s.id === currentShelfId; }) || shelves[0];
  const el = document.getElementById("currentShelfName");
  if (el) el.textContent = shelf ? shelf.name : "Reading List";
  updateHeaderBadge();
}

function updateHeaderBadge(bookCount = null) {
  const badge = document.getElementById("countBadge");
  if (!badge) return;
  const shelf = shelves.find(function(s) { return s.id === currentShelfId; }) || shelves[0];
  const isMobileAdd = window.innerWidth < 1024 && document.getElementById("addPanel")?.classList.contains("mobile-active");
  if (isMobileAdd && shelf) {
    badge.textContent = `Shelf: ${shelf.name}`;
    return;
  }
  const count = bookCount === null
    ? books.filter((b) => (b.listShelfId || "default") === currentShelfId).length
    : bookCount;
  badge.textContent = `${count} book${count === 1 ? "" : "s"}`;
}

function updateShelfSelector() {
  const sel = document.getElementById("bookListShelfId");
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = shelves.map(function(s) {
    return `<option value="${escapeAttribute(s.id)}">${esc(s.name)}</option>`;
  }).join("");
  if (editingBookId) {
    // Preserve the book's shelf assignment while in edit mode
    sel.value = shelves.find(function(s) { return s.id === prev; }) ? prev : currentShelfId;
  } else {
    // Always track the active shelf for new-book mode.
    // Without this, the selector stays on its HTML-default "Reading List" even
    // when the user last had a different shelf active (restored from localStorage).
    sel.value = currentShelfId;
  }
}

function switchShelf(id) {
  if (id === currentShelfId) {
    closeShelvesModal();
    return;
  }
  clearBookDragState();
  currentShelfId = id;
  saveCurrentShelfId();
  // Deselect book if it's not in the new shelf
  if (selectedBookId) {
    const book = books.find(function(b) { return b.id === selectedBookId; });
    if (book && (book.listShelfId || "default") !== id) {
      selectedBookId = null;
      renderBriefingPanel();
    }
  }
  // Reset filter
  filterStatus = "";
  document.querySelectorAll(".filter-pill").forEach(function(pill) {
    pill.classList.toggle("active", pill.dataset.status === "");
  });
  updateShelfLabel();
  updateShelfSelector();
  // Sync add-form shelf dropdown to the newly active shelf (unless editing a book)
  if (!editingBookId) {
    const sel = document.getElementById("bookListShelfId");
    if (sel) sel.value = currentShelfId;
  }
  renderCatalog();
  closeShelvesModal();
}

async function createShelf() {
  const name = prompt("Name for new bookshelf:");
  if (!name || !name.trim()) return;
  const newShelf = { id: Math.random().toString(36).slice(2), name: name.trim(), createdAt: Date.now() };
  shelves.push(newShelf);
  await persistCatalog();
  renderShelvesModal();
  updateShelfSelector();
}

async function renameShelf(id) {
  const shelf = shelves.find(function(s) { return s.id === id; });
  if (!shelf) return;
  const name = prompt("New name for this shelf:", shelf.name);
  if (!name || !name.trim() || name.trim() === shelf.name) return;
  shelf.name = name.trim();
  await persistCatalog();
  renderShelvesModal();
  updateShelfLabel();
  updateShelfSelector();
}

async function deleteShelf(id) {
  if (shelves.length <= 1) return;
  const shelf = shelves.find(function(s) { return s.id === id; });
  if (!shelf) return;
  const count = books.filter(function(b) { return (b.listShelfId || "default") === id; }).length;
  const other = shelves.find(function(s) { return s.id !== id; });

  let deleteBooks = false;
  if (count > 0) {
    // First confirmation â€” OK = delete books, Cancel = move books (safer path)
    const proceedWithDelete = confirm(
      `Delete shelf "${shelf.name}"?\n\n` +
      `Its ${count} book${count === 1 ? "" : "s"} will be permanently deleted.\n\n` +
      `Click OK to delete all books too.\n` +
      `Click Cancel to move them to "${other.name}" instead.`
    );
    if (proceedWithDelete) {
      // Second confirmation â€” make absolutely clear this is irreversible
      const confirmed = confirm(
        `Are you sure? This will permanently delete all ${count} book${count === 1 ? "" : "s"} on "${shelf.name}".\n\n` +
        `This cannot be undone.`
      );
      if (!confirmed) return;
      deleteBooks = true;
    }
    // If user clicked Cancel at first dialog: fall through to move books (deleteBooks stays false)
  } else {
    if (!confirm(`Delete empty shelf "${shelf.name}"?`)) return;
  }

  if (deleteBooks) {
    const deletedIds = books.filter(b => (b.listShelfId || "default") === id).map(b => b.id);
    books = books.filter(function(b) { return (b.listShelfId || "default") !== id; });
    pendingBriefingIds = pendingBriefingIds.filter(pid => !deletedIds.includes(pid));
  } else {
    let nextCustomOrder = getNextCustomOrderForShelf(other.id);
    getShelfBooksSorted(id, "custom").forEach(function(book) {
      book.listShelfId = other.id;
      book.customOrder = nextCustomOrder++;
    });
  }
  shelves = shelves.filter(function(s) { return s.id !== id; });
  if (currentShelfId === id) {
    currentShelfId = shelves[0].id;
    saveCurrentShelfId();
  }
  // Auto-revoke any active share link for the deleted shelf
  const activeShelfShare = activeShareForResource("shelf", id);
  if (activeShelfShare && activeShelfShare.token) {
    try {
      await functions.httpsCallable("revokeShareLink")({ token: activeShelfShare.token });
      if (shareRecords[activeShelfShare.token]) shareRecords[activeShelfShare.token].status = "revoked";
    } catch (e) { console.warn("[deleteShelf] could not revoke share link:", e); }
  }
  await persistCatalog();
  renderShelvesModal();
  updateShelfLabel();
  updateShelfSelector();
  renderCatalog();
}
