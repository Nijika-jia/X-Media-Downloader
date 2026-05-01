// content.js
console.log('X-Media Downloader: Content script loaded');

// Initialize
(async () => {
    // Listen for media from inject.js
    window.addEventListener('x-media-intercepted', (e) => {
        const items = e.detail;
        if (items && items.length > 0) {
            // Forward to background -> Side Panel
            chrome.runtime.sendMessage({
                action: 'media_intercepted',
                items: items
            });
        }
    });

    // Inject Lightbox container into page
    injectLightbox();

    // Listen for commands from Side Panel (Show Lightbox)
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'show_lightbox') {
            openLightbox(message.item);
        }
    });
})();

let lightboxRoot = null;

function injectLightbox() {
    if (document.getElementById('x-media-lightbox-root')) return;

    lightboxRoot = document.createElement('div');
    lightboxRoot.id = 'x-media-lightbox-root';
    lightboxRoot.className = 'x-lightbox';
    lightboxRoot.innerHTML = `
        <span class="x-lightbox-close">&times;</span>
        <img class="x-lightbox-img" id="x-lightbox-img">
        <video class="x-lightbox-video" id="x-lightbox-video" controls></video>
    `;
    
    document.body.appendChild(lightboxRoot);

    // Events
    lightboxRoot.querySelector('.x-lightbox-close').addEventListener('click', closeLightbox);
    lightboxRoot.addEventListener('click', (e) => {
        if (e.target === lightboxRoot) closeLightbox();
    });
}

function openLightbox(item) {
    if (!lightboxRoot) injectLightbox();

    const img = lightboxRoot.querySelector('#x-lightbox-img');
    const video = lightboxRoot.querySelector('#x-lightbox-video');
    
    if (item.type === 'video' || item.type === 'animated_gif') {
        img.style.display = 'none';
        video.style.display = 'block';
        video.src = item.url;
        // video.play(); // Optional auto-play
    } else {
        video.style.display = 'none';
        video.pause();
        img.style.display = 'block';
        img.src = item.url;
    }
    
    lightboxRoot.classList.add('active');
}

function closeLightbox() {
    if (lightboxRoot) {
        lightboxRoot.classList.remove('active');
        lightboxRoot.querySelector('video').pause();
    }
}
