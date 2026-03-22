let books = [];
let researchCache = {};
let briefingAudioCache = {};
let backupJobsCache = {};
let bookPhotoCache = {};
const PRO_TTS_MODEL = "gemini-2.5-pro-preview-tts";
const FLASH_TTS_MODEL = "gemini-2.5-flash-preview-tts";
let shelves = [];
let shareRecords = {};
let currentShelfId = "default";
let _booksOwnedByUid = null; // tracks which user the in-memory books belong to
let pendingBook = null;
let cameraStream = null;
let scanInterval = null;
let currentTab = "isbn";
let singleAddMode = "photo";
let desktopAddPanelCollapsed = false;
let desktopBriefingPanelExpanded = false;
let uiDetailMode = "guided";
let wasMobileLayout = window.innerWidth < 1024;
let researchEnabled = false;
let selectedBookId = null;
let researchRequestInFlight = false;
let briefingAudioPollState = {};
let briefingAudioProAvailableToday = false;
let adminAccessState = {
  hasStoredAdminAccess: false,
  adminAccessValid: false,
  adminAccessDisabled: false,
  adminAccessStale: false
};
let editingBookId = null;
let metadataRefreshContext = null;
let _filteredBookIds = [];
let pendingCoverBlob = null;
let pendingCoverBlobPromise = null;
let _coverSourceTouched = false;
let _coverUploadBookId = null;
let _bookPhotoUploadBookId = null;
let _bookPhotoMetaResolver = null;
let _coverSearchResults = [];
let _coverSearchMode = "library";
let photoFileSourceMeta = [];
let _authorSortTouched = false;
let _coverLightboxItems = [];
let _coverLightboxIndex = -1;
let _coverLightboxTouchX = 0;
let _coverLightboxTouchY = 0;
let bookPhotoSectionCollapsed = {};
let hasPhotosModeSectionCollapsed = false;
let catalogStoragePath = "";
let manualSearchResults = [];
let manualSelectedResult = null;
let filterStatus = "";
let _formRating = 0;
let catalogLoading = true;
let photoFiles = [];
let photoLookupInFlight = false;
let editionLookupInFlight = false;
let pendingEditionLookupContext = null;
let specificEditionMode = false;
let reviewData = null;
let _photoObjectUrl = null;       // object URL of the selected search photo, for cover picker
let _selectedPhotoCoverIndex = 0;
let _selectedCoverSource = "database"; // "database" | "photo"
// Long-press state for cover choice thumbnails
let _coverThumbTimer   = null;
let _coverThumbFired   = false;  // true if the long-press lightbox already opened
let _coverThumbStartX  = 0;
let _coverThumbStartY  = 0;
const COVER_LONG_PRESS_MS = 450;
let html5QrScanner = null;
// Bulk Load state
let bulkLoadInFlight = false;
let bulkFoundBooks   = [];   // [{aiTitle, aiAuthor, result, correct}]
let bulkIncorrectQueue  = []; // [{aiTitle, aiAuthor}] for correction flow
let bulkCorrectionIdx   = 0;
let bulkCorrSearchResults  = [];
let bulkCorrSelectedResult = null;
let bulkSecondPassActive   = false;  // true while in Phase 3 second-pass mode
let bulkSecondPassFailures = [];     // failures accumulated across second-pass photos
let bulkTextMode           = false;  // true when photo came from "Titles in Text" (no second-pass/correction)
let bulkBatchMode          = false;  // true when processing many individual photos
let bulkPasteMode          = false;  // true when Titles in Text came from pasted text
let bulkObjectUrls         = [];     // object URLs for batch-photo correction/lightbox previews
let bulkProgress = { total: 0, processed: 0, stage: "", manual: 0, duplicates: 0 };
let bulkAllowDuplicateOverride = false;
let selectionMode    = false;
let selectedBookIds  = new Set();
let dragReorderState = {
  bookId: null,
  targetBookId: null,
  position: null
};
let pendingBriefingIds = [];
// Briefings now use Perplexity Sonar for all books.
function expectedBriefingModel(book) {
  return "perplexity-sonar-pro";
}
let _catalogUnsubscribe = null;  // snapshot listener teardown
let _briefingsUnsubscribe = null; // briefings subcollection listener teardown
let _briefingAudioUnsubscribe = null; // briefing audio subcollection listener teardown
let _backupJobsUnsubscribe = null; // backup jobs subcollection listener teardown
let _bookPhotosUnsubscribe = null; // book photos subcollection listener teardown
let _sharesUnsubscribe = null; // share records subcollection listener teardown
let _allowDuplicateOverride = false;
let briefingAudioRequestInFlight = false;
let briefingAudioUrls = {};
let briefingAudioUrlErrors = {};
const AUDIO_GENERATING_STALE_MS = 20 * 60 * 1000;
let accountShareView = "shelves";
let selectedSharedBookToken = null;
let _shareDialogContext = null;
