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
  arrayUnion,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  runTransaction,
  setDoc,
  updateDoc
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
const plannerDocRef = (userId) => doc(db, 'users', userId, 'planner', 'main');
const sharedCalendarDocRef = (calendarId) => doc(db, 'sharedCalendars', calendarId);

export const OWNER_EMAILS = [
  'alexbryantwork3234@outlook.com',
  'meganbullock881@yahoo.com'
];

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

export async function loadPlannerForUser(userId, userEmail, fallbackState, invite) {
  if (!db) {
    return {
      calendarId: null,
      inviteCode: '',
      memberCount: 0,
      state: fallbackState
    };
  }

  const userPlannerRef = plannerDocRef(userId);
  let userPlannerSnapshot = await getDoc(userPlannerRef);
  let userPlanner = userPlannerSnapshot.exists() ? userPlannerSnapshot.data() : {};
  let calendarId = userPlanner.sharedCalendarId || '';

  if (invite?.calendarId) {
    if (calendarId && calendarId !== invite.calendarId) {
      throw new Error('This account is already connected to another shared calendar.');
    }

    if (!calendarId) {
      await joinSharedCalendar(userId, userEmail, invite.calendarId, invite.inviteCode);
      calendarId = invite.calendarId;
      userPlannerSnapshot = await getDoc(userPlannerRef);
      userPlanner = userPlannerSnapshot.exists() ? userPlannerSnapshot.data() : {};
    }
  }

  if (!calendarId) {
    const created = await createSharedCalendar(userId, userEmail, fallbackState);
    calendarId = created.calendarId;
    userPlanner = { ...userPlanner, sharedCalendarId: calendarId, inviteCode: created.inviteCode };
  }

  const sharedSnapshot = await getDoc(sharedCalendarDocRef(calendarId));
  if (!sharedSnapshot.exists()) {
    throw new Error('The shared calendar could not be found.');
  }

  const sharedCalendar = sharedSnapshot.data();
  if (!Array.isArray(sharedCalendar.memberUids) || !sharedCalendar.memberUids.includes(userId)) {
    throw new Error('This account is not a member of the shared calendar.');
  }

  const ownerUid = sharedCalendar.ownerUid || sharedCalendar.memberUids[0] || userId;
  if (!sharedCalendar.ownerUid) {
    await updateDoc(sharedCalendarDocRef(calendarId), {
      ownerUid,
      planKey: sharedCalendar.planKey || 'free',
      maxMembers: sharedCalendar.maxMembers || 1
    });
  }

  if (!userPlanner.sharedCalendarId) {
    await setDoc(userPlannerRef, {
      sharedCalendarId: calendarId,
      inviteCode: sharedCalendar.inviteCode || ''
    }, { merge: true });
  }

  return {
    calendarId,
    inviteCode: sharedCalendar.inviteCode || '',
    memberCount: sharedCalendar.memberUids.length,
    memberUids: sharedCalendar.memberUids,
    memberEmails: sharedCalendar.memberEmails || [],
    ownerUid,
    planKey: sharedCalendar.planKey || 'free',
    maxMembers: sharedCalendar.maxMembers || 1,
    state: sharedCalendar.state ?? fallbackState
  };
}

async function createSharedCalendar(userId, userEmail, initialState) {
  const calendarId = crypto.randomUUID();
  const inviteCode = createInviteCode();
  const plannerRef = plannerDocRef(userId);

  await runTransaction(db, async (transaction) => {
    const existingPlanner = await transaction.get(plannerRef);
    const existingData = existingPlanner.exists() ? existingPlanner.data() : {};
    if (existingData.sharedCalendarId) {
      return;
    }

    transaction.set(sharedCalendarDocRef(calendarId), {
      inviteCode,
      ownerUid: userId,
      planKey: 'free',
      maxMembers: 1,
      memberUids: [userId],
      memberEmails: [userEmail],
      state: existingData.state || initialState,
      updatedAt: serverTimestamp()
    });
    transaction.set(plannerRef, {
      sharedCalendarId: calendarId,
      inviteCode
    }, { merge: true });
  });

  const plannerSnapshot = await getDoc(plannerRef);
  const planner = plannerSnapshot.exists() ? plannerSnapshot.data() : {};
  return {
    calendarId: planner.sharedCalendarId || calendarId,
    inviteCode: planner.inviteCode || inviteCode
  };
}

