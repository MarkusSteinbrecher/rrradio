// ──────────────────────────────────────────────────────────
// Tuner wiring — the dial scrubs through the page as you scroll.
// ──────────────────────────────────────────────────────────
(function tuner() {
  const el = document.querySelector('.tuner');
  if (!el) return;
  const track = el.querySelector('.tuner__track');
  const presets = el.querySelector('.tuner__presets');
  const freqEl = el.querySelector('.tuner__freq');
  const knob = el.querySelector('.tuner__knob--control');
  const needle = el.querySelector('.tuner__needle');
  const scope = el.querySelector('.tuner__scope');
  const scopeEnabled = scope ? getComputedStyle(scope).display !== 'none' : false;
  const scopeCanvas = scopeEnabled ? scope.querySelector('canvas') : null;
  const scopeText = scope ? scope.querySelector('.tuner__scope-text') : null;
  const scopeFreq = scope ? scope.querySelector('.tuner__scope-freq') : null;
  let scopeLockDist = 1;
  const navEl = document.querySelector('.nav');
  const photoMode = el.classList.contains('tuner--photo');
  const photoNeedleMode = photoMode && !el.classList.contains('tuner--photo-frame');
  const tunerStyle = getComputedStyle(el);
  const needleStart = parseFloat(tunerStyle.getPropertyValue('--needle-start')) || 10;
  const needleTravel = parseFloat(tunerStyle.getPropertyValue('--needle-travel')) || 78;

  const FM_MIN = 87, FM_MAX = 108;
  const MIN = FM_MIN, MAX = FM_MAX;
  const RANGE = MAX - MIN;
  const FM_LABELS = [87, 89, 93, 97, 101, 105, 108];
  const AM_MIN = 522, AM_MAX = 1620;
  const AM_LABELS = [522, 655, 680, 1070, 1280, 1480, 1620];
  const PX = 60; // pixels per MHz on the track

  if (!track || !presets) return;
  track.style.width = (RANGE * PX) + 'px';

  // — 1. tick marks: FM on the upper MHz row, AM on the lower kHz row.
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
  track.appendChild(frag);

  // — 2. station presets: every <section class="s"> gets a physical button.
  let stations = [];
  let lockedPreset = null;
  let lockedPresetTarget = null;
  let lockedPresetUntil = 0;
  function placeStations() {
    stations.forEach(s => s.btn.remove());
    stations = [];
    lockedPreset = null;
    lockedPresetTarget = null;
    const secs = [...document.querySelectorAll('main.doc .s')];
    const presetSections = [0, 1, 3, 5, 8].map((index) => secs[index]).filter(Boolean);
    const sections = presetSections.length === 5 ? presetSections : secs.slice(0, 5);
    const docMax = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    sections.forEach((sec, index) => {
      const absTop = sec.getBoundingClientRect().top + window.scrollY;
      const p = Math.max(0, Math.min(1, absTop / docMax));
      const f = MIN + p * RANGE;
      const num = String(index + 1).padStart(2, '0');

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tuner__preset';
      btn.setAttribute('aria-pressed', 'false');
      btn.dataset.freq = f.toFixed(2);
      const titleEl = sec.querySelector('.s__name');
      const title = titleEl ? titleEl.textContent.trim() : num;
      btn.setAttribute('aria-label', 'Preset ' + num + ': ' + title);

      const cap = document.createElement('span');
      cap.className = 'tuner__preset-cap';
      cap.textContent = num;
      const label = document.createElement('span');
      label.className = 'tuner__preset-label';
      label.textContent = title;
      btn.append(cap, label);

      const station = { btn, f, title, sec };
      btn.addEventListener('click', () => {
        const offset = (navEl ? navEl.offsetHeight : 60) + el.offsetHeight + 18;
        const target = sec.getBoundingClientRect().top + window.scrollY - offset;
        lockedPreset = station;
        lockedPresetTarget = target;
        lockedPresetUntil = performance.now() + 2200;
        window.scrollTo({ top: target, behavior: 'smooth' });
      });
      presets.appendChild(btn);
      stations.push(station);
    });
  }

  // — 3. scroll → freq mapping
  function update() {
    const docMax = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const p = Math.max(0, Math.min(1, window.scrollY / docMax));
    const f = MIN + p * RANGE;
    const stripEl = el.querySelector('.tuner__strip');
    const centerX = (stripEl ? stripEl.clientWidth : el.clientWidth) / 2;
    const tx = centerX - (f - MIN) * PX;
    track.style.transform = 'translateX(' + tx + 'px)';
    if (photoNeedleMode && needle) {
      needle.style.left = (needleStart + p * needleTravel).toFixed(2) + '%';
    }
    if (freqEl) freqEl.textContent = f.toFixed(1);

    // Scope lock follows the dial needle; preset state follows section targets.
    let nearest = null, dist = Infinity;
    let nearestPreset = null, presetDist = Infinity;
    const sectionOffset = (navEl ? navEl.offsetHeight : 60) + el.offsetHeight + 18;
    stations.forEach(s => {
      s.btn.classList.remove('is-current');
      s.btn.setAttribute('aria-pressed', 'false');
      const d = Math.abs(s.f - f);
      if (d < dist) { dist = d; nearest = s; }
      const target = s.sec.getBoundingClientRect().top + window.scrollY - sectionOffset;
      const pd = Math.abs(window.scrollY - target);
      if (pd < presetDist) { presetDist = pd; nearestPreset = s; }
    });
    if (lockedPreset && (
      performance.now() > lockedPresetUntil ||
      Math.abs(window.scrollY - lockedPresetTarget) < 6
    )) {
      lockedPreset = null;
      lockedPresetTarget = null;
    }
    const activePreset = lockedPreset || nearestPreset;
    if (activePreset) {
      activePreset.btn.classList.add('is-current');
      activePreset.btn.setAttribute('aria-pressed', 'true');
    }

    // sync knob rotation: 2 full rotations (720°) across the whole doc
    if (knob) knob.style.transform = 'rotate(' + (p * 720) + 'deg)';

    // oscilloscope: lockDist 0 = on station, 1 = scrambled. Sharp
    // threshold near a station so the wave clearly "locks in".
    if (scope) {
      const raw = nearest ? Math.abs(nearest.f - f) : 1;
      // 0 within ±0.10 of a station, 1 once past 0.55
      const t = Math.max(0, Math.min(1, (raw - 0.10) / 0.45));
      scopeLockDist = t * t; // ease-in so locking feels snappier
    }
  }

  // — oscilloscope animation loop
  if (scope && scopeCanvas) {
    const sctx = scopeCanvas.getContext('2d');
    const sizeScope = () => {
      const r = scopeCanvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      scopeCanvas.width = Math.max(1, r.width * dpr);
      scopeCanvas.height = Math.max(1, r.height * dpr);
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    sizeScope();
    window.addEventListener('resize', sizeScope);
    let phase = 0;
    const drawScope = () => {
      const r = scopeCanvas.getBoundingClientRect();
      const w = r.width, h = r.height;
      sctx.clearRect(0, 0, w, h);
      sctx.lineWidth = 1.2;
      // Light-grey CRT trace.
      sctx.strokeStyle = 'rgba(232,234,228,0.72)';
      sctx.shadowColor = 'rgba(232,234,228,0.26)';
      sctx.shadowBlur = 3;
      sctx.beginPath();
      const mid = h / 2;
      const baseAmp = h * 0.26;
      // Slower wave, gentler frequency drift between stations.
      const freq = 0.06 + 0.08 * scopeLockDist;
      const noiseAmp = h * 0.50 * scopeLockDist;
      for (let x = 0; x <= w; x++) {
        const y = mid
          + Math.sin(x * freq + phase) * baseAmp
          + (Math.random() - 0.5) * noiseAmp;
        if (x === 0) sctx.moveTo(x, y);
        else sctx.lineTo(x, y);
      }
      sctx.stroke();
      sctx.shadowBlur = 0;
      // Barely drift horizontally; enough motion to feel live without sliding.
      phase += 0.003 + scopeLockDist * 0.009;
      requestAnimationFrame(drawScope);
    };
    drawScope();
  }

  // — 4. wire scroll + resize via rAF
  let raf = null;
  function onScroll() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = null; update(); });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => { placeStations(); update(); });

  // — 5. knob drag: rotating the knob scrolls the page
  if (knob) {
    let dragging = false, cx = 0, cy = 0, lastAngle = 0, accAngle = 0, scrollStart = 0;
    const SCROLL_PER_ROTATION = 0.5; // 1 full knob turn = half the document
    const angleAt = (e) => Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI;
    knob.addEventListener('pointerdown', (e) => {
      const r = knob.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      lastAngle = angleAt(e); accAngle = 0; scrollStart = window.scrollY;
      dragging = true;
      knob.setPointerCapture(e.pointerId);
      knob.style.cursor = 'grabbing';
      e.preventDefault();
    });
    knob.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const a = angleAt(e);
      let d = a - lastAngle;
      if (d > 180) d -= 360; if (d < -180) d += 360;
      accAngle += d; lastAngle = a;
      const docMax = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const scrollDelta = (accAngle / 360) * (docMax * SCROLL_PER_ROTATION);
      window.scrollTo(0, Math.max(0, Math.min(docMax, scrollStart + scrollDelta)));
    });
    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      try { knob.releasePointerCapture(e.pointerId); } catch (_) {}
      knob.style.cursor = 'grab';
    };
    knob.addEventListener('pointerup', endDrag);
    knob.addEventListener('pointercancel', endDrag);
    knob.addEventListener('lostpointercapture', endDrag);
    knob.addEventListener('keydown', (e) => {
      const docMax = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const step = window.innerHeight * 0.2;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { window.scrollBy({ top: step, behavior: 'smooth' }); e.preventDefault(); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { window.scrollBy({ top: -step, behavior: 'smooth' }); e.preventDefault(); }
      else if (e.key === 'Home') { window.scrollTo({ top: 0, behavior: 'smooth' }); e.preventDefault(); }
      else if (e.key === 'End') { window.scrollTo({ top: docMax, behavior: 'smooth' }); e.preventDefault(); }
    });
  }

// Initial layout: wait for fonts so section heights are stable.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { placeStations(); update(); });
  }
  requestAnimationFrame(() => { placeStations(); update(); });
  setTimeout(() => { placeStations(); update(); }, 300);
})();
