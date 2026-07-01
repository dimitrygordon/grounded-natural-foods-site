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
const DOW = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_KEYS = ['MON','TUE','WED','THU','FRI','SAT']; // schedule days, Sunday added via toggle
const ALL_DAYS = ['MON','TUE','WED','THU','FRI','SAT','SUN'];
function pad(n){ return n<10 ? '0'+n : ''+n; }
function isoDate(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function todayISO(){ return isoDate(new Date()); }
function startOfWeekMonday(d){
  const date = new Date(d);
  const day = date.getDay(); // 0 Sun .. 6 Sat
  const diff = (day === 0 ? -6 : 1 - day);
  date.setDate(date.getDate()+diff);
  date.setHours(0,0,0,0);
  return date;
}
function addDays(d,n){ const nd = new Date(d); nd.setDate(nd.getDate()+n); return nd; }
function fmtShort(d){ return `${d.getMonth()+1}/${d.getDate()}`; }
function weekKeyOf(d){ return isoDate(startOfWeekMonday(d)); }
function fmtWeekRange(monday){
  const sat = addDays(monday,5);
  return `${MONTHS[monday.getMonth()].slice(0,3)} ${monday.getDate()} – ${MONTHS[sat.getMonth()].slice(0,3)} ${sat.getDate()}`;
}
function lastNMonthLabels(n){
  const out = [];
  const now = new Date();
  for(let i=n-1;i>=0;i--){
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    out.push(MONTHS[d.getMonth()].slice(0,3));
  }
  return out;
}
// Re-renders destroy and recreate every input in portal-body, which drops focus
// after a single keystroke. Any live-filter input calls this right after
// renderPortalBody() to put focus (and the cursor position) right back where
// it was, so typing feels the same as the persistent top search box.
function reFocusInput(id, cursorPos){
  const el = document.getElementById(id);
  if(el){
    el.focus();
    if(typeof cursorPos === 'number'){
      try{ el.setSelectionRange(cursorPos, cursorPos); }catch(e){}
    }
  }
}
function escHtmlAttr(s){ return (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;'); }

/* ---------------------------- DATA LAYER (mock) ---------------------------- */
const db = {
  master: { username:'Gordon', password:'4byHisgrace' },

  settings: {
    showWeekendsSoup: false,   // customer + admin soup calendar: show Sat/Sun columns
    showSunSchedule: false     // scheduling grid: show Sunday column
  },

  // Master-managed list of employee roles. Fully custom — add as many as needed.
  roles: ['Kitchen','Floor','Management'],

  employees: [
    { id:'e1', username:'jsmith', password:'welcome1', name:'Jamie Smith', role:'Kitchen', keyholder:true, phone:'812-555-0142', notes:'Opens most mornings.', active:true,
      typicalSchedule:{ MON:{start:'09:00',end:'15:00'}, WED:{start:'09:00',end:'15:00'}, THU:{start:'09:00',end:'15:00'} },
      stats:{ added:[4,5,3,6,7,5,4,3,6,5,4,5], checked:[3,4,3,5,6,4,3,3,5,4,4,4] }, createdAt:'2024-01-10' },
    { id:'e2', username:'mrogers', password:'welcome2', name:'Maria Rogers', role:'Floor', keyholder:false, phone:'812-555-0198', notes:'', active:true,
      typicalSchedule:{ TUE:{start:'11:00',end:'18:00'}, FRI:{start:'11:00',end:'18:00'}, SAT:{start:'09:00',end:'14:00'} },
      stats:{ added:[2,2,3,2,4,3,2,2,3,3,2,3], checked:[2,1,3,2,3,3,2,2,2,3,2,2] }, createdAt:'2024-03-02' },
    { id:'e3', username:'dbrooks', password:'welcome3', name:'Dana Brooks', role:'Management', keyholder:true, phone:'812-555-0177', notes:'Assistant manager.', active:true,
      typicalSchedule:{ MON:{start:'08:00',end:'16:00'}, TUE:{start:'08:00',end:'16:00'}, WED:{start:'08:00',end:'16:00'}, THU:{start:'08:00',end:'16:00'}, FRI:{start:'08:00',end:'16:00'} },
      stats:{ added:[6,7,6,8,7,6,7,6,8,7,6,7], checked:[6,6,6,7,7,6,6,6,7,7,6,6] }, createdAt:'2023-11-20' }
  ],

  categories: [
    { id:'c1', emoji:'🥫', name:'Aisle 1 — Canned & Jarred' },
    { id:'c2', emoji:'🥛', name:'Dairy Cooler' },
    { id:'c3', emoji:'🍞', name:'Bakery' },
    { id:'c4', emoji:'🧊', name:'Freezer' }
  ],

  localUpcDb: {
    '0041318111112': { brand:'Grounded Farms', description:'Local Raw Honey 12oz' }
  },

  expirationItems: [
    { id:'x1', categoryId:'c2', upc:'041318111112', brand:'Grounded Farms', description:'Local Raw Honey 12oz', count:6, date:todayISO(), done:false, flagged:false },
    { id:'x2', categoryId:'c1', upc:'037466067205', brand:'Field Day', description:'Organic Black Beans 15oz', count:10, date:isoDate(addDays(new Date(),1)), done:false, flagged:false },
    { id:'x3', categoryId:'c3', upc:'014400000135', brand:'Rudi\'s', description:'Organic Whole Wheat Bread', count:4, date:isoDate(addDays(new Date(),-1)), done:false, flagged:false },
    { id:'x4', categoryId:'c4', upc:'099482433123', brand:'Amy\'s', description:'Organic Vegetable Lasagna', count:8, date:isoDate(addDays(new Date(),2)), done:false, flagged:false }
  ],

  soups: [
    { id:'s1', name:'Tomato Basil', df:true, gf:true, v:true, notes:'' },
    { id:'s2', name:'Chicken Wild Rice', df:false, gf:false, v:false, notes:'' },
    { id:'s3', name:'Butternut Squash', df:true, gf:true, v:true, notes:'' },
    { id:'s4', name:'Broccoli Cheddar', df:false, gf:true, v:true, notes:'' },
    { id:'s5', name:'Lentil Vegetable', df:true, gf:true, v:true, notes:'' }
  ],
  // soupMenu[monthKey][isoDate] = soupId   monthKey = 'YYYY-MM'
  soupMenu: {},

  // Deli boxes are now dynamic — the master can add/rename/deactivate/delete boxes.
  // 'items' inside weeklyMenus reference IDs from deliItemLists[boxId].
  deliBoxes: [
    { id:'sandwiches', title:'Sandwiches', active:true },
    { id:'wraps', title:'Wraps', active:true },
    { id:'panini', title:'Panini', active:true },
    { id:'salads', title:'Salads', active:true },
    { id:'sideSalads', title:'Side Salads', active:true },
    { id:'bowls', title:'Nutrition Bowls', active:true }
  ],
  deliItemLists: {
    sandwiches: [
      { id:'sw1', name:'Turkey Harvest', desc:'Roast turkey, cranberry mayo, greens, on sourdough.', df:false, gf:false, v:false, img:'' },
      { id:'sw2', name:'Garden Veggie', desc:'Hummus, cucumber, sprouts, avocado, whole grain.', df:true, gf:false, v:true, img:'' },
      { id:'sw3', name:'Smoked Ham & Swiss', desc:'Smoked ham, swiss, dijon, on rye.', df:false, gf:false, v:false, img:'' }
    ],
    wraps: [
      { id:'wr1', name:'Southwest Chicken Wrap', desc:'Grilled chicken, black bean corn salsa, chipotle crema.', df:false, gf:false, v:false, img:'' },
      { id:'wr2', name:'Falafel Wrap', desc:'House falafel, tzatziki, cucumber, tomato.', df:true, gf:false, v:true, img:'' }
    ],
    panini: [
      { id:'pn1', name:'Caprese Panini', desc:'Fresh mozzarella, tomato, basil, balsamic glaze.', df:false, gf:false, v:true, img:'' }
    ],
    salads: [
      { id:'sl1', name:'Harvest Grain Bowl Salad', desc:'Farro, kale, roasted squash, pepitas, maple vinaigrette.', df:true, gf:false, v:true, img:'' }
    ],
    sideSalads: [
      { id:'ss1', name:'Cucumber Dill', desc:'Cucumber, red onion, dill, light vinaigrette.', df:true, gf:true, v:true, img:'' }
    ],
    bowls: [
      { id:'nb1', name:'Buddha Bowl', desc:'Quinoa, roasted veggies, chickpeas, tahini drizzle.', df:true, gf:true, v:true, img:'' }
    ]
  },

  // weeklyMenus[weekKey] = { [boxId]: {price, notes, items:[id..]} }
  weeklyMenus: {},

  produceDeals: [
    { id:'p1', name:'Honeycrisp Apples', price:'2.49', unit:'lb', organic:true, img:'' },
    { id:'p2', name:'Roma Tomatoes', price:'1.79', unit:'lb', organic:false, img:'' },
    { id:'p3', name:'Avocados', price:'1.25', unit:'ea', organic:true, img:'' }
  ],

  // schedule[weekKey][employeeId][DAY] = {start,end}
  schedule: {},
  timeOffRequests: [
    // {id, employeeId, date, start, end, comment, status:'pending'|'approved'|'denied', responseComment}
  ],
  chatMessages: [
    { id:'m1', who:'Dana Brooks', empId:'e3', text:'Reminder: walk-in temp log due by close today.', ts:Date.now()-3600000 }
  ]
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
  appId: "1:518382046314:web:4bd964d6bf2607cb7a8e13"
};
firebase.initializeApp(firebaseConfig);
const fsdb = firebase.firestore();
const storage = firebase.storage();

// Guards against a save→listen→save feedback loop: while we're applying data
// that just arrived FROM Firestore, scheduleSave() below is a no-op.
let applyingRemoteUpdate = false;
let saveDebounceTimer = null;
function scheduleSave(){
  if(applyingRemoteUpdate) return;
  clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(saveAllToFirestore, 500);
}
function saveAllToFirestore(){
  const w = (name, payload) => fsdb.collection('store').doc(name).set(payload).catch(err=>console.error('Firestore save failed:', name, err));
  w('categories', { list: db.categories });
  w('expirations', { items: db.expirationItems, localUpcDb: db.localUpcDb });
  w('employees', { list: db.employees });
  w('roles', { list: db.roles });
  w('soups', { list: db.soups });
  w('soupMenu', { data: db.soupMenu });
  w('deli', { boxes: db.deliBoxes, itemLists: db.deliItemLists, weeklyMenus: db.weeklyMenus });
  w('produce', { list: db.produceDeals });
  w('schedule', { data: db.schedule });
  w('timeOffRequests', { list: db.timeOffRequests });
  w('chat', { list: db.chatMessages });
  w('settings', db.settings);
}
// Live-syncs every collection. On a brand-new/empty Firestore project this
// seeds it with the sample data already in `db`; after that, every open
// tab/device shares the same live data, and edits show up everywhere
// within moments.
function bindDoc(name, applyFn, seedPayload){
  fsdb.collection('store').doc(name).onSnapshot(snap=>{
    if(snap.exists){
      applyFn(snap.data());
      afterFirestoreUpdate();
    } else {
      fsdb.collection('store').doc(name).set(seedPayload).catch(err=>console.error('Firestore seed failed:', name, err));
    }
  }, err=>console.error('Firestore listener failed:', name, err));
}
function initFirebaseSync(){
  bindDoc('categories', d=>{ db.categories = d.list||[]; }, { list: db.categories });
  bindDoc('expirations', d=>{ db.expirationItems = d.items||[]; db.localUpcDb = d.localUpcDb||{}; }, { items: db.expirationItems, localUpcDb: db.localUpcDb });
  bindDoc('employees', d=>{ db.employees = d.list||[]; }, { list: db.employees });
  bindDoc('roles', d=>{ db.roles = d.list||[]; }, { list: db.roles });
  bindDoc('soups', d=>{ db.soups = d.list||[]; }, { list: db.soups });
  bindDoc('soupMenu', d=>{ db.soupMenu = d.data||{}; }, { data: db.soupMenu });
  bindDoc('deli', d=>{ db.deliBoxes = d.boxes||[]; db.deliItemLists = d.itemLists||{}; db.weeklyMenus = d.weeklyMenus||{}; }, { boxes: db.deliBoxes, itemLists: db.deliItemLists, weeklyMenus: db.weeklyMenus });
  bindDoc('produce', d=>{ db.produceDeals = d.list||[]; }, { list: db.produceDeals });
  bindDoc('schedule', d=>{ db.schedule = d.data||{}; }, { data: db.schedule });
  bindDoc('timeOffRequests', d=>{ db.timeOffRequests = d.list||[]; }, { list: db.timeOffRequests });
  bindDoc('chat', d=>{ db.chatMessages = d.list||[]; }, { list: db.chatMessages });
  bindDoc('settings', d=>{ db.settings = { showWeekendsSoup: !!d.showWeekendsSoup, showSunSchedule: !!d.showSunSchedule }; }, db.settings);
}
// Re-renders whatever's currently on screen after data arrives from another
// device/tab. Restores the employee-detail sub-view instead of bouncing
// back to the list, if that's what was open.
function afterFirestoreUpdate(){
  applyingRemoteUpdate = true;
  if(!document.getElementById('view-public').classList.contains('hidden')){
    renderPublic();
  }
  if(session && !document.getElementById('view-portal').classList.contains('hidden')){
    if(activeTab==='Employees' && viewingEmployeeId){
      if(db.employees.find(e=>e.id===viewingEmployeeId)) openEmployeeDetail(viewingEmployeeId);
      else { viewingEmployeeId = null; renderPortalBody(); }
    } else {
      renderPortalBody();
    }
  }
  applyingRemoteUpdate = false;
}

function newId(prefix){ return prefix + Math.random().toString(36).slice(2,9); }

/* Role picker: a select of existing roles plus a "+ Add new role…" option that
   reveals a text field. Used identically on Add Employee and the employee
   detail page, so any custom role typed in either place is saved to
   db.roles and immediately available everywhere else. */
function roleSelectHTML(prefix, currentRole){
  const opts = db.roles.map(r=>`<option value="${r}" ${r===currentRole?'selected':''}>${r}</option>`).join('');
  return `<select id="${prefix}-role-select" onchange="toggleNewRoleInput('${prefix}')">${opts}<option value="__new__">+ Add new role…</option></select>
    <input type="text" id="${prefix}-role-new" class="hidden" placeholder="New role name" style="margin-top:6px">`;
}
function toggleNewRoleInput(prefix){
  const sel = document.getElementById(`${prefix}-role-select`);
  const inp = document.getElementById(`${prefix}-role-new`);
  inp.classList.toggle('hidden', sel.value !== '__new__');
  if(sel.value === '__new__') inp.focus();
}
function resolveRole(prefix){
  const sel = document.getElementById(`${prefix}-role-select`);
  if(sel.value === '__new__'){
    const val = document.getElementById(`${prefix}-role-new`).value.trim();
    if(val && !db.roles.includes(val)) db.roles.push(val);
    return val || 'General';
  }
  return sel.value;
}

function blankMenuTemplate(){
  const t = {};
  db.deliBoxes.forEach(b=>{ t[b.id] = { price:'', notes:'', items:[] }; });
  return t;
}
function weeklyMenu(weekKey){
  if(!db.weeklyMenus[weekKey]){
    const keys = Object.keys(db.weeklyMenus).sort();
    const prev = keys.length ? db.weeklyMenus[keys[keys.length-1]] : null;
    const base = prev ? JSON.parse(JSON.stringify(prev)) : blankMenuTemplate();
    db.deliBoxes.forEach(b=>{ if(!base[b.id]) base[b.id] = { price:'', notes:'', items:[] }; });
    db.weeklyMenus[weekKey] = base;
  }
  return db.weeklyMenus[weekKey];
}
// When items are added/removed for a given week+box, every already-generated
// future week mirrors that change. Past weeks are never touched.
function cascadeDeliChangeForward(weekKey, boxId){
  const items = weeklyMenu(weekKey)[boxId].items.slice();
  Object.keys(db.weeklyMenus).filter(k=>k>weekKey).sort().forEach(k=>{
    if(db.weeklyMenus[k][boxId]) db.weeklyMenus[k][boxId].items = items.slice();
  });
}

function monthSoupMenu(monthKey){
  if(!db.soupMenu[monthKey]) db.soupMenu[monthKey] = {};
  return db.soupMenu[monthKey];
}

// seed soup menu for current month with a repeating pattern MON-FRI
(function seedSoups(){
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${pad(now.getMonth()+1)}`;
  const mm = monthSoupMenu(monthKey);
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth()+1, 0);
  let cursor = new Date(first);
  let i=0;
  while(cursor <= last){
    const dow = cursor.getDay();
    if(dow>=1 && dow<=5){ mm[isoDate(cursor)] = db.soups[i % db.soups.length].id; i++; }
    cursor = addDays(cursor,1);
  }
})();

/* ---------------------------- SESSION ---------------------------- */
let session = null; // {isMaster, employeeId, name}
let activeTab = 'Expirations';
let expSubView = 'items'; // 'items' | 'categories' (master only)
let viewingEmployeeId = null; // set while an employee detail sub-view is open

/* expirations carousel state */
let catDayOffset = {};    // catId -> integer days from today
let catExpanded = {};     // catId -> bool (full list mode)
let catSearchTerm = {};   // catId -> string (only used when expanded)
let catDateFilter = {};   // catId -> ISO date string (only used when expanded)
let pastExpanded = false;
let pastDateFilter = '';
let soupListSearchTerm = '';

/* public + admin carousel offsets */
let publicDeliWeekOffset = 0;
let deliAdminWeekOffset = 0;
let publicSoupMonthOffset = 0;
let soupAdminMonthOffset = 0;
let scheduleWeekOffset = 0;

let activeScanReader = null;

/* ---------------------------- ROUTER ---------------------------- */
function showView(id){
  document.querySelectorAll('.view').forEach(v=>v.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

/* ============================================================
   PUBLIC PAGE RENDER
   ============================================================ */
function renderPublic(){
  publicDeliWeekOffset = 0;
  publicSoupMonthOffset = 0;
  renderDeliPanel();
  renderSoupPanel();
  renderProduceList('produce-list', false);
}

function diettags(o){
  let out = '';
  if(o.df) out += '<span class="tag tag-df" title="Dairy Free"></span>';
  if(o.gf) out += '<span class="tag tag-gf" title="Gluten Free"></span>';
  if(o.v) out += '<span class="tag tag-v" title="Vegetarian"></span>';
  return out;
}

/* ---- Deli (public) ---- */
function renderDeliPanel(){
  const monday = addDays(startOfWeekMonday(new Date()), publicDeliWeekOffset*7);
  document.getElementById('deli-week-range').textContent = fmtWeekRange(monday);
  renderDeliGrid(monday);
}
function renderDeliGrid(monday){
  const weekKey = weekKeyOf(monday);
  const menu = weeklyMenu(weekKey);

  const soupRows = ['MON','TUE','WED','THU','FRI'].map((label,i)=>{
    const date = addDays(monday,i);
    const mk = `${date.getFullYear()}-${pad(date.getMonth()+1)}`;
    const mm = monthSoupMenu(mk);
    const sid = mm[isoDate(date)];
    const soup = db.soups.find(s=>s.id===sid);
    return `<div class="soup-day-row"><span class="dow">${label}</span><span>${soup ? soup.name+' '+diettags(soup) : '—'}</span></div>`;
  }).join('');

  function box(boxDef){
    const data = menu[boxDef.id];
    const list = db.deliItemLists[boxDef.id] || [];
    if(!data) return '';
    const items = data.items.map(id=>{
      const item = list.find(l=>l.id===id);
      if(!item) return '';
      return `<div class="deli-item"><div class="deli-item-name">${item.name} ${diettags(item)}</div><div class="deli-item-desc">${item.desc}</div></div>`;
    }).join('');
    return `<div class="deli-box"><h3>${boxDef.title} ${data.price?`<span class="price">$${data.price}</span>`:''}</h3>${items || '<p class="empty-note">Nothing on the menu this week.</p>'}${data.notes ? `<div class="deli-notes">${data.notes}</div>`:''}</div>`;
  }

  const activeBoxes = db.deliBoxes.filter(b=>b.active);
  const mid = Math.ceil(activeBoxes.length/2) || 1;
  const colA = activeBoxes.slice(0,mid), colB = activeBoxes.slice(mid);

  document.getElementById('deli-grid').innerHTML = `
    <div class="deli-col">
      <div class="deli-box"><h3>Soups</h3>${soupRows}</div>
      ${colA.map(box).join('')}
    </div>
    <div class="deli-col">
      ${colB.map(box).join('')}
    </div>`;
}

/* ---- Soup (public) ---- */
function dowHeaderHTML(showWeekends){
  const days = showWeekends ? ['MON','TUE','WED','THU','FRI','SAT','SUN'] : ['MON','TUE','WED','THU','FRI'];
  return days.map(d=>`<span>${d}</span>`).join('');
}
function renderSoupPanel(){
  const base = new Date(); base.setDate(1); base.setMonth(base.getMonth()+publicSoupMonthOffset);
  const monthKey = `${base.getFullYear()}-${pad(base.getMonth()+1)}`;
  document.getElementById('soup-month-title').textContent = `${MONTHS[base.getMonth()]} Soups`;
  const sw = db.settings.showWeekendsSoup;
  const dowEl = document.getElementById('soup-cal-dow');
  dowEl.className = `soup-cal-dow cols-${sw?7:5}`;
  dowEl.innerHTML = dowHeaderHTML(sw);
  const calEl = document.getElementById('soup-cal');
  calEl.className = `soup-cal cols-${sw?7:5}`;
  calEl.innerHTML = buildSoupCalHTML(monthKey, sw);
}
function buildSoupCalHTML(monthKey, showWeekends){
  const [y,m] = monthKey.split('-').map(Number);
  const last = new Date(y, m, 0);
  const mm = monthSoupMenu(monthKey);
  let cells = '';
  let leadingPlaced = false;
  for(let d=1; d<=last.getDate(); d++){
    const date = new Date(y,m-1,d);
    let dow = date.getDay(); dow = dow===0?6:dow-1; // 0=Mon..6=Sun
    if(!showWeekends && dow>=5) continue; // skip Sat/Sun entirely
    if(!leadingPlaced){
      for(let i=0;i<dow;i++) cells += `<div class="soup-cell empty"></div>`;
      leadingPlaced = true;
    }
    const iso = isoDate(date);
    const soup = db.soups.find(s=>s.id===mm[iso]);
    cells += `<div class="soup-cell" data-date="${iso}">
      <div class="d">${d}</div>
      ${soup ? `<div class="s-name">${soup.name}</div><div class="s-tags">${diettags(soup)}</div>` : ''}
    </div>`;
  }
  return cells;
}

function renderProduceList(targetId, editable){
  const wrap = document.getElementById(targetId);
  if(!db.produceDeals.length){ wrap.innerHTML = '<p class="empty-note">No current deals.</p>'; return; }
  wrap.innerHTML = db.produceDeals.map(p=>`
    <div class="produce-row">
      <div class="produce-left">
        <span class="produce-name">${p.name}</span>
        <span class="${p.organic?'produce-organic':'produce-conventional'}">${p.organic?'Organic':'Conventional'}</span>
      </div>
      <span class="price-tag">$${p.price} / ${p.unit}</span>
      ${p.img ? `<img class="produce-img" src="${p.img}" alt="${p.name}">` : (editable? '' : '<span></span>')}
      ${editable ? `<span><button class="btn small outline" onclick="editProduceDeal('${p.id}')">Edit</button> <button class="btn small danger" onclick="deleteProduceDeal('${p.id}')">Delete</button></span>` : ''}
    </div>`).join('');
}

/* ============================================================
   AUTH
   ============================================================ */
function attemptLogin(){
  const u = document.getElementById('login-username').value.trim();
  const p = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  if(u===db.master.username && p===db.master.password){
    session = { isMaster:true, name:'Gordon (Master)' };
    errEl.classList.add('hidden');
    document.getElementById('login-form').reset();
    enterPortal();
    return;
  }
  const emp = db.employees.find(e=>e.username===u && e.password===p && e.active);
  if(emp){
    session = { isMaster:false, employeeId:emp.id, name:emp.name };
    errEl.classList.add('hidden');
    document.getElementById('login-form').reset();
    enterPortal();
    return;
  }
  errEl.classList.remove('hidden');
}
document.getElementById('login-form').addEventListener('submit', e=>{ e.preventDefault(); attemptLogin(); });
document.getElementById('login-submit-btn').addEventListener('click', e=>{ e.preventDefault(); attemptLogin(); });

function enterPortal(){
  activeTab = 'Expirations';
  expSubView = 'items';
  document.getElementById('portal-user').textContent = session.name;
  renderPortalTabs();
  updatePortalStickyState();
  renderPortalBody();
  showView('view-portal');
}

function logout(){ session = null; showView('view-public'); renderPublic(); }

/* ============================================================
   PORTAL SHELL
   ============================================================ */
function renderPortalTabs(){
  const tabs = session.isMaster
    ? ['Expirations','Deli Menu','Soup Menu','Produce Deals','Employees','Scheduling','Chat']
    : ['Expirations','Schedule','Chat'];
  document.getElementById('portal-tabs').innerHTML = tabs.map(t=>
    `<button class="portal-tab ${t===activeTab?'active':''}" data-tab="${t}">${t}</button>`).join('');
}

function updatePortalStickyState(){
  const sub = document.getElementById('portal-exp-subheader');
  const catBtn = document.getElementById('categories-quick-btn');
  if(activeTab==='Expirations'){
    sub.classList.remove('hidden');
    catBtn.classList.toggle('hidden', !session.isMaster);
    catBtn.textContent = expSubView==='categories' ? '← Back to Items' : 'Categories';
  } else {
    sub.classList.add('hidden');
  }
}

function setTab(t){ activeTab = t; expSubView = 'items'; viewingEmployeeId = null; renderPortalTabs(); updatePortalStickyState(); renderPortalBody(); }

function renderPortalBody(){
  const el = document.getElementById('portal-body');
  updatePortalStickyState();
  switch(activeTab){
    case 'Expirations':
      el.innerHTML = (expSubView==='categories' && session.isMaster) ? categoriesHTML() : expirationsHTML();
      break;
    case 'Deli Menu': el.innerHTML = deliMenuAdminHTML(); break;
    case 'Soup Menu': el.innerHTML = soupMenuAdminHTML(); break;
    case 'Produce Deals': el.innerHTML = produceAdminHTML(); renderProduceList('produce-admin-list', true); break;
    case 'Employees': el.innerHTML = employeesHTML(); break;
    case 'Scheduling':
    case 'Schedule': el.innerHTML = scheduleHTML(); break;
    case 'Chat': el.innerHTML = chatHTML(); renderChatMessages(); break;
    default: el.innerHTML = '';
  }
  scheduleSave();
}

/* ============================================================
   MODALS
   ============================================================ */
function openModal(html){
  document.getElementById('modal-root').innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this) closeModal()">
      <div class="modal-box">
        <button class="modal-close" onclick="closeModal()">✕</button>
        ${html}
      </div>
    </div>`;
}
function closeModal(){ stopScan(); document.getElementById('modal-root').innerHTML=''; }

/* ============================================================
   EXPIRATION TRACKER
   ============================================================ */
function categoryItems(catId){
  return db.expirationItems.filter(i=>i.categoryId===catId).sort((a,b)=>a.date.localeCompare(b.date));
}
function expItemLabel(i){
  return `${i.brand} | ${i.description} | ${i.upc} <span class="pill">×${i.count}</span>`;
}

function expirationsHTML(){
  let html = pastSectionHTML();
  if(!db.categories.length){ html += '<p class="empty-note">No categories yet.</p>'; return html; }
  html += db.categories.map(cat=>categoryBoxHTML(cat)).join('');
  html += markdownListHTML();
  return html;
}

function pastSectionHTML(){
  const items = db.expirationItems.filter(i=>i.date < todayISO());
  const filtered = pastDateFilter ? items.filter(i=>i.date===pastDateFilter) : items;
  const sorted = filtered.slice().sort((a,b)=>b.date.localeCompare(a.date));
  return `<details class="past-section" ${pastExpanded?'open':''}>
    <summary>Past Expirations (${items.length})</summary>
    <div class="past-filter">
      <label style="font-family:var(--font-mono);font-size:11.5px;color:var(--ink-soft)">Filter by date</label>
      <input type="date" value="${pastDateFilter}" onchange="pastDateFilter=this.value;pastExpanded=true;renderPortalBody()">
      ${pastDateFilter?`<button class="btn small outline" onclick="pastDateFilter='';renderPortalBody()">Clear</button>`:''}
    </div>
    ${sorted.length ? sorted.map(i=>{
      const cat = db.categories.find(c=>c.id===i.categoryId);
      return `<div style="margin-bottom:4px"><span class="pill">${cat?cat.emoji:''} ${cat?cat.name:''}</span>${expItemRow(i, i.date<todayISO() && !i.done, true)}</div>`;
    }).join('') : '<p class="empty-note">No past expirations.</p>'}
  </details>`;
}

function categoryBoxHTML(cat){
  const items = categoryItems(cat.id);
  const overdue = items.filter(i=>i.date < todayISO() && !i.done);
  const expanded = !!catExpanded[cat.id];
  const offset = catDayOffset[cat.id] || 0;
  const viewDate = isoDate(addDays(new Date(), offset));
  const viewLabel = offset===0 ? 'Today' : new Date(viewDate+'T00:00').toDateString();

  let inner = '';
  if(overdue.length){
    inner += `<div class="day-group"><div class="day-label" style="color:var(--red-flag)">PAST DUE</div>${overdue.map(i=>expItemRow(i,true,true)).join('')}</div>`;
  }

  if(expanded){
    const term = (catSearchTerm[cat.id]||'').toLowerCase();
    const dateVal = catDateFilter[cat.id] || '';
    const hasFilter = !!(term || dateVal);
    let filtered = [];
    if(hasFilter){
      filtered = items.filter(i=>{
        const textOk = !term || (i.brand+' '+i.description+' '+i.upc).toLowerCase().includes(term);
        const dateOk = !dateVal || i.date === dateVal;
        return textOk && dateOk;
      }).sort((a,b)=>b.date.localeCompare(a.date));
    }
    inner += `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
      <input type="text" id="cat-search-${cat.id}" class="cat-search" style="flex:1;min-width:160px;margin:0"
        placeholder="Search this category…" value="${escHtmlAttr(catSearchTerm[cat.id]||'')}"
        oninput="const pos=this.selectionStart; catSearchTerm['${cat.id}']=this.value; renderPortalBody(); reFocusInput('cat-search-${cat.id}', pos);">
      <input type="date" id="cat-date-${cat.id}" style="margin:0;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--cream)"
        value="${dateVal}" onchange="catDateFilter['${cat.id}']=this.value; renderPortalBody();">
    </div>`;
    inner += hasFilter
      ? `<div class="day-group">${filtered.length ? filtered.map(i=>expItemRow(i, i.date<todayISO() && !i.done, true)).join('') : '<p class="empty-note">No matches.</p>'}</div>`
      : `<p class="empty-note">Type a keyword or pick a date above to see items — the full list stays hidden by default since it can get long.</p>`;
  } else {
    const dayItems = items.filter(i=>i.date===viewDate);
    inner += `<div class="cat-daynav">
      <button class="btn small outline" onclick="catDayOffset['${cat.id}']=(catDayOffset['${cat.id}']||0)-1;renderPortalBody()">← Prev Day</button>
      <span class="cat-date-label">${viewLabel}</span>
      <button class="btn small outline" onclick="catDayOffset['${cat.id}']=(catDayOffset['${cat.id}']||0)+1;renderPortalBody()">Next Day →</button>
    </div>`;
    inner += `<div class="day-group">${dayItems.length ? dayItems.map(i=>expItemRow(i,false)).join('') : '<p class="empty-note">Nothing expiring this day.</p>'}</div>`;
  }

  inner += `<button class="show-more" onclick="catExpanded['${cat.id}']=${!expanded};renderPortalBody()">${expanded?'Show less (back to day view)':'Show more (full list)'}</button>`;

  return `<div class="category-box" data-cat="${cat.id}">
    <div class="category-head"><h3>${cat.emoji} ${cat.name}</h3><span class="exp-count">${items.length} tracked</span></div>
    <div style="padding:4px 18px 14px">${inner}</div>
  </div>`;
}

function expItemRow(item, overdue, showDate){
  const classes = ['exp-item'];
  if(item.done) classes.push('done');
  if(overdue && !item.done) classes.push('overdue');
  const flagSvg = `<svg class="flag-icon ${item.flagged?'flag-on':'flag-off'}" viewBox="0 0 24 24"><path d="M6 3v18h2v-7h9l-1.5-3.5L17 7H8V3z"/></svg>`;
  const dateLabel = showDate ? `<span class="exp-date-label">${item.date}</span>` : '';
  return `<div class="${classes.join(' ')}">
    <button class="link-chain" title="Search image" onclick="searchImage('${item.upc}','${escAttr(item.brand)}','${escAttr(item.description)}')">🔗</button>
    <span class="exp-text" onclick="toggleDone('${item.id}')">${dateLabel}${expItemLabel(item)}</span>
    <button class="icon-edit-btn" title="Edit item" onclick="event.stopPropagation();openEditExpItem('${item.id}')">✎</button>
    <button class="flag-btn" title="Markdown flag" onclick="toggleFlag('${item.id}')">${flagSvg}</button>
  </div>`;
}

function markdownListHTML(){
  const flagged = db.expirationItems.filter(i=>i.flagged);
  return `<div class="category-box"><div class="category-head"><h3>🏷️ Markdown</h3><span class="exp-count">${flagged.length} items</span></div>
    <div style="padding:4px 18px 14px">${flagged.length ? flagged.map(i=>expItemRow(i,i.date<todayISO(),true)).join('') : '<p class="empty-note">No markdown items.</p>'}</div></div>`;
}

function openEditExpItem(id){
  const i = db.expirationItems.find(x=>x.id===id);
  openModal(`<h3>Edit Item</h3>
    <div class="field"><label>Brand</label><input type="text" id="eex-brand" value="${escHtmlAttr(i.brand)}"></div>
    <div class="field"><label>Description</label><input type="text" id="eex-desc" value="${escHtmlAttr(i.description)}"></div>
    <div class="field"><label>UPC</label><input type="text" id="eex-upc" value="${escHtmlAttr(i.upc)}"></div>
    <div class="field"><label>Expiration date</label><input type="date" id="eex-date" value="${i.date}"></div>
    <div class="field"><label>Count on hand</label><input type="number" id="eex-count" min="1" value="${i.count}"></div>
    <div class="modal-actions"><button class="btn" onclick="saveEditExpItem('${id}')">Save</button></div>`);
}
function saveEditExpItem(id){
  const i = db.expirationItems.find(x=>x.id===id);
  i.brand = document.getElementById('eex-brand').value.trim() || i.brand;
  i.description = document.getElementById('eex-desc').value.trim() || i.description;
  i.upc = document.getElementById('eex-upc').value.trim() || i.upc;
  i.date = document.getElementById('eex-date').value || i.date;
  const count = parseInt(document.getElementById('eex-count').value,10);
  if(count>0) i.count = count;
  closeModal(); renderPortalBody();
}

function toggleDone(id){ const i = db.expirationItems.find(x=>x.id===id); i.done=!i.done; renderPortalBody(); }
function escAttr(s){ return (s||'').replace(/'/g,"\\'"); }
function searchImage(upc, brand, desc){
  const q = encodeURIComponent(`${upc} ${brand} ${desc}`);
  window.open(`https://www.google.com/search?tbm=isch&q=${q}`, '_blank');
}
function toggleFlag(id){
  const item = db.expirationItems.find(x=>x.id===id);
  if(!item.flagged){
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
    renderPortalBody();
  }
}
function applyCustomMarkdown(id){
  const val = parseInt(document.getElementById('custom-md-days').value,10);
  if(!val || val<1) return;
  applyMarkdown(id, val);
}
function applyMarkdown(id, days){
  const item = db.expirationItems.find(x=>x.id===id);
  const base = new Date(item.date+'T00:00');
  item.date = isoDate(addDays(base, days));
  item.flagged = true;
  closeModal();
  renderPortalBody();
}

/* --- Add item flow (barcode scan via ZXing — works in Safari/iOS, unlike BarcodeDetector) --- */
function addItemFlow(){
  const catOptions = db.categories.map(c=>`<option value="${c.id}">${c.emoji} ${c.name}</option>`).join('');
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
  document.getElementById('ai-upc').addEventListener('change', lookupUpc);
}

function lookupUpc(){
  const upc = document.getElementById('ai-upc').value.trim();
  if(!upc) return;
  if(db.localUpcDb[upc]){
    document.getElementById('ai-brand').value = db.localUpcDb[upc].brand;
    document.getElementById('ai-desc').value = db.localUpcDb[upc].description;
    return;
  }
  fetch(`https://world.openfoodfacts.org/api/v2/product/${upc}.json`)
    .then(r=>r.json())
    .then(data=>{
      if(data && data.product){
        document.getElementById('ai-brand').value = data.product.brands || '';
        document.getElementById('ai-desc').value = data.product.product_name || '';
      }
    })
    .catch(()=>{ /* fall back silently to manual entry */ });
}

function startScan(){
  const area = document.getElementById('scan-area');
  if(typeof ZXing === 'undefined'){
    alert("Barcode scanner didn't load. Enter the UPC manually below.");
    return;
  }
  area.innerHTML = `<video id="scan-video" style="width:100%;border-radius:8px;background:#000" muted playsinline autoplay></video>
    <p style="font-size:12px;color:var(--ink-soft);margin-top:6px">Point the camera at a barcode…</p>`;
  const codeReader = new ZXing.BrowserMultiFormatReader();
  activeScanReader = codeReader;
  codeReader.decodeFromConstraints({ video:{ facingMode:'environment' } }, 'scan-video', (result, err)=>{
    if(result){
      const text = result.getText();
      stopScan();
      document.getElementById('ai-upc').value = text;
      lookupUpc();
      area.innerHTML = `<p style="color:var(--green-deep)">✓ UPC captured: ${text}</p>`;
    }
  }).catch(()=>{
    alert('Camera access was denied or unavailable. Enter the UPC manually.');
  });
}
function stopScan(){
  if(activeScanReader){ try{ activeScanReader.reset(); }catch(e){} activeScanReader = null; }
}

function submitAddItem(e){
  e.preventDefault();
  const upc = document.getElementById('ai-upc').value.trim();
  const brand = document.getElementById('ai-brand').value.trim();
  const desc = document.getElementById('ai-desc').value.trim();
  const count = parseInt(document.getElementById('ai-count').value,10);
  const date = document.getElementById('ai-date').value;
  const categoryId = document.getElementById('ai-cat').value;

  db.localUpcDb[upc] = { brand, description:desc }; // save for next time

  const dup = db.expirationItems.find(i=>i.upc===upc && i.date===date);
  if(dup){
    closeModal();
    setTimeout(()=>{
      openModal(`<h3>Possible duplicate</h3><p>${brand} — ${desc} already has an entry expiring ${date}. Add it anyway?</p>
        <div class="modal-actions"><button class="btn outline" onclick="closeModal()">Cancel</button>
        <button class="btn" onclick="finishAddItem('${upc}','${escAttr(brand)}','${escAttr(desc)}',${count},'${date}','${categoryId}')">Add Anyway</button></div>`);
    },50);
    return;
  }
  finishAddItem(upc,brand,desc,count,date,categoryId);
}
function finishAddItem(upc,brand,desc,count,date,categoryId){
  db.expirationItems.push({ id:newId('x'), categoryId, upc, brand, description:desc, count, date, done:false, flagged:false });
  closeModal();
  openModal(`<h3>✓ Added</h3><p>${brand} — ${desc} was added to expirations.</p><div class="modal-actions"><button class="btn" onclick="closeModal();renderPortalBody();">Done</button></div>`);
}

function portalSearch(){
  const term = document.getElementById('portal-search').value.trim().toLowerCase();
  const dateVal = document.getElementById('portal-search-date').value;
  if(!term && !dateVal){ renderPortalBody(); return; }
  const matches = db.expirationItems.filter(i=>{
    const textOk = !term || i.brand.toLowerCase().includes(term) || i.description.toLowerCase().includes(term) || i.upc.includes(term);
    const dateOk = !dateVal || i.date === dateVal;
    return textOk && dateOk;
  }).sort((a,b)=>b.date.localeCompare(a.date));
  activeTab = 'Expirations'; expSubView = 'items';
  renderPortalTabs(); updatePortalStickyState();
  const label = term && dateVal ? `"${term}" on ${dateVal}` : term ? `"${term}"` : `expiring ${dateVal}`;
  const el = document.getElementById('portal-body');
  el.innerHTML = `<h2 class="section-title">Search results for ${label}</h2>` +
    (matches.length ? matches.map(i=>`<div class="card">${expItemRow(i, i.date<todayISO() && !i.done, true)}</div>`).join('') : '<p class="empty-note">No matches.</p>');
}

/* ============================================================
   CATEGORIES (master only — nested inside Expirations tab)
   ============================================================ */
function categoriesHTML(){
  return `<h2 class="section-title">Categories <button class="btn" onclick="addCategoryFlow()">+ Add Category</button></h2>
    ${db.categories.map(c=>`<div class="card" style="display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:18px">${c.emoji} ${c.name}</span>
      <span><button class="btn small outline" onclick="editCategory('${c.id}')">Rename</button> <button class="btn small danger" onclick="deleteCategory('${c.id}')">Delete</button></span>
    </div>`).join('')}`;
}
function addCategoryFlow(){
  openModal(`<h3>Add Category</h3>
    <div class="field"><label>Emoji</label><input type="text" id="cat-emoji" maxlength="4" placeholder="🥫"></div>
    <div class="field"><label>Name</label><input type="text" id="cat-name" placeholder="Aisle 5 — Snacks"></div>
    <div class="modal-actions"><button class="btn" onclick="saveCategory()">Save</button></div>`);
}
function saveCategory(){
  const emoji = document.getElementById('cat-emoji').value.trim() || '📦';
  const name = document.getElementById('cat-name').value.trim();
  if(!name) return;
  db.categories.push({ id:newId('c'), emoji, name });
  closeModal(); renderPortalBody();
}
function editCategory(id){
  const c = db.categories.find(x=>x.id===id);
  openModal(`<h3>Edit Category</h3>
    <div class="field"><label>Emoji</label><input type="text" id="cat-emoji" maxlength="4" value="${c.emoji}"></div>
    <div class="field"><label>Name</label><input type="text" id="cat-name" value="${c.name}"></div>
    <div class="modal-actions"><button class="btn" onclick="updateCategory('${id}')">Save</button></div>`);
}
function updateCategory(id){
  const c = db.categories.find(x=>x.id===id);
  c.emoji = document.getElementById('cat-emoji').value.trim() || c.emoji;
  c.name = document.getElementById('cat-name').value.trim() || c.name;
  closeModal(); renderPortalBody();
}
function deleteCategory(id){
  if(!confirm('Delete this category and unassign its items?')) return;
  db.categories = db.categories.filter(c=>c.id!==id);
  renderPortalBody();
}

/* ============================================================
   DELI MENU ADMIN (master only)
   ============================================================ */
function deliMenuAdminHTML(){
  const monday = addDays(startOfWeekMonday(new Date()), deliAdminWeekOffset*7);
  const weekKey = weekKeyOf(monday);
  weeklyMenu(weekKey); // ensure it exists

  const boxes = db.deliBoxes;
  const mid = Math.ceil(boxes.length/2) || 1;
  const colA = boxes.slice(0,mid), colB = boxes.slice(mid);

  return `<h2 class="section-title">Deli Menu
      <span class="panel-nav">
        <button class="btn small outline" onclick="deliAdminWeekOffset--;renderPortalBody()">← Prev</button>
        <span class="week-range">${fmtWeekRange(monday)}</span>
        <button class="btn small outline" onclick="deliAdminWeekOffset++;renderPortalBody()">Next →</button>
        <button class="btn small" onclick="addDeliBoxFlow()">+ Add Box</button>
      </span></h2>
    <p style="font-size:12.5px;color:var(--ink-soft);margin-bottom:10px">Adding or removing an item from a week's menu automatically carries that change forward into every future week you've already generated. Past weeks are never changed.</p>
    <div class="deli-grid">
      <div class="deli-col">${colA.map(b=>editorBox(weekKey,b.id)).join('')}</div>
      <div class="deli-col">${colB.map(b=>editorBox(weekKey,b.id)).join('')}</div>
    </div>`;
}

function editorBox(weekKey, boxId){
  const boxDef = db.deliBoxes.find(b=>b.id===boxId);
  const list = db.deliItemLists[boxId] || [];
  const data = weeklyMenu(weekKey)[boxId];
  if(!boxDef || !data) return '';
  return `<div class="card ${boxDef.active?'':'box-inactive'}">
      <h4>${boxDef.title}${boxDef.active?'':' (inactive)'} <span class="price">$<input type="text" style="width:60px" value="${data.price}" onchange="updatePrice('${weekKey}','${boxId}',this.value)"></span></h4>
      ${data.items.map(id=>{
        const item = list.find(l=>l.id===id);
        return item ? `<div class="deli-item"><div class="deli-item-name">${item.name} ${diettags(item)} <button class="btn small danger" style="margin-left:auto" onclick="removeMenuItem('${weekKey}','${boxId}','${id}')">Delete</button></div><div class="deli-item-desc">${item.desc}</div></div>` : '';
      }).join('')}
      <div style="margin-top:8px">
        <button class="btn small" onclick="openDeliItemPicker('${weekKey}','${boxId}')">+ Add Item (search)</button>
      </div>
      <div class="field" style="margin-top:10px"><label>Notes shown to customers</label><textarea onchange="updateNotes('${weekKey}','${boxId}',this.value)">${data.notes}</textarea></div>
      <div class="box-admin-row" style="margin-top:10px;border-top:1px dashed var(--line);padding-top:10px">
        <button class="btn small outline" onclick="renameDeliBox('${boxId}')">Rename</button>
        <button class="btn small outline" onclick="toggleDeliBoxActive('${boxId}')">${boxDef.active?'Deactivate':'Reactivate'}</button>
        <button class="btn small danger" onclick="deleteDeliBox('${boxId}')">Delete Box</button>
      </div>
    </div>`;
}
function updatePrice(weekKey,boxId,val){ weeklyMenu(weekKey)[boxId].price = val; scheduleSave(); }
function updateNotes(weekKey,boxId,val){ weeklyMenu(weekKey)[boxId].notes = val; scheduleSave(); }

function openDeliItemPicker(weekKey, boxId){ renderDeliPickerModal(weekKey, boxId, ''); }
function renderDeliPickerModal(weekKey, boxId, term){
  const list = db.deliItemLists[boxId] || [];
  const data = weeklyMenu(weekKey)[boxId];
  const t = term.toLowerCase();
  const options = list.filter(i=> !data.items.includes(i.id) && (!t || i.name.toLowerCase().includes(t)));
  openModal(`<h3>Add item to ${db.deliBoxes.find(b=>b.id===boxId).title}</h3>
    <div class="field"><input type="text" id="deli-pick-search" placeholder="Search items…" value="${escAttr(term)}" oninput="renderDeliPickerModal('${weekKey}','${boxId}', this.value)"></div>
    <div class="search-panel-list">${options.length? options.map(i=>`<div class="search-panel-row" onclick="pickDeliItem('${weekKey}','${boxId}','${i.id}')"><span>${i.name}</span>${diettags(i)}</div>`).join('') : '<div class="search-panel-row">No matches.</div>'}</div>
    <div class="modal-actions"><button class="btn outline" onclick="newListItemFlow('${boxId}','${weekKey}')">+ New Item</button></div>`);
  setTimeout(()=>{ const el=document.getElementById('deli-pick-search'); if(el){ el.focus(); el.selectionStart=el.selectionEnd=el.value.length; } },0);
}
function pickDeliItem(weekKey, boxId, itemId){
  const data = weeklyMenu(weekKey)[boxId];
  if(!data.items.includes(itemId)) data.items.push(itemId);
  cascadeDeliChangeForward(weekKey, boxId);
  closeModal();
  renderPortalBody();
}
function removeMenuItem(weekKey,boxId,id){
  const data = weeklyMenu(weekKey)[boxId];
  data.items = data.items.filter(x=>x!==id);
  cascadeDeliChangeForward(weekKey, boxId);
  renderPortalBody();
}
function newListItemFlow(boxId, weekKey){
  openModal(`<h3>New item</h3>
    <div class="field"><label>Name</label><input type="text" id="ni-name"></div>
    <div class="field"><label>Description</label><textarea id="ni-desc"></textarea></div>
    <div class="toggle-row">
      <label><input type="checkbox" id="ni-df"> Dairy Free</label>
      <label><input type="checkbox" id="ni-gf"> Gluten Free</label>
      <label><input type="checkbox" id="ni-v"> Vegetarian</label>
    </div>
    <div class="modal-actions"><button class="btn" onclick="saveNewListItem('${boxId}','${weekKey||''}')">Save</button></div>`);
}
function saveNewListItem(boxId, weekKey){
  const name = document.getElementById('ni-name').value.trim();
  if(!name) return;
  const item = { id:newId('i'), name, desc:document.getElementById('ni-desc').value.trim(),
    df:document.getElementById('ni-df').checked, gf:document.getElementById('ni-gf').checked, v:document.getElementById('ni-v').checked, img:'' };
  if(!db.deliItemLists[boxId]) db.deliItemLists[boxId] = [];
  db.deliItemLists[boxId].push(item);
  if(weekKey){
    const data = weeklyMenu(weekKey)[boxId];
    data.items.push(item.id);
    cascadeDeliChangeForward(weekKey, boxId);
  }
  closeModal(); renderPortalBody();
}

function addDeliBoxFlow(){
  openModal(`<h3>Add Deli Box</h3>
    <div class="field"><label>Box title</label><input type="text" id="box-new-title" placeholder="e.g. Smoothies"></div>
    <div class="modal-actions"><button class="btn" onclick="saveAddDeliBox()">Create</button></div>`);
}
function saveAddDeliBox(){
  const title = document.getElementById('box-new-title').value.trim();
  if(!title) return;
  const id = newId('box');
  db.deliBoxes.push({ id, title, active:true });
  db.deliItemLists[id] = [];
  Object.keys(db.weeklyMenus).forEach(k=>{ db.weeklyMenus[k][id] = { price:'', notes:'', items:[] }; });
  closeModal(); renderPortalBody();
}
function renameDeliBox(id){
  const b = db.deliBoxes.find(x=>x.id===id);
  openModal(`<h3>Rename Box</h3><div class="field"><input type="text" id="box-rename" value="${b.title}"></div>
    <div class="modal-actions"><button class="btn" onclick="saveRenameDeliBox('${id}')">Save</button></div>`);
}
function saveRenameDeliBox(id){
  const b = db.deliBoxes.find(x=>x.id===id);
  const v = document.getElementById('box-rename').value.trim();
  if(v) b.title = v;
  closeModal(); renderPortalBody();
}
function toggleDeliBoxActive(id){ const b = db.deliBoxes.find(x=>x.id===id); b.active = !b.active; renderPortalBody(); }
function deleteDeliBox(id){
  if(!confirm('Delete this box and all its menu data? This cannot be undone.')) return;
  db.deliBoxes = db.deliBoxes.filter(b=>b.id!==id);
  delete db.deliItemLists[id];
  Object.keys(db.weeklyMenus).forEach(k=>{ delete db.weeklyMenus[k][id]; });
  renderPortalBody();
}

/* ============================================================
   SOUP MENU ADMIN (master only)
   ============================================================ */
function soupMenuAdminHTML(){
  const base = new Date(); base.setDate(1); base.setMonth(base.getMonth()+soupAdminMonthOffset);
  const monthKey = `${base.getFullYear()}-${pad(base.getMonth()+1)}`;
  const sw = db.settings.showWeekendsSoup;
  return `<h2 class="section-title">Soup Menu Calendar
      <span class="panel-nav">
        <button class="btn small outline" onclick="soupAdminMonthOffset--;renderPortalBody()">← Prev</button>
        <span class="week-range">${MONTHS[base.getMonth()]} ${base.getFullYear()}</span>
        <button class="btn small outline" onclick="soupAdminMonthOffset++;renderPortalBody()">Next →</button>
      </span></h2>
    <label class="weekend-toggle"><input type="checkbox" ${sw?'checked':''} onchange="db.settings.showWeekendsSoup=this.checked;renderPortalBody()"> Show Weekends (Sat &amp; Sun)</label>
    <div class="soup-cal-wrap">
      <div class="soup-cal-dow cols-${sw?7:5}">${dowHeaderHTML(sw)}</div>
      <div class="soup-cal cols-${sw?7:5}" id="soup-admin-cal">${buildSoupCalHTML(monthKey, sw)}</div>
    </div>
    <p style="font-size:12.5px;color:var(--ink-soft);margin-top:10px">Click any day to set its soup.</p>

    <h2 class="section-title" style="margin-top:26px">Soup List <button class="btn" onclick="addSoupFlow()">+ Add Soup</button></h2>
    <input type="text" id="soup-list-search" class="cat-search" style="margin:0 0 12px" placeholder="Search soups…"
      value="${escHtmlAttr(soupListSearchTerm)}"
      oninput="const pos=this.selectionStart; soupListSearchTerm=this.value; renderPortalBody(); reFocusInput('soup-list-search', pos);">
    ${db.soups.filter(s=> !soupListSearchTerm || s.name.toLowerCase().includes(soupListSearchTerm.toLowerCase())).map(s=>`<div class="card" style="display:flex;justify-content:space-between;align-items:center">
      <span>${s.name} ${diettags(s)}</span>
      <span><button class="btn small outline" onclick="editSoup('${s.id}')">Edit</button> <button class="btn small danger" onclick="deleteSoup('${s.id}')">Delete</button></span>
    </div>`).join('') || '<p class="empty-note">No soups match that search.</p>'}`;
}
function addSoupFlow(){
  openModal(`<h3>Add Soup</h3>
    <div class="field"><label>Name</label><input type="text" id="sp-name"></div>
    <div class="toggle-row">
      <label><input type="checkbox" id="sp-df"> Dairy Free</label>
      <label><input type="checkbox" id="sp-gf"> Gluten Free</label>
      <label><input type="checkbox" id="sp-v"> Vegetarian</label>
    </div>
    <div class="field"><label>Notes</label><textarea id="sp-notes"></textarea></div>
    <div class="modal-actions"><button class="btn" onclick="saveSoup()">Save</button></div>`);
}
function saveSoup(){
  const name = document.getElementById('sp-name').value.trim();
  if(!name) return;
  db.soups.push({ id:newId('s'), name, df:document.getElementById('sp-df').checked, gf:document.getElementById('sp-gf').checked, v:document.getElementById('sp-v').checked, notes:document.getElementById('sp-notes').value });
  closeModal(); renderPortalBody();
}
function editSoup(id){
  const s = db.soups.find(x=>x.id===id);
  openModal(`<h3>Edit Soup</h3>
    <div class="field"><label>Name</label><input type="text" id="sp-name" value="${s.name}"></div>
    <div class="toggle-row">
      <label><input type="checkbox" id="sp-df" ${s.df?'checked':''}> Dairy Free</label>
      <label><input type="checkbox" id="sp-gf" ${s.gf?'checked':''}> Gluten Free</label>
      <label><input type="checkbox" id="sp-v" ${s.v?'checked':''}> Vegetarian</label>
    </div>
    <div class="field"><label>Notes</label><textarea id="sp-notes">${s.notes||''}</textarea></div>
    <div class="modal-actions"><button class="btn" onclick="updateSoup('${id}')">Save</button></div>`);
}
function updateSoup(id){
  const s = db.soups.find(x=>x.id===id);
  s.name = document.getElementById('sp-name').value.trim() || s.name;
  s.df = document.getElementById('sp-df').checked; s.gf = document.getElementById('sp-gf').checked; s.v = document.getElementById('sp-v').checked;
  s.notes = document.getElementById('sp-notes').value;
  closeModal(); renderPortalBody();
}
function deleteSoup(id){ if(!confirm('Delete this soup?')) return; db.soups = db.soups.filter(s=>s.id!==id); renderPortalBody(); }

document.getElementById('portal-body').addEventListener('click', e=>{
  const cell = e.target.closest('#soup-admin-cal .soup-cell');
  if(cell && cell.dataset.date) openSoupDayPicker(cell.dataset.date);
});
function dateISOHasSoup(dateISO){ return !!monthSoupMenu(dateISO.slice(0,7))[dateISO]; }
function openSoupDayPicker(dateISO, term){
  term = term || '';
  const t = term.toLowerCase();
  const options = db.soups.filter(s=> !t || s.name.toLowerCase().includes(t));
  openModal(`<h3>Soup for ${dateISO}</h3>
    <div class="field"><input type="text" id="soup-filter" placeholder="Search soups…" value="${escAttr(term)}" oninput="openSoupDayPicker('${dateISO}', this.value)"></div>
    <div class="search-panel-list">
      ${options.length ? options.map(s=>`<div class="search-panel-row" onclick="setSoupDay('${dateISO}','${s.id}')"><span>${s.name}</span>${diettags(s)}</div>`).join('') : '<div class="search-panel-row">No matches.</div>'}
      ${dateISOHasSoup(dateISO) ? `<div class="search-panel-row" style="color:var(--red-flag)" onclick="clearSoupDay('${dateISO}')">✕ Clear this day</div>` : ''}
    </div>`);
  setTimeout(()=>{ const el=document.getElementById('soup-filter'); if(el){ el.focus(); el.selectionStart=el.selectionEnd=el.value.length; } },0);
}
function setSoupDay(dateISO, soupId){
  monthSoupMenu(dateISO.slice(0,7))[dateISO] = soupId;
  closeModal(); renderPortalBody();
}
function clearSoupDay(dateISO){
  delete monthSoupMenu(dateISO.slice(0,7))[dateISO];
  closeModal(); renderPortalBody();
}

/* ============================================================
   PRODUCE DEALS ADMIN (master only)
   ============================================================ */
function produceAdminHTML(){
  return `<h2 class="section-title">Produce Deals <button class="btn" onclick="addProduceFlow()">+ Add Deal</button></h2>
    <div id="produce-admin-list"></div>`;
}
function uploadProduceImage(inputEl){
  return new Promise(resolve=>{
    const file = inputEl && inputEl.files && inputEl.files[0];
    if(!file){ resolve(''); return; }
    const path = 'produce/' + Date.now() + '-' + file.name.replace(/[^a-z0-9.]+/gi,'_');
    const ref = storage.ref().child(path);
    ref.put(file)
      .then(snap=>snap.ref.getDownloadURL())
      .then(url=>resolve(url))
      .catch(err=>{ console.error('Image upload failed:', err); alert('Photo upload failed — the deal will save without a photo. Check your connection and Storage Rules.'); resolve(''); });
  });
}
function addProduceFlow(){
  openModal(`<h3>Add Produce Deal</h3>
    <div class="field"><label>Produce name</label><input type="text" id="pd-name"></div>
    <div class="field"><label>Price</label><input type="text" id="pd-price" placeholder="2.49"></div>
    <div class="field"><label>Unit</label><input type="text" id="pd-unit" placeholder="lb, pk, ea."></div>
    <div class="toggle-row"><label><input type="checkbox" id="pd-organic"> Organic (unchecked = Conventional)</label></div>
    <div class="field"><label>Photo (optional)</label><input type="file" accept="image/*" id="pd-img-file"></div>
    <div class="modal-actions"><button class="btn" onclick="saveProduce()">Save</button></div>`);
}
async function saveProduce(){
  const name = document.getElementById('pd-name').value.trim();
  if(!name) return;
  const img = await uploadProduceImage(document.getElementById('pd-img-file'));
  db.produceDeals.push({ id:newId('p'), name, price:document.getElementById('pd-price').value.trim(), unit:document.getElementById('pd-unit').value.trim(), organic:document.getElementById('pd-organic').checked, img });
  closeModal(); renderPortalBody();
}
function editProduceDeal(id){
  const p = db.produceDeals.find(x=>x.id===id);
  window.__clearProduceImg = false;
  openModal(`<h3>Edit Deal</h3>
    <div class="field"><label>Produce name</label><input type="text" id="pd-name" value="${p.name}"></div>
    <div class="field"><label>Price</label><input type="text" id="pd-price" value="${p.price}"></div>
    <div class="field"><label>Unit</label><input type="text" id="pd-unit" value="${p.unit}"></div>
    <div class="toggle-row"><label><input type="checkbox" id="pd-organic" ${p.organic?'checked':''}> Organic (unchecked = Conventional)</label></div>
    ${p.img?`<img src="${p.img}" class="produce-img" style="margin-bottom:8px" id="pd-img-preview">`:''}
    <div class="field"><label>Replace photo (optional)</label><input type="file" accept="image/*" id="pd-img-file"></div>
    <div class="modal-actions">
      ${p.img?`<button class="btn outline" onclick="window.__clearProduceImg=true;const el=document.getElementById('pd-img-preview');if(el)el.remove();">Remove Photo</button>`:''}
      <button class="btn" onclick="updateProduce('${id}')">Save</button>
    </div>`);
}
async function updateProduce(id){
  const p = db.produceDeals.find(x=>x.id===id);
  p.name = document.getElementById('pd-name').value.trim()||p.name;
  p.price = document.getElementById('pd-price').value.trim();
  p.unit = document.getElementById('pd-unit').value.trim();
  p.organic = document.getElementById('pd-organic').checked;
  const fileEl = document.getElementById('pd-img-file');
  if(fileEl.files && fileEl.files[0]){
    p.img = await uploadProduceImage(fileEl);
  } else if(window.__clearProduceImg){
    p.img = '';
  }
  window.__clearProduceImg = false;
  closeModal(); renderPortalBody();
}
function deleteProduceDeal(id){ if(!confirm('Delete this deal?')) return; db.produceDeals = db.produceDeals.filter(p=>p.id!==id); renderPortalBody(); }

/* ============================================================
   EMPLOYEES (master only)
   ============================================================ */
function employeesHTML(){
  return `<h2 class="section-title">Employees <button class="btn" onclick="addEmployeeFlow()">+ Add Employee</button></h2>
    ${db.employees.map(e=>`<div class="card">
      <h4>${e.keyholder?'🔑 ':''}${e.name} ${!e.active?'<span class="pill inactive">Inactive</span>':''}</h4>
      <p class="pill">${e.role}</p><p style="font-size:13px;color:var(--ink-soft)">${e.phone||'No phone on file'}</p>
      <button class="btn small outline" onclick="openEmployeeDetail('${e.id}')">View Details</button>
      <button class="btn small ${e.active?'danger':''}" onclick="toggleEmployeeActive('${e.id}')">${e.active?'Deactivate':'Reactivate'}</button>
      <button class="btn small danger" onclick="deleteEmployee('${e.id}')">Delete</button>
    </div>`).join('')}`;
}
function addEmployeeFlow(){
  openModal(`<h3>Add Employee</h3>
    <div class="field"><label>Name</label><input type="text" id="em-name"></div>
    <div class="field"><label>Username</label><input type="text" id="em-user"></div>
    <div class="field"><label>Password</label><input type="text" id="em-pass"></div>
    <div class="field"><label>Role</label>${roleSelectHTML('em', db.roles[0])}</div>
    <div class="field"><label>Phone</label><input type="text" id="em-phone"></div>
    <div class="toggle-row"><label><input type="checkbox" id="em-key"> 🔑 Keyholder</label></div>
    <div class="field"><label>Notes</label><textarea id="em-notes"></textarea></div>
    <div class="modal-actions"><button class="btn" onclick="saveEmployee()">Save</button></div>`);
}
function saveEmployee(){
  const name = document.getElementById('em-name').value.trim();
  const username = document.getElementById('em-user').value.trim();
  if(!name || !username) return;
  db.employees.push({ id:newId('e'), name, username, password:document.getElementById('em-pass').value||'changeme',
    role:resolveRole('em'), keyholder:document.getElementById('em-key').checked,
    phone:document.getElementById('em-phone').value.trim(), notes:document.getElementById('em-notes').value, active:true,
    typicalSchedule:{}, stats:{added:Array(12).fill(0), checked:Array(12).fill(0)}, createdAt:todayISO() });
  closeModal(); renderPortalBody();
}
function toggleEmployeeActive(id){ const e = db.employees.find(x=>x.id===id); e.active=!e.active; renderPortalBody(); }
function deleteEmployee(id){ if(!confirm('Delete this employee account?')) return; db.employees = db.employees.filter(e=>e.id!==id); renderPortalBody(); }

function employeeInfoEditHTML(e){
  return `<div class="card">
    <h4>Account Info</h4>
    <div class="field"><label>Name</label><input type="text" value="${e.name}" onchange="updateEmployeeField('${e.id}','name',this.value)"></div>
    <div class="field"><label>Username</label><input type="text" value="${e.username}" onchange="updateEmployeeField('${e.id}','username',this.value)"></div>
    <div class="field"><label>Password</label><input type="text" value="${e.password}" onchange="updateEmployeeField('${e.id}','password',this.value)"></div>
    <div class="field"><label>Role</label>${roleSelectHTML('ei', e.role)}
      <button class="btn small outline" style="margin-top:8px" onclick="saveEmployeeRole('${e.id}')">Update Role</button></div>
    <div class="field"><label>Phone</label><input type="text" value="${e.phone||''}" onchange="updateEmployeeField('${e.id}','phone',this.value)"></div>
    <div class="toggle-row"><label><input type="checkbox" ${e.keyholder?'checked':''} onchange="updateEmployeeField('${e.id}','keyholder',this.checked)"> 🔑 Keyholder</label></div>
    <div class="field"><label>Notes</label><textarea onchange="updateEmployeeField('${e.id}','notes',this.value)">${e.notes||''}</textarea></div>
  </div>`;
}
function saveEmployeeRole(id){
  updateEmployeeField(id, 'role', resolveRole('ei'));
  openEmployeeDetail(id);
}
function updateEmployeeField(id, field, value){
  const e = db.employees.find(x=>x.id===id);
  e[field] = value;
  const title = document.getElementById('emp-detail-title');
  if(title) title.textContent = `${e.keyholder?'🔑 ':''}${e.name}`;
  scheduleSave();
}

function typicalScheduleGridHTML(emp){
  return `<div class="sched-grid with-sun" style="grid-template-columns:110px repeat(7,1fr);min-width:560px">
    <div class="sched-head">Day</div>${ALL_DAYS.map(d=>`<div class="sched-head">${d}</div>`).join('')}
    <div class="sched-name">Hours</div>
    ${ALL_DAYS.map(d=>{
      const t = emp.typicalSchedule[d];
      return `<div class="sched-cell" onclick="editTypicalCell('${emp.id}','${d}')">${t?`${t.start}-${t.end}`:''}</div>`;
    }).join('')}
  </div>`;
}
function editTypicalCell(empId, dayKey){
  const emp = db.employees.find(e=>e.id===empId);
  const cur = emp.typicalSchedule[dayKey];
  openModal(`<h3>${emp.name} — Typical ${dayKey}</h3>
    <div class="field"><label>Start</label><input type="time" id="tc-start" value="${cur?cur.start:'09:00'}"></div>
    <div class="field"><label>End</label><input type="time" id="tc-end" value="${cur?cur.end:'17:00'}"></div>
    <div class="modal-actions">
      ${cur?`<button class="btn danger" onclick="clearTypicalCell('${empId}','${dayKey}')">Clear</button>`:''}
      <button class="btn" onclick="saveTypicalCell('${empId}','${dayKey}')">Save</button>
    </div>`);
}
function saveTypicalCell(empId,dayKey){
  const emp = db.employees.find(e=>e.id===empId);
  emp.typicalSchedule[dayKey] = { start:document.getElementById('tc-start').value, end:document.getElementById('tc-end').value };
  closeModal(); openEmployeeDetail(empId);
}
function clearTypicalCell(empId,dayKey){
  const emp = db.employees.find(e=>e.id===empId);
  delete emp.typicalSchedule[dayKey];
  closeModal(); openEmployeeDetail(empId);
}

function statChartHTML(values, color){
  const total = values.reduce((a,b)=>a+b,0);
  const monthLabels = lastNMonthLabels(12);
  const max = Math.max(1,...values);
  return `<div style="font-family:var(--font-mono);font-size:12px;color:var(--brown-light);margin-bottom:6px">Total: <strong style="color:var(--ink);font-size:14px">${total}</strong></div>
    <div class="chart-wrap">
      ${values.map((v,i)=>`<div class="chart-col"><div class="chart-bar" style="height:${(v/max*50)+4}px;background:${color}" title="${v}"></div><div class="chart-bar-label">${monthLabels[i]} · ${v}</div></div>`).join('')}
    </div>`;
}

function chatCommentsHTML(e){
  const comments = db.chatMessages.filter(m=>m.empId===e.id).slice().sort((a,b)=>a.ts-b.ts);
  return comments.length ? comments.map(c=>`<p style="font-size:13.5px">${new Date(c.ts).toLocaleDateString()} — "${c.text}"</p>`).join('') : '<p class="empty-note">No comments yet.</p>';
}

function openEmployeeDetail(id){
  viewingEmployeeId = id;
  const e = db.employees.find(x=>x.id===id);
  const daysSince = Math.max(1, Math.round((Date.now()-new Date(e.createdAt))/86400000));
  const requests = db.timeOffRequests.filter(r=>r.employeeId===id);
  const daysRequested = requests.length;
  const pct = ((daysRequested/daysSince)*100).toFixed(1);
  const approved = requests.filter(r=>r.status==='approved').length;
  const denied = requests.filter(r=>r.status==='denied').length;
  const totalDecided = approved+denied || 1;

  const el = document.getElementById('portal-body');
  el.innerHTML = `
    <button class="btn small outline" onclick="viewingEmployeeId=null;renderPortalBody()">← Back to Employees</button>
    <h2 class="section-title" id="emp-detail-title" style="margin-top:14px">${e.keyholder?'🔑 ':''}${e.name}</h2>
    ${employeeInfoEditHTML(e)}
    <div class="card">
      <h4>Typical Schedule</h4>
      <p style="font-size:12.5px;color:var(--ink-soft)">Click a day to set or clear this employee's usual hours. The 🪄 wand on the Scheduling tab fills a week from this.</p>
      <div style="overflow-x:auto">${typicalScheduleGridHTML(e)}</div>
    </div>
    <div class="card">
      <h4>Items Added (last 12 months)</h4>
      ${statChartHTML(e.stats.added, 'var(--green-moss)')}
      <h4 style="margin-top:16px">Items Checked Off (last 12 months)</h4>
      ${statChartHTML(e.stats.checked, 'var(--terracotta)')}
    </div>
    <div class="card stat-row">
      <div class="stat-block"><div class="stat-num">${daysRequested}</div><div class="stat-label">TIME OFF REQUESTS · ${pct}% OF DAYS SINCE HIRE</div></div>
      <div class="stat-block">
        <div class="stat-num" style="color:var(--green-moss)">${approved} <span style="color:var(--red-flag);font-size:20px">/ ${denied}</span></div>
        <div class="stat-label">APPROVED / DENIED</div>
        <div class="bar"><div class="approved" style="width:${approved/totalDecided*100}%"></div><div class="denied" style="width:${denied/totalDecided*100}%"></div></div>
      </div>
    </div>
    <div class="card">
      <h4>Chat Comments</h4>
      ${chatCommentsHTML(e)}
    </div>
    <div class="card">
      <h4>Time Off Requests</h4>
      ${requests.length ? requests.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(r=>`<p style="opacity:${new Date(r.date)<new Date()?0.55:1}">${r.date} ${r.start}-${r.end} — <strong>${r.status}</strong> ${r.responseComment?`<br><span style="font-size:12.5px;color:var(--ink-soft)">${r.responseComment}</span>`:''}</p>`).join('') : '<p class="empty-note">No requests yet.</p>'}
    </div>`;
  scheduleSave();
}

/* ============================================================
   SCHEDULING
   ============================================================ */
function weekSchedule(weekKey){ if(!db.schedule[weekKey]) db.schedule[weekKey] = {}; return db.schedule[weekKey]; }
function scheduleDayKeys(){ return db.settings.showSunSchedule ? [...DAY_KEYS,'SUN'] : DAY_KEYS; }

function scheduleHTML(){
  const pending = db.timeOffRequests.filter(r=>r.status==='pending');
  let html = '';
  if(session.isMaster){
    html += `<h2 class="section-title">Time Off Requests</h2>`;
    html += pending.length ? pending.map(r=>{
      const emp = db.employees.find(e=>e.id===r.employeeId);
      return `<div class="card"><strong>${emp?emp.name:'—'}</strong> — ${r.date} ${r.start}-${r.end}
        ${r.comment?`<br><span style="font-size:12.5px;color:var(--ink-soft)">${r.comment}</span>`:''}
        <div class="modal-actions" style="justify-content:flex-start;margin-top:8px">
          <button class="btn small" onclick="respondRequest('${r.id}','approved')">Approve</button>
          <button class="btn small danger" onclick="respondRequest('${r.id}','denied')">Deny</button>
        </div></div>`;
    }).join('') : '<p class="empty-note">No pending requests.</p>';
    const past = db.timeOffRequests.filter(r=>r.status!=='pending');
    if(past.length) html += `<details><summary style="cursor:pointer;font-size:13px;color:var(--brown-light)">Past requests (${past.length})</summary>${past.map(r=>{
      const emp = db.employees.find(e=>e.id===r.employeeId);
      return `<div class="card" style="opacity:.7"><strong>${emp?emp.name:'—'}</strong> — ${r.date} ${r.start}-${r.end} — ${r.status}</div>`;
    }).join('')}</details>`;
    html += `<label class="weekend-toggle"><input type="checkbox" ${db.settings.showSunSchedule?'checked':''} onchange="db.settings.showSunSchedule=this.checked;renderPortalBody()"> Show SUN (Sundays)</label>`;
  } else {
    html += myTimeOffListHTML();
    html += `<h2 class="section-title" style="margin-top:10px">My Schedule <button class="btn small" onclick="requestTimeOffFlow()">Time Off Request</button></h2>`;
  }

  const monday = addDays(startOfWeekMonday(new Date()), scheduleWeekOffset*7);
  const weekKey = weekKeyOf(monday);
  html += `<h2 class="section-title" style="margin-top:22px">Weekly Schedule
    <span class="panel-nav">
      <button class="btn small outline" onclick="scheduleWeekOffset--;renderPortalBody()">← Prev Week</button>
      <span class="week-range">${fmtWeekRange(monday)}</span>
      <button class="btn small outline" onclick="scheduleWeekOffset++;renderPortalBody()">Next Week →</button>
      ${scheduleWeekOffset!==0?`<button class="btn small" onclick="scheduleWeekOffset=0;renderPortalBody()">Today</button>`:''}
    </span></h2>`;
  html += weekBoxHTML(weekKey, monday);
  return html;
}

function myTimeOffListHTML(){
  const mine = db.timeOffRequests.filter(r=>r.employeeId===session.employeeId);
  const upcoming = mine.filter(r=>r.date>=todayISO()).sort((a,b)=>a.date.localeCompare(b.date));
  const past = mine.filter(r=>r.date<todayISO()).sort((a,b)=>b.date.localeCompare(a.date));
  return `<h2 class="section-title">My Time Off Requests</h2>
    ${upcoming.length ? upcoming.map(timeOffRowHTML).join('') : '<p class="empty-note">No upcoming requests.</p>'}
    ${past.length ? `<details style="margin-top:8px"><summary style="cursor:pointer;font-size:13px;color:var(--brown-light)">Past requests (${past.length})</summary>${past.map(timeOffRowHTML).join('')}</details>` : ''}`;
}
function timeOffRowHTML(r){
  return `<div class="timeoff-list-item">${r.date} ${r.start}-${r.end} <span class="timeoff-status ${r.status}">${r.status}</span>
    ${r.comment?`<br><span style="font-size:12px;color:var(--ink-soft)">Reason: ${r.comment}</span>`:''}
    ${r.responseComment?`<br><span style="font-size:12px;color:var(--ink-soft)">Manager: ${r.responseComment}</span>`:''}</div>`;
}

function weekBoxHTML(weekKey, monday){
  const sched = weekSchedule(weekKey);
  const days = scheduleDayKeys();
  const roles = [...new Set(db.employees.filter(e=>e.active).map(e=>e.role))];
  let rows = '';
  roles.forEach(role=>{
    rows += `<div class="sched-role-row">${role}</div>`;
    db.employees.filter(e=>e.active && e.role===role).forEach(emp=>{
      const canEditRow = session.isMaster || (!session.isMaster && session.employeeId===emp.id);
      rows += `<div class="sched-name">${session.isMaster?`<button class="magic-btn" title="Fill typical schedule" onclick="magicFill('${weekKey}','${emp.id}')">🪄</button>`:''}${emp.keyholder?'🔑 ':''}<span style="cursor:pointer" onclick="showProfile('${emp.id}')">${emp.name}</span></div>`;
      days.forEach((dk,i)=>{
        const cellData = (sched[emp.id]||{})[dk];
        const date = addDays(monday,i);
        const req = db.timeOffRequests.find(r=>r.employeeId===emp.id && r.date===isoDate(date) && r.status!=='denied');
        const isReq = !!req;
        const label = isReq ? `Off${req.status==='pending'?' ?':''}` : (cellData ? `${cellData.start}-${cellData.end}` : '');
        const clickable = session.isMaster ? `onclick="editCell('${weekKey}','${emp.id}','${dk}','${isoDate(date)}')"` :
          (canEditRow ? `onclick="employeeCellClick('${weekKey}','${emp.id}','${dk}','${isoDate(date)}')"` : '');
        rows += `<div class="sched-cell ${isReq?'request':''}" ${clickable}>${label}</div>`;
      });
    });
  });
  const gridClass = days.length===7 ? 'sched-grid with-sun' : 'sched-grid';
  return `<div class="week-box"><div class="week-label">${fmtWeekRange(monday)}</div>
    <div class="${gridClass}">
      <div class="sched-head">Employee</div>${days.map((d,i)=>`<div class="sched-head">${d} ${fmtShort(addDays(monday,i))}</div>`).join('')}
      ${rows}
    </div></div>`;
}

function showProfile(empId){
  const e = db.employees.find(x=>x.id===empId);
  openModal(`<div class="profile-pop"><h3>${e.keyholder?'🔑 ':''}${e.name}</h3><p>${e.phone||'No phone on file'}</p><p class="pill">${e.role}</p></div>`);
}

function editCell(weekKey, empId, dayKey, dateISO){
  const emp = db.employees.find(e=>e.id===empId);
  const typical = emp.typicalSchedule[dayKey];
  const current = (weekSchedule(weekKey)[empId]||{})[dayKey];
  openModal(`<h3>${emp.name} — ${dayKey} ${dateISO}</h3>
    ${typical ? `<button class="btn small outline" onclick="applyTypical('${weekKey}','${empId}','${dayKey}')">Use typical: ${typical.start}-${typical.end}</button><br><br>` : ''}
    <div class="field"><label>Start</label><input type="time" id="cell-start" value="${current?current.start:(typical?typical.start:'09:00')}"></div>
    <div class="field"><label>End</label><input type="time" id="cell-end" value="${current?current.end:(typical?typical.end:'17:00')}"></div>
    <div class="modal-actions">
      ${current?`<button class="btn danger" onclick="clearCell('${weekKey}','${empId}','${dayKey}')">Clear</button>`:''}
      <button class="btn" onclick="saveCell('${weekKey}','${empId}','${dayKey}')">Save</button>
    </div>`);
}
function saveCell(weekKey,empId,dayKey){
  const sched = weekSchedule(weekKey);
  if(!sched[empId]) sched[empId] = {};
  sched[empId][dayKey] = { start:document.getElementById('cell-start').value, end:document.getElementById('cell-end').value };
  closeModal(); renderPortalBody();
}
function clearCell(weekKey,empId,dayKey){ delete weekSchedule(weekKey)[empId][dayKey]; closeModal(); renderPortalBody(); }
function applyTypical(weekKey,empId,dayKey){
  const emp = db.employees.find(e=>e.id===empId);
  document.getElementById('cell-start').value = emp.typicalSchedule[dayKey].start;
  document.getElementById('cell-end').value = emp.typicalSchedule[dayKey].end;
}
function magicFill(weekKey, empId){
  const emp = db.employees.find(e=>e.id===empId);
  const sched = weekSchedule(weekKey);
  if(!sched[empId]) sched[empId] = {};
  Object.entries(emp.typicalSchedule).forEach(([day,val])=>{ sched[empId][day] = {...val}; });
  renderPortalBody();
}
function employeeCellClick(weekKey, empId, dayKey, dateISO){
  openModal(`<h3>${dayKey} ${dateISO}</h3>
    <div class="modal-actions" style="justify-content:flex-start"><button class="btn" onclick="requestTimeOffFlow('${dateISO}')">Request Time Off</button></div>`);
}
function requestTimeOffFlow(prefillDate){
  openModal(`<h3>Request Time Off</h3>
    <div class="field"><label>Date</label><input type="date" id="to-date" value="${prefillDate||''}"></div>
    <div class="field"><label>Start</label><input type="time" id="to-start" value="09:00"></div>
    <div class="field"><label>End</label><input type="time" id="to-end" value="17:00"></div>
    <div class="field"><label>Comments</label><textarea id="to-comment" placeholder="Reason for request…"></textarea></div>
    <div class="modal-actions"><button class="btn" onclick="submitTimeOff()">Submit Request</button></div>`);
}
function submitTimeOff(){
  const date = document.getElementById('to-date').value;
  if(!date) return;
  db.timeOffRequests.push({ id:newId('r'), employeeId:session.employeeId, date, start:document.getElementById('to-start').value, end:document.getElementById('to-end').value, comment:document.getElementById('to-comment').value, status:'pending', responseComment:'' });
  closeModal(); renderPortalBody();
}
function respondRequest(id, status){
  const r = db.timeOffRequests.find(x=>x.id===id);
  const comment = prompt(`Add a comment for this ${status==='approved'?'approval':'denial'} (optional):`) || '';
  r.status = status; r.responseComment = comment;
  renderPortalBody();
}

/* ============================================================
   CHAT
   ============================================================ */
function chatHTML(){
  return `<h2 class="section-title">Chat</h2>
    <div class="chat-box">
      <div class="chat-messages" id="chat-messages"></div>
      <div class="chat-input-row">
        <input type="text" id="chat-input" placeholder="Write a message…" onkeydown="if(event.key==='Enter') sendChat()">
        <button class="btn" onclick="sendChat()">Send</button>
      </div>
    </div>`;
}
function renderChatMessages(){
  const el = document.getElementById('chat-messages');
  if(!el) return;
  el.innerHTML = db.chatMessages.map(m=>{
    return `<div class="chat-msg"><div class="who">${m.empId ? `<button onclick="showProfile('${m.empId}')">${m.who}</button>` : m.who} · ${new Date(m.ts).toLocaleString()}</div><div>${m.text}</div></div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
  scheduleSave();
}
function sendChat(){
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if(!text) return;
  db.chatMessages.push({ id:newId('m'), who:session.name.replace(' (Master)',''), empId: session.isMaster?null:session.employeeId, text, ts:Date.now() });
  input.value='';
  renderChatMessages();
}

/* ============================================================
   GLOBAL EVENT WIRING
   ============================================================ */
document.body.addEventListener('click', e=>{
  const actionEl = e.target.closest('[data-action]');
  if(actionEl){
    const action = actionEl.dataset.action;
    if(action==='login') showView('view-login');
    if(action==='back-public') showView('view-public');
    if(action==='logout') logout();
    if(action==='add-item') addItemFlow();
    if(action==='toggle-categories'){ expSubView = expSubView==='categories' ? 'items' : 'categories'; renderPortalBody(); }
    if(action==='deli-prev'){ publicDeliWeekOffset--; renderDeliPanel(); }
    if(action==='deli-next'){ publicDeliWeekOffset++; renderDeliPanel(); }
    if(action==='soup-prev'){ publicSoupMonthOffset--; renderSoupPanel(); }
    if(action==='soup-next'){ publicSoupMonthOffset++; renderSoupPanel(); }
  }
  const tabEl = e.target.closest('.portal-tab');
  if(tabEl) setTab(tabEl.dataset.tab);
});
document.getElementById('portal-search').addEventListener('input', ()=>portalSearch());
document.getElementById('portal-search-date').addEventListener('input', ()=>portalSearch());

/* ---------------------------- INIT ---------------------------- */
// Paint immediately with the local seed defaults so the page is never blank,
// then let Firestore's listeners take over the moment real/synced data loads.
initFirebaseSync();
renderPublic();
showView('view-public');
