const API_BASE = window.location.origin;
const USER_KEY = 'oillog_user_v4';
const OFFLINE_CACHE_PREFIX = 'oillog_entries_cache_v1_';
const OFFLINE_QUEUE_KEY = 'oillog_offline_queue_v1';

// Must match APP_BUILD in server.py and the ?v= on the CSS/JS links. The page
// compares it against /api/version on every load: if they differ, a newer
// deploy exists and any cached shell is thrown away automatically.
const APP_BUILD = '22';

let user = null;
let entries = [];
let currentType = 'T';
let currentUnit = 'mi';
let currentFilter = 'all';
let currentScope = 'mine';
let searchType = 'all';
let searchResults = [];
let activityEntries = [];
let editingEntryId = null;
let syncTimer = null;

function loadUser(){ try{ return JSON.parse(localStorage.getItem(USER_KEY)) || null; }catch(e){ return null; } }
function saveUserLocal(u){ localStorage.setItem(USER_KEY, JSON.stringify(u)); }

// Keep the two shells strict: desktop browsers always use the desktop HTML,
// phones/tablets always use the mobile HTML. This also repairs old bookmarks
// to /mobile or /desktop after a user reaches the login page.
function shouldUseMobileShell(){
  const ua = navigator.userAgent.toLowerCase();
  const touchMobile = /android|iphone|ipad|ipod|windows phone|blackberry|mobile|silk|kindle|playbook|bb10/.test(ua);
  return touchMobile || window.matchMedia('(max-width: 859px)').matches;
}
function enforceDeviceShell(){
  const mobile = shouldUseMobileShell();
  const path = window.location.pathname;
  const onMobile = path === '/mobile' || document.getElementById('app')?.dataset.layout === 'mobile';
  const onDesktop = path === '/desktop' || document.getElementById('app')?.dataset.layout === 'desktop';
  if(mobile && onDesktop){ window.location.replace('/mobile'); return false; }
  if(!mobile && onMobile){ window.location.replace('/desktop'); return false; }
  return true;
}
function icons(){ /* Phosphor webfont — icons are pure CSS, nothing to re-render */ }

function updateChicagoClock(){
  const els = document.querySelectorAll('.chicago-time');
  if(!els.length) return;
  const now = new Date();
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone:'America/Chicago', hour:'numeric', minute:'2-digit', second:'2-digit', hour12:true
  }).format(now);
  els.forEach(el => el.textContent = time + ' CT');
}
updateChicagoClock();
setInterval(updateChicagoClock, 1000);
installOfflineListeners();

function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(window._t); window._t = setTimeout(()=>t.classList.remove('show'), 2200);
}
function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c => ({'&':'&','<':'<','>':'>','"':'"',"'":'&#39;'}[c])); }

// ── Offline-first storage ─────────────────────────────────────────────────
function userCacheKey(){ return OFFLINE_CACHE_PREFIX + (user?.id || user?.username || 'guest'); }
function readCachedEntries(){
  try { return JSON.parse(localStorage.getItem(userCacheKey()) || '[]'); } catch(e){ return []; }
}
function writeCachedEntries(){
  if(!user) return;
  try { localStorage.setItem(userCacheKey(), JSON.stringify(entries)); } catch(e) {}
}
function userQueueKey(){ return OFFLINE_QUEUE_KEY + '_' + (user?.id || user?.username || 'guest'); }
function readOfflineQueue(){
  try { return JSON.parse(localStorage.getItem(userQueueKey()) || '[]'); } catch(e){ return []; }
}
function writeOfflineQueue(q){ try { localStorage.setItem(userQueueKey(), JSON.stringify(q)); } catch(e) {} updateSyncIndicator(); }
function queueEntry(entry){
  const q = readOfflineQueue();
  if(!q.some(e => e.id === entry.id)){ q.push(entry); writeOfflineQueue(q); }
}
function removeQueuedEntry(id){ writeOfflineQueue(readOfflineQueue().filter(e => e.id !== id)); }
function mergeEntries(serverEntries, queued){
  const map = new Map();
  (serverEntries || []).forEach(e => map.set(String(e.id), e));
  (queued || []).forEach(e => { if(!map.has(String(e.id))) map.set(String(e.id), e); });
  return Array.from(map.values());
}
function updateSyncIndicator(forceOffline=false){
  const pill = document.getElementById('sync-pill'), label = document.getElementById('sync-label');
  if(!pill || !label) return;
  const q = readOfflineQueue().length;
  const offline = forceOffline || !navigator.onLine;
  pill.classList.toggle('offline', offline);
  pill.classList.toggle('syncing', !offline && q>0);
  label.textContent = offline ? (q ? `Offline · ${q} waiting` : 'Offline') : (q ? `Syncing · ${q}` : 'Synced');
}
async function flushOfflineQueue(){
  if(!navigator.onLine || !user) { updateSyncIndicator(true); return; }
  let q = readOfflineQueue();
  if(!q.length){ updateSyncIndicator(); return; }
  updateSyncIndicator();
  for(const entry of [...q]){
    try {
      const res = await api('POST','/api/entries',entry);
      if(res && res.id) removeQueuedEntry(entry.id);
    } catch(err){
      if(err.message === 'unauthorized') forceRelogin('Your session has expired — please sign in again');
      updateSyncIndicator(!navigator.onLine);
      return;
    }
  }
  updateSyncIndicator();
}
function installOfflineListeners(){
  window.addEventListener('online', async ()=>{ updateSyncIndicator(); await flushOfflineQueue(); await doSync(); });
  window.addEventListener('offline', ()=>updateSyncIndicator(true));
  updateSyncIndicator();
}

