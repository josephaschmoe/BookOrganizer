// ── Firebase init ─────────────────────────────────────────────────────────────
const firebaseServices = initializeTomeShelfFirebase({ functions: true });
const functions = firebaseServices.functions;

// ── State ─────────────────────────────────────────────────────────────────────
let sharedBooks       = [];
let sharedCache       = {};
let sharedAudioCache  = {};
let sharedShelfName   = "";
let sharedShareType   = "shelf";
let sharedAllowWikiAI = false;
let sharedAllowBriefingAudio = false;
let selectedBookId    = null;
let showSpoilers      = false;
let currentFilter     = "";
let currentSort       = "added";
let isMobileDetail    = false; // tracks if mobile user is in detail view
let shareDetailExpanded = false;
let sharedAudioUrls   = {};
let sharedAudioLoading = {};
let sharedAudioUrlErrors = {};
let _coverLightboxItems = [];
let _coverLightboxIndex = -1;
let _coverLightboxTouchX = 0;
let _coverLightboxTouchY = 0;
let sharedBookPhotoSectionCollapsed = {};
let sharedHasPhotosModeSectionCollapsed = false;
