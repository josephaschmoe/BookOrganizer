function extFromContentType(contentType, fallback) {
  const value = String(contentType || "").toLowerCase();
  if (value.includes("jpeg")) return ".jpg";
  if (value.includes("png")) return ".png";
  if (value.includes("webp")) return ".webp";
  if (value.includes("wav")) return ".wav";
  if (value.includes("mpeg")) return ".mp3";
  if (value.includes("ogg")) return ".ogg";
  return fallback || "";
}

function triggerBrowserDownload(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "";
  a.target = "_blank";
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function _renderBackupJobsSection() {
  const list = document.getElementById("backupJobsList");
  if (!list) return;
  const entries = Object.entries(backupJobsCache || {}).sort(function(a, b) {
    return String((b[1] || {}).createdAt || "").localeCompare(String((a[1] || {}).createdAt || ""));
  });
  if (!entries.length) {
    list.innerHTML = '<p style="font-size:0.82rem;color:#888;">No recent backups yet.</p>';
    return;
  }
  list.innerHTML = entries.map(function([id, job]) {
    const status = String(job.status || "queued");
    const created = job.createdAt ? new Date(job.createdAt).toLocaleString() : "";
    const finished = job.finishedAt ? new Date(job.finishedAt).toLocaleString() : "";
    const expires = job.expiresAt ? new Date(job.expiresAt).toLocaleString() : "";
    const stats = job.exportStats || {};
    const details = [];
    const report = [];
    if (job.bookCount) details.push(`${job.bookCount} books`);
    if (job.assetCount || stats.audioAdded || stats.coversAdded || stats.bookPhotosAdded) details.push(`${job.assetCount || 0} assets`);
    if (typeof stats.briefingsCount === "number") report.push(`${stats.briefingsCount} briefings`);
    if (typeof stats.coversAdded === "number" || typeof stats.coversSkipped === "number") {
      report.push(`covers ${stats.coversAdded || 0} added, ${stats.coversSkipped || 0} skipped`);
    }
    if (typeof stats.bookPhotosAdded === "number" || typeof stats.bookPhotosSkipped === "number") {
      report.push(`extra photos ${stats.bookPhotosAdded || 0} added, ${stats.bookPhotosSkipped || 0} skipped`);
    }
    if (typeof stats.audioAdded === "number" || typeof stats.audioSkipped === "number") {
      report.push(`audio ${stats.audioAdded || 0} added, ${stats.audioSkipped || 0} skipped`);
    }
    if (job.schemaVersion) report.push(`schema v${job.schemaVersion}`);
    const canDelete = status !== "queued" && status !== "running" && (job.backupPath || status === "expired" || status === "error" || status === "deleted");
    let actionHtml = '';
    if (status === "ready" && job.downloadUrl) {
      actionHtml = '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
        '<a class="btn btn-secondary btn-sm" href="' + escapeAttribute(job.downloadUrl) + '" target="_blank" rel="noopener">Download</a>' +
        '<button class="btn btn-danger btn-sm" type="button" onclick="deleteBackupExport(\'' + escapeAttribute(id) + '\')">Delete ZIP</button>' +
      '</div>';
    } else if (status === "running" || status === "queued") {
      actionHtml = '<span style="font-size:0.78rem;color:var(--brown);">Preparing…</span>';
    } else if (status === "expired") {
      actionHtml = canDelete
        ? '<button class="btn btn-danger btn-sm" type="button" onclick="deleteBackupExport(\'' + escapeAttribute(id) + '\')">Delete History</button>'
        : '<span style="font-size:0.78rem;color:#888;">Expired</span>';
    } else if (status === "deleted") {
      actionHtml = '<span style="font-size:0.78rem;color:#888;">ZIP deleted</span>';
    } else if (status === "error") {
      actionHtml = '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
        '<span style="font-size:0.78rem;color:#b33;">' + esc(job.error || "Failed") + '</span>' +
        (canDelete ? '<button class="btn btn-danger btn-sm" type="button" onclick="deleteBackupExport(\'' + escapeAttribute(id) + '\')">Delete History</button>' : '') +
      '</div>';
    }
    return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--tan);flex-wrap:wrap;">' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-size:0.88rem;font-weight:600;color:var(--dark);text-transform:capitalize;">' + esc(status) + '</div>' +
        '<div style="font-size:0.75rem;color:var(--brown);margin-top:2px;">' + esc(created) + (details.length ? ' &middot; ' + esc(details.join(' · ')) : '') + '</div>' +
        (report.length
          ? '<div style="font-size:0.74rem;color:#666;margin-top:4px;">' + esc(report.join(' | ')) + '</div>'
          : '') +
        (finished || expires
          ? '<div style="font-size:0.72rem;color:#777;margin-top:4px;">' +
              (finished ? 'Ready ' + esc(finished) : '') +
              (finished && expires ? ' | ' : '') +
              (expires ? 'Expires ' + esc(expires) : '') +
            '</div>'
          : '') +
      '</div>' +
      actionHtml +
    '</div>';
  }).join("");
}