// ── API ────────────────────────────────────────────────────────────────────
async function api(method, path, body){
  const opts = { method, headers: {'Content-Type':'application/json'} };
  opts.credentials = 'include';
  if(body) opts.body = JSON.stringify(body);
  const res = await fetch(API_BASE + path, opts);
  const data = await res.json();
  if(!res.ok) throw new Error(data.error || 'API error');
  return data;
}

// ── Login ──────────────────────────────────────────────────────────────────
const LOGIN_ERROR_MESSAGES = {
  missing_fields: 'Enter your username and password.',
  invalid_credentials: 'Incorrect username or password.',
  network_error: 'Could not reach the server. Try again.',
};
function showLoginError(code, raw){
  const box = document.getElementById('login-error');
  if(!box) return;
  box.textContent = LOGIN_ERROR_MESSAGES[code] || (raw || 'Login failed. Try again.');
  box.classList.remove('hidden');
}
function clearLoginError(){
  const box = document.getElementById('login-error');
  if(box){ box.classList.add('hidden'); box.textContent=''; }
}

document.getElementById('login-form').addEventListener('submit', async function(e){
  e.preventDefault();
  if(!enforceDeviceShell()) return;
  clearLoginError();
  const username = document.getElementById('l-username').value.trim();
  const password = document.getElementById('l-password').value;
  if(!username || !password){ showLoginError('missing_fields'); return; }
  try {
    const res = await api('POST', '/auth/password', { username, password });
    if(res.ok && res.user){
      const su = res.user;
      user = {
        method: 'password',
        id: su.id,
        name: su.first_name || su.username || username,
        username: su.username || username,
        role: su.role || 'agent',
      };
      saveUserLocal(user);
      if(!enforceDeviceShell()) return;
      await enterApp();
    } else {
      showLoginError(res.error || 'invalid_credentials');
    }
  } catch(err){ showLoginError('network_error'); }
});

function isDesktop(){ const a=document.getElementById('app'); return a && a.dataset.layout === 'desktop'; }

// Toggle the authenticated chrome of whichever layout is loaded.
function setAuthed(on){
  document.body.classList.toggle('is-authed', !!on);
  const nav = document.getElementById('bottomnav');
  if(nav) nav.classList.toggle('hidden', !on);
}

function logout(){
  if(!confirm('Are you sure you want to logout?')) return;
  localStorage.removeItem(USER_KEY); user = null;
  stopSync();
  try { api('POST', '/logout'); } catch(e) {}
  setAuthed(false);
  document.getElementById('login-form').reset();
  showScreen('login');
}

function forceRelogin(msg){
  // Server session is gone (expired / secret changed / cookie dropped) —
  // clear the stale local user and return to the login screen.
  localStorage.removeItem(USER_KEY); user = null;
  stopSync();
  try { api('POST', '/logout'); } catch(e) {}
  setAuthed(false);
  document.getElementById('login-form').reset();
  showScreen('login');
  toast(msg || 'Session expired — please sign in again');
}

const ADMIN_ROLES = ['developer', 'super_admin'];
async function wipeAll(){
  const count = getVisibleList().length;
  if(!confirm('Wipe ALL oil change records for the whole team?\n\nRecords in the current view: ' + count + '\n\nThis cannot be undone.')) return;
  if(!confirm('Final confirmation — permanently delete every record?')) return;
  try{
    await api('DELETE', '/api/entries');
    entries = [];
    renderList();
    toast('All records deleted');
  } catch(err){
    if(err.message === 'unauthorized'){ forceRelogin(); }
    else if(err.message === 'forbidden_role'){ toast('Only admins can wipe records'); }
    else toast('Error: ' + (err.message || 'could not delete'));
  }
}

// ── Sync ───────────────────────────────────────────────────────────────────
function startSync(){
  stopSync();
  syncTimer = setInterval(doSync, 5000);
  flushOfflineQueue();
}
function stopSync(){
  if(syncTimer) { clearInterval(syncTimer); syncTimer = null; }
}
async function doSync(){
  if(!navigator.onLine){ updateSyncIndicator(true); return; }
  try {
    await flushOfflineQueue();
    const data = await api('GET', '/api/sync');
    entries = mergeEntries(data.entries || [], readOfflineQueue());
    writeCachedEntries();
    updateSyncIndicator();
    if(document.getElementById('screen-list').classList.contains('active')) renderList();
  } catch(e) { updateSyncIndicator(!navigator.onLine); }
}

async function fetchAllEntries(){
  entries = readCachedEntries();
  if(!navigator.onLine){ updateSyncIndicator(true); return entries; }
  try {
    await flushOfflineQueue();
    const data = await api('GET', '/api/sync');
    entries = mergeEntries(data.entries || [], readOfflineQueue());
    writeCachedEntries();
    updateSyncIndicator();
    return entries;
  } catch(e) { updateSyncIndicator(!navigator.onLine); return entries; }
}

// ── Enter app ──────────────────────────────────────────────────────────────
async function enterApp(){
  const chipNames = document.querySelectorAll('.userchip-name');
  if(user && user.photo_url) {
    chipNames.forEach(n => { n.textContent = user.name; });
  } else {
    chipNames.forEach(n => { n.textContent = user ? user.name : '—'; });
  }
  document.getElementById('s-name').value = user ? user.name : '';
  document.getElementById('settings-login-method').textContent = user ? 'Account ('+user.name+')' : '—';
  setAuthed(true);
  const roleEl = document.getElementById('side-role');
  if(roleEl) roleEl.textContent = user && user.role ? user.role.replace(/_/g,' ') : 'Agent';
  const wipeBtn = document.getElementById('wipe-btn');
  if(wipeBtn) wipeBtn.classList.toggle('hidden', !user || !ADMIN_ROLES.includes(user.role));
  const chicagoDate = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Chicago', year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date());
  document.getElementById('f-date').value = chicagoDate;
  const fDateDisp = document.getElementById('f-date-display');
  if(fDateDisp){
    const d = new Date(chicagoDate + 'T00:00:00');
    fDateDisp.textContent = d.toLocaleDateString('en-US',{weekday:'short',day:'2-digit',month:'short',year:'numeric'});
    fDateDisp.classList.remove('placeholder');
  }
  updateChicagoClock();
  showScreen('add');
  entries = readCachedEntries();
  writeCachedEntries();
  updateSyncIndicator();
  entries = await fetchAllEntries();
  startSync();
  icons();
}

