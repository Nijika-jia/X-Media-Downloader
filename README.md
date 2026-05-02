# X-Media Downloader

A Chrome Extension (Manifest V3) to download media (Images & Videos) from X.com (Twitter) with Side Panel support.

## Features

- **Auto-Capture** — Automatically detects and captures media (images & videos) as you browse your timeline
- **Side Panel UI** — Convenient sidebar panel to view, filter, and manage captured media
- **Download History** — Remembers previously downloaded files; auto-marks duplicates with visual badges
- **Duplicate Detection** — Skips re-downloading files you've already saved, with a toast notification
- **Batch Download** — Select multiple items and download them all at once
- **Category Folders** — Organize downloads into custom subfolders (e.g. Real, Anime)
- **High Quality** — Fetches the best available quality (original images, highest bitrate videos)
- **Lightbox Preview** — Click any thumbnail to preview in a lightbox overlay
- **Filter & View** — Filter by type (Photo/Video) or status (Downloaded/Not Downloaded); toggle full-view mode

## Screenshots

> Coming soon

## Installation

### From Source

1. Clone the repository:
   ```bash
   git clone https://github.com/Nijika-jia/X-Media-Downloader.git
   cd X-Media-Downloader
   ```

2. Install dependencies and build:
   ```bash
   npm install
   npm run build
   ```

3. Load the extension in Chrome:
   - Open `chrome://extensions/`
   - Enable **Developer mode** (top right)
   - Click **Load unpacked**
   - Select the `dist/` folder

## Usage

1. Go to `x.com` or `twitter.com`
2. Browse your timeline — the extension automatically captures media
3. Click the extension icon in the toolbar to open the Side Panel
4. Filter, select, and download the media you want

## Development

```bash
# Install dependencies
npm install

# Development mode (watch for changes)
npm run dev

# Production build
npm run build
```

## Project Structure

```
src/
├── background/                # Service worker
│   ├── Application.js         # Application singleton (lifecycle & message routing)
│   ├── Bootstrap.js           # Bootstrap (initialization & event binding)
│   └── services/              # Service layer
│       ├── AbstractService.js         # Base service class
│       ├── AbstractPortService.js     # Port-based service base class
│       ├── ServiceProvider.js         # Dependency injection container
│       ├── DownloadService.js         # Download management + history check
│       ├── HistoryService.js          # Download history (chrome.storage.local)
│       ├── MediaService.js            # Media event broadcasting (Port)
│       ├── SettingService.js          # Settings management
│       └── TabService.js              # Tab management
├── content/                   # Content script
│   ├── index.js               # Media interception & lightbox trigger
│   ├── Lightbox.js            # Lightbox overlay module
│   └── content.css
├── inject/                    # Injected script (MAIN world)
│   └── index.js               # Intercepts fetch/XHR for media URLs
├── sidepanel/                 # Side panel UI
│   ├── index.js               # SidePanelApp controller
│   ├── MediaStore.js          # State management (data layer)
│   ├── MediaGridRenderer.js   # Grid rendering (view layer)
│   ├── constants.js           # UI constants & icons
│   ├── sidepanel.html
│   └── sidepanel.css
├── popup/                     # Popup page
├── config/                    # Configuration
│   └── default.js             # Default settings
├── modules/                   # Shared modules
│   └── Extension/
│       └── browser.js         # Browser API adapter
└── errors/
    └── RuntimeError.js        # Custom error class
```

## Architecture

The project follows a **service-oriented architecture** inspired by [webextension-pixiv-toolkit](https://github.com/leoding86/webextension-pixiv-toolkit):

- **Application Singleton** — Central controller managing service lifecycle and message routing
- **Bootstrap Pattern** — Handles initialization order and event binding
- **Service Provider (DI)** — Lazy-creates and injects services on demand
- **Port Communication** — Long-lived connections for real-time media event broadcasting
- **Data-View Separation** — `MediaStore` (state) + `MediaGridRenderer` (view) in the sidepanel

## Tech Stack

- Chrome Extension Manifest V3
- Vanilla JavaScript (ES6+)
- Webpack 5
- Chrome APIs: `sidePanel`, `downloads`, `storage`, `runtime`

## License

[MIT](LICENSE)
