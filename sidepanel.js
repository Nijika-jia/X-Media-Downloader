// sidepanel.js
let mediaMap = new Map();
let mediaGrid = document.getElementById('x-media-grid');
let selectedIds = new Set();
let selectAllBtn = document.getElementById('x-select-all-btn');
let downloadSelectedBtn = document.getElementById('x-download-selected-btn');
let isSelectAllActive = false;
let lastSelectedId = null; // Track last selected item for Shift-click

// Filters and View
let currentFilter = 'all'; // all, photo, video
let isFullView = false;
const filterBtns = document.querySelectorAll('.x-filter-btn');
const fullViewToggle = document.getElementById('x-full-view-toggle');

// Initialize Filter Buttons
filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        // Update active state
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Update filter
        currentFilter = btn.dataset.filter;
        renderGrid();
    });
});

// Initialize View Toggle
fullViewToggle.addEventListener('change', (e) => {
    isFullView = e.target.checked;
    if (isFullView) {
        document.body.classList.add('full-view-mode');
    } else {
        document.body.classList.remove('full-view-mode');
    }
});

// Listen for messages from background (forwarded from content scripts)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'media_intercepted_forward') {
        const items = message.items;
        const tabId = message.tabId;
        
        let newItems = false;
        items.forEach(item => {
            if (!mediaMap.has(item.id)) {
                // Attach tabId so we know where to show lightbox
                item._tabId = tabId;
                mediaMap.set(item.id, item);
                newItems = true;
            }
        });
        
        if (newItems) {
            renderGrid();
            document.getElementById('x-empty-state').style.display = 'none';
        }
    }
});

function renderGrid() {
    mediaGrid.innerHTML = '';
    const items = Array.from(mediaMap.values());
    
    // Filter items
    const filteredItems = items.filter(item => {
        if (currentFilter === 'all') return true;
        if (currentFilter === 'photo') return item.type === 'photo';
        if (currentFilter === 'video') return item.type === 'video' || item.type === 'animated_gif';
        if (currentFilter === 'downloaded') return item.downloaded;
        if (currentFilter === 'not_downloaded') return !item.downloaded;
        return true;
    });

    // Sort by insertion order (newest last in Map). We want newest at top.
    filteredItems.reverse().forEach(item => {
        addMediaToGrid(item, false); // false = append (since we reversed list)
    });
    
    updateCount();
    updateSelectionUI();
    
    if (filteredItems.length === 0 && mediaMap.size > 0) {
        // Show something? or just empty grid
    }
}

function addMediaToGrid(item, prepend = true) {
    const div = document.createElement('div');
    div.className = 'x-media-item';
    if (selectedIds.has(item.id)) {
        div.classList.add('selected');
    }
    div.dataset.id = item.id;
    
    // Use SVGs for better look
    const iconSelect = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10"></circle></svg>`;
    const iconCheck = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="3" fill="none"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    const iconDownload = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;

    const isSelected = selectedIds.has(item.id);
    const selectIcon = isSelected ? iconCheck : iconSelect;
    const selectTitle = isSelected ? '取消选择' : '选择';

    div.innerHTML = `
        <div class="x-media-thumb-container">
            <img src="${item.thumb}" loading="lazy">
        </div>
        <span class="x-media-type">${item.type}</span>
        <div class="x-item-btn x-item-select-btn ${isSelected ? 'selected' : ''}" title="${selectTitle}">${selectIcon}</div>
        <div class="x-item-btn x-item-download-btn" title="下载此项">${iconDownload}</div>
    `;
    
    // Click on thumbnail -> Show Lightbox in Tab
    const thumbContainer = div.querySelector('.x-media-thumb-container');
    thumbContainer.addEventListener('click', (e) => {
        e.stopPropagation();
        // Send message back to the tab where this media was found
        if (item._tabId) {
            chrome.tabs.sendMessage(item._tabId, {
                action: 'show_lightbox',
                item: item
            }).catch(() => {
                // If tab is closed, maybe open in new tab?
                window.open(item.url, '_blank');
            });
        } else {
             window.open(item.url, '_blank');
        }
    });

    // Select Button Logic
    const selectBtn = div.querySelector('.x-item-select-btn');
    selectBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        
        // Handle Shift + Click Range Selection
        // Note: For range selection to work visually correctly with filters, 
        // we should only consider currently visible items.
        if (e.shiftKey && lastSelectedId) {
            // Get currently visible items
            const visibleItems = Array.from(document.querySelectorAll('.x-media-item'));
            const lastVisible = visibleItems.find(el => el.dataset.id === lastSelectedId);
            
            if (lastVisible) {
                const lastIdx = visibleItems.indexOf(lastVisible);
                const currIdx = visibleItems.indexOf(div); // div is the current element

                if (lastIdx !== -1 && currIdx !== -1) {
                    const start = Math.min(lastIdx, currIdx);
                    const end = Math.max(lastIdx, currIdx);
                    
                    const shouldSelect = !selectedIds.has(item.id); 

                    for (let i = start; i <= end; i++) {
                        setItemSelected(visibleItems[i], shouldSelect);
                    }
                    
                    lastSelectedId = item.id;
                    updateSelectionUI();
                    return;
                }
            }
        }

        const isSelected = selectedIds.has(item.id);
        setItemSelected(div, !isSelected);
        
        // Update lastSelectedId only on manual interaction
        lastSelectedId = item.id;
        
        updateSelectionUI();
    });

    // Download Button Logic
    const dlBtn = div.querySelector('.x-item-download-btn');
    // Restore downloaded state
    if (item.downloaded) {
        dlBtn.classList.add('downloaded');
        dlBtn.innerHTML = iconCheck;
        dlBtn.title = '已下载';
    }

    dlBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (dlBtn.classList.contains('downloaded')) {
            return;
        }
        downloadItems([item]);
        item.downloaded = true; // Mark as downloaded in data model
        dlBtn.classList.add('downloaded');
        dlBtn.innerHTML = iconCheck;
        dlBtn.title = '已下载';
    });

    if (prepend) {
        mediaGrid.prepend(div);
    } else {
        mediaGrid.appendChild(div);
    }
}

