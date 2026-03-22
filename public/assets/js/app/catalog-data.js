function serializeBookForCatalog(book) {
  const source = book && typeof book === "object" ? { ...book } : {};
  delete source.additionalPhotos;
  return source;
}

async function persistCatalog() {
  const user = auth.currentUser;
  console.log("[persistCatalog] uid:", user ? user.uid : "null", "booksOwner:", _booksOwnedByUid, "books:", books.length,
    "titles:", books.map(function(b) { return b.title; }));
  if (!user) { return; }
  // GUARD: never write books that were loaded for a different user
  if (_booksOwnedByUid && user.uid !== _booksOwnedByUid) {
    console.error("[persistCatalog] BLOCKED cross-user write! auth uid:", user.uid, "but books belong to:", _booksOwnedByUid);
    return;
  }
  const catalog = db.collection("users").doc(user.uid).collection("catalog");
  try {
    // books/shelves/pending go in "data"; researchCache lives in its own "research"
    // document to avoid hitting Firestore's 1MB per-document limit.
    await catalog.doc("data").set({
      books: books.map(serializeBookForCatalog),
      shelves,
      pendingBriefingIds
    });
  } catch (error) {
    console.error("[persistCatalog] data write failed:", error);
    setStatus("addStatus", "Saved locally, but cloud sync failed.", "error");
  }
}

// Writes a single briefing to its own document in users/{uid}/briefings/{bookId}.
// This is the permanent storage — no 1MB cap risk.
async function saveBriefing(bookId, data) {
  const user = auth.currentUser;
  if (!user) { return; }
  if (_booksOwnedByUid && user.uid !== _booksOwnedByUid) { return; }
  try {
    await db.collection("users").doc(user.uid).collection("briefings").doc(bookId).set(data);
  } catch (error) {
    console.error("[saveBriefing] write failed:", error);
  }
}

