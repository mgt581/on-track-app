const firebaseConfig = {
  apiKey: 'AIzaSyCO3O5GwiUiOY6h787quLG5EOYWaHngAG8',
  authDomain: 'on-track-73a59.firebaseapp.com',
  projectId: 'on-track-73a59',
  storageBucket: 'on-track-73a59.firebasestorage.app',
  messagingSenderId: '884731352316',
  appId: '1:884731352316:web:891332370b5f199b88f379',
  measurementId: 'G-GR7MK86PDG'
};

const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const googleProvider = new firebase.auth.GoogleAuthProvider();

window.onTrackFirebase = {
  app,
  auth,
  googleProvider
};