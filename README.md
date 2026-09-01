# Jot — Ajmal Ali A's Idea Vault

A pocket notebook PWA for the ideas, tasks and reminders you'd otherwise forget. Leather-and-brass, offline-first, syncs to your own Firestore.

## Fixing the installed app / redesign — what changed

- **"Site might be temporarily down" when opened as an installed app** was a service worker bug: the old fetch handler could resolve with nothing (`undefined`) instead of a real response when a page wasn't cached yet, and browsers show that generic error screen when that happens. `sw.js` now always falls back to a cached copy of the app, so it never resolves empty.
- **Because the fix lives inside the service worker itself, your phone needs to actually download the new one once.** After you redeploy: open the site in a normal browser tab (not the installed app) on the phone, let it load fully, then close it, and reopen the installed app. If it's still stuck, uninstall the home-screen app and reinstall it once — that guarantees the old broken worker is gone.
- **Firestore sync bug**: writes were saving a local bookkeeping field (`syncStatus`) into your actual Firestore documents, so items could come back from the cloud looking permanently "pending" even after they'd synced. Fixed — that field now stays local-only. Sync also now retries automatically every 20 seconds in the background, not just when the browser fires an "online" event (which some networks never trigger cleanly).
- **"Other phones don't show my synced data"**: this was because anonymous sign-in creates a brand new, unrelated identity on every device — phone A and phone B were writing to two completely separate places in Firestore that never overlapped. Jot now signs every device into one fixed account (set in `js/firebase-config.js` as `syncAccount`), automatically, with no login screen. The first device to ever open the app creates that account; every device after that just logs into it — so opening Jot on any phone now pulls the same notebook. See step 1 below to set your own password before you deploy.
- **Scroll/animation feel**: the earlier version disabled `overscroll-behavior` entirely to stop pull-to-refresh, which also killed iOS's native rubber-band bounce — that's what made hitting the top of the list feel like a wall. It's now set to `contain` instead of `none`, which keeps the bounce but still stops the page from triggering a refresh. Sheets, cards, chips, and the FAB now also use iOS-style easing curves (a smooth no-overshoot deceleration for sheets, a light spring for tap feedback) instead of generic linear/ease transitions.
- **Bottom navigation**: the category filter (All / Ideas / Tasks / Notes / Alerts) moved from a scrolling row under the search bar to a fixed bottom tab bar, in line with standard mobile navigation patterns. The FAB now floats just above it.
- **Redesign**: moved from the leather/paper look to **claymorphism + Material** — soft puffy "clay" surfaces (a light rim shadow + a soft dark shadow on opposite corners) built on Material's structure: a colored top app bar, a bottom navigation bar, a Material-style FAB, elevated cards, and bottom sheets.

## 1. Connect it to your Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project** (free Spark plan is enough).
2. In the project, open **Build → Firestore Database → Create database** (start in production mode).
3. Open **Build → Authentication → Sign-in method** and enable **Email/Password** (not Anonymous — that's the one that was causing every device to get its own separate notebook). You do *not* need to enable Anonymous unless you want a same-device-only fallback while offline on first launch.
4. Go to **Project settings → General → Your apps → Add app → Web (</>)**, register it, and copy the `firebaseConfig` object it gives you.
5. Paste those values into `js/firebase-config.js` in this project, replacing the `PASTE_YOUR_…` placeholders (already done for `jot-todo`).
6. In the same file, set your own password in the `syncAccount` object — this is the one identity every device signs into automatically. It doesn't need to be a real inbox, just something only you know.
7. In **Firestore → Rules**, paste this so only your sync account can read/write your notebook:

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
