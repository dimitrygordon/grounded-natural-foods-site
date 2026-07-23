/* =========================================================================
   GROUNDED NATURAL FOODS — app.js
   Data is now backed live by Firebase Firestore (see the FIREBASE block
   below). The `db` object still holds the exact same shape as before and
   is what every render/UI function reads from — it's now a live local
   mirror of Firestore rather than a static mock. Any mutation anywhere in
   the app eventually funnels through scheduleSave(), which pushes the
   whole relevant collection back up to Firestore (debounced), and
   Firestore's onSnapshot listeners keep every open tab/device in sync.
   ========================================================================= */

/* ---------------------------- DATE HELPERS ---------------------------- */
const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAY_KEYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT"]; // schedule days, Sunday added via toggle
const ALL_DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
function pad(n) {
  return n < 10 ? "0" + n : "" + n;
}
function isoDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function todayISO() {
  return isoDate(new Date());
}
// Small filter icon + "Date" label — used only next to actual date FILTERS
// (narrowing a list you're searching), never next to a date you're
// entering as data (pickup date, expiration date, time off dates, etc.),
// so it's a clear, consistent "this narrows what you see" signal.
const DATE_FILTER_LABEL = `<span class="date-filter-label"><svg viewBox="0 0 24 24"><path d="M3 4h18l-7 8v6l-4 2v-8z"/></svg>Date</span>`;
// A soup can only be added to cart if its day hasn't passed, and — if it's
// today's soup — only before 2:00 PM. Shared by both the homepage
// click-to-add and the "+ Soup" picker inside Place Order, so they can't
// drift out of sync with each other.
function soupIsAddable(dateISO) {
  const today = todayISO();
  if (dateISO < today) return false;
  if (dateISO === today) {
    const now = new Date();
    if (now.getHours() * 60 + now.getMinutes() >= 14 * 60) return false;
  }
  return true;
}
function startOfWeekMonday(d) {
  const date = new Date(d);
  const day = date.getDay(); // 0 Sun .. 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}
function addDays(d, n) {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + n);
  return nd;
}
function fmtShort(d) {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function formatTime12hr(t) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${pad(h12)}:${pad(m)} ${period}`;
}
function weekKeyOf(d) {
  return isoDate(startOfWeekMonday(d));
}
// Shared carousel nav — Prev/label/Next centered on one row, with a
// "Back To Today" button on its own row below (only shown when not
// currently on today), matching the Expirations tab's carousel exactly.
// Used everywhere a Prev/Next/Today control appears, so they can't drift
// out of sync with each other visually.
function carouselNavHTML(opts) {
  return `<div class="cat-daynav" style="flex-direction:column;align-items:center;justify-content:center;gap:8px">
    <div style="display:flex;align-items:center;justify-content:center;gap:10px;width:100%;flex-wrap:wrap">
      <button class="btn small outline" onclick="${opts.prevOnclick}">${
    opts.prevLabel
  }</button>
      <span class="cat-date-label">${opts.dateLabel}</span>
      <button class="btn small outline" onclick="${opts.nextOnclick}">${
    opts.nextLabel
  }</button>
    </div>
    ${
      opts.showToday
        ? `<button class="btn small" onclick="${opts.todayOnclick}">Back To Today</button>`
        : ""
    }
  </div>`;
}
function fmtWeekRange(monday) {
  const sat = addDays(monday, 5);
  return `${MONTHS[monday.getMonth()].slice(
    0,
    3
  )} ${monday.getDate()} – ${MONTHS[sat.getMonth()].slice(
    0,
    3
  )} ${sat.getDate()}`;
}
function lastNMonthLabels(n) {
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(MONTHS[d.getMonth()].slice(0, 3));
  }
  return out;
}
// stats.added / stats.checked / stats.pickedUp / stats.dropped / stats.traded
// are each a rolling 12-month window whose LAST index is always "this
// month" (matches lastNMonthLabels' ordering). Whenever real time has moved
// into a new month since this employee's stats were last touched, shift the
// window forward first so old months roll off correctly.
const STAT_KEYS = ["added", "checked", "pickedUp", "dropped", "traded"];
function ensureStatsCurrentMonth(emp) {
  if (!emp.stats) emp.stats = {};
  STAT_KEYS.forEach((k) => {
    if (!emp.stats[k]) emp.stats[k] = Array(12).fill(0);
  });
  const nowKey = `${new Date().getFullYear()}-${pad(
    new Date().getMonth() + 1
  )}`;
  if (emp.statsMonthKey !== nowKey) {
    if (emp.statsMonthKey) {
      const [oy, om] = emp.statsMonthKey.split("-").map(Number);
      const [ny, nm] = nowKey.split("-").map(Number);
      const monthsPassed = Math.max(
        0,
        Math.min((ny - oy) * 12 + (nm - om), 12)
      );
      for (let i = 0; i < monthsPassed; i++) {
        STAT_KEYS.forEach((k) => {
          emp.stats[k].shift();
          emp.stats[k].push(0);
        });
      }
    }
    emp.statsMonthKey = nowKey;
  }
}
// Records one item-added or item-checked-off event against the currently
// logged-in employee (master actions aren't attributed to any employee).
function recordEmployeeStat(kind) {
  if (!session || session.isMaster) return;
  const emp = db.employees.find((e) => e.id === session.employeeId);
  if (!emp) return;
  recordStatForEmployee(emp.id, kind);
}
// Same idea, but for any employee by ID — used when master approves a shift
// swap, since the stat belongs to the employees involved, not to master's
// own (nonexistent) employee record.
function recordStatForEmployee(empId, kind) {
  const emp = db.employees.find((e) => e.id === empId);
  if (!emp) return;
  ensureStatsCurrentMonth(emp);
  emp.stats[kind][11] = (emp.stats[kind][11] || 0) + 1;
  fsdb
    .collection("employees")
    .doc(emp.id)
    .update({ stats: emp.stats, statsMonthKey: emp.statsMonthKey })
    .catch((err) => console.error("Update employee stats failed:", err));
}
// Re-renders destroy and recreate every input in portal-body, which drops focus
// after a single keystroke. Any live-filter input calls this right after
// renderPortalBody() to put focus (and the cursor position) right back where
// it was, so typing feels the same as the persistent top search box.
function reFocusInput(id, cursorPos) {
  const el = document.getElementById(id);
  if (el) {
    el.focus();
    if (typeof cursorPos === "number") {
      try {
        el.setSelectionRange(cursorPos, cursorPos);
      } catch (e) {}
    }
  }
}
// openModal() fully replaces #modal-root's contents every call, which resets
// any scrollable list inside it back to the top — noticeable/annoying on
// modals that re-render themselves on every cart action (adding an item,
// changing a quantity, etc.). This wraps a render function so any
// .search-panel-list inside the modal keeps its scroll position across
// that re-render.
function rerenderModalPreservingScroll(renderFn) {
  const el = document.querySelector("#modal-root .search-panel-list");
  const scrollTop = el ? el.scrollTop : 0;
  renderFn();
  const newEl = document.querySelector("#modal-root .search-panel-list");
  if (newEl) newEl.scrollTop = scrollTop;
}
function escHtmlAttr(s) {
  return (s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/* ---------------------------- DATA LAYER (mock) ---------------------------- */
const db = {
  // Master/staff credentials no longer live anywhere in client code —
  // login is real Firebase Authentication now (see attemptLogin).

  settings: {
    showWeekendsSoup: false, // customer + admin soup calendar: show Sat/Sun columns
    showSunSchedule: false, // scheduling grid: show Sunday column
    customPaniniPrice: "", // base price shown on the public Custom Panini box
    customSaladPrice: "", // base price shown on the public Custom Salad box
    uncategorizedOrder: -2, // reorder position of the Uncategorized expiration category
    markdownOrder: -1, // reorder position of the Markdown expiration category
  },

  // Master-managed list of employee roles. Fully custom — add as many as needed
  // from Add Employee or the employee detail page.
  roles: [],

  employees: [],

  categories: [],

  localUpcDb: {},

  expirationItems: [],

  soups: [],
  // Soup size/pricing tiers shown on the Weekly Deli Menu's Soups box.
  // Editable (add/rename sizes, edit price, delete) from the Soup Menu tab.
  soupSizes: [
    { id: "szsm", name: "Small", price: "" },
    { id: "szmd", name: "Medium", price: "" },
    { id: "szlg", name: "Large", price: "" },
  ],
  // soupMenu[monthKey][isoDate] = soupId   monthKey = 'YYYY-MM'
  soupMenu: {},

  // Deli boxes are dynamic — the master adds/renames/deactivates/deletes boxes
  // from the Deli Menu tab. Start blank; use "+ Add Box" to create the first one.
  deliBoxes: [],
  deliItemLists: {},

  // weeklyMenus[weekKey] = { [boxId]: {price, notes, items:[id..]} }
  weeklyMenus: {},

  produceDeals: [],

  // Custom Bar: static (no weekly calendar, like Produce Deals) list of
  // boxes/items available for Custom Panini and/or Custom Salad orders.
  customBarBoxes: [],
  customBarItems: [],

  // Customer orders placed from the public Weekly Deli page.
  orders: [],

  // Employee shift-swap requests: trade, or give-away/pick-up (both are
  // "transfer" — one shift moves from one person to another).
  shiftSwaps: [],

  // Coffee Bar: fixed categories (hot/cold), items with attachable add-ons.
  coffeeItems: [],
  coffeeAddons: [],
  coffeeMilks: [],
  coffeeFlavorCategories: [],
  coffeeFlavors: [],

  // Recipes: binders (like deli boxes) containing recipes.
  recipeBinders: [],
  recipes: [],

  // Dates the store is entirely closed — pickup disabled outright on these.
  closedDates: [],

  // Weeks whose schedule master has published — unpublished weeks are
  // invisible to anyone except master, even if the shifts are already saved.
  publishedWeeks: [],

  // schedule[weekKey][employeeId][DAY] = {start,end}
  schedule: {},
  timeOffRequests: [],
  chatMessages: [],
};

/* ============================================================
   FIREBASE — connected to the "GroundedMarket" project.
   ============================================================
   These values are safe to be public in client-side code — real security
   lives in Firestore/Storage Rules (see the rules provided separately),
   not in hiding these.
   ============================================================ */
const firebaseConfig = {
  apiKey: "AIzaSyCYd08eJkPenGNUkVuRC2ozfe5nTfTye1I",
  authDomain: "groundedmarket-86e50.firebaseapp.com",
  projectId: "groundedmarket-86e50",
  storageBucket: "groundedmarket-86e50.firebasestorage.app",
  messagingSenderId: "518382046314",
  appId: "1:518382046314:web:4bd964d6bf2607cb7a8e13",
};
firebase.initializeApp(firebaseConfig);
const fsdb = firebase.firestore();
const storage = firebase.storage();
const fbauth = firebase.auth();
const fbfunctions = firebase.functions();
// Staff usernames map to synthetic emails because Firebase Auth is
// email-based — staff never see or type the email part.
const toStaffEmail = (u) =>
  `${u.trim().toLowerCase().replace(/\s+/g, "")}@groundedmarket.com`;

// Only `settings` remains a single shared document — it's just two booleans,
// not a growing list, so there's no "record" that a stale save could ever
// clobber (worst case is a flag briefly reverting, not data loss).
const FIRESTORE_COLLECTIONS = ["settings"];
// CRITICAL SAFEGUARD: a collection is only "loaded" once we've successfully
// received real data from Firestore for it (or successfully created it, if
// it was genuinely brand new). Saves are hard-blocked until every single
// collection has loaded — this is what prevents a bug (or a quota/permission
// hiccup on the very first read) from ever pushing blank local defaults up
// and overwriting real data in Firestore. Do not remove this gate.
let loadedCollections = new Set();
// RECORD_COLLECTIONS: every one of these is a real Firestore collection (one
// document per record) rather than a shared array-in-a-document. This is
// what makes it structurally impossible for any client's stale local copy
// to overwrite someone else's addition, edit, or deletion — adding/editing/
// deleting one record only ever touches that record's own document.
// Everything the app stores now lives here except `settings` (see above).
const RECORD_COLLECTIONS = [
  "employees",
  "expirationItems",
  "timeOffRequests",
  "chatMessages",
  "categories",
  "roles",
  "soups",
  "soupSizes",
  "produce",
  "localUpcDb",
  "deliBoxes",
  "deliItems",
  "customBarBoxes",
  "customBarItems",
  "orders",
  "shiftSwaps",
  "coffeeItems",
  "coffeeAddons",
  "coffeeMilks",
  "coffeeFlavorCategories",
  "coffeeFlavors",
  "recipeBinders",
  "recipes",
  "closedDates",
  "publishedWeeks",
];
let loadedRecordCollections = new Set();
// COMPOSITE_COLLECTIONS: same idea as RECORD_COLLECTIONS, but for data that's
// naturally keyed by more than one thing (a soup assignment is per-DAY; a
// weekly deli menu is per-week-per-box; a shift is per-week-per-employee-
// per-day). Each of those individual combinations gets its own document, so
// e.g. editing Monday's soup can never touch Tuesday's, and editing one
// employee's Wednesday shift can never touch anyone else's shift that week.
const COMPOSITE_COLLECTIONS = [
  "soupMenuDays",
  "deliWeeklyMenus",
  "scheduleShifts",
];
let loadedCompositeCollections = new Set();
function markLoaded(name) {
  loadedCollections.add(name);
}
function allCollectionsLoaded() {
  return (
    FIRESTORE_COLLECTIONS.every((n) => loadedCollections.has(n)) &&
    RECORD_COLLECTIONS.every((n) => loadedRecordCollections.has(n)) &&
    COMPOSITE_COLLECTIONS.every((n) => loadedCompositeCollections.has(n))
  );
}

// Guards against a save→listen→save feedback loop: while we're applying data
// that just arrived FROM Firestore, scheduleSave() below is a no-op.
let applyingRemoteUpdate = false;
let saveDebounceTimer = null;
function scheduleSave() {
  if (applyingRemoteUpdate) return;
  if (!allCollectionsLoaded()) return; // never write before every collection has loaded once
  clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(saveAllToFirestore, 500);
}
// Remembers the last JSON actually written/read for each shared-doc
// collection, so we skip re-writing a document that hasn't changed. Only
// applies to `settings` now — every record/composite collection saves
// itself directly at the point of mutation instead (see each feature's own
// save/delete functions).
let lastKnownJSON = {};
function saveAllToFirestore() {
  const w = (name, payload) => {
    const json = JSON.stringify(payload);
    if (lastKnownJSON[name] === json) return;
    lastKnownJSON[name] = json;
    fsdb
      .collection("store")
      .doc(name)
      .set(payload)
      .catch((err) => console.error("Firestore save failed:", name, err));
  };
  w("settings", db.settings);
}
// Live-syncs a shared-doc collection (just `settings` now).
function bindDoc(name, applyFn, seedPayload) {
  fsdb
    .collection("store")
    .doc(name)
    .onSnapshot(
      (snap) => {
        if (snap.exists) {
          applyFn(snap.data());
          lastKnownJSON[name] = JSON.stringify(snap.data());
          markLoaded(name);
          afterFirestoreUpdate();
        } else {
          fsdb
            .collection("store")
            .doc(name)
            .set(seedPayload)
            .then(() => {
              lastKnownJSON[name] = JSON.stringify(seedPayload);
              markLoaded(name);
            })
            .catch((err) => console.error("Firestore seed failed:", name, err));
        }
      },
      (err) => {
        // Do NOT mark this collection as loaded on error — that's what keeps
        // scheduleSave() blocked until a real read actually succeeds.
        console.error("Firestore listener failed:", name, err);
      }
    );
}
// Live-syncs one of the RECORD_COLLECTIONS. applyArray receives the full
// current array of records (each with its Firestore doc ID copied onto
// `.id`) every time anything in the collection changes.
function bindRecordCollection(name, applyArray) {
  fsdb.collection(name).onSnapshot(
    (snap) => {
      applyArray(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      loadedRecordCollections.add(name);
      afterFirestoreUpdate();
    },
    (err) => console.error(`${name} listener failed:`, err)
  );
}
// Orders get their own listener (rather than the generic bindRecordCollection
// above) because arriving orders need to trigger auto-print/notifications —
// but ONLY for orders that arrive after this page has already loaded, never
// for the initial batch of existing orders on page load/refresh.
let ordersLoadedOnce = false;
function bindOrdersCollection() {
  fsdb.collection("orders").onSnapshot(
    (snap) => {
      db.orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      loadedRecordCollections.add("orders");
      if (ordersLoadedOnce) {
        snap.docChanges().forEach((change) => {
          if (change.type === "added")
            handleNewOrderArrival({ id: change.doc.id, ...change.doc.data() });
        });
      } else {
        ordersLoadedOnce = true;
      }
      afterFirestoreUpdate();
    },
    (err) => console.error("Orders listener failed:", err)
  );
}
// Fires for a genuinely new order: a local (in-tab) notification if
// permission's been granted, and an auto-print IF this specific device has
// a printer IP configured (see printerSetupHTML) — deliberately local to
// this browser/device rather than a shared setting, so only the one device
// actually wired to the kitchen printer ever attempts to print.
// Fires for a newly-arrived order — triggers auto-print if this device has
// a printer IP configured (see printerSetupHTML).
function handleNewOrderArrival(order) {
  // const ip = localStorage.getItem("groundedPrinterIP");
  // const ip = localStorage.getItem("printServerIP") || "http://10.0.0.4:3069";
  const ip = "http://10.0.0.4:3069";

  if (ip && !order.autoprinted) {
    printOrderToPrinter(order, ip)
      .then(() => {
        fsdb
          .collection("orders")
          .doc(order.id)
          .update({ autoprinted: true })
          .catch((err) => console.error("Mark autoprinted failed:", err));
      })
      .catch((err) => console.error("Auto-print failed:", err));
  }
}
// Builds an Epson ePOS-Print XML ticket for one order — talks to the
// printer directly from the browser over the local network, no server
// involved.
function buildEposPrintXML(order) {
  const esc = (s) =>
    (s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  let body = "";
  body += `<text align="center" width="2" height="2">GROUNDED ORDER&#10;&#10;</text>`;
  body += `<text align="left" width="1" height="1">`;
  body += `${esc(order.customerName)}   ${esc(order.customerPhone)}&#10;`;
  body += `Pickup: ${order.pickupDate} ${formatTime12hr(
    order.pickupTime
  )}&#10;`;
  body += `------------------------------&#10;`;
  (order.items || []).forEach((item) => {
    if (
      item.kind === "menu" ||
      item.kind === "soup" ||
      item.kind === "coffee"
    ) {
      body += `x${item.qty}  ${esc(item.name)}&#10;`;
      if (item.note) body += `   note: ${esc(item.note)}&#10;`;
    } else {
      body += `x${item.qty || 1}  Custom ${
        item.customType === "panini" ? "Panini" : "Salad"
      }&#10;`;
      (item.selections || []).forEach((sel) => {
        body += `   - ${esc(sel.item)}&#10;`;
      });
      if (item.note) body += `   note: ${esc(item.note)}&#10;`;
    }
  });
  body += `------------------------------&#10;`;
  body += `Submitted: ${new Date(
    order.submittedAt
  ).toLocaleString()}&#10;&#10;`;
  body += `</text>`;
  body += `<cut type="feed"/>`;
  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">
      ${body}
    </epos-print>
  </s:Body>
</s:Envelope>`;
}
function printOrderToPrinter(order, ip) {
  // const xml = buildEposPrintXML(order);
  console.log(order);
  // const url = `http://${ip}/cgi-bin/epos/service.cgi?devid=local_printer&timeout=10000`;
  const url = `${ip}/print`;
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(order),
  }).then((res) => {
    if (!res.ok) throw new Error("Printer responded with status " + res.status);
    return res;
  });
}
function manualPrintOrder(id) {
  const order = db.orders.find((o) => o.id === id);
  if (!order) return;
  // const ip = localStorage.getItem("groundedPrinterIP");
  // const ip = localStorage.getItem("printServerIP") || "http://10.0.0.4:3069";
  const ip = "http://10.0.0.4:3069";

  if (!ip) {
    alert(
      "No printer IP is set up on this device. Enter one under Auto-Print Setup at the top of the Orders tab."
    );
    return;
  }
  printOrderToPrinter(order, ip)
    .then(() => {
      fsdb
        .collection("orders")
        .doc(id)
        .update({ autoprinted: true })
        .catch(() => {});
      alert("Sent to printer.");
    })
    .catch((err) => {
      console.error("Manual print failed:", err);
      alert(
        "Couldn't reach the printer. Check the IP address and that this device is on the same WiFi network as the printer."
      );
    });
}
// Printer IP is stored per-device (localStorage), not as a shared Firestore
// setting — only set this on the ONE device actually wired to the kitchen
// printer, so no other device ever double-prints the same order.
function printerSetupHTML() {
  const ip = localStorage.getItem("printServerIP") || "";

  return `<div class="card">
    <h4>Auto-Print Setup (this device only)</h4>
    <p style="font-size:12.5px;color:var(--ink-soft)">If this device is on the same WiFi network as the kitchen printer, enter its local IP address here. Only set this on the one device actually connected to the printer — leave it blank everywhere else.</p>
    <div class="field" style="max-width:220px"><label>Printer IP address</label><input type="text" id="printer-ip-input" value="${ip}" placeholder="e.g. 192.168.1.50" onchange="savePrinterIP(this.value)"></div>
  </div>`;
}
function savePrinterIP(val) {
  // localStorage.setItem("groundedPrinterIP", val.trim());
  localStorage.setItem("printServerIP", val.trim());
}

/* ============================================================
   ORDERS TAB (everyone — master, Display, and every employee)
   ============================================================ */
let ordersSearchTerm = "";
let ordersDateFilter = "";
let ordersViewMode = "all"; // 'kitchen' | 'coffee' | 'all'
function orderHasCoffee(o) {
  return (o.items || []).some((i) => i.kind === "coffee");
}
function orderHasNonCoffee(o) {
  return (o.items || []).some((i) => i.kind !== "coffee");
}
function setOrdersViewMode(mode) {
  ordersViewMode = mode;
  renderPortalBody();
}
function ordersModeToggleHTML() {
  const idx = { kitchen: 0, coffee: 1, all: 2 }[ordersViewMode];
  return `<div class="mode-toggle">
    <button class="mode-toggle-opt ${
      ordersViewMode === "kitchen" ? "active" : ""
    }" onclick="setOrdersViewMode('kitchen')">Kitchen</button>
    <button class="mode-toggle-opt ${
      ordersViewMode === "coffee" ? "active" : ""
    }" onclick="setOrdersViewMode('coffee')">Coffee</button>
    <button class="mode-toggle-opt ${
      ordersViewMode === "all" ? "active" : ""
    }" onclick="setOrdersViewMode('all')">All</button>
    <div class="mode-toggle-thumb" style="transform:translateX(${
      idx * 100
    }%)"></div>
  </div>`;
}
function ordersTabHTML() {
  const term = ordersSearchTerm.toLowerCase();
  let list = db.orders.slice();
  if (term)
    list = list.filter(
      (o) =>
        o.customerName.toLowerCase().includes(term) ||
        o.customerPhone.includes(term) ||
        (o.items || []).some((it) =>
          (it.name || "").toLowerCase().includes(term)
        )
    );
  if (ordersDateFilter)
    list = list.filter((o) => o.pickupDate === ordersDateFilter);
  // The toggle only controls what's VISIBLE/dimmed here — it never touches
  // what actually gets printed, which always includes every item regardless.
  if (ordersViewMode === "kitchen") list = list.filter(orderHasNonCoffee);
  else if (ordersViewMode === "coffee") list = list.filter(orderHasCoffee);

  const today = todayISO();
  const upcoming = list.filter((o) => o.pickupDate >= today);
  const past = list
    .filter((o) => o.pickupDate < today)
    .sort((a, b) =>
      b.pickupDate === a.pickupDate
        ? b.pickupTime.localeCompare(a.pickupTime)
        : b.pickupDate.localeCompare(a.pickupDate)
    );

  const groups = {};
  upcoming.forEach((o) => {
    if (!groups[o.pickupDate]) groups[o.pickupDate] = [];
    groups[o.pickupDate].push(o);
  });
  Object.values(groups).forEach((g) =>
    g.sort((a, b) => a.pickupTime.localeCompare(b.pickupTime))
  );
  const dateKeys = Object.keys(groups).sort();

  let html = `<h2 class="section-title">Orders</h2>
    ${ordersModeToggleHTML()}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
      <input type="text" id="orders-search" class="cat-search" style="margin:0;flex:1;min-width:180px" placeholder="Search name, phone, item…" value="${escHtmlAttr(
        ordersSearchTerm
      )}" oninput="const pos=this.selectionStart; ordersSearchTerm=this.value; renderPortalBody(); reFocusInput('orders-search', pos);">
      <span style="display:flex;align-items:center;gap:5px">${DATE_FILTER_LABEL}<input type="date" id="orders-date-filter" value="${ordersDateFilter}" onchange="ordersDateFilter=this.value;renderPortalBody()"></span>
      ${
        ordersDateFilter
          ? `<button class="btn small outline" onclick="ordersDateFilter='';renderPortalBody()">Clear</button>`
          : ""
      }
    </div>`;

  if (!dateKeys.length) html += '<p class="empty-note">No upcoming orders.</p>';
  dateKeys.forEach((dk) => {
    const d = new Date(dk + "T00:00");
    html += `<h3 style="margin-top:18px;font-size:15px;color:var(--brown)">${d.toDateString()}</h3>`;
    html += groups[dk].map(orderCardHTML).join("");
  });

  if (past.length)
    html += `<details style="margin-top:20px"><summary style="cursor:pointer;font-size:13px;color:var(--brown-light)">Past orders (${
      past.length
    })</summary>${past.map(orderCardHTML).join("")}</details>`;
  if (session.isMaster || session.isDisplay)
    html += `<div style="margin-top:28px">${printerSetupHTML()}</div>`;
  return html;
}
// Completion is tracked per-ITEM now (item.done), not just per-order, so a
// kitchen-only or coffee-only "mark complete" can genuinely mean it without
// falsely completing the other half of the order. Falls back to the old
// order-level status for orders placed before this existed (no item.done
// data at all yet), so nothing already in the system breaks.
function orderStatus(o) {
  const items = o.items || [];
  if (!items.length)
    return o.status === "completed" ? "completed" : "incomplete";
  const anyItemHasDoneField = items.some((i) => i.done !== undefined);
  if (!anyItemHasDoneField)
    return o.status === "completed" ? "completed" : "incomplete";
  const doneCount = items.filter((i) => i.done).length;
  if (doneCount === 0) return "incomplete";
  if (doneCount === items.length) return "completed";
  return "partial";
}
const ORDER_STATUS_LABEL = {
  completed: "Completed",
  partial: "Partially Complete",
  incomplete: "Incomplete",
};
function orderCardHTML(o) {
  const status = orderStatus(o);
  const cardClass =
    status === "completed"
      ? ""
      : status === "partial"
      ? "order-partial"
      : "order-incomplete";
  return `<div class="card ${cardClass}" onclick="openOrderDetail('${
    o.id
  }')" style="cursor:pointer">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <strong>${formatTime12hr(o.pickupTime)} — ${escHtmlAttr(
    o.customerName
  )}</strong>
      <span class="pill">${ORDER_STATUS_LABEL[status]}</span>
    </div>
    <div style="font-size:12.5px;color:var(--ink-soft)">${escHtmlAttr(
      o.customerPhone
    )} · ${(o.items || []).length} item${
    (o.items || []).length === 1 ? "" : "s"
  }</div>
  </div>`;
}
// dimmed lets the toggle visually de-emphasize items that don't match the
// current Kitchen/Coffee focus, without hiding them — staff can still see
// the whole order, just at a glance which part is theirs to make. A ✓
// shows next to any item already marked done.
function orderItemLineHTML(item, dimmed) {
  const dimStyle = dimmed ? ' style="opacity:0.4"' : "";
  const check = item.done ? "✓ " : "";
  if (item.kind === "menu" || item.kind === "soup" || item.kind === "coffee") {
    return `<div class="search-panel-row"${dimStyle}><strong>${check}×${
      item.qty
    } ${escHtmlAttr(item.name)}</strong>${
      item.note
        ? `<br><span style="font-size:12px;color:var(--ink-soft)">Note: ${escHtmlAttr(
            item.note
          )}</span>`
        : ""
    }</div>`;
  }
  const sels = (item.selections || []).map((s) => s.item).join(", ");
  return `<div class="search-panel-row"${dimStyle}><strong>${check}×${
    item.qty || 1
  } Custom ${
    item.customType === "panini" ? "Panini" : "Salad"
  }</strong><br><span style="font-size:12.5px">${escHtmlAttr(sels)}</span>${
    item.note
      ? `<br><span style="font-size:12px;color:var(--ink-soft)">Note: ${escHtmlAttr(
          item.note
        )}</span>`
      : ""
  }</div>`;
}
function openOrderDetail(id) {
  const o = db.orders.find((x) => x.id === id);
  if (!o) return;
  const items = o.items || [];
  let scope, scopeLabel;
  if (ordersViewMode === "kitchen") {
    scope = items.filter((i) => i.kind !== "coffee");
    scopeLabel = "Kitchen";
  } else if (ordersViewMode === "coffee") {
    scope = items.filter((i) => i.kind === "coffee");
    scopeLabel = "Coffee";
  } else {
    scope = items;
    scopeLabel = "All";
  }
  const allScopeDone = scope.length > 0 && scope.every((i) => i.done);
  const itemsHTML = items
    .map((item) => {
      const dim =
        (ordersViewMode === "kitchen" && item.kind === "coffee") ||
        (ordersViewMode === "coffee" && item.kind !== "coffee");
      return orderItemLineHTML(item, dim);
    })
    .join("");
  openModal(`<h3>Order — ${escHtmlAttr(o.customerName)}</h3>
    <p style="font-size:13px;color:var(--ink-soft)">${escHtmlAttr(
      o.customerPhone
    )} · Pickup ${o.pickupDate} ${formatTime12hr(
    o.pickupTime
  )}<br>Submitted ${new Date(
    o.submittedAt
  ).toLocaleString()}<br>Status: <strong>${
    ORDER_STATUS_LABEL[orderStatus(o)]
  }</strong></p>
    <div class="search-panel-list" style="max-height:320px;margin:10px 0">
      ${itemsHTML || '<div class="search-panel-row">No items.</div>'}
    </div>
    <div class="modal-actions" style="justify-content:space-between">
      <button class="btn danger" onclick="deleteOrder('${id}')">Delete</button>
      <button class="btn outline" onclick="manualPrintOrder('${id}')">🖨️ Print</button>
      <button class="btn ${allScopeDone ? "outline" : ""}" ${
    scope.length === 0 ? "disabled" : ""
  } onclick="toggleOrderCompletion('${id}')">${
    allScopeDone
      ? `Mark ${scopeLabel} Incomplete`
      : `Mark ${scopeLabel} Complete`
  }</button>
    </div>`);
}
function deleteOrder(id) {
  if (!confirm("Delete this order? This cannot be undone.")) return;
  db.orders = db.orders.filter((o) => o.id !== id);
  fsdb
    .collection("orders")
    .doc(id)
    .delete()
    .catch((err) => console.error("Delete order failed:", err));
  closeModal();
  renderPortalBody();
}
// Only touches the items in the CURRENT toggle's scope — marking an order
// complete while in Kitchen mode never marks its coffee items, and vice
// versa. In All mode it marks (or clears) every item.
function toggleOrderCompletion(id) {
  const o = db.orders.find((x) => x.id === id);
  if (!o) return;
  const items = o.items || [];
  let scope;
  if (ordersViewMode === "kitchen")
    scope = items.filter((i) => i.kind !== "coffee");
  else if (ordersViewMode === "coffee")
    scope = items.filter((i) => i.kind === "coffee");
  else scope = items;
  if (!scope.length) return;
  const allDone = scope.every((i) => i.done);
  scope.forEach((i) => {
    i.done = !allDone;
  });
  // Keep the legacy order-level status roughly in sync too, in case
  // anything still reads it directly — the real UI always uses
  // orderStatus(), which is item-driven.
  o.status = orderStatus(o) === "completed" ? "completed" : "incomplete";
  fsdb
    .collection("orders")
    .doc(id)
    .update({ items: o.items, status: o.status })
    .catch((err) => console.error("Update order status failed:", err));
  closeModal();
  renderPortalBody();
}
// Live-syncs one of the COMPOSITE_COLLECTIONS. applyDocs receives the raw
// list of {id, ...data} documents (id is the composite key, e.g. a date, or
// "weekKey__boxId") — each collection's own rebuild function turns that
// back into the nested shape the rest of the app reads from `db`.
function bindCompositeCollection(name, applyDocs) {
  fsdb.collection(name).onSnapshot(
    (snap) => {
      applyDocs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      loadedCompositeCollections.add(name);
      afterFirestoreUpdate();
    },
    (err) => console.error(`${name} listener failed:`, err)
  );
}
// One-time migration: if a record collection's data still lives in its old
// shared document (from before this change), and the new collection is
// empty, copy every record over automatically so nobody has to re-enter
// anything. Safe to call on every load — it's a no-op once the new
// collection already has data in it, and it's also a no-op if the old
// document was itself already empty (nothing to recover in that case).
function migrateRecordCollectionIfNeeded(
  collectionName,
  oldDocName,
  extractList
) {
  fsdb
    .collection(collectionName)
    .limit(1)
    .get()
    .then((snap) => {
      if (!snap.empty) return;
      fsdb
        .collection("store")
        .doc(oldDocName)
        .get()
        .then((oldDoc) => {
          if (!oldDoc.exists) return;
          const list = extractList(oldDoc.data() || {}) || [];
          if (!list.length) return;
          const batch = fsdb.batch();
          list.forEach((item) => {
            const { id, ...rest } = item;
            if (id) batch.set(fsdb.collection(collectionName).doc(id), rest);
          });
          batch
            .commit()
            .catch((err) =>
              console.error(`${collectionName} migration failed:`, err)
            );
        })
        .catch((err) =>
          console.error(`${collectionName} migration read failed:`, err)
        );
    })
    .catch((err) =>
      console.error(`${collectionName} migration check failed:`, err)
    );
}
// Same idea, but for the RECORD_COLLECTIONS keyed by a natural string (like
// a role name or a UPC) rather than a generated id.
function migrateKeyedRecordCollectionIfNeeded(
  collectionName,
  oldDocName,
  extractMap
) {
  fsdb
    .collection(collectionName)
    .limit(1)
    .get()
    .then((snap) => {
      if (!snap.empty) return;
      fsdb
        .collection("store")
        .doc(oldDocName)
        .get()
        .then((oldDoc) => {
          if (!oldDoc.exists) return;
          const map = extractMap(oldDoc.data() || {}) || {};
          const keys = Object.keys(map);
          if (!keys.length) return;
          const batch = fsdb.batch();
          keys.forEach((k) => {
            batch.set(fsdb.collection(collectionName).doc(k), map[k]);
          });
          batch
            .commit()
            .catch((err) =>
              console.error(`${collectionName} migration failed:`, err)
            );
        })
        .catch((err) =>
          console.error(`${collectionName} migration read failed:`, err)
        );
    })
    .catch((err) =>
      console.error(`${collectionName} migration check failed:`, err)
    );
}
// Migrates the old `roles` shared doc (array of plain strings) into the new
// per-role collection, keyed by role name.
function migrateRolesIfNeeded() {
  fsdb
    .collection("roles")
    .limit(1)
    .get()
    .then((snap) => {
      if (!snap.empty) return;
      fsdb
        .collection("store")
        .doc("roles")
        .get()
        .then((oldDoc) => {
          if (!oldDoc.exists) return;
          const list = (oldDoc.data() || {}).list || [];
          if (!list.length) return;
          const batch = fsdb.batch();
          list.forEach((name) => {
            if (name) batch.set(fsdb.collection("roles").doc(name), {});
          });
          batch
            .commit()
            .catch((err) => console.error("roles migration failed:", err));
        })
        .catch((err) => console.error("roles migration read failed:", err));
    })
    .catch((err) => console.error("roles migration check failed:", err));
}
// Migrates the old `soupMenu` shared doc (nested monthKey -> dateISO ->
// soupId) into the new per-day collection, keyed by the date itself.
function migrateSoupMenuIfNeeded() {
  fsdb
    .collection("soupMenuDays")
    .limit(1)
    .get()
    .then((snap) => {
      if (!snap.empty) return;
      fsdb
        .collection("store")
        .doc("soupMenu")
        .get()
        .then((oldDoc) => {
          if (!oldDoc.exists) return;
          const nested = (oldDoc.data() || {}).data || {};
          const batch = fsdb.batch();
          let any = false;
          Object.values(nested).forEach((monthObj) => {
            Object.entries(monthObj || {}).forEach(([dateISO, soupId]) => {
              if (!soupId) return;
              batch.set(fsdb.collection("soupMenuDays").doc(dateISO), {
                soupId,
              });
              any = true;
            });
          });
          if (any)
            batch
              .commit()
              .catch((err) => console.error("soupMenu migration failed:", err));
        })
        .catch((err) => console.error("soupMenu migration read failed:", err));
    })
    .catch((err) => console.error("soupMenu migration check failed:", err));
}
// Migrates the old `deli` shared doc (boxes + itemLists + weeklyMenus all
// bundled together) into three separate collections.
function migrateDeliIfNeeded() {
  fsdb
    .collection("deliBoxes")
    .limit(1)
    .get()
    .then((snap) => {
      if (!snap.empty) return;
      fsdb
        .collection("store")
        .doc("deli")
        .get()
        .then((oldDoc) => {
          if (!oldDoc.exists) return;
          const data = oldDoc.data() || {};
          const boxes = data.boxes || [];
          const itemLists = data.itemLists || {};
          const weeklyMenus = data.weeklyMenus || {};
          const batch = fsdb.batch();
          let any = false;
          boxes.forEach((b) => {
            const { id, ...rest } = b;
            if (id) {
              batch.set(fsdb.collection("deliBoxes").doc(id), rest);
              any = true;
            }
          });
          Object.entries(itemLists).forEach(([boxId, items]) => {
            (items || []).forEach((item) => {
              const { id, ...rest } = item;
              if (id) {
                batch.set(fsdb.collection("deliItems").doc(id), {
                  ...rest,
                  boxId,
                });
                any = true;
              }
            });
          });
          Object.entries(weeklyMenus).forEach(([weekKey, boxMap]) => {
            Object.entries(boxMap || {}).forEach(([boxId, menuData]) => {
              batch.set(
                fsdb.collection("deliWeeklyMenus").doc(`${weekKey}__${boxId}`),
                menuData
              );
              any = true;
            });
          });
          if (any)
            batch
              .commit()
              .catch((err) => console.error("deli migration failed:", err));
        })
        .catch((err) => console.error("deli migration read failed:", err));
    })
    .catch((err) => console.error("deli migration check failed:", err));
}
// Migrates the old `schedule` shared doc (nested weekKey -> empId -> dayKey
// -> shift) into the new per-shift collection.
function migrateScheduleIfNeeded() {
  fsdb
    .collection("scheduleShifts")
    .limit(1)
    .get()
    .then((snap) => {
      if (!snap.empty) return;
      fsdb
        .collection("store")
        .doc("schedule")
        .get()
        .then((oldDoc) => {
          if (!oldDoc.exists) return;
          const data = (oldDoc.data() || {}).data || {};
          const batch = fsdb.batch();
          let any = false;
          Object.entries(data).forEach(([weekKey, empMap]) => {
            Object.entries(empMap || {}).forEach(([empId, dayMap]) => {
              Object.entries(dayMap || {}).forEach(([dayKey, shift]) => {
                batch.set(
                  fsdb
                    .collection("scheduleShifts")
                    .doc(`${weekKey}__${empId}__${dayKey}`),
                  shift
                );
                any = true;
              });
            });
          });
          if (any)
            batch
              .commit()
              .catch((err) => console.error("schedule migration failed:", err));
        })
        .catch((err) => console.error("schedule migration read failed:", err));
    })
    .catch((err) => console.error("schedule migration check failed:", err));
}
// Rebuild helpers: turn the flat list of composite documents back into the
// nested shape the rest of the app already reads from `db`.
function rebuildSoupMenu(docs) {
  const nested = {};
  docs.forEach((d) => {
    const dateISO = d.id;
    const monthKey = dateISO.slice(0, 7);
    if (!nested[monthKey]) nested[monthKey] = {};
    nested[monthKey][dateISO] = d.soupId;
  });
  db.soupMenu = nested;
}
function rebuildDeliWeeklyMenus(docs) {
  const nested = {};
  docs.forEach((d) => {
    const sep = d.id.indexOf("__");
    const weekKey = d.id.slice(0, sep),
      boxId = d.id.slice(sep + 2);
    if (!nested[weekKey]) nested[weekKey] = {};
    nested[weekKey][boxId] = {
      price: d.price || "",
      notes: d.notes || "",
      items: d.items || [],
    };
  });
  db.weeklyMenus = nested;
}
function rebuildSchedule(docs) {
  const nested = {};
  docs.forEach((d) => {
    const [weekKey, empId, dayKey] = d.id.split("__");
    if (!nested[weekKey]) nested[weekKey] = {};
    if (!nested[weekKey][empId]) nested[weekKey][empId] = {};
    nested[weekKey][empId][dayKey] = {
      start: d.start,
      end: d.end,
      notes: d.notes || "",
    };
  });
  db.schedule = nested;
}
function rebuildDeliItemLists(docs) {
  const map = {};
  docs.forEach((d) => {
    const { boxId, ...item } = d;
    if (!map[boxId]) map[boxId] = [];
    map[boxId].push(item);
  });
  db.deliItemLists = map;
}
function initFirebaseSync() {
  bindDoc(
    "settings",
    (d) => {
      db.settings = {
        showWeekendsSoup: !!d.showWeekendsSoup,
        showSunSchedule: !!d.showSunSchedule,
        customPaniniPrice: d.customPaniniPrice || "",
        customSaladPrice: d.customSaladPrice || "",
        uncategorizedOrder:
          d.uncategorizedOrder != null ? d.uncategorizedOrder : -2,
        markdownOrder: d.markdownOrder != null ? d.markdownOrder : -1,
      };
    },
    db.settings
  );

  migrateRecordCollectionIfNeeded("employees", "employees", (d) => d.list);
  bindRecordCollection("employees", (arr) => {
    db.employees = arr.sort(
      (a, b) =>
        (a.order != null ? a.order : 0) - (b.order != null ? b.order : 0)
    );
  });
  migrateRecordCollectionIfNeeded(
    "expirationItems",
    "expirations",
    (d) => d.items
  );
  bindRecordCollection("expirationItems", (arr) => {
    db.expirationItems = arr;
  });
  migrateRecordCollectionIfNeeded(
    "timeOffRequests",
    "timeOffRequests",
    (d) => d.list
  );
  bindRecordCollection("timeOffRequests", (arr) => {
    db.timeOffRequests = arr;
  });
  migrateRecordCollectionIfNeeded("chatMessages", "chat", (d) => d.list);
  bindRecordCollection("chatMessages", (arr) => {
    db.chatMessages = arr;
  });
  migrateRecordCollectionIfNeeded("categories", "categories", (d) => d.list);
  bindRecordCollection("categories", (arr) => {
    db.categories = arr.sort(
      (a, b) =>
        (a.order != null ? a.order : 0) - (b.order != null ? b.order : 0)
    );
  });
  migrateRecordCollectionIfNeeded("soups", "soups", (d) => d.list);
  bindRecordCollection("soups", (arr) => {
    db.soups = arr;
  });
  migrateRecordCollectionIfNeeded("soupSizes", "soupSizes", (d) => d.list);
  bindRecordCollection("soupSizes", (arr) => {
    db.soupSizes = arr.sort(
      (a, b) =>
        (a.order != null ? a.order : 0) - (b.order != null ? b.order : 0)
    );
  });
  migrateRecordCollectionIfNeeded("produce", "produce", (d) => d.list);
  bindRecordCollection("produce", (arr) => {
    db.produceDeals = arr;
  });
  bindRecordCollection("customBarBoxes", (arr) => {
    db.customBarBoxes = arr.sort(
      (a, b) =>
        (a.order != null ? a.order : 0) - (b.order != null ? b.order : 0)
    );
  });
  bindRecordCollection("customBarItems", (arr) => {
    db.customBarItems = arr;
  });
  bindOrdersCollection();
  bindRecordCollection("shiftSwaps", (arr) => {
    db.shiftSwaps = arr;
  });
  bindRecordCollection("coffeeItems", (arr) => {
    db.coffeeItems = arr;
  });
  bindRecordCollection("coffeeAddons", (arr) => {
    db.coffeeAddons = arr;
  });
  bindRecordCollection("coffeeMilks", (arr) => {
    db.coffeeMilks = arr;
  });
  bindRecordCollection("coffeeFlavorCategories", (arr) => {
    db.coffeeFlavorCategories = arr.sort(
      (a, b) =>
        (a.order != null ? a.order : 0) - (b.order != null ? b.order : 0)
    );
  });
  bindRecordCollection("coffeeFlavors", (arr) => {
    db.coffeeFlavors = arr;
  });
  bindRecordCollection("recipeBinders", (arr) => {
    db.recipeBinders = arr.sort(
      (a, b) =>
        (a.order != null ? a.order : 0) - (b.order != null ? b.order : 0)
    );
  });
  bindRecordCollection("recipes", (arr) => {
    db.recipes = arr;
  });
  bindRecordCollection("closedDates", (arr) => {
    db.closedDates = arr.map((d) => d.id);
  });
  bindRecordCollection("publishedWeeks", (arr) => {
    db.publishedWeeks = arr.map((d) => d.id);
  });
  migrateKeyedRecordCollectionIfNeeded(
    "localUpcDb",
    "localUpcDb",
    (d) => d.map
  );
  bindRecordCollection("localUpcDb", (arr) => {
    const map = {};
    arr.forEach((r) => {
      map[r.id] = { brand: r.brand, description: r.description };
    });
    db.localUpcDb = map;
  });
  migrateRolesIfNeeded();
  bindRecordCollection("roles", (arr) => {
    db.roles = arr.map((r) => r.id);
  });

  migrateDeliIfNeeded();
  bindRecordCollection("deliBoxes", (arr) => {
    db.deliBoxes = arr.sort(
      (a, b) =>
        (a.order != null ? a.order : 0) - (b.order != null ? b.order : 0)
    );
  });
  bindRecordCollection("deliItems", (arr) => {
    rebuildDeliItemLists(arr);
  });
  bindCompositeCollection("deliWeeklyMenus", (docs) => {
    rebuildDeliWeeklyMenus(docs);
  });

  migrateSoupMenuIfNeeded();
  bindCompositeCollection("soupMenuDays", (docs) => {
    rebuildSoupMenu(docs);
  });

  migrateScheduleIfNeeded();
  bindCompositeCollection("scheduleShifts", (docs) => {
    rebuildSchedule(docs);
  });
}
// Re-renders whatever's currently on screen after data arrives from another
// device/tab. Restores the employee-detail sub-view instead of bouncing
// back to the list, if that's what was open.
function afterFirestoreUpdate() {
  applyingRemoteUpdate = true;
  // If an employee session restored before the employees collection loaded,
  // fill in their real name the moment it arrives.
  if (session && session.employeeId && session.name === "…") {
    const emp = db.employees.find((e) => e.id === session.employeeId);
    if (emp) {
      session.name = emp.name;
      const el = document.getElementById("portal-user");
      if (el) el.textContent = emp.name;
    }
  }
  if (!document.getElementById("view-public").classList.contains("hidden")) {
    renderPublic();
  }
  if (
    session &&
    !document.getElementById("view-portal").classList.contains("hidden")
  ) {
    if (activeTab === "Employees" && viewingEmployeeId) {
      if (db.employees.find((e) => e.id === viewingEmployeeId))
        openEmployeeDetail(viewingEmployeeId);
      else {
        viewingEmployeeId = null;
        renderPortalBody();
      }
    } else {
      renderPortalBody();
    }
  }
  applyingRemoteUpdate = false;
}

