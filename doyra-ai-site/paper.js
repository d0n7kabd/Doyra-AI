// The paper, readable on the page itself.
// PDF.js (vendor/pdfjs, Apache-2.0) is loaded only when the reader comes near
// the screen; each page is drawn when it scrolls into view, so the rest of the
// landing page never waits for it. If PDF.js can't run, the browser's own PDF
// viewer is used instead.
(() => {
  const root = document.getElementById('reader');
  if (!root) return;
  const SRC = root.dataset.src;
  const scroller = root.querySelector('.reader-scroll');
  const pagesEl = root.querySelector('.reader-pages');
  const $page = root.querySelector('[data-r-page]');
  const $total = root.querySelector('[data-r-total]');
  const $zoom = root.querySelector('[data-r-zoom]');
  const bar = root.querySelector('.reader-progress i');
  const ZOOMS = [0.6, 0.75, 1, 1.25, 1.5, 2];
  const MAX_W = 860;
  let pdf = null, zi = 2, pages = [], current = 1, started = false, aspect = 792 / 612;
  let pending = 0, pendingT = 0; // page a button asked for, while the smooth scroll runs

  const loadScript = (src) => new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });

  async function start() {
    if (started) return;
    started = true;
    root.classList.add('is-loading');
    try {
      await loadScript('vendor/pdfjs/pdf.min.js');
      const lib = window.pdfjsLib;
      lib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
      pdf = await lib.getDocument(SRC).promise;
      const first = await pdf.getPage(1);
      const vp = first.getViewport({ scale: 1 });
      aspect = vp.height / vp.width;
      $total.textContent = pdf.numPages;
      build();
      root.classList.remove('is-loading');
      root.classList.add('is-ready');
    } catch (e) {
      console.error(e);
      fallback();
    }
  }

  function fallback() {
    root.classList.remove('is-loading');
    root.classList.add('is-fallback');
    pagesEl.innerHTML = `<iframe class="reader-frame" src="${SRC}#view=FitH" title="Teaching a Machine the Doira (PDF)"></iframe>`;
  }

  const pad = () => parseFloat(getComputedStyle(pagesEl).paddingLeft) || 0;
  const pageWidth = () => Math.round(Math.min(scroller.clientWidth - pad() * 2, MAX_W) * ZOOMS[zi]);

  let io;
  function build() {
    pagesEl.innerHTML = '';
    pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const el = document.createElement('div');
      el.className = 'reader-page';
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', `Page ${n} of ${pdf.numPages}`);
      el.innerHTML = `<span class="reader-page-n">${n}</span>`;
      pagesEl.appendChild(el);
      pages.push({ el, n, drawn: 0, busy: false, seen: false });
    }
    size();
    io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        const p = pages[+e.target.dataset.i];
        p.seen = e.isIntersecting;
        if (p.seen) draw(p);
      });
    }, { root: scroller, rootMargin: '900px 0px' });
    pages.forEach((p, i) => { p.el.dataset.i = i; io.observe(p.el); });
    onScroll();
  }

  function size() {
    const w = pageWidth();
    pages.forEach((p) => { p.el.style.width = `${w}px`; p.el.style.height = `${Math.round(w * aspect)}px`; });
    $zoom.textContent = `${Math.round(ZOOMS[zi] * 100)}%`;
  }

  async function draw(p) {
    const w = pageWidth();
    if (p.drawn === w || p.busy) return;
    p.busy = true;
    try {
      const page = await pdf.getPage(p.n);
      const base = page.getViewport({ scale: 1 });
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const vp = page.getViewport({ scale: (w / base.width) * dpr });
      const c = document.createElement('canvas');
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      await page.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: vp }).promise;
      p.el.replaceChildren(c);
      p.el.classList.add('drawn');
      p.drawn = w;
    } catch (e) {
      console.error(e);
    }
    p.busy = false;
    if (p.seen && p.drawn !== pageWidth()) draw(p); // zoomed or resized while drawing
  }

  // ---- position: which page is being read, and how far through
  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      if (!pages.length) return;
      const mark = scroller.scrollTop + scroller.clientHeight * 0.35;
      let n = 1;
      for (const p of pages) { if (p.el.offsetTop <= mark) n = p.n; else break; }
      if (!pending) { current = n; $page.textContent = n; }
      const max = scroller.scrollHeight - scroller.clientHeight;
      bar.style.transform = `scaleX(${max > 0 ? scroller.scrollTop / max : 0})`;
    });
  }
  scroller.addEventListener('scroll', onScroll, { passive: true });

  function goTo(n, smooth = true) {
    n = Math.max(1, Math.min(pages.length, n));
    current = n;
    $page.textContent = n;
    pending = n;
    clearTimeout(pendingT);
    pendingT = setTimeout(() => { pending = 0; }, 900);
    const top = pages[n - 1].el.offsetTop - pad();
    scroller.scrollTo({ top, behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' });
  }

  function setZoom(next) {
    if (next < 0 || next >= ZOOMS.length || next === zi) return;
    const keep = current;
    const p = pages[keep - 1];
    const within = p ? (scroller.scrollTop - p.el.offsetTop) / p.el.offsetHeight : 0;
    zi = next;
    size();
    if (p) scroller.scrollTop = p.el.offsetTop + within * p.el.offsetHeight;
    pages.forEach((q) => { if (q.seen) draw(q); });
    onScroll();
  }

  // ---- toolbar
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-r]');
    if (!b || !pdf) return;
    const act = b.dataset.r;
    if (act === 'prev') goTo(current - 1);
    if (act === 'next') goTo(current + 1);
    if (act === 'out') setZoom(zi - 1);
    if (act === 'in') setZoom(zi + 1);
    if (act === 'full') toggleFull();
  });
  scroller.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); goTo(current + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(current - 1); }
  });

  // full screen: the real API where there is one, a fixed overlay elsewhere (iPhone)
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
  function toggleFull() {
    const keep = current;
    if (fsEl()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else if (root.requestFullscreen || root.webkitRequestFullscreen) (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
    else { root.classList.toggle('is-full'); document.body.classList.toggle('reader-open', root.classList.contains('is-full')); relayout(keep); }
  }
  ['fullscreenchange', 'webkitfullscreenchange'].forEach((ev) => document.addEventListener(ev, () => {
    root.classList.toggle('is-fs', fsEl() === root);
    relayout(current);
  }));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && root.classList.contains('is-full')) toggleFull();
  });

  // ---- size changes (window, full screen)
  function relayout(keep) {
    if (!pages.length) return;
    requestAnimationFrame(() => {
      size();
      goTo(keep, false);
      pages.forEach((q) => { if (q.seen) draw(q); });
    });
  }
  let lastW = 0, rt = 0;
  new ResizeObserver(() => {
    const w = scroller.clientWidth;
    if (!pages.length || Math.abs(w - lastW) < 2) { lastW = w; return; }
    lastW = w;
    clearTimeout(rt);
    rt = setTimeout(() => relayout(current), 150);
  }).observe(scroller);

  // ---- start when the reader comes near the screen
  if ('IntersectionObserver' in window) {
    const near = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { near.disconnect(); start(); }
    }, { rootMargin: '1200px 0px' });
    near.observe(root);
  } else start();
})();