function extFromPath(path, fallback) {
  const match = String(path || "").match(/(\.[a-z0-9]+)(?:\?|$)/i);
  return match ? match[1].toLowerCase() : (fallback || "");
}

function coverAssetForBook(bookId, manifest) {
  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
  return assets.find((asset) => asset && asset.bookId === bookId && asset.kind === "cover") || null;
}

function audioAssetForBook(bookId, variant, manifest) {
  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
  return assets.find((asset) => asset && asset.bookId === bookId && asset.kind === "audio" && asset.variant === variant) || null;
}

function photoAssetsForBook(bookId, manifest) {
  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
  return assets.filter((asset) => asset && asset.bookId === bookId && asset.kind === "book-photo");
}

function guessContentTypeFromUrl(url) {
  const value = String(url || "").toLowerCase();
  if (value.includes(".png")) return "image/png";
  if (value.includes(".webp")) return "image/webp";
  if (value.includes(".wav")) return "audio/wav";
  return "image/jpeg";
}

async function fetchBlobForBackup(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.blob();
}

async function getOwnerAudioUrl(bookId, spoilerMode) {
  const fn = functions.httpsCallable("getBriefingAudio");
  const result = await fn({ bookId, spoilerMode });
  return result.data && result.data.audioUrl ? result.data.audioUrl : "";
}

async function addCoverAssetToZip(zip, manifest, book) {
  if (!book || !book.id || !book.coverUrl) return;
  try {
    const blob = await fetchBlobForBackup(book.coverUrl);
    const contentType = blob.type || guessContentTypeFromUrl(book.coverUrl);
    const ext = extFromContentType(contentType, extFromPath(book.coverUrl, ".jpg")) || ".jpg";
    const pathInZip = `files/covers/${book.id}${ext}`;
    zip.file(pathInZip, blob);
    manifest.assets.push({
      assetId: `cover-${book.id}`,
      bookId: book.id,
      kind: "cover",
      contentType,
      pathInZip,
      sourceUrl: book.coverUrl
    });
  } catch (error) {
    console.warn("[exportJSON] cover export skipped:", book.title, error);
  }
}

async function addAudioAssetsToZip(zip, manifest, audioDoc, bookId) {
  const variants = audioDoc && typeof audioDoc.variants === "object" ? audioDoc.variants : {};
  for (const variant of Object.keys(variants)) {
    const entry = variants[variant];
    if (!entry || entry.status !== "ready" || !entry.audioPath) continue;
    try {
      const audioUrl = await getOwnerAudioUrl(bookId, variant);
      if (!audioUrl) continue;
      const blob = await fetchBlobForBackup(audioUrl);
      const contentType = blob.type || "audio/wav";
      const ext = extFromContentType(contentType, extFromPath(entry.audioPath, ".wav")) || ".wav";
      const pathInZip = `files/audio/${bookId}-${variant}${ext}`;
      zip.file(pathInZip, blob);
      manifest.assets.push({
        assetId: `audio-${bookId}-${variant}`,
        bookId,
        kind: "audio",
        variant,
        contentType,
        pathInZip,
        sourcePath: entry.audioPath
      });
    } catch (error) {
      console.warn("[exportJSON] audio export skipped:", bookId, variant, error);
    }
  }
}

function buildBackupManifest() {
  const sanitizedBriefingAudio = {};
  Object.entries(briefingAudioCache || {}).forEach(function([bookId, doc]) {
    const variants = doc && typeof doc.variants === "object" ? doc.variants : {};
    const sanitizedVariants = {};
    Object.entries(variants).forEach(function([variant, entry]) {
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
      sanitizedBriefingAudio[bookId] = {
        updatedAt: doc && doc.updatedAt ? doc.updatedAt : "",
        variants: sanitizedVariants
      };
    }
  });

  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
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
    preferences: {
      currentShelfId: currentShelfId || "default"
    },
    books: books.map((book) => JSON.parse(JSON.stringify(book))),
    bookPhotos: JSON.parse(JSON.stringify(bookPhotoCache || {})),
    shelves: shelves.map((shelf) => JSON.parse(JSON.stringify(shelf))),
    briefings: JSON.parse(JSON.stringify(researchCache || {})),
    briefingAudio: sanitizedBriefingAudio,
    assets: []
  };
}

