export function injectLightbox() {
  if (document.getElementById('x-media-lightbox-root')) return;

  const lightboxRoot = document.createElement('div');
  lightboxRoot.id = 'x-media-lightbox-root';
  lightboxRoot.className = 'x-lightbox';
  lightboxRoot.innerHTML = `
    <span class="x-lightbox-close">&times;</span>
    <img class="x-lightbox-img" id="x-lightbox-img">
    <video class="x-lightbox-video" id="x-lightbox-video" controls></video>
  `;

  document.body.appendChild(lightboxRoot);

  lightboxRoot.querySelector('.x-lightbox-close').addEventListener('click', closeLightbox);
  lightboxRoot.addEventListener('click', (e) => {
    if (e.target === lightboxRoot) closeLightbox();
  });
}

export function openLightbox(item) {
  let lightboxRoot = document.getElementById('x-media-lightbox-root');
  if (!lightboxRoot) {
    injectLightbox();
    lightboxRoot = document.getElementById('x-media-lightbox-root');
  }

  const img = lightboxRoot.querySelector('#x-lightbox-img');
  const video = lightboxRoot.querySelector('#x-lightbox-video');

  if (item.type === 'video' || item.type === 'animated_gif') {
    img.style.display = 'none';
    video.style.display = 'block';
    video.src = item.url;
  } else {
    video.style.display = 'none';
    video.pause();
    img.style.display = 'block';
    img.src = item.url;
  }

  lightboxRoot.classList.add('active');
}

export function closeLightbox() {
  const lightboxRoot = document.getElementById('x-media-lightbox-root');
  if (lightboxRoot) {
    lightboxRoot.classList.remove('active');
    lightboxRoot.querySelector('video').pause();
  }
}
