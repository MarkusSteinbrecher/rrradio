// ──────────────────────────────────────────────────────────
// Tuner wiring — the dial scrubs through the page as you scroll.
// ──────────────────────────────────────────────────────────
(function tuner() {
  const el = document.querySelector('.tuner');
  if (!el) return;
  const track = el.querySelector('.tuner__track');
  const freqEl = el.querySelector('.tuner__freq');
  const knob = el.querySelector('.tuner__knob--control');
  const scope = el.querySelector('.tuner__scope');
  const scopeCanvas = scope ? scope.querySelector('canvas') : null;
  const scopeText = scope ? scope.querySelector('.tuner__scope-text') : null;
  const scopeFreq = scope ? scope.querySelector('.tuner__scope-freq') : null;
  let scopeLockDist = 1;
  const navEl = document.querySelector('.nav');

  const MIN = 87.5, MAX = 108.0;
  const RANGE = MAX - MIN;
  const PX = 60; // pixels per MHz on the track

  // — 1. tick marks: 0.1 MHz minor, 0.5 half, integer major (with label)
  const frag = document.createDocumentFragment();
  for (let i = 0; i <= RANGE * 10 + 0.5; i++) {
    const f = MIN + i / 10;
    const tick = document.createElement('div');
    const isInt = Math.abs(f - Math.round(f)) < 0.05;
    const isHalf = !isInt && Math.abs((f * 10) % 5) < 0.5;
    tick.className = 'tuner__tick' + (isInt ? ' tuner__tick--major' : (isHalf ? ' tuner__tick--half' : ''));
    tick.style.left = ((f - MIN) * PX) + 'px';
    if (isInt) {
      const lab = document.createElement('span');
      lab.className = 'tuner__tick-label';
      lab.textContent = Math.round(f);
      tick.appendChild(lab);
    }
    frag.appendChild(tick);
  }
  track.appendChild(frag);

  // — 2. station labels: every <section class="s"> in the doc gets a chip
  let stations = [];
  function placeStations() {
    stations.forEach(s => s.btn.remove());
    stations = [];
    const secs = [...document.querySelectorAll('main.doc .s')];
    const docMax = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    secs.forEach((sec) => {
      const absTop = sec.getBoundingClientRect().top + window.scrollY;
      const p = Math.max(0, Math.min(1, absTop / docMax));
      const f = MIN + p * RANGE;
      const numSpan = sec.querySelector('.s__num');
      const num = numSpan ? numSpan.textContent.trim() : '—';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tuner__station';
      btn.textContent = num;
      btn.style.left = ((f - MIN) * PX) + 'px';
      btn.dataset.freq = f.toFixed(2);
      const titleEl = sec.querySelector('.s__name');
      const title = titleEl ? titleEl.textContent.trim() : num;
      btn.addEventListener('click', () => {
        const offset = (navEl ? navEl.offsetHeight : 60) + el.offsetHeight + 18;
        const target = sec.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top: target, behavior: 'smooth' });
      });
      track.appendChild(btn);
      stations.push({ btn, f, title });
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
    if (freqEl) freqEl.textContent = f.toFixed(1);

    // highlight the station the needle is currently over (within 0.4 MHz)
    let nearest = null, dist = Infinity;
    stations.forEach(s => {
      s.btn.classList.remove('is-current');
      const d = Math.abs(s.f - f);
      if (d < dist) { dist = d; nearest = s; }
    });
    if (nearest && dist < 0.45) nearest.btn.classList.add('is-current');

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
