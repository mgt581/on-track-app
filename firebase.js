// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCO3O5GwiUiOY6h787quLG5EOYWaHngAG8",
  authDomain: "on-track-73a59.firebaseapp.com",
  projectId: "on-track-73a59",
  storageBucket: "on-track-73a59.firebasestorage.app",
  messagingSenderId: "884731352316",
  appId: "1:884731352316:web:891332370b5f199b88f379",
  measurementId: "G-GR7MK86PDG"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);