function newId(prefix) {
  return prefix + Math.random().toString(36).slice(2, 9);
}
// Time-off requests hold a date RANGE (startDate/endDate). Older records
// only had a single `date` field — this falls back gracefully so nothing
// existing breaks.
function reqDateRange(r) {
  const startDate = r.startDate || r.date;
  const endDate = r.endDate || r.date || r.startDate;
  return { startDate, endDate };
}
function fmtReqDateRange(r) {
  const { startDate, endDate } = reqDateRange(r);
  return startDate === endDate ? startDate : `${startDate} → ${endDate}`;
}
function reqCoversDate(r, dateISO) {
  const { startDate, endDate } = reqDateRange(r);
  return startDate <= dateISO && dateISO <= endDate;
}

/* Role picker: a select of existing roles plus a "+ Add new role…" option that
   reveals a text field. Used identically on Add Employee and the employee
   detail page, so any custom role typed in either place is saved to
   db.roles and immediately available everywhere else. */
function roleSelectHTML(prefix, currentRole) {
  const opts = db.roles
    .map(
      (r) =>
        `<option value="${r}" ${
          r === currentRole ? "selected" : ""
        }>${r}</option>`
    )
    .join("");
  const noRolesYet = db.roles.length === 0;
  return `<select id="${prefix}-role-select" onchange="toggleNewRoleInput('${prefix}')">${opts}<option value="__new__" ${
    noRolesYet ? "selected" : ""
  }>+ Add new role…</option></select>
    <input type="text" id="${prefix}-role-new" class="${
    noRolesYet ? "" : "hidden"
  }" placeholder="New role name" style="margin-top:6px">`;
}
function toggleNewRoleInput(prefix) {
  const sel = document.getElementById(`${prefix}-role-select`);
  const inp = document.getElementById(`${prefix}-role-new`);
  inp.classList.toggle("hidden", sel.value !== "__new__");
  if (sel.value === "__new__") inp.focus();
}
function resolveRole(prefix) {
  const sel = document.getElementById(`${prefix}-role-select`);
  if (sel.value === "__new__") {
    const val = document.getElementById(`${prefix}-role-new`).value.trim();
    if (val && !db.roles.includes(val)) {
      db.roles.push(val);
      fsdb
        .collection("roles")
        .doc(val)
        .set({})
        .catch((err) => console.error("Save role failed:", err));
    }
    return val || "General";
  }
  return sel.value;
}

function blankMenuTemplate() {
  const t = {};
  db.deliBoxes.forEach((b) => {
    t[b.id] = { price: "", notes: "", items: [] };
  });
  return t;
}
function weeklyMenu(weekKey) {
  if (!db.weeklyMenus[weekKey]) {
    const keys = Object.keys(db.weeklyMenus).sort();
    const prev = keys.length ? db.weeklyMenus[keys[keys.length - 1]] : null;
    const base = prev ? JSON.parse(JSON.stringify(prev)) : blankMenuTemplate();
    db.deliBoxes.forEach((b) => {
      if (!base[b.id]) base[b.id] = { price: "", notes: "", items: [] };
    });
    db.weeklyMenus[weekKey] = base;
  }
  return db.weeklyMenus[weekKey];
}
// Saves one week+box's menu data to its own composite document — this is
// the actual atomic unit of the deli menu now, so editing one box in one
// week can never touch any other week or box.
function saveDeliWeeklyMenuDoc(weekKey, boxId) {
  const data = weeklyMenu(weekKey)[boxId];
  if (!data) return;
  fsdb
    .collection("deliWeeklyMenus")
    .doc(`${weekKey}__${boxId}`)
    .set({ price: data.price, notes: data.notes, items: data.items })
    .catch((err) => console.error("Save deli menu failed:", err));
}
// When items are added/removed for a given week+box, every already-generated
// future week mirrors that change. Past weeks are never touched.
function cascadeDeliChangeForward(weekKey, boxId) {
  const items = weeklyMenu(weekKey)[boxId].items.slice();
  Object.keys(db.weeklyMenus)
    .filter((k) => k > weekKey)
    .sort()
    .forEach((k) => {
      if (db.weeklyMenus[k][boxId]) {
        db.weeklyMenus[k][boxId].items = items.slice();
        saveDeliWeeklyMenuDoc(k, boxId);
      }
    });
}

function monthSoupMenu(monthKey) {
  if (!db.soupMenu[monthKey]) db.soupMenu[monthKey] = {};
  return db.soupMenu[monthKey];
}

/* ---------------------------- SESSION ---------------------------- */
let session = null; // {isMaster, employeeId, name}
let activeTab = "Expirations";
let expSubView = "items"; // 'items' | 'categories' (master only)
let viewingEmployeeId = null; // set while an employee detail sub-view is open

/* expirations carousel state */
let catDayOffset = {}; // catId -> integer days from today
let catSearchTerm = {}; // catId -> string, used by the category search modal
let catDateFilter = {}; // catId -> ISO date string, used by the category search modal
let soupListSearchTerm = "";
let soupListDietFilter = { df: false, gf: false, v: false };
let soupPickerDietFilter = { df: false, gf: false, v: false };
function matchesDietFilter(soup, filter) {
  if (filter.df && !soup.df) return false;
  if (filter.gf && !soup.gf) return false;
  if (filter.v && !soup.v) return false;
  return true;
}
function updateSoupListDietFilter(key, val) {
  soupListDietFilter[key] = val;
  renderPortalBody();
}
function updateSoupPickerDietFilter(dateISO, key, val) {
  soupPickerDietFilter[key] = val;
  openSoupDayPicker(
    dateISO,
    document.getElementById("soup-filter")
      ? document.getElementById("soup-filter").value
      : ""
  );
}

/* public + admin carousel offsets */
let publicDeliWeekOffset = 0;
let deliAdminWeekOffset = 0;
let publicSoupMonthOffset = 0;
let soupAdminMonthOffset = 0;
let scheduleWeekOffset = 0;

let activeScanReader = null;

/* ---------------------------- ROUTER ---------------------------- */
function showView(id) {
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

/* ============================================================
   PUBLIC PAGE RENDER
   ============================================================ */
function renderPublic() {
  publicDeliWeekOffset = 0;
  publicSoupMonthOffset = 0;
  renderDeliPanel();
  renderSoupPanel();
  renderProduceList("produce-list", false);
}

function diettags(o) {
  let out = "";
  if (o.df) out += '<span class="tag tag-df" title="Dairy Free"></span>';
  if (o.gf) out += '<span class="tag tag-gf" title="Gluten Free"></span>';
  if (o.v) out += '<span class="tag tag-v" title="Vegetarian"></span>';
  return out;
}
function soupSizePriceLabel() {
  const priced = (db.soupSizes || []).filter((s) => s.price);
  return priced.length
    ? priced.map((s) => `${s.name} $${s.price}`).join(" · ")
    : "";
}

/* ---- Deli (public) ---- */
function renderDeliPanel() {
  const monday = addDays(
    startOfWeekMonday(new Date()),
    publicDeliWeekOffset * 7
  );
  document.getElementById("deli-week-range").textContent = fmtWeekRange(monday);
  document
    .getElementById("deli-today-btn")
    .classList.toggle("hidden", publicDeliWeekOffset === 0);
  renderDeliGrid(monday);
}
function renderDeliGrid(monday) {
  const weekKey = weekKeyOf(monday);
  const menu = weeklyMenu(weekKey);

  const soupRows = ["MON", "TUE", "WED", "THU", "FRI"]
    .map((label, i) => {
      const date = addDays(monday, i);
      const dateISO = isoDate(date);
      const mk = `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
      const mm = monthSoupMenu(mk);
      const sid = mm[dateISO];
      const soup = db.soups.find((s) => s.id === sid);
      const clickAttrs =
        soup && !soup.soldOut && soupIsAddable(dateISO)
          ? ` style="cursor:pointer" onclick="quickAddSoup('${dateISO}','${label}','${soup.id}')"`
          : "";
      const soldOutTag =
        soup && soup.soldOut
          ? ' <span class="sold-out-tag">Sold Out</span>'
          : "";
      return `<div class="soup-day-row"${clickAttrs}><span class="dow">${label}</span><span>${
        soup ? soup.name + " " + diettags(soup) + soldOutTag : "—"
      }</span></div>`;
    })
    .join("");

  function box(boxDef) {
    const data = menu[boxDef.id];
    const list = db.deliItemLists[boxDef.id] || [];
    if (!data) return "";
    const items = data.items
      .map((id) => {
        const item = list.find((l) => l.id === id);
        if (!item) return "";
        const itemPrice =
          boxDef.individualPricing && item.price
            ? `<span class="price">$${item.price}</span>`
            : "";
        if (item.soldOut) {
          return `<div class="deli-item sold-out-item"><div class="deli-item-name">${
            item.name
          } ${diettags(
            item
          )} ${itemPrice} <span class="sold-out-tag">Sold Out</span></div><div class="deli-item-desc">${
            item.desc
          }</div></div>`;
        }
        return `<div class="deli-item" style="cursor:pointer" onclick="quickAddToCart('${
          item.id
        }')"><div class="deli-item-name">${item.name} ${diettags(
          item
        )} ${itemPrice}</div><div class="deli-item-desc">${
          item.desc
        }</div></div>`;
      })
      .join("");
    const headerPrice =
      !boxDef.individualPricing && data.price
        ? `<span class="price">$${data.price}</span>`
        : "";
    return `<div class="deli-box"><h3>${boxDef.title} ${headerPrice}</h3>${
      items || '<p class="empty-note">Nothing on the menu this week.</p>'
    }${data.notes ? `<div class="deli-notes">${data.notes}</div>` : ""}</div>`;
  }
  function customOrderBoxHTML(type) {
    const price =
      type === "panini"
        ? db.settings.customPaniniPrice
        : db.settings.customSaladPrice;
    const title = type === "panini" ? "Custom Panini" : "Custom Salad";
    return `<div class="deli-box"><h3>${title} ${
      price ? `<span class="price">$${price}</span>` : ""
    }</h3>
      <p class="empty-note">Build your own from our custom bar.</p>
      <button class="btn small" onclick="openCustomBuilderModal('${type}')">Customize</button>
    </div>`;
  }

  const activeBoxes = db.deliBoxes.filter((b) => b.active);
  const mid = Math.ceil(activeBoxes.length / 2) || 1;
  const colA = activeBoxes.slice(0, mid),
    colB = activeBoxes.slice(mid);

  document.getElementById("deli-grid").innerHTML = `
    <div class="deli-col">
      <div class="deli-box"><h3>Soups ${
        soupSizePriceLabel()
          ? `<span class="price">${soupSizePriceLabel()}</span>`
          : ""
      }</h3>${soupRows}</div>
      ${colA.map(box).join("")}
    </div>
    <div class="deli-col">
      ${colB.map(box).join("")}
      ${customOrderBoxHTML("panini")}
      ${customOrderBoxHTML("salad")}
    </div>`;
}

/* ============================================================
   CUSTOMER ORDERING — cart, custom panini/salad builder, checkout.
   Orders write straight to Firestore (same open-access pattern as the
   rest of this app) and staff see them show up live on the Orders tab.
   ============================================================ */
let orderCart = [];
let customBuilderState = null; // { type:'panini'|'salad', selections:[...], note }

// There is exactly one open ordering week at any moment — it rolls forward
// automatically the instant Saturday 2pm passes (that's when the kitchen
// crew wraps up for the week and the next week's prep planning begins).
// No manual toggle, no "only on Sundays" special case — this fully
// replaces that older system.
function currentOrderWeekMonday() {
  const now = new Date();
  const thisMonday = startOfWeekMonday(now);
  const rollover = addDays(thisMonday, 5); // Saturday of this week
  rollover.setHours(14, 0, 0, 0);
  if (now >= rollover) return addDays(thisMonday, 7);
  return thisMonday;
}

function openPlaceOrderModal() {
  renderPlaceOrderModal();
}
function renderPlaceOrderModal() {
  rerenderModalPreservingScroll(_renderPlaceOrderModal);
}
function _renderPlaceOrderModal() {
  const monday = currentOrderWeekMonday();
  const weekKey = weekKeyOf(monday);
  const menu = weeklyMenu(weekKey);
  const boxes = db.deliBoxes.filter((b) => b.active);
  openModal(`<h3>Place an Order</h3>
    <p style="font-size:12.5px;color:var(--ink-soft);margin-top:-4px">Ordering for pickup ${fmtWeekRange(
      monday
    )}</p>
    <div class="modal-actions" style="justify-content:flex-start;flex-wrap:wrap;margin-bottom:10px">
      <button class="btn small outline" onclick="openSoupOrderModal()">+ Soup</button>
      <button class="btn small outline" onclick="openCustomBuilderModal('panini')">+ Custom Panini</button>
      <button class="btn small outline" onclick="openCustomBuilderModal('salad')">+ Custom Salad</button>
      <button class="btn small outline" onclick="openCoffeeOrderModal(true)">+ Coffee Bar</button>
    </div>
    <div class="search-panel-list" style="max-height:280px">
      ${
        boxes
          .map((box) => {
            const data = menu[box.id];
            const list = db.deliItemLists[box.id] || [];
            if (!data || !data.items.length) return "";
            const boxPrice =
              !box.individualPricing && data.price ? ` — $${data.price}` : "";
            return (
              `<div style="padding:8px 4px 2px;font-weight:600;font-size:13px;color:var(--brown-light)">${box.title}${boxPrice}</div>` +
              data.items
                .map((id) => {
                  const item = list.find((l) => l.id === id);
                  if (!item) return "";
                  const itemPrice =
                    box.individualPricing && item.price
                      ? ` <span style="color:var(--terracotta);font-size:12px">$${item.price}</span>`
                      : "";
                  if (item.soldOut) {
                    return `<div class="search-panel-row" style="display:flex;justify-content:space-between;align-items:center;opacity:0.6">
                <span>${item.name} ${diettags(item)}${itemPrice}</span>
                <span style="color:var(--red-flag);font-size:12px;font-weight:700">Sold Out</span>
              </div>`;
                  }
                  return `<div class="search-panel-row" style="display:flex;justify-content:space-between;align-items:center">
              <span>${item.name} ${diettags(item)}${itemPrice}</span>
              <button class="btn small" onclick="addToOrderCart('${
                item.id
              }')">+ Add</button>
            </div>`;
                })
                .join("")
            );
          })
          .join("") ||
        '<div class="search-panel-row">No menu items this week.</div>'
      }
    </div>
    ${orderCartSummaryHTML()}
    <div class="modal-actions">
      <button class="btn outline" onclick="closeModal()">Cancel</button>
      <button class="btn" ${
        orderCart.length === 0 ? "disabled" : ""
      } onclick="openOrderCheckoutModal()">Checkout (${
    orderCart.length
  })</button>
    </div>`);
}
function cartLineLabel(line) {
  if (line.kind === "menu" || line.kind === "soup" || line.kind === "coffee")
    return line.name;
  return `Custom ${line.customType === "panini" ? "Panini" : "Salad"} (${(
    line.selections || []
  )
    .map((s) => s.item)
    .join(", ")})`;
}
function orderCartSummaryHTML() {
  if (!orderCart.length) return "";
  return `<div style="margin-top:12px;border-top:1px solid var(--line);padding-top:10px">
    <h4 style="margin:0 0 6px">Your Cart</h4>
    ${orderCart
      .map(
        (
          line,
          i
        ) => `<div style="border-bottom:1px dashed var(--line);padding:6px 0">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <span style="flex:1;font-size:13.5px">${cartLineLabel(line)}</span>
        <input type="number" min="1" value="${
          line.qty
        }" style="width:46px" onchange="updateCartQty(${i},this.value)">
        <button class="btn small danger" onclick="removeCartLine(${i})">✕</button>
      </div>
      <input type="text" placeholder="Note for this item (optional)" value="${escHtmlAttr(
        line.note || ""
      )}" style="width:100%;margin-top:4px;padding:6px 8px;font-size:12.5px;border:1px solid var(--line);border-radius:6px;background:var(--cream)" onchange="updateCartNote(${i},this.value)">
    </div>`
      )
      .join("")}
  </div>`;
}
function addItemToCartCore(itemId) {
  const box = db.deliBoxes.find((b) =>
    (db.deliItemLists[b.id] || []).some((i) => i.id === itemId)
  );
  const item = box
    ? (db.deliItemLists[box.id] || []).find((i) => i.id === itemId)
    : null;
  if (!item || item.soldOut) return null;
  const existing = orderCart.find(
    (l) => l.kind === "menu" && l.itemId === itemId
  );
  if (existing) existing.qty++;
  else
    orderCart.push({
      kind: "menu",
      itemId,
      name: `${box.title}: ${item.name}`,
      boxTitle: box.title,
      followsPaniniRules: !!box.followsPaniniRules,
      qty: 1,
      note: "",
    });
  return item;
}
// Called from inside the "Place an Order" modal.
function addToOrderCart(itemId) {
  addItemToCartCore(itemId);
  renderPlaceOrderModal();
  renderPublicCartWidget();
}
// Called from clicking an item directly on the public menu — same cart,
// no modal involved, just updates the persistent cart widget.
// Customers can only add items from the single currently-open ordering
// week (see currentOrderWeekMonday) — browsing a different week on the
// public grid doesn't make it orderable.
function isOrderableDeliWeekOffset(offset) {
  const browsedMonday = addDays(startOfWeekMonday(new Date()), offset * 7);
  const openMonday = currentOrderWeekMonday();
  return isoDate(browsedMonday) === isoDate(openMonday);
}
function showWrongDeliWeekNotice() {
  openModal(`<h3>That Menu Isn't Orderable Right Now</h3>
    <p style="color:var(--ink-soft)">You're browsing a different week than what's currently open for ordering. Please switch to this week's menu to add items to your cart.</p>
    <div class="modal-actions"><button class="btn" onclick="closeModal();publicDeliWeekOffset=0;renderDeliPanel();">Go to This Week's Menu</button></div>`);
}
function quickAddToCart(itemId) {
  if (!isOrderableDeliWeekOffset(publicDeliWeekOffset)) {
    showWrongDeliWeekNotice();
    return;
  }
  const item = addItemToCartCore(itemId);
  if (item) renderPublicCartWidget();
}
function updateCartQty(idx, val) {
  const q = parseInt(val, 10);
  if (q > 0) orderCart[idx].qty = q;
  renderPlaceOrderModal();
  renderPublicCartWidget();
}
function updateCartNote(idx, val) {
  orderCart[idx].note = val;
}
function removeCartLine(idx) {
  orderCart.splice(idx, 1);
  renderPlaceOrderModal();
  renderPublicCartWidget();
}
// The persistent cart widget shown at the top of the public page — an
// alternative to the "Place Order" modal flow; both read/write the exact
// same `orderCart`, so items added either way always show up in both.
function renderPublicCartWidget() {
  const el = document.getElementById("public-cart-widget");
  if (!el) return;
  if (!orderCart.length) {
    el.innerHTML = "";
    el.classList.add("hidden");
    return;
  }
  el.classList.remove("hidden");
  el.innerHTML = `<div class="public-cart-box">
    <h4>🛒 Your Cart (${orderCart.length})</h4>
    ${orderCart
      .map(
        (line, i) => `<div class="public-cart-line-wrap">
      <div class="public-cart-line">
        <span>${cartLineLabel(line)}</span>
        <input type="number" min="1" value="${
          line.qty
        }" onchange="updatePublicCartQty(${i},this.value)">
        <button class="btn small danger" onclick="removePublicCartLine(${i})">✕</button>
      </div>
      <input type="text" class="public-cart-note" placeholder="Note for this item (optional)" value="${escHtmlAttr(
        line.note || ""
      )}" onchange="updateCartNote(${i},this.value)">
    </div>`
      )
      .join("")}
    <button class="btn small outline" onclick="openCoffeeOrderModal(false)">+ Add Coffee</button>
    <button class="btn small" onclick="openOrderCheckoutModal()">Checkout</button>
  </div>`;
}
function updatePublicCartQty(idx, val) {
  const q = parseInt(val, 10);
  if (q > 0) orderCart[idx].qty = q;
  renderPublicCartWidget();
}
function removePublicCartLine(idx) {
  orderCart.splice(idx, 1);
  renderPublicCartWidget();
}

