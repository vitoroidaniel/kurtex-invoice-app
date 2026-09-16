"""
OILLOG Telegram Bot — User Management & Alerts
Manages user roles via commands and sends oil change alerts.

Commands:
  /adduser <id> <name> <role>    — Add/update user (admin only)
  /removeuser <id>               — Remove user (admin only)
  /editrole <id> <role>          — Change user role (admin only)
  /listusers                     — List all users (admin only)
  /start                         — Show welcome message
  /help                          — Show help

Roles: developer, super_admin, agent
"""
import logging
import os
from pathlib import Path
from telegram import Update, InlineKeyboardMarkup, InlineKeyboardButton
from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    CallbackQueryHandler,
    ContextTypes,
)

from storage.user_store import (
    add_user,
    remove_user,
    edit_role,
    get_user,
    get_all_users,
    has_role,
    VALID_ROLES,
)

# ── Configuration ────────────────────────────────────────────────────────────
BOT_TOKEN = os.getenv("BOT_TOKEN", "")
if not BOT_TOKEN:
    raise RuntimeError("BOT_TOKEN environment variable is required")

# Admin user IDs who can manage other users (set via env var, comma-separated)
ADMIN_IDS = set(
    int(x) for x in os.getenv("ADMIN_IDS", "").split(",") if x.strip().isdigit()
)