// Screen titles for the desktop header (mobile keeps its own in-screen topbars).
const SCREEN_META = {
  add:      { title:'New oil change',  sub:'Complete after each invoice from the shop.' },
  list:     { title:'Oil change list', sub:'Every record logged by the team.' },
  search:   { title:'Search records',  sub:'Find units, filter dates, and open unit history.' },
  activity: { title:'Activity',        sub:'Recent changes made in OILLOG.' },
  settings: { title:'Settings',        sub:'Your profile and workspace details.' },
  login:    { title:'Sign in',         sub:'' },
};

function showScreen(name){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('screen-'+name).classList.add('active');
  document.querySelectorAll('.navbtn').forEach(b=>b.classList.toggle('active', b.dataset.screen===name));
  document.querySelectorAll('.side-navbtn').forEach(b=>b.classList.toggle('active', b.dataset.screen===name));
  // Desktop header reflects the active screen
  const meta = SCREEN_META[name];
  const headTitle = document.getElementById('head-title');
  if(meta && headTitle){
    headTitle.textContent = meta.title;
    document.getElementById('head-sub').textContent = meta.sub;
  }
  if(name==='list'){ fetchAllEntries().then(list=>{ entries=list; renderList(); }); }
  if(name==='search'){ fetchAllEntries().then(list=>{ entries=list; renderSearch(); }); }
  if(name==='activity'){ loadActivity(); }
  updateListQuickActions(name);
  if(name==='settings') renderSettings();
}

function updateListQuickActions(name){
  const visible=name==='list';
  // Download / Share are mobile-only quick actions in the bottom navigation.
  const mobileDownload=document.getElementById('mobile-download-action');
  const mobileShare=document.getElementById('mobile-share-action');
  if(mobileDownload) mobileDownload.classList.toggle('hidden', !visible);
  if(mobileShare) mobileShare.classList.toggle('hidden', !visible);
}

function resetAddForm(){
  editingEntryId=null;
  const btn=document.querySelector('#screen-add .add-record-btn');
  if(btn) btn.innerHTML='<span class="ph ph-plus"></span> Add record';
  const title=document.getElementById('head-title');
  const sub=document.getElementById('head-sub');
  if(title && document.getElementById('screen-add')?.classList.contains('active')){ title.textContent='New oil change'; sub.textContent='Complete after each invoice from the shop.'; }
}

function editEntry(id){
  const e=entries.find(x=>String(x.id)===String(id));
  if(!e) return;
  if(!navigator.onLine){ toast('Connect to the internet to edit a saved record'); return; }
  editingEntryId=e.id;
  const overlay=document.getElementById('edit-record-overlay');
  if(!overlay) return;
  document.getElementById('edit-date').value=e.date||'';
  setEditType(e.type||'T');
  document.getElementById('edit-unit').value=e.unit||'';
  document.getElementById('edit-value').value=e.value ?? '';
  overlay.classList.remove('hidden');
  setTimeout(()=>document.getElementById('edit-unit')?.focus(),50);
}

function setEditType(type){
  const value=type==='R'?'R':'T';
  const input=document.getElementById('edit-type');
  if(input) input.value=value;
  document.querySelectorAll('.edit-type-chip').forEach(btn=>btn.classList.toggle('active',btn.dataset.editType===value));
}

function closeEditModal(event){
  if(event && event.target!==event.currentTarget) return;
  const overlay=document.getElementById('edit-record-overlay');
  if(overlay) overlay.classList.add('hidden');
  editingEntryId=null;
}

async function saveEditModal(event){
  event.preventDefault();
  if(!editingEntryId) return;
  const old=entries.find(x=>String(x.id)===String(editingEntryId));
  if(!old) return;
  if(!navigator.onLine){ toast('Connect to the internet to save changes'); return; }
  const date=document.getElementById('edit-date').value;
  const type=document.getElementById('edit-type').value;
  const unit=document.getElementById('edit-unit').value.trim();
  const valueRaw=document.getElementById('edit-value').value.trim();
  const value=Number(valueRaw);
  if(!date){ toast('⚠ Select a date'); return; }
  if(date>chicagoTodayISO()){ toast('⚠ Date cannot be in the future'); return; }
  if(!unit){ toast('⚠ Enter a unit number'); return; }
  if(!valueRaw || !Number.isFinite(value) || value<0){ toast('⚠ Enter a valid mileage / engine hours value'); return; }
  const updated={...old,date,type,unit,unitOfValue:type==='R'?'hr':'mi',value:String(value),editedAt:Date.now()};
  try{
    await api('PUT','/api/entries/'+encodeURIComponent(editingEntryId),updated);
    entries=entries.map(x=>String(x.id)===String(editingEntryId)?updated:x);
    writeCachedEntries();
    closeEditModal();
    renderList();
    if(document.getElementById('screen-search')?.classList.contains('active')) renderSearch();
    toast('✓ Changes saved');
  }catch(err){ toast(navigator.onLine ? 'Error saving changes' : 'Offline — changes not saved'); }
}

