"""
OILLOG — Flask server for Railway deployment
Serves mobile + admin PWA, Telegram auth, JSON-file storage on Railway volume, real-time sync API.

User accounts/roles ARE managed here in users_auth.json (Railway volume).
Admins create users via the Admin Panel "Users" page. Telegram auth remains
for admin login only. No credentials are hardcoded — all config comes from
Railway environment variables.
"""
import hashlib, hmac, json, logging, os, secrets, string, time
from pathlib import Path
from functools import wraps

from flask import Flask, jsonify, request, session, redirect, send_from_directory

from storage.user_store import get_user

logger = logging.getLogger(__name__)
app = Flask(__name__)
app.secret_key = os.getenv("OILLOG_SECRET", "oillog-secret-change-me")

# Configure session cookies for cross-site compatibility (Telegram OAuth)
app.config['SESSION_COOKIE_SECURE'] = True
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_DOMAIN'] = None

DATA_DIR = Path(os.getenv("OILLOG_DATA_DIR", "/app/data"))
BOT_TOKEN = os.getenv("BOT_TOKEN", "")  # Telegram bot token — set in Railway env
BOT_USERNAME = os.getenv("BOT_USERNAME", "").replace("@", "")  # Bot username — set in Railway env
BOT_ID = os.getenv("BOT_ID", "")  # Bot ID (numeric) — set in Railway env

# Roles allowed into the admin panel. Everyone else (e.g. "agent") only gets the mobile app.
ADMIN_ROLES = {"developer", "super_admin"}

# Log configuration on startup
logger.info(f"BOT_TOKEN configured: {bool(BOT_TOKEN)}")
logger.info(f"BOT_USERNAME configured: {bool(BOT_USERNAME)}")
logger.info(f"BOT_ID configured: {bool(BOT_ID)}")

DATA_DIR.mkdir(parents=True, exist_ok=True)

# ── Password-auth store ──────────────────────────────────────────────────────
# Simple file-backed password users (separate from Telegram user_store).
PASSWORDS_FILE = DATA_DIR / "users_auth.json"

def _load_passwords():
    if not PASSWORDS_FILE.exists():
        return {}
    try:
        return json.loads(PASSWORDS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}

def _save_passwords(data):
    tmp = PASSWORDS_FILE.with_suffix(".tmp")
    try:
        tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
        tmp.replace(PASSWORDS_FILE)
    except Exception as e:
        logger.error(f"Failed to save password users: {e}")

def _hash_password(password, salt=None):
    """Hash a password with a random salt (salted SHA-256)."""
    if salt is None:
        salt = secrets.token_hex(16)
    hashed = hashlib.sha256(f"{salt}:{password}".encode()).hexdigest()
    return f"{salt}${hashed}"

def _verify_password(password, stored_hash):
    """Verify a password against a salted hash stored as 'salt$hash'."""
    try:
        salt, hashed = stored_hash.split("$", 1)
    except ValueError:
        # Legacy unsalted SHA-256 — migrate silently
        return hashlib.sha256(password.encode()).hexdigest() == stored_hash
    computed = hashlib.sha256(f"{salt}:{password}".encode()).hexdigest()
    return computed == hashed

def _sanitize_user(u):
    """Return a user dict without sensitive fields."""
    if u is None:
        return None
    return {
        "username": u.get("username", ""),
        "name": u.get("name", ""),
        "role": u.get("role", "agent"),
        "createdAt": u.get("createdAt", 0),
    }

# ── File-backed stores ─────────────────────────────────────────────────────

def _read_json(name):
    p = DATA_DIR / name
    if not p.exists():
        return []
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return []

def _write_json(name, data):
    p = DATA_DIR / name
    p.write_text(json.dumps(data, ensure_ascii=False, default=str), encoding="utf-8")

def load_entries():
    return _read_json("entries.json")

def save_entries(entries):
    _write_json("entries.json", entries)

def load_units():
    return _read_json("units.json")

def save_units(units):
    _write_json("units.json", units)

def load_settings():
    s = _read_json("settings.json")
    if isinstance(s, dict):
        return s
    return {"T": 15000, "R": 500}

def save_settings(s):
    _write_json("settings.json", s)

# ── Auth helpers ──────────────────────────────────────────────────────────

