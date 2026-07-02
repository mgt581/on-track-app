import {
  firebaseSetupError,
  isFirebaseConfigured,
  signInWithEmail,
  signUpWithEmail,
  waitForInitialAuthState
} from './firebase.js';

const authForm = document.getElementById('auth-form');
const authEmail = document.getElementById('auth-email');
const authPassword = document.getElementById('auth-password');
const authConfirmPassword = document.getElementById('auth-confirm-password');
const authStatus = document.getElementById('auth-status');
const authSetup = document.getElementById('auth-setup');

initialize();

async function initialize() {
  if (!isFirebaseConfigured) {
    authForm.hidden = true;
    authSetup.hidden = false;
    authSetup.textContent = firebaseSetupError;
    authStatus.textContent = 'Finish Firebase setup, then reload this page.';
    authStatus.classList.add('error');
    return;
  }

  const user = await waitForInitialAuthState();
  if (user) {
    window.location.replace('index.html');
    return;
  }

  authForm.addEventListener('submit', handleAuthSubmit);
}

async function handleAuthSubmit(event) {
  event.preventDefault();

  const mode = event.submitter?.value === 'signup' ? 'signup' : 'signin';
  const email = authEmail.value.trim();
  const password = authPassword.value;
  const confirmPassword = authConfirmPassword.value;

  if (mode === 'signup' && password !== confirmPassword) {
    setStatus('Passwords do not match.', true);
    return;
  }

  setStatus(mode === 'signup' ? 'Creating your account…' : 'Signing you in…');
  setDisabled(true);

  try {
    if (mode === 'signup') {
      await signUpWithEmail(email, password);
    } else {
      await signInWithEmail(email, password);
    }
    window.location.replace('index.html');
  } catch (error) {
    setStatus(getAuthErrorMessage(error), true);
    setDisabled(false);
  }
}

function setStatus(message, isError = false) {
  authStatus.textContent = message;
  authStatus.classList.toggle('error', isError);
}

function setDisabled(disabled) {
  authForm.querySelectorAll('input, button').forEach((element) => {
    element.disabled = disabled;
  });
}

function getAuthErrorMessage(error) {
  switch (error?.code) {
    case 'auth/email-already-in-use':
      return 'That email already has an account. Try signing in instead.';
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Email or password is incorrect.';
    case 'auth/weak-password':
      return 'Use a stronger password with at least 6 characters.';
    case 'auth/invalid-email':
      return 'Enter a valid email address.';
    default:
      return error?.message || 'Unable to sign in right now.';
  }
}