function selectType(t){
  currentType = t;
  document.querySelectorAll('.chip[data-type]').forEach(c=>c.classList.toggle('active', c.dataset.type===t));
  selectUnit(t === 'R' ? 'hr' : 'mi');
}
function selectUnit(u){
  currentUnit = u;
  document.querySelectorAll('.chip[data-unit]').forEach(c=>c.classList.toggle('active', c.dataset.unit===u));
  document.getElementById('f-value-label').innerHTML = (u==='hr' ? '<i class="ph ph-clock"></i>Engine hours' : '<i class="ph ph-pulse"></i>Mileage');
  document.getElementById('f-value').placeholder = u === 'hr' ? 'ex. 20205' : 'ex. 304670';
  icons();
}

// ── Single ADD action ──────────────────────────────────────────────────────
// Opens the add form. Saving is handled by the central form button.
function addOrSave(){
  if(document.getElementById('screen-add').classList.contains('active')){
    const form = document.getElementById('entry-form');
    if(form.requestSubmit) form.requestSubmit();
    else form.dispatchEvent(new Event('submit', {cancelable:true}));
  } else {
    showScreen('add');
  }
}

// ── Submit form ────────────────────────────────────────────────────────────
document.getElementById('entry-form').addEventListener('submit', async function(e){
  e.preventDefault();
  const dateField = document.getElementById('f-date');
  const unit = document.getElementById('f-unit').value.trim();
  const valueRaw = document.getElementById('f-value').value.trim();
  const value = Number(valueRaw);
  if(!dateField.value){ toast('⚠ Select the oil change date first'); openDatePicker(); return; }
  if(!unit){ toast('⚠ Enter a unit number'); document.getElementById('f-unit').focus(); return; }
  if(!valueRaw || !Number.isFinite(value) || value < 0){ toast('⚠ Enter a valid mileage / engine hours value'); document.getElementById('f-value').focus(); return; }
  if(dateField.value > chicagoTodayISO()){ toast('⚠ Date cannot be in the future'); return; }


  const now=Date.now();
  const entry={id:now+'_'+Math.random().toString(36).slice(2,8),date:dateField.value,type:currentType,unit,unitOfValue:currentUnit,value:String(value),addedBy:user?user.name:'Unknown',sent:false,createdAt:now};
  entries=mergeEntries([entry],entries); writeCachedEntries(); queueEntry(entry);
  document.getElementById('f-unit').value=''; document.getElementById('f-value').value=''; document.getElementById('f-unit').focus(); updateSyncIndicator();
  if(navigator.onLine){ await flushOfflineQueue(); writeCachedEntries(); toast('✓ Saved: '+entry.unit); } else toast('✓ Saved offline: '+entry.unit);
});

function chicagoTodayISO(){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}

function setFilter(f){
  currentFilter = f;
  document.querySelectorAll('.filter-pill[data-filter]').forEach(p=>p.classList.toggle('active', p.dataset.filter===f));
  renderList();
}
function setScope(s){
  currentScope = s;
  document.querySelectorAll('.filter-pill[data-scope]').forEach(p=>p.classList.toggle('active', p.dataset.scope===s));
  renderList();
}

function typeIcon(t){ return t==='T' ? 'truck' : 'wind'; }
function unitSuffix(u){ return u==='hr' ? 'hrs' : 'mi'; }
function typeLabel(t){ return t==='T' ? 'Truck' : 'Reefer'; }

function renderList(){
  const container = document.getElementById('list-container');
  let filtered = entries.filter(e => currentFilter==='all' || e.type===currentFilter);
  if(currentScope==='mine' && user) filtered = filtered.filter(e => e.addedBy===user.name);
  filtered.sort((a,b)=> b.date.localeCompare(a.date) || (b.createdAt||0)-(a.createdAt||0));

  setCount('sum-count', filtered.length);
  setCount('sum-trucks', filtered.filter(e=>e.type==='T').length);
  setCount('sum-reefers', filtered.filter(e=>e.type==='R').length);

  if(filtered.length===0){
    container.innerHTML = isDesktop()
      ? `<div class="table-empty"><span class="ph ph-tray"></span><p>No records yet.<br>Open the add form to log the first oil change.</p></div>`
      : `<div class="empty-state"><span class="ph ph-tray"></span><p>No records yet.<br>Add your first oil change from the "Add" tab.</p></div>`;
    return;
  }
  if(isDesktop()){ renderTable(container, filtered); return; }

  const groups = {};
  filtered.forEach(e => { (groups[e.date] = groups[e.date]||[]).push(e); });
  const dates = Object.keys(groups).sort().reverse();

  container.innerHTML = dates.map(date => `
    <div class="day-group">
      <div class="day-label">${formatDate(date)}</div>
      ${groups[date].map(e => `
        <div class="entry">
          <div class="type-badge"><span class="ph ph-${typeIcon(e.type)}"></span></div>
          <div class="info">
            <button class="unit-num unit-history-link" type="button" onclick='showUnitHistory(${JSON.stringify(e.unit)})'>#${escapeHtml(e.unit)}</button>
            <div class="meta">${typeLabel(e.type)} · ${escapeHtml(e.addedBy)} · added ${formatAddedAt(e.createdAt)}</div>
          </div>
          <div class="value">${Number(e.value).toLocaleString('en-US')}<small>${unitSuffix(e.unitOfValue)}</small></div>
          <button class="edit-mini" onclick="editEntry('${e.id}')" title="Edit"><span class="ph ph-pencil-simple"></span></button>
          <button class="del" onclick="deleteEntry('${e.id}')"><span class="ph ph-x"></span></button>
        </div>
      `).join('')}
    </div>
  `).join('');
}

function setCount(id, n){ const el = document.getElementById(id); if(el) el.textContent = n; }

