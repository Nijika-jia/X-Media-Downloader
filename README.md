# X-Media Downloader Pro

A Chrome Extension to download media (Images & Videos) from X.com (Twitter).

## Features
- **Auto-Capture**: Automatically detects media as you browse your timeline.
- **Sidebar UI**: A convenient sidebar to view and select media.
- **Batch Download**: Download multiple items at once.
- **High Quality**: Tries to fetch the best available quality (Original images, Highest bitrate videos).
- **Pro Version**: Mock payment integration (requires activation).

## Installation

1. Open Chrome and go to `chrome://extensions/`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select this folder (`x-image-picker`).

## Usage

1. Go to `x.com` or `twitter.com`.
2. Browse your timeline. The extension will automatically capture media.
3. Click the "X" toggle button on the right edge of the screen to open the sidebar.
4. Select images/videos you want to download.
5. Click **Download Selected**.

## Activation (Mock)

1. Click the "Gear" (Settings) icon in the sidebar header.
2. Enter a license key starting with `PRO-` (e.g., `PRO-DEMO`, `PRO-2025`).
3. Click **Activate**.
4. You can now use the Batch Download feature.

## Technical Details

- Uses `inject.js` to intercept network requests (`fetch` & `XHR`) to retrieve high-quality media URLs directly from the API responses.
- Uses `content.js` to render a Shadow DOM-like sidebar (currently direct DOM injection for simplicity).
- Uses `background.js` to handle file downloads via `chrome.downloads` API.
