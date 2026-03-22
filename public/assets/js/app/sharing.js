function publicShareUrl(token) {
  return "https://schmoeslibrary-ff6c2.web.app/share/" + token;
}

function shareOptionSummary(share) {
  if (!share) return "";
  return [
    share.includePersonalNotes ? "includes personal notes" : "",
    share.allowWikiAI ? "AI Wikipedia enabled" : "",
    share.allowBriefingAudio ? "briefing audio enabled" : "",
    share.type === "book" && share.includeAdditionalPhotos ? "photos included" : ""
  ].filter(Boolean).join(" · ");
}

function openShareDialog(shelfId) {
  openShareDialogForShelf(shelfId);
}

function revokedShareRecords() {
  return Object.values(shareRecords).filter(function(share) {
    return share && share.status === "revoked" && share.token;
  });
}

function shareStatusLine(share) {
  if (!share) return "";
  const stamp = Number(share.status === "revoked" ? (share.updatedAt || share.createdAt) : share.createdAt);
  const date = stamp ? new Date(stamp).toLocaleDateString() : "";
  return share.status === "revoked"
    ? `Revoked ${date}`.trim()
    : `Shared ${date}`.trim();
}

function openShareDialogForShelf(shelfId) {
  const shelf = shelves.find(function(s) { return s.id === shelfId; });
  if (!shelf) return;
  _shareDialogContext = { type: "shelf", resourceId: shelfId, title: shelf.name };
  document.getElementById("shareDialogTitle").textContent = "Share \u201c" + shelf.name + "\u201d";
  renderShareDialog();
  document.getElementById("shareDialog").classList.add("open");
}

function openShareDialogForSelectedBook() {
  const book = selectedBookId ? findBook(selectedBookId) : null;
  if (!book) return;
  _shareDialogContext = { type: "book", resourceId: book.id, title: book.title };
  document.getElementById("shareDialogTitle").textContent = "Share \u201c" + book.title + "\u201d";
  renderShareDialog();
  document.getElementById("shareDialog").classList.add("open");
}

function openShareDialogForRecord(token) {
  const share = shareRecords[token];
  if (!share) return;
  _shareDialogContext = { type: share.type, resourceId: share.resourceId, title: share.resourceName || "" };
  document.getElementById("shareDialogTitle").textContent = "Manage Share";
  renderShareDialog();
  document.getElementById("shareDialog").classList.add("open");
}

function closeShareDialog(event) {
  if (event && event.target !== document.getElementById("shareDialog")) return;
  document.getElementById("shareDialog").classList.remove("open");
  _shareDialogContext = null;
}