// Desktop: a real data table instead of cards.
function renderTable(container, filtered){
  container.innerHTML = `
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Unit</th>
            <th class="num">Reading</th>
            <th>Added by</th>
            <th>Logged</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(e => `
            <tr>
              <td class="mono">${formatDate(e.date)}</td>
              <td><span class="type-tag"><span class="ph ph-${typeIcon(e.type)}"></span>${typeLabel(e.type)}</span></td>
              <td class="mono strong"><button class="unit-history-link table-unit-link" type="button" onclick='showUnitHistory(${JSON.stringify(e.unit)})'>#${escapeHtml(e.unit)}</button></td>
              <td class="num">${Number(e.value).toLocaleString('en-US')} <small>${unitSuffix(e.unitOfValue)}</small></td>
              <td class="dim">${escapeHtml(e.addedBy)}</td>
              <td class="dim">${formatAddedAt(e.createdAt)}</td>
              <td class="actions"><button class="row-edit" title="Edit" onclick="editEntry('${e.id}')"><span class="ph ph-pencil-simple"></span></button><button class="row-del" title="Delete" onclick="deleteEntry('${e.id}')"><span class="ph ph-trash"></span></button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
}

function formatDate(iso){
  const d = new Date(iso+'T00:00:00');
  return d.toLocaleDateString('en-US', {weekday:'short', day:'2-digit', month:'2-digit'}).toUpperCase();
}

function formatAddedAt(ts){
  if(!ts) return '—';
  const d = new Date(ts);
  const datePart = d.toLocaleDateString('en-US', {day:'2-digit', month:'2-digit'});
  const timePart = d.toLocaleTimeString('en-US', {hour:'2-digit', minute:'2-digit'});
  return `${datePart} ${timePart}`;
}

async function deleteEntry(id){
  if(!confirm('Delete this record permanently?')) return;
  // If it has not synced yet, deleting it locally is enough — remove it from
  // the queue so it can never appear on the server later.
  if(readOfflineQueue().some(e=>e.id===id)){
    removeQueuedEntry(id);
    entries = entries.filter(e=>e.id!==id);
    writeCachedEntries();
    renderList();
    toast('Deleted');
    return;
  }
  try{
    await api('DELETE', '/api/entries/' + id);
    entries = entries.filter(e=>e.id!==id);
    writeCachedEntries();
    renderList();
    toast('Deleted');
  } catch(e){ toast(navigator.onLine ? 'Error deleting' : 'Offline — try again when connected'); }
}