def verify_telegram_login(data):
    check_hash = data.pop("hash", "")
    data_check = "\n".join(f"{k}={v}" for k, v in sorted(data.items()))
    secret_key = hashlib.sha256(BOT_TOKEN.encode()).digest()
    computed = hmac.new(secret_key, data_check.encode(), hashlib.sha256).hexdigest()
    data["hash"] = check_hash
    if abs(time.time() - int(data.get("auth_date", 0))) > 86400:
        return False
    return hmac.compare_digest(computed, check_hash)

def login_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not session.get("user"):
            return jsonify({"error": "unauthorized"}), 401
        return f(*args, **kwargs)
    return wrapper

# ── Auth routes ─────────────────────────────────────────────────────────────
# Access is controlled entirely by the shared user_store (see storage/user_store.py),
# the same file the Kurtex Alert Bot manages via /adduser, /removeuser, /editrole.
# There is no separate whitelist or Telegram webhook here anymore — the bot is
# the single place admins manage who's allowed in and with what role.

@app.route("/auth/telegram", methods=["GET", "POST"])
def telegram_auth():
    # Handle both GET (from Telegram widget redirect) and POST (from client-side widget)
    is_post = request.method == "POST"
    if is_post:
        data = request.get_json(force=True) or {}
        next_url = "/"
    else:
        data = dict(request.args)
        next_url = data.pop("next", "/") or "/"
    
    # If no hash in data, this is a request to initiate OAuth (mobile flow)
    if not data.get("hash"):
        # Redirect to Telegram OAuth
        # Telegram OAuth requires the numeric bot ID
        bot_id = os.getenv("BOT_ID", "")
        
        # If BOT_ID not set, extract from BOT_TOKEN (format: "bot_id:token_string")
        if not bot_id and ":" in BOT_TOKEN:
            bot_id = BOT_TOKEN.split(":")[0]
        
        if not bot_id:
            logger.error("BOT_ID not configured. Set BOT_ID env var or ensure BOT_TOKEN is in format 'bot_id:token'")
            if is_post:
                return jsonify({"ok": False, "error": "bot_not_configured"}), 500
            return redirect("/?error=bot_not_configured")
        
        # Use the configured domain or fallback to host
        origin = os.getenv("APP_URL", request.host_url.rstrip("/"))
        telegram_oauth_url = f"https://oauth.telegram.org/auth?bot_id={bot_id}&origin={origin}&request_access=write"
        logger.info(f"Redirecting to Telegram OAuth with bot_id: {bot_id}")
        return redirect(telegram_oauth_url)
    
    if not next_url.startswith("/"):
        next_url = "/"  # never redirect off-site

    if not verify_telegram_login(data):
        if is_post:
            return jsonify({"ok": False, "error": "invalid"}), 401
        return redirect(f"{next_url}?error=invalid")

    telegram_id = int(data.get("id", 0))
    u = get_user(telegram_id)
    if not u:
        if is_post:
            return jsonify({"ok": False, "error": "not_whitelisted"}), 403
        return redirect(f"{next_url}?error=not_whitelisted")

    role = u.get("role", "agent")
    if next_url.startswith("/admin") and role not in ADMIN_ROLES:
        if is_post:
            return jsonify({"ok": False, "error": "forbidden_role"}), 403
        return redirect("/admin-login?error=forbidden_role")

    session["user"] = {
        "id": telegram_id,
        "first_name": data.get("first_name", "") or u.get("name", ""),
        "username": data.get("username", "") or u.get("username", ""),
        "photo_url": data.get("photo_url", ""),
        "auth_date": data.get("auth_date", ""),
        "role": role,
    }
    
    # For POST (client-side widget), return JSON so the page can enter the app
    if is_post:
        return jsonify({"ok": True, "user": session["user"]})
    
    # For admin login, redirect directly to admin page
    # The admin page will check auth and show the interface
    if next_url == "/admin":
        return redirect("/admin")
    return redirect(next_url)

@app.route("/auth/status", methods=["GET"])
def auth_status():
    if session.get("user"):
        return jsonify({"ok": True, "user": session["user"]})
    return jsonify({"ok": False, "user": None})

