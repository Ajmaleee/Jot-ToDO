import { firebaseConfig } from "./firebase-config.js";

/* ============================================================
   JOT — app logic
   Offline-first: every write lands in localStorage instantly.
   A pending queue is flushed to Firestore whenever we're online.
   ============================================================ */

const LS_ITEMS = "jot_items_v1";
const LS_QUEUE = "jot_queue_v1";
const LS_PREFS = "jot_prefs_v1";
const LS_UID = "jot_uid_v1";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2));

// ---------- local storage helpers ----------
const loadItems = () => JSON.parse(localStorage.getItem(LS_ITEMS) || "[]");
const saveItems = (items) => localStorage.setItem(LS_ITEMS, JSON.stringify(items));
const loadQueue = () => JSON.parse(localStorage.getItem(LS_QUEUE) || "[]");
const saveQueue = (q) => localStorage.setItem(LS_QUEUE, JSON.stringify(q));
const loadPrefs = () => JSON.parse(localStorage.getItem(LS_PREFS) || "{}");
const savePrefs = (p) => localStorage.setItem(LS_PREFS, JSON.stringify(p));

let state = {
  items: loadItems(),
  queue: loadQueue(),
  prefs: Object.assign({ dark: false, notif: false, showArchived: false, lastOpenDate: null, streak: 0 }, loadPrefs()),
  activeCat: "all",
  search: "",
  online: navigator.onLine,
  uid: null,
  db: null,
  auth: null,
  fsReady: false,
  pinnedComposer: false,
  editingId: null,
  swipeUndo: null,
};

// ---------- Firebase (optional — degrades gracefully if not configured) ----------
async function initFirebase() {
  if (firebaseConfig.apiKey.startsWith("PASTE_")) {
    console.warn("Jot: Firebase not configured yet — running in local-only mode. See README.md.");
    setStatus(false, "Local only");
    return;
  }
  try {
    const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js");
    const { getAuth, signInAnonymously, onAuthStateChanged } = await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js");
    const { getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot } = await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js");

    const app = initializeApp(firebaseConfig);
    state.auth = getAuth(app);
    state.db = getFirestore(app);
    state._fs = { collection, doc, setDoc, deleteDoc, onSnapshot };

    onAuthStateChanged(state.auth, (user) => {
      if (user) {
        state.uid = user.uid;
        localStorage.setItem(LS_UID, user.uid);
        state.fsReady = true;
        subscribeRemote();
        flushQueue();
      }
    });
    await signInAnonymously(state.auth).catch((err) => {
      console.warn("Jot: anonymous sign-in failed — enable it in Firebase Console → Authentication → Sign-in method.", err);
      setStatus(false, "Sign-in not enabled");
    });

    // Belt-and-braces retry: the 'online' browser event can be missed (e.g. a flaky
    // connection that never fires it, or Firestore's own token needing a refresh),
    // so also sweep the queue on an interval.
    setInterval(() => { if (state.online) flushQueue(); }, 20000);
  } catch (err) {
    console.warn("Jot: Firebase init failed, staying local-only.", err);
    setStatus(false, "Local only");
  }
}

function itemsCollectionRef() {
  const { collection } = state._fs;
  return collection(state.db, "users", state.uid, "items");
}

function subscribeRemote() {
  if (!state.fsReady) return;
  const { onSnapshot } = state._fs;
  onSnapshot(itemsCollectionRef(), (snap) => {
    snap.docChanges().forEach((change) => {
      const remote = { id: change.doc.id, ...change.doc.data() };
      if (change.type === "removed") {
        state.items = state.items.filter((i) => i.id !== remote.id);
        return;
      }
      remote.syncStatus = "synced"; // remote docs never carry local bookkeeping fields
      const idx = state.items.findIndex((i) => i.id === remote.id);
      if (idx === -1) {
        state.items.push(remote);
      } else {
        // last-write-wins by updatedAt, but never clobber a locally-pending edit
        const local = state.items[idx];
        if (local.syncStatus !== "pending" && (remote.updatedAt || 0) >= (local.updatedAt || 0)) {
          state.items[idx] = remote;
        }
      }
    });
    saveItems(state.items);
    render();
  }, (err) => console.warn("Jot: snapshot listener error", err));
}

