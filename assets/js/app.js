/**
 * Comda Academy Portal - main application logic.
 *
 * Performance principles (vs. the original app):
 *   1. No mass preload. We only load a single thumbnail per product for the library grid.
 *   2. `pages` count lives in products.json so we don't have to probe with 100 HTTP requests.
 *   3. Book viewer only loads current page + 2 adjacent pages. The rest load on demand.
 *   4. Images are WebP at 1920x1080 (~150-300KB each).
 *   5. Service worker caches each presentation on first view -> works offline afterwards.
 */

(() => {
  'use strict';

  // ---------- Config ----------
  const DATA_URL = 'data/products.json';
  const PRESENTATIONS_ROOT = 'data/presentations';
  const PRELOAD_NEIGHBOURS = 2; // pages to preload on each side of current

  // ---------- State ----------
  let data = null;
  let currentLang = (localStorage.getItem('academy.lang')) || 'he';
  let swiper = null;
  let activeProduct = null;

  // ---------- DOM ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  // ---------- Boot ----------
  document.addEventListener('DOMContentLoaded', boot);

  async function boot() {
    wireHeader();
    wireViewer();
    registerServiceWorker();

    try {
      data = await fetchJson(`${DATA_URL}?t=${Date.now()}`); // bust CDN cache, SW handles local caching
    } catch (e) {
      renderError('לא הצלחנו לטעון את קטלוג המוצרים.<br>' + (e.message || ''));
      return;
    }

    applyLang(currentLang);
    renderLibrary();
  }

  // ---------- Header actions ----------
  function wireHeader() {
    const langBtn = $('#lang-btn');
    if (langBtn) langBtn.addEventListener('click', toggleLang);

    // Keep the admin entry as a hidden long-press on the logo (unchanged UX from original).
    const logo = $('#logo');
    if (logo) {
      let timer = null;
      const start = () => {
        clearTimeout(timer);
        timer = setTimeout(() => { window.location.href = 'admin.html'; }, 2500);
      };
      const cancel = () => clearTimeout(timer);
      logo.addEventListener('mousedown',  start);
      logo.addEventListener('touchstart', start, { passive: true });
      logo.addEventListener('mouseup',    cancel);
      logo.addEventListener('mouseleave', cancel);
      logo.addEventListener('touchend',   cancel);
      logo.addEventListener('touchcancel', cancel);
    }
  }

  function toggleLang() {
    currentLang = currentLang === 'he' ? 'en' : 'he';
    localStorage.setItem('academy.lang', currentLang);
    applyLang(currentLang);
    renderLibrary();
  }

  function applyLang(lang) {
    document.documentElement.lang = lang;
    document.documentElement.dir  = lang === 'he' ? 'rtl' : 'ltr';
    const langBtn = $('#lang-btn');
    if (langBtn) langBtn.textContent = lang === 'he' ? 'EN' : 'HE';
    const closeBtn = $('#btn-close');
    if (closeBtn && data) closeBtn.textContent = data.ui.close[lang];
  }

  // ---------- Library rendering ----------
  function renderLibrary() {
    const container = $('#sections-container');
    container.innerHTML = '';

    const catsSorted = [...data.categories].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));

    let rendered = 0;
    for (const cat of catsSorted) {
      const products = data.products.filter(p => p.cat === cat.key);
      if (!products.length) continue;
      rendered++;

      const section = document.createElement('section');
      section.className = 'category-section';
      section.style.marginBottom = '3.5rem';

      const title = document.createElement('h2');
      title.className = 'section-title text-xl';
      title.style.color = 'var(--neon-blue)';
      title.style.fontWeight = '700';
      title.style.textTransform = 'uppercase';
      title.textContent = cat[currentLang] || cat.he;
      section.appendChild(title);

      const grid = document.createElement('div');
      grid.className = 'product-grid';
      for (const product of products) grid.appendChild(buildCard(product));
      section.appendChild(grid);

      container.appendChild(section);
    }

    if (rendered === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <h2>${currentLang === 'he' ? 'הקטלוג ריק' : 'Catalog is empty'}</h2>
          <p class="muted">${currentLang === 'he'
            ? 'היכנס לדף הניהול (לחיצה ארוכה על הלוגו) כדי להוסיף מוצרים.'
            : 'Open the admin page (long-press the logo) to add products.'}</p>
        </div>`;
    }
  }

  function buildCard(product) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'glass-card product-card';
    card.setAttribute('aria-label', currentLang === 'he' ? product.nameHe : product.nameEn);

    const thumb = document.createElement('div');
    thumb.className = 'thumb';

    const pagesForLang = product.pages?.[currentLang] ?? 0;
    if (pagesForLang > 0) {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.alt = '';
      // First slide used as cover (common convention).
      img.src = `${PRESENTATIONS_ROOT}/${product.folder}/${currentLang}/page-1.webp`;
      img.onerror = () => {
        thumb.innerHTML = `<div class="no-cover">${currentLang === 'he' ? 'אין כריכה' : 'No cover'}</div>`;
      };
      thumb.appendChild(img);
    } else {
      const nocover = document.createElement('div');
      nocover.className = 'no-cover';
      nocover.textContent = currentLang === 'he' ? 'טרם הועלתה מצגת' : 'Not uploaded yet';
      thumb.appendChild(nocover);
    }

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = currentLang === 'he' ? product.nameHe : product.nameEn;

    card.appendChild(thumb);
    card.appendChild(name);
    card.addEventListener('click', () => openBook(product));
    return card;
  }

  function renderError(html) {
    $('#sections-container').innerHTML = `
      <div class="empty-state">
        <h2>${currentLang === 'he' ? 'שגיאה' : 'Error'}</h2>
        <p>${html}</p>
      </div>`;
  }

  // ---------- Viewer ----------
  function wireViewer() {
    $('#btn-close')?.addEventListener('click', closeBook);

    // ESC to close the viewer.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && $('#book-viewer').classList.contains('open')) closeBook();
    });
  }

  function openBook(product) {
    activeProduct = product;
    const pages = product.pages?.[currentLang] ?? 0;
    const viewer = $('#book-viewer');
    const wrapper = $('#viewer-wrapper');
    const titleEl = $('#viewer-title');

    titleEl.textContent = currentLang === 'he' ? product.nameHe : product.nameEn;
    wrapper.innerHTML = '';

    if (pages === 0) {
      const slide = document.createElement('div');
      slide.className = 'swiper-slide';
      slide.innerHTML = `<div class="slide-loading">${data.ui.noSlides[currentLang]}</div>`;
      wrapper.appendChild(slide);
    } else {
      for (let i = 1; i <= pages; i++) wrapper.appendChild(buildSlide(product, i));
    }

    viewer.classList.add('open');
    document.body.style.overflow = 'hidden';

    // (Re)initialise Swiper.
    if (swiper) { swiper.destroy(true, true); swiper = null; }
    swiper = new Swiper('.mySwiper', {
      effect: 'creative',
      speed: 600,
      grabCursor: true,
      keyboard: { enabled: true },
      creativeEffect: {
        prev: {
          shadow: true,
          translate: [currentLang === 'he' ? '120%' : '-120%', 0, -500],
          rotate: [0, 0, currentLang === 'he' ? -8 : 8]
        },
        next: {
          shadow: true,
          translate: [currentLang === 'he' ? '-120%' : '120%', 0, -500],
          rotate: [0, 0, currentLang === 'he' ? 8 : -8]
        }
      },
      pagination: {
        el: '.swiper-pagination',
        dynamicBullets: true,
        clickable: true
      },
      navigation: {
        nextEl: '.swiper-button-next',
        prevEl: '.swiper-button-prev'
      }
    });

    // Initial load + neighbour preload.
    loadSlideImages(0);
    swiper.on('slideChangeTransitionStart', () => loadSlideImages(swiper.activeIndex));
    swiper.on('slideChange',                () => loadSlideImages(swiper.activeIndex));
  }

  function buildSlide(product, pageNum) {
    const slide = document.createElement('div');
    slide.className = 'swiper-slide';
    slide.dataset.page = String(pageNum);
    slide.dataset.src = `${PRESENTATIONS_ROOT}/${product.folder}/${currentLang}/page-${pageNum}.webp`;
    slide.innerHTML = `<div class="slide-loading">${data.ui.loading[currentLang]}</div>`;
    return slide;
  }

  /**
   * Make sure slides around `idx` have their <img> injected.
   * Slides outside the window stay as placeholders. Already-loaded slides are skipped.
   */
  function loadSlideImages(idx) {
    const wrapper = $('#viewer-wrapper');
    const slides = wrapper.children;
    if (!slides.length) return;

    const min = Math.max(0, idx - PRELOAD_NEIGHBOURS);
    const max = Math.min(slides.length - 1, idx + PRELOAD_NEIGHBOURS);

    for (let i = min; i <= max; i++) {
      const slide = slides[i];
      if (!slide || slide.dataset.loaded === '1') continue;
      const src = slide.dataset.src;
      if (!src) continue;
      slide.dataset.loaded = '1';

      const img = new Image();
      img.decoding = 'async';
      img.alt = '';
      img.onload = () => {
        slide.innerHTML = '';
        img.style.opacity = '0';
        img.style.transition = 'opacity 250ms ease';
        slide.appendChild(img);
        requestAnimationFrame(() => { img.style.opacity = '1'; });
      };
      img.onerror = () => {
        slide.innerHTML =
          `<div class="slide-loading" style="color:#f87171">` +
          (currentLang === 'he' ? 'שגיאה בטעינת העמוד' : 'Failed to load page') +
          `</div>`;
      };
      img.src = src;
    }
  }

  function closeBook() {
    const viewer = $('#book-viewer');
    viewer.classList.remove('open');
    document.body.style.overflow = '';
    if (swiper) { swiper.destroy(true, true); swiper = null; }
    activeProduct = null;
  }

  // ---------- Utils ----------
  async function fetchJson(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    // Register at page load (non-blocking).
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js', { scope: './' })
        .catch(err => console.warn('SW registration failed:', err));
    });
  }
})();