function subscribeToBackgroundUpdates(uid) {
  if (_catalogUnsubscribe) { _catalogUnsubscribe(); _catalogUnsubscribe = null; }
  if (_briefingsUnsubscribe) { _briefingsUnsubscribe(); _briefingsUnsubscribe = null; }
  if (_briefingAudioUnsubscribe) { _briefingAudioUnsubscribe(); _briefingAudioUnsubscribe = null; }
  if (_backupJobsUnsubscribe) { _backupJobsUnsubscribe(); _backupJobsUnsubscribe = null; }
  if (_bookPhotosUnsubscribe) { _bookPhotosUnsubscribe(); _bookPhotosUnsubscribe = null; }
  if (_sharesUnsubscribe) { _sharesUnsubscribe(); _sharesUnsubscribe = null; }

  const catalog = db.collection("users").doc(uid).collection("catalog");

  // Watch "data" for pendingBriefingIds changes (written by Cloud Functions)
  _catalogUnsubscribe = catalog.doc("data").onSnapshot((snap) => {
    if (!snap.exists) return;
    if (!auth.currentUser || auth.currentUser.uid !== uid) return;
    const data = snap.data();
    const newPending = Array.isArray(data.pendingBriefingIds) ? data.pendingBriefingIds : [];
    if (JSON.stringify(newPending) !== JSON.stringify(pendingBriefingIds)) {
      pendingBriefingIds = newPending;
      renderCatalog();
      renderBriefingPanel();
      updateResearchButtons();
    }
  }, (err) => { console.error("[subscribeToBackgroundUpdates] data snapshot error:", err); });

  // Watch briefings subcollection — one doc per book, written by Cloud Functions or the client.
  // On initial subscription Firestore delivers all existing docs as "added" changes.
  _briefingsUnsubscribe = db.collection("users").doc(uid).collection("briefings").onSnapshot((snap) => {
    if (!auth.currentUser || auth.currentUser.uid !== uid) return;
    let changed = false;
    snap.docChanges().forEach(function(change) {
      if (change.type === "added" || change.type === "modified") {
        const newData = change.doc.data();
        if (JSON.stringify(researchCache[change.doc.id]) !== JSON.stringify(newData)) {
          researchCache[change.doc.id] = newData;
          changed = true;
        }
      } else if (change.type === "removed") {
        if (researchCache[change.doc.id] !== undefined) {
          delete researchCache[change.doc.id];
          changed = true;
        }
      }
    });
    if (changed) {
      renderCatalog();
      renderBriefingPanel();
      updateResearchButtons();
    }
  }, (err) => { console.error("[subscribeToBackgroundUpdates] briefings snapshot error:", err); });

  _briefingAudioUnsubscribe = db.collection("users").doc(uid).collection("briefingAudio").onSnapshot((snap) => {
    if (!auth.currentUser || auth.currentUser.uid !== uid) return;
    let changed = false;
    snap.docChanges().forEach(function(change) {
      if (change.type === "added" || change.type === "modified") {
        const previousData = briefingAudioCache[change.doc.id];
        const newData = change.doc.data();
        if (JSON.stringify(previousData) !== JSON.stringify(newData)) {
          briefingAudioCache[change.doc.id] = newData;
          handleSelectedBriefingAudioUpdate(change.doc.id, previousData, newData);
          changed = true;
        }
      } else if (change.type === "removed") {
        if (briefingAudioCache[change.doc.id] !== undefined) {
          delete briefingAudioCache[change.doc.id];
          delete briefingAudioUrls[change.doc.id + ":safe"];
          delete briefingAudioUrls[change.doc.id + ":spoiler"];
          delete briefingAudioUrlErrors[change.doc.id + ":safe"];
          delete briefingAudioUrlErrors[change.doc.id + ":spoiler"];
          changed = true;
        }
      }
    });
    if (changed) {
      renderBriefingPanel();
      updateResearchButtons();
    }
  }, (err) => { console.error("[subscribeToBackgroundUpdates] briefingAudio snapshot error:", err); });

  _backupJobsUnsubscribe = db.collection("users").doc(uid).collection("backupJobs").orderBy("createdAt", "desc").limit(10).onSnapshot((snap) => {
    if (!auth.currentUser || auth.currentUser.uid !== uid) return;
    const next = {};
    snap.forEach(function(doc) { next[doc.id] = doc.data(); });
    if (JSON.stringify(next) !== JSON.stringify(backupJobsCache)) {
      backupJobsCache = next;
      const modal = document.getElementById("accountSettingsModal");
      if (modal && modal.classList.contains("open")) {
        _renderBackupJobsSection();
      }
    }
  }, (err) => { console.error("[subscribeToBackgroundUpdates] backupJobs snapshot error:", err); });

  _bookPhotosUnsubscribe = db.collection("users").doc(uid).collection("bookPhotos").onSnapshot((snap) => {
    if (!auth.currentUser || auth.currentUser.uid !== uid) return;
    let changed = false;
    snap.docChanges().forEach(function(change) {
      if (change.type === "added" || change.type === "modified") {
        const nextPhotos = sanitizeBookPhotoList((change.doc.data() || {}).photos);
        if (JSON.stringify(bookPhotoCache[change.doc.id] || []) !== JSON.stringify(nextPhotos)) {
          bookPhotoCache[change.doc.id] = nextPhotos;
          changed = true;
        }
      } else if (change.type === "removed") {
        if (bookPhotoCache[change.doc.id] !== undefined) {
          delete bookPhotoCache[change.doc.id];
          changed = true;
        }
      }
    });
    if (changed) {
      renderCatalog();
      renderBriefingPanel();
    }
  }, (err) => { console.error("[subscribeToBackgroundUpdates] bookPhotos snapshot error:", err); });

  _sharesUnsubscribe = db.collection("users").doc(uid).collection("shares").onSnapshot((snap) => {
    if (!auth.currentUser || auth.currentUser.uid !== uid) return;
    let changed = false;
    snap.docChanges().forEach(function(change) {
      if (change.type === "added" || change.type === "modified") {
        const next = normalizeShareRecord(change.doc.id, change.doc.data() || {});
        if (JSON.stringify(shareRecords[change.doc.id] || null) !== JSON.stringify(next)) {
          shareRecords[change.doc.id] = next;
          changed = true;
        }
      } else if (change.type === "removed") {
        if (shareRecords[change.doc.id] !== undefined) {
          delete shareRecords[change.doc.id];
          changed = true;
        }
      }
    });
    if (changed) {
      const modal = document.getElementById("accountSettingsModal");
      if (modal && modal.classList.contains("open")) {
        renderShareManagementSection();
      }
      renderShelvesModal();
      renderBriefingPanel();
    }
  }, (err) => { console.error("[subscribeToBackgroundUpdates] shares snapshot error:", err); });
}

async function saveBooks() {
  await persistCatalog();
}

