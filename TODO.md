# TODO — OILLOG modifications

## ✅ Server (server.py)
- [x] Create Flask server with Railway volume storage
- [x] API endpoints: /api/sync, /api/entries/*, /api/units/*, /api/settings, /auth/*
- [x] Telegram Login Widget verification (HMAC-SHA256)
- [x] Guest auth endpoint
- [x] Session management
- [x] Live sync endpoint
- [x] JSON persistence to Railway volume

## ✅ oillog-mobile.html
- [x] Replace Telegram username prompt with Telegram Login Widget
- [x] Guest auth via server
- [x] Remove all Trailer/TR references from type selector, filters
- [x] Implement api() helper for server communication
- [x] Replace remoteStorage with API calls (entries, units, settings)
- [x] Add live sync (5s polling)
- [x] Session persistence / re-auth on refresh

## ✅ oillog-admin.html
- [x] Replace Telegram username prompt with Telegram Login Widget
- [x] Remove all Trailer/TR references (filters, stats, modals, functions)
- [x] Implement api() helper for server communication
- [x] Replace remoteStorage with API calls
- [x] Add live sync (5s polling)
- [x] Session persistence / re-auth on refresh

## ✅ manifest.json
- [x] Updated description (removed "trailere" reference)

## 📋 Deployment Notes
To deploy on Railway:

1. **Create a Railway project** from the GitHub repo containing these files
2. **Set the build command**: `pip install flask`
3. **Set the start command**: `python server.py`
4. **Add a volume mount** at `/app/data` (Railway → Volumes)
5. **Set environment variables**:
   - `BOT_TOKEN` = your Telegram bot token (from @BotFather)
   - `BOT_USERNAME` = your bot username (e.g., `kurtexalertsbot`)
   - `OILLOG_SECRET` = a random secret string for Flask sessions
6. **Update `oillog-mobile.html`** and **`oillog-admin.html`** — change `BOT_USERNAME` in the Telegram widget script's `data-telegram-login` attribute to your bot's username

The app will be available at your Railway domain:
- `/` → mobile app
- `/admin` → admin panel