async function exportJSON() {
  try {
    const fn = functions.httpsCallable("requestBackupExport");
    const result = await fn({});
    if (result.data && result.data.ok === false) {
      throw new Error(result.data.error || "Backup export failed.");
    }
    setStatus("addStatus", "Backup export started. It may take a few minutes.", "success");
    showToast(
      "Backup ZIP is being prepared. You can keep using TomeShelf while it runs. When it is ready, open Account Settings and use the Download link in Backups.",
      "Open Settings",
      openAccountSettings
    );
    const modal = document.getElementById("accountSettingsModal");
    if (modal && modal.classList.contains("open")) _renderBackupJobsSection();
  } catch (error) {
    console.error("[exportJSON] backup export failed:", error);
    setStatus("addStatus", `Backup export failed: ${error.message}`, "error");
  }
}

async function deleteBackupExport(backupId) {
  if (!backupId) return;
  if (!confirm("Delete this backup ZIP from Firebase Storage? The history row will remain, but the file will no longer be downloadable.")) {
    return;
  }
  try {
    await functions.httpsCallable("deleteBackupExport")({ backupId });
    showToast("Backup ZIP deleted");
  } catch (error) {
    alert(getCallableErrorMessage(error, "Could not delete that backup ZIP."));
  }
}

function normalizeBackupManifest(raw) {
  const manifest = raw && typeof raw === "object" ? raw : {};
  return {
    schemaVersion: Number(manifest.schemaVersion || 0),
    books: Array.isArray(manifest.books) ? manifest.books : [],
    bookPhotos: manifest.bookPhotos && typeof manifest.bookPhotos === "object" ? manifest.bookPhotos : {},
    shelves: Array.isArray(manifest.shelves) ? manifest.shelves : [],
    briefings: manifest.briefings && typeof manifest.briefings === "object" ? manifest.briefings : {},
    briefingAudio: manifest.briefingAudio && typeof manifest.briefingAudio === "object" ? manifest.briefingAudio : {},
    assets: Array.isArray(manifest.assets) ? manifest.assets : [],
    preferences: manifest.preferences && typeof manifest.preferences === "object" ? manifest.preferences : {}
  };
}

function matchImportedBookIndex(book) {
  return books.findIndex((existing) => {
    if (book.isbn && existing.isbn) return existing.isbn === book.isbn;
    return (existing.title || "").toLowerCase() === (book.title || "").toLowerCase()
      && (existing.author || "").toLowerCase() === (book.author || "").toLowerCase();
  });
}

function upsertBackupBooks(imported) {
  let added = 0;
  let updated = 0;
  const idMap = {};

  for (const rawBook of imported) {
    const book = normalizeBook(rawBook);
    const existingIdx = matchImportedBookIndex(book);
    if (existingIdx === -1) {
      if (!hasCustomOrder(book)) {
        book.customOrder = getNextCustomOrderForShelf(book.listShelfId || "default");
      }
      books.push(book);
      added++;
      idMap[rawBook.id] = book.id;
    } else {
      const existing = books[existingIdx];
      const merged = normalizeBook({ ...existing, ...book, id: existing.id });
      books[existingIdx] = merged;
      updated++;
      idMap[rawBook.id] = existing.id;
    }
  }

  return { added, updated, idMap };
}

async function uploadImportedBlob(storagePath, blob, contentType) {
  const ref = storage.ref(storagePath);
  await ref.put(blob, { contentType: contentType || blob.type || "application/octet-stream" });
  return await ref.getDownloadURL();
}