async function loadCatalogData() {
  const user = auth.currentUser;
  console.log("[loadCatalogData] uid:", user ? user.uid : "null");
  if (!user) { return; }
  const uid = user.uid;
  try {
    const catalog = db.collection("users").doc(uid).collection("catalog");
    const userDoc = db.collection("users").doc(uid);
    const briefingsCol = userDoc.collection("briefings");
    const briefingAudioCol = userDoc.collection("briefingAudio");
    const backupJobsCol = userDoc.collection("backupJobs");
    const bookPhotosCol = userDoc.collection("bookPhotos");
    const sharesCol = userDoc.collection("shares");
    const [dataSnap, researchSnap, briefingsSnap, briefingAudioResult, backupJobsSnap, bookPhotosSnap, sharesSnap] = await Promise.all([
      catalog.doc("data").get({ source: "server" }),
      catalog.doc("research").get({ source: "server" }),
      briefingsCol.get({ source: "server" }),
      briefingAudioCol.get({ source: "server" }).catch(function(error) {
        console.warn("[loadCatalogData] briefingAudio fetch failed; continuing without audio cache:", error);
        return null;
      }),
      backupJobsCol.orderBy("createdAt", "desc").limit(10).get({ source: "server" }).catch(function(error) {
        console.warn("[loadCatalogData] backupJobs fetch failed; continuing without backup cache:", error);
        return null;
      }),
      bookPhotosCol.get({ source: "server" }).catch(function(error) {
        console.warn("[loadCatalogData] bookPhotos fetch failed; continuing without photo cache:", error);
        return null;
      }),
      sharesCol.get({ source: "server" }).catch(function(error) {
        console.warn("[loadCatalogData] shares fetch failed; continuing without share cache:", error);
        return null;
      })
    ]);
    // If auth changed while we were waiting (race condition), discard stale results.
    if (!auth.currentUser || auth.currentUser.uid !== uid) {
      console.log("[loadCatalogData] user changed during fetch — discarding results for", uid);
      return;
    }
    console.log("[loadCatalogData] data.exists:", dataSnap.exists,
      "research.exists:", researchSnap.exists,
      "briefings docs:", briefingsSnap.size, "for uid:", uid);
    if (dataSnap.exists) {
      const data = dataSnap.data();
      books = Array.isArray(data.books) ? data.books.map(normalizeBook) : [];
      shelves = Array.isArray(data.shelves) && data.shelves.length
        ? data.shelves
        : [{ id: "default", name: "Reading List", createdAt: Date.now() }];
      pendingBriefingIds = Array.isArray(data.pendingBriefingIds) ? data.pendingBriefingIds : [];
    } else {
      books = [];
      shelves = [{ id: "default", name: "Reading List", createdAt: Date.now() }];
      pendingBriefingIds = [];
    }

    // Build researchCache from all three sources (oldest to newest wins):
    //   1. catalog/data.researchCache  — very legacy (pre-split)
    //   2. catalog/research            — intermediate legacy (post-split, pre-subcollection)
    //   3. briefings/{bookId}          — current (subcollection)
    const legacyDataCache = dataSnap.exists && dataSnap.data().researchCache &&
      typeof dataSnap.data().researchCache === "object" ? dataSnap.data().researchCache : {};
    const legacyResearchCache = researchSnap.exists && researchSnap.data().researchCache &&
      typeof researchSnap.data().researchCache === "object" ? researchSnap.data().researchCache : {};
    const subcollectionCache = {};
    briefingsSnap.forEach(function(doc) { subcollectionCache[doc.id] = doc.data(); });
    const audioCache = {};
    if (briefingAudioResult && typeof briefingAudioResult.forEach === "function") {
      briefingAudioResult.forEach(function(doc) { audioCache[doc.id] = doc.data(); });
    }
    const backupCache = {};
    if (backupJobsSnap && typeof backupJobsSnap.forEach === "function") {
      backupJobsSnap.forEach(function(doc) { backupCache[doc.id] = doc.data(); });
    }
    const nextBookPhotoCache = {};
    if (bookPhotosSnap && typeof bookPhotosSnap.forEach === "function") {
      bookPhotosSnap.forEach(function(doc) {
        const data = doc.data() || {};
        nextBookPhotoCache[doc.id] = sanitizeBookPhotoList(data.photos);
      });
    }

    const normalizedShares = {};
    if (sharesSnap && typeof sharesSnap.forEach === "function") {
      sharesSnap.forEach(function(doc) {
        normalizedShares[doc.id] = normalizeShareRecord(doc.id, doc.data() || {});
      });
    }
    const legacyShareRecords = deriveLegacyShareRecords(dataSnap.exists ? dataSnap.data().shareLinks : {});
    shareRecords = Object.assign({}, legacyShareRecords, normalizedShares);
    backfillLegacyShareRecords(uid, legacyShareRecords, normalizedShares);

    researchCache = Object.assign({}, legacyDataCache, legacyResearchCache, subcollectionCache);
    briefingAudioCache = audioCache;
    backupJobsCache = backupCache;
    bookPhotoCache = nextBookPhotoCache;
    console.log("[loadCatalogData] briefings in cache:", Object.keys(researchCache).length,
      "(subcollection:", briefingsSnap.size, "legacy-research:", Object.keys(legacyResearchCache).length,
      "legacy-data:", Object.keys(legacyDataCache).length, ")");

    // Migration: copy any briefings not yet in the subcollection into briefings/{bookId} docs.
    const toMigrate = Object.entries(researchCache).filter(function([id]) { return !subcollectionCache[id]; });
    if (toMigrate.length > 0) {
      console.log("[loadCatalogData] migrating", toMigrate.length, "briefings to subcollection…");
      const BATCH_SIZE = 400;
      for (let i = 0; i < toMigrate.length; i += BATCH_SIZE) {
        const batch = db.batch();
        toMigrate.slice(i, i + BATCH_SIZE).forEach(function([id, briefingData]) {
          batch.set(briefingsCol.doc(id), briefingData);
        });
        await batch.commit().catch(function(err) {
          console.error("[loadCatalogData] migration batch failed:", err);
        });
      }
    }

    // Restore last-viewed shelf for this user
    const savedShelfId = loadSavedShelfId(uid);
    currentShelfId = shelves.find(s => s.id === savedShelfId) ? savedShelfId : shelves[0].id;
    _booksOwnedByUid = uid;
    console.log("[loadCatalogData] books after load:", books.length, "owner set to:", uid);
  } catch (error) {
    console.error("[loadCatalogData] error:", error);
    setStatus("addStatus", "Cloud sync failed.", "error");
  }
}