function setSearchType(type){
  searchType=type;
  document.querySelectorAll('[data-search-type]').forEach(el=>el.classList.toggle('active',el.dataset.searchType===type));
  renderSearch();
}
function chicagoCalendarDate(){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const o={}; parts.forEach(p=>o[p.type]=p.value);
  return new Date(Date.UTC(Number(o.year),Number(o.month)-1,Number(o.day)));
}
function utcISODate(d){ return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`; }
function setSearchRange(kind){
  const base=chicagoCalendarDate(); const today=utcISODate(base);
  let from=today,to=today;
  if(kind==='yesterday'){ const d=new Date(base); d.setUTCDate(d.getUTCDate()-1); from=to=utcISODate(d); }
  if(kind==='week'){ const d=new Date(base); const day=(d.getUTCDay()+6)%7; d.setUTCDate(d.getUTCDate()-day); from=utcISODate(d); }
  if(kind==='month'){ const d=new Date(base); d.setUTCDate(1); from=utcISODate(d); }
  document.getElementById('search-from').value=from; document.getElementById('search-to').value=to; renderSearch();
}
function clearSearch(){
  ['search-unit','search-from','search-to'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  setSearchType('all');
}
function getSearchResults(){
  const q=(document.getElementById('search-unit')?.value||'').trim().toLowerCase();
  const from=document.getElementById('search-from')?.value||''; const to=document.getElementById('search-to')?.value||'';
  return entries.filter(e=>{
    if(q && !String(e.unit||'').toLowerCase().includes(q)) return false;
    if(from && e.date<from) return false; if(to && e.date>to) return false;
    if(searchType!=='all' && e.type!==searchType) return false;
    return true;
  }).sort((a,b)=>b.date.localeCompare(a.date)||(b.createdAt||0)-(a.createdAt||0));
}
function renderSearch(){
  const results=getSearchResults(); searchResults=results;
  setCount('search-count',results.length);
  setCount('search-units',new Set(results.map(e=>String(e.unit||'').toLowerCase())).size);
  setCount('search-trucks',results.filter(e=>e.type==='T').length);
  setCount('search-reefers',results.filter(e=>e.type==='R').length);
  const sub=document.getElementById('search-results-sub'); if(sub) sub.textContent=results.length===1?'1 matching record':'Click a unit to open its history.';
  const out=document.getElementById('search-results'); if(!out)return;
  if(!results.length){out.innerHTML='<div class="table-empty"><span class="ph ph-magnifying-glass"></span><p>No matching records.<br>Try a different unit or date range.</p></div>';return;}
  out.innerHTML=isDesktop()?`<div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Type</th><th>Unit</th><th class="num">Reading</th><th>Added by</th><th>Logged</th><th></th></tr></thead><tbody>${results.map(e=>`<tr><td class="mono">${formatDate(e.date)}</td><td><span class="type-tag"><span class="ph ph-${typeIcon(e.type)}"></span>${typeLabel(e.type)}</span></td><td class="mono strong"><button class="unit-history-link table-unit-link" type="button" onclick='showUnitHistory(${JSON.stringify(e.unit)})'>#${escapeHtml(e.unit)}</button></td><td class="num">${Number(e.value).toLocaleString('en-US')} <small>${unitSuffix(e.unitOfValue)}</small></td><td class="dim">${escapeHtml(e.addedBy)}</td><td class="dim">${formatAddedAt(e.createdAt)}</td><td class="actions"><button class="row-edit" title="Edit" onclick="editEntry('${e.id}')"><span class="ph ph-pencil-simple"></span></button></td></tr>`).join('')}</tbody></table></div>`:results.map(e=>`<div class="entry"><div class="type-badge"><span class="ph ph-${typeIcon(e.type)}"></span></div><div class="info"><button class="unit-num unit-history-link" type="button" onclick='showUnitHistory(${JSON.stringify(e.unit)})'>#${escapeHtml(e.unit)}</button><div class="meta">${typeLabel(e.type)} · ${escapeHtml(e.addedBy)}</div></div><div class="value">${Number(e.value).toLocaleString('en-US')}<small>${unitSuffix(e.unitOfValue)}</small></div><button class="edit-mini" onclick="editEntry('${e.id}')"><span class="ph ph-pencil-simple"></span></button></div>`).join('');
}
async function exportSearchXLSX(){
  const oldFilter=currentFilter, oldScope=currentScope;
  const list=searchResults.length?searchResults:getSearchResults();
  if(!list.length){toast('No records');return;}
  // Export the actual search result set, independent of Records tab filters.
  const rows=[...list].sort((a,b)=>a.date.localeCompare(b.date));
  const wb=new ExcelJS.Workbook(); const ws=wb.addWorksheet('Search Results',{views:[{state:'frozen',ySplit:1}]});
  ws.columns=[{header:'Date',key:'date',width:13},{header:'Unit Type',key:'type',width:12},{header:'Unit Number',key:'unit',width:14},{header:'Value',key:'value',width:14},{header:'Unit',key:'unitOfValue',width:10},{header:'Added By',key:'addedBy',width:18}];
  rows.forEach(e=>ws.addRow({date:e.date,type:typeLabel(e.type),unit:e.unit,value:Number(e.value),unitOfValue:e.unitOfValue==='hr'?'Hours':'Miles',addedBy:e.addedBy}));
  const buf=await wb.xlsx.writeBuffer(); const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})); a.download='oillog-search.xlsx'; a.click(); URL.revokeObjectURL(a.href); toast('Excel downloaded');
}
async function loadActivity(){
  const box=document.getElementById('activity-list'); if(!box)return;
  try{ activityEntries=await api('GET','/api/activity'); renderActivity(); }catch(e){ box.innerHTML='<div class="table-empty"><span class="ph ph-warning"></span><p>Activity could not be loaded.</p></div>'; }
}
function activityDateISO(ts){
  if(!ts) return '';
  const d=new Date(ts);
  return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
}
function activityDayLabel(iso){
  if(!iso)return '';
  const today=chicagoTodayISO();
  const d=new Date(iso+'T12:00:00');
  const y=new Date(today+'T12:00:00');
  const diff=Math.round((y-d)/86400000);
  if(diff===0)return 'TODAY';
  if(diff===1)return 'YESTERDAY';
  return new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',weekday:'short',month:'short',day:'2-digit'}).format(d).toUpperCase();
}
function renderActivity(){
  const box=document.getElementById('activity-list'); if(!box)return;
  const q=(document.getElementById('activity-unit')?.value||'').trim().toLowerCase();
  const action=document.getElementById('activity-action')?.value||'all';
  const from=document.getElementById('activity-from')?.value||'';
  const to=document.getElementById('activity-to')?.value||'';
  const counts={total:activityEntries.length,added:0,edited:0,deleted:0};
  activityEntries.forEach(a=>{if(counts[a.action]!==undefined)counts[a.action]++;});
  ['total','added','edited','deleted'].forEach(k=>{const el=document.getElementById('activity-'+k);if(el)el.textContent=counts[k];});
  const rows=activityEntries.filter(a=>{
    const day=activityDateISO(a.timestamp);
    return (!q||String(a.unit||'').toLowerCase().includes(q)||String(a.description||'').toLowerCase().includes(q)) &&
      (action==='all'||a.action===action) && (!from||day>=from) && (!to||day<=to);
  }).sort((a,b)=>(b.timestamp||0)-(a.timestamp||0));
  if(!rows.length){box.innerHTML='<div class="table-empty"><span class="ph ph-clock-counter-clockwise"></span><p>No activity found.</p><small>Try a different unit, action or date range.</small></div>';return;}
  const groups=[];
  rows.forEach(a=>{const day=activityDateISO(a.timestamp);let g=groups.find(x=>x.day===day);if(!g){g={day,rows:[]};groups.push(g);}g.rows.push(a);});
  box.innerHTML=groups.map(g=>`<section class="activity-group"><div class="activity-day">${activityDayLabel(g.day)}</div>${g.rows.map(a=>{
    const icon=a.action==='added'?'plus':a.action==='edited'?'pencil-simple':'trash';
    return `<div class="activity-row"><div class="activity-icon action-${escapeHtml(a.action)}"><span class="ph ph-${icon}"></span></div><div class="activity-main"><strong>${escapeHtml(a.description||a.action)}</strong><span>${escapeHtml(a.user||'Unknown')} · ${formatActivityTime(a.timestamp)}</span></div><span class="activity-action action-${escapeHtml(a.action)}">${escapeHtml(a.action)}</span></div>`;
  }).join('')}</section>`).join('');
}
function formatActivityTime(ts){ if(!ts)return '—'; return new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',month:'short',day:'2-digit',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(ts))+' CT'; }

function buildListText(list){
  const rows = [...list].sort((a,b)=> a.date.localeCompare(b.date));
  if(rows.length===0) return null;
  let txt = `OIL CHANGE LIST\n`;
  rows.forEach(e=>{ txt += `${formatShortDate(e.date)}  ${e.type.padEnd(2,' ')}  #${e.unit}  ->  ${Number(e.value).toLocaleString('en-US')} ${unitSuffix(e.unitOfValue)}\n`; });
  txt += `\nTotal: ${rows.length} units`;
  return txt;
}
function formatShortDate(iso){ const [y,m,d] = iso.split('-'); return `${m}/${d}`; }

function getVisibleList(){
  let filtered = entries.filter(e => currentFilter==='all' || e.type===currentFilter);
  if(currentScope==='mine' && user) filtered = filtered.filter(e => e.addedBy===user.name);
  return filtered;
}

async function exportXLSX(){
  const list = getVisibleList();
  if(list.length===0){ toast('No records'); return; }
  const rows = [...list].sort((a,b)=>a.date.localeCompare(b.date));

  const wb = new ExcelJS.Workbook();
  wb.creator = 'OILLOG'; wb.created = new Date();
  const ws = wb.addWorksheet('Oil Change List', { views:[{ state:'frozen', ySplit:1 }] });

  ws.columns = [
    { header:'Date', key:'date', width:13 },
    { header:'Unit Type', key:'type', width:12 },
    { header:'Unit Number', key:'unit', width:14 },
    { header:'Value', key:'value', width:14 },
    { header:'Unit', key:'unitOfValue', width:10 },
    { header:'Added By', key:'addedBy', width:18 },
  ];

  const RED = 'FFC8102E', DARK = 'FF1A1A1A', LIGHT = 'FFF9F7F5', BORDER = 'FFE5E3E0';

  const header = ws.getRow(1);
  header.height = 24;
  header.eachCell(cell=>{
    cell.font = { bold:true, color:{argb:'FFFFFFFF'}, size:11, name:'Calibri' };
    cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:RED} };
    cell.alignment = { vertical:'middle', horizontal:'left' };
    cell.border = { bottom:{style:'thin', color:{argb:RED}} };
  });

  rows.forEach((e, i)=>{
    const row = ws.addRow({
      date: e.date,
      type: typeLabel(e.type),
      unit: e.unit,
      value: Number(e.value),
      unitOfValue: e.unitOfValue==='hr' ? 'Hours' : 'Miles',
      addedBy: e.addedBy,
    });
    row.eachCell(cell=>{
      cell.font = { name:'Calibri', size:11, color:{argb:DARK} };
      cell.border = { bottom:{style:'thin', color:{argb:BORDER}} };
      cell.alignment = { vertical:'middle' };
      if(i % 2 === 1) cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:LIGHT} };
    });
    row.getCell('unit').font = { name:'Consolas', size:11, bold:true, color:{argb:DARK} };
    row.getCell('value').numFmt = '#,##0';
    row.getCell('value').alignment = { horizontal:'right' };
  });

  ws.autoFilter = { from:'A1', to: String.fromCharCode(65+ws.columns.length-1)+'1' };

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `oil-change-list_${new Date().toISOString().slice(0,10)}.xlsx`;
  a.click(); URL.revokeObjectURL(url);
  toast('Excel downloaded');
}
function shareList(){
  const txt = buildListText(getVisibleList());
  if(!txt){ toast('No records'); return; }
  if(navigator.share){
    navigator.share({ title:'Oil Change List', text:txt }).catch(()=>{});
  } else {
    navigator.clipboard.writeText(txt).then(()=> toast('Copied')).catch(()=> toast('Could not copy'));
  }
}

