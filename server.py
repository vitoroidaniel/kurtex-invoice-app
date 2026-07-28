"""
OILLOG — Flask server for Railway deployment
Serves mobile + admin PWA, Telegram auth, JSON-file storage on Railway volume, real-time sync API.
"""
import hashlib, hmac, json, logging, os, re, secrets, time, urllib.request
from datetime import datetime, timezone
from pathlib import Path
from functools import wraps

from flask import Flask, jsonify, request, session, redirect, send_from_directory

logger = logging.getLogger(__name__)
app = Flask(__name__)
app.secret_key = os.getenv("OILLOG_SECRET", "oillog-secret-change-me")

DATA_DIR = Path(os.getenv("OILLOG_DATA_DIR", "/app/data"))
BOT_TOKEN = os.getenv("BOT_TOKEN", "8783000783:AAH0nsNC0Mh0egLVdKd9i5lm1-fZuQ7Ltos")
BOT_USERNAME = os.getenv("BOT_USERNAME", "kurtexsecuritybot")  # ← SET THIS
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

# ── Whitelist-based access control for the Telegram Login Widget ───────────
# allowed_users.json: [{"telegram_username","telegram_id","chat_id","role","added_by"}]
ADMIN_CHAT_IDS = {c.strip() for c in os.getenv("ADMIN_CHAT_IDS", "").split(",") if c.strip()}

def load_allowed():
    return _read_json("allowed_users.json")

def save_allowed(users):
    _write_json("allowed_users.json", users)

def find_allowed(username=None, telegram_id=None, chat_id=None):
    username = (username or "").lstrip("@").lower() or None
    for u in load_allowed():
        if username and (u.get("telegram_username") or "").lower() == username:
            return u
        if telegram_id and str(u.get("telegram_id")) == str(telegram_id):
            return u
        if chat_id and str(u.get("chat_id")) == str(chat_id):
            return u
    return None

def tg_api(method, payload):
    try:
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{BOT_TOKEN}/{method}",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"}, method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read())
    except Exception as e:
        logger.error(f"telegram {method} failed: {e}")
        return None

def tg_send_message(chat_id, text):
    return tg_api("sendMessage", {"chat_id": chat_id, "text": text})

# ── Bot commands (admin manages the whitelist from inside Telegram) ────────

def handle_bot_command(chat_id, from_user, text):
    is_admin = str(chat_id) in ADMIN_CHAT_IDS
    parts = text.split()
    cmd = parts[0].lower()

    if cmd == "/start":
        token = parts[1].strip() if len(parts) > 1 else ""
        username = (from_user.get("username") or "").lower()
        # Auto-link if this Telegram user (by username or numeric id) is on the whitelist
        entry = find_allowed(username=username, telegram_id=from_user.get("id"))
        if entry:
            entry["chat_id"] = chat_id
            entry["telegram_id"] = from_user.get("id")
            users = load_allowed()
            for i, u in enumerate(users):
                if u is entry or u.get("telegram_username") == entry.get("telegram_username"):
                    users[i] = entry
            save_allowed(users)
            tg_send_message(chat_id, "✅ You're linked. You can now log in on the OILLOG website with your Telegram username.")
        else:
            tg_send_message(chat_id, f"Your Telegram ID is {from_user.get('id')}, username @{username or 'none'}. Ask an admin to whitelist you before you can log in.")
        return

    if not is_admin:
        return  # ignore management commands from non-admins

    if cmd == "/adduser" and len(parts) >= 2:
        username = parts[1].lstrip("@").lower()
        role = parts[2] if len(parts) > 2 else "agent"
        users = load_allowed()
        if find_allowed(username=username):
            tg_send_message(chat_id, f"@{username} is already whitelisted.")
            return
        users.append({"telegram_username": username, "telegram_id": None, "chat_id": None, "role": role, "added_by": chat_id})
        save_allowed(users)
        tg_send_message(chat_id, f"✅ @{username} added ({role}). They need to message me with /start to finish linking.")

    elif cmd == "/removeuser" and len(parts) >= 2:
        username = parts[1].lstrip("@").lower()
        users = load_allowed()
        new_users = [u for u in users if (u.get("telegram_username") or "").lower() != username]
        if len(new_users) < len(users):
            save_allowed(new_users)
            tg_send_message(chat_id, f"🗑 @{username} removed.")
        else:
            tg_send_message(chat_id, f"@{username} wasn't found.")

    elif cmd == "/listusers":
        users = load_allowed()
        if not users:
            tg_send_message(chat_id, "No whitelisted users yet.")
        else:
            lines = [f"@{u.get('telegram_username')} — {u.get('role')} — {'linked' if u.get('chat_id') else 'not linked yet'}" for u in users]
            tg_send_message(chat_id, "\n".join(lines))

@app.route("/telegram/webhook/<secret>", methods=["POST"])
def telegram_webhook(secret):
    if secret != TELEGRAM_WEBHOOK_SECRET:
        return jsonify({"ok": False}), 403
    update = request.json or {}
    msg = update.get("message") or {}
    text = (msg.get("text") or "").strip()
    chat_id = msg.get("chat", {}).get("id")
    from_user = msg.get("from", {})
    if text.startswith("/") and chat_id:
        handle_bot_command(chat_id, from_user, text)
    return jsonify({"ok": True})



# ── Auth routes ──────────────────────────────────────────────────────────

@app.route("/auth/telegram", methods=["POST"])
def telegram_auth():
    data = dict(request.json or {})
    if not data.get("hash"):
        return jsonify({"ok": False, "error": "no_hash"}), 400

    if not verify_telegram_login(data):
        return jsonify({"ok": False, "error": "invalid"}), 401

    telegram_id = data.get("id")
    username = data.get("username", "")
    entry = find_allowed(username=username, telegram_id=telegram_id)
    if not entry:
        return jsonify({"ok": False, "error": "not_whitelisted"}), 403

    # Keep the whitelist entry's telegram_id fresh for future lookups/bot commands
    if not entry.get("telegram_id"):
        users = load_allowed()
        for u in users:
            if u.get("telegram_username", "").lower() == (username or "").lower():
                u["telegram_id"] = telegram_id
        save_allowed(users)

    session["user"] = {
        "id": telegram_id,
        "first_name": data.get("first_name", ""),
        "username": username,
        "photo_url": data.get("photo_url", ""),
        "auth_date": data.get("auth_date", ""),
        "role": entry.get("role", "agent"),
    }
    return jsonify({"ok": True, "user": session["user"]})

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

@app.route("/")
def serve_index():
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