function renderShareDialog() {
  const context = _shareDialogContext;
  if (!context) return;
  const content = document.getElementById("shareDialogContent");
  const share = activeShareForResource(context.type, context.resourceId);
  const isBook = context.type === "book";
  if (!share) {
    content.innerHTML =
      '<p style="font-size:0.88rem;color:#666;margin-bottom:14px;line-height:1.5;">' +
        (isBook
          ? 'Generate a read-only link anyone can use to open this book\'s public briefing page. No sign-in required.'
          : 'Generate a read-only link anyone can use to browse this shelf. No sign-in required.') +
      '</p>' +
      '<label class="share-option-row">' +
        '<input type="checkbox" id="shareIncludeNotes"><span class="share-option-copy">Include my personal notes</span>' +
      '</label>' +
      '<label class="share-option-row">' +
        '<input type="checkbox" id="shareAllowWikiAI"><span class="share-option-copy">Allow AI Wikipedia lookup</span>' +
      '</label>' +
      '<label class="share-option-row">' +
        '<input type="checkbox" id="shareAllowBriefingAudio"><span class="share-option-copy">Allow cached briefing audio playback</span>' +
      '</label>' +
      (isBook
        ? '<label class="share-option-row" style="margin-bottom:16px;">' +
            '<input type="checkbox" id="shareIncludeAdditionalPhotos"><span class="share-option-copy">Include additional photos</span>' +
          '</label>'
        : '') +
      '<button class="btn btn-secondary" type="button" id="generateShareBtn" onclick="generateShareLinkForContext()">' +
        'Generate Share Link' +
      '</button>';
    return;
  }
  const createdDate = new Date(share.createdAt).toLocaleDateString();
  const summary = shareOptionSummary(share);
  content.innerHTML =
    '<p style="font-size:0.82rem;color:var(--brown);margin-bottom:10px;">' +
      esc((share.type === "book" ? "Book" : "Shelf") + ' share active since ' + createdDate) +
      (summary ? ' &middot; <em>' + esc(summary) + '</em>' : '') +
    '</p>' +
    '<div style="display:flex;gap:8px;margin-bottom:6px;">' +
      '<input type="text" id="shareUrlInput" value="' + escapeAttribute(publicShareUrl(share.token)) + '" readonly' +
        ' style="flex:1;font-family:\'Courier Prime\',monospace;font-size:0.75rem;background:var(--cream);border:1px solid var(--tan);padding:6px 8px;border-radius:2px;color:var(--ink);">' +
      '<button class="btn btn-secondary btn-sm" type="button" onclick="copyShareUrl()">Copy</button>' +
    '</div>' +
    '<label class="share-option-row">' +
      '<input type="checkbox" id="shareIncludeNotes"' + (share.includePersonalNotes ? ' checked' : '') + '><span class="share-option-copy">Include my personal notes</span>' +
    '</label>' +
    '<label class="share-option-row">' +
      '<input type="checkbox" id="shareAllowWikiAI"' + (share.allowWikiAI ? ' checked' : '') + '><span class="share-option-copy">Allow AI Wikipedia lookup</span>' +
    '</label>' +
    '<label class="share-option-row">' +
      '<input type="checkbox" id="shareAllowBriefingAudio"' + (share.allowBriefingAudio ? ' checked' : '') + '><span class="share-option-copy">Allow cached briefing audio playback</span>' +
    '</label>' +
    (share.type === "book"
      ? '<label class="share-option-row" style="margin-bottom:16px;">' +
          '<input type="checkbox" id="shareIncludeAdditionalPhotos"' + (share.includeAdditionalPhotos ? ' checked' : '') + '><span class="share-option-copy">Include additional photos</span>' +
        '</label>'
      : '') +
    '<div id="shareDialogStatus" style="font-size:0.82rem;color:var(--green);min-height:1.2em;margin-bottom:10px;"></div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
      '<button class="btn btn-secondary btn-sm" type="button" onclick="generateShareLinkForContext()">Update Share Link</button>' +
      '<button class="btn btn-light btn-sm" type="button" onclick="window.open(\'' + escapeAttribute(publicShareUrl(share.token)) + '\', \'_blank\', \'noopener,noreferrer\')">Open Public View</button>' +
      '<button class="btn btn-danger btn-sm" type="button" onclick="revokeActiveShareLink(\'' + escapeAttribute(share.token) + '\')">Revoke Link</button>' +
    '</div>';
}

async function generateShareLinkForContext() {
  const context = _shareDialogContext;
  if (!context) return;
  const btn = document.getElementById("generateShareBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Generating\u2026"; }
  try {
    const previousShare = activeShareForResource(context.type, context.resourceId);
    const fn = functions.httpsCallable("createShareLink");
    const result = await fn({
      type: context.type,
      resourceId: context.resourceId,
      includePersonalNotes: document.getElementById("shareIncludeNotes") ? document.getElementById("shareIncludeNotes").checked : false,
      allowWikiAI: document.getElementById("shareAllowWikiAI") ? document.getElementById("shareAllowWikiAI").checked : false,
      allowBriefingAudio: document.getElementById("shareAllowBriefingAudio") ? document.getElementById("shareAllowBriefingAudio").checked : false,
      includeAdditionalPhotos: document.getElementById("shareIncludeAdditionalPhotos") ? document.getElementById("shareIncludeAdditionalPhotos").checked : false
    });
    if (previousShare && shareRecords[previousShare.token]) {
      shareRecords[previousShare.token].status = "revoked";
    }
    if (result.data && result.data.share) {
      const normalized = normalizeShareRecord(result.data.token, result.data.share);
      shareRecords[normalized.token] = normalized;
    }
    renderShareDialog();
    renderShelvesModal();
    renderShareManagementSection();
    renderBriefingPanel();
  } catch (err) {
    console.error("[generateShareLinkForContext]", err);
    if (btn) { btn.disabled = false; btn.textContent = "Generate Share Link"; }
    alert("Could not generate share link. Please try again.");
  }
}