function showUnitHistory(unit){
  const overlay=document.getElementById('unit-history-overlay'), list=document.getElementById('unit-history-list');
  if(!overlay || !list) return;
  const clean=String(unit||'').trim();
  const rows=entries.filter(e=>String(e.unit||'').trim().toLowerCase()===clean.toLowerCase())
    .sort((a,b)=>b.date.localeCompare(a.date)||(b.createdAt||0)-(a.createdAt||0));
  document.getElementById('unit-history-title').textContent = clean ? '#'+clean : 'Unit history';
  document.getElementById('unit-history-summary').textContent = `${rows.length} oil change${rows.length===1?'':'s'} recorded`;
  list.innerHTML = rows.length ? rows.map(e=>`<div class="history-row"><div><strong>${formatDate(e.date)}</strong><span>${typeLabel(e.type)} · ${formatAddedAt(e.createdAt)}</span></div><div class="history-reading">${Number(e.value).toLocaleString('en-US')} <small>${unitSuffix(e.unitOfValue)}</small></div></div>`).join('') : '<div class="empty-state"><span class="ph ph-tray"></span><p>No history for this unit.</p></div>';
  overlay.classList.remove('hidden');
}
function closeUnitHistory(e){
  const overlay=document.getElementById('unit-history-overlay');
  if(overlay) overlay.classList.add('hidden');
}

function renderSettings(){
  document.getElementById('settings-total').textContent = user ? entries.filter(e=>e.addedBy===user.name).length : 0;
  // Live build stamp: if this still shows an older number after a deploy, the
  // page you are looking at came from a cache, not from the server.
  document.querySelectorAll('[data-build]').forEach(el => { el.textContent = APP_BUILD; });
}
function saveName(){
  const name = document.getElementById('s-name').value.trim() || user.name;
  user.name = name; saveUserLocal(user);
  document.querySelectorAll('.userchip-name').forEach(n => { n.textContent = user.name; });
  toast('Name updated');
}