async function flushQueue() {
  if (!state.online || !state.fsReady || state.queue.length === 0) {
    updateSyncBadge();
    return;
  }
  const { doc, setDoc, deleteDoc } = state._fs;
  const remaining = [];
  for (const op of state.queue) {
    try {
      if (op.type === "upsert") {
        // Strip local-only bookkeeping fields before writing — syncStatus must
        // never be persisted to Firestore, or it comes back on the next snapshot
        // and the item looks permanently "pending" even though it's synced.
        const { syncStatus, ...remoteData } = op.data;
        await setDoc(doc(itemsCollectionRef(), op.id), remoteData);
        const it = state.items.find((i) => i.id === op.id);
        if (it) it.syncStatus = "synced";
      } else if (op.type === "delete") {
        await deleteDoc(doc(itemsCollectionRef(), op.id));
      }
    } catch (err) {
      console.warn("Jot: sync op failed, will retry", err);
      remaining.push(op);
    }
  }
  state.queue = remaining;
  saveQueue(state.queue);
  saveItems(state.items);
  updateSyncBadge();
  render();
}

function queueWrite(item) {
  state.queue = state.queue.filter((op) => op.id !== item.id); // dedupe, keep latest
  state.queue.push({ type: "upsert", id: item.id, data: item, ts: Date.now() });
  saveQueue(state.queue);
  flushQueue();
}

function queueDelete(id) {
  state.queue = state.queue.filter((op) => op.id !== id);
  state.queue.push({ type: "delete", id, ts: Date.now() });
  saveQueue(state.queue);
  flushQueue();
}

// ---------- status UI ----------
function setStatus(online, label) {
  const dot = $("#statusDot");
  const text = $("#statusText");
  dot.classList.toggle("offline", !online);
  text.textContent = label || (online ? "Synced" : "Offline — saving locally");
}
function updateSyncBadge() {
  const pending = state.queue.length;
  if (!state.online) setStatus(false, `Offline — ${pending} waiting`);
  else if (pending > 0) setStatus(true, `Syncing ${pending}…`);
  else setStatus(true, "Synced");
}

window.addEventListener("online", () => { state.online = true; updateSyncBadge(); flushQueue(); });
window.addEventListener("offline", () => { state.online = false; updateSyncBadge(); });

// ---------- CRUD ----------
function upsertItem(data) {
  const now = Date.now();
  const existingIdx = state.items.findIndex((i) => i.id === data.id);
  const item = Object.assign(
    { createdAt: now, syncStatus: "pending" },
    existingIdx > -1 ? state.items[existingIdx] : {},
    data,
    { updatedAt: now, syncStatus: "pending" }
  );
  if (existingIdx > -1) state.items[existingIdx] = item;
  else state.items.unshift(item);
  saveItems(state.items);
  queueWrite(item);
  render();
}

function deleteItem(id) {
  state.items = state.items.filter((i) => i.id !== id);
  saveItems(state.items);
  queueDelete(id);
  render();
}

function toggleDone(id) {
  const item = state.items.find((i) => i.id === id);
  if (!item) return;
  item.done = !item.done;
  item.updatedAt = Date.now();
  item.syncStatus = "pending";
  saveItems(state.items);
  queueWrite(item);
  if (navigator.vibrate) navigator.vibrate(item.done ? [10, 30, 10] : 10);
  render();
}

// ---------- rendering ----------
const catIcon = { idea: "💡", task: "✅", note: "📝", reminder: "⏰" };

function fmtDue(item) {
  if (!item.dueDate) return "";
  const d = new Date(item.dueDate + "T" + (item.dueTime || "00:00"));
  const opts = { month: "short", day: "numeric" };
  let s = d.toLocaleDateString(undefined, opts);
  if (item.dueTime) s += " · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return s;
}
function isOverdue(item) {
  if (!item.dueDate || item.done) return false;
  const d = new Date(item.dueDate + "T" + (item.dueTime || "23:59"));
  return d.getTime() < Date.now();
}

