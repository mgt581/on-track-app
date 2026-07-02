const firebaseClient = window.onTrackFirebase;
const authStatus = document.getElementById('auth-status');
const signedOutView = document.getElementById('signed-out-view');
const signedInView = document.getElementById('signed-in-view');
const emailAuthForm = document.getElementById('email-auth-form');
const authEmail = document.getElementById('auth-email');
const authPassword = document.getElementById('auth-password');
const emailSignInBtn = document.getElementById('email-sign-in-btn');
const emailSignUpBtn = document.getElementById('email-sign-up-btn');
const googleSignInBtn = document.getElementById('google-sign-in-btn');
const pageSignOutBtn = document.getElementById('page-sign-out-btn');
const signedInEmail = document.getElementById('signed-in-email');

if (!firebaseClient?.auth) {
  setStatus('Firebase auth is not available. Reload the page and try again.', 'error');
} else {
  firebaseClient.auth.onAuthStateChanged((user) => {
    const isSignedIn = Boolean(user);
    signedOutView.hidden = isSignedIn;
    signedInView.hidden = !isSignedIn;
    signedInEmail.textContent = user?.email || user?.displayName || 'your account';

    if (isSignedIn) {
      setStatus('You are signed in and ready to use ON TRACK.', 'success');
      authPassword.value = '';
      return;
    }

    setStatus('Use your email and password or continue with Google.', 'default');
  });

  emailAuthForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await handleAuthAction(() => firebaseClient.auth.signInWithEmailAndPassword(authEmail.value.trim(), authPassword.value), 'Signing you in…');
  });

  emailSignUpBtn.addEventListener('click', async () => {
    await handleAuthAction(() => firebaseClient.auth.createUserWithEmailAndPassword(authEmail.value.trim(), authPassword.value), 'Creating your account…');
  });

  googleSignInBtn.addEventListener('click', async () => {
    await handleAuthAction(() => firebaseClient.auth.signInWithPopup(firebaseClient.googleProvider), 'Opening Google sign-in…');
  });

  pageSignOutBtn.addEventListener('click', async () => {
    setBusy(true);
    setStatus('Signing you out…', 'default');

    try {
      await firebaseClient.auth.signOut();
      setStatus('You have been signed out.', 'success');
    } catch (error) {
      setStatus(error.message || 'Unable to sign out right now.', 'error');
    } finally {
      setBusy(false);
    }
  });
}

async function handleAuthAction(action, busyMessage) {
  const email = authEmail.value.trim();
  const password = authPassword.value;

  if (!email || !password) {
    setStatus('Enter both your email and password first.', 'error');
    return;
  }

  setBusy(true);
  setStatus(busyMessage, 'default');

  try {
    await action();
    window.location.href = 'index.html';
  } catch (error) {
    setStatus(error.message || 'Authentication failed. Please try again.', 'error');
  } finally {
    setBusy(false);
  }
}

function setBusy(isBusy) {
  [emailSignInBtn, emailSignUpBtn, googleSignInBtn, pageSignOutBtn].forEach((button) => {
    if (button) {
      button.disabled = isBusy;
    }
  });
}

function setStatus(message, state) {
  authStatus.textContent = message;
  authStatus.dataset.state = state;
}
