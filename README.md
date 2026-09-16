<div align="center">

---

## ✨ What is OILLOG?

OILLOG is a lightweight fleet-management app built for **yard operations**.
Field agents log oil changes from their phones; managers keep an eye on the
whole yard from a clean, real-time dashboard.

|                                   |                                                                           |
| :-------------------------------- | :------------------------------------------------------------------------ |
| 📱**One app, every screen** | Responsive field app that feels native on phones and scales up to desktop |
| 🖥️**Management panel**    | Dashboard, records, units, alerts and account tools                       |
| 📊**Excel export**          | Professional`.xlsx` reports with one click                              |
| ⚡**Real-time sync**        | All devices re-sync every few seconds                                     |
| 📲**PWA ready**             | Installable on phones, cached for offline use                             |
| 🌗**Themes**                | Dark & light modes                                                        |
| 🔐**Secure by design**      | Role-based access, salted password hashing, HMAC-verified logins          |

---

## 🚀 Quick start (local)

```bash
pip install -r requirements.txt
python server.py
```

Open `http://localhost:8080`.

> ⚙️ Configuration (bot integration, storage path, session keys) is provided
> through environment variables on your hosting platform — reach out via the
> contacts below for the full list.

---

## 🧱 How it's built

```
├── server.py              # REST API + static serving (Python / Flask)
├── bot.py                 # Telegram companion bot
├── storage/               # shared user store
└── static/
    ├── pages/             # HTML shells — structure only
    │   ├── app-mobile.html      # phone layout   (served at / on phones)
    │   ├── app-desktop.html     # desktop layout (served at / on PCs)
    │   ├── admin.html           # admin panel
    │   └── admin-login.html     # admin sign-in
    ├── css/
    │   ├── app-base.css         # shared tokens & components
    │   ├── app-mobile.css       # phone layout (bottom nav, screen-fit)
    │   ├── app-desktop.css      # desktop layout (sidebar + table)
    │   ├── admin.css
    │   └── admin-login.css
    ├── js/
    │   ├── app.js               # one app, adapts to both layouts
    │   ├── admin.js
    │   └── admin-login.js
    ├── icons/             # PWA icons
    ├── brand/             # banner & brand assets
    ├── manifest.json      # PWA manifest
    └── service-worker.js  # offline cache
```

### One app, two layouts

The server inspects the `User-Agent` and serves the matching page from the same
URL — so there is a single link to share, and each device gets the right design:

| Device | Page served | Layout |
|---|---|---|
| Phone / tablet | `app-mobile.html` | Full-screen app, bottom tab bar, card list |
| Desktop / laptop | `app-desktop.html` | Navy sidebar, sticky header, stat cards, data table |

Both layouts share `app-base.css` and `app.js`, so features and logic never
diverge. You can preview either layout by force: `/mobile` and `/desktop`.

Data is stored as JSON files on a persistent volume — no database server
required, easy to back up.

---

## 🛣️ Roadmap

- [X] Mobile field entry app
- [X] Management dashboard & alerts
- [X] Excel & share exports
- [X] Installable PWA with offline cache
- [ ] Offline-first sync
- [ ] Push notifications
- [ ] Multi-yard support

---

## 📬 Contact

<div align="center">

---

## 📄 License

MIT — see [LICENSE](LICENSE).