function copyShareUrl() {
  const input = document.getElementById("shareUrlInput");
  if (!input) return;
  const status = document.getElementById("shareDialogStatus");
  navigator.clipboard.writeText(input.value).then(function() {
    if (status) {
      status.textContent = "Copied to clipboard!";
      setTimeout(function() { if (status) status.textContent = ""; }, 2500);
    }
  }).catch(function() {
    input.select();
    document.execCommand("copy");
    if (status) {
      status.textContent = "Copied!";
      setTimeout(function() { if (status) status.textContent = ""; }, 2500);
    }
  });
}

async function revokeActiveShareLink(token) {
  const share = shareRecords[token];
  const noun = share && share.type === "book" ? "book link" : "share link";
  if (!confirm("Revoke this " + noun + "? Anyone with the link will no longer be able to view it.")) return;
  try {
    const fn = functions.httpsCallable("revokeShareLink");
    await fn({ token });
    if (shareRecords[token]) shareRecords[token].status = "revoked";
    renderShareDialog();
    renderShelvesModal();
    renderShareManagementSection();
    renderBriefingPanel();
  } catch (err) {
    console.error("[revokeActiveShareLink]", err);
    alert("Could not revoke share link. Please try again.");
  }
}

async function restoreRevokedShareLink(token) {
  const share = shareRecords[token];
  if (!share || share.status !== "revoked") return;
  const activeReplacement = activeShareForResource(share.type, share.resourceId);
  const noun = share.type === "book" ? "book link" : "shelf link";
  const message = activeReplacement && activeReplacement.token !== token
    ? `Restore this old ${noun}?\n\nThis will reactivate the original URL and revoke the current active one for this ${share.type}.`
    : `Restore this old ${noun}?\n\nThis will reactivate the original URL.`;
  if (!confirm(message)) return;
  try {
    const fn = functions.httpsCallable("restoreShareLink");
    const result = await fn({ token });
    if (result.data && result.data.replacedToken && shareRecords[result.data.replacedToken]) {
      shareRecords[result.data.replacedToken].status = "revoked";
      shareRecords[result.data.replacedToken].updatedAt = Date.now();
    }
    if (result.data && result.data.share) {
      const normalized = normalizeShareRecord(result.data.share.token || token, result.data.share);
      shareRecords[normalized.token] = normalized;
      selectedSharedBookToken = normalized.token;
    }
    renderShareDialog();
    renderShelvesModal();
    renderShareManagementSection();
    renderBriefingPanel();
  } catch (err) {
    console.error("[restoreRevokedShareLink]", err);
    alert(getCallableErrorMessage(err, "Could not restore that share link."));
  }
}

function setAccountShareView(view) {
  accountShareView = view === "books" ? "books" : "shelves";
  renderShareManagementSection();
}

function renderShareManagementSection() {
  const shelvesBtn = document.getElementById("shareViewShelvesBtn");
  const booksBtn = document.getElementById("shareViewBooksBtn");
  const shelvesSection = document.getElementById("sharedShelvesSection");
  const booksSection = document.getElementById("sharedBooksSection");
  if (shelvesBtn) {
    shelvesBtn.classList.toggle("btn-secondary", accountShareView === "shelves");
    shelvesBtn.classList.toggle("btn-light", accountShareView !== "shelves");
  }
  if (booksBtn) {
    booksBtn.classList.toggle("btn-secondary", accountShareView === "books");
    booksBtn.classList.toggle("btn-light", accountShareView !== "books");
  }
  if (shelvesSection) shelvesSection.style.display = accountShareView === "shelves" ? "" : "none";
  if (booksSection) booksSection.style.display = accountShareView === "books" ? "" : "none";
  renderSharedShelvesSection();
  renderSharedBooksManager();
}