/* ---- Coffee Bar ordering ---- */
// true when opened from inside the Place Order modal (so "Done"/adding an
// item returns there instead of just closing) — false when opened directly
// from the homepage button or the cart widget's "+ Add Coffee".
let coffeeReturnToPlaceOrder = false;
let coffeeFlowState = null; // { itemId, selectedAddons }
function openCoffeeOrderModal(returnToPlaceOrder) {
  coffeeReturnToPlaceOrder = !!returnToPlaceOrder;
  const hot = db.coffeeItems.filter((i) => i.category === "hot");
  const cold = db.coffeeItems.filter((i) => i.category === "cold");
  const backAction = coffeeReturnToPlaceOrder
    ? "renderPlaceOrderModal()"
    : "closeModal()";
  openModal(`<h3>Coffee Bar</h3>
    <div class="search-panel-list" style="max-height:320px">
      ${
        hot.length
          ? `<div style="padding:8px 4px 2px;font-weight:600;font-size:13px;color:var(--brown-light)">Hot Items</div>${hot
              .map(coffeeItemPickerRowHTML)
              .join("")}`
          : ""
      }
      ${
        cold.length
          ? `<div style="padding:8px 4px 2px;font-weight:600;font-size:13px;color:var(--brown-light)">Cold Items</div>${cold
              .map(coffeeItemPickerRowHTML)
              .join("")}`
          : ""
      }
      ${
        !hot.length && !cold.length
          ? '<div class="search-panel-row">No coffee items available right now.</div>'
          : ""
      }
    </div>
    <div class="modal-actions"><button class="btn outline" onclick="${backAction}">${
    coffeeReturnToPlaceOrder ? "Back to Order" : "Close"
  }</button></div>`);
}
function coffeeItemPickerRowHTML(item) {
  return `<div class="search-panel-row" style="display:flex;justify-content:space-between;align-items:center">
    <span>${item.name}${item.price ? ` — $${item.price}` : ""}</span>
    <button class="btn small" onclick="openCoffeeItemAddonPicker('${
      item.id
    }')">+ Add</button>
  </div>`;
}
function openCoffeeItemAddonPicker(itemId) {
  const item = db.coffeeItems.find((i) => i.id === itemId);
  if (!item) return;
  const addons = (item.addonIds || [])
    .map((id) => db.coffeeAddons.find((a) => a.id === id))
    .filter(Boolean);
  const needsMilk = !!item.takesMilk && db.coffeeMilks.length > 0;
  const availableFlavors = db.coffeeFlavors.filter((f) =>
    (item.flavorCategoryIds || []).includes(f.categoryId)
  );
  if (!addons.length && !needsMilk && !availableFlavors.length) {
    addCoffeeToCart(itemId, {}, "", []);
    return;
  }
  coffeeFlowState = {
    itemId,
    addonQuantities: {},
    milkId: needsMilk ? db.coffeeMilks[0].id : "",
    selectedFlavorIds: [],
  };
  renderCoffeeAddonPicker();
}
function renderCoffeeAddonPicker() {
  const item = db.coffeeItems.find((i) => i.id === coffeeFlowState.itemId);
  if (!item) {
    openCoffeeOrderModal(coffeeReturnToPlaceOrder);
    return;
  }
  const addons = (item.addonIds || [])
    .map((id) => db.coffeeAddons.find((a) => a.id === id))
    .filter(Boolean);
  const needsMilk = !!item.takesMilk && db.coffeeMilks.length > 0;
  // Only the flavor CATEGORIES this item is assigned to, and only if they
  // actually have flavors in them — matches hot/cold naturally since each
  // item is already one or the other with its own specific assignments.
  const flavorCats = db.coffeeFlavorCategories.filter(
    (c) =>
      (item.flavorCategoryIds || []).includes(c.id) &&
      db.coffeeFlavors.some((f) => f.categoryId === c.id)
  );
  openModal(`<h3>${item.name}</h3>
    ${
      needsMilk
        ? `<div class="field"><label>Milk</label><select id="coffee-milk-select" onchange="coffeeFlowState.milkId=this.value">
      ${db.coffeeMilks
        .map(
          (m) =>
            `<option value="${m.id}" ${
              coffeeFlowState.milkId === m.id ? "selected" : ""
            }>${m.name}${m.price ? ` (+$${m.price})` : ""}</option>`
        )
        .join("")}
    </select></div>`
        : ""
    }
    ${
      flavorCats.length
        ? `<div style="margin-top:${needsMilk ? "12px" : "0"}">
      <p style="font-size:12.5px;color:var(--ink-soft);margin-bottom:4px">Flavors:</p>
      ${flavorCats
        .map((cat) => {
          const flavors = db.coffeeFlavors.filter(
            (f) => f.categoryId === cat.id
          );
          return `<div style="margin-bottom:8px">
          <span style="font-size:12px;font-weight:600;color:var(--brown-light)">${
            cat.name
          }</span>
          ${flavors
            .map((f) => {
              const picked = coffeeFlowState.selectedFlavorIds.includes(f.id);
              return `<label style="display:block;font-size:13px;margin:2px 0 2px 8px"><input type="checkbox" ${
                picked ? "checked" : ""
              } onchange="toggleCoffeeFlavor('${f.id}')"> ${f.name}</label>`;
            })
            .join("")}
        </div>`;
        })
        .join("")}
    </div>`
        : ""
    }
    ${
      addons.length
        ? `<p style="font-size:12.5px;color:var(--ink-soft);margin-top:${
            needsMilk || flavorCats.length ? "12px" : "0"
          }">Add-ons:</p>
    ${addons
      .map((a) => {
        const qty = coffeeFlowState.addonQuantities[a.id] || 0;
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0">
        <span>${a.name}${a.price ? ` (+$${a.price} each)` : ""}</span>
        <span style="display:flex;align-items:center;gap:8px">
          <button class="btn small outline" onclick="adjustCoffeeAddonQty('${
            a.id
          }',-1)">−</button>
          <span style="min-width:16px;text-align:center">${qty}</span>
          <button class="btn small outline" onclick="adjustCoffeeAddonQty('${
            a.id
          }',1)">+</button>
        </span>
      </div>`;
      })
      .join("")}`
        : ""
    }
    <div class="modal-actions">
      <button class="btn outline" onclick="openCoffeeOrderModal(coffeeReturnToPlaceOrder)">Cancel</button>
      <button class="btn" onclick="addCoffeeToCart('${
        item.id
      }', coffeeFlowState.addonQuantities, coffeeFlowState.milkId, coffeeFlowState.selectedFlavorIds)">Add to Cart</button>
    </div>`);
}
function toggleCoffeeFlavor(flavorId) {
  const idx = coffeeFlowState.selectedFlavorIds.indexOf(flavorId);
  if (idx >= 0) coffeeFlowState.selectedFlavorIds.splice(idx, 1);
  else coffeeFlowState.selectedFlavorIds.push(flavorId);
  renderCoffeeAddonPicker();
}
function adjustCoffeeAddonQty(addonId, delta) {
  const cur = coffeeFlowState.addonQuantities[addonId] || 0;
  const next = Math.max(0, cur + delta);
  if (next === 0) delete coffeeFlowState.addonQuantities[addonId];
  else coffeeFlowState.addonQuantities[addonId] = next;
  renderCoffeeAddonPicker();
}
function addCoffeeToCart(itemId, addonQuantities, milkId, flavorIds) {
  const item = db.coffeeItems.find((i) => i.id === itemId);
  if (!item) return;
  const addonParts = Object.entries(addonQuantities || {})
    .map(([id, qty]) => {
      const a = db.coffeeAddons.find((x) => x.id === id);
      if (!a || !qty) return null;
      return qty > 1 ? `${a.name} x${qty}` : a.name;
    })
    .filter(Boolean);
  const milk = milkId ? db.coffeeMilks.find((m) => m.id === milkId) : null;
  const flavorNames = (flavorIds || [])
    .map((id) => db.coffeeFlavors.find((f) => f.id === id))
    .filter(Boolean)
    .map((f) => f.name);
  const extras = [...(milk ? [milk.name] : []), ...flavorNames, ...addonParts];
  const label = `${item.category === "hot" ? "Hot" : "Cold"}: ${item.name}${
    extras.length ? ` (${extras.join(", ")})` : ""
  }`;
  orderCart.push({
    kind: "coffee",
    name: label,
    itemId,
    addonQuantities: { ...(addonQuantities || {}) },
    milkId: milkId || "",
    flavorIds: [...(flavorIds || [])],
    qty: 1,
    note: "",
  });
  coffeeFlowState = null;
  renderPublicCartWidget();
  if (coffeeReturnToPlaceOrder) renderPlaceOrderModal();
  else closeModal();
}

function openSoupOrderModal() {
  const monday = currentOrderWeekMonday();
  const options = [];
  for (let i = 0; i < 5; i++) {
    const date = addDays(monday, i);
    const dateISO = isoDate(date);
    if (!soupIsAddable(dateISO)) continue; // never offer a day that's already passed, or today's soup after 2pm
    const mk = `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
    const mm = monthSoupMenu(mk);
    const sid = mm[dateISO];
    const soup = db.soups.find((s) => s.id === sid);
    if (soup && !soup.soldOut)
      options.push({ dateISO, dayLabel: DAY_KEYS[i], soup });
  }
  openModal(`<h3>Add Soup</h3>
    <p style="font-size:12px;color:var(--ink-soft)">Each soup is only pickupable on or after the day it's made.</p>
    <div class="search-panel-list" style="max-height:300px">
      ${
        options.length
          ? options
              .map(
                (o) => `
        <div style="padding:8px 4px 2px;font-weight:600;font-size:13px;color:var(--brown-light)">${
          o.dayLabel
        } ${fmtShort(new Date(o.dateISO + "T00:00"))} — ${
                  o.soup.name
                } ${diettags(o.soup)}</div>
        ${
          db.soupSizes.length
            ? db.soupSizes
                .map(
                  (
                    sz
                  ) => `<div class="search-panel-row" style="display:flex;justify-content:space-between;align-items:center">
          <span>${sz.name}${sz.price ? ` — $${sz.price}` : ""}</span>
          <button class="btn small" onclick="addSoupToCart('${o.dateISO}','${
                    o.dayLabel
                  }','${escAttr(o.soup.name)}','${escAttr(sz.name)}','${
                    sz.price || ""
                  }')">+ Add</button>
        </div>`
                )
                .join("")
            : `<div class="search-panel-row"><span>Add to order</span><button class="btn small" onclick="addSoupToCart('${
                o.dateISO
              }','${o.dayLabel}','${escAttr(
                o.soup.name
              )}','','')">+ Add</button></div>`
        }
      `
              )
              .join("")
          : '<div class="search-panel-row">No upcoming soups on the calendar right now.</div>'
      }
    </div>
    <div class="modal-actions"><button class="btn outline" onclick="renderPlaceOrderModal()">Back to Order</button></div>`);
}
function addSoupToCartCore(dateISO, dayLabel, soupName, sizeName, price) {
  const label = `${soupName}${
    sizeName ? ` (${sizeName})` : ""
  } — ${dayLabel}'s soup`;
  orderCart.push({ kind: "soup", name: label, day: dateISO, qty: 1, note: "" });
}
// Called from the "+ Soup" picker inside the Place Order modal.
function addSoupToCart(dateISO, dayLabel, soupName, sizeName, price) {
  addSoupToCartCore(dateISO, dayLabel, soupName, sizeName, price);
  renderPlaceOrderModal();
  renderPublicCartWidget();
}
// Called from clicking a soup directly on the public homepage — same cart,
// but shouldn't force-open the Place Order modal if it isn't already open.
function quickAddSoupWithSize(dateISO, dayLabel, soupName, sizeName, price) {
  addSoupToCartCore(dateISO, dayLabel, soupName, sizeName, price);
  closeModal();
  renderPublicCartWidget();
}
// Clicking a soup on the homepage — shows the size picker (or adds
// directly if no sizes are configured).
function quickAddSoup(dateISO, dayLabel, soupId) {
  if (!isOrderableDeliWeekOffset(publicDeliWeekOffset)) {
    showWrongDeliWeekNotice();
    return;
  }
  const soup = db.soups.find((s) => s.id === soupId);
  if (!soup) return;
  if (soup.soldOut) {
    alert("Sorry, that soup is sold out right now.");
    return;
  }
  if (!soupIsAddable(dateISO)) {
    alert(
      "That soup isn't available to order anymore — please refresh the page to see what's currently offered."
    );
    return;
  }
  if (!db.soupSizes.length) {
    addSoupToCartCore(dateISO, dayLabel, soup.name, "", "");
    renderPublicCartWidget();
    return;
  }
  openModal(`<h3>${soup.name} — ${dayLabel}</h3>
    <p style="font-size:13px;color:var(--ink-soft)">Choose a size:</p>
    <div class="search-panel-list">
      ${db.soupSizes
        .map(
          (
            sz
          ) => `<div class="search-panel-row" style="display:flex;justify-content:space-between;align-items:center">
        <span>${sz.name}${sz.price ? ` — $${sz.price}` : ""}</span>
        <button class="btn small" onclick="quickAddSoupWithSize('${dateISO}','${dayLabel}','${escAttr(
            soup.name
          )}','${escAttr(sz.name)}','${sz.price || ""}')">+ Add</button>
      </div>`
        )
        .join("")}
    </div>
    <div class="modal-actions"><button class="btn outline" onclick="closeModal()">Cancel</button></div>`);
}
function openCustomBuilderModal(type) {
  customBuilderState = { type, selections: [], note: "" };
  renderCustomBuilderModal();
}
function renderCustomBuilderModal() {
  rerenderModalPreservingScroll(_renderCustomBuilderModal);
}
function _renderCustomBuilderModal() {
  const type = customBuilderState.type;
  const boxes = db.customBarBoxes.filter((b) => b[type]);
  openModal(`<h3>Build Your Custom ${
    type === "panini" ? "Panini" : "Salad"
  }</h3>
    <div class="search-panel-list" style="max-height:280px">
      ${
        boxes
          .map((box) => {
            const items = db.customBarItems.filter(
              (i) => i.boxId === box.id && i[type]
            );
            if (!items.length) return "";
            return (
              `<div style="padding:8px 4px 2px;font-weight:600;font-size:13px;color:var(--brown-light)">${box.title}</div>` +
              items
                .map((item) => {
                  const picked = customBuilderState.selections.some(
                    (s) => s.itemId === item.id
                  );
                  return `<div class="search-panel-row" style="display:flex;justify-content:space-between;align-items:center">
              <span>${item.name}${
                    item.upcharge
                      ? ` <span style="color:var(--terracotta);font-size:12px">+$${item.upcharge}</span>`
                      : ""
                  }</span>
              <button class="btn small ${
                picked ? "" : "outline"
              }" onclick="toggleCustomSelection('${box.id}','${item.id}')">${
                    picked
                      ? type === "salad"
                        ? "🥗 Added"
                        : "✓ Added"
                      : "+ Add"
                  }</button>
            </div>`;
                })
                .join("")
            );
          })
          .join("") ||
        '<div class="search-panel-row">Nothing available right now.</div>'
      }
    </div>
    <div class="field" style="margin-top:10px"><label>Note (optional)</label><input type="text" id="custom-builder-note" value="${escHtmlAttr(
      customBuilderState.note
    )}" onchange="customBuilderState.note=this.value"></div>
    <div class="modal-actions">
      <button class="btn outline" onclick="renderPlaceOrderModal()">Cancel</button>
      <button class="btn" ${
        customBuilderState.selections.length === 0 ? "disabled" : ""
      } onclick="addCustomToCart()">Add to Cart</button>
    </div>`);
}
function toggleCustomSelection(boxId, itemId) {
  const box = db.customBarBoxes.find((b) => b.id === boxId);
  const item = db.customBarItems.find((i) => i.id === itemId);
  if (!box || !item) return;
  const idx = customBuilderState.selections.findIndex(
    (s) => s.itemId === itemId
  );
  if (idx >= 0) customBuilderState.selections.splice(idx, 1);
  else
    customBuilderState.selections.push({
      boxId,
      box: box.title,
      itemId,
      item: item.name,
      upcharge: parseFloat(item.upcharge) || 0,
    });
  renderCustomBuilderModal();
}
function addCustomToCart() {
  const totalUpcharge = customBuilderState.selections.reduce(
    (sum, s) => sum + (s.upcharge || 0),
    0
  );
  orderCart.push({
    kind: "custom",
    customType: customBuilderState.type,
    selections: customBuilderState.selections.map((s) => ({
      box: s.box,
      item: s.item,
    })),
    upcharge: totalUpcharge,
    note: customBuilderState.note,
    qty: 1,
  });
  customBuilderState = null;
  renderPlaceOrderModal();
  renderPublicCartWidget();
}

function openOrderCheckoutModal() {
  const monday = currentOrderWeekMonday();
  const weekMin = isoDate(monday);
  const weekMax = isoDate(addDays(monday, 6));
  openModal(`<h3>Checkout</h3>
    <div class="field"><label>Name</label><input type="text" id="ord-name"></div>
    <div class="field"><label>Phone</label><input type="tel" id="ord-phone"></div>
    <div class="field"><label>Pickup Date</label><input type="date" id="ord-date" min="${weekMin}" max="${weekMax}"></div>
    <div class="field"><label>Pickup Time</label><input type="time" id="ord-time"></div>
    <div class="modal-actions">
      <button class="btn outline" onclick="renderPlaceOrderModal()">← Back to Cart</button>
      <button class="btn" onclick="submitOrder('${weekMin}','${weekMax}')">Place Order</button>
    </div>`);
}
// Store pickup hours: Mon-Fri 9am-6pm, Sat 9am-2pm, closed Sunday. Same-day
// pickup must be ordered before 4pm. Custom Panini/Salad orders are further
// restricted to an 11am-2pm pickup window on top of the above.
function validatePickup(dateISO, timeStr, needsPaniniWindow) {
  if (isStoreClosedOn(dateISO))
    return "We're closed that day — please choose a different pickup date.";
  const d = new Date(dateISO + "T00:00");
  const dow = d.getDay(); // 0=Sun..6=Sat
  if (dow === 0)
    return "We're closed Sundays for pickup — please choose a Monday through Saturday date.";
  const [h, m] = timeStr.split(":").map(Number);
  const minutes = h * 60 + m;

  // Store pickup hours — same for every item type. The constraint on WHICH
  // items can be ordered when is entirely about staff prep windows below,
  // not about when the customer can walk in.
  if (dow === 6) {
    if (minutes < 9 * 60 || minutes > 14 * 60)
      return "Saturday pickup hours are 9:00 AM to 2:00 PM.";
  } else {
    if (minutes < 9 * 60 || minutes > 18 * 60)
      return "Pickup hours are 9:00 AM to 6:00 PM, Monday through Friday.";
  }

  const isToday = dateISO === todayISO();
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowDow = now.getDay();

  if (needsPaniniWindow) {
    // Custom Panini/Salad, our featured panini, AND soup all share this
    // window now — staffed 11am-2pm, Monday through Friday only, never
    // made fresh on Saturday. A Saturday pickup is still allowed (it's
    // just held over from Friday's batch), but since nothing gets made
    // that day, the order has to have been placed by Friday 2pm — the
    // last real chance for the kitchen to make it in time.
    if (dow === 6) {
      if (nowDow === 6)
        return "Panini, Custom Salad, and Soup orders for Saturday pickup have to be placed by Friday at 2:00 PM — that window has already passed for this Saturday. Please choose a weekday pickup instead.";
      if (nowDow === 5 && nowMinutes >= 14 * 60)
        return "Panini, Custom Salad, and Soup orders for Saturday pickup have to be placed by Friday at 2:00 PM.";
    } else {
      if (minutes < 11 * 60)
        return "Panini, Custom Salad, and Soup pickups need to be 11:00 AM or later — that's when our kitchen has them ready.";
      if (isToday && nowMinutes >= 14 * 60) {
        return "Panini, Custom Salad, and Soup orders for today have to be placed before 2:00 PM — that's when the kitchen wraps that station up for the day. You can still order now for pickup tomorrow or later.";
      }
    }
  } else {
    // Kitchen preps everything else 9am-4pm weekdays, 9am-2pm Saturday.
    if (isToday) {
      const prepCloses = dow === 6 ? 14 * 60 : 16 * 60;
      if (nowMinutes >= prepCloses) {
        return `Same-day orders need to be placed before ${
          dow === 6 ? "2:00 PM" : "4:00 PM"
        } — that's when our kitchen wraps up prep for the day. You can still order now for pickup another day.`;
      }
    }
  }
  return null;
}
function submitOrder(weekMin, weekMax) {
  const name = document.getElementById("ord-name").value.trim();
  const phone = document.getElementById("ord-phone").value.trim();
  const date = document.getElementById("ord-date").value;
  const time = document.getElementById("ord-time").value;
  console.log(time);
  if (!name || !phone || !date || !time) {
    alert("Please fill in your name, phone, pickup date, and pickup time.");
    return;
  }
  if (date < weekMin || date > weekMax) {
    alert(
      `Pickup has to be between ${weekMin} and ${weekMax} for this order — that's the week this menu covers. Please pick a date in that range.`
    );
    return;
  }
  const needsPaniniWindow = orderCart.some(
    (l) =>
      l.kind === "custom" ||
      l.kind === "soup" ||
      (l.kind === "menu" && l.followsPaniniRules)
  );
  const pickupError = validatePickup(date, time, needsPaniniWindow);
  if (pickupError) {
    alert(pickupError);
    return;
  }
  const earlySoup = orderCart.find(
    (l) => l.kind === "soup" && l.day && date < l.day
  );
  if (earlySoup) {
    const soupDate = new Date(earlySoup.day + "T00:00");
    const dayName = soupDate.toLocaleDateString("en-US", { weekday: "long" });
    alert(
      `${
        earlySoup.name
      } won't be ready until ${dayName} at 9:00 AM at the earliest — it hasn't been made yet. Either change your pickup date to ${dayName} (${fmtShort(
        soupDate
      )}) or later, or remove that soup from this order and place a separate order for it closer to ${dayName}.`
    );
    return;
  }
  const monday = currentOrderWeekMonday();
  const weekKey = weekKeyOf(monday);
  const order = {
    customerName: name,
    customerPhone: phone,
    pickupDate: date,
    pickupTime: time,
    weekKey,
    items: orderCart.map((l) => ({ ...l })),
    status: "incomplete",
    submittedAt: new Date().toISOString(),
    autoprinted: false,
  };
  const id = newId("o");
  fsdb
    .collection("orders")
    .doc(id)
    .set(order)
    .catch((err) => console.error("Save order failed:", err));
  orderCart = [];
  closeModal();
  renderPublicCartWidget();
  showOrderConfirmation();
}
function showOrderConfirmation() {
  openModal(`<div style="text-align:center;padding:10px 0">
    <div style="font-size:44px;margin-bottom:6px">🥗</div>
    <h3>Your Order's In!</h3>
    <p style="color:var(--ink-soft)">Your order has been planted and is sprouting in our kitchen. We'll have it fresh and ready at your pickup time!</p>
    <div class="modal-actions" style="justify-content:center"><button class="btn" onclick="closeModal()">Sounds Good</button></div>
  </div>`);
  fireConfetti();
}
// Small, purely decorative burst of veggie/fruit/leaf emoji — no library,
// just a handful of absolutely-positioned spans with a CSS fall animation,
// removed from the DOM once it's finished.
function fireConfetti() {
  const emojis = ["🥕", "🥬", "🍅", "🍓", "🌽", "🫑", "🍇", "🥒", "🍆"];
  const container = document.createElement("div");
  container.className = "confetti-burst";
  for (let i = 0; i < 22; i++) {
    const span = document.createElement("span");
    span.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    span.style.left = 50 + (Math.random() * 70 - 35) + "%";
    span.style.animationDelay = Math.random() * 0.15 + "s";
    span.style.animationDuration = 1.1 + Math.random() * 0.6 + "s";
    span.style.setProperty("--rot", Math.random() * 360 + "deg");
    container.appendChild(span);
  }
  document.body.appendChild(container);
  setTimeout(() => container.remove(), 2200);
}

/* ---- Soup (public) ---- */
function dowHeaderHTML(showWeekends) {
  const days = showWeekends
    ? ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
    : ["MON", "TUE", "WED", "THU", "FRI"];
  return days.map((d) => `<span>${d}</span>`).join("");
}
function renderSoupPanel() {
  const base = new Date();
  base.setDate(1);
  base.setMonth(base.getMonth() + publicSoupMonthOffset);
  const monthKey = `${base.getFullYear()}-${pad(base.getMonth() + 1)}`;
  document.getElementById("soup-month-title").textContent = `${
    MONTHS[base.getMonth()]
  } ${base.getFullYear()}`;
  document
    .getElementById("soup-today-btn")
    .classList.toggle("hidden", publicSoupMonthOffset === 0);
  const sw = db.settings.showWeekendsSoup;
  const dowEl = document.getElementById("soup-cal-dow");
  dowEl.className = `soup-cal-dow cols-${sw ? 7 : 5}`;
  dowEl.innerHTML = dowHeaderHTML(sw);
  const calEl = document.getElementById("soup-cal");
  calEl.className = `soup-cal cols-${sw ? 7 : 5}`;
  calEl.innerHTML = buildSoupCalHTML(monthKey, sw, false); // never show Source publicly
}
// Downloadable .ics file for the month currently being viewed — one all-day
// event per scheduled soup. Both Apple Calendar and Google Calendar can
// import a standard .ics file directly, so one export covers either choice.
function escapeICS(str) {
  return (str || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}
function exportSoupMenuICS() {
  const base = new Date();
  base.setDate(1);
  base.setMonth(base.getMonth() + publicSoupMonthOffset);
  const monthKey = `${base.getFullYear()}-${pad(base.getMonth() + 1)}`;
  const mm = monthSoupMenu(monthKey);
  const dates = Object.keys(mm).sort();
  if (!dates.length) {
    alert("No soups are scheduled for this month yet.");
    return;
  }
  const now = new Date();
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
    now.getDate()
  )}T${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}Z`;
  let ics =
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Grounded Natural Foods//Soup Menu//EN\r\nCALSCALE:GREGORIAN\r\n";
  dates.forEach((dateISO) => {
    const soup = db.soups.find((s) => s.id === mm[dateISO]);
    if (!soup) return;
    const dtstart = dateISO.replace(/-/g, "");
    const dtend = isoDate(addDays(new Date(dateISO + "T00:00"), 1)).replace(
      /-/g,
      ""
    );
    const tags = [
      soup.df ? "Dairy Free" : "",
      soup.gf ? "Gluten Free" : "",
      soup.v ? "Vegetarian" : "",
    ]
      .filter(Boolean)
      .join(", ");
    ics += "BEGIN:VEVENT\r\n";
    ics += `UID:soup-${dateISO}@groundedmarket.com\r\n`;
    ics += `DTSTAMP:${stamp}\r\n`;
    ics += `DTSTART;VALUE=DATE:${dtstart}\r\n`;
    ics += `DTEND;VALUE=DATE:${dtend}\r\n`;
    ics += `SUMMARY:${escapeICS(soup.name + " Soup")}\r\n`;
    if (tags) ics += `DESCRIPTION:${escapeICS(tags)}\r\n`;
    ics += `LOCATION:${escapeICS(
      "Grounded Natural Foods, 435 S US HWY 231, Jasper IN"
    )}\r\n`;
    ics += "END:VEVENT\r\n";
  });
  ics += "END:VCALENDAR\r\n";
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `grounded-soup-menu-${MONTHS[
    base.getMonth()
  ].toLowerCase()}-${base.getFullYear()}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// canSeeSoupSource — Source is a master/Kitchen-staff-only detail, never shown
// to customers or to employees in other roles.
function canSeeSoupSource() {
  if (!session) return false;
  if (session.isMaster) return true;
  const emp = db.employees.find((e) => e.id === session.employeeId);
  return !!(emp && (emp.role === "Kitchen" || emp.role === "Kitchen & Floor"));
}
function buildSoupCalHTML(monthKey, showWeekends, showSource) {
  const [y, m] = monthKey.split("-").map(Number);
  const last = new Date(y, m, 0);
  const mm = monthSoupMenu(monthKey);
  let cells = "";
  let leadingPlaced = false;
  for (let d = 1; d <= last.getDate(); d++) {
    const date = new Date(y, m - 1, d);
    let dow = date.getDay();
    dow = dow === 0 ? 6 : dow - 1; // 0=Mon..6=Sun
    if (!showWeekends && dow >= 5) continue; // skip Sat/Sun entirely
    if (!leadingPlaced) {
      for (let i = 0; i < dow; i++)
        cells += `<div class="soup-cell empty"></div>`;
      leadingPlaced = true;
    }
    const iso = isoDate(date);
    const soup = db.soups.find((s) => s.id === mm[iso]);
    cells += `<div class="soup-cell" data-date="${iso}">
      <div class="d">${d}</div>
      ${
        soup
          ? `<div class="s-name">${
              soup.name
            }</div><div class="s-tags">${diettags(soup)}</div>${
              showSource && soup.source
                ? `<div class="s-source">${soup.source}</div>`
                : ""
            }`
          : ""
      }
    </div>`;
  }
  return cells;
}

function renderProduceList(targetId, editable) {
  const wrap = document.getElementById(targetId);
  if (!db.produceDeals.length) {
    wrap.innerHTML = '<p class="empty-note">No current deals.</p>';
    return;
  }
  wrap.innerHTML = db.produceDeals
    .map(
      (p) => `
    <div class="produce-row">
      <div class="produce-left">
        <span class="produce-name">${p.name}</span>
        <span class="${
          p.organic ? "produce-organic" : "produce-conventional"
        }">${p.organic ? "Organic" : "Conventional"}</span>
      </div>
      <span class="price-tag">$${p.price} / ${p.unit}</span>
      ${
        p.img
          ? `<img class="produce-img" src="${p.img}" alt="${p.name}">`
          : editable
          ? ""
          : "<span></span>"
      }
      ${
        editable
          ? `<span><button class="btn small outline" onclick="editProduceDeal('${p.id}')">Edit</button> <button class="btn small danger" onclick="deleteProduceDeal('${p.id}')">Delete</button></span>`
          : ""
      }
    </div>`
    )
    .join("");
}

/* ============================================================
   AUTH
   ============================================================ */
async function attemptLogin() {
  const u = document.getElementById("login-username").value.trim();
  const p = document.getElementById("login-password").value;
  const errEl = document.getElementById("login-error");
  const btn = document.getElementById("login-submit-btn");
  if (!u || !p) {
    errEl.classList.remove("hidden");
    return;
  }
  btn.disabled = true;
  btn.textContent = "Signing in…";
  try {
    await fbauth.signInWithEmailAndPassword(toStaffEmail(u), p);
    // Reload so the whole app boots cleanly in staff mode — every Firestore
    // listener re-attaches with the new (authorized) identity. Instant on a
    // static site, and far more robust than re-binding everything live.
    location.reload();
  } catch (err) {
    console.error("Login failed:", err);
    errEl.classList.remove("hidden");
    btn.disabled = false;
    btn.textContent = "Log In";
    // Fall back to the anonymous customer identity so the public site keeps working
    if (!fbauth.currentUser) fbauth.signInAnonymously().catch(() => {});
  }
}
// Builds the in-app session from the signed-in user's server-set role claim.
async function buildSessionFromAuthUser(user) {
  const token = await user.getIdTokenResult();
  const role = token.claims.role;
  if (role === "master") {
    session = { isMaster: true, name: "Gordon (Master)" };
    return true;
  }
  if (role === "display") {
    session = {
      isMaster: false,
      isDisplay: true,
      employeeId: null,
      name: "Orders Terminal",
    };
    return true;
  }
  if (role === "employee") {
    const empId = token.claims.employeeId;
    const emp = db.employees.find((e) => e.id === empId);
    session = {
      isMaster: false,
      employeeId: empId,
      name: emp ? emp.name : "…",
    };
    return true;
  }
  return false; // anonymous customer — no portal session
}
document.getElementById("login-form").addEventListener("submit", (e) => {
  e.preventDefault();
  attemptLogin();
});
document.getElementById("login-submit-btn").addEventListener("click", (e) => {
  e.preventDefault();
  attemptLogin();
});

function enterPortal() {
  activeTab = session.isDisplay
    ? "Orders"
    : session.isMaster
    ? "Scheduling"
    : "Schedule";
  expSubView = "items";
  document.getElementById("portal-user").textContent = session.name;
  renderPortalTabs();
  updatePortalStickyState();
  renderPortalBody();
  showView("view-portal");
}

function logout() {
  fbauth.signOut().finally(() => location.reload());
}

/* ============================================================
   PORTAL SHELL
   ============================================================ */
function renderPortalTabs() {
  let tabs;
  if (session.isDisplay) {
    tabs = [
      "Orders",
      "Schedule",
      "Expirations",
      "Soup Menu",
      "Recipes",
      "Chat",
    ];
  } else if (session.isMaster) {
    tabs = [
      "Scheduling",
      "Employees",
      "Expirations",
      "Orders",
      "Deli Menu",
      "Coffee Bar",
      "Soup Menu",
      "Custom Bar",
      "Produce Deals",
      "Recipes",
      "Chat",
    ];
  } else {
    tabs = ["Schedule", "Expirations", "Orders", "Chat"];
    const emp = db.employees.find((e) => e.id === session.employeeId);
    if (emp && (emp.role === "Kitchen" || emp.role === "Kitchen & Floor"))
      tabs.splice(3, 0, "Soup Menu");
  }
  document.getElementById("portal-tabs").innerHTML = tabs
    .map(
      (t) =>
        `<button class="portal-tab ${
          t === activeTab ? "active" : ""
        }" data-tab="${t}">${t}</button>`
    )
    .join("");
}

function updatePortalStickyState() {
  const sub = document.getElementById("portal-exp-subheader");
  const catBtn = document.getElementById("categories-quick-btn");
  if (activeTab === "Expirations") {
    sub.classList.remove("hidden");
    catBtn.classList.toggle("hidden", !session.isMaster);
    catBtn.textContent =
      expSubView === "categories" ? "← Back to Items" : "Categories";
  } else {
    sub.classList.add("hidden");
  }
}

function setTab(t) {
  activeTab = t;
  expSubView = "items";
  viewingEmployeeId = null;
  recipesView = { binderId: null, searchTerm: "" };
  ordersViewMode = "all";
  renderPortalTabs();
  updatePortalStickyState();
  renderPortalBody();
}

function renderPortalBody() {
  const el = document.getElementById("portal-body");
  updatePortalStickyState();
  switch (activeTab) {
    case "Expirations":
      el.innerHTML =
        expSubView === "categories" && session.isMaster
          ? categoriesHTML()
          : expirationsHTML();
      break;
    case "Deli Menu":
      el.innerHTML = deliMenuAdminHTML();
      break;
    case "Custom Bar":
      el.innerHTML = customBarHTML();
      break;
    case "Coffee Bar":
      el.innerHTML = coffeeBarHTML();
      break;
    case "Recipes":
      el.innerHTML = recipesHTML();
      break;
    case "Orders":
      el.innerHTML = ordersTabHTML();
      break;
    case "Soup Menu":
      el.innerHTML = soupMenuAdminHTML();
      break;
    case "Produce Deals":
      el.innerHTML = produceAdminHTML();
      renderProduceList("produce-admin-list", true);
      break;
    case "Employees":
      el.innerHTML = employeesHTML();
      break;
    case "Scheduling":
    case "Schedule":
      el.innerHTML = scheduleHTML();
      break;
    case "Chat":
      el.innerHTML = chatHTML();
      renderChatMessages();
      break;
    default:
      el.innerHTML = "";
  }
  scheduleSave();
}

/* ============================================================
   MODALS
   ============================================================ */
