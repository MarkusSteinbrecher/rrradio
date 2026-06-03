// ══════════════════════════════════════════════════════════
// TUNE IN — the receiver.
// Scrolling tunes a frequency. Each "station" sits at a fixed
// frequency; between them the broadcast text dissolves into
// static and the next station resolves into focus.
// ══════════════════════════════════════════════════════════

// Side-effect import: landdots.js assigns window.LAND_DOTS (read by the
// globe renderer). Importing it here makes Vite bundle it ahead of this
// module so the global is set before tuneIn() runs.
import './landdots.js';

(function tuneIn() {
  'use strict';

  // Embedded in the phone frame? Hide chrome, add safe-area insets.
  if (/[?&]embed/.test(location.search)) {
    document.body.classList.add('is-embed');
  }

  // ── Station data: each is one fixed frequency on the dial. ──
  const STATIONS = [
    {
      tag: 'WHY',
      title: 'The world doesn\u2019t need another radio app.',
      body: 'It needs a good one. Free, ad-free, good \u2014 every other app makes you pick two. This one doesn\u2019t.',
      diagram: 'trilemma',
    },
    {
      tag: 'WORLDWIDE',
      title: 'Every station, everywhere.',
      body: 'Tens of thousands of live streams from every corner of the world, constantly updated. Open source, maintained at rrradio.org \u2014 and if one\u2019s missing, tell us and we\u2019ll add it.',
      diagram: 'globe',
    },
    {
      tag: 'FEATURES',
      title: 'A few things it does well.',
      body: '',
      features: [
        'Browse the rrradio.org catalog',
        'Save favorites and custom lists',
        'Wake to radio, drift off on a sleep timer',
        'Make it yours \u2014 themes, light or dark',
        'Steer it from your Apple\u00a0Watch',
      ],
      carousel: [
        { dev: 'phone', src: new URL('./screen-browse.webp', import.meta.url).href, label: 'iPhone \u00b7 Browse' },
        { dev: 'phone', src: new URL('./screen-now-playing.webp', import.meta.url).href, label: 'iPhone \u00b7 Now Playing' },
        { dev: 'phone', src: new URL('./screen-library.webp', import.meta.url).href, label: 'iPhone \u00b7 Library' },
        { dev: 'pad', label: 'iPad' },
        { dev: 'watch', label: 'Apple\u00a0Watch' },
      ],
    },
    {
      tag: 'NO CATCH',
      title: 'Free. No ads. No tracking.',
      body: 'No paid tier, no analytics SDK, no account. The App\u00a0Store privacy label reads \u201cData Not Collected.\u201d A personal project, open source, funded out of pocket.',
      media: null,
    },
    {
      tag: 'TUNE IN',
      title: 'Coming soon to the App\u00a0Store.',
      body: 'Until then, the web app plays in any browser at rrradio.org.',
      media: [{ src: new URL('./screen-now-playing.webp', import.meta.url).href, cap: '' }],
      cta: true,
    },
  ];
  const N = STATIONS.length;

  // ── Dial constants (kept in step with landing.js) ──
  const FM_MIN = 87, FM_MAX = 108;
  const MIN = FM_MIN, MAX = FM_MAX, RANGE = MAX - MIN;
  const FM_LABELS = [87, 89, 93, 97, 101, 105, 108];
  const AM_MIN = 522, AM_MAX = 1620;
  const AM_LABELS = [522, 655, 680, 1070, 1280, 1480, 1620];
  const PX = 60;

  // Frequency assigned to each station (evenly across the FM band, inset a touch).
  const stationFreq = (k) => MIN + (0.5 + k) / N * RANGE;

  // ── DOM ──
  const track = document.getElementById('tuneTrack');
  const tuner = document.querySelector('.tuner');
  const dialTrack = tuner.querySelector('.tuner__track');
  const presetsEl = tuner.querySelector('.tuner__presets');
  const knob = tuner.querySelector('.tuner__knob--control');
  const content = document.getElementById('stageContent');
  const sigFreq = document.getElementById('sigFreq');
  const sigTag = document.getElementById('sigTag');
  const titleEl = document.getElementById('stageTitle');
  const bodyEl = document.getElementById('stageBody');
  const featuresEl = document.getElementById('stageFeatures');
  const mediaEl = document.getElementById('stageMedia');
  const ctaEl = document.getElementById('stageCta');
  const staticCanvas = document.getElementById('stageStatic');

  const reduceMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  // ── Scroll throw: each gap between stations is ~0.72 viewport of scroll. ──
  function sizeTrack() {
    const throwPer = Math.round(window.innerHeight * 0.72);
    track.style.height = (window.innerHeight + throwPer * (N - 1)) + 'px';
  }

  const docMax = () => Math.max(1, document.documentElement.scrollHeight - window.innerHeight);

  // ── Build the dial ticks (FM upper row, AM lower row). ──
  dialTrack.style.width = (RANGE * PX) + 'px';
  (function buildTicks() {
    const frag = document.createDocumentFragment();
    for (let i = 0; i <= RANGE * 10 + 0.5; i++) {
      const f = MIN + i / 10;
      const tick = document.createElement('div');
      const isInt = Math.abs(f - Math.round(f)) < 0.05;
      const isHalf = !isInt && Math.abs((f * 10) % 5) < 0.5;
      tick.className = 'tuner__tick tuner__tick--fm' + (isInt ? ' tuner__tick--major' : (isHalf ? ' tuner__tick--half' : ''));
      tick.style.left = ((f - MIN) * PX) + 'px';
      if (isInt && FM_LABELS.includes(Math.round(f))) {
        const lab = document.createElement('span');
        lab.className = 'tuner__tick-label';
        lab.textContent = Math.round(f);
        tick.appendChild(lab);
      }
      frag.appendChild(tick);
    }
    AM_LABELS.forEach((value) => {
      const tick = document.createElement('div');
      tick.className = 'tuner__tick tuner__tick--am tuner__tick--major';
      tick.style.left = (((value - AM_MIN) / (AM_MAX - AM_MIN)) * RANGE * PX) + 'px';
      const lab = document.createElement('span');
      lab.className = 'tuner__tick-label';
      lab.textContent = String(value);
      tick.appendChild(lab);
      frag.appendChild(tick);
    });
    dialTrack.appendChild(frag);
  })();

  // ── Presets: one per station. ──
  STATIONS.forEach((st, k) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tuner__preset';
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', 'Preset ' + String(k + 1).padStart(2, '0') + ': ' + st.title);
    const cap = document.createElement('span');
    cap.className = 'tuner__preset-cap';
    cap.textContent = String(k + 1).padStart(2, '0');
    const label = document.createElement('span');
    label.className = 'tuner__preset-label';
    label.textContent = st.tag;
    btn.append(cap, label);
    btn.addEventListener('click', () => scrollToStation(k));
    presetsEl.appendChild(btn);
    st.btn = btn;
  });
  const presetBtns = STATIONS.map((s) => s.btn);

  function scrollToStation(k) {
    const y = (k / (N - 1)) * docMax();
    snapping = true;
    window.scrollTo({ top: y, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  }

  // ── Scramble: replace characters with noise glyphs, proportional to amount. ──
  const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&/()=?+*<>[]{}\u2588\u2592\u2591\u2593\u2014\u00b7\u2248\u2261';
  const rndGlyph = () => GLYPHS[(Math.random() * GLYPHS.length) | 0];
  function scramble(str, amount) {
    if (amount <= 0.001) return str;
    let out = '';
    for (let i = 0; i < str.length; i++) {
      const c = str[i];
      if (c === ' ' || c === '\u00a0' || c === '\n') { out += c; continue; }
      out += (Math.random() < amount) ? rndGlyph() : c;
    }
    return out;
  }

  // ── Dotted-continent globe (real Natural Earth coastlines) + station hubs. ──
  function startGlobe(canvas) {
    const ctx = canvas.getContext('2d');
    let w = 0, h = 0, cx = 0, cy = 0, R = 0, dpr = 1;
    function size() {
      const r = canvas.getBoundingClientRect();
      if (!r.width) return;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      w = r.width; h = r.height; cx = w / 2; cy = h / 2;
      R = Math.min(w, h) * 0.46;
    }
    size();
    const onResize = () => size();
    window.addEventListener('resize', onResize);

    const LAND = window.LAND_DOTS || [];
    const HUBS = MAP_HUBS;
    // Gentle tilt so the equator sits ~mid-disc (was -0.41 ≈ 23.5°, which
    // pushed it high). Start rotated to bring Europe (~15°E) to the front:
    // the central meridian faces the viewer where lon = -rot.
    const tilt = -0.15, ct = Math.cos(tilt), stf = Math.sin(tilt);
    const EUROPE_ROT = -0.26;            // ≈ 15°E centred
    let rot = EUROPE_ROT, raf = 0;
    const D2R = Math.PI / 180;

    function proj(lat, lon) {
      const la = lat * D2R, lo = lon * D2R;
      const cl = Math.cos(la);
      const x = cl * Math.sin(lo + rot);
      const y = Math.sin(la);
      const z = cl * Math.cos(lo + rot);
      return { x: cx + x * R, y: cy - (y * ct - z * stf) * R, z: y * stf + z * ct };
    }
    function draw(t) {
      if (!w) { size(); if (!w) return; }
      ctx.clearRect(0, 0, w, h);
      // globe body + rim
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832);
      ctx.fillStyle = 'rgba(255,255,255,0.018)'; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(244,244,242,0.20)'; ctx.stroke();
      // land dots (front hemisphere only)
      for (let i = 0; i < LAND.length; i++) {
        const p = proj(LAND[i][0], LAND[i][1]);
        if (p.z <= 0) continue;
        const a = 0.15 + 0.5 * p.z;
        ctx.fillStyle = 'rgba(246,246,240,' + a.toFixed(3) + ')';
        ctx.fillRect(p.x - 0.8, p.y - 0.8, 1.6, 1.6);
      }
      // station hub blips
      for (let i = 0; i < HUBS.length; i++) {
        const hb = HUBS[i];
        const p = proj(hb[0], hb[1]);
        if (p.z <= 0) continue;
        const tw = 0.66 + 0.34 * Math.sin(t * 0.004 + i);
        ctx.fillStyle = 'rgba(255,255,0,' + (0.85 * tw * (0.45 + 0.55 * p.z)).toFixed(3) + ')';
        ctx.shadowColor = 'rgba(255,255,0,0.85)'; ctx.shadowBlur = 7;
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.5 + 0.45 * (hb[2] || 1), 0, 6.2832); ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
    function loop(t) { rot += 0.0022; draw(t); raf = requestAnimationFrame(loop); }
    if (reduceMotion.matches) { rot = EUROPE_ROT; draw(0); }
    else { raf = requestAnimationFrame(loop); }

    return function stop() {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }

  // ── Station hubs at true lat/long (shared by the globe). ──
  const MAP_HUBS = [
    [51, 0, 3], [48, 2, 3], [52, 13, 2], [40, -4, 2], [42, 12, 2], [55, 37, 2],
    [41, 29, 1], [59, 18, 1], [52, 21, 1], [45, 9, 1], [50, 14, 1], [53, -6, 1],
    [41, -74, 3], [34, -118, 2], [42, -88, 2], [44, -79, 1], [38, -122, 1],
    [19, -99, 2], [4, -74, 1], [-23, -46, 2], [-34, -58, 1], [-12, -77, 1],
    [6, 3, 1], [-26, 28, 1], [30, 31, 1], [-1, 37, 1], [33, -7, 1], [25, 55, 1],
    [19, 73, 2], [28, 77, 2], [13, 80, 1], [36, 140, 3], [37, 127, 1], [40, 116, 2],
    [31, 121, 1], [22, 114, 1], [14, 100, 1], [-6, 107, 1], [1, 104, 1],
    [-34, 151, 2], [-37, 175, 1], [25, 121, 1],
  ];

  // ── Device-screenshot carousel (iPhone / iPad / Apple Watch). ──
  function buildCarousel(items) {
    const car = document.createElement('div');
    car.className = 'carousel';
    const stage = document.createElement('div');
    stage.className = 'carousel__stage';
    items.forEach((c, i) => {
      const slide = document.createElement('div');
      slide.className = 'cslide' + (i === 0 ? ' is-active' : '');
      const dev = document.createElement('div');
      dev.className = 'cdev cdev--' + c.dev;
      const scr = document.createElement('div');
      scr.className = 'cdev__screen';
      if (c.src) {
        const img = document.createElement('img');
        img.className = 'cdev__shot';
        img.src = c.src; img.alt = ''; img.decoding = 'async'; img.loading = 'lazy';
        scr.appendChild(img);
      } else {
        // No screenshot yet (iPad / Apple Watch) \u2014 show an honest static
        // "coming soon" panel rather than the design-tool placeholder.
        const soon = document.createElement('div');
        soon.className = 'cdev__soon';
        const t = document.createElement('span');
        t.className = 'cdev__soon-text';
        t.textContent = 'Coming soon';
        soon.appendChild(t);
        scr.appendChild(soon);
      }
      dev.appendChild(scr);
      slide.appendChild(dev);
      const lab = document.createElement('div');
      lab.className = 'cslide__label';
      lab.textContent = c.label;
      slide.appendChild(lab);
      stage.appendChild(slide);
    });
    car.appendChild(stage);
    car.insertAdjacentHTML('beforeend',
      '<button type="button" class="cnav cnav--prev" aria-label="Previous screenshot">\u2039</button>' +
      '<button type="button" class="cnav cnav--next" aria-label="Next screenshot">\u203a</button>');
    const dots = document.createElement('div');
    dots.className = 'cdots';
    items.forEach((c, i) => {
      const d = document.createElement('button');
      d.type = 'button';
      d.className = 'cdot' + (i === 0 ? ' is-active' : '');
      d.setAttribute('aria-label', c.label.replace(/\u00a0/g, ' '));
      dots.appendChild(d);
    });
    car.appendChild(dots);
    return car;
  }

  function startCarousel(root) {
    if (!root) return function () {};
    const slides = [...root.querySelectorAll('.cslide')];
    const dots = [...root.querySelectorAll('.cdot')];
    let idx = 0, timer = 0, paused = false;
    function show(n) {
      idx = (n + slides.length) % slides.length;
      slides.forEach((s, i) => s.classList.toggle('is-active', i === idx));
      dots.forEach((d, i) => d.classList.toggle('is-active', i === idx));
    }
    function start() { stop(); if (!reduceMotion.matches) timer = setInterval(function () { if (!paused) show(idx + 1); }, 3800); }
    function stop() { if (timer) { clearInterval(timer); timer = 0; } }
    dots.forEach((d, i) => d.addEventListener('click', () => { show(i); start(); }));
    const prev = root.querySelector('.cnav--prev');
    const next = root.querySelector('.cnav--next');
    if (prev) prev.addEventListener('click', () => { show(idx - 1); start(); });
    if (next) next.addEventListener('click', () => { show(idx + 1); start(); });
    root.addEventListener('pointerenter', () => { paused = true; });
    root.addEventListener('pointerleave', () => { paused = false; });
    show(0); start();
    return function stopCarousel() { stop(); };
  }

  // ── Render a station into the stage (called when the locked index changes). ──
  let renderedIndex = -1;
  let mediaAnim = null;   // stop() for any running media animation (e.g. the globe)
  function renderStation(k) {
    if (k === renderedIndex) return;
    renderedIndex = k;
    if (mediaAnim) { mediaAnim(); mediaAnim = null; }
    const st = STATIONS[k];
    sigTag.textContent = st.tag;   // freq is written live in update()
    titleEl.dataset.text = st.title;
    bodyEl.dataset.text = st.body;
    bodyEl.style.display = st.body ? '' : 'none';

    // Feature list (left column, replaces body on feature stations)
    featuresEl.innerHTML = '';
    if (st.features) {
      st.features.forEach((f, i) => {
        const li = document.createElement('li');
        li.className = 'featurelist__item';
        const n = document.createElement('span');
        n.className = 'featurelist__n';
        n.textContent = String(i + 1).padStart(2, '0');
        const tx = document.createElement('span');
        tx.className = 'featurelist__t';
        tx.textContent = f;
        li.append(n, tx);
        featuresEl.appendChild(li);
      });
    }

    // Media
    mediaEl.className = 'stage__media' + (st.trio ? ' stage__media--trio' : '');
    content.classList.toggle('has-media', !!st.media || !!st.diagram || !!st.carousel);
    content.classList.toggle('has-diagram', !!st.diagram);
    content.classList.toggle('has-carousel', !!st.carousel);
    content.classList.toggle('has-features', !!st.features);
    content.classList.toggle('is-trio', !!st.trio);
    mediaEl.innerHTML = '';
    if (st.diagram) {
      const tpl = document.getElementById('tpl-' + st.diagram);
      if (tpl) mediaEl.appendChild(tpl.content.cloneNode(true));
      if (st.diagram === 'globe') {
        const cv = mediaEl.querySelector('.globe__cv');
        if (cv) mediaAnim = startGlobe(cv);
      }
    }
    if (st.carousel) {
      mediaEl.appendChild(buildCarousel(st.carousel));
      mediaAnim = startCarousel(mediaEl.querySelector('.carousel'));
    }
    if (st.media) {
      st.media.forEach((m) => {
        const phone = document.createElement('div');
        phone.className = 'stage__phone';
        const dev = document.createElement('div');
        dev.className = 'device';
        const scr = document.createElement('div');
        scr.className = 'device__screen';
        const img = document.createElement('img');
        img.className = 'device__shot';
        img.src = m.src;
        img.alt = '';
        img.decoding = 'async';
        scr.appendChild(img);
        dev.appendChild(scr);
        phone.appendChild(dev);
        if (m.cap) {
          const cap = document.createElement('div');
          cap.className = 'stage__media__cap';
          cap.textContent = m.cap;
          phone.appendChild(cap);
        }
        mediaEl.appendChild(phone);
      });
    }

    // CTA only on the sign-off station
    ctaEl.hidden = !st.cta;

    presetBtns.forEach((b, i) => {
      b.classList.toggle('is-current', i === k);
      b.setAttribute('aria-pressed', i === k ? 'true' : 'false');
    });
  }

  // ── Smoothstep ──
  function smooth(a, b, x) {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  // ── Core state, written on scroll, consumed by the rAF paint loop. ──
  let clarity = 1;     // 1 locked, 0 static
  let lockedK = 0;     // station currently shown
  let curFreq = stationFreq(0);

  const LOCK_HALF = 0.12;   // |index distance| within which we're fully clear
  const NOISE_FULL = 0.46;  // distance at which it's pure static

  function update() {
    const p = Math.max(0, Math.min(1, window.scrollY / docMax()));
    const fIndex = p * (N - 1);
    const k = Math.round(fIndex);
    const d = Math.abs(fIndex - k);

    clarity = 1 - smooth(LOCK_HALF, NOISE_FULL, d);
    lockedK = k;
    renderStation(k);

    // Continuous frequency readout: glide from this station toward the neighbour.
    const neighbour = fIndex >= k ? Math.min(N - 1, k + 1) : Math.max(0, k - 1);
    const span = Math.abs(fIndex - k);
    curFreq = stationFreq(k) + (stationFreq(neighbour) - stationFreq(k)) * span;
    // Live, continuously-changing frequency, shown directly in the heading.
    sigFreq.textContent = curFreq.toFixed(1);

    // Dial: slide the tick strip under the fixed centre needle.
    const stripEl = tuner.querySelector('.tuner__strip');
    const centerX = (stripEl ? stripEl.clientWidth : tuner.clientWidth) / 2;
    dialTrack.style.transform = 'translateX(' + (centerX - (curFreq - MIN) * PX) + 'px)';

    // Knob rotation + slider semantics.
    if (knob) {
      knob.style.transform = 'rotate(' + (p * 720) + 'deg)';
      const pct = Math.round(p * 100);
      knob.setAttribute('aria-valuenow', String(pct));
      knob.setAttribute('aria-valuetext', curFreq.toFixed(1) + ' MHz — ' + STATIONS[k].tag);
    }
  }

  // ── Paint loop: applies clarity, scramble text, and static overlay. ──
  const sctx = staticCanvas.getContext('2d');
  let noiseTile = null;
  function buildNoiseTile() {
    const tile = document.createElement('canvas');
    tile.width = 128; tile.height = 128;
    noiseTile = tile;
  }
  buildNoiseTile();
  function paintNoiseTile() {
    const tctx = noiseTile.getContext('2d');
    const img = tctx.createImageData(noiseTile.width, noiseTile.height);
    const data = img.data;
    for (let i = 0; i < data.length; i += 4) {
      const v = (Math.random() * 255) | 0;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = (Math.random() * 255) | 0;
    }
    tctx.putImageData(img, 0, 0);
  }

  function sizeStatic() {
    const r = staticCanvas.getBoundingClientRect();
    staticCanvas.width = Math.max(1, Math.round(r.width / 3));   // low-res = chunky static
    staticCanvas.height = Math.max(1, Math.round(r.height / 3));
  }
  sizeStatic();

  let frame = 0;
  function paint() {
    const noise = 1 - clarity;
    content.style.setProperty('--clarity', clarity.toFixed(3));
    content.style.setProperty('--noise', noise.toFixed(3));

    // Text scramble — a touch sharper ramp so it locks crisply.
    if (!reduceMotion.matches) {
      const amt = Math.max(0, Math.min(1, noise * 1.25 - 0.05));
      titleEl.textContent = scramble(titleEl.dataset.text || '', amt);
      bodyEl.textContent = scramble(bodyEl.dataset.text || '', amt);

      // Static overlay
      staticCanvas.style.opacity = (noise * 0.6).toFixed(3);
      if (noise > 0.02) {
        if ((frame & 1) === 0) paintNoiseTile();   // ~30fps shimmer
        sctx.imageSmoothingEnabled = false;
        sctx.clearRect(0, 0, staticCanvas.width, staticCanvas.height);
        sctx.globalAlpha = 1;
        const ox = (Math.random() * 24) | 0, oy = (Math.random() * 24) | 0;
        for (let x = -ox; x < staticCanvas.width; x += noiseTile.width) {
          for (let y = -oy; y < staticCanvas.height; y += noiseTile.height) {
            sctx.drawImage(noiseTile, x, y);
          }
        }
      }
    } else {
      // Reduced motion: show clean text, cross-fade only via opacity (CSS).
      titleEl.textContent = titleEl.dataset.text || '';
      bodyEl.textContent = bodyEl.dataset.text || '';
    }

    frame++;
    requestAnimationFrame(paint);
  }

  // ── Snap-to-station after the scroll settles. ──
  let snapping = false;
  let dragging = false;
  let idleTimer = null;
  function scheduleSnap() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (dragging) return;
      const p = window.scrollY / docMax();
      const k = Math.round(p * (N - 1));
      const targetY = (k / (N - 1)) * docMax();
      if (Math.abs(window.scrollY - targetY) > 2) {
        snapping = true;
        window.scrollTo({ top: targetY, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
      }
      snapping = false;
    }, 160);
  }

  // ── Scroll wiring ──
  let raf = null;
  function onScroll() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = null; update(); });
    if (!dragging) scheduleSnap();
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => {
    sizeTrack(); sizeStatic(); update();
  });

  // ── Dial drag = scrub the page horizontally. ──
  const RANGE_PX = PX * RANGE;
  function startScrub(surface) {
    if (!surface) return;
    let startX = 0, scrollStart = 0, active = false;
    surface.addEventListener('pointerdown', (e) => {
      active = true; dragging = true;
      startX = e.clientX; scrollStart = window.scrollY;
      try { surface.setPointerCapture(e.pointerId); } catch (_) {}
      if (surface === knob) knob.style.cursor = 'grabbing';
      e.preventDefault();
    });
    surface.addEventListener('pointermove', (e) => {
      if (!active) return;
      const dx = e.clientX - startX;
      const delta = -dx * (docMax() / RANGE_PX);
      window.scrollTo(0, Math.max(0, Math.min(docMax(), scrollStart + delta)));
    });
    const end = (e) => {
      if (!active) return;
      active = false; dragging = false;
      try { surface.releasePointerCapture(e.pointerId); } catch (_) {}
      if (surface === knob) knob.style.cursor = 'grab';
      scheduleSnap();
    };
    surface.addEventListener('pointerup', end);
    surface.addEventListener('pointercancel', end);
    surface.addEventListener('lostpointercapture', end);
  }
  startScrub(knob);
  startScrub(tuner.querySelector('.tuner__strip'));

  // ── Keyboard: arrows step station to station. ──
  if (knob) {
    knob.addEventListener('keydown', (e) => {
      const p = window.scrollY / docMax();
      const k = Math.round(p * (N - 1));
      let nk = k;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') nk = Math.min(N - 1, k + 1);
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') nk = Math.max(0, k - 1);
      else if (e.key === 'Home') nk = 0;
      else if (e.key === 'End') nk = N - 1;
      else return;
      e.preventDefault();
      scrollToStation(nk);
    });
  }

  // ── Boot ──
  function boot() {
    sizeTrack(); sizeStatic(); update(); paint();
  }
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { sizeTrack(); sizeStatic(); update(); });
  }
  boot();
  setTimeout(() => { sizeTrack(); sizeStatic(); update(); }, 300);
})();
