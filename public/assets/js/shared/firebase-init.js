(function() {
  var firebaseConfig = {
    apiKey: "AIzaSyDs5NToY8F_aOZhNLv_KKF517AjUlfi5a4",
    authDomain: "schmoeslibrary-ff6c2.firebaseapp.com",
    projectId: "schmoeslibrary-ff6c2",
    storageBucket: "schmoeslibrary-ff6c2.firebasestorage.app",
    messagingSenderId: "988288822165",
    appId: "1:988288822165:web:13b457d9c73384bdeda49c"
  };

  function ensureTomeShelfFirebaseApp() {
    if (firebase.apps && firebase.apps.length) {
      return firebase.app();
    }
    return firebase.initializeApp(firebaseConfig);
  }

  function initializeTomeShelfFirebase(options) {
    var requested = options || {};
    var app = ensureTomeShelfFirebaseApp();
    return {
      app: app,
      auth: requested.auth ? firebase.auth() : null,
      db: requested.firestore ? firebase.firestore() : null,
      functions: requested.functions ? firebase.functions() : null,
      storage: requested.storage ? firebase.storage() : null
    };
  }

  window.TOMESHELF_FIREBASE_CONFIG = firebaseConfig;
  window.initializeTomeShelfFirebase = initializeTomeShelfFirebase;
})();