function cardHTML(item) {
  const tags = (item.tags || []).map((t) => `<span class="tag-chip">#${escapeHtml(t)}</span>`).join("");
  const due = item.dueDate
    ? `<span class="due ${isOverdue(item) ? "overdue" : ""}">🗓 ${fmtDue(item)}</span>`
    : "";
  const pinFlag = item.pinned ? `<span class="pin-flag">📎</span>` : "";
  const syncFlag = item.syncStatus === "pending" ? `<span class="sync-flag">✎ pending</span>` : "";
  return `
  <div class="entry-swipe" data-id="${item.id}">
    <div class="entry-actions">
      <div class="done-bg">✓ ${item.done ? "Reopen" : "Done"}</div>
      <div class="del-bg">Delete 🗑</div>
    </div>
    <div class="card ${item.pinned ? "pinned" : ""} ${item.done ? "done" : ""}" data-id="${item.id}">
      <div class="card-top">
        <span class="card-cat ${item.category}">${catIcon[item.category] || "📝"} ${item.category}</span>
        ${pinFlag}
      </div>
      <p class="card-title">${escapeHtml(item.title)}</p>
      ${item.detail ? `<p class="card-detail">${escapeHtml(item.detail)}</p>` : ""}
      <div class="card-meta">${due}${tags}${syncFlag}</div>
    </div>
  </div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function visibleItems() {
  let items = state.items.slice();
  if (!state.prefs.showArchived) items = items.filter((i) => !i.done);
  if (state.activeCat !== "all") items = items.filter((i) => i.category === state.activeCat);
  if (state.search.trim()) {
    const q = state.search.toLowerCase();
    items = items.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        (i.detail || "").toLowerCase().includes(q) ||
        (i.tags || []).some((t) => t.toLowerCase().includes(q))
    );
  }
  items.sort((a, b) => (b.pinned - a.pinned) || (b.updatedAt - a.updatedAt));
  return items;
}

function render() {
  const all = visibleItems();
  const pinned = all.filter((i) => i.pinned);
  const rest = all.filter((i) => !i.pinned);

  $("#pinnedStrip").style.display = pinned.length ? "block" : "none";
  $("#pinnedEntries").innerHTML = pinned.map(cardHTML).join("");
  $("#entries").innerHTML = rest.map(cardHTML).join("");
  $("#emptyState").style.display = all.length === 0 ? "block" : "none";

  bindCardGestures();

  // stats
  $("#statTotal").textContent = state.items.length;
  $("#statOpen").textContent = state.items.filter((i) => i.category === "task" && !i.done).length;
  $("#statStreak").textContent = state.prefs.streak || 0;
}

// ---------- swipe gestures ----------
function bindCardGestures() {
  $$(".entry-swipe").forEach((wrap) => {
    const card = wrap.querySelector(".card");
    const id = wrap.dataset.id;
    let startX = 0, currentX = 0, dragging = false;

    card.addEventListener("touchstart", (e) => {
      startX = e.touches[0].clientX;
      dragging = true;
      card.style.transition = "none";
    }, { passive: true });

    card.addEventListener("touchmove", (e) => {
      if (!dragging) return;
      currentX = e.touches[0].clientX - startX;
      card.style.transform = `translateX(${currentX}px)`;
    }, { passive: true });

    card.addEventListener("touchend", () => {
      dragging = false;
      card.style.transition = "transform .25s ease";
      if (currentX > 90) {
        card.style.transform = "translateX(120%)";
        setTimeout(() => toggleDone(id), 150);
      } else if (currentX < -90) {
        card.style.transform = "translateX(-120%)";
        setTimeout(() => handleDeleteWithUndo(id), 150);
      } else {
        card.style.transform = "translateX(0)";
      }
      currentX = 0;
    });

    card.addEventListener("click", () => openEditor(id));
  });
}

function handleDeleteWithUndo(id) {
  const item = state.items.find((i) => i.id === id);
  if (!item) return;
  deleteItem(id);
  showToast(`Deleted "${item.title.slice(0, 24)}${item.title.length > 24 ? "…" : ""}"`, () => {
    item.syncStatus = "pending";
    item.updatedAt = Date.now();
    state.items.unshift(item);
    saveItems(state.items);
    queueWrite(item);
    render();
  });
}

// ---------- toast ----------
let toastTimer = null;
function showToast(msg, undoFn) {
  const toast = $("#toast");
  $("#toastMsg").textContent = msg;
  const undoBtn = $("#toastUndo");
  undoBtn.style.display = undoFn ? "inline-block" : "none";
  undoBtn.onclick = () => { undoFn && undoFn(); hideToast(); };
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 4000);
}
function hideToast() { $("#toast").classList.remove("show"); }

// ---------- composer sheet ----------
function openComposer(prefillCat) {
  state.editingId = null;
  $("#composerTitle").textContent = "New entry";
  $("#entryTitle").value = "";
  $("#entryDetail").value = "";
  $("#entryDate").value = "";
  $("#entryTime").value = "";
  $("#entryTags").value = "";
  setCatPicker(prefillCat || "idea");
  setPinSwitch(false);
  openSheet("composerSheet");
  setTimeout(() => $("#entryTitle").focus(), 300);
}

function openEditor(id) {
  const item = state.items.find((i) => i.id === id);
  if (!item) return;
  state.editingId = id;
  $("#composerTitle").textContent = "Edit entry";
  $("#entryTitle").value = item.title;
  $("#entryDetail").value = item.detail || "";
  $("#entryDate").value = item.dueDate || "";
  $("#entryTime").value = item.dueTime || "";
  $("#entryTags").value = (item.tags || []).join(", ");
  setCatPicker(item.category);
  setPinSwitch(!!item.pinned);
  openSheet("composerSheet");
}

function setCatPicker(cat) {
  $$(".cat-pick").forEach((b) => b.classList.toggle("selected", b.dataset.cat === cat));
}
function getCatPicker() {
  const el = $(".cat-pick.selected");
  return el ? el.dataset.cat : "idea";
}
function setPinSwitch(on) { $("#pinSwitch").classList.toggle("on", on); }

function openSheet(id) {
  $("#" + id).classList.add("open");
  $(id === "composerSheet" ? "#backdrop" : "#settingsBackdrop").classList.add("open");
}
function closeSheet(id) {
  $("#" + id).classList.remove("open");
  $(id === "composerSheet" ? "#backdrop" : "#settingsBackdrop").classList.remove("open");
}

// ---------- event wiring ----------
function wireEvents() {
  $("#fabAdd").addEventListener("click", () => openComposer());
  $("#cancelBtn").addEventListener("click", () => closeSheet("composerSheet"));
  $("#backdrop").addEventListener("click", () => closeSheet("composerSheet"));

  $$(".cat-pick").forEach((b) => b.addEventListener("click", () => setCatPicker(b.dataset.cat)));
  $("#pinSwitch").addEventListener("click", () => $("#pinSwitch").classList.toggle("on"));

  $("#composerSheet").addEventListener("submit", (e) => {
    e.preventDefault();
    const title = $("#entryTitle").value.trim();
    if (!title) return;
    const tags = $("#entryTags").value.split(",").map((t) => t.trim()).filter(Boolean);
    const data = {
      id: state.editingId || uuid(),
      title,
      detail: $("#entryDetail").value.trim(),
      category: getCatPicker(),
      dueDate: $("#entryDate").value || null,
      dueTime: $("#entryTime").value || null,
      tags,
      pinned: $("#pinSwitch").classList.contains("on"),
      done: state.editingId ? (state.items.find((i) => i.id === state.editingId) || {}).done || false : false,
    };
    upsertItem(data);
    closeSheet("composerSheet");
    if (navigator.vibrate) navigator.vibrate(15);
    showToast(state.editingId ? "Entry updated" : "Jotted down ✓");
  });

  // tabs
  $$(".tab").forEach((tab) => tab.addEventListener("click", () => {
    $$(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    state.activeCat = tab.dataset.cat;
    render();
  }));

  // search
  $("#searchInput").addEventListener("input", (e) => { state.search = e.target.value; render(); });

  // settings
  $("#settingsBtn").addEventListener("click", () => openSheet("settingsSheet"));
  $("#closeSettingsBtn").addEventListener("click", () => closeSheet("settingsSheet"));
  $("#settingsBackdrop").addEventListener("click", () => closeSheet("settingsSheet"));

  $("#darkSwitch").addEventListener("click", () => {
    state.prefs.dark = !state.prefs.dark;
    applyTheme();
    savePrefs(state.prefs);
  });
  $("#notifSwitch").addEventListener("click", async () => {
    if (!state.prefs.notif && "Notification" in window) {
      const perm = await Notification.requestPermission();
      state.prefs.notif = perm === "granted";
    } else {
      state.prefs.notif = false;
    }
    $("#notifSwitch").classList.toggle("on", state.prefs.notif);
    savePrefs(state.prefs);
  });
  $("#archiveSwitch").addEventListener("click", () => {
    state.prefs.showArchived = !state.prefs.showArchived;
    $("#archiveSwitch").classList.toggle("on", state.prefs.showArchived);
    savePrefs(state.prefs);
    render();
  });

  $("#syncNowBtn").addEventListener("click", () => flushQueue());

  $("#exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state.items, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `jot-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  $("#clearDoneBtn").addEventListener("click", () => {
    const doneItems = state.items.filter((i) => i.done);
    doneItems.forEach((i) => queueDelete(i.id));
    state.items = state.items.filter((i) => !i.done);
    saveItems(state.items);
    render();
    showToast(`Cleared ${doneItems.length} done item(s)`);
  });

  // voice input
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    const recog = new SR();
    recog.continuous = false;
    recog.interimResults = false;
    recog.lang = "en-US";
    let listening = false;
    $("#micBtn").addEventListener("click", () => {
      if (listening) { recog.stop(); return; }
      recog.start();
    });
    recog.addEventListener("start", () => {
      listening = true;
      $("#micBtn").classList.add("listening");
      $("#micHint").textContent = "Listening…";
    });
    recog.addEventListener("end", () => {
      listening = false;
      $("#micBtn").classList.remove("listening");
      $("#micHint").textContent = "Tap to dictate instead of typing";
    });
    recog.addEventListener("result", (e) => {
      const text = e.results[0][0].transcript;
      const field = $("#entryTitle");
      field.value = field.value ? field.value + " " + text : text;
    });
  } else {
    $("#micBtn").style.display = "none";
    $("#micHint").textContent = "Voice dictation isn't supported in this browser";
  }
}

