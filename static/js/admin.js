const API_BASE = window.location.origin;
const ADMIN_USER_KEY = 'oillog_admin_user_v3';
const THEME_KEY = 'oillog_admin_theme';
const NOTIF_KEY = 'oillog_admin_notif';

let adminUser = null;
let entries = [];
let sortKey = 'date';
let sortDir = 'desc';
let typeFilter = 'all';
let unitTypeFilter = 'all';
let unitProfiles = {};
let intervals = { T:15000, R:500 };
let syncTimer = null;
let notifPrefs = { overdue:true, warn:true, browser:false };
let completedAlerts = [];
let openUnitKey = null;
let completeUnitKey = null;

function loadAdminUser(){ try{ return JSON.parse(localStorage.getItem(ADMIN_USER_KEY)) || null; }catch(e){ return null; } }
function saveAdminUser(u){ localStorage.setItem(ADMIN_USER_KEY, JSON.stringify(u)); }
function icons(){ /* Phosphor webfont — icons are pure CSS, nothing to re-render */ }
function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(window._t); window._t = setTimeout(()=>t.classList.remove('show'), 2200);
}

// ── Theme ─────────────────────────────────────────────────────────────────
function loadTheme(){ return localStorage.getItem(THEME_KEY) || 'light'; }
function applyTheme(t){
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem(THEME_KEY, t);
  document.querySelectorAll('.theme-opt').forEach(o=>o.classList.toggle('active', o.dataset.themeChoice===t));
  const icon = document.getElementById('theme-icon');
  if(icon) icon.className = 'ph ' + (t==='dark' ? 'ph-sun' : 'ph-moon');
}
function toggleTheme(){ applyTheme(document.documentElement.getAttribute('data-theme')==='dark' ? 'light' : 'dark'); }
function setTheme(t){ applyTheme(t); toast('Theme: '+(t==='dark'?'Dark':'Light')); }

// ── Notifications prefs ───────────────────────────────────────────────────
function loadNotifPrefs(){ try{ return Object.assign({overdue:true, warn:true, browser:false}, JSON.parse(localStorage.getItem(NOTIF_KEY)) || {}); }catch(e){ return {overdue:true, warn:true, browser:false}; } }
function saveNotifPrefs(){
  notifPrefs = {
    overdue: document.getElementById('notif-overdue').checked,
    warn: document.getElementById('notif-warn').checked,
    browser: document.getElementById('notif-browser').checked,
  };
  localStorage.setItem(NOTIF_KEY, JSON.stringify(notifPrefs));
  if(notifPrefs.browser && 'Notification' in window && Notification.permission==='default') Notification.requestPermission();
  toast('Preferences saved');
}
function applyNotifPrefs(){
  document.getElementById('notif-overdue').checked = notifPrefs.overdue;
  document.getElementById('notif-warn').checked = notifPrefs.warn;
  document.getElementById('notif-browser').checked = notifPrefs.browser;
}

// ── API ───────────────────────────────────────────────────────────────────
async function api(method, path, body){
  const opts = { method, headers: {'Content-Type':'application/json'} };
  opts.credentials = 'include';
  if(body) opts.body = JSON.stringify(body);
  const res = await fetch(API_BASE + path, opts);
  const data = await res.json();
  if(!res.ok) throw new Error(data.error || 'API error');
  return data;
}

function logoutAdmin(){
  if(!confirm('Are you sure you want to logout?')) return;
  localStorage.removeItem(ADMIN_USER_KEY);
  adminUser = null;
  stopSync();
  try { api('POST', '/logout'); } catch(e) {}
  window.location.href = '/admin-login';
}
function enterAdmin(){
  document.getElementById('admin-name').textContent = adminUser ? adminUser.name : '—';
  document.getElementById('sidebar').classList.remove('hidden');
  document.getElementById('main').classList.remove('hidden');
  document.getElementById('acc-name').textContent = adminUser ? adminUser.name : '—';
  document.getElementById('acc-role').textContent = adminUser ? adminUser.role : '—';
  icons();
  loadData();
  startSync();
  startClock();
}

// ── Central Time clock ────────────────────────────────────────────────────
function getCentralTime(){ return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })); }
function startClock(){ updateClock(); setInterval(updateClock, 1000); }
function updateClock(){
  const el = document.getElementById('top-clock-time');
  if(!el) return;
  el.textContent = getCentralTime().toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false });
}
function ctDateStr(){ return getCentralTime().toISOString().slice(0,10); }