function openModal(html) {
  document.getElementById("modal-root").innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this) closeModal()">
      <div class="modal-box">
        <button class="modal-close" onclick="closeModal()">✕</button>
        ${html}
      </div>
    </div>`;
}
function closeModal() {
  stopScan();
  document.getElementById("modal-root").innerHTML = "";
}

/* ============================================================
   EXPIRATION TRACKER
   ============================================================ */
// A synthetic "category" that always appears at the top of Expirations,
// showing any item whose categoryId doesn't match a real category anymore
// (e.g. the category it belonged to was deleted). Reuses the normal
// category box UI below — categoryItems() special-cases this id.
const UNCATEGORIZED_ID = "__uncategorized__";
const UNCATEGORIZED_CAT = {
  id: UNCATEGORIZED_ID,
  emoji: "❓",
  name: "Uncategorized",
};
const MARKDOWN_ID = "__markdown__";
const MARKDOWN_CAT = { id: MARKDOWN_ID, emoji: "🏷️", name: "Markdown" };
function categoryItems(catId) {
  if (catId === UNCATEGORIZED_ID) {
    const validIds = new Set(db.categories.map((c) => c.id));
    return db.expirationItems
      .filter((i) => !validIds.has(i.categoryId))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  if (catId === MARKDOWN_ID) {
    return db.expirationItems
      .filter((i) => i.flagged)
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  return db.expirationItems
    .filter((i) => i.categoryId === catId)
    .sort((a, b) => a.date.localeCompare(b.date));
}
function expItemLabel(i) {
  return `${i.brand} | ${i.description} | ${i.upc} <span class="pill">×${i.count}</span>`;
}
// Uncategorized and Markdown are reorderable right alongside real categories
// (master's request) — their positions live in `settings` (two small
// numbers) since they're not real Firestore category records. This builds
// the full sorted list — used both for rendering the Expirations tab and
// for the Categories management screen's reorder buttons.
function combinedCategoryList() {
  const uncatOrder =
    db.settings.uncategorizedOrder != null
      ? db.settings.uncategorizedOrder
      : -2;
  const mdOrder =
    db.settings.markdownOrder != null ? db.settings.markdownOrder : -1;
  const list = [
    { ...UNCATEGORIZED_CAT, special: "uncategorized", order: uncatOrder },
    { ...MARKDOWN_CAT, special: "markdown", order: mdOrder },
    ...db.categories,
  ];
  return list.sort(
    (a, b) => (a.order != null ? a.order : 0) - (b.order != null ? b.order : 0)
  );
}
function moveCategoryOrSpecial(id, direction) {
  const list = combinedCategoryList();
  const idx = list.findIndex((c) => c.id === id);
  const swapIdx = idx + direction;
  if (idx < 0 || swapIdx < 0 || swapIdx >= list.length) return;
  const tmp = list[idx];
  list[idx] = list[swapIdx];
  list[swapIdx] = tmp;
  const batch = fsdb.batch();
  let settingsChanged = false;
  list.forEach((entry, i) => {
    if (entry.id === UNCATEGORIZED_ID) {
      db.settings.uncategorizedOrder = i;
      settingsChanged = true;
    } else if (entry.id === MARKDOWN_ID) {
      db.settings.markdownOrder = i;
      settingsChanged = true;
    } else {
      const realCat = db.categories.find((c) => c.id === entry.id);
      if (realCat) realCat.order = i;
      batch.set(
        fsdb.collection("categories").doc(entry.id),
        { order: i },
        { merge: true }
      );
    }
  });
  batch
    .commit()
    .catch((err) => console.error("Update category order failed:", err));
  if (settingsChanged) scheduleSave();
  db.categories.sort(
    (a, b) => (a.order != null ? a.order : 0) - (b.order != null ? b.order : 0)
  );
  renderPortalBody();
}

function expirationsHTML() {
  const list = combinedCategoryList();
  let html = list.map((cat) => categoryBoxHTML(cat)).join("");
  html += expirationCalendarHTML();
  return html;
}

let expCalMonthOffset = 0;
function expirationCalendarHTML() {
  const base = new Date();
  base.setDate(1);
  base.setMonth(base.getMonth() + expCalMonthOffset);
  const monthKey = `${base.getFullYear()}-${pad(base.getMonth() + 1)}`;
  return `<h2 class="section-title" style="margin-top:26px">Expiration Calendar</h2>
    ${carouselNavHTML({
      prevLabel: "← Prev",
      nextLabel: "Next →",
      dateLabel: `${MONTHS[base.getMonth()]} ${base.getFullYear()}`,
      prevOnclick: "expCalMonthOffset--;renderPortalBody()",
      nextOnclick: "expCalMonthOffset++;renderPortalBody()",
      todayOnclick: "expCalMonthOffset=0;renderPortalBody()",
      showToday: expCalMonthOffset !== 0,
    })}
    <div class="soup-cal-dow cols-7">${dowHeaderHTML(true)}</div>
    <div class="soup-cal cols-7">${buildExpirationCalHTML(monthKey)}</div>`;
}
function buildExpirationCalHTML(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const last = new Date(y, m, 0);
  let cells = "";
  let leadingPlaced = false;
  for (let d = 1; d <= last.getDate(); d++) {
    const date = new Date(y, m - 1, d);
    let dow = date.getDay();
    dow = dow === 0 ? 6 : dow - 1;
    if (!leadingPlaced) {
      for (let i = 0; i < dow; i++)
        cells += `<div class="soup-cell empty"></div>`;
      leadingPlaced = true;
    }
    const iso = isoDate(date);
    const dayItems = db.expirationItems.filter((i) => i.date === iso);
    const total = dayItems.length;
    const doneCount = dayItems.filter((i) => i.done).length;
    const notDoneCount = total - doneCount;
    const flaggedCount = dayItems.filter((i) => i.flagged).length;
    cells += `<div class="soup-cell">
      <div class="d">${d}</div>
      ${
        total
          ? `<div class="exp-cal-count" onclick="openExpDayModal('${iso}')">${total}</div>`
          : ""
      }
      ${
        doneCount || notDoneCount || flaggedCount
          ? `<div class="exp-cal-subcounts">
        ${
          doneCount
            ? `<span class="exp-cal-done" onclick="event.stopPropagation();openExpDayModal('${iso}','done')">${doneCount}</span>`
            : ""
        }
        ${
          notDoneCount
            ? `<span class="exp-cal-notdone" onclick="event.stopPropagation();openExpDayModal('${iso}','notdone')">${notDoneCount}</span>`
            : ""
        }
        ${
          flaggedCount
            ? `<span class="exp-cal-flagged" onclick="event.stopPropagation();openExpDayModal('${iso}','flagged')">🚩${flaggedCount}</span>`
            : ""
        }
      </div>`
          : ""
      }
    </div>`;
  }
  return cells;
}
// Every item due on the tapped day, grouped by category (including
// Uncategorized and Markdown), optionally narrowed to just done/not-done/
// flagged items when clicked from one of the calendar's colored sub-counts.
function openExpDayModal(dateISO, filterMode) {
  let items = db.expirationItems.filter((i) => i.date === dateISO);
  let title = `Expiring ${dateISO}`;
  if (filterMode === "done") {
    items = items.filter((i) => i.done);
    title = `Checked Off — ${dateISO}`;
  } else if (filterMode === "notdone") {
    items = items.filter((i) => !i.done);
    title = `Not Checked Off — ${dateISO}`;
  } else if (filterMode === "flagged") {
    items = items.filter((i) => i.flagged);
    title = `Marked Down — ${dateISO}`;
  }
  const groups = {};
  items.forEach((i) => {
    const cat = db.categories.find((c) => c.id === i.categoryId);
    const key = cat ? cat.id : UNCATEGORIZED_ID;
    if (!groups[key])
      groups[key] = {
        label: cat
          ? `${cat.emoji} ${cat.name}`
          : `${UNCATEGORIZED_CAT.emoji} ${UNCATEGORIZED_CAT.name}`,
        items: [],
      };
    groups[key].items.push(i);
  });
  const keys = Object.keys(groups).sort((a, b) =>
    groups[a].label.localeCompare(groups[b].label)
  );
  openModal(`<h3>${title}</h3>
    <div class="search-panel-list" style="max-height:400px">
      ${
        keys.length
          ? keys
              .map(
                (k) => `
        <div style="padding:10px 4px 4px;font-weight:600;font-size:13px;color:var(--brown-light)">${
          groups[k].label
        }</div>
        ${groups[k].items
          .map(
            (i) =>
              `<div class="search-panel-row" style="display:block">${expItemRow(
                i,
                i.date < todayISO() && !i.done,
                true
              )}</div>`
          )
          .join("")}
      `
              )
              .join("")
          : '<div class="search-panel-row">No items.</div>'
      }
    </div>`);
}

function categoryBoxHTML(cat) {
  const items = categoryItems(cat.id);
  const overdue = items.filter((i) => i.date < todayISO() && !i.done);
  const offset = catDayOffset[cat.id] || 0;
  const viewDate = isoDate(addDays(new Date(), offset));
  const viewLabel =
    offset === 0 ? "Today" : new Date(viewDate + "T00:00").toDateString();

  let inner = "";
  if (overdue.length) {
    inner += `<div class="day-group"><div class="day-label" style="color:var(--red-flag)">PAST DUE</div>${overdue
      .map((i) => expItemRow(i, true, true))
      .join("")}</div>`;
  }

  const dayItems = items.filter((i) => i.date === viewDate);
  inner += carouselNavHTML({
    prevLabel: "← Prev Day",
    nextLabel: "Next Day →",
    dateLabel: viewLabel,
    prevOnclick: `catDayOffset['${cat.id}']=(catDayOffset['${cat.id}']||0)-1;renderPortalBody()`,
    nextOnclick: `catDayOffset['${cat.id}']=(catDayOffset['${cat.id}']||0)+1;renderPortalBody()`,
    todayOnclick: `catDayOffset['${cat.id}']=0;renderPortalBody()`,
    showToday: offset !== 0,
  });
  inner += `<div class="day-group">${
    dayItems.length
      ? dayItems.map((i) => expItemRow(i, false)).join("")
      : '<p class="empty-note">Nothing expiring this day.</p>'
  }</div>`;

  return `<div class="category-box" data-cat="${cat.id}">
    <div class="category-head">
      <h3>${cat.emoji} ${cat.name}</h3>
      <span style="display:flex;align-items:center;gap:10px">
        <span class="exp-count">${items.length} tracked</span>
        <button class="search-icon-btn" title="Search this category" onclick="openCategorySearchModal('${cat.id}')"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><line x1="15.3" y1="15.3" x2="21" y2="21"/></svg></button>
      </span>
    </div>
    <div style="padding:4px 18px 14px">${inner}</div>
  </div>`;
}

// Focused search for one category — keyword and/or date, sorted newest-first.
// Replaces the old inline "Show more (full list)" toggle with a lighter popup.
function openCategorySearchModal(catId, term) {
  if (term !== undefined) catSearchTerm[catId] = term;
  const cat =
    catId === UNCATEGORIZED_ID
      ? UNCATEGORIZED_CAT
      : catId === MARKDOWN_ID
      ? MARKDOWN_CAT
      : db.categories.find((c) => c.id === catId);
  const t = (catSearchTerm[catId] || "").toLowerCase();
  const dateVal = catDateFilter[catId] || "";
  const items = categoryItems(catId);
  const hasFilter = !!(t || dateVal);
  const filtered = hasFilter
    ? items
        .filter((i) => {
          const textOk =
            !t ||
            (i.brand + " " + i.description + " " + i.upc)
              .toLowerCase()
              .includes(t);
          const dateOk = !dateVal || i.date === dateVal;
          return textOk && dateOk;
        })
        .sort((a, b) => b.date.localeCompare(a.date))
    : [];
  openModal(`<h3>Search ${cat ? cat.emoji + " " + cat.name : "Category"}</h3>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <input type="text" id="cat-modal-search" style="flex:1;min-width:160px;margin:0;padding:9px 11px;border:1px solid var(--line);border-radius:8px;background:var(--cream)"
        placeholder="Search this category…" value="${escHtmlAttr(
          catSearchTerm[catId] || ""
        )}"
        oninput="const pos=this.selectionStart; openCategorySearchModal('${catId}', this.value); reFocusInput('cat-modal-search', pos);">
      <span style="display:flex;align-items:center;gap:5px">${DATE_FILTER_LABEL}<input type="date" id="cat-modal-date" style="margin:0;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--cream)"
        value="${dateVal}" onchange="catDateFilter['${catId}']=this.value; openCategorySearchModal('${catId}');"></span>
    </div>
    <div class="search-panel-list" style="max-height:360px">
      ${
        hasFilter
          ? filtered.length
            ? filtered
                .map(
                  (i) =>
                    `<div class="search-panel-row" style="display:block">${expItemRow(
                      i,
                      i.date < todayISO() && !i.done,
                      true
                    )}</div>`
                )
                .join("")
            : '<div class="search-panel-row">No matches.</div>'
          : '<div class="search-panel-row">Type a keyword or pick a date to search.</div>'
      }
    </div>`);
  setTimeout(() => {
    const el = document.getElementById("cat-modal-search");
    if (el) {
      el.focus();
      el.selectionStart = el.selectionEnd = el.value.length;
    }
  }, 0);
}

function expItemRow(item, overdue, showDate) {
  const classes = ["exp-item"];
  if (item.done) classes.push("done");
  if (overdue && !item.done) classes.push("overdue");
  const flagSvg = `<svg class="flag-icon ${
    item.flagged ? "flag-on" : "flag-off"
  }" viewBox="0 0 24 24"><path d="M6 3v18h2v-7h9l-1.5-3.5L17 7H8V3z"/></svg>`;
  const dateLabel = showDate
    ? `<span class="exp-date-label">${item.date}</span>`
    : "";
  return `<div class="${classes.join(" ")}">
    <button class="link-chain" title="Search image" onclick="searchImage('${
      item.upc
    }','${escAttr(item.brand)}','${escAttr(item.description)}')">🔗</button>
    <span class="exp-text" onclick="toggleDone('${
      item.id
    }')">${dateLabel}${expItemLabel(item)}</span>
    <button class="icon-edit-btn" title="Edit item" onclick="event.stopPropagation();openEditExpItem('${
      item.id
    }')">✎</button>
    <button class="flag-btn" title="Markdown flag" onclick="toggleFlag('${
      item.id
    }')">${flagSvg}</button>
  </div>`;
}

function openEditExpItem(id) {
  const i = db.expirationItems.find((x) => x.id === id);
  const hasMatch = db.categories.some((c) => c.id === i.categoryId);
  const catOptions =
    (hasMatch
      ? ""
      : '<option value="" selected disabled>— choose a category —</option>') +
    db.categories
      .map(
        (c) =>
          `<option value="${c.id}" ${c.id === i.categoryId ? "selected" : ""}>${
            c.emoji
          } ${c.name}</option>`
      )
      .join("");
  openModal(`<h3>Edit Item</h3>
    <div class="field"><label>Brand</label><input type="text" id="eex-brand" value="${escHtmlAttr(
      i.brand
    )}"></div>
    <div class="field"><label>Description</label><input type="text" id="eex-desc" value="${escHtmlAttr(
      i.description
    )}"></div>
    <div class="field"><label>UPC</label><input type="text" id="eex-upc" value="${escHtmlAttr(
      i.upc
    )}"></div>
    <div class="field"><label>Category</label><select id="eex-cat">${catOptions}</select></div>
    <div class="field"><label>Expiration date</label><input type="date" id="eex-date" value="${
      i.date
    }"></div>
    <div class="field"><label>Count on hand</label><input type="number" id="eex-count" min="1" value="${
      i.count
    }"></div>
    <p style="font-size:11.5px;color:var(--ink-soft)">Logged ${
      i.loggedDate || "—"
    }${session.isMaster ? ` · Added by ${i.addedBy || "—"}` : ""}</p>
    <div class="modal-actions" style="justify-content:space-between">
      <button class="btn danger" onclick="deleteExpItem('${id}')">Delete</button>
      <button class="btn" onclick="saveEditExpItem('${id}')">Save</button>
    </div>`);
}
function saveExpItemDoc(item) {
  const { id, ...rest } = item;
  fsdb
    .collection("expirationItems")
    .doc(id)
    .set(rest)
    .catch((err) => console.error("Save expiration item failed:", err));
}
function deleteExpItemDoc(id) {
  fsdb
    .collection("expirationItems")
    .doc(id)
    .delete()
    .catch((err) => console.error("Delete expiration item failed:", err));
}
function saveEditExpItem(id) {
  const i = db.expirationItems.find((x) => x.id === id);
  i.brand = document.getElementById("eex-brand").value.trim() || i.brand;
  i.description =
    document.getElementById("eex-desc").value.trim() || i.description;
  i.upc = document.getElementById("eex-upc").value.trim() || i.upc;
  i.categoryId = document.getElementById("eex-cat").value || i.categoryId;
  i.date = document.getElementById("eex-date").value || i.date;
  const count = parseInt(document.getElementById("eex-count").value, 10);
  if (count > 0) i.count = count;
  saveExpItemDoc(i);
  closeModal();
  renderPortalBody();
}
function deleteExpItem(id) {
  if (!confirm("Delete this expiration entry? This cannot be undone.")) return;
  db.expirationItems = db.expirationItems.filter((x) => x.id !== id);
  deleteExpItemDoc(id);
  closeModal();
  renderPortalBody();
}

function toggleDone(id) {
  const i = db.expirationItems.find((x) => x.id === id);
  const wasDone = i.done;
  i.done = !i.done;
  if (!wasDone && i.done) recordEmployeeStat("checked");
  saveExpItemDoc(i);
  renderPortalBody();
}
function escAttr(s) {
  return (s || "").replace(/'/g, "\\'");
}
// Short notes display as plain text under the shift time; longer ones would
// wrap and break the compact cell layout, so those show a small icon
// instead that opens the full note on tap.
const SCHED_NOTE_INLINE_MAX = 18;
function scheduleNoteHTML(notes) {
  if (!notes) return "";
  if (notes.length <= SCHED_NOTE_INLINE_MAX)
    return `<div class="sched-note-inline">${notes}</div>`;
  return `<button class="sched-note-btn" title="View note" onclick="event.stopPropagation();viewShiftNote('${escAttr(
    notes
  )}')"><svg viewBox="0 0 24 24"><path d="M6 3h9l5 5v13a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1z"/><path d="M14 3v5h5" fill="none" stroke-width="1.3"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="15.5" x2="16" y2="15.5"/></svg></button>`;
}
function viewShiftNote(note) {
  openModal(
    `<h3>Shift Note</h3><p style="white-space:pre-wrap">${note}</p><div class="modal-actions"><button class="btn" onclick="closeModal()">Close</button></div>`
  );
}
function searchImage(upc, brand, desc) {
  const q = encodeURIComponent(`${upc} ${brand} ${desc}`);
  window.open(`https://www.google.com/search?tbm=isch&q=${q}`, "_blank");
}
function toggleFlag(id) {
  const item = db.expirationItems.find((x) => x.id === id);
  if (!item.flagged) {
    openModal(`<h3>Mark down: ${item.description}</h3><p>How much longer should this item run?</p>
      <div class="modal-actions">
        <button class="btn" onclick="applyMarkdown('${id}',14)">+14 Days</button>
        <button class="btn" onclick="applyMarkdown('${id}',30)">+30 Days</button>
      </div>
      <div class="field" style="margin-top:14px">
        <label>Or enter a custom number of days</label>
        <div style="display:flex;gap:8px">
          <input type="number" id="custom-md-days" min="1" placeholder="e.g. 21" style="flex:1">
          <button class="btn outline" onclick="applyCustomMarkdown('${id}')">+Custom</button>
        </div>
      </div>`);
  } else {
    item.flagged = false;
    saveExpItemDoc(item);
    renderPortalBody();
  }
}
function applyCustomMarkdown(id) {
  const val = parseInt(document.getElementById("custom-md-days").value, 10);
  if (!val || val < 1) return;
  applyMarkdown(id, val);
}
function applyMarkdown(id, days) {
  const item = db.expirationItems.find((x) => x.id === id);
  const base = new Date(item.date + "T00:00");
  item.date = isoDate(addDays(base, days));
  item.flagged = true;
  saveExpItemDoc(item);
  closeModal();
  renderPortalBody();
}

/* --- Add item flow (barcode scan via ZXing — works in Safari/iOS, unlike BarcodeDetector) --- */
function addItemFlow() {
  const catOptions = db.categories
    .map((c) => `<option value="${c.id}">${c.emoji} ${c.name}</option>`)
    .join("");
  openModal(`
    <h3>Add Item</h3>
    <div id="scan-area">
      <button class="btn" id="start-scan-btn" onclick="startScan()">📷 Scan UPC</button>
      <p style="font-size:12.5px;color:var(--ink-soft);margin-top:8px">Uses your device camera. Works in Safari/iOS. Otherwise, enter details manually below.</p>
    </div>
    <form id="add-item-form" onsubmit="submitAddItem(event)">
      <div class="field"><label>UPC</label><input type="text" id="ai-upc" required></div>
      <div class="field"><label>Brand</label><input type="text" id="ai-brand" required></div>
      <div class="field"><label>Description</label><input type="text" id="ai-desc" required></div>
      <div class="field"><label>Count on hand</label><input type="number" id="ai-count" min="1" value="1" required></div>
      <div class="field"><label>Expiration date</label><input type="date" id="ai-date" required></div>
      <div class="field"><label>Category</label><select id="ai-cat">${catOptions}</select></div>
      <div class="modal-actions"><button type="submit" class="btn">Add Item</button></div>
    </form>`);
  document.getElementById("ai-upc").addEventListener("change", lookupUpc);
}

function lookupUpc() {
  const upc = document.getElementById("ai-upc").value.trim();
  if (!upc) return;
  if (db.localUpcDb[upc]) {
    document.getElementById("ai-brand").value = db.localUpcDb[upc].brand;
    document.getElementById("ai-desc").value = db.localUpcDb[upc].description;
    return;
  }
  fetch(`https://world.openfoodfacts.org/api/v2/product/${upc}.json`)
    .then((r) => r.json())
    .then((data) => {
      if (data && data.product) {
        document.getElementById("ai-brand").value = data.product.brands || "";
        document.getElementById("ai-desc").value =
          data.product.product_name || "";
      }
    })
    .catch(() => {
      /* fall back silently to manual entry */
    });
}

function startScan() {
  const area = document.getElementById("scan-area");
  if (typeof ZXing === "undefined") {
    alert("Barcode scanner didn't load. Enter the UPC manually below.");
    return;
  }
  area.innerHTML = `<video id="scan-video" style="width:100%;border-radius:8px;background:#000" muted playsinline autoplay></video>
    <p style="font-size:12px;color:var(--ink-soft);margin-top:6px">Point the camera at a barcode…</p>`;
  const codeReader = new ZXing.BrowserMultiFormatReader();
  activeScanReader = codeReader;
  codeReader
    .decodeFromConstraints(
      { video: { facingMode: "environment" } },
      "scan-video",
      (result, err) => {
        if (result) {
          const text = result.getText();
          stopScan();
          document.getElementById("ai-upc").value = text;
          lookupUpc();
          area.innerHTML = `<p style="color:var(--green-deep)">✓ UPC captured: ${text}</p>`;
        }
      }
    )
    .catch(() => {
      alert("Camera access was denied or unavailable. Enter the UPC manually.");
    });
}
function stopScan() {
  if (activeScanReader) {
    try {
      activeScanReader.reset();
    } catch (e) {}
    activeScanReader = null;
  }
}

function submitAddItem(e) {
  e.preventDefault();
  const upc = document.getElementById("ai-upc").value.trim();
  const brand = document.getElementById("ai-brand").value.trim();
  const desc = document.getElementById("ai-desc").value.trim();
  const count = parseInt(document.getElementById("ai-count").value, 10);
  const date = document.getElementById("ai-date").value;
  const categoryId = document.getElementById("ai-cat").value;

  db.localUpcDb[upc] = { brand, description: desc }; // save for next time
  if (upc)
    fsdb
      .collection("localUpcDb")
      .doc(upc)
      .set({ brand, description: desc })
      .catch((err) => console.error("Save UPC cache failed:", err));

  const dup = db.expirationItems.find((i) => i.upc === upc && i.date === date);
  if (dup) {
    closeModal();
    setTimeout(() => {
      openModal(`<h3>Possible duplicate</h3><p>${brand} — ${desc} already has an entry expiring ${date}. Add it anyway?</p>
        <div class="modal-actions"><button class="btn outline" onclick="closeModal()">Cancel</button>
        <button class="btn" onclick="finishAddItem('${upc}','${escAttr(
        brand
      )}','${escAttr(
        desc
      )}',${count},'${date}','${categoryId}')">Add Anyway</button></div>`);
    }, 50);
    return;
  }
  finishAddItem(upc, brand, desc, count, date, categoryId);
}
function finishAddItem(upc, brand, desc, count, date, categoryId) {
  const item = {
    id: newId("x"),
    categoryId,
    upc,
    brand,
    description: desc,
    count,
    date,
    done: false,
    flagged: false,
    loggedDate: todayISO(),
    addedBy: session.isMaster ? "Master" : session.name,
  };
  db.expirationItems.push(item);
  saveExpItemDoc(item);
  recordEmployeeStat("added");
  closeModal();
  openModal(
    `<h3>✓ Added</h3><p>${brand} — ${desc} was added to expirations.</p><div class="modal-actions"><button class="btn" onclick="closeModal();renderPortalBody();">Done</button></div>`
  );
}

/* ============================================================
   UPC BARCODE SCANNER (Expirations search) — reuses the same ZXing setup
   and activeScanReader/stopScan() pattern already used by the Add Item
   flow (ZXing is loaded once, synchronously, in index.html).
   ============================================================ */
function openBarcodeScanner() {
  openModal(`<h3>Scan Barcode</h3>
    <div id="scanner-status" style="font-size:12.5px;color:var(--ink-soft);margin-bottom:8px">Starting camera…</div>
    <video id="scanner-video" style="width:100%;border-radius:10px;background:#000" autoplay playsinline muted></video>
    <div class="modal-actions"><button class="btn outline" onclick="closeModal()">Cancel</button></div>`);
  if (typeof ZXing === "undefined") {
    document.getElementById("scanner-status").textContent =
      "Couldn't load the barcode scanner. Please type the UPC manually.";
    return;
  }
  document.getElementById("scanner-status").textContent =
    "Point the camera at a barcode…";
  const codeReader = new ZXing.BrowserMultiFormatReader();
  activeScanReader = codeReader;
  codeReader
    .decodeFromConstraints(
      { video: { facingMode: "environment" } },
      "scanner-video",
      (result, err) => {
        if (result) {
          const code = result.getText();
          stopScan();
          closeModal();
          document.getElementById("portal-search").value = code;
          portalSearch();
        }
        // fires repeatedly with a "not found" error on every frame with no
        // barcode in view — that's normal, only a real result should do anything
      }
    )
    .catch(() => {
      const el = document.getElementById("scanner-status");
      if (el)
        el.textContent =
          "Couldn't access the camera — check that camera permission is allowed for this site, or type the UPC manually.";
    });
}

function portalSearch() {
  const term = document
    .getElementById("portal-search")
    .value.trim()
    .toLowerCase();
  const dateVal = document.getElementById("portal-search-date").value;
  if (!term && !dateVal) {
    renderPortalBody();
    return;
  }
  const matches = db.expirationItems
    .filter((i) => {
      const cat = db.categories.find((c) => c.id === i.categoryId);
      const catName = cat ? cat.name.toLowerCase() : "";
      const textOk =
        !term ||
        i.brand.toLowerCase().includes(term) ||
        i.description.toLowerCase().includes(term) ||
        i.upc.includes(term) ||
        catName.includes(term);
      const dateOk = !dateVal || i.date === dateVal;
      return textOk && dateOk;
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  activeTab = "Expirations";
  expSubView = "items";
  renderPortalTabs();
  updatePortalStickyState();
  const label =
    term && dateVal
      ? `"${term}" on ${dateVal}`
      : term
      ? `"${term}"`
      : `expiring ${dateVal}`;
  const el = document.getElementById("portal-body");
  el.innerHTML =
    `<h2 class="section-title">Search results for ${label}</h2>` +
    (matches.length
      ? matches
          .map(
            (i) =>
              `<div class="card">${expItemRow(
                i,
                i.date < todayISO() && !i.done,
                true
              )}</div>`
          )
          .join("")
      : '<p class="empty-note">No matches.</p>');
}

/* ============================================================
   CATEGORIES (master only — nested inside Expirations tab)
   ============================================================ */
function categoriesHTML() {
  const list = combinedCategoryList();
  return `<h2 class="section-title">Categories <button class="btn" onclick="addCategoryFlow()">+ Add Category</button></h2>
    <p style="font-size:12.5px;color:var(--ink-soft);margin-bottom:10px">Use ↑ / ↓ to set the order categories appear in on the Expirations tab. Uncategorized and Markdown can be reordered too, but not renamed or deleted — they're built-in.</p>
    ${list
      .map(
        (
          c,
          i
        ) => `<div class="card" style="display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:18px">${c.emoji} ${c.name}</span>
      <span>
        <button class="btn small outline" onclick="moveCategoryOrSpecial('${
          c.id
        }',-1)" ${i === 0 ? "disabled" : ""}>↑</button>
        <button class="btn small outline" onclick="moveCategoryOrSpecial('${
          c.id
        }',1)" ${i === list.length - 1 ? "disabled" : ""}>↓</button>
        ${
          c.special
            ? ""
            : `<button class="btn small outline" onclick="editCategory('${c.id}')">Rename</button> <button class="btn small danger" onclick="deleteCategory('${c.id}')">Delete</button>`
        }
      </span>
    </div>`
      )
      .join("")}`;
}
// Swaps this category's `order` value with the adjacent one, same pattern
// as reordering employees.
// Shared reorder logic for any list that supports ↑/↓ (categories, deli
// boxes, employees). Reassigns a clean, sequential order (0,1,2...) to
// EVERY item in the list on every move — not just the two being swapped —
// so there's never a leftover unset order value that can collide with
// something else and produce inconsistent results later.
function reorderList(arr, id, direction, collectionName) {
  const idx = arr.findIndex((x) => x.id === id);
  const swapIdx = idx + direction;
  if (idx < 0 || swapIdx < 0 || swapIdx >= arr.length) return false;
  const tmp = arr[idx];
  arr[idx] = arr[swapIdx];
  arr[swapIdx] = tmp;
  const batch = fsdb.batch();
  arr.forEach((item, i) => {
    item.order = i;
    batch.set(
      fsdb.collection(collectionName).doc(item.id),
      { order: i },
      { merge: true }
    );
  });
  batch
    .commit()
    .catch((err) =>
      console.error(`Update ${collectionName} order failed:`, err)
    );
  return true;
}
function addCategoryFlow() {
  openModal(`<h3>Add Category</h3>
    <div class="field"><label>Emoji</label><input type="text" id="cat-emoji" maxlength="4" placeholder="🥫"></div>
    <div class="field"><label>Name</label><input type="text" id="cat-name" placeholder="Aisle 5 — Snacks"></div>
    <div class="modal-actions"><button class="btn" onclick="saveCategory()">Save</button></div>`);
}
function saveCategory() {
  const emoji = document.getElementById("cat-emoji").value.trim() || "📦";
  const name = document.getElementById("cat-name").value.trim();
  if (!name) return;
  const id = newId("c");
  const order =
    db.categories.reduce(
      (max, c) => Math.max(max, c.order != null ? c.order : 0),
      0
    ) + 1;
  db.categories.push({ id, emoji, name, order });
  fsdb
    .collection("categories")
    .doc(id)
    .set({ emoji, name, order })
    .catch((err) => console.error("Save category failed:", err));
  closeModal();
  renderPortalBody();
}
function editCategory(id) {
  const c = db.categories.find((x) => x.id === id);
  openModal(`<h3>Edit Category</h3>
    <div class="field"><label>Emoji</label><input type="text" id="cat-emoji" maxlength="4" value="${c.emoji}"></div>
    <div class="field"><label>Name</label><input type="text" id="cat-name" value="${c.name}"></div>
    <div class="modal-actions"><button class="btn" onclick="updateCategory('${id}')">Save</button></div>`);
}
function updateCategory(id) {
  const c = db.categories.find((x) => x.id === id);
  c.emoji = document.getElementById("cat-emoji").value.trim() || c.emoji;
  c.name = document.getElementById("cat-name").value.trim() || c.name;
  fsdb
    .collection("categories")
    .doc(id)
    .update({ emoji: c.emoji, name: c.name })
    .catch((err) => console.error("Update category failed:", err));
  closeModal();
  renderPortalBody();
}
function deleteCategory(id) {
  if (!confirm("Delete this category and unassign its items?")) return;
  db.categories = db.categories.filter((c) => c.id !== id);
  fsdb
    .collection("categories")
    .doc(id)
    .delete()
    .catch((err) => console.error("Delete category failed:", err));
  renderPortalBody();
}

/* ============================================================
   DELI MENU ADMIN (master only)
   ============================================================ */
function deliMenuAdminHTML() {
  const monday = addDays(
    startOfWeekMonday(new Date()),
    deliAdminWeekOffset * 7
  );
  const weekKey = weekKeyOf(monday);
  weeklyMenu(weekKey); // ensure it exists

  const boxes = db.deliBoxes;
  const mid = Math.ceil(boxes.length / 2) || 1;
  const colA = boxes.slice(0, mid),
    colB = boxes.slice(mid);

  return `<h2 class="section-title">Deli Menu <button class="btn small" onclick="addDeliBoxFlow()">+ Add Box</button></h2>
    ${carouselNavHTML({
      prevLabel: "← Prev",
      nextLabel: "Next →",
      dateLabel: fmtWeekRange(monday),
      prevOnclick: "deliAdminWeekOffset--;renderPortalBody()",
      nextOnclick: "deliAdminWeekOffset++;renderPortalBody()",
      todayOnclick: "deliAdminWeekOffset=0;renderPortalBody()",
      showToday: deliAdminWeekOffset !== 0,
    })}
    <p style="font-size:12.5px;color:var(--ink-soft);margin:10px 0">Adding or removing an item from a week's menu automatically carries that change forward into every future week you've already generated. Past weeks are never changed.</p>
    <div class="deli-grid">
      <div class="deli-col">${colA
        .map((b) => editorBox(weekKey, b.id))
        .join("")}</div>
      <div class="deli-col">${colB
        .map((b) => editorBox(weekKey, b.id))
        .join("")}</div>
    </div>`;
}

function editorBox(weekKey, boxId) {
  const boxDef = db.deliBoxes.find((b) => b.id === boxId);
  const list = db.deliItemLists[boxId] || [];
  const data = weeklyMenu(weekKey)[boxId];
  if (!boxDef || !data) return "";
  const idx = db.deliBoxes.findIndex((b) => b.id === boxId);
  const indiv = !!boxDef.individualPricing;
  return `<div class="card ${boxDef.active ? "" : "box-inactive"}">
      <h4>${boxDef.title}${boxDef.active ? "" : " (inactive)"} ${
    indiv
      ? ""
      : `<span class="price">$<input type="text" style="width:60px" value="${data.price}" onchange="updatePrice('${weekKey}','${boxId}',this.value)"></span>`
  }</h4>
      <label style="display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--ink-soft);margin-bottom:8px">
        <input type="checkbox" ${
          indiv ? "checked" : ""
        } onchange="toggleIndividualPricing('${boxId}',this.checked)"> Price items individually (instead of one price for the whole box)
      </label>
      <label style="display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--ink-soft);margin-bottom:8px">
        <input type="checkbox" ${
          boxDef.followsPaniniRules ? "checked" : ""
        } onchange="togglePaniniRules('${boxId}',this.checked)"> Follows Custom Panini prep rules (11am-2pm Mon-Fri only, never Saturday)
      </label>
      ${data.items
        .map((id) => {
          const item = list.find((l) => l.id === id);
          if (!item) return "";
          const priceInput = indiv
            ? `<span class="price">$<input type="text" style="width:50px" value="${
                item.price || ""
              }" onchange="updateDeliItemPrice('${boxId}','${id}',this.value)"></span>`
            : "";
          return `<div class="deli-item"><div class="deli-item-name">${
            item.name
          } ${diettags(
            item
          )} ${priceInput} <button class="btn small danger" style="margin-left:auto" onclick="removeMenuItem('${weekKey}','${boxId}','${id}')">Delete</button></div><div class="deli-item-desc">${
            item.desc
          }</div></div>`;
        })
        .join("")}
      <div style="margin-top:8px">
        <button class="btn small" onclick="openDeliItemPicker('${weekKey}','${boxId}')">+ Add Item (search)</button>
        <button class="btn small outline" onclick="manageDeliItemsFlow('${boxId}')">Manage Items</button>
      </div>
      <div class="field" style="margin-top:10px"><label>Notes shown to customers</label><textarea onchange="updateNotes('${weekKey}','${boxId}',this.value)">${
    data.notes
  }</textarea></div>
      <div class="box-admin-row" style="margin-top:10px;border-top:1px dashed var(--line);padding-top:10px">
        <button class="btn small outline" onclick="moveDeliBox('${boxId}',-1)" ${
    idx === 0 ? "disabled" : ""
  }>↑</button>
        <button class="btn small outline" onclick="moveDeliBox('${boxId}',1)" ${
    idx === db.deliBoxes.length - 1 ? "disabled" : ""
  }>↓</button>
        <button class="btn small outline" onclick="renameDeliBox('${boxId}')">Rename</button>
        <button class="btn small outline" onclick="toggleDeliBoxActive('${boxId}')">${
    boxDef.active ? "Deactivate" : "Reactivate"
  }</button>
        <button class="btn small danger" onclick="deleteDeliBox('${boxId}')">Delete Box</button>
      </div>
    </div>`;
}
function toggleIndividualPricing(boxId, val) {
  const b = db.deliBoxes.find((x) => x.id === boxId);
  b.individualPricing = val;
  fsdb
    .collection("deliBoxes")
    .doc(boxId)
    .update({ individualPricing: val })
    .catch((err) => console.error("Update box pricing mode failed:", err));
  renderPortalBody();
}
function togglePaniniRules(boxId, val) {
  const b = db.deliBoxes.find((x) => x.id === boxId);
  b.followsPaniniRules = val;
  fsdb
    .collection("deliBoxes")
    .doc(boxId)
    .update({ followsPaniniRules: val })
    .catch((err) => console.error("Update box panini rules failed:", err));
  renderPortalBody();
}
function updateDeliItemPrice(boxId, itemId, val) {
  const item = (db.deliItemLists[boxId] || []).find((i) => i.id === itemId);
  if (!item) return;
  item.price = val;
  fsdb
    .collection("deliItems")
    .doc(itemId)
    .update({ price: val })
    .catch((err) => console.error("Update item price failed:", err));
}
// Swaps this box's `order` value with the adjacent one, same pattern as
// reordering employees/categories.
function moveDeliBox(id, direction) {
  if (reorderList(db.deliBoxes, id, direction, "deliBoxes")) renderPortalBody();
}
function updatePrice(weekKey, boxId, val) {
  weeklyMenu(weekKey)[boxId].price = val;
  saveDeliWeeklyMenuDoc(weekKey, boxId);
}
function updateNotes(weekKey, boxId, val) {
  weeklyMenu(weekKey)[boxId].notes = val;
  saveDeliWeeklyMenuDoc(weekKey, boxId);
}

function openDeliItemPicker(weekKey, boxId) {
  renderDeliPickerModal(weekKey, boxId, "");
}
function renderDeliPickerModal(weekKey, boxId, term) {
  const list = db.deliItemLists[boxId] || [];
  const data = weeklyMenu(weekKey)[boxId];
  const t = term.toLowerCase();
  const options = list.filter(
    (i) =>
      !data.items.includes(i.id) && (!t || i.name.toLowerCase().includes(t))
  );
  openModal(`<h3>Add item to ${
    db.deliBoxes.find((b) => b.id === boxId).title
  }</h3>
    <div class="field"><input type="text" id="deli-pick-search" placeholder="Search items…" value="${escAttr(
      term
    )}" oninput="renderDeliPickerModal('${weekKey}','${boxId}', this.value)"></div>
    <div class="search-panel-list">${
      options.length
        ? options
            .map(
              (i) =>
                `<div class="search-panel-row" onclick="pickDeliItem('${weekKey}','${boxId}','${
                  i.id
                }')"><span>${i.name}</span>${diettags(i)}</div>`
            )
            .join("")
        : '<div class="search-panel-row">No matches.</div>'
    }</div>
    <div class="modal-actions"><button class="btn outline" onclick="newListItemFlow('${boxId}','${weekKey}')">+ New Item</button></div>`);
  setTimeout(() => {
    const el = document.getElementById("deli-pick-search");
    if (el) {
      el.focus();
      el.selectionStart = el.selectionEnd = el.value.length;
    }
  }, 0);
}
function pickDeliItem(weekKey, boxId, itemId) {
  const data = weeklyMenu(weekKey)[boxId];
  if (!data.items.includes(itemId)) data.items.push(itemId);
  saveDeliWeeklyMenuDoc(weekKey, boxId);
  cascadeDeliChangeForward(weekKey, boxId);
  closeModal();
  renderPortalBody();
}
function removeMenuItem(weekKey, boxId, id) {
  const data = weeklyMenu(weekKey)[boxId];
  data.items = data.items.filter((x) => x !== id);
  saveDeliWeeklyMenuDoc(weekKey, boxId);
  cascadeDeliChangeForward(weekKey, boxId);
  renderPortalBody();
}
function newListItemFlow(boxId, weekKey) {
  openModal(`<h3>New item</h3>
    <div class="field"><label>Name</label><input type="text" id="ni-name"></div>
    <div class="field"><label>Description</label><textarea id="ni-desc"></textarea></div>
    <div class="toggle-row">
      <label><input type="checkbox" id="ni-df"> Dairy Free</label>
      <label><input type="checkbox" id="ni-gf"> Gluten Free</label>
      <label><input type="checkbox" id="ni-v"> Vegetarian</label>
    </div>
    <div class="modal-actions"><button class="btn" onclick="saveNewListItem('${boxId}','${
    weekKey || ""
  }')">Save</button></div>`);
}
function saveNewListItem(boxId, weekKey) {
  const name = document.getElementById("ni-name").value.trim();
  if (!name) return;
  const id = newId("i");
  const item = {
    name,
    desc: document.getElementById("ni-desc").value.trim(),
    df: document.getElementById("ni-df").checked,
    gf: document.getElementById("ni-gf").checked,
    v: document.getElementById("ni-v").checked,
    img: "",
  };
  if (!db.deliItemLists[boxId]) db.deliItemLists[boxId] = [];
  db.deliItemLists[boxId].push({ id, ...item });
  fsdb
    .collection("deliItems")
    .doc(id)
    .set({ ...item, boxId })
    .catch((err) => console.error("Save deli item failed:", err));
  if (weekKey) {
    const data = weeklyMenu(weekKey)[boxId];
    data.items.push(id);
    saveDeliWeeklyMenuDoc(weekKey, boxId);
    cascadeDeliChangeForward(weekKey, boxId);
  }
  closeModal();
  renderPortalBody();
}

