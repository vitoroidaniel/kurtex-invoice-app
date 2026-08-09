# 🔧 OILLOG

<div align="center">

![Flask](https://img.shields.io/badge/Flask-2.0+-000000?style=for-the-badge&logo=flask)
![PWA](https://img.shields.io/badge/PWA-Ready-5A0FC8?style=for-the-badge&logo=pwa)
![Telegram](https://img.shields.io/badge/Telegram-Bot-26A5E4?style=for-the-badge&logo=telegram)
![Excel](https://img.shields.io/badge/Excel-Export-217346?style=for-the-badge&logo=microsoft-excel)

**Fleet Oil Change Tracking System**

*Track, manage, and export oil change records for trucks and reefers — all in real-time.*

[Features](#-features) • [Installation](#-installation) • [Usage](#-usage) • [Authentication](#-authentication) • [API](#-api) • [Screenshots](#-screenshots)

</div>

---

## 📋 Overview

**OILLOG** is a modern, full-stack fleet management application designed to track oil changes across your yard operations. Built with Flask backend and vanilla JavaScript frontend, it provides a seamless experience for both field agents and administrators.

### What It Does

- ✅ **Track oil changes** for trucks (mileage-based) and reefers (engine hours-based)
- ✅ **Real-time sync** across all devices every 5 seconds
- ✅ **Telegram authentication** — secure, bot-based access control
- ✅ **Guest mode** — quick access without authentication
- ✅ **Excel export** — generate professional reports with one click
- ✅ **Smart alerts** — get notified when units are due or overdue for service
- ✅ **PWA ready** — install on mobile devices like a native app
- ✅ **Dark/Light themes** — comfortable viewing in any environment

---

## ✨ Features

### 📱 Mobile App (Field Agents)
- **Quick Entry Form** — Log oil changes in seconds with intuitive date picker and unit selector
- **Unit Type Selection** — Switch between Truck (miles) and Reefer (engine hours) with one tap
- **Entry History** — View all your submissions with date grouping and filtering
- **Export Options** — Download as Excel (.xlsx) or share via native share sheet
- **Offline Support** — Service worker enables basic functionality even without internet
- **Responsive Design** — Optimized for phones, tablets, and desktop browsers

### 🖥️ Admin Panel (Managers)
- **Dashboard** — Real-time overview with stats cards and recent activity
- **Entries Management** — View, search, sort, and filter all oil change records
- **Units Tracking** — Monitor unit status, last oil change, and next due date
- **Alert System** — Visual indicators for overdue and near-interval units
- **Complete Alerts** — Mark units as serviced with automatic next-date calculation
- **Excel Export** — Generate filtered reports with preview before download
- **Settings Management** — Configure oil change intervals (Truck: 15,000 mi, Reefer: 500 hrs)
- **Theme Toggle** — Switch between light and dark modes
- **Notification Preferences** — Control browser and in-app alerts

### 🔐 Authentication & Security
- **Telegram Login** — Single sign-on via Telegram Bot (Kurtex Security Bot)
- **Role-Based Access** — Developers and Super Admins get admin panel access
- **Guest Mode** — Temporary access for quick entries without account
- **Session Management** — Secure Flask sessions with configurable secret key
- **Password Auth** — Optional username/password registration for agents

---

## 🛠️ Tech Stack

| Component | Technology |
|-----------|-----------|
| **Backend** | Flask (Python) |
| **Frontend** | Vanilla JavaScript, HTML5, CSS3 |
| **Authentication** | Telegram Login Widget, Flask Sessions |
| **Storage** | JSON files (production) / Railway volume |
| **Export** | ExcelJS library |
| **Icons** | Lucide Icons |
| **Fonts** | Oswald, Inter, JetBrains Mono |
| **PWA** | Service Worker, Web App Manifest |
| **Deployment** | Railway (recommended) |

---

## 📦 Installation

### Prerequisites

- Python 3.8+
- pip package manager
- Telegram Bot token (from [@BotFather](https://t.me/BotFather))

### Quick Start

```bash
# Clone the repository
git clone https://github.com/yourusername/oillog.git
cd oillog

# Install dependencies
pip install -r requirements.txt

# Set environment variables
export OILLOG_SECRET="your-secret-key-here"
export BOT_TOKEN="your-telegram-bot-token"
export OILLOG_DATA_DIR="./data"

# Run the server
python server.py
```

Visit `http://localhost:8080` in your browser.

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OILLOG_SECRET` | Flask session secret key | `oillog-secret-change-me` |
| `BOT_TOKEN` | Telegram bot token (same as alert bot) | `""` |
| `OILLOG_DATA_DIR` | Directory for JSON data files | `/app/data` |
| `PORT` | Server port | `8080` |

### Production Deployment (Railway)

1. **Push to GitHub**
   ```bash
   git add .
   git commit -m "Initial commit"
   git push origin main
   ```

2. **Deploy on Railway**
   - Connect your GitHub repository
   - Set environment variables in Railway dashboard
   - Deploy!

3. **Configure Telegram Bot**
   ```
   /setdomain your-app.up.railway.app
   /setcommands
   ```

---

## 🚀 Usage

### For Field Agents

1. **Login**
   - Click "Login with Telegram" and authorize via Telegram app
   - Or continue as Guest (enter your name for tracking)

2. **Add Oil Change Entry**
   - Navigate to **ADAUGA** tab
   - Select date (defaults to today)
   - Choose unit type: **TRUCK** or **REEFER**
   - Enter unit number (e.g., `437` or `R162`)
   - Enter mileage (miles) or engine hours
   - Click **SALVEAZĂ ÎN LISTĂ**

3. **View & Export**
   - Go to **LISTĂ** tab to see all entries
   - Filter by type (All/Truck/Reefer) and scope (Ale mele/Toate)
   - Export to Excel or share via SMS/email

### For Administrators

1. **Access Admin Panel**
   - Navigate to `/admin` or `/admin-login`
   - Login with Telegram (requires developer/super_admin role)
   - Or use password: `admin` / `oillog2024`

2. **Monitor Dashboard**
   - View total records, truck/reefer counts, and overdue units
   - Check recent entries and active alerts

3. **Manage Units & Alerts**
   - Go to **Units** tab to see all units with status indicators
   - Click on unit to view oil change history
   - Go to **Alerts** tab to see due/overdue units
   - Click **Complete** to log oil change and update next due date

4. **Configure Settings**
   - Set oil change intervals: Truck (default: 15,000 mi), Reefer (default: 500 hrs)
   - Toggle notification preferences
   - Switch between light/dark theme

5. **Export Reports**
   - Go to **Entries** tab
   - Click **Export** button
   - Select time period (today, week, month, custom, or all)
   - Preview data and download Excel file

---

## 🔑 Authentication

### Telegram-Based Auth

The app uses [Telegram Login Widget](https://core.telegram.org/widgets/login) for authentication. Users must be whitelisted via the Kurtex Alert Bot:

```bash
# In Telegram, send to @kurtexsecuritybot:
/adduser <telegram_id> <name> <role>
```

**Available Roles:**
- `developer` — Full admin access
- `super_admin` — Full admin access
- `agent` — Mobile app access only

### Password-Based Auth

Agents can self-register via the mobile app:
```javascript
POST /auth/register
{
  "username": "john_doe",
  "password": "secure123",
  "name": "John Doe"
}
```

**Hardcoded Admin Fallback:**
- Username: `admin`
- Password: `oillog2024`
- Role: `super_admin`

---

## 🔌 API Reference

### Authentication Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/auth/telegram` | Telegram OAuth callback |
| `POST` | `/auth/guest` | Guest login (no auth required) |
| `POST` | `/auth/register` | Register new user (agent role) |
| `POST` | `/auth/password` | Password login |
| `POST` | `/auth/password-admin` | Admin password login |
| `GET` | `/auth/status` | Check current session |
| `POST` | `/logout` | Clear session |

### Data Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/sync` | Get all data (entries, units, settings) |
| `POST` | `/api/entries` | Create new oil change entry |
| `PUT` | `/api/entries/<id>` | Update existing entry |
| `DELETE` | `/api/entries/<id>` | Delete entry |
| `POST` | `/api/units/<key>` | Update unit current value |
| `PUT` | `/api/settings` | Update oil change intervals |

### Static Files

| Route | Description |
|-------|-------------|
| `/` | Mobile app (oillog-mobile.html) |
| `/admin` | Admin panel (oillog-admin.html) |
| `/admin-login` | Admin login page |
| `/web` | Web version (oillog-web.html) |

---

## 📊 Data Structure

### Oil Change Entry
```json
{
  "id": "1704067200_abc123",
  "date": "2024-01-01",
  "type": "T",
  "unit": "437",
  "unitOfValue": "mi",
  "value": "304670",
  "addedBy": "John Doe",
  "sent": false,
  "createdAt": 1704067200000
}
```

### Unit Profile
```json
{
  "T_437": {
    "currentValue": 319670,
    "updatedAt": 1704067200000,
    "updatedBy": "John Doe"
  }
}
```

### Settings
```json
{
  "T": 15000,
  "R": 500
}
```

---

## 🎨 Screenshots

<div align="center">

### Mobile App
*Add oil change entry with intuitive form*

![Mobile App](https://via.placeholder.com/300x600/FAFAF8/C8102E?text=Mobile+App+Screenshot)

### Admin Dashboard
*Real-time overview with stats and alerts*

![Admin Dashboard](https://via.placeholder.com/1200x600/F4F4F2/1A1A1A?text=Admin+Dashboard+Screenshot)

### Excel Export
*Professional reports with filtering*

![Excel Export](https://via.placeholder.com/800x500/FFFFFF/C8102E?text=Excel+Export+Preview)

</div>

---

## 🗂️ Project Structure

```
oillog/
├── server.py                 # Flask backend server
├── requirements.txt          # Python dependencies
├── oillog-mobile.html       # Mobile PWA (field agents)
├── oillog-admin.html        # Admin panel (managers)
├── oillog-admin-login.html  # Admin login page
├── oillog-web.html          # Web version
├── manifest.json            # PWA manifest
├── service-worker.js        # Service worker for offline support
├── icon-192.png             # App icon (192x192)
├── icon-512.png             # App icon (512x512)
├── storage/
│   ├── __init__.py
│   └── user_store.py        # Telegram user management (shared with alert bot)
└── data/                    # JSON data files (created at runtime)
    ├── entries.json
    ├── units.json
    ├── settings.json
    └── users_auth.json
```

---

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. **Fork the repository**
2. **Create a feature branch**
   ```bash
   git checkout -b feature/amazing-feature
   ```
3. **Commit your changes**
   ```bash
   git commit -m 'Add amazing feature'
   ```
4. **Push to the branch**
   ```bash
   git push origin feature/amazing-feature
   ```
5. **Open a Pull Request**

### Development Guidelines

- Follow existing code style (vanilla JS, no frameworks)
- Test on both mobile and desktop viewports
- Ensure Telegram auth flow works correctly
- Verify Excel export generates valid .xlsx files
- Update this README if you add new features

---

## 📝 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

## 👨‍💻 Author

**Kurtex Fleet** — Built for yard operations efficiency.

---

## 🙏 Acknowledgments

- [Flask](https://flask.palletsprojects.com/) — Backend framework
- [ExcelJS](https://github.com/exceljs/exceljs) — Excel file generation
- [Lucide Icons](https://lucide.dev/) — Beautiful icon set
- [Telegram Login Widget](https://core.telegram.org/widgets/login) — Secure authentication
- [Railway](https://railway.app/) — Deployment platform

---

## 📞 Support

If you encounter any issues or have questions:

1. Check the [Issues](https://github.com/yourusername/oillog/issues) page
2. Create a new issue with detailed description
3. Contact via Telegram: [@kurtexsecuritybot](https://t.me/kurtexsecuritybot)

---

<div align="center">

**⭐ Star this repo if you find it useful!**

Made with ❤️ for fleet managers everywhere

</div>