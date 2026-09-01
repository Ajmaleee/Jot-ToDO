// ── Your Firebase project keys ──────────────────────────────────────────
// Get these from: Firebase Console → Project settings → General → Your apps → SDK setup.
// This file is safe to keep public — Firestore Security Rules (not this file)
// are what actually protect your data. See README.md for the rules to paste in.

export const firebaseConfig = {
  apiKey: "AIzaSyAAsd-d58EmdAzUj2qNBu5rQe8ZQNBLoj4",
  authDomain: "jot-todo.firebaseapp.com",
  projectId: "jot-todo",
  storageBucket: "jot-todo.firebasestorage.app",
  messagingSenderId: "604864859097",
  appId: "1:604864859097:web:ed4c155977e0d190fce7c8",
  measurementId: "G-BMJZGXXG3S"
};

// ── Your personal sync identity ─────────────────────────────────────────
// This is what lets every device pull the SAME notebook automatically, with
// no sign-in screen. The app signs in with this email+password on its own,
// the first time ever creating the account, every time after just logging
// into it. Change the password to something only you know before you deploy
// this — anyone with this exact pair (and your Firebase project) could read
// your notebook. It doesn't need to be a real, checkable email address.
export const syncAccount = {
  email: "ajmal@jot.local",
  password: "boAt-rockerz-430"
};