// ── Navigation ────────────────────────────────────────────────────────────
const PAGE_TITLES = { dashboard:'Dashboard', entries:'Entries', units:'Units', alerts:'Alerts', users:'Users', settings:'Settings' };
function navigate(page){
  document.querySelectorAll('.s-item').forEach(b=>b.classList.toggle('active', b.dataset.page===page));
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById('page-'+page).classList.add('active');
  document.getElementById('topbar-title').textContent = PAGE_TITLES[page];
  document.getElementById('sidebar').classList.remove('open');
  if(page==='dashboard') renderDashboard();
  if(page==='entries') render();
  if(page==='units') renderUnits();
  if(page==='alerts') renderAlerts();
  if(page==='users') loadUsers();
  if(page==='settings') { applyTheme(loadTheme()); applyNotifPrefs(); }
  icons();
}
function showSettingsPanel(name){
  document.querySelectorAll('.sn-item').forEach(b=>b.classList.toggle('active', b.dataset.spanel===name));
  document.querySelectorAll('.settings-panel').forEach(p=>p.classList.remove('active'));
  document.getElementById('spanel-'+name).classList.add('active');
}

// ── Sync ─────────────────────────────────────────────────────────────────
function startSync(){ stopSync(); syncTimer = setInterval(doSync, 5000); }
function stopSync(){ if(syncTimer){ clearInterval(syncTimer); syncTimer=null; } }
async function doSync(){
  try{
    const data = await api('GET', '/api/sync');
    if(data.entries){
      entries = data.entries;
      unitProfiles = data.units || {};
      if(data.settings) intervals = data.settings;
      const active = document.querySelector('.page.active');
      if(active.id==='page-dashboard') renderDashboard();
      if(active.id==='page-entries') render();
      if(active.id==='page-units') renderUnits();
      if(active.id==='page-alerts') renderAlerts();
      updateBadges();
    }
  }catch(e){}
}
async function loadData(){
  try{
    const data = await api('GET', '/api/sync');
    entries = data.entries || [];
    unitProfiles = data.units || {};
    if(data.settings) intervals = data.settings;
    const active = document.querySelector('.page.active');
    if(active.id==='page-dashboard') renderDashboard();
    if(active.id==='page-entries') render();
    if(active.id==='page-units') renderUnits();
    if(active.id==='page-alerts') renderAlerts();
    updateBadges();
    icons();
    toast('Updated — ' + entries.length + ' records');
  } catch(e){ toast('Error loading data'); console.error(e); }
}

// ── Helpers ──────────────────────────────────────────────────────────────
function typeIcon(t){ return t==='T' ? 'truck' : 'wind'; }
function typeLabel(t){ return t==='T' ? 'Truck' : 'Reefer'; }
function unitSuffix(u){ return u==='hr' ? 'hrs' : 'mi'; }
function unitKey(type, unit){ return type+'_'+unit; }
function getLastEntry(type, unit){
  const list = entries.filter(e=>e.type===type && e.unit===unit);
  if(list.length===0) return null;
  return list.slice().sort((a,b)=> b.date.localeCompare(a.date) || (b.createdAt||0)-(a.createdAt||0))[0];
}
function getUniqueUnits(){
  const map = {};
  entries.forEach(e=>{ const k = unitKey(e.type, e.unit); if(!map[k]) map[k] = { type:e.type, unit:e.unit }; });
  return Object.values(map);
}
function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c => ({'&':'&','<':'<','>':'>','"':'"',"'":'&#39;'}[c])); }

// ── Status / next oil change ──────────────────────────────────────────────
function computeStatus(type, unit){
  const last = getLastEntry(type, unit);
  if(!last) return { status:'unknown', last:null, threshold:0, diff:0 };
  const threshold = intervals[type] || 0;
  const profile = unitProfiles[unitKey(type, unit)];
  if(!profile || profile.currentValue==null || profile.currentValue==='') return { status:'unknown', last, threshold, diff:0 };
  const diff = Number(profile.currentValue) - Number(last.value);
  if(threshold<=0) return { status:'unknown', last, threshold, diff };
  if(diff >= threshold) return { status:'over', last, threshold, diff };
  if(diff >= threshold*0.85) return { status:'warn', last, threshold, diff };
  return { status:'ok', last, threshold, diff };
}
function nextOilChange(type, lastValue, currentValue){
  const threshold = intervals[type] || 0;
  if(!currentValue || !lastValue || threshold<=0) return null;
  return Number(lastValue) + threshold;
}