function renderSharedShelvesSection() {
  const list = document.getElementById("sharedShelvesSection");
  if (!list) return;
  const activeRecords = shelfShareRecords().sort(function(a, b) { return Number(b.createdAt || 0) - Number(a.createdAt || 0); });
  const revokedRecords = revokedShareRecords()
    .filter(function(share) { return share.type === "shelf"; })
    .sort(function(a, b) { return Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0); });
  if (!activeRecords.length && !revokedRecords.length) {
    list.innerHTML = '<p style="font-size:0.82rem;color:#888;">No shelves are currently shared.</p>';
    return;
  }
  const renderRow = function(share, isRevoked) {
    const summary = shareOptionSummary(share);
    const statusLine = isRevoked ? shareStatusLine(share) : ("Shared " + new Date(share.createdAt).toLocaleDateString());
    return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--tan);flex-wrap:wrap;' + (isRevoked ? 'opacity:0.82;' : '') + '">' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-size:0.88rem;font-weight:600;color:var(--dark);">' + esc(share.resourceName || "Shared Shelf") + '</div>' +
        '<div style="font-size:0.75rem;color:var(--brown);margin-top:2px;">' + esc(statusLine) + (summary ? ' \u00b7 ' + esc(summary) : '') + '</div>' +
      '</div>' +
      (isRevoked
        ? '<button class="btn btn-secondary btn-sm" type="button" onclick="restoreRevokedShareLink(\'' + escapeAttribute(share.token) + '\')">Restore</button>' +
          '<button class="btn btn-light btn-sm" type="button" onclick="copySpecificShareUrl(\'' + escapeAttribute(share.token) + '\')">Copy Old Link</button>'
        : '<button class="btn btn-light btn-sm" type="button" onclick="openShareDialogForRecord(\'' + escapeAttribute(share.token) + '\')">Manage</button>' +
          '<button class="btn btn-danger btn-sm" type="button" onclick="revokeActiveShareLink(\'' + escapeAttribute(share.token) + '\')">Revoke</button>') +
    '</div>';
  };
  list.innerHTML =
    (activeRecords.length
      ? '<div style="font-size:0.75rem;color:var(--brown);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.06em;">Active</div>' +
        activeRecords.map(function(share) { return renderRow(share, false); }).join("")
      : "") +
    (revokedRecords.length
      ? '<div style="font-size:0.75rem;color:var(--brown);margin:' + (activeRecords.length ? '16px' : '0') + ' 0 6px;text-transform:uppercase;letter-spacing:0.06em;">Revoked</div>' +
        revokedRecords.map(function(share) { return renderRow(share, true); }).join("")
      : "");
}