async function joinSharedCalendar(userId, userEmail, calendarId, inviteCode) {
  if (!inviteCode) {
    throw new Error('This invite link is missing its invite code.');
  }

  await updateDoc(sharedCalendarDocRef(calendarId), {
    memberUids: arrayUnion(userId),
    memberEmails: arrayUnion(userEmail)
  });

  await setDoc(plannerDocRef(userId), {
    sharedCalendarId: calendarId,
    inviteCode
  }, { merge: true });
}

export function subscribeToPlannerState(calendarId, callback, onError) {
  if (!db || !calendarId) {
    return () => {};
  }
  return onSnapshot(
    sharedCalendarDocRef(calendarId),
    (snapshot) => callback(snapshot.exists() ? snapshot.data()?.state ?? null : null),
    onError
  );
}

export async function saveStateForCalendar(calendarId, state, baseState = null) {
  if (!db || !calendarId) {
    return state;
  }

  return runTransaction(db, async (transaction) => {
    const calendarRef = sharedCalendarDocRef(calendarId);
    const snapshot = await transaction.get(calendarRef);
    const remoteState = snapshot.exists() ? snapshot.data()?.state ?? null : null;
    const mergedState = mergePlannerStates(remoteState, state, baseState);

    transaction.update(calendarRef, {
      state: mergedState,
      updatedAt: serverTimestamp()
    });

    return mergedState;
  });
}

function createInviteCode() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function mergePlannerStates(remoteState, localState, baseState) {
  const remote = remoteState && typeof remoteState === 'object' ? remoteState : {};
  const local = localState && typeof localState === 'object' ? localState : {};
  const base = baseState && typeof baseState === 'object' ? baseState : null;

  return {
    services: mergeCollection(remote.services, local.services, base?.services),
    entries: mergeCollection(remote.entries, local.entries, base?.entries)
  };
}

function mergeCollection(remoteItems, localItems, baseItems) {
  const remoteMap = toItemMap(remoteItems);
  const localMap = toItemMap(localItems);
  const baseMap = toItemMap(baseItems);
  const ids = new Set([...remoteMap.keys(), ...localMap.keys(), ...baseMap.keys()]);
  const merged = [];

  ids.forEach((id) => {
    const remoteItem = remoteMap.get(id);
    const localItem = localMap.get(id);
    const baseItem = baseMap.get(id);

    if (!baseItem) {
      // New local items are additive. Preserve remote items created by another
      // device instead of letting a stale full-state upload erase them.
      merged.push(localItem || remoteItem);
      return;
    }

    const localChanged = !sameValue(localItem, baseItem);
    const remoteChanged = !sameValue(remoteItem, baseItem);

    if (localChanged && !remoteChanged) {
      if (localItem) {
        merged.push(localItem);
      }
      return;
    }

    // If both devices changed the same item, the later transaction's edit
    // wins. Otherwise keep the remote edit, including a remote deletion.
    if (localChanged && remoteChanged && localItem) {
      merged.push(localItem);
    } else if (remoteItem) {
      merged.push(remoteItem);
    } else if (localItem && !remoteChanged) {
      merged.push(localItem);
    }
  });

  return merged;
}

function toItemMap(items) {
  return new Map(
    Array.isArray(items)
      ? items
        .filter((item) => item && typeof item.id === 'string' && item.id)
        .map((item) => [item.id, item])
      : []
  );
}

function sameValue(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}