// ── Badges & alerts ──────────────────────────────────────────────────────
function getDueUnits(){
  const due = [];
  getUniqueUnits().forEach(u=>{
    const st = computeStatus(u.type, u.unit);
    if(st.status==='over' || st.status==='warn') due.push({...u, st});
  });
  return due;
}
function getTodayEntriesCount(){
  const today = ctDateStr();
  return entries.filter(e => e.date === today).length;
}
function updateBadges(){
  const due = getDueUnits();
  const badge = document.getElementById('nav-badge-alerts');
  badge.textContent = due.length;
  badge.classList.toggle('hidden', due.length===0);
  document.getElementById('notif-dot').style.display = due.length>0 ? 'block' : 'none';

  // Entries badge — show count of entries added today
  const entriesBadge = document.getElementById('nav-badge-entries');
  const todayCount = getTodayEntriesCount();
  entriesBadge.textContent = todayCount;
  entriesBadge.classList.toggle('hidden', todayCount===0);
}
function toggleNotif(){
  const pop = document.getElementById('notif-pop');
  pop.classList.toggle('show');
  renderNotifPop();
}
function renderNotifPop(){
  const due = getDueUnits();
  const list = document.getElementById('notif-list');
  if(due.length===0){
    list.innerHTML = '<div class="np-item"><span style="color:var(--faint);">No active alerts</span></div>';
    return;
  }
  list.innerHTML = due.map(u=>`
    <div class="np-item">
      <div class="np-ico ${u.st.status}"><i class="ph ph-${u.st.status==='over'?'warning':'warning-circle'}"></i></div>
      <div class="np-txt"><b>#${escapeHtml(u.unit)}</b> — ${typeLabel(u.type)}<span>${u.st.status==='over'?'Overdue':'Near interval'} — next at ${nextOilChange(u.type, u.st.last.value, unitProfiles[unitKey(u.type,u.unit)]?.currentValue)||'—'}</span></div>
      <button class="btn btn-sm" onclick="openComplete('${u.type}','${escapeHtml(u.unit)}')">Complete</button>
    </div>`).join('');
  icons();
}
document.addEventListener('click', (e)=>{
  const pop = document.getElementById('notif-pop');
  if(pop && pop.classList.contains('show') && !pop.contains(e.target) && !e.target.closest('[onclick="toggleNotif()"]')) pop.classList.remove('show');
});

// ── Dashboard ────────────────────────────────────────────────────────────
function renderDashboard(){
  document.getElementById('stat-total').textContent = entries.length;
  document.getElementById('stat-trucks').textContent = entries.filter(e=>e.type==='T').length;
  document.getElementById('stat-reefers').textContent = entries.filter(e=>e.type==='R').length;
  document.getElementById('stat-overdue').textContent = getDueUnits().filter(u=>u.st.status==='over').length;

  const recent = [...entries].sort((a,b)=> (b.createdAt||0)-(a.createdAt||0)).slice(0,8);
  document.getElementById('dash-recent').innerHTML = recent.length===0
    ? '<div class="empty-mini">No entries yet.</div>'
    : recent.map(e=>`<div class="r-item"><span class="ubadge ok"></span><span class="ru">#${escapeHtml(e.unit)}</span><span class="rm">${typeLabel(e.type)} · ${escapeHtml(e.addedBy)}</span><span class="rv">${Number(e.value).toLocaleString('en-US')} ${unitSuffix(e.unitOfValue)}</span></div>`).join('');

  const due = getDueUnits();
  const alertsList = document.getElementById('dash-alerts');
  if(due.length===0){
    alertsList.innerHTML = '<div class="empty-mini"><i class="ph ph-check-circle" style="font-size:30px;opacity:.4;display:block;margin:0 auto 8px;"></i>No active alerts.</div>';
  } else {
    alertsList.innerHTML = due.map(u=>`
      <div class="a-item">
        <div class="a-icon ${u.st.status}"><i class="ph ph-${u.st.status==='over'?'warning':'warning-circle'}"></i></div>
        <div class="a-txt"><b>#${escapeHtml(u.unit)}</b> — ${typeLabel(u.type)}<span>${u.st.status==='over'?'Overdue':'Near interval'}</span></div>
        <button class="btn btn-sm" onclick="openComplete('${u.type}','${escapeHtml(u.unit)}')">Complete</button>
      </div>`).join('');
  }
  icons();
}

