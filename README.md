# OILLOG

<div align="center">

![Flask](https://img.shields.io/badge/Flask-2.0+-000000?style=for-the-badge&logo=flask)
![PWA](https://img.shields.io/badge/PWA-Ready-5A0FC8?style=for-the-badge&logo=pwa)
![Excel](https://img.shields.io/badge/Excel-Export-217346?style=for-the-badge&logo=microsoft-excel)

**Fleet Oil Change Tracking System**

*Track, manage, and export oil change records for trucks and reefers — all in real-time.*

</div>

---

## Overview

**OILLOG** is a full-stack fleet management application for tracking oil changes across yard operations. Built with a Flask backend and vanilla JavaScript frontend, it provides a seamless experience for both field agents and administrators.

### What It Does

- ✅ **Track oil changes** for trucks (mileage-based) and reefers (engine hours-based)
- ✅ **Real-time sync** across all devices every 5 seconds
- ✅ **Username/password authentication** — accounts managed by administrators
- ✅ **Excel export** — generate professional reports with one click
- ✅ **Smart alerts** — get notified when units are due or overdue for service
- ✅ **PWA ready** — install on mobile devices like a native app
- ✅ **Dark/Light themes** — comfortable viewing in any environment

---

## Features

### Mobile App (Field Agents)
- **Quick Entry Form** — Log oil changes in seconds with intuitive date picker and unit selector
- **Unit Type Selection** — Switch between Truck (miles) and Reefer (engine hours) with one tap
- **Entry History** — View all your submissions with date grouping and filtering
- **Export Options** — Download as Excel (.xlsx) or share via native share sheet
- **Responsive Design** — Optimized for phones, tablets, and desktop browsers

### Admin Panel (Managers)
- **Dashboard** — Real-time overview with stats cards and recent activity
- **Entries Management** — View, search, sort, and filter all oil change records
- **Units Tracking** — Monitor unit status, last oil change, and next due date
- **Alert System** — Visual indicators for overdue and near-interval units
- **User Management** — Create, edit, and delete user accounts with role assignment
- **Password Generation** — Auto-generate secure passwords for new users
- **Excel Export** — Generate filtered reports with preview before download
- **Settings Management** — Configure oil change intervals
- **Theme Toggle** — Switch between light and dark modes

### Authentication & Security
- **Username/Password Login** — For both mobile app and admin panel
- **Role-Based Access** — `developer`, `super_admin`, and `agent` roles
- **Salted Password Hashing** — Passwords stored as salted SHA-256 hashes, never plaintext
- **Session Management** — Secure Flask sessions with configurable secret key
- **Admin-Only User Management** — Only `developer`/`super_admin` roles can manage users

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| **Backend** | Flask (Python) |
| **Frontend** | Vanilla JavaScript, HTML5, CSS3 |
| **Authentication** | Username/Password, Flask Sessions |
| **Storage** | JSON files on Railway persistent volume |
| **Export** | ExcelJS library |
| **Icons** | Lucide Icons |
| **Fonts** | Oswald, Inter, JetBrains Mono |
| **PWA** | Service Worker, Web App Manifest |
| **Deployment** | Railway (recommended) |

---

## Installation

### Prerequisites

- Python 3.8+
- pip package manager

### Quick Start (Local Development)

```bash
# Clone the repository
git clone <your-repo-url>
cd oillog

# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Set environment variables (optional for local dev)
export OILLOG_SECRET="your-secret-key-here"
export OILLOG_DATA_DIR="./data"

# Run the server
python server.py
```

Visit `http://localhost:8080` in your browser.

### Environment Variables

All configuration is done via environment variables. **No hardcoded values** — everything can be set in the Railway dashboard.

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `OILLOG_SECRET` | Flask session secret key | Yes (for production) | `oillog-secret-change-me` |
| `OILLOG_DATA_DIR` | Directory for JSON data files | No | `/app/data` |
| `PORT` | Server port (Railway sets this automatically) | No | `8080` |

**Note:** On Railway, `PORT` is set automatically. `OILLOG_DATA_DIR` defaults to `/app/data` which is Railway's persistent volume.

### Production Deployment (Railway)

1. **Push to GitHub**
   ```bash
   git add .
   git commit -m "Initial commit"
   git push origin main
   ```

2. **Deploy on Railway**
   - Connect your GitHub repository
   - Set environment variables in the Railway dashboard
   - Deploy!

3. **Create your first admin user**
   - After deployment, the `users_auth.json` file will be created on the Railway volume
   - Seed it with an initial admin user (see the data structure below), or use the Telegram login option on the admin page if configured

---

## Usage

### For Field Agents

1. **Login**
   - Enter your username and password (provided by your administrator)

2. **Add Oil Change Entry**
   - Navigate to the **ADD** tab
   - Select date (defaults to today)
   - Choose unit type: **TRUCK** or **REEFER**
   - Enter unit number (e.g., `437` or `R162`)
   - Enter mileage (miles) or engine hours
   - Click **SAVE TO LIST**

3. **View & Export**
   - Go to the **LIST** tab to see all entries
   - Filter by type (All/Truck/Reefer) and scope (Mine/All)
   - Export to Excel or share via the native share sheet

### For Administrators

1. **Access Admin Panel**
   - Navigate to `/admin` or `/admin-login`
   - Login with your admin username and password (requires `developer` or `super_admin` role)

2. **Manage Users**
   - Go to the **Users** page
   - Click **Add user** to create a new account
   - Set username, display name, role, and password (or use the **Generate** button)
   - Edit existing users to change roles or reset passwords
   - Delete users when needed

3. **Monitor Dashboard**
   - View total records, truck/reefer counts, and overdue units
   - Check recent entries and active alerts

4. **Manage Units & Alerts**
   - Go to **Units** tab to see all units with status indicators
   - Click on a unit to view oil change history
   - Go to **Alerts** tab to see due/overdue units
   - Click **Complete** to log oil change and update next due date

5. **Configure Settings**
   - Set oil change intervals: Truck (default: 15,000 mi), Reefer (default: 500 hrs)
   - Toggle notification preferences
   - Switch between light/dark theme

6. **Export Reports**
   - Go to **Entries** tab
   - Click **Export** button
   - Select time period (today, week, month, custom, or all)
   - Preview data and download Excel file

---

## Authentication

### Roles

| Role | Access |
|------|--------|
| `agent` | Mobile app only |
| `developer` | Full admin panel access |
| `super_admin` | Full admin panel access |

### User Management

Users are created and managed by administrators from the **Users** page in the admin panel. Passwords are stored as **salted SHA-256 hashes** — never in plaintext.

---

## API Reference

### Authentication Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/auth/password` | Password login (mobile app) |
| `POST` | `/auth/password-admin` | Admin password login |
| `GET` | `/auth/status` | Check current session |
| `POST` | `/logout` | Clear session |

### User Management (Admin Only)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/users` | List all users |
| `POST` | `/api/users` | Create a new user |
| `PUT` | `/api/users/<username>` | Update user (name, role, password) |
| `DELETE` | `/api/users/<username>` | Delete a user |

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

## Data Structure

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

### User Account
```json
{
  "john_doe": {
    "name": "John Doe",
    "password_hash": "a1b2c3...$e4f5g6...",
    "role": "agent",
    "createdAt": 1704067200000
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

## Project Structure

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

## Contributing

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
- Verify Excel export generates valid .xlsx files
- Update this README if you add new features

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

## Acknowledgments

- [Flask](https://flask.palletsprojects.com/) — Backend framework
- [ExcelJS](https://github.com/exceljs/exceljs) — Excel file generation
- [Lucide Icons](https://lucide.dev/) — Beautiful icon set
- [Railway](https://railway.app/) — Deployment platform

---

<div align="center">

**⭐ Star this repo if you find it useful!**

Made with ❤️ for fleet managers everywhere

</div>