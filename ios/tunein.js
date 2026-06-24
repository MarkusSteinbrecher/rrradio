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
      title: 'Does the world need another radio app?',
      body: 'Absolutely. One that is free, without ads, and with a great experience \u2014 every other app makes you pick two. This one doesn\u2019t.',
      bodyHtml: '<span class="hl">Absolutely</span>. One that is free, without ads, and with a great experience \u2014 every other app makes you pick two. This one doesn\u2019t.',
      diagram: 'venn',
    },
    {
      tag: 'WORLDWIDE',
      title: 'Every station, everywhere.',
      body: 'Tens of thousands of live streams from every corner of the world, constantly updated and maintained at rrradio.org \u2014 and if one\u2019s missing, tell us and we\u2019ll add it.',
      bodyHtml: 'Tens of thousands of live streams from every corner of the world, constantly updated and maintained at <a class="bodylink" href="https://rrradio.org" target="_blank" rel="noopener">rrradio.org</a> \u2014 and if one\u2019s missing, tell us and we\u2019ll add it.',
      diagram: 'globe',
    },
    {
      tag: 'FEATURES',
      title: 'Built for how you listen.',
      body: '',
      carousel: [
        { dev: 'phone', src: new URL('./screen-browse-dark.webp', import.meta.url).href, label: 'iPhone',
          name: 'Browse', head: 'Browse the catalog', copy: 'Filter by genre or country, or jump straight to a station by name.' },
        { dev: 'phone', src: new URL('./screen-favorites-dark.webp', import.meta.url).href, label: 'iPhone',
          name: 'Favorites & Lists', head: 'Favorites & lists', copy: 'Save the stations you love, and group them into custom lists you can play in a tap.' },
        { dev: 'phone', src: new URL('./screen-now-playing-dark.webp', import.meta.url).href, label: 'iPhone',
          name: 'Now Playing', head: 'See what\u2019s on', copy: 'See title, artist, and artwork \u2014 and open a song in Apple Music, Spotify or YouTube Music.' },
        { dev: 'phone', src: new URL('./screen-schedule-dark.webp', import.meta.url).href,
          srcBack: new URL('./screen-lyrics-dark.webp', import.meta.url).href, label: 'iPhone',
          name: 'Schedule & Lyrics', head: 'Schedule & lyrics', copy: 'See what\u2019s on later, and follow along with the words.' },
        { dev: 'phone', src: new URL('./screen-wake-alarm-dark.webp', import.meta.url).href, label: 'iPhone',
          name: 'Wake Alarm', head: 'Wake up to radio', copy: 'Set an alarm for any station and it starts playing at the time you choose. Save alarms for easy access.' },
        { dev: 'phone', src: new URL('./screen-history-dark.webp', import.meta.url).href, label: 'iPhone',
          name: 'History', head: 'Take a look back', copy: 'Watch your history, recent stations and listening stats.' },
        { devices: [
            { dev: 'pad', src: new URL('./screen-ipad-now-playing-dark.webp', import.meta.url).href },
            { dev: 'car', src: new URL('./screen-carplay-dark.webp', import.meta.url).href },
            { dev: 'watch', src: new URL('./screen-watch-dark.webp', import.meta.url).href },
          ], label: 'iPad',
          name: 'Devices', head: 'On your iPad, your wrist and in your car', copy: 'Browse, see what\u2019s playing, and control it from all your devices.' },
      ],
    },
    {
      tag: 'AND MORE',
      title: 'And a whole lot more.',
      features: [
        { t: 'Adjust the look & feel', d: 'Change themes, choose views and many more.' },
        { t: 'Custom stations', d: 'Add your own stations by pasting a stream URL.' },
        { t: 'Bluetooth', d: 'Connect to any device via bluetooth.' },
        { t: 'Siri & Shortcuts', d: 'Start a station by voice or from a Shortcut.' },
        { t: 'Sync across devices', d: 'Use iCloud to sync across all your devices.' },
        { t: 'Open in', d: 'Apple Music, Spotify or Youtube Music.' },
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
      icon: new URL('./rrradio-logo-app-dark.svg', import.meta.url).href,
      iconLight: new URL('./rrradio-logo-app-light.svg', import.meta.url).href,
      title: 'Now on the App\u00a0Store.',
      body: 'Free on iPhone and Apple\u00a0Watch \u2014 or play in any browser at rrradio.org.',
      cta: true,
    },
  ];
  const N = STATIONS.length;

  // ── Stops: most stations are a single scroll stop; a carousel station
  //    expands into one stop per slide, so scrolling steps through the
  //    screenshots before tuning on to the next station. Static dissolves
  //    only between *different stations* — slide-to-slide just cross-fades. ──
  const STOPS = [];
  STATIONS.forEach((st, si) => {
    const slides = st.carousel ? st.carousel.length : 1;
    for (let s = 0; s < slides; s++) STOPS.push({ station: si, slide: st.carousel ? s : -1 });
  });
  const M = STOPS.length;
  const stopMax = () => Math.max(1, M - 1);
  const firstStopOf = (station) => STOPS.findIndex((s) => s.station === station);

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
  const iconsEl = document.getElementById('stageIcons');
  const iconEl = document.getElementById('stageIcon');
  const iconLightEl = document.getElementById('stageIconLight');
  const sigSubEl = document.getElementById('sigSub');
  const bodyEl = document.getElementById('stageBody');
  const featuresEl = document.getElementById('stageFeatures');
  const mediaEl = document.getElementById('stageMedia');
  const ctaEl = document.getElementById('stageCta');
  const staticCanvas = document.getElementById('stageStatic');

  const reduceMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  // ── Scroll throw: each gap between stops is ~0.72 viewport of scroll. ──
  function sizeTrack() {
    const throwPer = Math.round(window.innerHeight * 0.72);
    track.style.height = (window.innerHeight + throwPer * (M - 1)) + 'px';
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

  function scrollToStop(stopIdx) {
    stopIdx = Math.max(0, Math.min(M - 1, stopIdx));
    snapping = true;
    window.scrollTo({ top: (stopIdx / stopMax()) * docMax(), behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  }
  function scrollToStation(k) { scrollToStop(firstStopOf(k)); }

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

    // ── Callout chip: names a real station as its blip faces the viewer. ──
    const chip = document.createElement('div');
    chip.className = 'globe__chip';
    chip.innerHTML = '<span class="globe__chip-name"></span><span class="globe__chip-city"></span>';
    canvas.parentNode.appendChild(chip);
    const chipName = chip.querySelector('.globe__chip-name');
    const chipCity = chip.querySelector('.globe__chip-city');
    let active = -1, chipW = 0, chipH = 0;
    let phase = 'init', phaseAt = 0;
    const DWELL = 2600, FADE = 440;        // hold ≈2.6s, cross-fade ≈0.44s

    // First callout after `from` (cyclically) whose blip is comfortably front-facing.
    function nextFront(from) {
      for (let n = 1; n <= CALLOUTS.length; n++) {
        const i = (from + n) % CALLOUTS.length;
        if (proj(CALLOUTS[i][0], CALLOUTS[i][1]).z > 0.45) return i;
      }
      return from;                          // nothing better — keep current
    }
    function setChip(i) {
      chipName.textContent = CALLOUTS[i][2];
      chipCity.textContent = CALLOUTS[i][3];
      chipW = chip.offsetWidth; chipH = chip.offsetHeight;   // measure once per switch
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

      // ── Callout scheduling: in → hold → out → swap to next front station. ──
      if (phase === 'init') { active = nextFront(-1); if (active >= 0) { setChip(active); phase = 'in'; phaseAt = t; } }
      else if (phase === 'in' && t - phaseAt > DWELL) { phase = 'out'; phaseAt = t; }
      else if (phase === 'out' && t - phaseAt > FADE) { active = nextFront(active); setChip(active); phase = 'in'; phaseAt = t; }

      let f = phase === 'in' ? Math.min(1, (t - phaseAt) / FADE)
            : phase === 'out' ? Math.max(0, 1 - (t - phaseAt) / FADE) : 0;

      if (active >= 0 && f > 0) {
        const c = CALLOUTS[active];
        const p = proj(c[0], c[1]);
        f *= Math.max(0, Math.min(1, (p.z - 0.1) / 0.25));   // also fade as it nears the rim
        if (f > 0.01) {
          // Chip sits to the side of the blip, toward the disc interior (so it
          // never jams against the rim) — a clean horizontal leader to its edge.
          const onLeft = p.x < cx;        // left-half blip → chip to its right
          const GAP = 22, PAD = 4;
          let left = onLeft ? p.x + GAP : p.x - GAP - chipW;
          left = Math.max(PAD, Math.min(w - chipW - PAD, left));
          const top = Math.max(chipH / 2 + PAD, Math.min(h - chipH / 2 - PAD, p.y));
          chip.style.left = left.toFixed(1) + 'px';
          chip.style.top = top.toFixed(1) + 'px';
          chip.style.opacity = f.toFixed(3);
          // Leader from blip to the chip edge facing it.
          const nearX = onLeft ? left - 1 : left + chipW + 1;
          // Emphasised blip + halo.
          ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, 6.2832);
          ctx.strokeStyle = 'rgba(255,255,0,' + (0.4 * f).toFixed(3) + ')'; ctx.lineWidth = 1; ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,0,' + (0.95 * f).toFixed(3) + ')';
          ctx.shadowColor = 'rgba(255,255,0,0.9)'; ctx.shadowBlur = 10;
          ctx.beginPath(); ctx.arc(p.x, p.y, 2.7, 0, 6.2832); ctx.fill(); ctx.shadowBlur = 0;
          // Leader line.
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(nearX, top);
          ctx.strokeStyle = 'rgba(255,255,0,' + (0.38 * f).toFixed(3) + ')'; ctx.lineWidth = 1; ctx.stroke();
        } else { chip.style.opacity = '0'; }
      } else { chip.style.opacity = '0'; }
    }
    function loop(t) { rot += 0.0022; draw(t); raf = requestAnimationFrame(loop); }
    if (reduceMotion.matches) {
      rot = EUROPE_ROT;
      active = nextFront(-1);
      if (active >= 0) { setChip(active); phase = 'in'; phaseAt = -FADE; }   // fully faded-in, static
      draw(0);
    } else {
      raf = requestAnimationFrame(loop);
    }

    return function stop() {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      chip.remove();
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

  // ── Named stations that surface as a callout when their blip faces front.
  //    [lat, lon, name, city] — a spread of recognisable broadcasters so the
  //    chip moves around the world as the globe turns. ──
  const CALLOUTS = [
    [51, 0, 'BBC', 'London'],
    [48, 2, 'FIP', 'Paris'],
    [52, 13, 'radioeins', 'Berlin'],
    [41, -74, 'WNYC', 'New York'],
    [47, -122, 'KEXP', 'Seattle'],
    [-23, -46, 'Rádio Globo', 'São Paulo'],
    [36, 140, 'NHK', 'Tokyo'],
    [-33, 151, 'Triple J', 'Sydney'],
    [-26, 28, 'Radio 702', 'Johannesburg'],
    [19, 73, 'Radio City', 'Mumbai'],
  ];

  // ── Device-screenshot carousel (iPhone / iPad / Apple Watch). ──
  // One device frame (rail + bezel) wrapping a screenshot, or a "coming soon"
  // panel when there's no shot yet.
  function makeDevice(devType, src, extraClass) {
    const dev = document.createElement('div');
    dev.className = 'cdev cdev--' + devType + (extraClass ? ' ' + extraClass : '');
    const scr = document.createElement('div');
    scr.className = 'cdev__screen';
    if (src) {
      const img = document.createElement('img');
      img.className = 'cdev__shot';
      img.src = src; img.alt = ''; img.decoding = 'async'; img.loading = 'lazy';
      scr.appendChild(img);
    } else {
      const soon = document.createElement('div');
      soon.className = 'cdev__soon';
      const t = document.createElement('span');
      t.className = 'cdev__soon-text';
      t.textContent = 'Coming soon';
      soon.appendChild(t);
      scr.appendChild(soon);
    }
    dev.appendChild(scr);
    return dev;
  }

  function buildCarousel(items) {
    const car = document.createElement('div');
    car.className = 'carousel';
    const stage = document.createElement('div');
    stage.className = 'carousel__stage';
    items.forEach((c, i) => {
      const slide = document.createElement('div');
      slide.className = 'cslide' + (i === 0 ? ' is-active' : '');
      if (c.devices) {
        // A family of different device types (iPad / CarPlay / Watch) arranged
        // as one composition.
        const fam = document.createElement('div');
        fam.className = 'cfamily';
        c.devices.forEach((d) => fam.appendChild(makeDevice(d.dev, d.src)));
        slide.appendChild(fam);
      } else if (c.srcBack) {
        // Two overlapping phones: srcBack sits behind, src (the headline shot) in front.
        const stack = document.createElement('div');
        stack.className = 'cstack';
        stack.appendChild(makeDevice(c.dev, c.srcBack, 'cdev--back'));
        stack.appendChild(makeDevice(c.dev, c.src, 'cdev--front'));
        slide.appendChild(stack);
      } else {
        slide.appendChild(makeDevice(c.dev, c.src));
      }
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

  // Carousel is scroll-driven: each slide is a scroll stop, so the page scroll
  // steps through screenshots. show() reflects the current stop; dots/arrows
  // seek by scrolling to the matching stop (via onSeek).
  function startCarousel(root, onSeek) {
    const noop = function () {};
    if (!root) return { stop: noop, show: noop };
    const slides = [...root.querySelectorAll('.cslide')];
    const dots = [...root.querySelectorAll('.cdot')];
    const prev = root.querySelector('.cnav--prev');
    const next = root.querySelector('.cnav--next');
    let idx = -1;
    function show(n) {
      n = Math.max(0, Math.min(slides.length - 1, n));
      if (n === idx) return;
      idx = n;
      slides.forEach((s, i) => s.classList.toggle('is-active', i === idx));
      dots.forEach((d, i) => d.classList.toggle('is-active', i === idx));
      // No arrow to a slide that doesn't exist: hide prev at the start, next at the end.
      if (prev) prev.hidden = idx <= 0;
      if (next) next.hidden = idx >= slides.length - 1;
    }
    dots.forEach((d, i) => d.addEventListener('click', () => onSeek && onSeek(i)));
    if (prev) prev.addEventListener('click', () => onSeek && onSeek(idx - 1));
    if (next) next.addEventListener('click', () => onSeek && onSeek(idx + 1));
    show(0);
    return { stop: noop, show: show };
  }

  // ── Render a station into the stage (called when the locked index changes). ──
  let renderedIndex = -1;
  let mediaAnim = null;     // stop() for any running media animation (e.g. the globe)
  let carouselShow = null;  // show(slideIdx) for the active carousel, driven by scroll
  let shownSlide = -1;      // carousel slide whose head/copy is in the text column
  function renderStation(k) {
    if (k === renderedIndex) return;
    renderedIndex = k;
    if (mediaAnim) { mediaAnim(); mediaAnim = null; }
    carouselShow = null;
    shownSlide = -1;
    const st = STATIONS[k];
    sigTag.textContent = st.tag;   // freq is written live in update()

    // Carousel stations drive their headline + copy per slide (set in update()).
    // Initialise to the first slide so there's no flash before the first scroll.
    if (st.carousel) {
      titleEl.dataset.text = st.carousel[0].head;
      bodyEl.dataset.text = st.carousel[0].copy;
      bodyEl.dataset.html = '';
      bodyEl.style.display = '';
      sigSubEl.textContent = '- ' + st.carousel[0].name;
      sigSubEl.hidden = false;
    } else {
      titleEl.dataset.text = st.title;
      bodyEl.dataset.text = st.body;
      bodyEl.dataset.html = st.bodyHtml || '';
      bodyEl.style.display = st.body ? '' : 'none';
      sigSubEl.textContent = '';
      sigSubEl.hidden = true;
    }
    if (st.icon) {
      iconEl.src = st.icon;
      if (st.iconLight) iconLightEl.src = st.iconLight;
      iconLightEl.hidden = !st.iconLight;
      iconsEl.hidden = false;
    } else {
      iconsEl.hidden = true;
      iconEl.removeAttribute('src');
      iconLightEl.removeAttribute('src');
    }

    featuresEl.innerHTML = '';
    if (st.features) {
      st.features.forEach((f) => {
        const li = document.createElement('li');
        li.className = 'featurelist__item';
        const t = document.createElement('span');
        t.className = 'featurelist__t';
        t.textContent = f.t;
        li.appendChild(t);
        if (f.d) {
          const d = document.createElement('span');
          d.className = 'featurelist__d';
          d.textContent = f.d;
          li.appendChild(d);
        }
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
      const base = firstStopOf(k);
      const api = startCarousel(mediaEl.querySelector('.carousel'), (slide) => scrollToStop(base + slide));
      mediaAnim = api.stop;
      carouselShow = api.show;
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
  let slidePulse = 0;  // frames of text "re-tune" scramble after a carousel slide change

  const LOCK_HALF = 0.12;   // |index distance| within which we're fully clear
  const NOISE_FULL = 0.46;  // distance at which it's pure static

  function update() {
    const p = Math.max(0, Math.min(1, window.scrollY / docMax()));
    const fStop = p * stopMax();
    const kStop = Math.round(fStop);
    const cur = STOPS[kStop];
    const station = cur.station;
    const d = Math.abs(fStop - kStop);

    // Static dissolves only when the two nearest stops are *different stations*;
    // stepping between a station's carousel slides stays fully locked (no static).
    const lo = Math.floor(fStop), hi = Math.ceil(fStop);
    const crossStation = STOPS[lo].station !== STOPS[hi].station;
    clarity = crossStation ? (1 - smooth(LOCK_HALF, NOISE_FULL, d)) : 1;
    lockedK = station;
    renderStation(station);

    // Carousel: reflect the current slide and swap its headline + copy on the
    // left. A brief scramble pulse makes the text "re-tune" with the image.
    if (cur.slide >= 0) {
      if (carouselShow) carouselShow(cur.slide);
      if (cur.slide !== shownSlide) {
        shownSlide = cur.slide;
        const sl = STATIONS[station].carousel[cur.slide];
        if (sl) {
          titleEl.dataset.text = sl.head;
          bodyEl.dataset.text = sl.copy;
          sigSubEl.textContent = '- ' + sl.name;
          if (!reduceMotion.matches) slidePulse = 12;
        }
      }
    } else {
      shownSlide = -1;
    }

    // Frequency readout: hold steady within a station; glide only when the
    // neighbouring stop belongs to a different station.
    const neighbour = fStop >= kStop ? Math.min(M - 1, kStop + 1) : Math.max(0, kStop - 1);
    const stB = STOPS[neighbour].station;
    const span = Math.abs(fStop - kStop);
    curFreq = (station === stB)
      ? stationFreq(station)
      : stationFreq(station) + (stationFreq(stB) - stationFreq(station)) * span;
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
      knob.setAttribute('aria-valuetext', curFreq.toFixed(1) + ' MHz — ' + STATIONS[station].tag);
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

  // Body can carry a rich variant (a highlighted word, a link) shown only when
  // fully locked — the scramble effect operates on plain text, so we swap in the
  // HTML at amt 0 and fall back to scrambled text the moment it starts tuning.
  let bodyHtmlShown = null;
  function paintBody(amt) {
    const html = bodyEl.dataset.html;
    if (amt < 0.001 && html) {
      if (bodyHtmlShown !== html) { bodyEl.innerHTML = html; bodyHtmlShown = html; }
    } else {
      bodyEl.textContent = scramble(bodyEl.dataset.text || '', amt);
      bodyHtmlShown = null;
    }
  }

  let frame = 0;
  function paint() {
    const noise = 1 - clarity;
    content.style.setProperty('--clarity', clarity.toFixed(3));
    content.style.setProperty('--noise', noise.toFixed(3));

    // Text scramble — a touch sharper ramp so it locks crisply. A carousel
    // slide change adds a short scramble pulse so the new headline re-tunes in.
    if (!reduceMotion.matches) {
      const pulse = slidePulse > 0 ? (slidePulse / 12) * 0.75 : 0;
      if (slidePulse > 0) slidePulse--;
      const amt = Math.max(0, Math.min(1, Math.max(noise * 1.25 - 0.05, pulse)));
      titleEl.textContent = scramble(titleEl.dataset.text || '', amt);
      paintBody(amt);

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
      paintBody(0);
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
      const k = Math.round(p * stopMax());
      const targetY = (k / stopMax()) * docMax();
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
  // Mobile browsers fire 'resize' every time the address bar slides in/out,
  // nudging innerHeight by a few dozen px. Rebuilding the scroll runway for
  // that re-lays-out the page mid-scroll, so only do it on a *real* resize
  // (width change, or a height jump big enough to be a rotation). The static
  // canvas + dial reposition cheaply and can run every time.
  let baseW = window.innerWidth, baseH = window.innerHeight;
  window.addEventListener('resize', () => {
    const w = window.innerWidth, h = window.innerHeight;
    if (w !== baseW || Math.abs(h - baseH) > 120) {
      baseW = w; baseH = h;
      sizeTrack();
    }
    sizeStatic(); update();
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

  // ── Keyboard: arrows step stop to stop (through carousel slides too). ──
  if (knob) {
    knob.addEventListener('keydown', (e) => {
      const p = window.scrollY / docMax();
      const k = Math.round(p * stopMax());
      let nk = k;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') nk = Math.min(M - 1, k + 1);
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') nk = Math.max(0, k - 1);
      else if (e.key === 'Home') nk = 0;
      else if (e.key === 'End') nk = M - 1;
      else return;
      e.preventDefault();
      scrollToStop(nk);
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
