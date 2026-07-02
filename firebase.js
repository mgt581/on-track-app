const firebaseConfig = window.ON_TRACK_FIREBASE_CONFIG;
const requiredFirebaseKeys = ['apiKey', 'authDomain', 'projectId', 'appId'];
const missingFirebaseKeys = requiredFirebaseKeys.filter((key) => {
  const value = firebaseConfig?.[key];
  return typeof value !== 'string' || !value.trim();
});

window.onTrackFirebase = null;
window.onTrackFirebaseError = '';

if (missingFirebaseKeys.length) {
  window.onTrackFirebaseError = `Firebase config is missing: ${missingFirebaseKeys.join(', ')}.`;
  console.error(window.onTrackFirebaseError);
} else {
  const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const googleProvider = new firebase.auth.GoogleAuthProvider();

  window.onTrackFirebase = {
    app,
    auth,
    googleProvider
  };
}