// Manage the master item list for a box directly — edit or permanently
// delete items, independent of any single week's menu.
function manageDeliItemsFlow(boxId) {
  const list = db.deliItemLists[boxId] || [];
  const boxTitle = (db.deliBoxes.find((b) => b.id === boxId) || {}).title || "";
  openModal(`<h3>Manage ${boxTitle} Items</h3>
    <div class="search-panel-list" style="max-height:320px">
      ${
        list.length
          ? list
              .map(
                (
                  item
                ) => `<div class="search-panel-row" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
        <span>${item.name} ${diettags(item)}${
                  item.soldOut
                    ? ' <span style="color:var(--red-flag);font-size:11px;font-weight:700">SOLD OUT</span>'
                    : ""
                }</span>
        <span><button class="btn small ${
          item.soldOut ? "" : "outline"
        }" onclick="toggleDeliItemSoldOut('${boxId}','${item.id}')">${
                  item.soldOut ? "Mark Available" : "Mark Sold Out"
                }</button> <button class="btn small outline" onclick="editDeliListItem('${boxId}','${
                  item.id
                }')">Edit</button> <button class="btn small danger" onclick="deleteDeliListItem('${boxId}','${
                  item.id
                }')">Delete</button></span>
      </div>`
              )
              .join("")
          : '<div class="search-panel-row">No items yet.</div>'
      }
    </div>
    <div class="modal-actions"><button class="btn outline" onclick="closeModal()">Close</button><button class="btn" onclick="newListItemFlow('${boxId}','')">+ New Item</button></div>`);
}
function toggleDeliItemSoldOut(boxId, itemId) {
  const item = (db.deliItemLists[boxId] || []).find((i) => i.id === itemId);
  if (!item) return;
  item.soldOut = !item.soldOut;
  fsdb
    .collection("deliItems")
    .doc(itemId)
    .update({ soldOut: item.soldOut })
    .catch((err) => console.error("Update sold-out status failed:", err));
  manageDeliItemsFlow(boxId);
  renderPortalBody();
}
function editDeliListItem(boxId, itemId) {
  const item = (db.deliItemLists[boxId] || []).find((i) => i.id === itemId);
  if (!item) return;
  openModal(`<h3>Edit Item</h3>
    <div class="field"><label>Name</label><input type="text" id="edi-name" value="${escHtmlAttr(
      item.name
    )}"></div>
    <div class="field"><label>Description</label><textarea id="edi-desc">${
      item.desc || ""
    }</textarea></div>
    <div class="toggle-row">
      <label><input type="checkbox" id="edi-df" ${
        item.df ? "checked" : ""
      }> Dairy Free</label>
      <label><input type="checkbox" id="edi-gf" ${
        item.gf ? "checked" : ""
      }> Gluten Free</label>
      <label><input type="checkbox" id="edi-v" ${
        item.v ? "checked" : ""
      }> Vegetarian</label>
    </div>
    <div class="toggle-row"><label><input type="checkbox" id="edi-soldout" ${
      item.soldOut ? "checked" : ""
    }> Sold Out (hidden from ordering, still shown on the menu)</label></div>
    <div class="modal-actions">
      <button class="btn danger" onclick="deleteDeliListItem('${boxId}','${itemId}')">Delete</button>
      <button class="btn" onclick="saveDeliListItem('${boxId}','${itemId}')">Save</button>
    </div>`);
}
function saveDeliListItem(boxId, itemId) {
  const item = (db.deliItemLists[boxId] || []).find((i) => i.id === itemId);
  if (!item) return;
  item.name = document.getElementById("edi-name").value.trim() || item.name;
  item.desc = document.getElementById("edi-desc").value;
  item.df = document.getElementById("edi-df").checked;
  item.gf = document.getElementById("edi-gf").checked;
  item.v = document.getElementById("edi-v").checked;
  item.soldOut = document.getElementById("edi-soldout").checked;
  fsdb
    .collection("deliItems")
    .doc(itemId)
    .update({
      name: item.name,
      desc: item.desc,
      df: item.df,
      gf: item.gf,
      v: item.v,
      soldOut: item.soldOut,
    })
    .catch((err) => console.error("Update deli item failed:", err));
  closeModal();
  renderPortalBody();
}
function deleteDeliListItem(boxId, itemId) {
  if (
    !confirm(
      "Delete this item entirely? It will be removed from every week's menu that uses it."
    )
  )
    return;
  db.deliItemLists[boxId] = (db.deliItemLists[boxId] || []).filter(
    (i) => i.id !== itemId
  );
  fsdb
    .collection("deliItems")
    .doc(itemId)
    .delete()
    .catch((err) => console.error("Delete deli item failed:", err));
  Object.keys(db.weeklyMenus).forEach((wk) => {
    const data = db.weeklyMenus[wk][boxId];
    if (data && data.items.includes(itemId)) {
      data.items = data.items.filter((id) => id !== itemId);
      saveDeliWeeklyMenuDoc(wk, boxId);
    }
  });
  closeModal();
  renderPortalBody();
}

function addDeliBoxFlow() {
  openModal(`<h3>Add Deli Box</h3>
    <div class="field"><label>Box title</label><input type="text" id="box-new-title" placeholder="e.g. Smoothies"></div>
    <div class="modal-actions"><button class="btn" onclick="saveAddDeliBox()">Create</button></div>`);
}
function saveAddDeliBox() {
  const title = document.getElementById("box-new-title").value.trim();
  if (!title) return;
  const id = newId("box");
  const order =
    db.deliBoxes.reduce(
      (max, b) => Math.max(max, b.order != null ? b.order : 0),
      0
    ) + 1;
  db.deliBoxes.push({ id, title, active: true, order });
  db.deliItemLists[id] = [];
  fsdb
    .collection("deliBoxes")
    .doc(id)
    .set({ title, active: true, order })
    .catch((err) => console.error("Save deli box failed:", err));
  const existingWeeks = Object.keys(db.weeklyMenus);
  if (existingWeeks.length) {
    const batch = fsdb.batch();
    existingWeeks.forEach((k) => {
      db.weeklyMenus[k][id] = { price: "", notes: "", items: [] };
      batch.set(fsdb.collection("deliWeeklyMenus").doc(`${k}__${id}`), {
        price: "",
        notes: "",
        items: [],
      });
    });
    batch
      .commit()
      .catch((err) => console.error("Save deli box weekly menus failed:", err));
  }
  closeModal();
  renderPortalBody();
}
function renameDeliBox(id) {
  const b = db.deliBoxes.find((x) => x.id === id);
  openModal(`<h3>Rename Box</h3><div class="field"><input type="text" id="box-rename" value="${b.title}"></div>
    <div class="modal-actions"><button class="btn" onclick="saveRenameDeliBox('${id}')">Save</button></div>`);
}
function saveRenameDeliBox(id) {
  const b = db.deliBoxes.find((x) => x.id === id);
  const v = document.getElementById("box-rename").value.trim();
  if (v) b.title = v;
  fsdb
    .collection("deliBoxes")
    .doc(id)
    .update({ title: b.title })
    .catch((err) => console.error("Rename deli box failed:", err));
  closeModal();
  renderPortalBody();
}
function toggleDeliBoxActive(id) {
  const b = db.deliBoxes.find((x) => x.id === id);
  b.active = !b.active;
  fsdb
    .collection("deliBoxes")
    .doc(id)
    .update({ active: b.active })
    .catch((err) => console.error("Update deli box failed:", err));
  renderPortalBody();
}
function deleteDeliBox(id) {
  if (!confirm("Delete this box and all its menu data? This cannot be undone."))
    return;
  db.deliBoxes = db.deliBoxes.filter((b) => b.id !== id);
  const itemsToDelete = db.deliItemLists[id] || [];
  const weeksWithBox = Object.keys(db.weeklyMenus).filter(
    (k) => db.weeklyMenus[k][id]
  );
  delete db.deliItemLists[id];
  weeksWithBox.forEach((k) => {
    delete db.weeklyMenus[k][id];
  });
  const batch = fsdb.batch();
  batch.delete(fsdb.collection("deliBoxes").doc(id));
  itemsToDelete.forEach((item) =>
    batch.delete(fsdb.collection("deliItems").doc(item.id))
  );
  weeksWithBox.forEach((k) =>
    batch.delete(fsdb.collection("deliWeeklyMenus").doc(`${k}__${id}`))
  );
  batch.commit().catch((err) => console.error("Delete deli box failed:", err));
  renderPortalBody();
}

/* ============================================================
   CUSTOM BAR (master only) — static list (no weekly calendar, like
   Produce Deals) of boxes/items available for Custom Panini and/or
   Custom Salad orders. Each box AND each item carries its own
   Panini/Salad checkboxes and an optional upcharge.
   ============================================================ */
/* ============================================================
   COFFEE BAR (master only) — fixed categories (Hot/Cold Items), each item
   can have any number of add-ons attached, add-ons managed separately.
   ============================================================ */
function coffeeBarHTML() {
  return `<h2 class="section-title">Coffee Bar</h2>
    <div class="card">
      <h4>Add-Ons <button class="btn small" onclick="addCoffeeAddonFlow()">+ Add Add-On</button></h4>
      <p style="font-size:12.5px;color:var(--ink-soft)">These can be attached to any hot or cold item below.</p>
      ${
        db.coffeeAddons.length
          ? db.coffeeAddons
              .map(
                (
                  a
                ) => `<div class="deli-item" style="display:flex;justify-content:space-between;align-items:center">
        <span>${a.name}${a.price ? ` — $${a.price}` : ""}</span>
        <span><button class="btn small outline" onclick="editCoffeeAddonFlow('${
          a.id
        }')">Edit</button> <button class="btn small danger" onclick="deleteCoffeeAddon('${
                  a.id
                }')">Delete</button></span>
      </div>`
              )
              .join("")
          : '<p class="empty-note">No add-ons yet.</p>'
      }
    </div>
    <div class="card">
      <h4>Milks <button class="btn small" onclick="addCoffeeMilkFlow()">+ Add Milk</button></h4>
      <p style="font-size:12.5px;color:var(--ink-soft)">Available choices for any item marked "Takes milk" below.</p>
      ${
        db.coffeeMilks.length
          ? db.coffeeMilks
              .map(
                (
                  m
                ) => `<div class="deli-item" style="display:flex;justify-content:space-between;align-items:center">
        <span>${m.name}${m.price ? ` — $${m.price}` : ""}</span>
        <span><button class="btn small outline" onclick="editCoffeeMilkFlow('${
          m.id
        }')">Edit</button> <button class="btn small danger" onclick="deleteCoffeeMilk('${
                  m.id
                }')">Delete</button></span>
      </div>`
              )
              .join("")
          : '<p class="empty-note">No milk options yet.</p>'
      }
    </div>
    <div class="card">
      <h4>Flavors <button class="btn small" onclick="addFlavorCategoryFlow()">+ Add Flavor Category</button></h4>
      <p style="font-size:12.5px;color:var(--ink-soft)">Group flavors into categories (e.g. "Classic Syrups"), then choose which categories each item offers below.</p>
      ${
        db.coffeeFlavorCategories.length
          ? db.coffeeFlavorCategories
              .map((c, i) => coffeeFlavorCategoryHTML(c, i))
              .join("")
          : '<p class="empty-note">No flavor categories yet.</p>'
      }
    </div>
    ${coffeeCategorySectionHTML("hot", "Hot Items")}
    ${coffeeCategorySectionHTML("cold", "Cold Items")}`;
}
function coffeeFlavorCategoryHTML(cat, idx) {
  const flavors = db.coffeeFlavors.filter((f) => f.categoryId === cat.id);
  return `<div style="border-top:1px dashed var(--line);padding:10px 0 4px">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
      <strong>${cat.name}</strong>
      <span>
        <button class="btn small outline" onclick="moveFlavorCategory('${
          cat.id
        }',-1)" ${idx === 0 ? "disabled" : ""}>↑</button>
        <button class="btn small outline" onclick="moveFlavorCategory('${
          cat.id
        }',1)" ${
    idx === db.coffeeFlavorCategories.length - 1 ? "disabled" : ""
  }>↓</button>
        <button class="btn small outline" onclick="renameFlavorCategoryFlow('${
          cat.id
        }')">Rename</button>
        <button class="btn small danger" onclick="deleteFlavorCategory('${
          cat.id
        }')">Delete</button>
      </span>
    </div>
    <div style="margin-top:6px">
      ${
        flavors.length
          ? flavors
              .map(
                (
                  f
                ) => `<div class="deli-item" style="display:flex;justify-content:space-between;align-items:center">
        <span>${f.name}</span>
        <span><button class="btn small outline" onclick="editFlavorFlow('${f.id}')">Edit</button> <button class="btn small danger" onclick="deleteFlavor('${f.id}')">Delete</button></span>
      </div>`
              )
              .join("")
          : '<p class="empty-note">No flavors in this category yet.</p>'
      }
    </div>
    <button class="btn small" style="margin-top:6px" onclick="addFlavorFlow('${
      cat.id
    }')">+ Add Flavor</button>
  </div>`;
}
function addFlavorCategoryFlow() {
  openModal(`<h3>Add Flavor Category</h3><div class="field"><label>Category name</label><input type="text" id="fc-name" placeholder="e.g. Classic Syrups"></div>
    <div class="modal-actions"><button class="btn" onclick="saveFlavorCategory()">Save</button></div>`);
}
function saveFlavorCategory() {
  const name = document.getElementById("fc-name").value.trim();
  if (!name) return;
  const id = newId("fc");
  const order =
    db.coffeeFlavorCategories.reduce(
      (max, c) => Math.max(max, c.order != null ? c.order : 0),
      0
    ) + 1;
  db.coffeeFlavorCategories.push({ id, name, order });
  fsdb
    .collection("coffeeFlavorCategories")
    .doc(id)
    .set({ name, order })
    .catch((err) => console.error("Save flavor category failed:", err));
  closeModal();
  renderPortalBody();
}
function renameFlavorCategoryFlow(id) {
  const c = db.coffeeFlavorCategories.find((x) => x.id === id);
  if (!c) return;
  openModal(`<h3>Rename Category</h3><div class="field"><input type="text" id="fc-rename" value="${escHtmlAttr(
    c.name
  )}"></div>
    <div class="modal-actions"><button class="btn" onclick="saveRenameFlavorCategory('${id}')">Save</button></div>`);
}
function saveRenameFlavorCategory(id) {
  const c = db.coffeeFlavorCategories.find((x) => x.id === id);
  if (!c) return;
  const v = document.getElementById("fc-rename").value.trim();
  if (v) c.name = v;
  fsdb
    .collection("coffeeFlavorCategories")
    .doc(id)
    .update({ name: c.name })
    .catch((err) => console.error("Rename flavor category failed:", err));
  closeModal();
  renderPortalBody();
}
function moveFlavorCategory(id, direction) {
  if (
    reorderList(
      db.coffeeFlavorCategories,
      id,
      direction,
      "coffeeFlavorCategories"
    )
  )
    renderPortalBody();
}
function deleteFlavorCategory(id) {
  if (
    !confirm(
      "Delete this flavor category and all its flavors? It will be removed from every item that offers it."
    )
  )
    return;
  const flavorsToDelete = db.coffeeFlavors.filter((f) => f.categoryId === id);
  db.coffeeFlavorCategories = db.coffeeFlavorCategories.filter(
    (c) => c.id !== id
  );
  db.coffeeFlavors = db.coffeeFlavors.filter((f) => f.categoryId !== id);
  db.coffeeItems.forEach((item) => {
    if (item.flavorCategoryIds && item.flavorCategoryIds.includes(id)) {
      item.flavorCategoryIds = item.flavorCategoryIds.filter(
        (cid) => cid !== id
      );
      fsdb
        .collection("coffeeItems")
        .doc(item.id)
        .update({ flavorCategoryIds: item.flavorCategoryIds })
        .catch(() => {});
    }
  });
  const batch = fsdb.batch();
  batch.delete(fsdb.collection("coffeeFlavorCategories").doc(id));
  flavorsToDelete.forEach((f) =>
    batch.delete(fsdb.collection("coffeeFlavors").doc(f.id))
  );
  batch
    .commit()
    .catch((err) => console.error("Delete flavor category failed:", err));
  renderPortalBody();
}
function addFlavorFlow(categoryId) {
  openModal(`<h3>Add Flavor</h3><div class="field"><label>Flavor name</label><input type="text" id="fl-name" placeholder="e.g. Vanilla"></div>
    <div class="modal-actions"><button class="btn" onclick="saveFlavor('${categoryId}')">Save</button></div>`);
}
function saveFlavor(categoryId) {
  const name = document.getElementById("fl-name").value.trim();
  if (!name) return;
  const id = newId("fl");
  db.coffeeFlavors.push({ id, categoryId, name });
  fsdb
    .collection("coffeeFlavors")
    .doc(id)
    .set({ categoryId, name })
    .catch((err) => console.error("Save flavor failed:", err));
  closeModal();
  renderPortalBody();
}
function editFlavorFlow(id) {
  const f = db.coffeeFlavors.find((x) => x.id === id);
  if (!f) return;
  openModal(`<h3>Edit Flavor</h3><div class="field"><label>Flavor name</label><input type="text" id="fl-rename" value="${escHtmlAttr(
    f.name
  )}"></div>
    <div class="modal-actions">
      <button class="btn danger" onclick="deleteFlavor('${id}')">Delete</button>
      <button class="btn" onclick="saveRenameFlavor('${id}')">Save</button>
    </div>`);
}
function saveRenameFlavor(id) {
  const f = db.coffeeFlavors.find((x) => x.id === id);
  if (!f) return;
  const v = document.getElementById("fl-rename").value.trim();
  if (v) f.name = v;
  fsdb
    .collection("coffeeFlavors")
    .doc(id)
    .update({ name: f.name })
    .catch((err) => console.error("Rename flavor failed:", err));
  closeModal();
  renderPortalBody();
}
function deleteFlavor(id) {
  if (!confirm("Delete this flavor?")) return;
  db.coffeeFlavors = db.coffeeFlavors.filter((x) => x.id !== id);
  fsdb
    .collection("coffeeFlavors")
    .doc(id)
    .delete()
    .catch((err) => console.error("Delete flavor failed:", err));
  closeModal();
  renderPortalBody();
}
function addCoffeeMilkFlow() {
  openModal(`<h3>Add Milk</h3>
    <div class="field"><label>Name</label><input type="text" id="cm-name" placeholder="e.g. Oat Milk"></div>
    <div class="field"><label>Price (optional)</label><div style="display:flex;align-items:center;gap:4px">$<input type="text" id="cm-price" style="width:80px" placeholder="0.75"></div></div>
    <div class="modal-actions"><button class="btn" onclick="saveCoffeeMilk()">Save</button></div>`);
}
function saveCoffeeMilk() {
  const name = document.getElementById("cm-name").value.trim();
  if (!name) return;
  const price = document.getElementById("cm-price").value.trim();
  const id = newId("cm");
  db.coffeeMilks.push({ id, name, price });
  fsdb
    .collection("coffeeMilks")
    .doc(id)
    .set({ name, price })
    .catch((err) => console.error("Save milk failed:", err));
  closeModal();
  renderPortalBody();
}
function editCoffeeMilkFlow(id) {
  const m = db.coffeeMilks.find((x) => x.id === id);
  if (!m) return;
  openModal(`<h3>Edit Milk</h3>
    <div class="field"><label>Name</label><input type="text" id="cm-name" value="${escHtmlAttr(
      m.name
    )}"></div>
    <div class="field"><label>Price (optional)</label><div style="display:flex;align-items:center;gap:4px">$<input type="text" id="cm-price" style="width:80px" value="${
      m.price || ""
    }"></div></div>
    <div class="modal-actions">
      <button class="btn danger" onclick="deleteCoffeeMilk('${id}')">Delete</button>
      <button class="btn" onclick="updateCoffeeMilk('${id}')">Save</button>
    </div>`);
}
function updateCoffeeMilk(id) {
  const m = db.coffeeMilks.find((x) => x.id === id);
  if (!m) return;
  m.name = document.getElementById("cm-name").value.trim() || m.name;
  m.price = document.getElementById("cm-price").value.trim();
  fsdb
    .collection("coffeeMilks")
    .doc(id)
    .update({ name: m.name, price: m.price })
    .catch((err) => console.error("Update milk failed:", err));
  closeModal();
  renderPortalBody();
}
function deleteCoffeeMilk(id) {
  if (!confirm("Delete this milk option?")) return;
  db.coffeeMilks = db.coffeeMilks.filter((x) => x.id !== id);
  fsdb
    .collection("coffeeMilks")
    .doc(id)
    .delete()
    .catch((err) => console.error("Delete milk failed:", err));
  closeModal();
  renderPortalBody();
}
function coffeeCategorySectionHTML(cat, title) {
  const items = db.coffeeItems.filter((i) => i.category === cat);
  return `<div class="card">
    <h4>${title} <button class="btn small" onclick="addCoffeeItemFlow('${cat}')">+ Add Item</button></h4>
    ${
      items.length
        ? items
            .map(
              (
                i
              ) => `<div class="deli-item" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap">
      <span>${i.name}${i.price ? ` — $${i.price}` : ""}${
                i.takesMilk
                  ? ' <span style="font-size:11px;color:var(--ink-soft)">(milk)</span>'
                  : ""
              }${
                i.addonIds && i.addonIds.length
                  ? ` <span style="font-size:11px;color:var(--ink-soft)">(${
                      i.addonIds.length
                    } add-on${i.addonIds.length === 1 ? "" : "s"})</span>`
                  : ""
              }</span>
      <span><button class="btn small outline" onclick="editCoffeeItemFlow('${
        i.id
      }')">Edit</button> <button class="btn small danger" onclick="deleteCoffeeItem('${
                i.id
              }')">Delete</button></span>
    </div>`
            )
            .join("")
        : '<p class="empty-note">No items yet.</p>'
    }
  </div>`;
}
function coffeeAddonCheckboxesHTML(selectedIds) {
  if (!db.coffeeAddons.length)
    return '<p class="empty-note">No add-ons created yet — add some above first.</p>';
  return db.coffeeAddons
    .map(
      (a) =>
        `<label style="display:block;font-size:13px;margin:3px 0"><input type="checkbox" value="${
          a.id
        }" class="ci-addon-cb" ${
          (selectedIds || []).includes(a.id) ? "checked" : ""
        }> ${a.name}${a.price ? ` (+$${a.price})` : ""}</label>`
    )
    .join("");
}
function coffeeFlavorCategoryCheckboxesHTML(selectedIds) {
  if (!db.coffeeFlavorCategories.length)
    return '<p class="empty-note">No flavor categories created yet — add some above first.</p>';
  return db.coffeeFlavorCategories
    .map(
      (c) =>
        `<label style="display:block;font-size:13px;margin:3px 0"><input type="checkbox" value="${
          c.id
        }" class="ci-flavorcat-cb" ${
          (selectedIds || []).includes(c.id) ? "checked" : ""
        }> ${c.name}</label>`
    )
    .join("");
}
function addCoffeeItemFlow(category) {
  openModal(`<h3>Add ${category === "hot" ? "Hot" : "Cold"} Item</h3>
    <div class="field"><label>Name</label><input type="text" id="ci-name"></div>
    <div class="field"><label>Price</label><div style="display:flex;align-items:center;gap:4px">$<input type="text" id="ci-price" style="width:80px"></div></div>
    <div class="toggle-row"><label><input type="checkbox" id="ci-milk"> Takes milk</label></div>
    <div class="field"><label>Available Add-Ons</label>${coffeeAddonCheckboxesHTML(
      []
    )}</div>
    <div class="field"><label>Available Flavor Categories</label>${coffeeFlavorCategoryCheckboxesHTML(
      []
    )}</div>
    <div class="modal-actions"><button class="btn" onclick="saveCoffeeItem('${category}')">Save</button></div>`);
}
function saveCoffeeItem(category) {
  const name = document.getElementById("ci-name").value.trim();
  if (!name) return;
  const price = document.getElementById("ci-price").value.trim();
  const takesMilk = document.getElementById("ci-milk").checked;
  const addonIds = Array.from(
    document.querySelectorAll(".ci-addon-cb:checked")
  ).map((cb) => cb.value);
  const flavorCategoryIds = Array.from(
    document.querySelectorAll(".ci-flavorcat-cb:checked")
  ).map((cb) => cb.value);
  const id = newId("ci");
  const item = {
    name,
    price,
    category,
    takesMilk,
    addonIds,
    flavorCategoryIds,
  };
  db.coffeeItems.push({ id, ...item });
  fsdb
    .collection("coffeeItems")
    .doc(id)
    .set(item)
    .catch((err) => console.error("Save coffee item failed:", err));
  closeModal();
  renderPortalBody();
}
function editCoffeeItemFlow(id) {
  const item = db.coffeeItems.find((i) => i.id === id);
  if (!item) return;
  openModal(`<h3>Edit Item</h3>
    <div class="field"><label>Name</label><input type="text" id="ci-name" value="${escHtmlAttr(
      item.name
    )}"></div>
    <div class="field"><label>Price</label><div style="display:flex;align-items:center;gap:4px">$<input type="text" id="ci-price" style="width:80px" value="${
      item.price || ""
    }"></div></div>
    <div class="toggle-row"><label><input type="checkbox" id="ci-milk" ${
      item.takesMilk ? "checked" : ""
    }> Takes milk</label></div>
    <div class="field"><label>Available Add-Ons</label>${coffeeAddonCheckboxesHTML(
      item.addonIds
    )}</div>
    <div class="field"><label>Available Flavor Categories</label>${coffeeFlavorCategoryCheckboxesHTML(
      item.flavorCategoryIds
    )}</div>
    <div class="modal-actions">
      <button class="btn danger" onclick="deleteCoffeeItem('${id}')">Delete</button>
      <button class="btn" onclick="updateCoffeeItem('${id}')">Save</button>
    </div>`);
}
function updateCoffeeItem(id) {
  const item = db.coffeeItems.find((i) => i.id === id);
  if (!item) return;
  item.name = document.getElementById("ci-name").value.trim() || item.name;
  item.price = document.getElementById("ci-price").value.trim();
  item.takesMilk = document.getElementById("ci-milk").checked;
  item.addonIds = Array.from(
    document.querySelectorAll(".ci-addon-cb:checked")
  ).map((cb) => cb.value);
  item.flavorCategoryIds = Array.from(
    document.querySelectorAll(".ci-flavorcat-cb:checked")
  ).map((cb) => cb.value);
  fsdb
    .collection("coffeeItems")
    .doc(id)
    .update({
      name: item.name,
      price: item.price,
      takesMilk: item.takesMilk,
      addonIds: item.addonIds,
      flavorCategoryIds: item.flavorCategoryIds,
    })
    .catch((err) => console.error("Update coffee item failed:", err));
  closeModal();
  renderPortalBody();
}
function deleteCoffeeItem(id) {
  if (!confirm("Delete this item?")) return;
  db.coffeeItems = db.coffeeItems.filter((i) => i.id !== id);
  fsdb
    .collection("coffeeItems")
    .doc(id)
    .delete()
    .catch((err) => console.error("Delete coffee item failed:", err));
  closeModal();
  renderPortalBody();
}
function addCoffeeAddonFlow() {
  openModal(`<h3>Add Add-On</h3>
    <div class="field"><label>Name</label><input type="text" id="ca-name" placeholder="e.g. Oat Milk"></div>
    <div class="field"><label>Price</label><div style="display:flex;align-items:center;gap:4px">$<input type="text" id="ca-price" style="width:80px" placeholder="0.75"></div></div>
    <div class="modal-actions"><button class="btn" onclick="saveCoffeeAddon()">Save</button></div>`);
}
function saveCoffeeAddon() {
  const name = document.getElementById("ca-name").value.trim();
  if (!name) return;
  const price = document.getElementById("ca-price").value.trim();
  const id = newId("ca");
  db.coffeeAddons.push({ id, name, price });
  fsdb
    .collection("coffeeAddons")
    .doc(id)
    .set({ name, price })
    .catch((err) => console.error("Save add-on failed:", err));
  closeModal();
  renderPortalBody();
}
function editCoffeeAddonFlow(id) {
  const a = db.coffeeAddons.find((x) => x.id === id);
  if (!a) return;
  openModal(`<h3>Edit Add-On</h3>
    <div class="field"><label>Name</label><input type="text" id="ca-name" value="${escHtmlAttr(
      a.name
    )}"></div>
    <div class="field"><label>Price</label><div style="display:flex;align-items:center;gap:4px">$<input type="text" id="ca-price" style="width:80px" value="${
      a.price || ""
    }"></div></div>
    <div class="modal-actions">
      <button class="btn danger" onclick="deleteCoffeeAddon('${id}')">Delete</button>
      <button class="btn" onclick="updateCoffeeAddon('${id}')">Save</button>
    </div>`);
}
function updateCoffeeAddon(id) {
  const a = db.coffeeAddons.find((x) => x.id === id);
  if (!a) return;
  a.name = document.getElementById("ca-name").value.trim() || a.name;
  a.price = document.getElementById("ca-price").value.trim();
  fsdb
    .collection("coffeeAddons")
    .doc(id)
    .update({ name: a.name, price: a.price })
    .catch((err) => console.error("Update add-on failed:", err));
  closeModal();
  renderPortalBody();
}
function deleteCoffeeAddon(id) {
  if (
    !confirm(
      "Delete this add-on? It will be removed from every item that offers it."
    )
  )
    return;
  db.coffeeAddons = db.coffeeAddons.filter((x) => x.id !== id);
  db.coffeeItems.forEach((item) => {
    if (item.addonIds && item.addonIds.includes(id)) {
      item.addonIds = item.addonIds.filter((aid) => aid !== id);
      fsdb
        .collection("coffeeItems")
        .doc(item.id)
        .update({ addonIds: item.addonIds })
        .catch(() => {});
    }
  });
  fsdb
    .collection("coffeeAddons")
    .doc(id)
    .delete()
    .catch((err) => console.error("Delete add-on failed:", err));
  closeModal();
  renderPortalBody();
}

/* ============================================================
   RECIPES (master + Display) — binders (like deli boxes) containing
   recipes. Master can create/edit/delete everything; Display gets the
   same view but no editing controls. Search works both scoped to the
   currently-open binder and globally across all binders.
   ============================================================ */
let recipesView = { binderId: null, searchTerm: "" };
function recipesHTML() {
  const editable = session.isMaster;
  if (recipesView.binderId)
    return recipeBinderDetailHTML(recipesView.binderId, editable);
  return recipesBinderListHTML(editable);
}
function recipeSearchBarHTML() {
  return `<input type="text" id="recipe-search" class="cat-search" placeholder="Search recipes…" value="${escHtmlAttr(
    recipesView.searchTerm
  )}" oninput="const pos=this.selectionStart; recipesView.searchTerm=this.value; renderPortalBody(); reFocusInput('recipe-search', pos);">`;
}
function recipesBinderListHTML(editable) {
  const term = recipesView.searchTerm.trim().toLowerCase();
  let html = `<h2 class="section-title">Recipes ${
    editable
      ? `<button class="btn small" onclick="addBinderFlow()">+ Add Binder</button>`
      : ""
  }</h2>${recipeSearchBarHTML()}`;
  if (term) {
    const matches = db.recipes.filter((r) =>
      r.name.toLowerCase().includes(term)
    );
    html += `<div class="card"><h4>Search Results</h4>
      ${
        matches.length
          ? matches.map((r) => recipeListRowHTML(r)).join("")
          : '<p class="empty-note">No matching recipes.</p>'
      }
    </div>`;
    return html;
  }
  html += db.recipeBinders.length
    ? db.recipeBinders
        .map(
          (
            b,
            i
          ) => `<div class="card" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer" onclick="openBinder('${
            b.id
          }')">
      <span style="font-size:17px">📖 ${b.title}</span>
      <span onclick="event.stopPropagation()">
        ${
          editable
            ? `<button class="btn small outline" onclick="moveBinder('${
                b.id
              }',-1)" ${i === 0 ? "disabled" : ""}>↑</button>
        <button class="btn small outline" onclick="moveBinder('${b.id}',1)" ${
                i === db.recipeBinders.length - 1 ? "disabled" : ""
              }>↓</button>
        <button class="btn small outline" onclick="renameBinderFlow('${
          b.id
        }')">Rename</button>
        <button class="btn small danger" onclick="deleteBinder('${
          b.id
        }')">Delete</button>`
            : ""
        }
      </span>
    </div>`
        )
        .join("")
    : '<p class="empty-note">No binders yet.</p>';
  return html;
}
function recipeBinderDetailHTML(binderId, editable) {
  const binder = db.recipeBinders.find((b) => b.id === binderId);
  if (!binder) {
    recipesView.binderId = null;
    return recipesBinderListHTML(editable);
  }
  const term = recipesView.searchTerm.trim().toLowerCase();
  let recipes = db.recipes.filter((r) => r.binderId === binderId);
  if (term)
    recipes = recipes.filter((r) => r.name.toLowerCase().includes(term));
  return `<h2 class="section-title"><button class="btn small outline" onclick="closeBinder()">← Binders</button> ${
    binder.title
  } ${
    editable
      ? `<button class="btn small" onclick="addRecipeFlow('${binderId}')">+ Add Recipe</button>`
      : ""
  }</h2>
    ${recipeSearchBarHTML()}
    ${
      recipes.length
        ? recipes.map((r) => recipeListRowHTML(r)).join("")
        : '<p class="empty-note">No recipes match.</p>'
    }`;
}
function openBinder(id) {
  recipesView = { binderId: id, searchTerm: "" };
  renderPortalBody();
}
function closeBinder() {
  recipesView = { binderId: null, searchTerm: "" };
  renderPortalBody();
}
function recipeListRowHTML(r) {
  return `<div class="card" style="cursor:pointer" onclick="viewRecipe('${
    r.id
  }')"><strong>${r.name}</strong> ${diettags(r)}</div>`;
}
function viewRecipe(id) {
  const r = db.recipes.find((x) => x.id === id);
  if (!r) return;
  const editable = session.isMaster;
  openModal(`<h3>${r.name} ${diettags(r)}</h3>
    <h4 style="margin-top:10px">Ingredients</h4>
    <p style="white-space:pre-wrap;font-size:14px">${escHtmlAttr(
      r.ingredients || ""
    )}</p>
    <h4 style="margin-top:10px">Instructions</h4>
    <p style="white-space:pre-wrap;font-size:14px">${escHtmlAttr(
      r.instructions || ""
    )}</p>
    <div class="modal-actions" style="justify-content:space-between">
      ${
        editable
          ? `<span><button class="btn danger" onclick="deleteRecipe('${id}')">Delete</button> <button class="btn outline" onclick="editRecipeFlow('${id}')">Edit</button></span>`
          : "<span></span>"
      }
      <button class="btn" onclick="closeModal()">Close</button>
    </div>`);
}
function addBinderFlow() {
  openModal(`<h3>Add Binder</h3><div class="field"><label>Binder name</label><input type="text" id="bd-title" placeholder="e.g. Soups & Sauces"></div>
    <div class="modal-actions"><button class="btn" onclick="saveBinder()">Save</button></div>`);
}
function saveBinder() {
  const title = document.getElementById("bd-title").value.trim();
  if (!title) return;
  const id = newId("bd");
  const order =
    db.recipeBinders.reduce(
      (max, b) => Math.max(max, b.order != null ? b.order : 0),
      0
    ) + 1;
  db.recipeBinders.push({ id, title, order });
  fsdb
    .collection("recipeBinders")
    .doc(id)
    .set({ title, order })
    .catch((err) => console.error("Save binder failed:", err));
  closeModal();
  renderPortalBody();
}
function renameBinderFlow(id) {
  const b = db.recipeBinders.find((x) => x.id === id);
  if (!b) return;
  openModal(`<h3>Rename Binder</h3><div class="field"><input type="text" id="bd-rename" value="${escHtmlAttr(
    b.title
  )}"></div>
    <div class="modal-actions"><button class="btn" onclick="saveRenameBinder('${id}')">Save</button></div>`);
}
function saveRenameBinder(id) {
  const b = db.recipeBinders.find((x) => x.id === id);
  if (!b) return;
  const v = document.getElementById("bd-rename").value.trim();
  if (v) b.title = v;
  fsdb
    .collection("recipeBinders")
    .doc(id)
    .update({ title: b.title })
    .catch((err) => console.error("Rename binder failed:", err));
  closeModal();
  renderPortalBody();
}
function moveBinder(id, direction) {
  if (reorderList(db.recipeBinders, id, direction, "recipeBinders"))
    renderPortalBody();
}
function deleteBinder(id) {
  if (!confirm("Delete this binder and all its recipes?")) return;
  const recipesToDelete = db.recipes.filter((r) => r.binderId === id);
  db.recipeBinders = db.recipeBinders.filter((b) => b.id !== id);
  db.recipes = db.recipes.filter((r) => r.binderId !== id);
  const batch = fsdb.batch();
  batch.delete(fsdb.collection("recipeBinders").doc(id));
  recipesToDelete.forEach((r) =>
    batch.delete(fsdb.collection("recipes").doc(r.id))
  );
  batch.commit().catch((err) => console.error("Delete binder failed:", err));
  recipesView = { binderId: null, searchTerm: "" };
  renderPortalBody();
}
function recipeFormFieldsHTML(r) {
  r = r || {};
  return `<div class="field"><label>Recipe Name</label><input type="text" id="rc-name" value="${escHtmlAttr(
    r.name || ""
  )}"></div>
    <div class="field"><label>Ingredients</label><textarea id="rc-ingredients" style="min-height:100px">${
      r.ingredients || ""
    }</textarea></div>
    <div class="field"><label>Instructions</label><textarea id="rc-instructions" style="min-height:120px">${
      r.instructions || ""
    }</textarea></div>
    <div class="toggle-row">
      <label><input type="checkbox" id="rc-gf" ${
        r.gf ? "checked" : ""
      }> Gluten Free</label>
      <label><input type="checkbox" id="rc-df" ${
        r.df ? "checked" : ""
      }> Dairy Free</label>
      <label><input type="checkbox" id="rc-v" ${
        r.v ? "checked" : ""
      }> Vegetarian</label>
    </div>`;
}
function addRecipeFlow(binderId) {
  openModal(`<h3>Add Recipe</h3>${recipeFormFieldsHTML()}
    <div class="modal-actions"><button class="btn" onclick="saveRecipe('${binderId}')">Save</button></div>`);
}
function saveRecipe(binderId) {
  const name = document.getElementById("rc-name").value.trim();
  if (!name) return;
  const recipe = {
    binderId,
    name,
    ingredients: document.getElementById("rc-ingredients").value,
    instructions: document.getElementById("rc-instructions").value,
    gf: document.getElementById("rc-gf").checked,
    df: document.getElementById("rc-df").checked,
    v: document.getElementById("rc-v").checked,
  };
  const id = newId("rc");
  db.recipes.push({ id, ...recipe });
  fsdb
    .collection("recipes")
    .doc(id)
    .set(recipe)
    .catch((err) => console.error("Save recipe failed:", err));
  closeModal();
  renderPortalBody();
}
function editRecipeFlow(id) {
  const r = db.recipes.find((x) => x.id === id);
  if (!r) return;
  openModal(`<h3>Edit Recipe</h3>${recipeFormFieldsHTML(r)}
    <div class="modal-actions">
      <button class="btn danger" onclick="deleteRecipe('${id}')">Delete</button>
      <button class="btn" onclick="updateRecipe('${id}')">Save</button>
    </div>`);
}
function updateRecipe(id) {
  const r = db.recipes.find((x) => x.id === id);
  if (!r) return;
  r.name = document.getElementById("rc-name").value.trim() || r.name;
  r.ingredients = document.getElementById("rc-ingredients").value;
  r.instructions = document.getElementById("rc-instructions").value;
  r.gf = document.getElementById("rc-gf").checked;
  r.df = document.getElementById("rc-df").checked;
  r.v = document.getElementById("rc-v").checked;
  fsdb
    .collection("recipes")
    .doc(id)
    .update({
      name: r.name,
      ingredients: r.ingredients,
      instructions: r.instructions,
      gf: r.gf,
      df: r.df,
      v: r.v,
    })
    .catch((err) => console.error("Update recipe failed:", err));
  closeModal();
  renderPortalBody();
}
function deleteRecipe(id) {
  if (!confirm("Delete this recipe?")) return;
  db.recipes = db.recipes.filter((x) => x.id !== id);
  fsdb
    .collection("recipes")
    .doc(id)
    .delete()
    .catch((err) => console.error("Delete recipe failed:", err));
  closeModal();
  renderPortalBody();
}