// ── Entries table (read only, no edit) ────────────────────────────────────
function setType(t){ typeFilter=t; document.querySelectorAll('#type-filters .pill').forEach(p=>p.classList.toggle('active', p.dataset.type===t)); render(); }
function setSort(key){
  if(sortKey===key){ sortDir = sortDir==='asc' ? 'desc' : 'asc'; }
  else { sortKey=key; sortDir='desc'; }
  render();
}
function getFiltered(){
  const q = (document.getElementById('entry-search').value||'').toLowerCase().trim();
  let list = entries.filter(e=>{
    if(typeFilter!=='all' && e.type!==typeFilter) return false;
    if(q && !(String(e.unit).toLowerCase().includes(q) || String(e.addedBy).toLowerCase().includes(q))) return false;
    return true;
  });
  list.sort((a,b)=>{
    let av,bv;
    if(sortKey==='date'){ av=a.date; bv=b.date; }
    else if(sortKey==='type'){ av=a.type; bv=b.type; }
    else if(sortKey==='unit'){ av=a.unit; bv=b.unit; }
    else if(sortKey==='value'){ av=Number(a.value)||0; bv=Number(b.value)||0; }
    if(av<bv) return sortDir==='asc' ? -1 : 1;
    if(av>bv) return sortDir==='asc' ? 1 : -1;
    return 0;
  });
  return list;
}
function render(){
  ['date','type','unit','value'].forEach(k=>{
    document.getElementById('arrow-'+k).textContent = (sortKey===k) ? (sortDir==='asc' ? '↑' : '↓') : '';
  });
  const list = getFiltered();
  const tbody = document.getElementById('tbody');
  if(list.length===0){
    tbody.innerHTML = `<tr class="empty-row"><td colspan="5"><i class="ph ph-tray"></i><div>No records found.</div></td></tr>`;
  } else {
    tbody.innerHTML = list.map(e=>`
      <tr>
        <td class="date">${e.date}</td>
        <td><span class="type-tag"><i class="ph ph-${typeIcon(e.type)}"></i>${typeLabel(e.type)}</span></td>
        <td class="unit">#${escapeHtml(e.unit)}</td>
        <td class="value">${Number(e.value).toLocaleString('en-US')}<small>${unitSuffix(e.unitOfValue)}</small></td>
        <td class="who">${escapeHtml(e.addedBy)}</td>
      </tr>`).join('');
  }
  icons();
}

// ── Units page (view only) ────────────────────────────────────────────────
function setUnitType(t){ unitTypeFilter=t; document.querySelectorAll('#unit-type-filters .pill').forEach(p=>p.classList.toggle('active', p.dataset.utype===t)); renderUnits(); }
function renderUnits(){
  const q = (document.getElementById('unit-search').value||'').toLowerCase().trim();
  let units = getUniqueUnits().filter(u=>{
    if(unitTypeFilter!=='all' && u.type!==unitTypeFilter) return false;
    if(q && !String(u.unit).toLowerCase().includes(q)) return false;
    return true;
  });
  units.sort((a,b)=> String(a.unit).localeCompare(String(b.unit), undefined, {numeric:true}));
  const tbody = document.getElementById('units-tbody');
  if(units.length===0){
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6"><i class="ph ph-tray"></i><div>No units found.</div></td></tr>`;
  } else {
    tbody.innerHTML = units.map(u=>{
      const st = computeStatus(u.type, u.unit);
      const last = st.last;
      const profile = unitProfiles[unitKey(u.type, u.unit)];
      const curVal = profile && profile.currentValue!=null ? Number(profile.currentValue).toLocaleString('en-US') : '—';
      const next = nextOilChange(u.type, last ? last.value : null, profile ? profile.currentValue : null);
      const statusTxt = st.status==='over' ? 'Overdue' : st.status==='warn' ? 'Near interval' : st.status==='ok' ? 'OK' : 'Unknown';
      return `<tr>
        <td class="unit"><button class="unit-link" data-utype="${u.type}" data-uunit="${escapeHtml(u.unit)}" onclick="openUnitDetail(this)"><span class="ubadge ${st.status}"></span>#${escapeHtml(u.unit)}</button></td>
        <td><span class="type-tag"><i class="ph ph-${typeIcon(u.type)}"></i>${typeLabel(u.type)}</span></td>
        <td class="date">${last ? last.date + ' · ' + Number(last.value).toLocaleString('en-US') + ' ' + unitSuffix(last.unitOfValue) : '—'}</td>
        <td class="value">${next ? Number(next).toLocaleString('en-US') + ' ' + unitSuffix(last.unitOfValue) : '—'}</td>
        <td><span class="status-dot ${st.status}">${statusTxt}</span></td>
        <td><div class="row-actions"><button class="icon-btn" onclick="openUnitDetailByKey('${u.type}','${escapeHtml(u.unit)}')" title="View details"><i class="ph ph-eye"></i></button></div></td>
      </tr>`;
    }).join('');
  }
  icons();
}