function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.prefs.dark ? "dark" : "light");
  $("#darkSwitch").classList.toggle("on", state.prefs.dark);
  $("#notifSwitch").classList.toggle("on", state.prefs.notif);
  $("#archiveSwitch").classList.toggle("on", state.prefs.showArchived);
}

// ---------- streak tracking ----------
function trackStreak() {
  const today = new Date().toDateString();
  if (state.prefs.lastOpenDate === today) return;
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  state.prefs.streak = state.prefs.lastOpenDate === yesterday ? (state.prefs.streak || 0) + 1 : 1;
  state.prefs.lastOpenDate = today;
  savePrefs(state.prefs);
}

// ---------- reminder checks (foreground only) ----------
function startReminderWatcher() {
  setInterval(() => {
    if (!state.prefs.notif || Notification.permission !== "granted") return;
    const now = Date.now();
    state.items.forEach((item) => {
      if (item.category !== "reminder" || item.done || !item.dueDate || item.notified) return;
      const due = new Date(item.dueDate + "T" + (item.dueTime || "09:00")).getTime();
      if (due <= now && due > now - 5 * 60000) {
        new Notification("⏰ " + item.title, { body: item.detail || "Reminder from Jot", icon: "icons/icon-192.png" });
        item.notified = true;
        saveItems(state.items);
      }
    });
  }, 30000);
}

// ---------- install prompt ----------
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (!localStorage.getItem("jot_install_dismissed")) $("#installRibbon").style.display = "flex";
});
function wireInstall() {
  $("#installBtn").addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $("#installRibbon").style.display = "none";
  });
  $("#installDismiss").addEventListener("click", () => {
    $("#installRibbon").style.display = "none";
    localStorage.setItem("jot_install_dismissed", "1");
  });
}

// ---------- deep-link shortcuts (?new=idea) ----------
function handleShortcutParam() {
  const params = new URLSearchParams(location.search);
  const cat = params.get("new");
  if (cat) setTimeout(() => openComposer(cat), 400);
}

// ---------- boot ----------
function boot() {
  applyTheme();
  wireEvents();
  wireInstall();
  trackStreak();
  render();
  updateSyncBadge();
  startReminderWatcher();
  handleShortcutParam();
  initFirebase();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("SW registration failed", err));
  }
}

document.addEventListener("DOMContentLoaded", boot);