function customBarHTML() {
  return `<h2 class="section-title">Custom Bar <button class="btn" onclick="addCustomBarBoxFlow()">+ Add Box</button></h2>
    <p style="font-size:12.5px;color:var(--ink-soft);margin-bottom:12px">Manage what's available for Custom Paninis and Custom Salads. Check which order type(s) can use each box or item, and set an optional upcharge.</p>
    <div class="card">
      <h4>Custom Panini &amp; Salad Pricing</h4>
      <p style="font-size:12.5px;color:var(--ink-soft)">These base prices are shown on the public Weekly Deli page. Item-level upcharges (set below) add on top of this.</p>
      <div class="field" style="max-width:200px"><label>Custom Panini price</label><div style="display:flex;align-items:center;gap:4px">$<input type="text" style="width:80px" value="${
        db.settings.customPaniniPrice || ""
      }" placeholder="6.50" onchange="updateCustomOrderPrice('panini',this.value)"></div></div>
      <div class="field" style="max-width:200px"><label>Custom Salad price</label><div style="display:flex;align-items:center;gap:4px">$<input type="text" style="width:80px" value="${
        db.settings.customSaladPrice || ""
      }" placeholder="7.50" onchange="updateCustomOrderPrice('salad',this.value)"></div></div>
    </div>
    ${
      db.customBarBoxes.length
        ? db.customBarBoxes.map((box) => customBarBoxHTML(box)).join("")
        : '<p class="empty-note">No boxes yet.</p>'
    }`;
}
function updateCustomOrderPrice(type, val) {
  if (type === "panini") db.settings.customPaniniPrice = val;
  else db.settings.customSaladPrice = val;
  scheduleSave();
}
function customBarBoxHTML(box) {
  const items = db.customBarItems.filter((i) => i.boxId === box.id);
  const idx = db.customBarBoxes.findIndex((b) => b.id === box.id);
  return `<div class="card">
    <h4>${box.title}</h4>
    <div class="toggle-row" style="margin:6px 0">
      <label><input type="checkbox" ${
        box.panini ? "checked" : ""
      } onchange="updateCustomBarBoxFlag('${
    box.id
  }','panini',this.checked)"> Offer for Custom Panini</label>
      <label><input type="checkbox" ${
        box.salad ? "checked" : ""
      } onchange="updateCustomBarBoxFlag('${
    box.id
  }','salad',this.checked)"> Offer for Custom Salad</label>
    </div>
    <div style="margin-top:12px">
      ${
        items.length
          ? items
              .map(
                (
                  item
                ) => `<div class="deli-item" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <span>${item.name}</span>
        <span style="display:flex;align-items:center;gap:10px;font-size:12.5px;flex-wrap:wrap">
          <label><input type="checkbox" ${
            item.panini ? "checked" : ""
          } onchange="updateCustomBarItemFlag('${
                  item.id
                }','panini',this.checked)"> Panini</label>
          <label><input type="checkbox" ${
            item.salad ? "checked" : ""
          } onchange="updateCustomBarItemFlag('${
                  item.id
                }','salad',this.checked)"> Salad</label>
          $<input type="text" style="width:50px" value="${
            item.upcharge || ""
          }" placeholder="0.00" onchange="updateCustomBarItemField('${
                  item.id
                }','upcharge',this.value)">
          <button class="btn small danger" onclick="deleteCustomBarItem('${
            item.id
          }')">Delete</button>
        </span>
      </div>`
              )
              .join("")
          : '<p class="empty-note">No items in this box yet.</p>'
      }
    </div>
    <div class="box-admin-row" style="margin-top:10px;border-top:1px dashed var(--line);padding-top:10px">
      <button class="btn small" onclick="addCustomBarItemFlow('${
        box.id
      }')">+ Add Item</button>
      <button class="btn small outline" onclick="moveCustomBarBox('${
        box.id
      }',-1)" ${idx === 0 ? "disabled" : ""}>↑</button>
      <button class="btn small outline" onclick="moveCustomBarBox('${
        box.id
      }',1)" ${
    idx === db.customBarBoxes.length - 1 ? "disabled" : ""
  }>↓</button>
      <button class="btn small outline" onclick="renameCustomBarBox('${
        box.id
      }')">Rename</button>
      <button class="btn small danger" onclick="deleteCustomBarBox('${
        box.id
      }')">Delete Box</button>
    </div>
  </div>`;
}
function moveCustomBarBox(id, direction) {
  if (reorderList(db.customBarBoxes, id, direction, "customBarBoxes"))
    renderPortalBody();
}
function addCustomBarBoxFlow() {
  openModal(`<h3>Add Box</h3><div class="field"><label>Box name</label><input type="text" id="cbb-title" placeholder="e.g. Meats"></div>
    <div class="modal-actions"><button class="btn" onclick="saveCustomBarBox()">Save</button></div>`);
}
function saveCustomBarBox() {
  const title = document.getElementById("cbb-title").value.trim();
  if (!title) return;
  const id = newId("cbb");
  const order =
    db.customBarBoxes.reduce(
      (max, b) => Math.max(max, b.order != null ? b.order : 0),
      0
    ) + 1;
  const box = { title, panini: false, salad: false, order };
  db.customBarBoxes.push({ id, ...box });
  fsdb
    .collection("customBarBoxes")
    .doc(id)
    .set(box)
    .catch((err) => console.error("Save custom bar box failed:", err));
  closeModal();
  renderPortalBody();
}
function renameCustomBarBox(id) {
  const b = db.customBarBoxes.find((x) => x.id === id);
  openModal(`<h3>Rename Box</h3><div class="field"><input type="text" id="cbb-rename" value="${b.title}"></div>
    <div class="modal-actions"><button class="btn" onclick="saveRenameCustomBarBox('${id}')">Save</button></div>`);
}
function saveRenameCustomBarBox(id) {
  const b = db.customBarBoxes.find((x) => x.id === id);
  const v = document.getElementById("cbb-rename").value.trim();
  if (v) b.title = v;
  fsdb
    .collection("customBarBoxes")
    .doc(id)
    .update({ title: b.title })
    .catch((err) => console.error("Rename custom bar box failed:", err));
  closeModal();
  renderPortalBody();
}
function updateCustomBarBoxFlag(id, field, val) {
  const b = db.customBarBoxes.find((x) => x.id === id);
  b[field] = val;
  fsdb
    .collection("customBarBoxes")
    .doc(id)
    .update({ [field]: val })
    .catch((err) => console.error("Update custom bar box failed:", err));
  renderPortalBody();
}
function deleteCustomBarBox(id) {
  if (!confirm("Delete this box and all its items?")) return;
  const itemsToDelete = db.customBarItems.filter((i) => i.boxId === id);
  db.customBarBoxes = db.customBarBoxes.filter((b) => b.id !== id);
  db.customBarItems = db.customBarItems.filter((i) => i.boxId !== id);
  const batch = fsdb.batch();
  batch.delete(fsdb.collection("customBarBoxes").doc(id));
  itemsToDelete.forEach((item) =>
    batch.delete(fsdb.collection("customBarItems").doc(item.id))
  );
  batch
    .commit()
    .catch((err) => console.error("Delete custom bar box failed:", err));
  renderPortalBody();
}
function addCustomBarItemFlow(boxId) {
  openModal(`<h3>Add Item</h3><div class="field"><label>Item name</label><input type="text" id="cbi-name" placeholder="e.g. Chicken Breast"></div>
    <div class="modal-actions"><button class="btn" onclick="saveCustomBarItem('${boxId}')">Save</button></div>`);
}
function saveCustomBarItem(boxId) {
  const name = document.getElementById("cbi-name").value.trim();
  if (!name) return;
  const id = newId("cbi");
  const item = { boxId, name, panini: false, salad: false, upcharge: "" };
  db.customBarItems.push({ id, ...item });
  fsdb
    .collection("customBarItems")
    .doc(id)
    .set(item)
    .catch((err) => console.error("Save custom bar item failed:", err));
  closeModal();
  renderPortalBody();
}
function updateCustomBarItemFlag(id, field, val) {
  const item = db.customBarItems.find((x) => x.id === id);
  item[field] = val;
  fsdb
    .collection("customBarItems")
    .doc(id)
    .update({ [field]: val })
    .catch((err) => console.error("Update custom bar item failed:", err));
  renderPortalBody();
}
function updateCustomBarItemField(id, field, val) {
  const item = db.customBarItems.find((x) => x.id === id);
  item[field] = val;
  fsdb
    .collection("customBarItems")
    .doc(id)
    .update({ [field]: val })
    .catch((err) => console.error("Update custom bar item failed:", err));
}
function deleteCustomBarItem(id) {
  if (!confirm("Delete this item?")) return;
  db.customBarItems = db.customBarItems.filter((x) => x.id !== id);
  fsdb
    .collection("customBarItems")
    .doc(id)
    .delete()
    .catch((err) => console.error("Delete custom bar item failed:", err));
  renderPortalBody();
}

/* ============================================================
   SOUP MENU ADMIN (master edits; Kitchen / Kitchen & Floor employees view only)
   ============================================================ */
function soupMenuAdminHTML() {
  const editable = session.isMaster;
  const base = new Date();
  base.setDate(1);
  base.setMonth(base.getMonth() + soupAdminMonthOffset);
  const monthKey = `${base.getFullYear()}-${pad(base.getMonth() + 1)}`;
  const sw = db.settings.showWeekendsSoup;
  return `<h2 class="section-title">Soup Menu Calendar</h2>
    ${carouselNavHTML({
      prevLabel: "← Prev",
      nextLabel: "Next →",
      dateLabel: `${MONTHS[base.getMonth()]} ${base.getFullYear()}`,
      prevOnclick: "soupAdminMonthOffset--;renderPortalBody()",
      nextOnclick: "soupAdminMonthOffset++;renderPortalBody()",
      todayOnclick: "soupAdminMonthOffset=0;renderPortalBody()",
      showToday: soupAdminMonthOffset !== 0,
    })}
    ${
      editable
        ? `<label class="weekend-toggle"><input type="checkbox" ${
            sw ? "checked" : ""
          } onchange="db.settings.showWeekendsSoup=this.checked;renderPortalBody()"> Show Weekends (Sat &amp; Sun)</label>`
        : ""
    }
    <div class="soup-cal-wrap">
      <div class="soup-cal-dow cols-${sw ? 7 : 5}">${dowHeaderHTML(sw)}</div>
      <div class="soup-cal cols-${
        sw ? 7 : 5
      }" id="soup-admin-cal">${buildSoupCalHTML(
    monthKey,
    sw,
    canSeeSoupSource()
  )}</div>
    </div>
    ${
      editable
        ? `<p style="font-size:12.5px;color:var(--ink-soft);margin-top:10px">Click any day to set its soup.</p>`
        : `<p style="font-size:12.5px;color:var(--ink-soft);margin-top:10px">View only.</p>`
    }

    <h2 class="section-title" style="margin-top:26px">Soup List ${
      editable
        ? `<button class="btn" onclick="addSoupFlow()">+ Add Soup</button>`
        : ""
    }</h2>
    <input type="text" id="soup-list-search" class="cat-search" style="margin:0 0 10px" placeholder="Search soups…"
      value="${escHtmlAttr(soupListSearchTerm)}"
      oninput="const pos=this.selectionStart; soupListSearchTerm=this.value; renderPortalBody(); reFocusInput('soup-list-search', pos);">
    <div class="toggle-row" style="margin-bottom:12px">
      <label><input type="checkbox" ${
        soupListDietFilter.df ? "checked" : ""
      } onchange="updateSoupListDietFilter('df',this.checked)"> Dairy Free</label>
      <label><input type="checkbox" ${
        soupListDietFilter.gf ? "checked" : ""
      } onchange="updateSoupListDietFilter('gf',this.checked)"> Gluten Free</label>
      <label><input type="checkbox" ${
        soupListDietFilter.v ? "checked" : ""
      } onchange="updateSoupListDietFilter('v',this.checked)"> Vegetarian</label>
    </div>
    ${
      db.soups
        .filter(
          (s) =>
            (!soupListSearchTerm ||
              s.name
                .toLowerCase()
                .includes(soupListSearchTerm.toLowerCase())) &&
            matchesDietFilter(s, soupListDietFilter)
        )
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(
          (
            s
          ) => `<div class="card" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
      <span>${s.name} ${diettags(s)}${
            s.soldOut
              ? ' <span style="color:var(--red-flag);font-size:11px;font-weight:700">SOLD OUT</span>'
              : ""
          }</span>
      ${
        editable
          ? `<span><button class="btn small ${
              s.soldOut ? "" : "outline"
            }" onclick="toggleSoupSoldOut('${s.id}')">${
              s.soldOut ? "Mark Available" : "Mark Sold Out"
            }</button> <button class="btn small outline" onclick="editSoup('${
              s.id
            }')">Edit</button> <button class="btn small danger" onclick="deleteSoup('${
              s.id
            }')">Delete</button></span>`
          : ""
      }
    </div>`
        )
        .join("") || '<p class="empty-note">No soups match that search.</p>'
    }
    ${editable ? soupSizesAdminHTML() : ""}`;
}
function toggleSoupSoldOut(id) {
  const s = db.soups.find((x) => x.id === id);
  if (!s) return;
  s.soldOut = !s.soldOut;
  fsdb
    .collection("soups")
    .doc(id)
    .update({ soldOut: s.soldOut })
    .catch((err) => console.error("Update sold-out status failed:", err));
  renderPortalBody();
}
function soupSizesAdminHTML() {
  return `<h2 class="section-title" style="margin-top:26px">Soup Sizes &amp; Pricing <button class="btn" onclick="addSoupSizeFlow()">+ Add Size</button></h2>
    <p style="font-size:12.5px;color:var(--ink-soft);margin-bottom:10px">Shown on the Weekly Deli Menu's Soups box. Use ↑ / ↓ to set display order.</p>
    ${
      db.soupSizes.length
        ? db.soupSizes
            .map(
              (
                s,
                i
              ) => `<div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
      <input type="text" style="width:130px" value="${escHtmlAttr(
        s.name
      )}" onchange="updateSoupSizeName('${s.id}',this.value)">
      <span style="display:flex;align-items:center;gap:6px">
        $<input type="text" style="width:70px" value="${
          s.price
        }" onchange="updateSoupSizePrice('${s.id}',this.value)">
        <button class="btn small outline" onclick="moveSoupSize('${
          s.id
        }',-1)" ${i === 0 ? "disabled" : ""}>↑</button>
        <button class="btn small outline" onclick="moveSoupSize('${s.id}',1)" ${
                i === db.soupSizes.length - 1 ? "disabled" : ""
              }>↓</button>
        <button class="btn small danger" onclick="deleteSoupSize('${
          s.id
        }')">Delete</button>
      </span>
    </div>`
            )
            .join("")
        : '<p class="empty-note">No sizes yet.</p>'
    }`;
}
function addSoupSizeFlow() {
  openModal(`<h3>Add Soup Size</h3>
    <div class="field"><label>Size name</label><input type="text" id="ss-name" placeholder="e.g. Extra Large"></div>
    <div class="field"><label>Price</label><input type="text" id="ss-price" placeholder="6.00"></div>
    <div class="modal-actions"><button class="btn" onclick="saveSoupSize()">Save</button></div>`);
}
function saveSoupSize() {
  const name = document.getElementById("ss-name").value.trim();
  if (!name) return;
  const id = newId("sz");
  const price = document.getElementById("ss-price").value.trim();
  const order =
    db.soupSizes.reduce(
      (max, s) => Math.max(max, s.order != null ? s.order : 0),
      0
    ) + 1;
  db.soupSizes.push({ id, name, price, order });
  fsdb
    .collection("soupSizes")
    .doc(id)
    .set({ name, price, order })
    .catch((err) => console.error("Save soup size failed:", err));
  closeModal();
  renderPortalBody();
}
function updateSoupSizeName(id, val) {
  const s = db.soupSizes.find((x) => x.id === id);
  if (!s) return;
  const v = val.trim();
  if (v) s.name = v;
  fsdb
    .collection("soupSizes")
    .doc(id)
    .update({ name: s.name })
    .catch((err) => console.error("Rename soup size failed:", err));
}
function moveSoupSize(id, direction) {
  if (reorderList(db.soupSizes, id, direction, "soupSizes")) renderPortalBody();
}
function updateSoupSizePrice(id, val) {
  const s = db.soupSizes.find((x) => x.id === id);
  if (!s) return;
  s.price = val;
  fsdb
    .collection("soupSizes")
    .doc(id)
    .update({ price: val })
    .catch((err) => console.error("Update soup size failed:", err));
}
function deleteSoupSize(id) {
  if (!confirm("Delete this size?")) return;
  db.soupSizes = db.soupSizes.filter((s) => s.id !== id);
  fsdb
    .collection("soupSizes")
    .doc(id)
    .delete()
    .catch((err) => console.error("Delete soup size failed:", err));
  renderPortalBody();
}
function sourceDatalistHTML() {
  const sources = [...new Set(db.soups.map((s) => s.source).filter(Boolean))];
  return `<datalist id="soup-source-list">${sources
    .map((s) => `<option value="${escHtmlAttr(s)}">`)
    .join("")}</datalist>`;
}
function addSoupFlow() {
  openModal(`<h3>Add Soup</h3>
    <div class="field"><label>Name</label><input type="text" id="sp-name"></div>
    <div class="toggle-row">
      <label><input type="checkbox" id="sp-df"> Dairy Free</label>
      <label><input type="checkbox" id="sp-gf"> Gluten Free</label>
      <label><input type="checkbox" id="sp-v"> Vegetarian</label>
    </div>
    <div class="field"><label>Source (optional)</label><input type="text" id="sp-source" list="soup-source-list">${sourceDatalistHTML()}</div>
    <div class="field"><label>Notes</label><textarea id="sp-notes"></textarea></div>
    <div class="modal-actions"><button class="btn" onclick="saveSoup()">Save</button></div>`);
}
function saveSoup() {
  const name = document.getElementById("sp-name").value.trim();
  if (!name) return;
  const id = newId("s");
  const soup = {
    name,
    df: document.getElementById("sp-df").checked,
    gf: document.getElementById("sp-gf").checked,
    v: document.getElementById("sp-v").checked,
    source: document.getElementById("sp-source").value.trim(),
    notes: document.getElementById("sp-notes").value,
  };
  db.soups.push({ id, ...soup });
  fsdb
    .collection("soups")
    .doc(id)
    .set(soup)
    .catch((err) => console.error("Save soup failed:", err));
  closeModal();
  renderPortalBody();
}
function editSoup(id) {
  const s = db.soups.find((x) => x.id === id);
  openModal(`<h3>Edit Soup</h3>
    <div class="field"><label>Name</label><input type="text" id="sp-name" value="${
      s.name
    }"></div>
    <div class="toggle-row">
      <label><input type="checkbox" id="sp-df" ${
        s.df ? "checked" : ""
      }> Dairy Free</label>
      <label><input type="checkbox" id="sp-gf" ${
        s.gf ? "checked" : ""
      }> Gluten Free</label>
      <label><input type="checkbox" id="sp-v" ${
        s.v ? "checked" : ""
      }> Vegetarian</label>
    </div>
    <div class="field"><label>Source (optional)</label><input type="text" id="sp-source" list="soup-source-list" value="${escHtmlAttr(
      s.source || ""
    )}">${sourceDatalistHTML()}</div>
    <div class="field"><label>Notes</label><textarea id="sp-notes">${
      s.notes || ""
    }</textarea></div>
    <div class="modal-actions"><button class="btn" onclick="updateSoup('${id}')">Save</button></div>`);
}
function updateSoup(id) {
  const s = db.soups.find((x) => x.id === id);
  s.name = document.getElementById("sp-name").value.trim() || s.name;
  s.df = document.getElementById("sp-df").checked;
  s.gf = document.getElementById("sp-gf").checked;
  s.v = document.getElementById("sp-v").checked;
  s.source = document.getElementById("sp-source").value.trim();
  s.notes = document.getElementById("sp-notes").value;
  fsdb
    .collection("soups")
    .doc(id)
    .update({
      name: s.name,
      df: s.df,
      gf: s.gf,
      v: s.v,
      source: s.source,
      notes: s.notes,
    })
    .catch((err) => console.error("Update soup failed:", err));
  closeModal();
  renderPortalBody();
}
function deleteSoup(id) {
  if (!confirm("Delete this soup?")) return;
  db.soups = db.soups.filter((s) => s.id !== id);
  fsdb
    .collection("soups")
    .doc(id)
    .delete()
    .catch((err) => console.error("Delete soup failed:", err));
  renderPortalBody();
}

document.getElementById("portal-body").addEventListener("click", (e) => {
  const cell = e.target.closest("#soup-admin-cal .soup-cell");
  if (cell && cell.dataset.date && session.isMaster)
    openSoupDayPicker(cell.dataset.date);
});
function dateISOHasSoup(dateISO) {
  return !!monthSoupMenu(dateISO.slice(0, 7))[dateISO];
}
function openSoupDayPicker(dateISO, term) {
  term = term || "";
  const t = term.toLowerCase();
  const options = db.soups.filter(
    (s) =>
      (!t || s.name.toLowerCase().includes(t)) &&
      matchesDietFilter(s, soupPickerDietFilter)
  );
  openModal(`<h3>Soup for ${dateISO}</h3>
    <div class="field"><input type="text" id="soup-filter" placeholder="Search soups…" value="${escAttr(
      term
    )}" oninput="openSoupDayPicker('${dateISO}', this.value)"></div>
    <div class="toggle-row" style="margin-bottom:10px">
      <label><input type="checkbox" ${
        soupPickerDietFilter.df ? "checked" : ""
      } onchange="updateSoupPickerDietFilter('${dateISO}','df',this.checked)"> Dairy Free</label>
      <label><input type="checkbox" ${
        soupPickerDietFilter.gf ? "checked" : ""
      } onchange="updateSoupPickerDietFilter('${dateISO}','gf',this.checked)"> Gluten Free</label>
      <label><input type="checkbox" ${
        soupPickerDietFilter.v ? "checked" : ""
      } onchange="updateSoupPickerDietFilter('${dateISO}','v',this.checked)"> Vegetarian</label>
    </div>
    <div class="search-panel-list">
      ${
        options.length
          ? options
              .map(
                (s) =>
                  `<div class="search-panel-row" onclick="setSoupDay('${dateISO}','${
                    s.id
                  }')"><span>${s.name}</span>${diettags(s)}</div>`
              )
              .join("")
          : '<div class="search-panel-row">No matches.</div>'
      }
      ${
        dateISOHasSoup(dateISO)
          ? `<div class="search-panel-row" style="color:var(--red-flag)" onclick="clearSoupDay('${dateISO}')">✕ Clear this day</div>`
          : ""
      }
    </div>`);
  setTimeout(() => {
    const el = document.getElementById("soup-filter");
    if (el) {
      el.focus();
      el.selectionStart = el.selectionEnd = el.value.length;
    }
  }, 0);
}
function setSoupDay(dateISO, soupId) {
  monthSoupMenu(dateISO.slice(0, 7))[dateISO] = soupId;
  fsdb
    .collection("soupMenuDays")
    .doc(dateISO)
    .set({ soupId })
    .catch((err) => console.error("Save soup day failed:", err));
  closeModal();
  renderPortalBody();
}
function clearSoupDay(dateISO) {
  delete monthSoupMenu(dateISO.slice(0, 7))[dateISO];
  fsdb
    .collection("soupMenuDays")
    .doc(dateISO)
    .delete()
    .catch((err) => console.error("Clear soup day failed:", err));
  closeModal();
  renderPortalBody();
}

/* ============================================================
   PRODUCE DEALS ADMIN (master only)
   ============================================================ */
function produceAdminHTML() {
  return `<h2 class="section-title">Produce Deals <button class="btn" onclick="addProduceFlow()">+ Add Deal</button></h2>
    <div id="produce-admin-list"></div>`;
}
function uploadProduceImage(inputEl) {
  return new Promise((resolve) => {
    const file = inputEl && inputEl.files && inputEl.files[0];
    if (!file) {
      resolve("");
      return;
    }
    const path =
      "produce/" + Date.now() + "-" + file.name.replace(/[^a-z0-9.]+/gi, "_");
    const ref = storage.ref().child(path);
    ref
      .put(file)
      .then((snap) => snap.ref.getDownloadURL())
      .then((url) => resolve(url))
      .catch((err) => {
        console.error("Image upload failed:", err);
        alert(
          "Photo upload failed — the deal will save without a photo. Check your connection and Storage Rules."
        );
        resolve("");
      });
  });
}
function addProduceFlow() {
  openModal(`<h3>Add Produce Deal</h3>
    <div class="field"><label>Produce name</label><input type="text" id="pd-name"></div>
    <div class="field"><label>Price</label><input type="text" id="pd-price" placeholder="2.49"></div>
    <div class="field"><label>Unit</label><input type="text" id="pd-unit" placeholder="lb, pk, ea."></div>
    <div class="toggle-row"><label><input type="checkbox" id="pd-organic"> Organic (unchecked = Conventional)</label></div>
    <div class="field"><label>Photo (optional)</label><input type="file" accept="image/*" id="pd-img-file"></div>
    <div class="modal-actions"><button class="btn" onclick="saveProduce()">Save</button></div>`);
}
async function saveProduce() {
  const name = document.getElementById("pd-name").value.trim();
  if (!name) return;
  const img = await uploadProduceImage(document.getElementById("pd-img-file"));
  const id = newId("p");
  const deal = {
    name,
    price: document.getElementById("pd-price").value.trim(),
    unit: document.getElementById("pd-unit").value.trim(),
    organic: document.getElementById("pd-organic").checked,
    img,
  };
  db.produceDeals.push({ id, ...deal });
  fsdb
    .collection("produce")
    .doc(id)
    .set(deal)
    .catch((err) => console.error("Save produce deal failed:", err));
  closeModal();
  renderPortalBody();
}
function editProduceDeal(id) {
  const p = db.produceDeals.find((x) => x.id === id);
  window.__clearProduceImg = false;
  openModal(`<h3>Edit Deal</h3>
    <div class="field"><label>Produce name</label><input type="text" id="pd-name" value="${
      p.name
    }"></div>
    <div class="field"><label>Price</label><input type="text" id="pd-price" value="${
      p.price
    }"></div>
    <div class="field"><label>Unit</label><input type="text" id="pd-unit" value="${
      p.unit
    }"></div>
    <div class="toggle-row"><label><input type="checkbox" id="pd-organic" ${
      p.organic ? "checked" : ""
    }> Organic (unchecked = Conventional)</label></div>
    ${
      p.img
        ? `<img src="${p.img}" class="produce-img" style="margin-bottom:8px" id="pd-img-preview">`
        : ""
    }
    <div class="field"><label>Replace photo (optional)</label><input type="file" accept="image/*" id="pd-img-file"></div>
    <div class="modal-actions">
      ${
        p.img
          ? `<button class="btn outline" onclick="window.__clearProduceImg=true;const el=document.getElementById('pd-img-preview');if(el)el.remove();">Remove Photo</button>`
          : ""
      }
      <button class="btn" onclick="updateProduce('${id}')">Save</button>
    </div>`);
}
async function updateProduce(id) {
  const p = db.produceDeals.find((x) => x.id === id);
  p.name = document.getElementById("pd-name").value.trim() || p.name;
  p.price = document.getElementById("pd-price").value.trim();
  p.unit = document.getElementById("pd-unit").value.trim();
  p.organic = document.getElementById("pd-organic").checked;
  const fileEl = document.getElementById("pd-img-file");
  if (fileEl.files && fileEl.files[0]) {
    p.img = await uploadProduceImage(fileEl);
  } else if (window.__clearProduceImg) {
    p.img = "";
  }
  window.__clearProduceImg = false;
  fsdb
    .collection("produce")
    .doc(id)
    .update({
      name: p.name,
      price: p.price,
      unit: p.unit,
      organic: p.organic,
      img: p.img,
    })
    .catch((err) => console.error("Update produce deal failed:", err));
  closeModal();
  renderPortalBody();
}
function deleteProduceDeal(id) {
  if (!confirm("Delete this deal?")) return;
  db.produceDeals = db.produceDeals.filter((p) => p.id !== id);
  fsdb
    .collection("produce")
    .doc(id)
    .delete()
    .catch((err) => console.error("Delete produce deal failed:", err));
  renderPortalBody();
}

/* ============================================================
   EMPLOYEES (master only)
   ============================================================ */
function employeesHTML() {
  return `<h2 class="section-title">Employees <button class="btn" onclick="addEmployeeFlow()">+ Add Employee</button></h2>
    <p style="font-size:12.5px;color:var(--ink-soft);margin-bottom:10px">Use ↑ / ↓ to set the order employees appear in on the Weekly Schedule (within each role group).</p>
    ${db.employees
      .map(
        (e, i) => `<div class="card">
      <h4>${e.keyholder ? "🔑 " : ""}${e.name} ${
          !e.active ? '<span class="pill inactive">Inactive</span>' : ""
        }</h4>
      <p class="pill">${
        e.role
      }</p><p style="font-size:13px;color:var(--ink-soft)">${
          e.phone || "No phone on file"
        }</p>
      <button class="btn small outline" onclick="moveEmployee('${e.id}',-1)" ${
          i === 0 ? "disabled" : ""
        }>↑</button>
      <button class="btn small outline" onclick="moveEmployee('${e.id}',1)" ${
          i === db.employees.length - 1 ? "disabled" : ""
        }>↓</button>
      <button class="btn small outline" onclick="openEmployeeDetail('${
        e.id
      }')">View Details</button>
      <button class="btn small outline" onclick="masterAddTimeOffFlow('${
        e.id
      }')">Time Off</button>
      <button class="btn small ${
        e.active ? "danger" : ""
      }" onclick="toggleEmployeeActive('${e.id}')">${
          e.active ? "Deactivate" : "Reactivate"
        }</button>
      <button class="btn small danger" onclick="deleteEmployee('${
        e.id
      }')">Delete</button>
    </div>`
      )
      .join("")}`;
}
// Swaps this employee's `order` value with the adjacent one so the Weekly
// Schedule (and this list) can be arranged in any order the master wants.
function moveEmployee(id, direction) {
  if (reorderList(db.employees, id, direction, "employees")) renderPortalBody();
}
// Master can log a time-off entry on an employee's behalf — auto-approved,
// since it's management adding it directly rather than the employee asking.
function masterAddTimeOffFlow(empId) {
  const emp = db.employees.find((e) => e.id === empId);
  openModal(`<h3>Add Time Off — ${emp.name}</h3>
    <div class="field"><label>Start Date</label><input type="date" id="mto-start-date"></div>
    <div class="field"><label>End Date</label><input type="date" id="mto-end-date"></div>
    <div class="field"><label>Start</label><input type="time" id="mto-start" value="09:00"></div>
    <div class="field"><label>End</label><input type="time" id="mto-end" value="17:00"></div>
    <div class="field"><label>Comments (optional)</label><textarea id="mto-comment"></textarea></div>
    <div class="modal-actions"><button class="btn" onclick="submitMasterTimeOff('${empId}')">Add (Auto-Approved)</button></div>`);
}
function submitMasterTimeOff(empId) {
  const startDate = document.getElementById("mto-start-date").value;
  let endDate = document.getElementById("mto-end-date").value || startDate;
  if (!startDate) return;
  if (endDate < startDate) endDate = startDate;
  const req = {
    id: newId("r"),
    employeeId: empId,
    startDate,
    endDate,
    start: document.getElementById("mto-start").value,
    end: document.getElementById("mto-end").value,
    comment: document.getElementById("mto-comment").value,
    status: "approved",
    responseComment: "Added by management",
  };
  db.timeOffRequests.push(req);
  const { id, ...rest } = req;
  fsdb
    .collection("timeOffRequests")
    .doc(id)
    .set(rest)
    .catch((err) => console.error("Save time off request failed:", err));
  closeModal();
  renderPortalBody();
}
function addEmployeeFlow() {
  openModal(`<h3>Add Employee</h3>
    <div class="field"><label>Name</label><input type="text" id="em-name"></div>
    <div class="field"><label>Username</label><input type="text" id="em-user"></div>
    <div class="field"><label>Password</label><input type="text" id="em-pass"></div>
    <div class="field"><label>Role</label>${roleSelectHTML(
      "em",
      db.roles[0]
    )}</div>
    <div class="field"><label>Phone</label><input type="text" id="em-phone"></div>
    <div class="toggle-row"><label><input type="checkbox" id="em-key"> 🔑 Keyholder</label></div>
    <div class="field"><label>Notes</label><textarea id="em-notes"></textarea></div>
    <div class="modal-actions"><button class="btn" onclick="saveEmployee()">Save</button></div>`);
}
async function saveEmployee() {
  const name = document.getElementById("em-name").value.trim();
  const username = document.getElementById("em-user").value.trim();
  const password = document.getElementById("em-pass").value || "changeme1";
  if (!name || !username) return;
  if (password.length < 6) {
    alert("Password needs to be at least 6 characters (Firebase requirement).");
    return;
  }
  const id = newId("e");
  const nextOrder =
    db.employees.reduce(
      (max, e) => Math.max(max, e.order != null ? e.order : 0),
      0
    ) + 1;
  // Profile only — the password goes to Firebase Auth via the Cloud
  // Function below, never into Firestore.
  const emp = {
    name,
    username,
    role: resolveRole("em"),
    keyholder: document.getElementById("em-key").checked,
    phone: document.getElementById("em-phone").value.trim(),
    notes: document.getElementById("em-notes").value,
    active: true,
    order: nextOrder,
    typicalSchedule: {},
    stats: {
      added: Array(12).fill(0),
      checked: Array(12).fill(0),
      pickedUp: Array(12).fill(0),
      dropped: Array(12).fill(0),
      traded: Array(12).fill(0),
    },
    statsMonthKey: `${new Date().getFullYear()}-${pad(
      new Date().getMonth() + 1
    )}`,
    createdAt: todayISO(),
  };
  db.employees.push({ id, ...emp }); // optimistic local update for instant feedback
  closeModal();
  renderPortalBody();
  try {
    await fsdb.collection("employees").doc(id).set(emp);
    await fbfunctions.httpsCallable("createEmployeeAuth")({
      username,
      password,
      employeeId: id,
    });
  } catch (err) {
    console.error("Create employee failed:", err);
    alert(
      `Employee profile saved, but creating their login failed: ${err.message}. Open their page and set a new password to retry, or delete and re-add them.`
    );
  }
}
function toggleEmployeeActive(id) {
  const e = db.employees.find((x) => x.id === id);
  if (!e) return;
  e.active = !e.active;
  fsdb
    .collection("employees")
    .doc(id)
    .update({ active: e.active })
    .catch((err) => console.error("Update employee failed:", err));
  // Also disable/enable their actual login, so "inactive" really means locked out
  fbfunctions
    .httpsCallable("updateEmployeeAuth")({
      employeeId: id,
      disabled: !e.active,
    })
    .catch((err) => console.error("Update login status failed:", err));
  renderPortalBody();
}
function deleteEmployee(id) {
  if (!confirm("Delete this employee account?")) return;
  db.employees = db.employees.filter((e) => e.id !== id);
  fbfunctions
    .httpsCallable("deleteEmployeeAuth")({ employeeId: id })
    .catch((err) => console.error("Delete login failed:", err));
  fsdb
    .collection("employees")
    .doc(id)
    .delete()
    .catch((err) => console.error("Delete employee failed:", err));
  renderPortalBody();
}

function employeeInfoEditHTML(e) {
  return `<div class="card">
    <h4>Account Info</h4>
    <div class="field"><label>Name</label><input type="text" value="${
      e.name
    }" onchange="updateEmployeeField('${e.id}','name',this.value)"></div>
    <div class="field"><label>Username</label><input type="text" value="${
      e.username
    }" onchange="updateEmployeeField('${e.id}','username',this.value)"></div>
    <div class="field"><label>Set New Password</label><input type="text" placeholder="Leave blank to keep current" onchange="setEmployeePassword('${
      e.id
    }',this.value)"></div>
    <div class="field"><label>Role</label>${roleSelectHTML("ei", e.role)}
      <button class="btn small outline" style="margin-top:8px" onclick="saveEmployeeRole('${
        e.id
      }')">Update Role</button></div>
    <div class="field"><label>Phone</label><input type="text" value="${
      e.phone || ""
    }" onchange="updateEmployeeField('${e.id}','phone',this.value)"></div>
    <div class="toggle-row"><label><input type="checkbox" ${
      e.keyholder ? "checked" : ""
    } onchange="updateEmployeeField('${
    e.id
  }','keyholder',this.checked)"> 🔑 Keyholder</label></div>
    <div class="field"><label>Notes</label><textarea onchange="updateEmployeeField('${
      e.id
    }','notes',this.value)">${e.notes || ""}</textarea></div>
  </div>`;
}
function saveEmployeeRole(id) {
  updateEmployeeField(id, "role", resolveRole("ei"));
  openEmployeeDetail(id);
}
function updateEmployeeField(id, field, value) {
  const e = db.employees.find((x) => x.id === id);
  if (!e) return;
  e[field] = value;
  const title = document.getElementById("emp-detail-title");
  if (title) title.textContent = `${e.keyholder ? "🔑 " : ""}${e.name}`;
  fsdb
    .collection("employees")
    .doc(id)
    .update({ [field]: value })
    .catch((err) => console.error("Update employee failed:", err));
  // A username change must also update their actual login credential
  if (field === "username") {
    fbfunctions
      .httpsCallable("updateEmployeeAuth")({ employeeId: id, username: value })
      .catch((err) => {
        console.error("Update login username failed:", err);
        alert(
          `Profile updated, but their login username couldn't be changed: ${err.message}`
        );
      });
  }
}
function setEmployeePassword(id, value) {
  const pw = (value || "").trim();
  if (!pw) return;
  if (pw.length < 6) {
    alert("Password needs to be at least 6 characters (Firebase requirement).");
    return;
  }
  fbfunctions
    .httpsCallable("updateEmployeeAuth")({ employeeId: id, password: pw })
    .then(() => alert("Password updated."))
    .catch((err) => {
      console.error("Set password failed:", err);
      alert(`Couldn't update the password: ${err.message}`);
    });
}