// ── Unit detail (view only) ───────────────────────────────────────────────
function openUnitDetail(el){ openUnitDetailByKey(el.dataset.utype, el.dataset.uunit); }
function openUnitDetailByKey(type, unit){
  openUnitKey = unitKey(type, unit);
  const history = entries.filter(e=>e.type===type && e.unit===unit)
    .slice().sort((a,b)=> b.date.localeCompare(a.date) || (b.createdAt||0)-(a.createdAt||0));
  const isHours = history.length ? history[0].unitOfValue==='hr' : type==='R';
  const suffix = isHours ? 'hrs' : 'mi';

  document.getElementById('u-title').textContent = '#'+unit;
  document.getElementById('u-subtitle').textContent = typeLabel(type) + ' · ' + history.length + ' oil changes';

  const st = computeStatus(type, unit);
  const banner = document.getElementById('u-status-banner');
  const badge = banner.querySelector('.ubadge');
  const text = document.getElementById('u-status-text');
  banner.className = 'status-banner ' + st.status;
  badge.className = 'ubadge ' + st.status;
  const profile = unitProfiles[openUnitKey];
  const curVal = profile && profile.currentValue!=null ? Number(profile.currentValue) : null;
  const next = nextOilChange(type, st.last ? st.last.value : null, curVal);
  if(st.status==='over'){
    text.innerHTML = `Overdue — next oil change at <b>${Number(next).toLocaleString('en-US')} ${suffix}</b>`;
  } else if(st.status==='warn'){
    text.innerHTML = `Near interval — next oil change at <b>${Number(next).toLocaleString('en-US')} ${suffix}</b>`;
  } else if(st.status==='ok'){
    text.innerHTML = `In interval — next oil change at <b>${Number(next).toLocaleString('en-US')} ${suffix}</b>`;
  } else {
    text.textContent = 'No current value recorded.';
  }

  // Oil change schedule
  const scheduleEl = document.getElementById('u-schedule');
  scheduleEl.innerHTML = history.length===0
    ? '<div class="history-row"><span class="hdate">—</span></div>'
    : history.map(e=>`<div class="history-row"><span class="hdate">${e.date}</span><span class="hval">${Number(e.value).toLocaleString('en-US')} ${unitSuffix(e.unitOfValue)}</span><span class="who">${escapeHtml(e.addedBy)}</span></div>`).join('');

  // Alert history (completed alerts for this unit)
  const unitAlerts = completedAlerts.filter(a=>a.type===type && a.unit===unit);
  const alertEl = document.getElementById('u-alert-history');
  alertEl.innerHTML = unitAlerts.length===0
    ? '<div class="history-row"><span class="hdate">No completed alerts</span></div>'
    : unitAlerts.map(a=>`<div class="history-row"><span class="hdate">${a.completedAt||'—'}</span><span class="hval">${a.valueAtChange ? Number(a.valueAtChange).toLocaleString('en-US')+' '+suffix : '—'}</span><span class="who">Completed</span></div>`).join('');

  document.getElementById('unit-overlay').classList.add('show');
  icons();
}
function closeUnitDetail(){ openUnitKey=null; document.getElementById('unit-overlay').classList.remove('show'); }

// ── Alerts (mark completed) ───────────────────────────────────────────────
function renderAlerts(){
  const due = getDueUnits();
  const list = document.getElementById('alerts-list');
  if(due.length===0){
    list.innerHTML = '<div class="empty-mini"><i class="ph ph-check-circle" style="font-size:36px;opacity:.4;display:block;margin:0 auto 10px;"></i>All units are within interval.</div>';
  } else {
    list.innerHTML = due.map(u=>{
      const profile = unitProfiles[unitKey(u.type, u.unit)];
      const curVal = profile && profile.currentValue!=null ? Number(profile.currentValue) : null;
      const next = nextOilChange(u.type, u.st.last.value, curVal);
      return `<div class="a-item">
        <div class="a-icon ${u.st.status}"><i class="ph ph-${u.st.status==='over'?'warning':'warning-circle'}"></i></div>
        <div class="a-txt"><b>#${escapeHtml(u.unit)}</b> — ${typeLabel(u.type)}<span>${u.st.status==='over'?'Overdue':'Near interval'} · next at ${next ? Number(next).toLocaleString('en-US')+' '+unitSuffix(u.st.last.unitOfValue) : '—'}</span></div>
        <button class="btn btn-sm" onclick="openComplete('${u.type}','${escapeHtml(u.unit)}')">Complete</button>
      </div>`;
    }).join('');
  }

  const completedEl = document.getElementById('completed-list');
  if(completedAlerts.length===0){
    completedEl.innerHTML = '<div class="empty-mini">No completed alerts yet.</div>';
  } else {
    completedEl.innerHTML = completedAlerts.map(a=>`
      <div class="a-item">
        <div class="a-icon done"><i class="ph ph-check-circle"></i></div>
        <div class="a-txt"><b>#${escapeHtml(a.unit)}</b> — ${typeLabel(a.type)}<span>Completed ${a.completedAt||''} · value ${a.valueAtChange ? Number(a.valueAtChange).toLocaleString('en-US') : '—'} · next ${a.nextOilChange ? Number(a.nextOilChange).toLocaleString('en-US') : '—'}</span></div>
      </div>`).join('');
  }
  icons();
}

