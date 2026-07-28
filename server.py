"""
OILLOG — Flask server for Railway deployment
Serves mobile + admin PWA, Telegram auth, JSON-file storage on Railway volume, real-time sync API.
"""
import hashlib, hmac, json, logging, os, re, secrets, time, urllib.request
from datetime import datetime, timezone
from pathlib import Path
from functools import wraps

from flask import Flask, jsonify, request, session, redirect, send_from_directory
from werkzeug.security import generate_password_hash, check_password_hash

logger = logging.getLogger(__name__)
app = Flask(__name__)
app.secret_key = os.getenv("OILLOG_SECRET", "oillog-secret-change-me")

DATA_DIR = Path(os.getenv("OILLOG_DATA_DIR", "/app/data"))
BOT_TOKEN = os.getenv("BOT_TOKEN", "8783000783:AAH0nsNC0Mh0egLVdKd9i5lm1-fZuQ7Ltos")
BOT_USERNAME = os.getenv("BOT_USERNAME", "kurtexalertsbot")  # ← SET THIS
TELEGRAM_WEBHOOK_SECRET = os.getenv("TELEGRAM_WEBHOOK_SECRET", "change-me-too")

DATA_DIR.mkdir(parents=True, exist_ok=True)

# ── File-backed stores ─────────────────────────────────────────────────────

def _read_json(name):
    p = DATA_DIR / name
    if not p.exists():
        return []
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except:
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

# ── Agent accounts + Telegram OTP login ────────────────────────────────────
# users.json: [{"username","password_hash","telegram_chat_id","role","first_name","link_token"}]
OTP_TTL = 300          # seconds a code stays valid
_pending_otp = {}      # username -> {"code","expires","attempts"}

def load_users():
    return _read_json("users.json")

def save_users(users):
    _write_json("users.json", users)

def find_user(username):
    username = (username or "").strip().lower()
    for u in load_users():
        if u.get("username", "").lower() == username:
            return u
    return None

def tg_send_message(chat_id, text):
    """Fire a DM via the Telegram Bot API. Silently logs failures."""
    try:
        payload = json.dumps({"chat_id": chat_id, "text": text}).encode()
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
            data=payload, headers={"Content-Type": "application/json"}, method="POST",
        )
        urllib.request.urlopen(req, timeout=10)
        return True
    except Exception as e:
        logger.error(f"telegram send failed: {e}")
        return False

@app.route("/telegram/webhook/<secret>", methods=["POST"])
def telegram_webhook(secret):
    """Receives updates from Telegram. Register with setWebhook once (see notes)."""
    if secret != TELEGRAM_WEBHOOK_SECRET:
        return jsonify({"ok": False}), 403
    update = request.json or {}
    msg = update.get("message") or {}
    text = (msg.get("text") or "").strip()
    chat_id = msg.get("chat", {}).get("id")
    if text.startswith("/start") and chat_id:
        parts = text.split(maxsplit=1)
        token = parts[1].strip() if len(parts) > 1 else ""
        users = load_users()
        linked = False
        for u in users:
            if token and u.get("link_token") == token:
                u["telegram_chat_id"] = chat_id
                u["link_token"] = None
                linked = True
                break
        if linked:
            save_users(users)
            tg_send_message(chat_id, "✅ Telegram linked to your OILLOG account. You can now log in with your username and password.")
        else:
            tg_send_message(chat_id, f"Your Telegram chat ID is {chat_id}. Ask an admin to link it to your account, or use the link they sent you.")
    return jsonify({"ok": True})

@app.route("/auth/agents", methods=["POST"])
@login_required
def create_agent():
    """Admin creates an agent account and gets a one-time Telegram link URL back."""
    if session["user"].get("role") != "admin":
        return jsonify({"error": "forbidden"}), 403
    data = request.json or {}
    username = (data.get("username") or "").strip().lower()
    password = data.get("password") or ""
    if not username or len(password) < 8:
        return jsonify({"error": "username required, password min 8 chars"}), 400
    if find_user(username):
        return jsonify({"error": "username_taken"}), 400
    link_token = secrets.token_urlsafe(16)
    users = load_users()
    users.append({
        "username": username,
        "password_hash": generate_password_hash(password),
        "telegram_chat_id": None,
        "role": data.get("role", "agent"),
        "first_name": data.get("first_name", username),
        "link_token": link_token,
    })
    save_users(users)
    return jsonify({
        "ok": True,
        "username": username,
        "telegram_link": f"https://t.me/{BOT_USERNAME}?start={link_token}",
    }), 201