function typicalScheduleGridHTML(emp) {
  return `<div class="sched-grid with-sun" style="grid-template-columns:110px repeat(7,1fr);min-width:560px">
    <div class="sched-head">Day</div>${ALL_DAYS.map(
      (d) => `<div class="sched-head">${d}</div>`
    ).join("")}
    <div class="sched-name">Hours</div>
    ${ALL_DAYS.map((d) => {
      const t = emp.typicalSchedule[d];
      const noteText = scheduleNoteHTML(t && t.notes);
      return `<div class="sched-cell" onclick="editTypicalCell('${
        emp.id
      }','${d}')">${
        t ? `${formatTime12hr(t.start)} - ${formatTime12hr(t.end)}` : ""
      }${noteText}</div>`;
    }).join("")}
  </div>`;
}
function editTypicalCell(empId, dayKey) {
  const emp = db.employees.find((e) => e.id === empId);
  const cur = emp.typicalSchedule[dayKey];
  openModal(`<h3>${emp.name} — Typical ${dayKey}</h3>
    <div class="field"><label>Start</label><input type="time" id="tc-start" value="${
      cur ? cur.start : "09:00"
    }"></div>
    <div class="field"><label>End</label><input type="time" id="tc-end" value="${
      cur ? cur.end : "17:00"
    }"></div>
    <div class="field"><label>Note (optional)</label><textarea id="tc-notes" placeholder="e.g. Usually closes on this day…">${
      cur && cur.notes ? escHtmlAttr(cur.notes) : ""
    }</textarea></div>
    <p style="font-size:12px;color:var(--ink-soft)">This note carries over automatically whenever the 🪄 wand fills a week from this typical schedule.</p>
    <div class="modal-actions">
      ${
        cur
          ? `<button class="btn danger" onclick="clearTypicalCell('${empId}','${dayKey}')">Clear</button>`
          : ""
      }
      <button class="btn" onclick="saveTypicalCell('${empId}','${dayKey}')">Save</button>
    </div>`);
}
function saveTypicalCell(empId, dayKey) {
  const emp = db.employees.find((e) => e.id === empId);
  emp.typicalSchedule[dayKey] = {
    start: document.getElementById("tc-start").value,
    end: document.getElementById("tc-end").value,
    notes: document.getElementById("tc-notes").value.trim(),
  };
  fsdb
    .collection("employees")
    .doc(empId)
    .update({ typicalSchedule: emp.typicalSchedule })
    .catch((err) => console.error("Update employee failed:", err));
  closeModal();
  openEmployeeDetail(empId);
}
function clearTypicalCell(empId, dayKey) {
  const emp = db.employees.find((e) => e.id === empId);
  delete emp.typicalSchedule[dayKey];
  fsdb
    .collection("employees")
    .doc(empId)
    .update({ typicalSchedule: emp.typicalSchedule })
    .catch((err) => console.error("Update employee failed:", err));
  closeModal();
  openEmployeeDetail(empId);
}

function statChartHTML(values, color) {
  const total = values.reduce((a, b) => a + b, 0);
  const monthLabels = lastNMonthLabels(12);
  const max = Math.max(1, ...values);
  return `<div style="font-family:var(--font-mono);font-size:12px;color:var(--brown-light);margin-bottom:6px">Total: <strong style="color:var(--ink);font-size:14px">${total}</strong></div>
    <div class="chart-wrap">
      ${values
        .map(
          (v, i) =>
            `<div class="chart-col"><div class="chart-bar" style="height:${
              (v / max) * 50 + 4
            }px;background:${color}" title="${v}"></div><div class="chart-bar-label">${
              monthLabels[i]
            } · ${v}</div></div>`
        )
        .join("")}
    </div>`;
}

function chatCommentsHTML(e) {
  const comments = db.chatMessages
    .filter((m) => m.empId === e.id)
    .slice()
    .sort((a, b) => a.ts - b.ts);
  return comments.length
    ? comments
        .map(
          (c) =>
            `<p style="font-size:13.5px">${new Date(
              c.ts
            ).toLocaleDateString()} — "${c.text}"</p>`
        )
        .join("")
    : '<p class="empty-note">No comments yet.</p>';
}

function openEmployeeDetail(id) {
  viewingEmployeeId = id;
  const e = db.employees.find((x) => x.id === id);
  const daysSince = Math.max(
    1,
    Math.round((Date.now() - new Date(e.createdAt)) / 86400000)
  );
  const requests = db.timeOffRequests.filter((r) => r.employeeId === id);
  const daysRequested = requests.length;
  const pct = ((daysRequested / daysSince) * 100).toFixed(1);
  const approved = requests.filter((r) => r.status === "approved").length;
  const denied = requests.filter((r) => r.status === "denied").length;
  const totalDecided = approved + denied || 1;

  const el = document.getElementById("portal-body");
  el.innerHTML = `
    <button class="btn small outline" onclick="viewingEmployeeId=null;renderPortalBody()">← Back to Employees</button>
    <h2 class="section-title" id="emp-detail-title" style="margin-top:14px">${
      e.keyholder ? "🔑 " : ""
    }${e.name}</h2>
    ${employeeInfoEditHTML(e)}
    <div class="card">
      <h4>Typical Schedule</h4>
      <p style="font-size:12.5px;color:var(--ink-soft)">Click a day to set or clear this employee's usual hours. The 🪄 wand on the Scheduling tab fills a week from this.</p>
      <div style="overflow-x:auto">${typicalScheduleGridHTML(e)}</div>
    </div>
    <div class="card">
      <h4>Items Added (last 12 months)</h4>
      ${statChartHTML(e.stats.added, "var(--green-moss)")}
      <h4 style="margin-top:16px">Items Checked Off (last 12 months)</h4>
      ${statChartHTML(e.stats.checked, "var(--terracotta)")}
      <h4 style="margin-top:16px">Hours Scheduled (last 12 months)</h4>
      ${statChartHTML(hoursScheduledLast12Months(e.id), "var(--brown)")}
      <h4 style="margin-top:16px">Shifts Picked Up (last 12 months)</h4>
      ${statChartHTML(
        e.stats.pickedUp || Array(12).fill(0),
        "var(--green-deep)"
      )}
      <h4 style="margin-top:16px">Shifts Dropped (last 12 months)</h4>
      ${statChartHTML(e.stats.dropped || Array(12).fill(0), "var(--red-flag)")}
      <h4 style="margin-top:16px">Shifts Traded (last 12 months)</h4>
      ${statChartHTML(e.stats.traded || Array(12).fill(0), "var(--blue-flag)")}
    </div>
    <div class="card stat-row">
      <div class="stat-block"><div class="stat-num">${daysRequested}</div><div class="stat-label">TIME OFF REQUESTS · ${pct}% OF DAYS SINCE HIRE</div></div>
      <div class="stat-block">
        <div class="stat-num" style="color:var(--green-moss)">${approved} <span style="color:var(--red-flag);font-size:20px">/ ${denied}</span></div>
        <div class="stat-label">APPROVED / DENIED</div>
        <div class="bar"><div class="approved" style="width:${
          (approved / totalDecided) * 100
        }%"></div><div class="denied" style="width:${
    (denied / totalDecided) * 100
  }%"></div></div>
      </div>
    </div>
    <div class="card">
      <h4>Chat Comments</h4>
      ${chatCommentsHTML(e)}
    </div>
    <div class="card">
      <h4>Time Off Requests</h4>
      ${
        requests.length
          ? requests
              .slice()
              .sort((a, b) =>
                reqDateRange(b).startDate.localeCompare(
                  reqDateRange(a).startDate
                )
              )
              .map(
                (r) =>
                  `<p style="opacity:${
                    new Date(reqDateRange(r).startDate) < new Date() ? 0.55 : 1
                  }">${fmtReqDateRange(r)} ${formatTime12hr(
                    r.start
                  )} - ${formatTime12hr(r.end)} — <strong>${
                    r.status
                  }</strong> <button class="btn small outline" onclick="editTimeOffRequestFlow('${
                    r.id
                  }')">Edit</button> ${
                    r.responseComment
                      ? `<br><span style="font-size:12.5px;color:var(--ink-soft)">${r.responseComment}</span>`
                      : ""
                  }</p>`
              )
              .join("")
          : '<p class="empty-note">No requests yet.</p>'
      }
    </div>`;
  scheduleSave();
}

/* ============================================================
   SCHEDULING
   ============================================================ */
function weekSchedule(weekKey) {
  if (!db.schedule[weekKey]) db.schedule[weekKey] = {};
  return db.schedule[weekKey];
}
function scheduleDayKeys() {
  return db.settings.showSunSchedule ? [...DAY_KEYS, "SUN"] : DAY_KEYS;
}
function hoursForShift(shift) {
  if (!shift || !shift.start || !shift.end) return 0;
  const [sh, sm] = shift.start.split(":").map(Number);
  const [eh, em] = shift.end.split(":").map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60; // safety net for an overnight shift
  return mins / 60;
}
function round1(n) {
  return Math.round(n * 10) / 10;
}
// Opening trigger: 9am, Monday through Saturday (store doesn't open Sunday
// per the pickup-hours rules already in place elsewhere). Closing trigger:
// 6pm Monday-Friday, 2pm Saturday.
function isOpeningShift(dayKey, shift) {
  if (!shift || dayKey === "SUN") return false;
  const [sh, sm] = shift.start.split(":").map(Number);
  const [eh, em] = shift.end.split(":").map(Number);
  const startMin = sh * 60 + sm,
    endMin = eh * 60 + em;
  return startMin <= 9 * 60 && endMin > 9 * 60;
}
function isClosingShift(dayKey, shift) {
  if (!shift || dayKey === "SUN") return false;
  const [sh, sm] = shift.start.split(":").map(Number);
  const [eh, em] = shift.end.split(":").map(Number);
  const startMin = sh * 60 + sm,
    endMin = eh * 60 + em;
  const closeTrigger = dayKey === "SAT" ? 14 * 60 : 18 * 60;
  return startMin < closeTrigger && endMin >= closeTrigger;
}
// If empIdLosingShift is a keyholder whose shift that day covers opening
// and/or closing, and NO OTHER active keyholder covers that same trigger
// that day, giving up this shift would leave the store without a keyholder
// at open/close. Returns a human-readable warning, or '' if no conflict.
function checkKeyholderConflict(weekKey, dayKey, empIdLosingShift) {
  const emp = db.employees.find((e) => e.id === empIdLosingShift);
  if (!emp || !emp.keyholder) return "";
  const myShift = (weekSchedule(weekKey)[empIdLosingShift] || {})[dayKey];
  if (!myShift) return "";
  const opening = isOpeningShift(dayKey, myShift);
  const closing = isClosingShift(dayKey, myShift);
  if (!opening && !closing) return "";
  const otherCovers = (checkFn) =>
    db.employees.some((e) => {
      if (e.id === empIdLosingShift || !e.keyholder || !e.active) return false;
      const s = (weekSchedule(weekKey)[e.id] || {})[dayKey];
      return s && checkFn(dayKey, s);
    });
  const issues = [];
  if (opening && !otherCovers(isOpeningShift)) issues.push("opening (9 AM)");
  if (closing && !otherCovers(isClosingShift)) issues.push("closing");
  return issues.length
    ? `${emp.name} is the only scheduled keyholder covering ${issues.join(
        " and "
      )} that day.`
    : "";
}
function weeklyHoursForEmployee(weekKey, empId) {
  const sched = (db.schedule[weekKey] || {})[empId] || {};
  return Object.values(sched).reduce(
    (sum, shift) => sum + hoursForShift(shift),
    0
  );
}
// Hours scheduled in a given calendar month — computed live from the actual
// schedule data (not a running counter), so it's always accurate even after
// shifts are added, moved, or removed weeks after the fact. Correctly
// handles a week that spans two different months.
function hoursScheduledForMonth(empId, year, month) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  let total = 0;
  let cursor = new Date(first);
  while (cursor <= last) {
    const wk = weekKeyOf(cursor);
    const monday = startOfWeekMonday(cursor);
    const dayIdx = Math.round((cursor - monday) / 86400000); // 0=Mon..6=Sun
    const dayKey = ALL_DAYS[dayIdx];
    const shift = ((db.schedule[wk] || {})[empId] || {})[dayKey];
    total += hoursForShift(shift);
    cursor = addDays(cursor, 1);
  }
  return total;
}
function hoursScheduledLast12Months(empId) {
  const out = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(
      round1(hoursScheduledForMonth(empId, d.getFullYear(), d.getMonth()))
    );
  }
  return out;
}

function scheduleHTML() {
  let html = "";
  if (session.isDisplay) {
    // Bare view-only schedule — not tied to any employee, and not a master
    // admin view, so neither "My Schedule" nor Time Off management applies.
  } else if (session.isMaster) {
    html += `<label class="weekend-toggle"><input type="checkbox" ${
      db.settings.showSunSchedule ? "checked" : ""
    } onchange="db.settings.showSunSchedule=this.checked;renderPortalBody()"> Show SUN (Sundays)</label>`;
    const upcoming = db.timeOffRequests
      .filter((r) => reqDateRange(r).endDate >= todayISO())
      .sort((a, b) =>
        reqDateRange(a).startDate.localeCompare(reqDateRange(b).startDate)
      );
    const past = db.timeOffRequests
      .filter((r) => reqDateRange(r).endDate < todayISO())
      .sort((a, b) =>
        reqDateRange(b).startDate.localeCompare(reqDateRange(a).startDate)
      );
    html += `<details style="margin-top:10px">
      <summary class="section-title" style="cursor:pointer;display:inline-flex">Time Off Requests${
        upcoming.length
          ? ` <span class="pill" style="margin-left:8px">${upcoming.length}</span>`
          : ""
      }</summary>`;
    html += upcoming.length
      ? upcoming
          .map((r) => {
            const emp = db.employees.find((e) => e.id === r.employeeId);
            return `<div class="card"><strong>${
              emp ? emp.name : "—"
            }</strong> — ${fmtReqDateRange(r)} ${formatTime12hr(
              r.start
            )} - ${formatTime12hr(r.end)} — <strong>${r.status}</strong>
        ${
          r.comment
            ? `<br><span style="font-size:12.5px;color:var(--ink-soft)">${r.comment}</span>`
            : ""
        }
        <div class="modal-actions" style="justify-content:flex-start;margin-top:8px">
          ${
            r.status === "pending"
              ? `<button class="btn small" onclick="respondRequest('${r.id}','approved')">Approve</button><button class="btn small danger" onclick="respondRequest('${r.id}','denied')">Deny</button>`
              : ""
          }
          <button class="btn small outline" onclick="editTimeOffRequestFlow('${
            r.id
          }')">Edit</button>
        </div></div>`;
          })
          .join("")
      : '<p class="empty-note">No upcoming requests.</p>';
    if (past.length)
      html += `<details><summary style="cursor:pointer;font-size:13px;color:var(--brown-light)">Past requests (${
        past.length
      })</summary>${past
        .map((r) => {
          const emp = db.employees.find((e) => e.id === r.employeeId);
          return `<div class="card" style="opacity:.7"><strong>${
            emp ? emp.name : "—"
          }</strong> — ${fmtReqDateRange(r)} ${formatTime12hr(
            r.start
          )} - ${formatTime12hr(r.end)} — ${r.status}
        <button class="btn small outline" style="margin-left:8px" onclick="editTimeOffRequestFlow('${
          r.id
        }')">Edit</button></div>`;
        })
        .join("")}</details>`;
    html += `</details>`;
    html += shiftSwapSectionHTML();
  } else {
    html += `<h2 class="section-title">My Schedule <button class="btn small" onclick="requestTimeOffFlow()">Time Off Request</button> <button class="btn small outline" onclick="openShiftSwapFlow()">Request Shift Swap</button></h2>`;
    html += myUpcomingScheduleHTML();
    html += `<details style="margin-top:22px"><summary class="section-title" style="cursor:pointer;display:inline-flex;font-size:22px">My Time Off Requests</summary>${myTimeOffListHTML(
      true
    )}</details>`;
    html += shiftSwapSectionHTML();
  }

  const monday = addDays(startOfWeekMonday(new Date()), scheduleWeekOffset * 7);
  const weekKey = weekKeyOf(monday);
  const published = isWeekPublished(weekKey);
  html += `<h2 class="section-title" style="margin-top:22px">Weekly Schedule</h2>
    ${carouselNavHTML({
      prevLabel: "← Prev Week",
      nextLabel: "Next Week →",
      dateLabel: fmtWeekRange(monday),
      prevOnclick: "scheduleWeekOffset--;renderPortalBody()",
      nextOnclick: "scheduleWeekOffset++;renderPortalBody()",
      todayOnclick: "scheduleWeekOffset=0;renderPortalBody()",
      showToday: scheduleWeekOffset !== 0,
    })}
    <div style="margin:10px 0">
      ${
        session.isMaster
          ? `<button class="btn small ${
              published ? "outline" : ""
            }" onclick="toggleWeekPublished('${weekKey}')">${
              published ? "✓ Published — Unpublish" : "📢 Publish This Week"
            }</button>`
          : ""
      }
      ${
        !session.isMaster && !session.isDisplay
          ? `<button class="btn small outline" onclick="exportMyScheduleICS()">📅 Add My Shifts to Calendar</button>`
          : ""
      }
      <button class="btn small outline" onclick="printSchedule()">🖨️ Print Schedule</button>
    </div>`;
  html += weekBoxHTML(weekKey, monday);
  if (session.isMaster) html += closedDatesCalendarHTML();
  return html;
}
let closedDatesMonthOffset = 0;
function isStoreClosedOn(dateISO) {
  return db.closedDates.includes(dateISO);
}
function toggleClosedDate(dateISO) {
  const idx = db.closedDates.indexOf(dateISO);
  if (idx >= 0) {
    db.closedDates.splice(idx, 1);
    fsdb
      .collection("closedDates")
      .doc(dateISO)
      .delete()
      .catch((err) => console.error("Remove closed date failed:", err));
  } else {
    db.closedDates.push(dateISO);
    fsdb
      .collection("closedDates")
      .doc(dateISO)
      .set({ closed: true })
      .catch((err) => console.error("Add closed date failed:", err));
  }
  renderPortalBody();
}
function closedDatesCalendarHTML() {
  const base = new Date();
  base.setDate(1);
  base.setMonth(base.getMonth() + closedDatesMonthOffset);
  const monthKey = `${base.getFullYear()}-${pad(base.getMonth() + 1)}`;
  return `<h2 class="section-title" style="margin-top:26px">Store Closures</h2>
    <p style="font-size:12.5px;color:var(--ink-soft)">Click a date to toggle the store closed. Pickup is disabled entirely on closed dates — click again if it's toggled by accident.</p>
    ${carouselNavHTML({
      prevLabel: "← Prev",
      nextLabel: "Next →",
      dateLabel: `${MONTHS[base.getMonth()]} ${base.getFullYear()}`,
      prevOnclick: "closedDatesMonthOffset--;renderPortalBody()",
      nextOnclick: "closedDatesMonthOffset++;renderPortalBody()",
      todayOnclick: "closedDatesMonthOffset=0;renderPortalBody()",
      showToday: closedDatesMonthOffset !== 0,
    })}
    <div class="soup-cal-dow cols-7">${dowHeaderHTML(true)}</div>
    <div class="soup-cal cols-7">${buildClosedDatesCalHTML(monthKey)}</div>`;
}
function buildClosedDatesCalHTML(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const last = new Date(y, m, 0);
  let cells = "";
  let leadingPlaced = false;
  for (let d = 1; d <= last.getDate(); d++) {
    const date = new Date(y, m - 1, d);
    let dow = date.getDay();
    dow = dow === 0 ? 6 : dow - 1;
    if (!leadingPlaced) {
      for (let i = 0; i < dow; i++)
        cells += `<div class="soup-cell empty"></div>`;
      leadingPlaced = true;
    }
    const iso = isoDate(date);
    const closed = isStoreClosedOn(iso);
    cells += `<div class="soup-cell ${
      closed ? "closed-date" : ""
    }" style="cursor:pointer" onclick="toggleClosedDate('${iso}')">
      <div class="d">${d}</div>
      ${closed ? '<div class="closed-label">Closed</div>' : ""}
    </div>`;
  }
  return cells;
}

// Lists the logged-in employee's own shifts (today onward) across the
// current + next week, in "DAY | DATE | START to END | Notes" form.
function myUpcomingScheduleHTML() {
  const rows = [];
  for (let w = 0; w < 2; w++) {
    const monday = addDays(startOfWeekMonday(new Date()), w * 7);
    const weekKey = weekKeyOf(monday);
    if (!isWeekPublished(weekKey)) continue; // this function is only ever called for employees — never leak a draft week here
    const mySched = weekSchedule(weekKey)[session.employeeId] || {};
    scheduleDayKeys().forEach((dk, i) => {
      const date = addDays(monday, i);
      const iso = isoDate(date);
      if (iso < todayISO()) return;
      const shift = mySched[dk];
      if (shift) rows.push({ weekKey, date, iso, dk, shift });
    });
  }
  rows.sort((a, b) => a.iso.localeCompare(b.iso));
  return `<div class="card">
    <h4>My Upcoming Shifts (next 2 weeks)</h4>
    ${
      rows.length
        ? rows
            .map(
              (
                r
              ) => `<p style="font-size:13.5px;margin:6px 0;display:flex;align-items:center;gap:6px">
      <span>${r.dk} | ${fmtShort(r.date)} | ${formatTime12hr(
                r.shift.start
              )} to ${formatTime12hr(r.shift.end)}${
                r.shift.notes ? ` | ${r.shift.notes}` : ""
              }</span>
      <button class="crew-btn" title="Who's working with me" onclick="openCrewModal('${
        r.weekKey
      }','${
                r.dk
              }')"><svg viewBox="0 0 24 24"><circle cx="12" cy="7" r="4"/><path d="M4 21v-1a8 8 0 0116 0v1"/></svg></button>
    </p>`
            )
            .join("")
        : '<p class="empty-note">No upcoming shifts scheduled.</p>'
    }
  </div>`;
}
// Anyone else (besides me) scheduled that same day whose shift overlaps in
// time with mine — used by the crew button next to each upcoming shift.
function crewForShift(weekKey, dayKey, empId) {
  const sched = weekSchedule(weekKey);
  const myShift = (sched[empId] || {})[dayKey];
  if (!myShift) return [];
  const [msh, msm] = myShift.start.split(":").map(Number);
  const [meh, mem] = myShift.end.split(":").map(Number);
  const myStart = msh * 60 + msm,
    myEnd = meh * 60 + mem;
  const crew = [];
  db.employees
    .filter((e) => e.active && e.id !== empId)
    .forEach((e) => {
      const s = (sched[e.id] || {})[dayKey];
      if (!s) return;
      const [sh, sm] = s.start.split(":").map(Number);
      const [eh, em] = s.end.split(":").map(Number);
      const start = sh * 60 + sm,
        end = eh * 60 + em;
      if (start < myEnd && end > myStart) crew.push({ emp: e, shift: s });
    });
  return crew;
}
function openCrewModal(weekKey, dayKey) {
  const crew = crewForShift(weekKey, dayKey, session.employeeId);
  openModal(`<h3>Working With You — ${refDateLabel({ weekKey, dayKey })}</h3>
    <div class="search-panel-list">
      ${
        crew.length
          ? crew
              .map(
                (c) => `<div class="search-panel-row" style="display:block">
        <strong>${c.emp.name}</strong> — ${formatTime12hr(
                  c.shift.start
                )} to ${formatTime12hr(c.shift.end)}
      </div>`
              )
              .join("")
          : '<div class="search-panel-row">Nobody else scheduled at the same time that day.</div>'
      }
    </div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Close</button></div>`);
}

// Same shape as myUpcomingScheduleHTML's data-gathering, but reusable for
// any employee — needed for the shift-swap picker to show both "my shifts"
// and "their shifts".
function getUpcomingShiftsForEmployee(empId) {
  const rows = [];
  for (let w = 0; w < 2; w++) {
    const monday = addDays(startOfWeekMonday(new Date()), w * 7);
    const weekKey = weekKeyOf(monday);
    if (!isWeekPublished(weekKey)) continue; // never offer a draft week's shifts for trading
    const sched = weekSchedule(weekKey)[empId] || {};
    scheduleDayKeys().forEach((dk, i) => {
      const date = addDays(monday, i);
      const iso = isoDate(date);
      if (iso < todayISO()) return;
      const shift = sched[dk];
      if (shift) rows.push({ weekKey, dayKey: dk, iso, date, shift });
    });
  }
  rows.sort((a, b) => a.iso.localeCompare(b.iso));
  return rows;
}
function refDateLabel(ref) {
  if (!ref) return "";
  const monday = new Date(ref.weekKey + "T00:00");
  const idx = ALL_DAYS.indexOf(ref.dayKey);
  const date = addDays(monday, idx);
  return `${ref.dayKey} ${fmtShort(date)}`;
}

/* ---- Creating a swap request ---- */
let swapFlowState = null;
function openShiftSwapFlow() {
  swapFlowState = {
    type: "trade",
    targetId: "",
    requesterShift: null,
    targetShift: null,
    comment: "",
  };
  renderShiftSwapFlow();
}
function renderShiftSwapFlow() {
  const others = db.employees.filter(
    (e) => e.active && e.id !== session.employeeId
  );
  openModal(`<h3>Request Shift Swap</h3>
    <div class="field"><label>Type</label><select id="ss-type" onchange="swapFlowState.type=this.value;swapFlowState.requesterShift=null;swapFlowState.targetShift=null;renderShiftSwapFlow()">
      <option value="trade" ${
        swapFlowState.type === "trade" ? "selected" : ""
      }>Trade shifts</option>
      <option value="giveaway" ${
        swapFlowState.type === "giveaway" ? "selected" : ""
      }>Give away my shift</option>
      <option value="pickup" ${
        swapFlowState.type === "pickup" ? "selected" : ""
      }>Request their shift</option>
    </select></div>
    <div class="field"><label>Other employee</label><select id="ss-target" onchange="swapFlowState.targetId=this.value;swapFlowState.requesterShift=null;swapFlowState.targetShift=null;renderShiftSwapFlow()">
      <option value="">— choose —</option>
      ${others
        .map(
          (e) =>
            `<option value="${e.id}" ${
              swapFlowState.targetId === e.id ? "selected" : ""
            }>${e.name}</option>`
        )
        .join("")}
    </select></div>
    ${swapFlowState.targetId ? shiftPickerSectionHTML() : ""}
    <div class="field"><label>Comment (optional)</label><input type="text" id="ss-comment" value="${escHtmlAttr(
      swapFlowState.comment
    )}" onchange="swapFlowState.comment=this.value"></div>
    <div class="modal-actions">
      <button class="btn outline" onclick="closeModal()">Cancel</button>
      <button class="btn" ${
        canSubmitSwap() ? "" : "disabled"
      } onclick="submitShiftSwap()">Send Request</button>
    </div>`);
}
function shiftPickerSectionHTML() {
  const type = swapFlowState.type;
  let html = "";
  if (type === "trade" || type === "giveaway") {
    const mine = getUpcomingShiftsForEmployee(session.employeeId);
    html += `<div class="field"><label>My shift</label>
      <div class="search-panel-list" style="max-height:150px">
        ${
          mine.length
            ? mine
                .map((r) => {
                  const picked =
                    swapFlowState.requesterShift &&
                    swapFlowState.requesterShift.weekKey === r.weekKey &&
                    swapFlowState.requesterShift.dayKey === r.dayKey;
                  return `<div class="search-panel-row" style="${
                    picked ? "background:var(--green-pale)" : ""
                  }" onclick="selectSwapShift('requesterShift','${
                    r.weekKey
                  }','${r.dayKey}')">${r.dayKey} ${fmtShort(
                    r.date
                  )} — ${formatTime12hr(r.shift.start)} to ${formatTime12hr(
                    r.shift.end
                  )}</div>`;
                })
                .join("")
            : '<div class="search-panel-row">No upcoming shifts.</div>'
        }
      </div>
    </div>`;
  }
  if (type === "trade" || type === "pickup") {
    const theirs = getUpcomingShiftsForEmployee(swapFlowState.targetId);
    html += `<div class="field"><label>Their shift</label>
      <div class="search-panel-list" style="max-height:150px">
        ${
          theirs.length
            ? theirs
                .map((r) => {
                  const picked =
                    swapFlowState.targetShift &&
                    swapFlowState.targetShift.weekKey === r.weekKey &&
                    swapFlowState.targetShift.dayKey === r.dayKey;
                  return `<div class="search-panel-row" style="${
                    picked ? "background:var(--green-pale)" : ""
                  }" onclick="selectSwapShift('targetShift','${r.weekKey}','${
                    r.dayKey
                  }')">${r.dayKey} ${fmtShort(r.date)} — ${formatTime12hr(
                    r.shift.start
                  )} to ${formatTime12hr(r.shift.end)}</div>`;
                })
                .join("")
            : '<div class="search-panel-row">No upcoming shifts.</div>'
        }
      </div>
    </div>`;
  }
  return html;
}
function selectSwapShift(field, weekKey, dayKey) {
  swapFlowState[field] = { weekKey, dayKey };
  renderShiftSwapFlow();
}
function canSubmitSwap() {
  if (!swapFlowState || !swapFlowState.targetId) return false;
  if (swapFlowState.type === "trade")
    return !!(swapFlowState.requesterShift && swapFlowState.targetShift);
  if (swapFlowState.type === "giveaway") return !!swapFlowState.requesterShift;
  if (swapFlowState.type === "pickup") return !!swapFlowState.targetShift;
  return false;
}
function submitShiftSwap() {
  if (!canSubmitSwap()) return;
  const kind = swapFlowState.type === "trade" ? "trade" : "transfer";
  const req = {
    kind,
    requesterId: session.employeeId,
    targetId: swapFlowState.targetId,
    requesterShiftRef: swapFlowState.requesterShift || null,
    targetShiftRef: swapFlowState.targetShift || null,
    status: "pending_employee",
    requesterComment: swapFlowState.comment || "",
    targetComment: "",
    masterComment: "",
    keyholderConflict: "",
    createdAt: new Date().toISOString(),
  };
  const id = newId("sw");
  db.shiftSwaps.push({ id, ...req });
  fsdb
    .collection("shiftSwaps")
    .doc(id)
    .set(req)
    .catch((err) => console.error("Save shift swap failed:", err));
  swapFlowState = null;
  closeModal();
  renderPortalBody();
}

/* ---- Responding to a swap request ---- */
// The other employee approves/denies first. Denying ends it right there —
// nothing goes to master. Approving forwards it to master, and that's the
// point the keyholder-coverage conflict actually gets checked (against
// whichever shift(s) are actually being given up).
function respondShiftSwapAsEmployee(id, approve) {
  const r = db.shiftSwaps.find((x) => x.id === id);
  if (!r) return;
  const comment =
    prompt(
      `Add a comment for this ${approve ? "approval" : "denial"} (optional):`
    ) || "";
  r.targetComment = comment;
  if (!approve) {
    r.status = "denied_by_employee";
  } else {
    r.status = "pending_master";
    const conflicts = [];
    if (r.requesterShiftRef) {
      const c = checkKeyholderConflict(
        r.requesterShiftRef.weekKey,
        r.requesterShiftRef.dayKey,
        r.requesterId
      );
      if (c) conflicts.push(c);
    }
    if (r.targetShiftRef) {
      const c = checkKeyholderConflict(
        r.targetShiftRef.weekKey,
        r.targetShiftRef.dayKey,
        r.targetId
      );
      if (c) conflicts.push(c);
    }
    r.keyholderConflict = conflicts.join(" ");
  }
  fsdb
    .collection("shiftSwaps")
    .doc(id)
    .update({
      status: r.status,
      targetComment: r.targetComment,
      keyholderConflict: r.keyholderConflict,
    })
    .catch((err) => console.error("Update shift swap failed:", err));
  renderPortalBody();
}
// Master has final say. Approving actually changes the schedule; denying
// just closes the request out with nothing changed.
function respondShiftSwapAsMaster(id, approve) {
  const r = db.shiftSwaps.find((x) => x.id === id);
  if (!r) return;
  const comment =
    prompt(
      `Add a comment for this ${approve ? "approval" : "denial"} (optional):`
    ) || "";
  r.masterComment = comment;
  if (!approve) {
    r.status = "denied_by_master";
    fsdb
      .collection("shiftSwaps")
      .doc(id)
      .update({ status: r.status, masterComment: r.masterComment })
      .catch((err) => console.error("Update shift swap failed:", err));
    renderPortalBody();
    return;
  }
  r.status = "approved";
  applyShiftSwap(r);
  fsdb
    .collection("shiftSwaps")
    .doc(id)
    .update({ status: r.status, masterComment: r.masterComment })
    .catch((err) => console.error("Update shift swap failed:", err));
  renderPortalBody();
}
// Actually moves the shift(s) on the schedule. A trade swaps two shifts
// between the two employees; a transfer moves one shift from whoever has
// it to whoever's picking it up. Records the matching stat on each
// employee involved (traded / dropped+pickedUp).
function applyShiftSwap(r) {
  const batch = fsdb.batch();
  if (r.kind === "trade") {
    const reqRef = r.requesterShiftRef,
      tgtRef = r.targetShiftRef;
    const reqShift = (weekSchedule(reqRef.weekKey)[r.requesterId] || {})[
      reqRef.dayKey
    ];
    const tgtShift = (weekSchedule(tgtRef.weekKey)[r.targetId] || {})[
      tgtRef.dayKey
    ];
    if (!reqShift || !tgtShift) return; // one side's shift changed/vanished since the request was made — bail safely, nothing applied
    if (!weekSchedule(reqRef.weekKey)[r.targetId])
      weekSchedule(reqRef.weekKey)[r.targetId] = {};
    if (!weekSchedule(tgtRef.weekKey)[r.requesterId])
      weekSchedule(tgtRef.weekKey)[r.requesterId] = {};
    delete weekSchedule(reqRef.weekKey)[r.requesterId][reqRef.dayKey];
    delete weekSchedule(tgtRef.weekKey)[r.targetId][tgtRef.dayKey];
    weekSchedule(tgtRef.weekKey)[r.requesterId][tgtRef.dayKey] = tgtShift;
    weekSchedule(reqRef.weekKey)[r.targetId][reqRef.dayKey] = reqShift;
    batch.delete(
      fsdb
        .collection("scheduleShifts")
        .doc(`${reqRef.weekKey}__${r.requesterId}__${reqRef.dayKey}`)
    );
    batch.delete(
      fsdb
        .collection("scheduleShifts")
        .doc(`${tgtRef.weekKey}__${r.targetId}__${tgtRef.dayKey}`)
    );
    batch.set(
      fsdb
        .collection("scheduleShifts")
        .doc(`${tgtRef.weekKey}__${r.requesterId}__${tgtRef.dayKey}`),
      tgtShift
    );
    batch.set(
      fsdb
        .collection("scheduleShifts")
        .doc(`${reqRef.weekKey}__${r.targetId}__${reqRef.dayKey}`),
      reqShift
    );
    batch
      .commit()
      .catch((err) => console.error("Apply shift trade failed:", err));
    recordStatForEmployee(r.requesterId, "traded");
    recordStatForEmployee(r.targetId, "traded");
  } else {
    const giving = r.requesterShiftRef ? r.requesterId : r.targetId;
    const receiving = r.requesterShiftRef ? r.targetId : r.requesterId;
    const ref = r.requesterShiftRef || r.targetShiftRef;
    const shift = (weekSchedule(ref.weekKey)[giving] || {})[ref.dayKey];
    if (!shift) return; // shift changed/vanished since the request was made
    if (!weekSchedule(ref.weekKey)[receiving])
      weekSchedule(ref.weekKey)[receiving] = {};
    delete weekSchedule(ref.weekKey)[giving][ref.dayKey];
    weekSchedule(ref.weekKey)[receiving][ref.dayKey] = shift;
    batch.delete(
      fsdb
        .collection("scheduleShifts")
        .doc(`${ref.weekKey}__${giving}__${ref.dayKey}`)
    );
    batch.set(
      fsdb
        .collection("scheduleShifts")
        .doc(`${ref.weekKey}__${receiving}__${ref.dayKey}`),
      shift
    );
    batch
      .commit()
      .catch((err) => console.error("Apply shift transfer failed:", err));
    recordStatForEmployee(giving, "dropped");
    recordStatForEmployee(receiving, "pickedUp");
  }
}

/* ---- Rendering ---- */
function shiftSwapDescription(r) {
  const reqEmp = db.employees.find((e) => e.id === r.requesterId);
  const tgtEmp = db.employees.find((e) => e.id === r.targetId);
  const reqName = reqEmp ? reqEmp.name : "—",
    tgtName = tgtEmp ? tgtEmp.name : "—";
  if (r.kind === "trade")
    return `${reqName} ↔ ${tgtName}: trade ${refDateLabel(
      r.requesterShiftRef
    )} for ${refDateLabel(r.targetShiftRef)}`;
  if (r.requesterShiftRef)
    return `${reqName} gives their ${refDateLabel(
      r.requesterShiftRef
    )} shift to ${tgtName}`;
  return `${reqName} requests ${tgtName}'s ${refDateLabel(
    r.targetShiftRef
  )} shift`;
}
const SWAP_STATUS_LABEL = {
  pending_employee: "Waiting on employee",
  pending_master: "Waiting on management",
  approved: "Approved",
  denied_by_employee: "Denied by employee",
  denied_by_master: "Denied by management",
};
function shiftSwapCardHTML(r) {
  const reqEmp = db.employees.find((e) => e.id === r.requesterId);
  const tgtEmp = db.employees.find((e) => e.id === r.targetId);
  const desc = shiftSwapDescription(r);
  const isTargetWaitingOnMe =
    !session.isMaster &&
    r.status === "pending_employee" &&
    r.targetId === session.employeeId;
  const isMasterWaiting = session.isMaster && r.status === "pending_master";
  let actions = "";
  if (isTargetWaitingOnMe)
    actions = `<button class="btn small" onclick="respondShiftSwapAsEmployee('${r.id}',true)">Approve</button> <button class="btn small danger" onclick="respondShiftSwapAsEmployee('${r.id}',false)">Deny</button>`;
  else if (isMasterWaiting)
    actions = `<button class="btn small" onclick="respondShiftSwapAsMaster('${r.id}',true)">Approve</button> <button class="btn small danger" onclick="respondShiftSwapAsMaster('${r.id}',false)">Deny</button>`;
  return `<div class="card" style="${
    r.status === "pending_master" ? "border-color:var(--terracotta)" : ""
  }">
    <strong>${desc}</strong><br><span style="font-size:12.5px;color:var(--ink-soft)">${
    SWAP_STATUS_LABEL[r.status] || r.status
  }</span>
    ${
      r.requesterComment
        ? `<br><span style="font-size:12.5px;color:var(--ink-soft)">${
            reqEmp ? reqEmp.name : ""
          }: ${escHtmlAttr(r.requesterComment)}</span>`
        : ""
    }
    ${
      r.targetComment
        ? `<br><span style="font-size:12.5px;color:var(--ink-soft)">${
            tgtEmp ? tgtEmp.name : ""
          }: ${escHtmlAttr(r.targetComment)}</span>`
        : ""
    }
    ${
      r.masterComment
        ? `<br><span style="font-size:12.5px;color:var(--ink-soft)">Management: ${escHtmlAttr(
            r.masterComment
          )}</span>`
        : ""
    }
    ${
      r.keyholderConflict && session.isMaster
        ? `<br><span style="font-size:12.5px;color:var(--red-flag)">🔑 ${escHtmlAttr(
            r.keyholderConflict
          )}</span>`
        : ""
    }
    ${
      actions
        ? `<div class="modal-actions" style="justify-content:flex-start;margin-top:8px">${actions}</div>`
        : ""
    }
  </div>`;
}
function shiftSwapSectionHTML() {
  if (session.isDisplay) return "";
  const mine = session.isMaster
    ? db.shiftSwaps
    : db.shiftSwaps.filter(
        (r) =>
          r.requesterId === session.employeeId ||
          r.targetId === session.employeeId
      );
  if (!mine.length) return "";
  const active = mine.filter((r) =>
    session.isMaster
      ? r.status === "pending_master"
      : r.status === "pending_employee" || r.status === "pending_master"
  );
  const past = mine.filter((r) => !active.includes(r));
  let html = `<details style="margin-top:16px" ${active.length ? "open" : ""}>
    <summary class="section-title" style="cursor:pointer;display:inline-flex;font-size:20px">Shift Swap Requests${
      active.length
        ? ` <span class="pill" style="margin-left:8px">${active.length}</span>`
        : ""
    }</summary>`;
  html += active.length
    ? active.map(shiftSwapCardHTML).join("")
    : '<p class="empty-note">Nothing pending.</p>';
  if (past.length)
    html += `<details style="margin-top:8px"><summary style="cursor:pointer;font-size:13px;color:var(--brown-light)">Past requests (${
      past.length
    })</summary>${past.map(shiftSwapCardHTML).join("")}</details>`;
  html += `</details>`;
  return html;
}

function myTimeOffListHTML(skipHeading) {
  const mine = db.timeOffRequests.filter(
    (r) => r.employeeId === session.employeeId
  );
  const upcoming = mine
    .filter((r) => reqDateRange(r).endDate >= todayISO())
    .sort((a, b) =>
      reqDateRange(a).startDate.localeCompare(reqDateRange(b).startDate)
    );
  const past = mine
    .filter((r) => reqDateRange(r).endDate < todayISO())
    .sort((a, b) =>
      reqDateRange(b).startDate.localeCompare(reqDateRange(a).startDate)
    );
  return `${
    skipHeading ? "" : '<h2 class="section-title">My Time Off Requests</h2>'
  }
    ${
      upcoming.length
        ? upcoming.map(timeOffRowHTML).join("")
        : '<p class="empty-note">No upcoming requests.</p>'
    }
    ${
      past.length
        ? `<details style="margin-top:8px"><summary style="cursor:pointer;font-size:13px;color:var(--brown-light)">Past requests (${
            past.length
          })</summary>${past.map(timeOffRowHTML).join("")}</details>`
        : ""
    }`;
}
function timeOffRowHTML(r) {
  return `<div class="timeoff-list-item">${fmtReqDateRange(r)} ${formatTime12hr(
    r.start
  )} - ${formatTime12hr(r.end)} <span class="timeoff-status ${r.status}">${
    r.status
  }</span>
    ${
      r.comment
        ? `<br><span style="font-size:12px;color:var(--ink-soft)">Reason: ${r.comment}</span>`
        : ""
    }
    ${
      r.responseComment
        ? `<br><span style="font-size:12px;color:var(--ink-soft)">Manager: ${r.responseComment}</span>`
        : ""
    }</div>`;
}

function isWeekPublished(weekKey) {
  return db.publishedWeeks.includes(weekKey);
}
function toggleWeekPublished(weekKey) {
  const idx = db.publishedWeeks.indexOf(weekKey);
  if (idx >= 0) {
    db.publishedWeeks.splice(idx, 1);
    fsdb
      .collection("publishedWeeks")
      .doc(weekKey)
      .delete()
      .catch((err) => console.error("Unpublish week failed:", err));
  } else {
    db.publishedWeeks.push(weekKey);
    fsdb
      .collection("publishedWeeks")
      .doc(weekKey)
      .set({ published: true })
      .catch((err) => console.error("Publish week failed:", err));
  }
  renderPortalBody();
}
function weekBoxHTML(weekKey, monday, hideHours) {
  // Master always sees the real, live data (so they can work ahead of
  // time) — everyone else sees nothing at all for a week until master
  // explicitly publishes it, regardless of what's actually saved.
  if (!session.isMaster && !isWeekPublished(weekKey)) {
    return `<p class="empty-note" style="padding:14px 4px">The schedule for this week hasn't been published yet — check back soon.</p>`;
  }
  const sched = weekSchedule(weekKey);
  const days = scheduleDayKeys();
  const roles = [
    ...new Set(db.employees.filter((e) => e.active).map((e) => e.role)),
  ];
  let rows = "";
  roles.forEach((role) => {
    rows += `<div class="sched-role-row">${role}</div>`;
    db.employees
      .filter((e) => e.active && e.role === role)
      .forEach((emp) => {
        const canEditRow =
          session.isMaster ||
          (!session.isMaster && session.employeeId === emp.id);
        const isSelf = !session.isMaster && session.employeeId === emp.id;
        const selfClass = isSelf ? " own-row" : "";
        const showHours = !hideHours && (session.isMaster || isSelf);
        const hoursLabel = showHours
          ? `<span class="sched-hours-label">${round1(
              weeklyHoursForEmployee(weekKey, emp.id)
            )} hrs</span>`
          : "";
        rows += `<div class="sched-name${selfClass}"><div class="sched-name-row">${
          session.isMaster && !hideHours
            ? `<button class="magic-btn" title="Fill typical schedule" onclick="magicFill('${weekKey}','${emp.id}')">🪄</button>`
            : ""
        }${
          emp.keyholder ? "🔑 " : ""
        }<span style="cursor:pointer" onclick="showProfile('${emp.id}')">${
          emp.name
        }</span></div>${hoursLabel}</div>`;
        days.forEach((dk, i) => {
          const cellData = (sched[emp.id] || {})[dk];
          const date = addDays(monday, i);
          const dateISO = isoDate(date);
          const req = db.timeOffRequests.find(
            (r) =>
              r.employeeId === emp.id &&
              reqCoversDate(r, dateISO) &&
              r.status !== "denied"
          );
          const isReq = !!req;
          const hasShift = !!cellData;
          const label = hasShift
            ? `${formatTime12hr(cellData.start)} - ${formatTime12hr(
                cellData.end
              )}${
                isReq
                  ? ` <span title="Time off also ${req.status} for part of this day" style="color:var(--terracotta)">•</span>`
                  : ""
              }`
            : isReq
            ? `Off${req.status === "pending" ? " ?" : ""}`
            : "";
          const clickable = hideHours
            ? ""
            : session.isMaster
            ? `onclick="editCell('${weekKey}','${emp.id}','${dk}','${dateISO}')"`
            : canEditRow
            ? `onclick="employeeCellClick('${weekKey}','${emp.id}','${dk}','${dateISO}')"`
            : "";
          const noteText = scheduleNoteHTML(hasShift && cellData.notes);
          rows += `<div class="sched-cell ${
            isReq && !hasShift ? "request" : ""
          }${isSelf ? " own-row" : ""}" ${clickable}>${label}${noteText}</div>`;
        });
      });
  });
  const gridClass = days.length === 7 ? "sched-grid with-sun" : "sched-grid";
  return `<div class="week-box"><div class="week-label">${fmtWeekRange(
    monday
  )}</div>
    <div class="${gridClass}">
      <div class="sched-head">Employee</div>${days
        .map(
          (d, i) =>
            `<div class="sched-head">${d} ${fmtShort(addDays(monday, i))}</div>`
        )
        .join("")}
      ${rows}
    </div></div>`;
}

