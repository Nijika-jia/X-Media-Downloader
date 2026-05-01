(function () {
  console.log('X-Media Downloader: Inject script loaded');

  // Helper to safely extract media from deep JSON
  function findMedia(obj, found = []) {
    if (!obj || typeof obj !== 'object') return found;

    if (obj.extended_entities && obj.extended_entities.media) {
      obj.extended_entities.media.forEach(media => {
        found.push(formatMedia(media));
      });
    } else if (obj.media_url_https) {
      // Sometimes media is direct
      // found.push(formatMedia(obj)); 
      // Note: usually covered by extended_entities, avoid duplicates
    }

    // Recursive search
    for (const key in obj) {
      findMedia(obj[key], found);
    }
    return found;
  }

  function formatMedia(media) {
    let type = media.type;
    let url = media.media_url_https;
    let variants = [];

    if (type === 'video' || type === 'animated_gif') {
      if (media.video_info && media.video_info.variants) {
        // Get highest bitrate
        const validVariants = media.video_info.variants
          .filter(v => v.content_type === 'video/mp4')
          .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
        
        if (validVariants.length > 0) {
          url = validVariants[0].url;
          variants = validVariants;
        }
      }
    }

    // Try to get high res image
    if (type === 'photo') {
        if (!url.includes('name=orig')) {
            url = url.replace(/name=[a-z0-9]+/, 'name=orig');
            if (!url.includes('name=orig')) {
                 url += '?name=orig';
            }
        }
    }

    return {
      id: media.id_str,
      type: type,
      url: url,
      thumb: media.media_url_https,
      variants: variants,
      timestamp: Date.now()
    };
  }

  // Hook fetch
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch(...args);
    const clone = response.clone();
    
    clone.json().then(data => {
      const mediaItems = findMedia(data);
      if (mediaItems.length > 0) {
        window.dispatchEvent(new CustomEvent('x-media-intercepted', {
          detail: mediaItems
        }));
      }
    }).catch(err => {
      // Not JSON or error parsing
    });

    return response;
  };

  // Hook XHR
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._url = url;
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    this.addEventListener('load', function () {
      if (this.responseText) {
        try {
          const data = JSON.parse(this.responseText);
          const mediaItems = findMedia(data);
          if (mediaItems.length > 0) {
            window.dispatchEvent(new CustomEvent('x-media-intercepted', {
              detail: mediaItems
            }));
          }
        } catch (e) {
            // Ignore
        }
      }
    });
    return originalSend.apply(this, arguments);
  };

})();