async function importBackupZip(file) {
  if (typeof JSZip === "undefined") throw new Error("Backup ZIP library failed to load.");
  const zip = await JSZip.loadAsync(file);
  const manifestEntry = zip.file("manifest.json");
  if (!manifestEntry) throw new Error("Backup ZIP is missing manifest.json.");

  const manifest = normalizeBackupManifest(JSON.parse(await manifestEntry.async("string")));
  if (!manifest.books.length) throw new Error("Backup ZIP does not contain any books.");
  if (manifest.schemaVersion > BACKUP_SCHEMA_VERSION) {
    console.warn("[importBackupZip] newer schema version:", manifest.schemaVersion);
  }

  manifest.shelves.forEach(function(shelf) {
    if (shelf && shelf.id && shelf.name && !shelves.find(function(existing) { return existing.id === shelf.id; })) {
      shelves.push(shelf);
    }
  });

  const { added, updated, idMap } = upsertBackupBooks(manifest.books);
  const importUser = auth.currentUser;
  const importedBriefings = {};
  Object.entries(manifest.briefings).forEach(function([oldId, briefing]) {
    const newId = idMap[oldId];
    if (!newId || !briefing) return;
    importedBriefings[newId] = briefing;
    researchCache[newId] = briefing;
  });

  const importedAudioDocs = {};
  const importedBookPhotos = {};
  let restoredCovers = 0;
  let restoredExtraPhotos = 0;
  let restoredAudio = 0;

  for (const rawBook of manifest.books) {
    const targetId = idMap[rawBook.id];
    if (!targetId) continue;
    const targetBook = books.find(function(entry) { return entry.id === targetId; });
    if (!targetBook) continue;

    const coverAsset = coverAssetForBook(rawBook.id, manifest);
    if (coverAsset && coverAsset.pathInZip && zip.file(coverAsset.pathInZip)) {
      try {
        const blob = await zip.file(coverAsset.pathInZip).async("blob");
        const ext = extFromPath(coverAsset.pathInZip, extFromContentType(coverAsset.contentType, ".jpg")) || ".jpg";
        const coverUrl = await uploadImportedBlob(`users/${importUser.uid}/covers/${targetId}${ext}`, blob, coverAsset.contentType);
        targetBook.coverUrl = coverUrl;
        restoredCovers++;
      } catch (error) {
        console.warn("[importBackupZip] cover restore failed:", rawBook.title, error);
      }
    }

    const rawPhotos = sanitizeBookPhotoList((manifest.bookPhotos && manifest.bookPhotos[rawBook.id]) || []);
    if (rawPhotos.length) {
      const photoAssets = photoAssetsForBook(rawBook.id, manifest);
      const restoredPhotos = [];
      for (const rawPhoto of rawPhotos) {
        const asset = photoAssets.find(function(entry) { return entry.photoId === rawPhoto.id; });
        if (!asset || !asset.pathInZip || !zip.file(asset.pathInZip)) continue;
        try {
          const blob = await zip.file(asset.pathInZip).async("blob");
          const ext = extFromPath(asset.pathInZip, extFromContentType(asset.contentType, ".jpg")) || ".jpg";
          const storagePath = `users/${importUser.uid}/book-photos/${targetId}/${rawPhoto.id}${ext}`;
          const url = await uploadImportedBlob(storagePath, blob, asset.contentType);
          restoredPhotos.push({
            ...rawPhoto,
            url,
            storagePath
          });
          restoredExtraPhotos++;
        } catch (error) {
          console.warn("[importBackupZip] additional photo restore failed:", rawBook.title, rawPhoto.id, error);
        }
      }
      if (restoredPhotos.length) {
        importedBookPhotos[targetId] = restoredPhotos.map(function(photo, index) {
          return { ...photo, sortOrder: index };
        });
        bookPhotoCache[targetId] = importedBookPhotos[targetId];
      }
    }

    const audioDoc = manifest.briefingAudio && manifest.briefingAudio[rawBook.id];
    const variants = audioDoc && typeof audioDoc.variants === "object" ? audioDoc.variants : {};
    const restoredVariants = {};
    for (const variant of Object.keys(variants)) {
      const asset = audioAssetForBook(rawBook.id, variant, manifest);
      if (!asset || !asset.pathInZip || !zip.file(asset.pathInZip)) continue;
      try {
        const blob = await zip.file(asset.pathInZip).async("blob");
        const ext = extFromPath(asset.pathInZip, extFromContentType(asset.contentType, ".wav")) || ".wav";
        const audioPath = `users/${importUser.uid}/briefing-audio/${targetId}-${variant}${ext}`;
        await uploadImportedBlob(audioPath, blob, asset.contentType || "audio/wav");
        restoredVariants[variant] = {
          ...variants[variant],
          status: "ready",
          audioPath
        };
        restoredAudio++;
      } catch (error) {
        console.warn("[importBackupZip] audio restore failed:", rawBook.title, variant, error);
      }
    }
    if (Object.keys(restoredVariants).length) {
      const existingAudioDoc = briefingAudioCache[targetId] && typeof briefingAudioCache[targetId] === "object"
        ? briefingAudioCache[targetId]
        : {};
      const existingVariants = existingAudioDoc.variants && typeof existingAudioDoc.variants === "object"
        ? existingAudioDoc.variants
        : {};
      importedAudioDocs[targetId] = {
        updatedAt: new Date().toISOString(),
        variants: { ...existingVariants, ...restoredVariants }
      };
      briefingAudioCache[targetId] = importedAudioDocs[targetId];
    }
  }

  await persistCatalog();

  if (importUser && Object.keys(importedBriefings).length > 0) {
    try {
      const batch = db.batch();
      Object.entries(importedBriefings).forEach(function([id, data]) {
        batch.set(db.collection("users").doc(importUser.uid).collection("briefings").doc(id), data);
      });
      await batch.commit();
    } catch (err) { console.error("[importBackupZip] briefing save failed:", err); }
  }

  if (importUser && Object.keys(importedAudioDocs).length > 0) {
    try {
      const batch = db.batch();
      Object.entries(importedAudioDocs).forEach(function([id, data]) {
        batch.set(db.collection("users").doc(importUser.uid).collection("briefingAudio").doc(id), data);
      });
      await batch.commit();
    } catch (err) { console.error("[importBackupZip] briefing audio save failed:", err); }
  }

  if (importUser && Object.keys(importedBookPhotos).length > 0) {
    try {
      const batch = db.batch();
      Object.entries(importedBookPhotos).forEach(function([id, photos]) {
        batch.set(db.collection("users").doc(importUser.uid).collection("bookPhotos").doc(id), {
          photos: sanitizeBookPhotoList(photos),
          updatedAt: new Date().toISOString()
        });
      });
      await batch.commit();
    } catch (err) { console.error("[importBackupZip] book photo save failed:", err); }
  }

  if (manifest.preferences.currentShelfId && shelves.find(function(s) { return s.id === manifest.preferences.currentShelfId; })) {
    currentShelfId = manifest.preferences.currentShelfId;
    saveCurrentShelfId();
  }

  updateShelfLabel();
  updateShelfSelector();
  renderCatalog();
  renderBriefingPanel();
  updateResearchButtons();

  const parts = [];
  if (added > 0) parts.push(`${added} new book${added === 1 ? "" : "s"} added`);
  if (updated > 0) parts.push(`${updated} existing book${updated === 1 ? "" : "s"} restored`);
  if (Object.keys(importedBriefings).length > 0) parts.push(`${Object.keys(importedBriefings).length} briefing${Object.keys(importedBriefings).length === 1 ? "" : "s"} restored`);
  if (restoredCovers > 0) parts.push(`${restoredCovers} cover image${restoredCovers === 1 ? "" : "s"} restored`);
  if (restoredExtraPhotos > 0) parts.push(`${restoredExtraPhotos} additional photo${restoredExtraPhotos === 1 ? "" : "s"} restored`);
  if (restoredAudio > 0) parts.push(`${restoredAudio} audio file${restoredAudio === 1 ? "" : "s"} restored`);
  if (parts.length === 0) parts.push("no changes");
  setStatus("addStatus", `Backup import complete: ${parts.join(", ")}.`, "success");
  setTimeout(() => setStatus("addStatus", "", ""), 5000);
}