function renderSharedBooksManager() {
  const list = document.getElementById("sharedBooksList");
  const detail = document.getElementById("sharedBookManagerDetail");
  if (!list || !detail) return;
  const filterValue = (document.getElementById("sharedBooksFilter") && document.getElementById("sharedBooksFilter").value || "").trim().toLowerCase();
  const sortValue = (document.getElementById("sharedBooksSort") && document.getElementById("sharedBooksSort").value) || "created";
  let records = Object.values(shareRecords).filter(function(share) {
    return share && share.type === "book" && share.token;
  }).map(function(share) {
    return { share, book: findBook(share.resourceId) };
  }).filter(function(item) {
    if (!item.book) return false;
    if (!filterValue) return true;
    return (item.book.title || "").toLowerCase().includes(filterValue) || (item.book.author || "").toLowerCase().includes(filterValue);
  });
  records.sort(function(a, b) {
    if (sortValue === "title") return (a.book.title || "").localeCompare(b.book.title || "");
    if (sortValue === "author") return buildAuthorSortKey(a.book.author || "").localeCompare(buildAuthorSortKey(b.book.author || ""));
    return Number(b.share.createdAt || 0) - Number(a.share.createdAt || 0);
  });
  if (!records.length) {
    list.innerHTML = '<p style="font-size:0.82rem;color:#888;">No shared or revoked book links yet.</p>';
    detail.innerHTML = '<p style="font-size:0.82rem;color:#888;">Select a shared book to manage or restore its public link.</p>';
    selectedSharedBookToken = null;
    return;
  }
  if (!selectedSharedBookToken || !records.some(function(item) { return item.share.token === selectedSharedBookToken; })) {
    selectedSharedBookToken = records[0].share.token;
  }
  list.innerHTML = records.map(function(item) {
    const share = item.share;
    const book = item.book;
    const selected = share.token === selectedSharedBookToken;
    const thumb = book.coverUrl ? '<img src="' + escapeAttribute(book.coverUrl) + '" alt="" onerror="this.parentElement.innerHTML=bookIconSVG()">' : bookIconSVG();
    return '<div class="book-card' + (selected ? ' selected' : '') + '" style="margin-bottom:8px;' + (share.status === "revoked" ? 'opacity:0.82;' : '') + '" onclick="selectSharedBookRecord(\'' + escapeAttribute(share.token) + '\')">' +
      '<div class="book-cover-thumb">' + thumb + '</div>' +
      '<div class="book-info">' +
        '<div class="book-title">' + esc(book.title) + '</div>' +
        (book.author ? '<div class="book-author">' + esc(book.author) + '</div>' : '') +
        '<div class="book-meta"><span>' + esc(shareStatusLine(share)) + '</span></div>' +
        (shareOptionSummary(share) ? '<div class="search-result-cue"><span class="match-reason-detail">' + esc(shareOptionSummary(share)) + '</span></div>' : '') +
      '</div>' +
    '</div>';
  }).join("");
  const selectedItem = records.find(function(item) { return item.share.token === selectedSharedBookToken; }) || records[0];
  const share = selectedItem.share;
  const book = selectedItem.book;
  const isRevoked = share.status === "revoked";
  detail.innerHTML =
    '<div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:12px;">' +
      '<div class="book-cover-thumb" style="width:58px;min-width:58px;height:82px;">' +
        (book.coverUrl ? '<img src="' + escapeAttribute(book.coverUrl) + '" alt="" onerror="this.parentElement.innerHTML=bookIconSVG()">' : bookIconSVG()) +
      '</div>' +
      '<div style="min-width:0;flex:1;">' +
        '<div style="font-family:\'Playfair Display\',serif;font-size:1rem;color:var(--dark);font-weight:700;">' + esc(book.title) + '</div>' +
        (book.author ? '<div style="font-style:italic;color:var(--brown);margin-top:2px;">' + esc(book.author) + '</div>' : '') +
        '<div style="font-size:0.75rem;color:var(--brown);margin-top:6px;">' + esc(shareStatusLine(share)) + '</div>' +
      '</div>' +
    '</div>' +
    '<div style="font-size:0.75rem;color:var(--brown);margin-bottom:6px;">' + (isRevoked ? 'Original URL' : 'Public URL') + '</div>' +
    '<input type="text" value="' + escapeAttribute(publicShareUrl(share.token)) + '" readonly style="width:100%;font-family:\'Courier Prime\',monospace;font-size:0.75rem;background:var(--parchment);border:1px solid var(--tan);padding:6px 8px;border-radius:2px;color:var(--ink);margin-bottom:10px;">' +
    '<div style="font-size:0.75rem;color:var(--brown);margin-bottom:12px;">' +
      esc(shareOptionSummary(share) || "No optional elements enabled.") +
      (isRevoked ? ' Restoring will reuse this exact URL.' : '') +
    '</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
      '<button class="btn btn-secondary btn-sm" type="button" onclick="copySpecificShareUrl(\'' + escapeAttribute(share.token) + '\')">Copy</button>' +
      (isRevoked
        ? '<button class="btn btn-light btn-sm" type="button" onclick="restoreRevokedShareLink(\'' + escapeAttribute(share.token) + '\')">Restore</button>'
        : '<button class="btn btn-light btn-sm" type="button" onclick="openShareDialogForRecord(\'' + escapeAttribute(share.token) + '\')">Manage</button>' +
          '<button class="btn btn-light btn-sm" type="button" onclick="window.open(\'' + escapeAttribute(publicShareUrl(share.token)) + '\', \'_blank\', \'noopener,noreferrer\')">Open Public View</button>' +
          '<button class="btn btn-danger btn-sm" type="button" onclick="revokeActiveShareLink(\'' + escapeAttribute(share.token) + '\')">Revoke</button>') +
    '</div>';
}

function selectSharedBookRecord(token) {
  selectedSharedBookToken = token;
  renderSharedBooksManager();
}

function copySpecificShareUrl(token) {
  navigator.clipboard.writeText(publicShareUrl(token)).catch(function() {});
}

// ─────────────────────────────────────────────────────────────────────────────
