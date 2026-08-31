# Jot — Ajmal Ali A's Idea Vault

A pocket notebook PWA for the ideas, tasks and reminders you'd otherwise forget. Leather-and-brass, offline-first, syncs to your own Firestore.

## Fixing the installed app / redesign — what changed

- **"Site might be temporarily down" when opened as an installed app** was a service worker bug: the old fetch handler could resolve with nothing (`undefined`) instead of a real response when a page wasn't cached yet, and browsers show that generic error screen when that happens. `sw.js` now always falls back to a cached copy of the app, so it never resolves empty.
- **Because the fix lives inside the service worker itself, your phone needs to actually download the new one once.** After you redeploy: open the site in a normal browser tab (not the installed app) on the phone, let it load fully, then close it, and reopen the installed app. If it's still stuck, uninstall the home-screen app and reinstall it once — that guarantees the old broken worker is gone.
- **Firestore sync bug**: writes were saving a local bookkeeping field (`syncStatus`) into your actual Firestore documents, so items could come back from the cloud looking permanently "pending" even after they'd synced. Fixed — that field now stays local-only. Sync also now retries automatically every 20 seconds in the background, not just when the browser fires an "online" event (which some networks never trigger cleanly).
- **Redesign**: moved from the leather/paper look to **claymorphism + Material** — soft puffy "clay" surfaces (a light rim shadow + a soft dark shadow on opposite corners) built on Material's structure: a colored top app bar, filter chips, a Material-style FAB, elevated cards, and bottom sheets.

## 1. Connect it to your Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project** (free Spark plan is enough).
2. In the project, open **Build → Firestore Database → Create database** (start in production mode).
3. Open **Build → Authentication → Sign-in method** and enable **Anonymous**. That's what lets Jot save your data without you needing to log in.
4. Go to **Project settings → General → Your apps → Add app → Web (</>)**, register it, and copy the `firebaseConfig` object it gives you.
5. Paste those values into `js/firebase-config.js` in this project, replacing the `PASTE_YOUR_…` placeholders.
6. In **Firestore → Rules**, paste this so only your own device's anonymous identity can read/write your notebook:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/items/{itemId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

Without a Firebase config, Jot still works fully offline (everything is saved to your browser's local storage) — it just won't sync across devices.

## 2. Run it locally

PWAs need to be served over HTTP(S), not opened as a raw `file://`. Any of these work:

```bash
# Python
python3 -m http.server 8080

# Node
npx serve .
```

Then open `http://localhost:8080`.

## 3. Put it on the internet (so it installs on your phone)

Easiest option, since you already have a GitHub account:

1. Create a new repo, e.g. `github.com/ajmaleee/jot`.
2. Push everything in this folder to it.
3. Repo → **Settings → Pages → Deploy from branch → main / (root)**.
4. Your app will be live at `https://ajmaleee.github.io/jot/`.

Open that URL on your phone:
- **Android (Chrome):** you'll see an "Add Jot to your home screen" banner, or use ⋮ → **Install app**.
- **iOS (Safari):** tap the Share icon → **Add to Home Screen**. (iOS only installs PWAs from Safari, not Chrome.)

## 4. What's inside

| File | Purpose |
|---|---|
| `index.html` | App shell / markup |
| `css/style.css` | The leather-and-brass neumorphic theme |
| `js/app.js` | All app logic: offline queue, sync, gestures, voice input |
| `js/firebase-config.js` | Your Firebase keys go here |
| `manifest.json` | Makes the app installable |
| `sw.js` | Service worker — caches the app shell for offline use |
| `icons/` | Generated app icons (192, 512, maskable, Apple touch icon) |

## 5. Features

- **Offline-first by design** — every save goes to `localStorage` immediately, then a background queue pushes it to Firestore once you're online. Nothing is ever lost to a bad connection.
- **Four kinds of entries** — Idea 💡, Task ✅, Note 📝, Reminder ⏰ — filterable by tab.
- **Swipe gestures** — swipe a card right to mark done, left to delete (with a 4-second Undo).
- **Voice capture** — tap the mic in the composer to dictate instead of typing (Chrome/Edge/Android; not supported in Safari/iOS yet).
- **Pinning** — pin important entries with a paperclip; they float to their own strip at the top.
- **Tags & search** — comma-separated tags, instant search across title/detail/tags.
- **Due dates + in-app reminders** — Reminder-category entries fire a notification while Jot is open and the time has passed (browsers don't allow reliable background alarms from a website — see note below).
- **Night cover** — a dark leather theme toggle in Settings.
- **Streak counter** — tracks consecutive days you've opened your notebook.
- **Export** — one-tap JSON export of everything, for backups.
- **Install banner** — a styled ribbon prompts installation on supported browsers.
- **Home-screen shortcuts** — long-press the installed app icon for "New idea" / "New task" quick actions.

### A note on reminders
Browsers don't let a website wake itself up in the background to fire a notification at an exact time — only native apps can do that reliably. Jot checks for due reminders every 30 seconds *while it's open*, which covers "I have it open and forgot" style use, but not "buzz me at 6pm while my phone is in my pocket." If you need true background alarms, that would require a small native wrapper or a server-side push (Firebase Cloud Messaging) — happy to help wire that up separately if useful.

## 6. Made by

**Ajmal Ali A**
GitHub: [github.com/ajmaleee](https://github.com/ajmaleee)
Instagram: [@ajmaleee__](https://www.instagram.com/ajmaleee__/)