function showProfile(empId) {
  const e = db.employees.find((x) => x.id === empId);
  openModal(
    `<div class="profile-pop"><h3>${e.keyholder ? "🔑 " : ""}${e.name}</h3><p>${
      e.phone || "No phone on file"
    }</p><p class="pill">${e.role}</p></div>`
  );
}

function editCell(weekKey, empId, dayKey, dateISO) {
  const emp = db.employees.find((e) => e.id === empId);
  const typical = emp.typicalSchedule[dayKey];
  const current = (weekSchedule(weekKey)[empId] || {})[dayKey];
  openModal(`<h3>${emp.name} — ${dayKey} ${dateISO}</h3>
    ${
      typical
        ? `<button class="btn small outline" onclick="applyTypical('${weekKey}','${empId}','${dayKey}')">Use typical: ${formatTime12hr(
            typical.start
          )} - ${formatTime12hr(typical.end)}</button><br><br>`
        : ""
    }
    <div class="field"><label>Start</label><input type="time" id="cell-start" value="${
      current ? current.start : typical ? typical.start : "09:00"
    }"></div>
    <div class="field"><label>End</label><input type="time" id="cell-end" value="${
      current ? current.end : typical ? typical.end : "17:00"
    }"></div>
    <div class="field"><label>Note (optional)</label><textarea id="cell-notes" placeholder="e.g. Covering for Dana, closing shift…">${
      current && current.notes ? escHtmlAttr(current.notes) : ""
    }</textarea></div>
    <div class="modal-actions">
      ${
        current
          ? `<button class="btn danger" onclick="clearCell('${weekKey}','${empId}','${dayKey}')">Clear</button>`
          : ""
      }
      <button class="btn" onclick="saveCell('${weekKey}','${empId}','${dayKey}')">Save</button>
    </div>`);
}
function saveCell(weekKey, empId, dayKey) {
  const sched = weekSchedule(weekKey);
  if (!sched[empId]) sched[empId] = {};
  const notes = document.getElementById("cell-notes").value.trim();
  const shift = {
    start: document.getElementById("cell-start").value,
    end: document.getElementById("cell-end").value,
    notes,
  };
  sched[empId][dayKey] = shift;
  fsdb
    .collection("scheduleShifts")
    .doc(`${weekKey}__${empId}__${dayKey}`)
    .set(shift)
    .catch((err) => console.error("Save shift failed:", err));
  closeModal();
  renderPortalBody();
}
function clearCell(weekKey, empId, dayKey) {
  delete weekSchedule(weekKey)[empId][dayKey];
  fsdb
    .collection("scheduleShifts")
    .doc(`${weekKey}__${empId}__${dayKey}`)
    .delete()
    .catch((err) => console.error("Clear shift failed:", err));
  closeModal();
  renderPortalBody();
}
// Exports the logged-in employee's own shifts for the currently-viewed
// week as a downloadable .ics file — same universal-file approach as the
// soup menu export, works with both Apple Calendar and Google Calendar.
// Uses floating local time (no timezone conversion), which is correct for
// a single-location business.
function exportMyScheduleICS() {
  if (session.isMaster) return;
  const monday = addDays(startOfWeekMonday(new Date()), scheduleWeekOffset * 7);
  const weekKey = weekKeyOf(monday);
  if (!isWeekPublished(weekKey)) {
    alert("This week's schedule hasn't been published yet.");
    return;
  }
  const mySched = weekSchedule(weekKey)[session.employeeId] || {};
  const entries = Object.entries(mySched);
  if (!entries.length) {
    alert("No shifts scheduled for you this week.");
    return;
  }
  const now = new Date();
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
    now.getDate()
  )}T${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}Z`;
  let ics =
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Grounded Natural Foods//Schedule//EN\r\nCALSCALE:GREGORIAN\r\n";
  entries.forEach(([dayKey, shift]) => {
    const dayIdx = ALL_DAYS.indexOf(dayKey);
    if (dayIdx < 0) return;
    const dateISO = isoDate(addDays(monday, dayIdx));
    const dtStart = `${dateISO.replace(/-/g, "")}T${shift.start.replace(
      ":",
      ""
    )}00`;
    const dtEnd = `${dateISO.replace(/-/g, "")}T${shift.end.replace(
      ":",
      ""
    )}00`;
    ics += "BEGIN:VEVENT\r\n";
    ics += `UID:shift-${weekKey}-${dayKey}-${session.employeeId}@groundedmarket.com\r\n`;
    ics += `DTSTAMP:${stamp}\r\n`;
    ics += `DTSTART:${dtStart}\r\n`;
    ics += `DTEND:${dtEnd}\r\n`;
    ics += `SUMMARY:${escapeICS("Work Shift — Grounded Natural Foods")}\r\n`;
    if (shift.notes) ics += `DESCRIPTION:${escapeICS(shift.notes)}\r\n`;
    ics += `LOCATION:${escapeICS(
      "Grounded Natural Foods, 435 S US HWY 231, Jasper IN"
    )}\r\n`;
    ics += "END:VEVENT\r\n";
  });
  ics += "END:VCALENDAR\r\n";
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `my-shifts-${weekKey}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// Builds a clean printable version of the currently-viewed week and hands
// off to the browser's native print dialog — "Save as PDF" is a standard
// destination option there on every platform, so this covers both
// "print it" and "export a PDF" without needing any external library.
// Master's printed copy never includes weekly hours totals (a physical
// printout might be posted somewhere everyone can see it); an employee's
// own printout was already hours-for-self-only on screen, so nothing
// changes for them.
function printSchedule() {
  const monday = addDays(startOfWeekMonday(new Date()), scheduleWeekOffset * 7);
  const weekKey = weekKeyOf(monday);
  const hideHours = session.isMaster;
  const gridHTML = weekBoxHTML(weekKey, monday, hideHours);
  const container = document.getElementById("print-schedule-container");
  container.innerHTML = `<h2>${fmtWeekRange(
    monday
  )} — Weekly Schedule</h2>${gridHTML}`;
  document.body.classList.add("printing-schedule");
  openModal(`<h3>Schedule Ready to Print</h3>
    <p style="color:var(--ink-soft);font-size:13.5px">Tap Print below to open your device's print dialog — choose "Save as PDF" there instead of a printer if you just want a file. If nothing opens, your browser's own Print/Share option will now also work correctly and print just this schedule.</p>
    <div class="modal-actions">
      <button class="btn outline" onclick="closeModal()">Close</button>
      <button class="btn" onclick="window.print()">🖨️ Print / Save as PDF</button>
    </div>`);
}
function applyTypical(weekKey, empId, dayKey) {
  const emp = db.employees.find((e) => e.id === empId);
  const t = emp.typicalSchedule[dayKey];
  document.getElementById("cell-start").value = t.start;
  document.getElementById("cell-end").value = t.end;
  const notesEl = document.getElementById("cell-notes");
  if (notesEl) notesEl.value = t.notes || "";
}
function magicFill(weekKey, empId) {
  const emp = db.employees.find((e) => e.id === empId);
  const sched = weekSchedule(weekKey);
  if (!sched[empId]) sched[empId] = {};
  const batch = fsdb.batch();
  Object.entries(emp.typicalSchedule).forEach(([day, val]) => {
    sched[empId][day] = { ...val };
    batch.set(
      fsdb.collection("scheduleShifts").doc(`${weekKey}__${empId}__${day}`),
      { ...val }
    );
  });
  batch.commit().catch((err) => console.error("Magic fill save failed:", err));
  renderPortalBody();
}
function employeeCellClick(weekKey, empId, dayKey, dateISO) {
  openModal(`<h3>${dayKey} ${dateISO}</h3>
    <div class="modal-actions" style="justify-content:flex-start"><button class="btn" onclick="requestTimeOffFlow('${dateISO}')">Request Time Off</button></div>`);
}
function requestTimeOffFlow(prefillDate) {
  openModal(`<h3>Request Time Off</h3>
    <div class="field"><label>Start Date</label><input type="date" id="to-start-date" value="${
      prefillDate || ""
    }"></div>
    <div class="field"><label>End Date</label><input type="date" id="to-end-date" value="${
      prefillDate || ""
    }"></div>
    <div class="field"><label>Start</label><input type="time" id="to-start" value="09:00"></div>
    <div class="field"><label>End</label><input type="time" id="to-end" value="17:00"></div>
    <div class="field"><label>Comments</label><textarea id="to-comment" placeholder="Reason for request…"></textarea></div>
    <div class="modal-actions"><button class="btn" onclick="submitTimeOff()">Submit Request</button></div>`);
}
function submitTimeOff() {
  const startDate = document.getElementById("to-start-date").value;
  let endDate = document.getElementById("to-end-date").value || startDate;
  if (!startDate) return;
  if (endDate < startDate) endDate = startDate;
  const req = {
    id: newId("r"),
    employeeId: session.employeeId,
    startDate,
    endDate,
    start: document.getElementById("to-start").value,
    end: document.getElementById("to-end").value,
    comment: document.getElementById("to-comment").value,
    status: "pending",
    responseComment: "",
  };
  db.timeOffRequests.push(req);
  const { id, ...rest } = req;
  fsdb
    .collection("timeOffRequests")
    .doc(id)
    .set(rest)
    .catch((err) => console.error("Save time off request failed:", err));
  closeModal();
  renderPortalBody();
}
function respondRequest(id, status) {
  const r = db.timeOffRequests.find((x) => x.id === id);
  const comment =
    prompt(
      `Add a comment for this ${
        status === "approved" ? "approval" : "denial"
      } (optional):`
    ) || "";
  r.status = status;
  r.responseComment = comment;
  fsdb
    .collection("timeOffRequests")
    .doc(id)
    .update({ status, responseComment: comment })
    .catch((err) => console.error("Update time off request failed:", err));
  renderPortalBody();
}
// Master can fully edit a time-off entry at any point — before or after it's
// been approved/denied — since plans change and requests need adjusting.
function editTimeOffRequestFlow(id) {
  const r = db.timeOffRequests.find((x) => x.id === id);
  if (!r) return;
  const emp = db.employees.find((e) => e.id === r.employeeId);
  const { startDate, endDate } = reqDateRange(r);
  openModal(`<h3>Edit Time Off — ${emp ? emp.name : "—"}</h3>
    <div class="field"><label>Start Date</label><input type="date" id="eto-start-date" value="${startDate}"></div>
    <div class="field"><label>End Date</label><input type="date" id="eto-end-date" value="${endDate}"></div>
    <div class="field"><label>Start</label><input type="time" id="eto-start" value="${
      r.start
    }"></div>
    <div class="field"><label>End</label><input type="time" id="eto-end" value="${
      r.end
    }"></div>
    <div class="field"><label>Status</label><select id="eto-status">
      <option value="pending" ${
        r.status === "pending" ? "selected" : ""
      }>Pending</option>
      <option value="approved" ${
        r.status === "approved" ? "selected" : ""
      }>Approved</option>
      <option value="denied" ${
        r.status === "denied" ? "selected" : ""
      }>Denied</option>
    </select></div>
    <div class="field"><label>Employee's Comment</label><textarea id="eto-comment">${escHtmlAttr(
      r.comment || ""
    )}</textarea></div>
    <div class="field"><label>Manager Comment</label><textarea id="eto-response">${escHtmlAttr(
      r.responseComment || ""
    )}</textarea></div>
    <div class="modal-actions">
      <button class="btn danger" onclick="deleteTimeOffRequest('${id}')">Delete</button>
      <button class="btn" onclick="saveTimeOffRequestEdit('${id}')">Save</button>
    </div>`);
}
function saveTimeOffRequestEdit(id) {
  const r = db.timeOffRequests.find((x) => x.id === id);
  if (!r) return;
  const { startDate, endDate } = reqDateRange(r);
  r.startDate = document.getElementById("eto-start-date").value || startDate;
  r.endDate = document.getElementById("eto-end-date").value || endDate;
  if (r.endDate < r.startDate) r.endDate = r.startDate;
  delete r.date; // fully migrated to startDate/endDate now that it's been edited
  r.start = document.getElementById("eto-start").value || r.start;
  r.end = document.getElementById("eto-end").value || r.end;
  r.status = document.getElementById("eto-status").value;
  r.comment = document.getElementById("eto-comment").value;
  r.responseComment = document.getElementById("eto-response").value;
  fsdb
    .collection("timeOffRequests")
    .doc(id)
    .set({
      startDate: r.startDate,
      endDate: r.endDate,
      employeeId: r.employeeId,
      start: r.start,
      end: r.end,
      status: r.status,
      comment: r.comment,
      responseComment: r.responseComment,
    })
    .catch((err) => console.error("Update time off request failed:", err));
  closeModal();
  if (viewingEmployeeId) openEmployeeDetail(viewingEmployeeId);
  else renderPortalBody();
}
function deleteTimeOffRequest(id) {
  if (!confirm("Delete this time off entry? This cannot be undone.")) return;
  db.timeOffRequests = db.timeOffRequests.filter((x) => x.id !== id);
  fsdb
    .collection("timeOffRequests")
    .doc(id)
    .delete()
    .catch((err) => console.error("Delete time off request failed:", err));
  closeModal();
  if (viewingEmployeeId) openEmployeeDetail(viewingEmployeeId);
  else renderPortalBody();
}

/* ============================================================
   CHAT
   ============================================================ */
function chatHTML() {
  return `<h2 class="section-title">Chat</h2>
    <div class="chat-box">
      <div class="chat-messages" id="chat-messages"></div>
      ${
        session.isDisplay
          ? ""
          : `<div class="chat-input-row">
        <input type="text" id="chat-input" placeholder="Write a message…" onkeydown="if(event.key==='Enter') sendChat()">
        <button class="btn" onclick="sendChat()">Send</button>
      </div>`
      }
    </div>`;
}
function renderChatMessages() {
  const el = document.getElementById("chat-messages");
  if (!el) return;
  el.innerHTML = db.chatMessages
    .map((m) => {
      return `<div class="chat-msg"><div class="who">${
        m.empId
          ? `<button onclick="showProfile('${m.empId}')">${m.who}</button>`
          : m.who
      } · ${new Date(m.ts).toLocaleString()}</div><div>${m.text}</div></div>`;
    })
    .join("");
  el.scrollTop = el.scrollHeight;
  scheduleSave();
}
function sendChat() {
  if (session.isDisplay) return;
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if (!text) return;
  const msg = {
    id: newId("m"),
    who: session.name.replace(" (Master)", ""),
    empId: session.isMaster ? null : session.employeeId,
    text,
    ts: Date.now(),
  };
  db.chatMessages.push(msg);
  const { id, ...rest } = msg;
  fsdb
    .collection("chatMessages")
    .doc(id)
    .set(rest)
    .catch((err) => console.error("Save chat message failed:", err));
  input.value = "";
  renderChatMessages();
}

/* ============================================================
   GLOBAL EVENT WIRING
   ============================================================ */
document.body.addEventListener("click", (e) => {
  const actionEl = e.target.closest("[data-action]");
  if (actionEl) {
    const action = actionEl.dataset.action;
    if (action === "login") showView("view-login");
    if (action === "back-public") showView("view-public");
    if (action === "logout") logout();
    if (action === "toggle-dark") toggleDarkMode();
    if (action === "add-item") addItemFlow();
    if (action === "scan-barcode") openBarcodeScanner();
    if (action === "toggle-categories") {
      expSubView = expSubView === "categories" ? "items" : "categories";
      renderPortalBody();
    }
    if (action === "deli-prev") {
      publicDeliWeekOffset--;
      renderDeliPanel();
    }
    if (action === "deli-today") {
      publicDeliWeekOffset = 0;
      renderDeliPanel();
    }
    if (action === "place-order") openPlaceOrderModal();
    if (action === "order-coffee") openCoffeeOrderModal(false);
    if (action === "deli-next") {
      publicDeliWeekOffset++;
      renderDeliPanel();
    }
    if (action === "soup-prev") {
      publicSoupMonthOffset--;
      renderSoupPanel();
    }
    if (action === "soup-today") {
      publicSoupMonthOffset = 0;
      renderSoupPanel();
    }
    if (action === "soup-next") {
      publicSoupMonthOffset++;
      renderSoupPanel();
    }
    if (action === "soup-export") exportSoupMenuICS();
  }
  const tabEl = e.target.closest(".portal-tab");
  if (tabEl) setTab(tabEl.dataset.tab);
});
document
  .getElementById("portal-search")
  .addEventListener("input", () => portalSearch());
document
  .getElementById("portal-search-date")
  .addEventListener("input", () => portalSearch());

/* ---------------------------- DARK MODE ---------------------------- */
// Sun/moon icon-only toggle, available to everyone (public + portal).
// Preference is remembered per-browser via localStorage.
const SUN_ICON =
  '<svg viewBox="0 0 24 24"><path d="M12 4a1 1 0 011 1v1a1 1 0 11-2 0V5a1 1 0 011-1zm0 14a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zm8-6a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM6 12a1 1 0 01-1 1H4a1 1 0 110-2h1a1 1 0 011 1zm11.66 6.66a1 1 0 01-1.42 0l-.7-.71a1 1 0 111.42-1.41l.7.7a1 1 0 010 1.42zM7.46 7.46a1 1 0 01-1.42 0l-.7-.71A1 1 0 016.75 5.34l.71.7a1 1 0 010 1.42zm10.2-1.42a1 1 0 010 1.42l-.7.7a1 1 0 11-1.42-1.41l.7-.7a1 1 0 011.42 0zM6.75 18.66a1 1 0 010-1.42l.71-.7a1 1 0 111.41 1.41l-.7.71a1 1 0 01-1.42 0zM12 7a5 5 0 100 10 5 5 0 000-10z"/></svg>';
const MOON_ICON =
  '<svg viewBox="0 0 24 24"><path d="M20.7 15.5A8.7 8.7 0 019.5 3.3a1 1 0 00-1.2-1.3A10.7 10.7 0 1022 16.7a1 1 0 00-1.3-1.2z"/></svg>';
function updateDarkModeIcons() {
  const isDark = document.body.classList.contains("dark-mode");
  document.querySelectorAll(".dark-toggle-icon").forEach((el) => {
    el.innerHTML = isDark ? SUN_ICON : MOON_ICON;
  });
}
function toggleDarkMode() {
  document.body.classList.toggle("dark-mode");
  localStorage.setItem(
    "groundedDarkMode",
    document.body.classList.contains("dark-mode") ? "1" : "0"
  );
  updateDarkModeIcons();
}
function initDarkMode() {
  if (localStorage.getItem("groundedDarkMode") === "1")
    document.body.classList.add("dark-mode");
  updateDarkModeIcons();
}

/* ---------------------------- INIT ---------------------------- */
// Paint immediately with the local seed defaults so the page is never blank.
// Firestore listeners attach only AFTER auth resolves, so every listener
// carries the right identity: staff sessions restore automatically across
// reloads from their server-set role claim, and everyone else (customers)
// gets a silent anonymous sign-in — enough identity to load menus and place
// orders under the security rules, nothing more.
initDarkMode();
renderPublic();
showView("view-public");
let bootDone = false;
fbauth.onAuthStateChanged(async (user) => {
  if (bootDone) return;
  if (!user) {
    fbauth
      .signInAnonymously()
      .catch((err) => console.error("Anonymous sign-in failed:", err));
    return; // onAuthStateChanged fires again once anonymous sign-in lands
  }
  bootDone = true;
  const isStaff = await buildSessionFromAuthUser(user).catch(() => false);
  initFirebaseSync();
  if (isStaff) enterPortal();
});