// ── Complete alert modal ──────────────────────────────────────────────────
function openComplete(type, unit){
  completeUnitKey = unitKey(type, unit);
  const st = computeStatus(type, unit);
  const isHours = st.last ? st.last.unitOfValue==='hr' : type==='R';
  const suffix = isHours ? 'hrs' : 'mi';
  document.getElementById('complete-label').textContent = 'Value at change (' + suffix + ')';
  document.getElementById('complete-sub').textContent = 'Log the value at the time of the change for #' + unit + '. The next oil change is calculated automatically.';
  document.getElementById('complete-value').value = '';
  const profile = unitProfiles[completeUnitKey];
  const curVal = profile && profile.currentValue!=null ? Number(profile.currentValue) : null;
  const next = nextOilChange(type, st.last ? st.last.value : null, curVal);
  document.getElementById('complete-next-text').textContent = next ? Number(next).toLocaleString('en-US') + ' ' + suffix : '—';
  document.getElementById('complete-overlay').classList.add('show');
  icons();
}
function closeComplete(){ completeUnitKey=null; document.getElementById('complete-overlay').classList.remove('show'); }
async function confirmComplete(){
  if(!completeUnitKey) return;
  const val = document.getElementById('complete-value').value.trim();
  if(val===''){ toast('Enter a value'); return; }
  const [type, ...rest] = completeUnitKey.split('_');
  const unit = rest.join('_');
  const st = computeStatus(type, unit);
  const isHours = st.last ? st.last.unitOfValue==='hr' : type==='R';
  const suffix = isHours ? 'hrs' : 'mi';
  const next = nextOilChange(type, st.last ? st.last.value : null, Number(val));

  // Save the completed alert locally (demo — will connect to another app later)
  completedAlerts.unshift({
    type, unit,
    valueAtChange: Number(val),
    nextOilChange: next,
    completedAt: ctDateStr(),
  });

  // Update unit profile with the new value
  try{
    await api('POST', '/api/units/' + encodeURIComponent(completeUnitKey), { currentValue: Number(val) });
    unitProfiles[completeUnitKey] = { currentValue: Number(val), updatedAt: Date.now(), updatedBy: adminUser ? adminUser.name : '' };
  } catch(e){}

  closeComplete();
  renderAlerts();
  renderUnits();
  renderDashboard();
  updateBadges();
  toast('Completed — next oil change at ' + (next ? Number(next).toLocaleString('en-US') + ' ' + suffix : '—'));
}

// ── Users page ────────────────────────────────────────────────────────────
let userRoleFilter = 'all';
let allUsers = [];

function setUserRoleFilter(r){
  userRoleFilter = r;
  document.querySelectorAll('[data-urole]').forEach(p=>p.classList.toggle('active', p.dataset.urole===r));
  renderUsersPage();
}

async function loadUsers(){
  try{
    const data = await api('GET', '/api/users');
    allUsers = data.users || [];
    renderUsersPage();
  } catch(e){ toast('Error loading users'); }
}

function renderUsersPage(){
  const q = (document.getElementById('user-search').value||'').toLowerCase().trim();
  let list = allUsers.filter(u=>{
    if(userRoleFilter!=='all' && u.role!==userRoleFilter) return false;
    if(q && !(u.username.toLowerCase().includes(q) || (u.name||'').toLowerCase().includes(q))) return false;
    return true;
  });
  const tbody = document.getElementById('users-tbody');
  if(list.length===0){
    tbody.innerHTML = `<tr class="empty-row"><td colspan="5"><i class="ph ph-users"></i><div>No users found.</div></td></tr>`;
  } else {
    tbody.innerHTML = list.map(u=>`
      <tr>
        <td class="unit">@${escapeHtml(u.username)}</td>
        <td>${escapeHtml(u.name)}</td>
        <td><span class="type-tag" style="border-color:${u.role==='agent'?'var(--border-2)':u.role==='developer'?'var(--green)':'var(--red)'}; color:${u.role==='agent'?'var(--dim)':u.role==='developer'?'var(--green)':'var(--red)'};">${u.role.replace('_',' ')}</span></td>
        <td class="date">${u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-US') : '—'}</td>
        <td><div class="row-actions">
          <button class="icon-btn" onclick="openUserModal('${escapeHtml(u.username)}')" title="Edit"><i class="ph ph-pencil-simple"></i></button>
          <button class="icon-btn" onclick="deleteUser('${escapeHtml(u.username)}')" title="Delete" style="color:var(--red);"><i class="ph ph-trash"></i></button>
        </div></td>
      </tr>`).join('');
  }
  icons();
}

let editingUsername = null;

