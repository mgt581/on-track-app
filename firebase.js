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

let firebaseConfig = null;
let firebaseSetupError = '';

try {
  ({ firebaseConfig } = await import('./firebase-config.local.js'));
} catch {
  firebaseSetupError = 'Add firebase-config.local.js from firebase-config.example.js to enable sign-in.';
}

const requiredKeys = [
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId'
];

const hasPlaceholderValue = (value) => typeof value === 'string' && (
  value.includes('your_')
  || value.includes('YOUR_')
  || value.includes('example')
);

const isFirebaseConfigured = requiredKeys.every((key) => {
  const value = firebaseConfig?.[key];
  return typeof value === 'string' && value.trim() && !hasPlaceholderValue(value);
});

if (!isFirebaseConfigured && !firebaseSetupError) {
  firebaseSetupError = 'Firebase config is incomplete. Update firebase-config.local.js.';
}

const app = isFirebaseConfigured ? initializeApp(firebaseConfig) : null;
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;

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
    throw new Error(firebaseSetupError || 'Firebase auth is not configured.');
  }

  return signInWithEmailAndPassword(auth, email, password);
}

export async function signUpWithEmail(email, password) {
  if (!auth) {
    throw new Error(firebaseSetupError || 'Firebase auth is not configured.');
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