function setItemSelected(div, selected) {
    const id = div.dataset.id;
    if (selected) {
        selectedIds.add(id);
    } else {
        selectedIds.delete(id);
    }
    div.classList.toggle('selected', selected);
    const btn = div.querySelector('.x-item-select-btn');
    if (btn) {
        // Icons
        const iconSelect = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10"></circle></svg>`;
        const iconCheck = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="3" fill="none"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        
        btn.innerHTML = selected ? iconCheck : iconSelect;
        btn.title = selected ? '取消选择' : '选择';
        btn.classList.toggle('selected', selected);
    }
}

function updateSelectionUI() {
    const allSelected = mediaMap.size > 0 && selectedIds.size === mediaMap.size;
    isSelectAllActive = allSelected;
    selectAllBtn.textContent = allSelected ? '取消全选' : '全选';
    downloadSelectedBtn.disabled = selectedIds.size === 0;
}

selectAllBtn.addEventListener('click', () => {
    const allSelected = mediaMap.size > 0 && selectedIds.size === mediaMap.size;
    const shouldSelect = !allSelected;
    document.querySelectorAll('.x-media-item').forEach(div => {
        setItemSelected(div, shouldSelect);
    });
    updateSelectionUI();
});

downloadSelectedBtn.addEventListener('click', () => {
    if (selectedIds.size === 0) return;
    const items = [];
    selectedIds.forEach(id => {
        const item = mediaMap.get(id);
        if (item) items.push(item);
    });
    if (items.length === 0) return;
    downloadItems(items);
    items.forEach(item => {
        item.downloaded = true; // Mark as downloaded in data model
        const div = mediaGrid.querySelector(`[data-id="${item.id}"]`);
        if (!div) return;
        const dlBtn = div.querySelector('.x-item-download-btn');
        if (dlBtn) {
            dlBtn.classList.add('downloaded');
            // Icons
            const iconCheck = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="3" fill="none"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
            dlBtn.innerHTML = iconCheck;
            dlBtn.title = '已下载';
        }
        setItemSelected(div, false);
    });
    updateSelectionUI();
});

function updateCount() {
    const items = Array.from(mediaMap.values());
    const total = items.length;
    const photos = items.filter(i => i.type === 'photo').length;
    const videos = items.filter(i => i.type === 'video' || i.type === 'animated_gif').length;
    const downloaded = items.filter(i => i.downloaded).length;
    const notDownloaded = total - downloaded;
    
    document.getElementById('x-count').innerHTML = `<span style="font-size: 14px; margin-left: 4px;">(${total})</span> <span style="font-size: 12px; font-weight: normal; color: #71767b; margin-left: 4px;">🖼️${photos} 🎬${videos} ✅${downloaded} ⭕${notDownloaded}</span>`;
}

document.getElementById('x-clear-btn').addEventListener('click', () => {
    mediaMap.clear();
    mediaGrid.innerHTML = '';
    selectedIds.clear();
    updateCount();
    updateSelectionUI();
    document.getElementById('x-empty-state').style.display = 'block';
});

function downloadItems(items) {
    chrome.runtime.sendMessage({
        action: 'download_media',
        items: items
    });
}