function openUserModal(username){
  editingUsername = username || null;
  const modal = document.getElementById('user-overlay');
  if(username){
    const u = allUsers.find(x=>x.username===username);
    document.getElementById('user-modal-title').textContent = 'Edit user';
    document.getElementById('user-modal-sub').textContent = 'Update @' + username + ' details and role.';
    document.getElementById('u-username').value = u ? u.username : '';
    document.getElementById('u-username').disabled = true;
    document.getElementById('u-name').value = u ? (u.name||'') : '';
    document.getElementById('u-role').value = u ? (u.role||'agent') : 'agent';
    document.getElementById('u-password').value = '';
    document.getElementById('u-password').placeholder = 'Leave blank to keep current';
  } else {
    document.getElementById('user-modal-title').textContent = 'Add user';
    document.getElementById('user-modal-sub').textContent = 'Create a mobile app account with a role and password.';
    document.getElementById('u-username').value = '';
    document.getElementById('u-username').disabled = false;
    document.getElementById('u-name').value = '';
    document.getElementById('u-role').value = 'agent';
    document.getElementById('u-password').value = '';
    document.getElementById('u-password').placeholder = 'Set password';
  }
  modal.classList.add('show');
  icons();
}

function closeUserModal(){ document.getElementById('user-overlay').classList.remove('show'); editingUsername = null; }

function generatePassword(){
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%';
  let pwd = '';
  for(let i=0;i<10;i++) pwd += chars[Math.floor(Math.random()*chars.length)];
  document.getElementById('u-password').value = pwd;
}

async function saveUser(){
  const username = document.getElementById('u-username').value.trim().toLowerCase();
  const name = document.getElementById('u-name').value.trim() || username;
  const role = document.getElementById('u-role').value;
  const password = document.getElementById('u-password').value;

  if(!username){ toast('Enter a username'); return; }
  if(!editingUsername && password.length < 4){ toast('Password must be at least 4 characters'); return; }

  try{
    if(editingUsername){
      const payload = { name, role };
      if(password && password.length >= 4) payload.password = password;
      await api('PUT', '/api/users/' + encodeURIComponent(editingUsername), payload);
      toast('User updated');
    } else {
      await api('POST', '/api/users', { username, name, role, password });
      toast('User created');
    }
    closeUserModal();
    await loadUsers();
  } catch(e){ toast(e.message || 'Error saving user'); }
}

async function deleteUser(username){
  if(!confirm('Delete user @' + username + '? This cannot be undone.')) return;
  try{
    await api('DELETE', '/api/users/' + encodeURIComponent(username));
    toast('User deleted');
    await loadUsers();
  } catch(e){ toast(e.message || 'Error deleting user'); }
}

// ── Settings: intervals ──────────────────────────────────────────────────
async function saveSettings(){
  const next = {
    T: Number(document.getElementById('s-truck').value) || 0,
    R: Number(document.getElementById('s-reefer').value) || 0
  };
  try{
    await api('PUT', '/api/settings', next);
    intervals = next;
    render(); renderUnits(); renderAlerts();
    toast('Intervals updated');
  } catch(err){ toast('Error saving'); }
}