DATA_DIR = Path(os.getenv("DATA_DIR", "/app/data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)


# ── Helpers ───────────────────────────────────────────────────────────────────
def is_admin(user_id: int) -> bool:
    """Check if user is authorized to manage users."""
    return user_id in ADMIN_IDS or has_role(user_id, "developer", "super_admin")


async def ensure_user_registered(update: Update) -> bool:
    """Ensure the Telegram user is in our user store. Returns True if new user."""
    user = update.effective_user
    if not user:
        return False

    existing = get_user(user.id)
    if existing:
        return False

    # Auto-register with default role
    add_user(
        user_id=user.id,
        name=user.first_name or user.username or "User",
        username=user.username or "",
        role="agent",
    )
    logger.info(f"Auto-registered new user: {user.id} ({user.first_name})")
    return True


# ── Command Handlers ─────────────────────────────────────────────────────────
async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /start command."""
    if not update.effective_user:
        return

    await ensure_user_registered(update)
    user = update.effective_user

    welcome_text = (
        f"👋 Welcome, {user.first_name}!\n\n"
        "I'm the OILLOG bot. I manage access to the oil change tracking system.\n\n"
        "Your account has been registered with the default role: <b>agent</b>.\n"
        "Contact an administrator to get access to the admin panel.\n\n"
        "Use /help to see available commands."
    )

    await update.message.reply_text(welcome_text, parse_mode="HTML")


async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /help command."""
    if not is_admin(update.effective_user.id):
        text = (
            "📋 <b>Available Commands</b>\n\n"
            "/start — Show welcome message\n"
            "/help — Show this help message\n\n"
            "Contact an administrator for access to the admin panel."
        )
    else:
        text = (
            "📋 <b>Available Commands</b>\n\n"
            "<b>User Management (Admin):</b>\n"
            "/adduser <id> <name> <role> — Add or update a user\n"
            "/removeuser <id> — Remove a user\n"
            "/editrole <id> <role> — Change user role\n"
            "/listusers — List all registered users\n\n"
            "<b>General:</b>\n"
            "/start — Show welcome message\n"
            "/help — Show this help message\n\n"
            f"<b>Valid roles:</b> {', '.join(VALID_ROLES)}"
        )

    await update.message.reply_text(text, parse_mode="HTML")


async def cmd_adduser(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /adduser command — add or update a user."""
    if not update.effective_user or not is_admin(update.effective_user.id):
        await update.message.reply_text("❌ You are not authorized to use this command.")
        return

    if not context.args or len(context.args) < 3:
        await update.message.reply_text(
            "⚠️ Usage: /adduser <telegram_id> <name> <role>\n"
            f"Valid roles: {', '.join(VALID_ROLES)}"
        )
        return

    try:
        user_id = int(context.args[0])
    except ValueError:
        await update.message.reply_text("❌ Invalid Telegram ID. Must be a number.")
        return

    name = context.args[1]
    role = context.args[2].lower()

    if role not in VALID_ROLES:
        await update.message.reply_text(
            f"❌ Invalid role '{role}'. Valid roles: {', '.join(VALID_ROLES)}"
        )
        return

    success = add_user(user_id, name, "", role)
    if success:
        action = "Updated" if get_user(user_id) else "Added"
        await update.message.reply_text(
            f"✅ {action} user:\n"
            f"ID: {user_id}\n"
            f"Name: {name}\n"
            f"Role: {role}"
        )
    else:
        await update.message.reply_text("❌ Failed to save user. Check logs.")


async def cmd_removeuser(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /removeuser command — remove a user."""
    if not update.effective_user or not is_admin(update.effective_user.id):
        await update.message.reply_text("❌ You are not authorized to use this command.")
        return

    if not context.args or len(context.args) < 1:
        await update.message.reply_text("⚠️ Usage: /removeuser <telegram_id>")
        return

    try:
        user_id = int(context.args[0])
    except ValueError:
        await update.message.reply_text("❌ Invalid Telegram ID. Must be a number.")
        return

    user = get_user(user_id)
    if not user:
        await update.message.reply_text(f"❌ User {user_id} not found.")
        return

    success = remove_user(user_id)
    if success:
        await update.message.reply_text(
            f"✅ Removed user:\n"
            f"ID: {user_id}\n"
            f"Name: {user.get('name', 'Unknown')}\n"
            f"Role: {user.get('role', 'Unknown')}"
        )
    else:
        await update.message.reply_text("❌ Failed to remove user. Check logs.")


async def cmd_editrole(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /editrole command — change user role."""
    if not update.effective_user or not is_admin(update.effective_user.id):
        await update.message.reply_text("❌ You are not authorized to use this command.")
        return

    if not context.args or len(context.args) < 2:
        await update.message.reply_text(
            "⚠️ Usage: /editrole <telegram_id> <role>\n"
            f"Valid roles: {', '.join(VALID_ROLES)}"
        )
        return

    try:
        user_id = int(context.args[0])
    except ValueError:
        await update.message.reply_text("❌ Invalid Telegram ID. Must be a number.")
        return

    new_role = context.args[1].lower()
    if new_role not in VALID_ROLES:
        await update.message.reply_text(
            f"❌ Invalid role '{new_role}'. Valid roles: {', '.join(VALID_ROLES)}"
        )
        return

    user = get_user(user_id)
    if not user:
        await update.message.reply_text(f"❌ User {user_id} not found. Use /adduser first.")
        return

    success = edit_role(user_id, new_role)
    if success:
        await update.message.reply_text(
            f"✅ Role updated:\n"
            f"ID: {user_id}\n"
            f"Name: {user.get('name', 'Unknown')}\n"
            f"New role: {new_role}"
        )
    else:
        await update.message.reply_text("❌ Failed to update role. Check logs.")


async def cmd_listusers(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /listusers command — list all users."""
    if not update.effective_user or not is_admin(update.effective_user.id):
        await update.message.reply_text("❌ You are not authorized to use this command.")
        return

    users = get_all_users()
    if not users:
        await update.message.reply_text("📋 No users registered yet.")
        return

    lines = [f"📋 <b>Registered Users ({len(users)})</b>\n"]
    for uid, u in sorted(users.items(), key=lambda x: int(x[0])):
        role_emoji = "👑" if u["role"] == "developer" else "⭐" if u["role"] == "super_admin" else "👤"
        lines.append(
            f"{role_emoji} <b>{u.get('name', 'Unknown')}</b>\n"
            f"   ID: {uid}\n"
            f"   Role: {u['role']}\n"
            f"   Username: @{u.get('username', 'N/A')}\n"
        )

    await update.message.reply_text("\n".join(lines), parse_mode="HTML")


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    """Start the bot."""
    if not BOT_TOKEN:
        logger.error("BOT_TOKEN environment variable is not set!")
        return

    # Bootstrap developer account if DEVELOPER_ID is set
    developer_id = os.getenv("DEVELOPER_ID", "")
    if developer_id:
        from storage.user_store import bootstrap_developer
        try:
            dev_id = int(developer_id)
            bootstrap_developer(dev_id)
            ADMIN_IDS.add(dev_id)
            logger.info(f"Bootstrapped developer account: {dev_id}")
        except ValueError:
            logger.warning(f"Invalid DEVELOPER_ID: {developer_id}")

    # Build application
    application = ApplicationBuilder().token(BOT_TOKEN).build()

    # Register command handlers
    application.add_handler(CommandHandler("start", cmd_start))
    application.add_handler(CommandHandler("help", cmd_help))
    application.add_handler(CommandHandler("adduser", cmd_adduser))
    application.add_handler(CommandHandler("removeuser", cmd_removeuser))
    application.add_handler(CommandHandler("editrole", cmd_editrole))
    application.add_handler(CommandHandler("listusers", cmd_listusers))

    # Start the bot
    logger.info("Starting OILLOG Telegram Bot...")
    application.run_polling(
        poll_interval=1.0,
        timeout=30,
        drop_pending_updates=True,
        allowed_updates=Update.ALL_TYPES,
    )


if __name__ == "__main__":
    main()