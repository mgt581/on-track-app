// Import the functions you need from the SDKs you need via CDN
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js';
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js';
import {
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';

// Hardcoded public configuration block so GitHub Pages has access instantly
const firebaseConfig = {
  apiKey: "AIzaSyCO3O5GwiUiOY6h787quLG5EOYWaHngAG8",
  authDomain: "on-track-73a59.firebaseapp.com",
  projectId: "on-track-73a59",
  storageBucket: "on-track-73a59.firebasestorage.app",
  messagingSenderId: "884731352316",
  appId: "1:884731352316:web:891332370b5f199b88f379",
  measurementId: "G-GR7MK86PDG"
};

// Flags for the rest of your UI scripts to check
const firebaseSetupError = '';
const isFirebaseConfigured = true;

// Initialize Firebase Core services
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { auth, db, firebaseSetupError, isFirebaseConfigured };

export function observeAuthState(callback) {
  if (!auth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, callback);
}

export function waitForInitialAuthState() {
  if (!auth) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
}

export async function signInWithEmail(email, password) {
  if (!auth) {
    throw new Error('Firebase auth is not configured.');
  }
  return signInWithEmailAndPassword(auth, email, password);
}

export async function signUpWithEmail(email, password) {
  if (!auth) {
    throw new Error('Firebase auth is not configured.');
  }
  return createUserWithEmailAndPassword(auth, email, password);
}

export async function signOutUser() {
  if (!auth) {
    return;
  }
  await signOut(auth);
}

export async function loadStateForUser(userId) {
  if (!db) {
    return null;
  }
  const snapshot = await getDoc(doc(db, 'users', userId, 'app', 'planner'));
  if (!snapshot.exists()) {
    return null;
  }
  return snapshot.data()?.state ?? null;
}

export function subscribeToUserState(userId, callback, onError) {
  if (!db) {
    return () => {};
  }
  return onSnapshot(
    doc(db, 'users', userId, 'app', 'planner'),
    (snapshot) => callback(snapshot.exists() ? snapshot.data()?.state ?? null : null),
    onError
  );
}

export async function saveStateForUser(userId, state) {
  if (!db) {
    return;
  }
  await setDoc(doc(db, 'users', userId, 'app', 'planner'), {
    state,
    updatedAt: serverTimestamp()
  });
}