// ── Export with preview + single value column ─────────────────────────────
let exportList = [];
function getExportRange(){
  const range = document.getElementById('export-range').value;
  const today = ctDateStr();
  const d = new Date(today + 'T00:00:00');
  const startOfWeek = new Date(d); startOfWeek.setDate(d.getDate() - d.getDay() + 1);
  const endOfWeek = new Date(startOfWeek); endOfWeek.setDate(startOfWeek.getDate() + 6);
  const startOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  const endOfMonth = new Date(d.getFullYear(), d.getMonth()+1, 0);
  const fmt = x => x.toISOString().slice(0,10);
  switch(range){
    case 'today': return { from: today, to: today, label: 'Today ('+today+')' };
    case 'yesterday': { const y = new Date(d); y.setDate(d.getDate()-1); const ys = fmt(y); return { from: ys, to: ys, label: 'Yesterday ('+ys+')' }; }
    case 'week': return { from: fmt(startOfWeek), to: fmt(endOfWeek), label: 'This week ('+fmt(startOfWeek)+' → '+fmt(endOfWeek)+')' };
    case 'lastweek': { const sw = new Date(startOfWeek); sw.setDate(sw.getDate()-7); const ew = new Date(sw); ew.setDate(sw.getDate()+6); return { from: fmt(sw), to: fmt(ew), label: 'Last week ('+fmt(sw)+' → '+fmt(ew)+')' }; }
    case 'month': return { from: fmt(startOfMonth), to: fmt(endOfMonth), label: 'This month ('+fmt(startOfMonth)+' → '+fmt(endOfMonth)+')' };
    case 'lastmonth': { const sm = new Date(d.getFullYear(), d.getMonth()-1, 1); const em = new Date(d.getFullYear(), d.getMonth(), 0); return { from: fmt(sm), to: fmt(em), label: 'Last month ('+fmt(sm)+' → '+fmt(em)+')' }; }
    case 'period': { const from = document.getElementById('export-from').value || today; const to = document.getElementById('export-to').value || today; return { from, to, label: 'Custom ('+from+' → '+to+')' }; }
    default: return { from: null, to: null, label: 'All records' };
  }
}
function updateExportPreview(){
  const range = document.getElementById('export-range').value;
  document.getElementById('export-period-fields').style.display = range==='period' ? 'block' : 'none';
  const { from, to, label } = getExportRange();
  document.getElementById('export-range-label').textContent = label;
  exportList = entries.filter(e=>{
    if(from && e.date < from) return false;
    if(to && e.date > to) return false;
    return true;
  }).sort((a,b)=> a.date.localeCompare(b.date));
  document.getElementById('export-count').textContent = exportList.length;
  const body = document.getElementById('export-preview-body');
  if(exportList.length===0){
    body.innerHTML = `<tr class="empty-row"><td colspan="5"><i class="ph ph-tray"></i><div>No records in selected period.</div></td></tr>`;
  } else {
    body.innerHTML = exportList.slice(0,50).map(e=>`
      <tr>
        <td class="date">${e.date}</td>
        <td><span class="type-tag"><i class="ph ph-${typeIcon(e.type)}"></i>${typeLabel(e.type)}</span></td>
        <td class="unit">#${escapeHtml(e.unit)}</td>
        <td class="value">${Number(e.value).toLocaleString('en-US')}<small>${unitSuffix(e.unitOfValue)}</small></td>
        <td class="who">${escapeHtml(e.addedBy)}</td>
      </tr>`).join('');
  }
  icons();
}
function openExport(){
  document.getElementById('export-overlay').classList.add('show');
  updateExportPreview();
  icons();
}
function closeExport(){ document.getElementById('export-overlay').classList.remove('show'); }
async function confirmExport(){
  if(exportList.length===0){ toast('Nothing to export'); return; }
  const wb = new ExcelJS.Workbook();
  wb.creator = 'OILLOG Admin'; wb.created = new Date();
  const ws = wb.addWorksheet('OILLOG Export', { views:[{ state:'frozen', ySplit:1 }] });
  // Single value column — either mileage or hours
  ws.columns = [
    { header:'Date', key:'date', width:13 },
    { header:'Unit Type', key:'type', width:12 },
    { header:'Unit Number', key:'unit', width:14 },
    { header:'Value', key:'value', width:14 },
    { header:'Unit', key:'unitOfValue', width:10 },
    { header:'Added By', key:'addedBy', width:18 },
  ];
  const RED='FFC8102E', DARK='FF1A1A1A', LIGHT='FFF9F7F5', BORDER='FFE5E3E0';
  const header = ws.getRow(1);
  header.height = 24;
  header.eachCell(cell=>{
    cell.font = { bold:true, color:{argb:'FFFFFFFF'}, size:11, name:'Calibri' };
    cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:RED} };
    cell.alignment = { vertical:'middle', horizontal:'left' };
    cell.border = { bottom:{style:'thin', color:{argb:RED}} };
  });
  exportList.forEach((e,i)=>{
    const row = ws.addRow({
      date: e.date, type: typeLabel(e.type), unit: e.unit,
      value: Number(e.value), unitOfValue: e.unitOfValue==='hr' ? 'Hours' : 'Miles',
      addedBy: e.addedBy,
    });
    row.eachCell(cell=>{
      cell.font = { name:'Calibri', size:11, color:{argb:DARK} };
      cell.border = { bottom:{style:'thin', color:{argb:BORDER}} };
      cell.alignment = { vertical:'middle' };
      if(i%2===1) cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:LIGHT} };
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
  a.href = url; a.download = `oillog-admin-export_${ctDateStr()}.xlsx`;
  a.click(); URL.revokeObjectURL(url);
  closeExport();
  toast('Excel downloaded — ' + exportList.length + ' records');
}

// ── Init ─────────────────────────────────────────────────────────────────
(async function init(){
  applyTheme(loadTheme());
  notifPrefs = loadNotifPrefs();
  applyNotifPrefs();
  document.getElementById('s-truck').value = intervals.T;
  document.getElementById('s-reefer').value = intervals.R;
  try {
    const status = await api('GET', '/auth/status');
    if(status.ok && status.user) {
      const su = status.user;
      if(su.role !== 'developer' && su.role !== 'super_admin') {
        await fetch('/logout', {method:'POST'}).catch(()=>{});
        window.location.href = '/admin-login?error=forbidden_role';
        return;
      }
      adminUser = {
        method: su.method || 'telegram',
        id: su.id,
        name: su.first_name,
        username: su.username || '',
        photo_url: su.photo_url || '',
        role: su.role || 'agent',
      };
      saveAdminUser(adminUser);
      await enterAdmin();
    } else {
      window.location.href = '/admin-login';
    }
  } catch(e) {
    adminUser = loadAdminUser();
    if(adminUser) await enterAdmin();
    else window.location.href = '/admin-login';
  }
})();
