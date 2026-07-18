<div align="center">

# X-Media Downloader

<img width="300" height="300" alt="图层 0" src="https://github.com/user-attachments/assets/d6e84380-af4c-49fa-a2d0-d98e47bb1992" />

**English** | [简体中文](./README.md)

A powerful Chrome Extension to download images & videos from X.com (Twitter) with a sleek side panel UI.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-34A853?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Version](https://img.shields.io/badge/version-2.0.0-blue)](./package.json)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

</div>

> Browse your timeline, capture every media, download in one click — never miss a tweet again.

---

## ✨ Features

### 🎯 Core Capture
- **Auto-Capture** — Automatically intercepts and captures every image & video as you scroll your timeline
- **High Quality** — Always fetches the best available quality (original images, highest-bitrate videos)
- **Real-Time Sync** — Captured media appears in the side panel instantly via long-lived Port connections

### 🖼️ Side Panel UI
- **Sleek Grid View** — Responsive media grid with hover effects, type badges, and download status
- **Smart Filters** — Filter by type (Photo / Video) or status (Downloaded / Not Downloaded)
- **Lightbox Preview** — Click any thumbnail to preview in a full-screen overlay
- **Click-to-Open** — Toggle to open media directly in a new tab (browser-native viewer)
- **Full-View Mode** — Switch to a larger thumbnail layout for easier browsing

### ⚡ Batch & Categorized Downloads
- **Multi-Select** — Select multiple items with Shift+Click range selection
- **Batch Download** — Download all selected items in one click
- **Category Folders** — Organize downloads into custom subfolders (Default / Real / Anime)
- **Per-Item Quick Download** — Each card has quick-download buttons for each category

### 🧠 Smart Deduplication (3 Modes)

| Mode | How it works | Catches |
|------|--------------|---------|
| **ID** (default) | Media ID matching | Same media in same tweet |
| **Cover URL** | Normalized thumbnail URL | Same image re-posted by different users |
| **Perceptual Hash** | 64-bit pHash fingerprint | **Stolen images, re-uploads, compressed copies, screenshots** |

All dedup modes are optional toggles in the Settings panel. pHash is the most powerful — it can identify visually identical images even after re-encoding, resizing, or cropping.

### 📥 Download Center (NEW)
- **Dedicated Tab** — Open a standalone Download Center tab to manage all download tasks
- **Real-Time Queue** — Track each task's status (Pending / Downloading / Completed / Failed)
- **Retry Failed** — One-click retry for failed downloads
- **Diagnostic Panel** — Real-time visibility into `onDeterminingFilename` listener hits, pinpointing why filenames might not take effect
- **Persistent State** — Task queue and mappings stored in `chrome.storage.session`, survives service worker restarts

### 📊 Statistics & History
- **Persistent History** — Download history stored in `chrome.storage.local`, survives browser restarts
- **Visual Heatmap** — GitHub-style activity heatmap of your download activity
- **Session Stats** — Track captures and downloads in the current session
- **Auto-Mark Duplicates** — Already-downloaded items show a green badge automatically

### 🕵️ Privacy & UX
- **Boss Key** — One-click privacy overlay (fake "page not found" screen) — press `Esc` to trigger
- **Toast Notifications** — Non-intrusive feedback for all actions
- **Settings Panel** — Centralized configuration for all features

---

## 📸 Screenshots

> Screenshots coming soon — clone the repo and try it out!

---

## 🚀 Quick Start

### Installation (From Source)

```bash
# 1. Clone the repository
git clone https://github.com/Nijika-jia/X-Media-Downloader.git
cd X-Media-Downloader

# 2. Install dependencies
npm install

# 3. Build the extension
npm run build
```

**Load in Chrome:**
1. Open `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `dist/` folder

### Usage

1. Go to [x.com](https://x.com) or [twitter.com](https://twitter.com)
2. Browse your timeline — media is captured automatically
3. Click the extension icon to open the Side Panel
4. Filter, select, and download — done!

---

## ⚙️ Configuration

All settings are available in the Side Panel → Settings (gear icon):

| Setting | Description | Default |
|---------|-------------|---------|
| **Cover Dedup** | Identify duplicates by thumbnail URL | Off |
| **Perceptual Hash Dedup** | Identify duplicates by image content (catches stolen/re-uploaded images) | Off |
| **Click-to-Open** | Click thumbnail opens media in new tab | Off |
| **Full-View Mode** | Show larger thumbnails in the grid | Off |
| **Download Category** | Default folder category for downloads | Default |
| **Download Center** | Click side panel button to open standalone download management tab | - |

---

## 🏗️ Architecture

This project follows a **service-oriented architecture** with dependency injection, inspired by [webextension-pixiv-toolkit](https://github.com/leoding86/webextension-pixiv-toolkit).

```
┌─────────────────────────────────────────────────────────────┐
│                      Background (Service Worker)            │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │ Application │─►│ ServiceProvider│─►│   Services         │  │
│  │  (singleton)│  │   (DI container)│  │ • Download        │  │
│  └─────────────┘  └──────────────┘  │ • History          │  │
│         │                            │ • Media (Port)     │  │
│         ▼                            │ • Setting          │  │
│  ┌─────────────┐                     │ • Tab              │  │
│  │  Bootstrap  │                     └────────────────────┘  │
│  └─────────────┘                                             │
└─────────────────────────────────────────────────────────────┘
         │ Port (long-lived)            │ Messages
         ▼                              ▼
┌──────────────────────┐    ┌──────────────────────────────┐
│   Content Script     │    │       Side Panel UI          │
│  ┌────────────────┐  │    │  ┌────────────────────────┐  │
│  │   Lightbox     │  │    │  │   MediaStore (state)   │  │
│  └────────────────┘  │    │  └────────────────────────┘  │
│  ┌────────────────┐  │    │  ┌────────────────────────┐  │
│  │ Inject (MAIN)  │──┼────┼─►│  MediaGridRenderer     │  │
│  │ fetch/XHR hook │  │    │  │       (view)           │  │
│  └────────────────┘  │    │  └────────────────────────┘  │
└──────────────────────┘    └──────────────────────────────┘
```

### Key Design Patterns

- **Application Singleton** — Central controller managing service lifecycle & message routing
- **Bootstrap Pattern** — Handles initialization order and event binding
- **Service Provider (DI)** — Lazy-creates and injects services on demand
- **Port Communication** — Long-lived connections for real-time media event broadcasting
- **Data-View Separation** — `MediaStore` (state) + `MediaGridRenderer` (view)

---

## 📁 Project Structure

```
src/
├── background/                # Service worker
│   ├── Application.js         # Application singleton (lifecycle & routing)
│   ├── Bootstrap.js           # Initialization & event binding
│   └── services/
│       ├── AbstractService.js         # Base service class
│       ├── AbstractPortService.js     # Port-based service base
│       ├── ServiceProvider.js         # DI container
│       ├── DownloadService.js         # Download management
│       ├── HistoryService.js          # History + dedup (ID/URL/pHash)
│       ├── MediaService.js            # Media event broadcasting
│       ├── SettingService.js          # Settings management
│       └── TabService.js              # Tab management
├── content/                   # Content script
│   ├── index.js               # Media interception & lightbox trigger
│   ├── Lightbox.js            # Lightbox overlay
│   └── content.css
├── inject/                    # Injected script (MAIN world)
│   └── index.js               # Intercepts fetch/XHR for media URLs
├── sidepanel/                 # Side panel UI
│   ├── index.js               # SidePanelApp controller
│   ├── MediaStore.js          # State management (data layer)
│   ├── MediaGridRenderer.js   # Grid rendering (view layer)
│   ├── phash.js               # Perceptual hash computation
│   ├── constants.js           # UI constants & icons
│   ├── sidepanel.html
│   └── sidepanel.css
├── downloadcenter/            # Download Center tab (NEW)
│   ├── index.js               # DownloadCenterApp controller
│   ├── downloadcenter.html
│   └── downloadcenter.css
├── popup/                     # Popup page
├── config/
│   └── default.js             # Default settings
├── modules/
│   └── Extension/
│       └── browser.js         # Browser API adapter
└── errors/
    └── RuntimeError.js        # Custom error class
```

---

## 🛠️ Tech Stack

| Category | Technology |
|----------|-----------|
| Platform | Chrome Extension Manifest V3 |
| Language | Vanilla JavaScript (ES6+) |
| Bundler | Webpack 5 |
| UI | Custom CSS (no framework) |
| Storage | `chrome.storage.local` |
| APIs | `sidePanel`, `downloads`, `storage`, `runtime`, `tabs` |

---

## 💻 Development

```bash
# Install dependencies
npm install

# Development mode (watch for changes)
npm run dev

# Production build
npm run build
```

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📝 License

This project is licensed under the [MIT License](LICENSE).

---

## 🙏 Acknowledgments

- [webextension-pixiv-toolkit](https://github.com/leoding86/webextension-pixiv-toolkit) — Architecture inspiration
- The Chrome Extensions team for the excellent Manifest V3 APIs

---

<div align="center">

**If you find this project useful, please consider giving it a ⭐!**

Made with ❤️ by [Nijika-jia](https://github.com/Nijika-jia)

</div>