// ── Init ───────────────────────────────────────────────────────────────────
(async function init(){
  if(!enforceDeviceShell()) return;
  user = loadUser();
  try {
    const status = await api('GET', '/auth/status');
    if(status.ok && status.user) {
      const su = status.user;
      user = {
        method: su.method || 'password',
        id: su.id,
        name: su.first_name || (user ? user.name : 'Unknown'),
        username: su.username || '',
        role: su.role || 'agent',
      };
      saveUserLocal(user);
      await enterApp();
    } else if(user) {
      // No server session — try silent re-login with username/password
      user = null; localStorage.removeItem(USER_KEY);
      icons();
    } else {
      icons();
    }
  } catch(e) {
    // Server unreachable — if we have a cached user, enter anyway
    if(user) await enterApp(); else icons();
  }
  // ── Stale-build recovery ───────────────────────────────────────────────
  // A service worker can pin an old cached shell for good. Compare the build
  // the server is running against the build this page was loaded with, and if
  // the server is newer: drop every cache, unregister the worker, reload once.
  // Without this, a single stuck cache can hide a deploy indefinitely.
  const BUILD_KEY = 'oillog_build_seen';
  async function checkBuild(){
    let serverBuild = null;
    try {
      const r = await fetch(API_BASE + '/api/version?t=' + Date.now(), { cache: 'no-store' });
      if(r.ok) serverBuild = (await r.json()).build;
    } catch(e) { return; }               // offline — keep working from cache
    if(!serverBuild || String(serverBuild) === APP_BUILD) return;

    // Guard against a reload loop if the server keeps reporting a new build.
    const seen = sessionStorage.getItem(BUILD_KEY);
    if(seen === String(serverBuild)) return;
    sessionStorage.setItem(BUILD_KEY, String(serverBuild));

    try {
      if('caches' in window){
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      if('serviceWorker' in navigator){
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(reg => reg.unregister()));
      }
    } catch(e) {}
    location.reload();
  }
  checkBuild();

  if('serviceWorker' in navigator){
    window.addEventListener('load', ()=>{
      navigator.serviceWorker.register('service-worker.js').then(reg=>{
        // A worker was already waiting when we registered (e.g. update
        // arrived while the tab was in the background).
        if(reg.waiting) showUpdateBanner(reg.waiting);
        reg.addEventListener('updatefound', ()=>{
          const nw = reg.installing;
          if(!nw) return;
          nw.addEventListener('statechange', ()=>{
            // 'installed' + an existing controller means this is an update,
            // not the very first install — only then do we bug the user.
            if(nw.state === 'installed' && navigator.serviceWorker.controller){
              showUpdateBanner(nw);
            }
          });
        });
      }).catch(()=>{});

      let hasReloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', ()=>{
        if(hasReloaded) return;
        hasReloaded = true;
        window.location.reload();
      });
    });
  }
  let pendingWorker = null;
  function showUpdateBanner(worker){
    pendingWorker = worker;
    document.getElementById('update-banner').classList.add('show');
  }
  window.applyUpdate = function(){
    if(pendingWorker) pendingWorker.postMessage({type:'SKIP_WAITING'});
    document.getElementById('update-banner').classList.remove('show');
  };

  // ── Custom date picker ────────────────────────────────────────────────
  let dpCurrentMonth = new Date();
  window.openDatePicker = function(){
    const existing = document.getElementById('f-date').value;
    dpCurrentMonth = existing ? new Date(existing+'T00:00:00') : new Date();
    dpRender();
    document.getElementById('date-picker-overlay').classList.remove('hidden');
  };
  window.closeDatePicker = function(e){
    document.getElementById('date-picker-overlay').classList.add('hidden');
  };
  window.dpChangeMonth = function(delta){
    dpCurrentMonth = new Date(dpCurrentMonth.getFullYear(), dpCurrentMonth.getMonth()+delta, 1);
    dpRender();
  };
  function dpRender(){
    const y = dpCurrentMonth.getFullYear(), m = dpCurrentMonth.getMonth();
    document.getElementById('dp-month-label').textContent = dpCurrentMonth.toLocaleDateString('en-US',{month:'long', year:'numeric'});
    const selected = document.getElementById('f-date').value;
    const todayIso = new Date().toISOString().slice(0,10);
    const firstDay = new Date(y, m, 1);
    const startOffset = (firstDay.getDay()+6)%7; // Monday-first grid
    const daysInMonth = new Date(y, m+1, 0).getDate();
    let html = '';
    for(let i=0;i<startOffset;i++) html += `<div class="dp-cell empty">0</div>`;
    for(let d=1; d<=daysInMonth; d++){
      const iso = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const cls = ['dp-cell'];
      if(iso===todayIso) cls.push('today');
      if(iso===selected) cls.push('selected');
      html += `<button type="button" class="${cls.join(' ')}" onclick="dpSelectDate('${iso}')">${d}</button>`;
    }
    document.getElementById('dp-grid').innerHTML = html;
  }
  window.dpSelectDate = function(iso){
    document.getElementById('f-date').value = iso;
    const d = new Date(iso+'T00:00:00');
    const disp = document.getElementById('f-date-display');
    disp.textContent = d.toLocaleDateString('en-US',{weekday:'short', day:'2-digit', month:'short', year:'numeric'});
    disp.classList.remove('placeholder');
    closeDatePicker();
  };
  window.dpSelectToday = function(){
    dpSelectDate(chicagoTodayISO());
  };

  const addScreen = document.getElementById('screen-add');
  if(addScreen){
    function lockAppHeight(){
      // Pin the app to the viewport height only on phones — desktop scrolls normally
      if(window.innerWidth >= 860){ document.getElementById('app').style.height = ''; return; }
      const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      document.getElementById('app').style.height = h + 'px';
    }
    lockAppHeight();
    window.addEventListener('resize', lockAppHeight);
    window.addEventListener('orientationchange', () => setTimeout(lockAppHeight, 100));
  }

  document.addEventListener('touchmove', (e) => {
    if(isAddScreenActive && window.innerWidth < 860) e.preventDefault();
  }, { passive: false });
  document.addEventListener('wheel', (e) => {
    if(isAddScreenActive && window.innerWidth < 860) e.preventDefault();
  }, { passive: false });
})();
