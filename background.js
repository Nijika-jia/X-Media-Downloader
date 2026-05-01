// background.js

// Allow clicking the extension icon to open the side panel
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

// Listen for messages from content scripts and forward to side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // 1. Download Action
    if (message.action === 'download_media') {
        const items = message.items;
        items.forEach((item) => {
            let ext = 'jpg';
            if (item.type === 'video' || item.type === 'animated_gif') {
                ext = 'mp4';
            }
            // Simple filename
            const filename = `X_Downloads/x_${item.id}.${ext}`;
            
            chrome.downloads.download({
                url: item.url,
                filename: filename,
                conflictAction: 'uniquify'
            });
        });
    }

    // 2. Media Intercepted -> Forward to Side Panel
    if (message.action === 'media_intercepted') {
        // We can save to storage to ensure persistence
        // Or just broadcast to runtime (Side Panel will pick it up if open)
        chrome.runtime.sendMessage({
            action: 'media_intercepted_forward',
            items: message.items,
            tabId: sender.tab.id
        }).catch(() => {
            // Side panel might be closed, ignore error
        });
    }
});
