let _pendingSignOut = null;
let _explicitSignOut = false;

function _doSignOut() {
  if (_catalogUnsubscribe) { _catalogUnsubscribe(); _catalogUnsubscribe = null; }
  if (_briefingsUnsubscribe) { _briefingsUnsubscribe(); _briefingsUnsubscribe = null; }
  if (_briefingAudioUnsubscribe) { _briefingAudioUnsubscribe(); _briefingAudioUnsubscribe = null; }
  if (_backupJobsUnsubscribe) { _backupJobsUnsubscribe(); _backupJobsUnsubscribe = null; }
  if (_bookPhotosUnsubscribe) { _bookPhotosUnsubscribe(); _bookPhotosUnsubscribe = null; }
  document.getElementById("authOverlay").style.display = "flex";
  document.getElementById("guestBanner").style.display = "none";
  const icon = document.getElementById("userEmailIcon");
  const emailText = document.getElementById("userEmailText");
  icon.style.display = "none";
  icon.src = "";
  emailText.style.display = "none";
  _booksOwnedByUid = null;
  adminAccessState = {
    hasStoredAdminAccess: false,
    adminAccessValid: false,
    adminAccessDisabled: false,
    adminAccessStale: false
  };
  books = [];
  researchCache = {};
  briefingAudioCache = {};
  backupJobsCache = {};
  bookPhotoCache = {};
  shareRecords = {};
  briefingAudioUrls = {};
  briefingAudioUrlErrors = {};
  pendingBriefingIds = [];
  shelves = [{ id: "default", name: "Reading List", createdAt: Date.now() }];
  currentShelfId = "default";
  localStorage.removeItem("myLibraryBooks");
  localStorage.removeItem("myLibraryResearch");
  catalogLoading = false;
  selectedBookId = null;
  updateShelfLabel();
  updateShelfSelector();
  renderCatalog();
  renderBriefingPanel();
  updateResearchButtons();
  loadApiConfig();
}

// Camera-return overlay suppression
// On iOS, using capture="environment" can trigger a full page reload when the
// user returns from the native camera.  The auth overlay is visible by default
// in CSS; Firebase takes 1-2 s to restore the cached session, so the user would
// see the login form flash briefly on every camera photo.  Running this check
// synchronously, before onAuthStateChanged is even registered, hides the
// overlay immediately if the camera was recently opened (localStorage flag set
// by startPhotoCamera), making the reload invisible to the user.
(function () {
  try {
    const ts = parseInt(localStorage.getItem("_cameraActive") || "0", 10);
    if (ts && Date.now() - ts < 120000) {
      const ov = document.getElementById("authOverlay");
      if (ov) ov.style.display = "none";
    }
  } catch (e) {}
}());

// bfcache restore (page was frozen rather than reloaded): timers may fire
// immediately on restore if their duration elapsed while the page was frozen.
// Cancel any stale pending sign-out and re-issue a fresh one so Firebase has
// time to re-validate the session after the page returns to foreground.
window.addEventListener("pageshow", function (event) {
  if (!event.persisted) return;
  if (_pendingSignOut) { clearTimeout(_pendingSignOut); _pendingSignOut = null; }
  try {
    const ts = parseInt(localStorage.getItem("_cameraActive") || "0", 10);
    if (ts && Date.now() - ts < 120000) {
      const ov = document.getElementById("authOverlay");
      if (ov) ov.style.display = "none";
      restoreAddFlowState();
      setMobileSection("add");
      _pendingSignOut = setTimeout(function () { _pendingSignOut = null; _doSignOut(); }, 8000);
    }
  } catch (e) {}
});

document.addEventListener("visibilitychange", function () {
  if (document.hidden) return;
  try {
    const ts = parseInt(localStorage.getItem("_cameraActive") || "0", 10);
    if (ts && Date.now() - ts < 120000) {
      restoreAddFlowState();
      setMobileSection("add");
    }
  } catch (e) {}
});

async function applyAuthenticatedUi(user, cameraReturn) {
  document.getElementById("authOverlay").style.display = "none";
  const icon = document.getElementById("userEmailIcon");
  const emailText = document.getElementById("userEmailText");
  const guestBanner = document.getElementById("guestBanner");
  const signInMenuItem = document.getElementById("accountMenuSignIn");

  if (user.isAnonymous) {
    icon.style.display = "none";
    emailText.textContent = "Guest";
    emailText.setAttribute("title", "Guest session — click to manage");
    emailText.style.display = "inline";
    guestBanner.style.display = "flex";
    if (signInMenuItem) signInMenuItem.style.display = "";
  } else if (user.photoURL) {
    icon.src = user.photoURL;
    icon.setAttribute("title", `Account (${user.email})`);
    icon.style.display = "inline-block";
    emailText.style.display = "none";
    guestBanner.style.display = "none";
    if (signInMenuItem) signInMenuItem.style.display = "none";
  } else {
    icon.style.display = "none";
    emailText.textContent = user.email;
    emailText.setAttribute("title", "Account");
    emailText.style.display = "inline";
    guestBanner.style.display = "none";
    if (signInMenuItem) signInMenuItem.style.display = "none";
  }

  if (user.uid === _booksOwnedByUid) return;

  catalogLoading = true;
  _booksOwnedByUid = null; // reset until loadCatalogData sets it
  books = [];
  researchCache = {};
  briefingAudioCache = {};
  backupJobsCache = {};
  briefingAudioUrls = {};
  briefingAudioUrlErrors = {};
  shelves = [];
  pendingBriefingIds = [];
  currentShelfId = "default";
  await initializeApp(cameraReturn);
  subscribeToBackgroundUpdates(user.uid);
}

auth.onAuthStateChanged(async (user) => {
  console.log("[onAuthStateChanged] uid:", user ? user.uid : "null", "email:", user ? user.email : "null",
    "prev booksOwner:", _booksOwnedByUid);

  if (user) {
    _explicitSignOut = false;
    if (_pendingSignOut) { clearTimeout(_pendingSignOut); _pendingSignOut = null; }
    let _wasCameraReturn = false;
    try {
      const _cts = parseInt(localStorage.getItem("_cameraActive") || "0", 10);
      _wasCameraReturn = _cts > 0 && (Date.now() - _cts < 120000);
      localStorage.removeItem("_cameraActive");
    } catch(e) {}

    await applyAuthenticatedUi(user, _wasCameraReturn);
    return;

  } else {
    if (_explicitSignOut) {
      _explicitSignOut = false;
      if (_pendingSignOut) { clearTimeout(_pendingSignOut); _pendingSignOut = null; }
      _doSignOut();
      return;
    }
    const _cameraTs = (() => {
      try { return parseInt(localStorage.getItem("_cameraActive") || "0", 10); } catch(e) { return 0; }
    })();
    const _recentCamera = _cameraTs > 0 && (Date.now() - _cameraTs < 120000); // within 2 min

    if (!_recentCamera) {
      const icon = document.getElementById("userEmailIcon");
      const emailText = document.getElementById("userEmailText");
      icon.style.display = "none";
      icon.src = "";
      emailText.style.display = "none";
    }

    if (_booksOwnedByUid || _recentCamera) {
      if (!_pendingSignOut) {
        _pendingSignOut = setTimeout(() => { _pendingSignOut = null; _doSignOut(); }, 8000);
      }
    } else {
      _doSignOut();
    }
  }
});

setTimeout(function () {
  if (auth.currentUser) {
    applyAuthenticatedUi(auth.currentUser, false).catch(function (error) {
      console.error("[applyAuthenticatedUi bootstrap] failed:", error);
    });
  }
}, 500);