@app.route("/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"ok": True})

# ── Password auth ───────────────────────────────────────────────────────────

def admin_required(f):
    """Require an admin role (developer or super_admin)."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        user = session.get("user")
        if not user:
            return jsonify({"error": "unauthorized"}), 401
        if user.get("role") not in ADMIN_ROLES:
            return jsonify({"error": "forbidden_role"}), 403
        return f(*args, **kwargs)
    return wrapper

@app.route("/auth/register", methods=["POST"])
def register():
    data = request.json or {}
    username = (data.get("username") or "").strip().lower()
    password = data.get("password") or ""
    name = (data.get("name") or "").strip() or username
    # Force agent role on self-registration — admin access is granted only via
    # Telegram admin roles or the admin-created users.
    role = "agent"

    if not username or not password:
        return jsonify({"error": "missing_fields"}), 400
    if len(password) < 4:
        return jsonify({"error": "password_too_short"}), 400

    users = _load_passwords()
    if username in users:
        return jsonify({"error": "user_exists"}), 409

    users[username] = {
        "name": name,
        "password_hash": _hash_password(password),
        "role": role,
        "createdAt": int(time.time() * 1000),
    }
    _save_passwords(users)

    session["user"] = {
        "id": username,
        "first_name": name,
        "username": username,
        "photo_url": "",
        "auth_date": str(int(time.time())),
        "role": role,
        "method": "password",
    }
    return jsonify({"ok": True, "user": session["user"]})


@app.route("/auth/password", methods=["POST"])
def password_login():
    data = request.json or {}
    username = (data.get("username") or "").strip().lower()
    password = data.get("password") or ""

    if not username or not password:
        return jsonify({"error": "missing_fields"}), 400

    users = _load_passwords()
    user = users.get(username)
    if not user or not _verify_password(password, user.get("password_hash", "")):
        return jsonify({"error": "invalid_credentials"}), 401

    role = user.get("role", "agent")

    session["user"] = {
        "id": username,
        "first_name": user.get("name", username),
        "username": username,
        "photo_url": "",
        "auth_date": str(int(time.time())),
        "role": role,
        "method": "password",
    }
    return jsonify({"ok": True, "user": session["user"]})


@app.route("/auth/password-admin", methods=["POST"])
def password_admin_login():
    """Admin password login — checks against the same users_auth.json store,
    but only allows users with developer/super_admin roles."""
    data = request.json or {}
    username = (data.get("username") or "").strip().lower()
    password = data.get("password") or ""

    if not username or not password:
        return jsonify({"error": "missing_fields"}), 400

    users = _load_passwords()
    user = users.get(username)
    if not user or not _verify_password(password, user.get("password_hash", "")):
        return jsonify({"error": "invalid_credentials"}), 401

    role = user.get("role", "agent")
    if role not in ADMIN_ROLES:
        return jsonify({"error": "forbidden_role"}), 403

    session["user"] = {
        "id": username,
        "first_name": user.get("name", username),
        "username": username,
        "photo_url": "",
        "auth_date": str(int(time.time())),
        "role": role,
        "method": "password",
    }
    return jsonify({"ok": True, "user": session["user"]})


# ── User management API (admin only) ────────────────────────────────────────

@app.route("/api/users", methods=["GET"])
@admin_required
def api_list_users():
    users = _load_passwords()
    result = []
    for username, u in users.items():
        result.append({
            "username": username,
            "name": u.get("name", username),
            "role": u.get("role", "agent"),
            "createdAt": u.get("createdAt", 0),
        })
    result.sort(key=lambda x: x["username"])
    return jsonify({"users": result})


@app.route("/api/users", methods=["POST"])
@admin_required
def api_create_user():
    data = request.json or {}
    username = (data.get("username") or "").strip().lower()
    password = data.get("password") or ""
    name = (data.get("name") or "").strip() or username
    role = (data.get("role") or "agent").strip().lower()

    if not username or not password:
        return jsonify({"error": "missing_fields"}), 400
    if len(password) < 4:
        return jsonify({"error": "password_too_short"}), 400
    if role not in ("agent", "developer", "super_admin"):
        return jsonify({"error": "invalid_role"}), 400

    users = _load_passwords()
    if username in users:
        return jsonify({"error": "user_exists"}), 409

    users[username] = {
        "name": name,
        "password_hash": _hash_password(password),
        "role": role,
        "createdAt": int(time.time() * 1000),
    }
    _save_passwords(users)
    return jsonify({"ok": True, "user": {
        "username": username, "name": name, "role": role,
        "createdAt": users[username]["createdAt"],
    }}), 201


@app.route("/api/users/<username>", methods=["PUT"])
@admin_required
def api_update_user(username):
    username = username.strip().lower()
    data = request.json or {}
    users = _load_passwords()
    if username not in users:
        return jsonify({"error": "not_found"}), 404

    user = users[username]
    if "name" in data:
        user["name"] = (data.get("name") or "").strip() or username
    if "role" in data:
        role = (data.get("role") or "").strip().lower()
        if role not in ("agent", "developer", "super_admin"):
            return jsonify({"error": "invalid_role"}), 400
        user["role"] = role
    if "password" in data and data.get("password"):
        if len(data["password"]) < 4:
            return jsonify({"error": "password_too_short"}), 400
        user["password_hash"] = _hash_password(data["password"])

    users[username] = user
    _save_passwords(users)
    return jsonify({"ok": True, "user": {
        "username": username, "name": user.get("name", username),
        "role": user.get("role", "agent"), "createdAt": user.get("createdAt", 0),
    }})


@app.route("/api/users/<username>", methods=["DELETE"])
@admin_required
def api_delete_user(username):
    username = username.strip().lower()
    users = _load_passwords()
    if username not in users:
        return jsonify({"error": "not_found"}), 404

    # Prevent deleting yourself
    if session.get("user", {}).get("id") == username:
        return jsonify({"error": "cannot_delete_self"}), 400

    del users[username]
    _save_passwords(users)
    return jsonify({"ok": True})


# ── API ──────────────────────────────────────────────────────────────────

@app.route("/api/sync")
@login_required
def api_sync():
    """Return all data for real-time sync."""
    entries = load_entries()
    units = load_units()
    settings = load_settings()
    # Return newest first
    entries.sort(key=lambda e: e.get("createdAt", 0), reverse=True)
    return jsonify({
        "entries": entries,
        "units": units,
        "settings": settings,
    })

@app.route("/api/entries", methods=["POST"])
@login_required
def api_create_entry():
    data = request.json or {}
    if not data.get("id") or not data.get("unit"):
        return jsonify({"error": "missing_fields"}), 400
    entries = load_entries()
    entries.append(data)
    save_entries(entries)
    return jsonify(data), 201

@app.route("/api/entries/<entry_id>", methods=["PUT"])
@login_required
def api_update_entry(entry_id):
    data = request.json or {}
    entries = load_entries()
    for i, e in enumerate(entries):
        if e.get("id") == entry_id:
            entries[i] = data
            save_entries(entries)
            return jsonify(data)
    return jsonify({"error": "not_found"}), 404

@app.route("/api/entries/<entry_id>", methods=["DELETE"])
@login_required
def api_delete_entry(entry_id):
    entries = load_entries()
    new_entries = [e for e in entries if e.get("id") != entry_id]
    if len(new_entries) < len(entries):
        save_entries(new_entries)
        return jsonify({"ok": True})
    return jsonify({"error": "not_found"}), 404

@app.route("/api/units/<path:unit_key>", methods=["POST"])
@login_required
def api_save_unit(unit_key):
    data = request.json or {}
    val = data.get("currentValue")
    units = load_units()
    units[unit_key] = {
        "currentValue": val,
        "updatedAt": int(time.time() * 1000),
        "updatedBy": session["user"].get("first_name", ""),
    }
    save_units(units)
    return jsonify(units[unit_key])

@app.route("/api/settings", methods=["PUT"])
@login_required
def api_update_settings():
    data = request.json or {}
    safe = {}
    if "T" in data:
        safe["T"] = int(data["T"])
    if "R" in data:
        safe["R"] = int(data["R"])
    if safe:
        save_settings(safe)
    return jsonify(safe)

# ── Serve static files ────────────────────────────────────────────────────

FRONTEND_DIR = Path(__file__).parent

@app.route("/")
def serve_index():
    return send_from_directory(str(FRONTEND_DIR), "oillog-mobile.html")

@app.route("/admin-login")
def serve_admin_login():
    return send_from_directory(str(FRONTEND_DIR), "oillog-admin-login.html")

@app.route("/admin")
def serve_admin():
    return send_from_directory(str(FRONTEND_DIR), "oillog-admin.html")

@app.route("/web")
def serve_web():
    return send_from_directory(str(FRONTEND_DIR), "oillog-web.html")

@app.route("/<path:filename>")
def serve_static(filename):
    return send_from_directory(str(FRONTEND_DIR), filename)

# ── Health check ─────────────────────────────────────────────────────────────
@app.route("/api/bot-info")
def bot_info():
    return jsonify({
        "username": BOT_USERNAME,
        "configured": bool(BOT_USERNAME),
    })

@app.route("/health")
def health():
    return jsonify({
        "ok": True,
        "time": time.time(),
        "data_dir": str(DATA_DIR),
    })


# ── Main ──────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8080))
    app.run(host="0.0.0.0", port=port, debug=True)