const EXPORT_CSV_HEADERS = ["Title", "Author", "ISBN", "Year", "Publisher", "Edition", "Subjects", "Condition", "Shelf", "Reading Status", "Start Date", "Finish Date", "Rating", "Notes", "Personal Notes"];

function exportCSV() {
  const csvEscape = (value) => `"${value == null ? "" : String(value).replace(/"/g, '""')}"`;
  const rows = books.map((book) => [
    book.title, book.author, book.isbn, book.year, book.publisher, book.edition, book.subjects,
    book.condition, book.shelf, book.readingStatus, book.startDate, book.finishDate, book.rating,
    book.notes, book.personalNotes
  ].map(csvEscape));
  const csv = [EXPORT_CSV_HEADERS.map(csvEscape).join(","), ...rows.map((row) => row.join(","))].join("\r\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `my-library-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function normalizeCsvHeader(header) {
  return String(header || "").replace(/^\uFEFF/, "").trim().toLowerCase();
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const value = String(text || "").replace(/^\uFEFF/, "");

  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (inQuotes) {
      if (char === '"') {
        if (value[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      if (row.some((cell) => String(cell || "").trim() !== "")) {
        rows.push(row);
      }
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field !== "" || row.length) {
    row.push(field);
    if (row.some((cell) => String(cell || "").trim() !== "")) {
      rows.push(row);
    }
  }

  return rows;
}

function csvRowsToObjects(rows) {
  if (!rows.length) {
    return [];
  }

  const headers = rows[0].map((header) => String(header || "").replace(/^\uFEFF/, "").trim());
  return rows.slice(1).map((row) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = String(row[index] || "").trim();
    });
    return record;
  });
}

function isExportCsvHeaders(headers) {
  const normalized = headers.map(normalizeCsvHeader);
  return EXPORT_CSV_HEADERS.every((header) => normalized.includes(normalizeCsvHeader(header)));
}

function isGoodreadsCsvHeaders(headers) {
  const normalized = headers.map(normalizeCsvHeader);
  return ["book id", "title", "author", "exclusive shelf", "my rating", "private notes"].every((header) => normalized.includes(header));
}

function cleanImportedIsbn(value) {
  return String(value || "")
    .trim()
    .replace(/^=\s*"/, "")
    .replace(/"$/, "")
    .replace(/^'+|'+$/g, "")
    .replace(/[^0-9X]/gi, "");
}

function normalizeImportedDate(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(raw)) {
    return raw.replace(/\//g, "-");
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
  return "";
}

function parseImportedTimestamp(value) {
  const normalized = normalizeImportedDate(value);
  if (!normalized) {
    return 0;
  }
  const parsed = Date.parse(`${normalized}T00:00:00`);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapImportedReadingStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "to-read") return "Want to Read";
  if (normalized === "currently-reading") return "Currently Reading";
  if (normalized === "read") return "Read";
  if (normalized === "did-not-finish" || normalized === "dnf") return "Did Not Finish";
  return "";
}

function buildImportedBook(book) {
  return normalizeBook({
    listShelfId: currentShelfId,
    condition: "",
    shelf: "",
    notes: "",
    personalNotes: "",
    readingStatus: "",
    startDate: "",
    finishDate: "",
    rating: 0,
    source: "CSV Import",
    coverUrl: "",
    addedAt: Date.now(),
    id: Math.random().toString(36).slice(2),
    ...book
  });
}

function mapExportCsvRecord(record) {
  return buildImportedBook({
    title: record.Title || "",
    author: record.Author || "",
    isbn: cleanImportedIsbn(record.ISBN),
    year: record.Year || "",
    publisher: record.Publisher || "",
    edition: record.Edition || "",
    subjects: record.Subjects || "",
    condition: record.Condition || "",
    shelf: record.Shelf || "",
    readingStatus: record["Reading Status"] || "",
    startDate: normalizeImportedDate(record["Start Date"]),
    finishDate: normalizeImportedDate(record["Finish Date"]),
    rating: Number(record.Rating || 0),
    notes: record.Notes || "",
    personalNotes: record["Personal Notes"] || "",
    source: "CSV Import"
  });
}

function mapGoodreadsRecord(record) {
  const isbn = cleanImportedIsbn(record.ISBN13) || cleanImportedIsbn(record.ISBN);
  const year = String(record["Year Published"] || record["Original Publication Year"] || "").replace(/\.0$/, "").trim();
  const addedAt = parseImportedTimestamp(record["Date Added"]) || Date.now();

  return buildImportedBook({
    title: record.Title || "",
    author: record.Author || "",
    isbn,
    year,
    publisher: record.Publisher || "",
    edition: "",
    subjects: "",
    readingStatus: mapImportedReadingStatus(record["Exclusive Shelf"]),
    finishDate: normalizeImportedDate(record["Date Read"]),
    rating: Number(record["My Rating"] || 0),
    notes: record["Private Notes"] || "",
    personalNotes: record["My Review"] || "",
    source: "Goodreads CSV",
    addedAt
  });
}

function countMissingImportFields(book) {
  return ["coverUrl", "subjects", "edition", "publisher", "year"].filter((field) => !String(book[field] || "").trim()).length;
}

function buildOpenLibraryImportRecord(doc) {
  return {
    title: doc.title || "",
    author: Array.isArray(doc.author_name) ? doc.author_name.join(", ") : "",
    publisher: Array.isArray(doc.publisher) ? doc.publisher[0] || "" : "",
    year: doc.first_publish_year ? String(doc.first_publish_year) : "",
    edition: doc.edition_count ? `${doc.edition_count} edition${doc.edition_count === 1 ? "" : "s"}` : "",
    subjects: Array.isArray(doc.subject) ? doc.subject.slice(0, 5).join("; ") : "",
    isbn: Array.isArray(doc.isbn) ? doc.isbn[0] || "" : "",
    coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : ""
  };
}

async function fetchOpenLibraryImportMatch(book) {
  const isbn = cleanImportedIsbn(book.isbn);
  let match = null;

  if (isbn) {
    const byIsbn = await fetch(`https://openlibrary.org/search.json?isbn=${encodeURIComponent(isbn)}&limit=1`);
    if (byIsbn.ok) {
      const data = await byIsbn.json();
      const doc = Array.isArray(data.docs) ? data.docs[0] : null;
      if (doc) match = buildOpenLibraryImportRecord(doc);
    }
  }

  if (!match) {
    if (!book.title) return null;
    const params = new URLSearchParams();
    params.set("title", book.title);
    if (book.author) params.set("author", book.author);
    params.set("limit", "1");
    const byTitle = await fetch(`https://openlibrary.org/search.json?${params.toString()}`);
    if (!byTitle.ok) return null;
    const data = await byTitle.json();
    const doc = Array.isArray(data.docs) ? data.docs[0] : null;
    if (doc) match = buildOpenLibraryImportRecord(doc);
  }

  // Open Library found the book but has no cover — try Google Books for just the image
  if (match && !match.coverUrl) {
    try {
      const lookupIsbn = isbn || cleanImportedIsbn(match.isbn);
      const q = lookupIsbn
        ? `isbn:${lookupIsbn}`
        : encodeURIComponent([match.title || book.title, match.author || book.author].filter(Boolean).join(" "));
      const gbData = await fetchGbJson(`https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=1`);
      if (gbData && (gbData.totalItems || 0) > 0) {
        const links = ((gbData.items[0].volumeInfo || {}).imageLinks) || {};
        const rawUrl = links.thumbnail || links.smallThumbnail || "";
        if (rawUrl) match.coverUrl = rawUrl.replace(/^http:\/\//, "https://");
      }
    } catch (e) { /* no cover is fine */ }
  }

  return match;
}

async function enrichImportedBooksFromOpenLibrary(importedBooks) {
  let enrichedCount = 0;

  for (let index = 0; index < importedBooks.length; index++) {
    const book = importedBooks[index];
    if (!book || (!book.isbn && !book.title)) {
      continue;
    }

    try {
      setStatus("addStatus", `Importing CSV: checking Open Library for ${index + 1} of ${importedBooks.length}...`, "");
      const match = await fetchOpenLibraryImportMatch(book);
      if (!match) {
        continue;
      }

      const before = countMissingImportFields(book);
      importedBooks[index] = normalizeBook({
        ...book,
        isbn: book.isbn || cleanImportedIsbn(match.isbn),
        publisher: book.publisher || match.publisher,
        year: book.year || match.year,
        edition: book.edition || match.edition,
        subjects: book.subjects || match.subjects,
        coverUrl: book.coverUrl || match.coverUrl
      });
      if (countMissingImportFields(importedBooks[index]) < before) {
        enrichedCount++;
      }
    } catch (error) {
      console.warn("Open Library enrichment failed for import:", book.title, error);
    }
  }

  return enrichedCount;
}

function mergeImportedBooks(imported, options = {}) {
  const duplicateMode = String(options.duplicateMode || "skip");
  let added = 0;
  let skipped = 0;

  for (const book of imported) {
    const matches = books.filter((existing) => {
      if (book.isbn && existing.isbn) {
        return existing.isbn === book.isbn;
      }
      return (existing.title || "").toLowerCase() === (book.title || "").toLowerCase()
        && (existing.author || "").toLowerCase() === (book.author || "").toLowerCase();
    });
    const exists = matches.length > 0;
    const existsOnTargetShelf = matches.some((existing) => (existing.listShelfId || "default") === currentShelfId);
    const shouldImport = !exists
      || duplicateMode === "import_all"
      || (duplicateMode === "import_other_shelves" && !existsOnTargetShelf);

    if (shouldImport) {
      if (!hasCustomOrder(book)) {
        book.customOrder = getNextCustomOrderForShelf(book.listShelfId || "default");
      }
      books.push(book);
      added++;
    } else {
      skipped++;
    }
  }

  return { added, skipped };
}

// JSON import uses upsert: adds new books AND updates listShelfId on existing ones
function upsertImportedBooks(imported) {
  let added = 0, updated = 0;

  for (const book of imported) {
    const existingIdx = books.findIndex((existing) => {
      if (book.isbn && existing.isbn) return existing.isbn === book.isbn;
      return (existing.title || "").toLowerCase() === (book.title || "").toLowerCase()
        && (existing.author || "").toLowerCase() === (book.author || "").toLowerCase();
    });

    if (existingIdx === -1) {
      if (!hasCustomOrder(book)) {
        book.customOrder = getNextCustomOrderForShelf(book.listShelfId || "default");
      }
      books.push(book);
      added++;
    } else if (books[existingIdx].listShelfId !== book.listShelfId) {
      books[existingIdx].listShelfId = book.listShelfId;
      books[existingIdx].customOrder = getNextCustomOrderForShelf(book.listShelfId || "default");
      updated++;
    }
  }

  return { added, updated };
}

async function importCsvCatalog(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) {
    throw new Error("CSV import needs a header row and at least one book row.");
  }

  const headers = rows[0];
  const records = csvRowsToObjects(rows);
  let imported;

  if (isGoodreadsCsvHeaders(headers)) {
    imported = records.map(mapGoodreadsRecord).filter((book) => book.title);
  } else if (isExportCsvHeaders(headers)) {
    imported = records.map(mapExportCsvRecord).filter((book) => book.title);
  } else {
    throw new Error("Unsupported CSV format. Use Goodreads export CSV or this app's export CSV.");
  }

  if (!imported.length) {
    throw new Error("No importable books were found in the CSV.");
  }

  let duplicateMode = "skip";
  if (confirm("Import books that already exist in your catalog as separate copies?\n\nChoose OK to review duplicate handling options. Choose Cancel to skip books that already exist.")) {
    duplicateMode = confirm("Only import a duplicate when the existing match is on a different shelf?\n\nChoose OK for shelf-aware importing. Choose Cancel to import all duplicates as separate copies.")
      ? "import_other_shelves"
      : "import_all";
  }

  let enrichedCount = 0;
  const shouldEnrich = confirm("Fetch covers and subjects from Open Library for imported CSV books? This may take a little longer.");
  if (shouldEnrich) {
    enrichedCount = await enrichImportedBooksFromOpenLibrary(imported);
  }

  const mergeResult = mergeImportedBooks(imported, { duplicateMode });
  const added = mergeResult.added;
  const skipped = mergeResult.skipped;
  await persistCatalog();
  renderCatalog();
  let duplicateText = "";
  if (duplicateMode === "import_all") {
    duplicateText = " including duplicate copies.";
  } else if (duplicateMode === "import_other_shelves") {
    duplicateText = ` (${skipped} already on this shelf and were skipped).`;
  } else {
    duplicateText = ` (${skipped} already existed and were skipped).`;
  }
  setStatus("addStatus", `Imported ${added} book${added === 1 ? "" : "s"}${duplicateText}${shouldEnrich ? " Enriched " + enrichedCount + "." : ""}`, "success");
  setTimeout(() => setStatus("addStatus", "", ""), 5000);
}

async function importCatalog(input) {
  const file = input.files[0];
  if (!file) { return; }
  try {
    const isZip = /\.zip$/i.test(file.name) || file.type === "application/zip" || file.type === "application/x-zip-compressed";
    if (isZip) {
      await importBackupZip(file);
      input.value = "";
      return;
    }

    const text = await file.text();
    const trimmed = text.trimStart();
    const isJson = /\.json$/i.test(file.name) || trimmed.startsWith("{") || trimmed.startsWith("[");

    if (!isJson) {
      await importCsvCatalog(text);
      return;
    }

    const data = JSON.parse(text);
    if (!Array.isArray(data.books)) {
      throw new Error("Invalid JSON format: missing books array.");
    }
    const imported = data.books.map(normalizeBook);
    const importedResearch = data.researchCache && typeof data.researchCache === "object" ? data.researchCache : {};
    const importedBriefingAudio = data.briefingAudio && typeof data.briefingAudio === "object" ? data.briefingAudio : {};
    // Merge any shelves from the import (add ones not already present by id)
    if (Array.isArray(data.shelves)) {
      data.shelves.forEach(function(s) {
        if (s && s.id && s.name && !shelves.find(function(x) { return x.id === s.id; })) {
          shelves.push(s);
        }
      });
    }
    const { added, updated } = upsertImportedBooks(imported);
    Object.assign(researchCache, importedResearch);
    Object.assign(briefingAudioCache, importedBriefingAudio);
    await persistCatalog();
    // Persist any imported briefings to the subcollection
    const importUser = auth.currentUser;
    if (importUser && Object.keys(importedResearch).length > 0) {
      try {
        const batch = db.batch();
        Object.entries(importedResearch).forEach(function([id, data]) {
          batch.set(db.collection("users").doc(importUser.uid).collection("briefings").doc(id), data);
        });
        await batch.commit();
      } catch (err) { console.error("[import] briefing save failed:", err); }
    }
    if (importUser && Object.keys(importedBriefingAudio).length > 0) {
      try {
        const batch = db.batch();
        Object.entries(importedBriefingAudio).forEach(function([id, data]) {
          batch.set(db.collection("users").doc(importUser.uid).collection("briefingAudio").doc(id), data);
        });
        await batch.commit();
      } catch (err) { console.error("[import] briefingAudio save failed:", err); }
    }
    updateShelfSelector();
    renderCatalog();
    const parts = [];
    if (added > 0) parts.push(`${added} new book${added === 1 ? "" : "s"} added`);
    if (updated > 0) parts.push(`${updated} shelf assignment${updated === 1 ? "" : "s"} updated`);
    if (parts.length === 0) parts.push("no changes");
    setStatus("addStatus", `Import complete: ${parts.join(", ")}.`, "success");
    setTimeout(() => setStatus("addStatus", "", ""), 4000);
  } catch (error) {
    setStatus("addStatus", `Import failed: ${error.message}`, "error");
  }
  input.value = "";
}
