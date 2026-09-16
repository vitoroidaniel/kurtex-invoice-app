// Listen for messages from popup windows (Telegram auth)
  window.addEventListener('message', function(event) {
    if (event.data && event.data.type === 'telegram-auth-success') {
      // Reload the page to pick up the session cookie set by the popup
      window.location.reload();
    }
  });

const API_BASE = window.location.origin;
const LOGIN_ERROR_MESSAGES = {
  not_whitelisted: 'Your Telegram account is not yet authorized as admin. Access is granted from the alert bot with /adduser <id> <name> <role>.',
  forbidden_role: 'Your account is authorized, but the "agent" role does not have admin access — you need super_admin or developer.',
  invalid: 'Invalid Telegram authentication. Check if this site\'s domain is set correctly in BotFather (/setdomain).',
  missing: 'Incomplete response from Telegram. Try again.',
  missing_fields: 'Enter the password.',
  invalid_credentials: 'Incorrect password.',
  network_error: 'Could not reach the server. Try again.',
};
function showLoginError(code, raw){
  const box = document.getElementById('login-error');
  if(!box) return;
  box.textContent = LOGIN_ERROR_MESSAGES[code] || (raw || 'Authentication failed. Try again.');
  box.classList.remove('hidden');
}
function clearLoginError(){
  const box = document.getElementById('login-error');
  if(box){ box.classList.add('hidden'); box.textContent=''; }
}
function checkUrlLoginError(){
  const params = new URLSearchParams(window.location.search);
  const err = params.get('error');
  if(err){
    showLoginError(err);
    params.delete('error');
    const clean = window.location.pathname + (params.toString() ? '?'+params.toString() : '');
    window.history.replaceState({}, '', clean);
  }
}
function showLoginTab(tab){
  document.querySelectorAll('.login-tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('tab-'+tab).classList.add('active');
  document.getElementById('login-telegram').classList.toggle('hidden', tab!=='telegram');
  document.getElementById('login-password').classList.toggle('hidden', tab!=='password');
  clearLoginError();
}

async function api(method, path, body){
  const opts = { method, headers: {'Content-Type':'application/json'} };
  opts.credentials = 'include';
  if(body) opts.body = JSON.stringify(body);
  const res = await fetch(API_BASE + path, opts);
  const data = await res.json();
  if(!res.ok) throw new Error(data.error || 'API error');
  return data;
}

document.getElementById('password-form').addEventListener('submit', async function(e){
  e.preventDefault();
  clearLoginError();
  const username = document.getElementById('p-username').value.trim();
  const password = document.getElementById('p-password').value;
  if(!username || !password){ showLoginError('missing_fields'); return; }
  try {
    const res = await api('POST', '/auth/password-admin', { username, password });
    if(res.ok && res.user){
      window.location.href = '/admin';
    } else {
      showLoginError(res.error || 'invalid_credentials');
    }
  } catch(err){ showLoginError('network_error'); }
});

// If already logged in as admin, skip login and go straight to admin
(async function init(){
  checkUrlLoginError();
  
  // Check if we just came back from Telegram auth with success flag
  const params = new URLSearchParams(window.location.search);
  if(params.get('success') === '1') {
    // Clear the URL parameter
    window.history.replaceState({}, '', window.location.pathname);
    
    // Check if we're now logged in
    try {
      const status = await api('GET', '/auth/status');
      if(status.ok && status.user) {
        if(status.user.role === 'developer' || status.user.role === 'super_admin'){
          window.location.href = '/admin';
          return;
        } else {
          // User logged in but doesn't have admin role - logout silently
          await api('POST', '/logout').catch(()=>{});
        }
      }
    } catch(e) {}
  } else {
    // Normal init - check if already logged in (but don't show error if not admin)
    try {
      const status = await api('GET', '/auth/status');
      if(status.ok && status.user) {
        if(status.user.role === 'developer' || status.user.role === 'super_admin'){
          window.location.href = '/admin';
          return;
        } else {
          // User logged in but doesn't have admin role - logout silently
          await api('POST', '/logout').catch(()=>{});
        }
      }
    } catch(e) {}
  }
  })();