@app.route("/auth/login", methods=["POST"])
def password_login():
    """Step 1: verify username/password, then text a 6-digit code to Telegram."""
    data = request.json or {}
    user = find_user(data.get("username"))
    if not user or not check_password_hash(user.get("password_hash", ""), data.get("password", "")):
        return jsonify({"ok": False, "error": "invalid_credentials"}), 401
    if not user.get("telegram_chat_id"):
        return jsonify({"ok": False, "error": "telegram_not_linked"}), 400
    code = f"{secrets.randbelow(1_000_000):06d}"
    _pending_otp[user["username"]] = {"code": code, "expires": time.time() + OTP_TTL, "attempts": 0}
    tg_send_message(user["telegram_chat_id"], f"Your OILLOG login code is {code}. It expires in 5 minutes.")
    return jsonify({"ok": True, "stage": "otp_required"})

@app.route("/auth/verify", methods=["POST"])
def password_login_verify():
    """Step 2: check the code the agent got via Telegram, then start the session."""
    data = request.json or {}
    username = (data.get("username") or "").strip().lower()
    code = (data.get("code") or "").strip()
    pending = _pending_otp.get(username)
    if not pending:
        return jsonify({"ok": False, "error": "no_pending_login"}), 400
    if time.time() > pending["expires"]:
        _pending_otp.pop(username, None)
        return jsonify({"ok": False, "error": "code_expired"}), 400
    pending["attempts"] += 1
    if pending["attempts"] > 5:
        _pending_otp.pop(username, None)
        return jsonify({"ok": False, "error": "too_many_attempts"}), 429
    if not hmac.compare_digest(pending["code"], code):
        return jsonify({"ok": False, "error": "invalid_code"}), 401
    _pending_otp.pop(username, None)
    user = find_user(username)
    session["user"] = {
        "id": user["username"],
        "first_name": user.get("first_name", username),
        "username": username,
        "photo_url": "",
        "auth_date": str(int(time.time())),
        "role": user.get("role", "agent"),
    }
    return jsonify({"ok": True, "user": session["user"]})


# ── Auth routes ──────────────────────────────────────────────────────────

@app.route("/auth/telegram", methods=["POST"])
def telegram_auth():
    data = dict(request.json or {})
    if not data.get("hash"):
        return jsonify({"ok": False, "error": "no_hash"}), 400

    if verify_telegram_login(data):
        user_id = int(data.get("id", 0))
        session["user"] = {
            "id": user_id,
            "first_name": data.get("first_name", ""),
            "username": data.get("username", ""),
            "photo_url": data.get("photo_url", ""),
            "auth_date": data.get("auth_date", ""),
            "role": "admin",
        }
        return jsonify({"ok": True, "user": session["user"]})
    return jsonify({"ok": False, "error": "invalid"}), 401

@app.route("/auth/guest", methods=["POST"])
def guest_auth():
    data = request.json or {}
    name = data.get("name", "Guest")
    session["user"] = {
        "id": 0,
        "first_name": name,
        "username": name.lower(),
        "photo_url": "",
        "auth_date": str(int(time.time())),
        "role": "guest",
    }
    return jsonify({"ok": True, "user": session["user"]})

@app.route("/auth/status", methods=["GET"])
def auth_status():
    if session.get("user"):
        return jsonify({"ok": True, "user": session["user"]})
    return jsonify({"ok": False, "user": None})

@app.route("/logout", methods=["POST"])
def logout():
    session.clear()
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

ADMIN_HOSTS = {h.strip().lower() for h in os.getenv("ADMIN_HOSTS", "admin.yourdomain.com,crm.yourdomain.com").split(",") if h.strip()}

@app.route("/")
def serve_index():
    host = request.host.split(":")[0].lower()
    if host in ADMIN_HOSTS:
        return send_from_directory(str(FRONTEND_DIR), "oillog-admin.html")
    return send_from_directory(str(FRONTEND_DIR), "oillog-mobile.html")

@app.route("/admin")
def serve_admin():
    return send_from_directory(str(FRONTEND_DIR), "oillog-admin.html")

@app.route("/<path:filename>")
def serve_static(filename):
    return send_from_directory(str(FRONTEND_DIR), filename)

# ── Main ──────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8080))
    app.run(host="0.0.0.0", port=port, debug=True)

