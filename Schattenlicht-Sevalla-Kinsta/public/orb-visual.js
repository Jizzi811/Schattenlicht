/* =====================================================================
   Schattenlicht Voice-Orb – visuelle Ebene
   Baut die Orb-Ebenen auf und rendert im Canvas einen lebendigen
   Plasma-/Nebula-Kern. Reagiert auf [data-state] und den Audiopegel,
   den orb-agent.js über die CSS-Variable --orb-level (und orb._orbLevel)
   bereitstellt. Die Zustandslogik und LiveKit-Anbindung bleiben in
   orb-agent.js – hier passiert ausschließlich Darstellung.
   ===================================================================== */

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const IS_MOBILE = window.matchMedia('(max-width: 720px)').matches;

/* Pro-Zustand-Charakteristik: band = Fluss der Wellen, drift = Rotation */
const STATE_PROFILE = {
  ready:        { band: 0.18, drift: 0.02, bright: 0.92, error: false },
  idle:         { band: 0.18, drift: 0.02, bright: 0.96, error: false },
  connecting:   { band: 0.52, drift: 0.05, bright: 1.06, error: false },
  initializing: { band: 0.42, drift: 0.05, bright: 1.0,  error: false },
  listening:    { band: 0.3,  drift: 0.03, bright: 1.08, error: false },
  thinking:     { band: 0.32, drift: 0.16, bright: 0.95, error: false },
  speaking:     { band: 0.6,  drift: 0.07, bright: 1.14, error: false },
  audioBlocked: { band: 0.2,  drift: 0.02, bright: 0.9,  error: false },
  disconnected: { band: 0.1,  drift: 0.01, bright: 0.75, error: false },
  error:        { band: 0.12, drift: 0.01, bright: 0.72, error: true },
  microphoneDenied: { band: 0.12, drift: 0.01, bright: 0.72, error: true },
};

function waitForElement(selector, timeoutMs = 20000) {
  const existing = document.querySelector(selector);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Element ${selector} wurde nicht gefunden.`));
    }, timeoutMs);
    const observer = new MutationObserver(() => {
      const element = document.querySelector(selector);
      if (!element) return;
      window.clearTimeout(timeout);
      observer.disconnect();
      resolve(element);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}

function makeLayer(className) {
  const element = document.createElement('span');
  element.className = className;
  element.setAttribute('aria-hidden', 'true');
  return element;
}

// Ebenen stehen bereits im HTML (SSR/Hydration-sicher). Falls sie fehlen,
// werden sie hier defensiv nachgebaut, damit der Orb immer funktioniert.
function ensureLayers(orb) {
  let shell = orb.querySelector('.sl-orb-shell');
  if (!orb.querySelector('.sl-orb-aura')) orb.prepend(makeLayer('sl-orb-aura'));
  if (!shell) {
    shell = makeLayer('sl-orb-shell');
    orb.prepend(shell);
  }
  let canvas = shell.querySelector('.sl-orb-canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'sl-orb-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    shell.appendChild(canvas);
  }
  if (!orb.querySelector('.sl-orb-sheen')) orb.appendChild(makeLayer('sl-orb-sheen'));
  const sparks = orb.querySelectorAll('.sl-orb-spark').length;
  for (let i = sparks; i < 4; i++) orb.appendChild(makeLayer('sl-orb-spark'));
  return canvas;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/* Stimmungs-Presets: verschieben Farbton (Grad) und Sättigung der Sphäre.
   Über orb.dataset.mood setzbar – so lässt sich die Farbe an die Stimmung
   koppeln. Ohne mood driftet die Farbe langsam von selbst (ambient). */
const MOODS = {
  neutral: { hue: 0,   sat: 1.0 },
  calm:    { hue: -18, sat: 0.95 }, // ruhiger, kühler Blauton
  cool:    { hue: -46, sat: 1.0 },  // Cyan/Teal
  deep:    { hue: 18,  sat: 1.02 }, // tiefes Violett
  warm:    { hue: 52,  sat: 1.05 }, // Magenta/Pink
  tender:  { hue: 40,  sat: 0.9 },  // sanftes Rosé
  alert:   { hue: 92,  sat: 1.1 },  // rötlich-warnend
};

// RGB -> HSL -> Rotation -> RGB, damit die ganze Sphäre den Farbton wechselt.
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h * 360, s, l];
}
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = (t) => {
    t = (t % 1 + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(hk(h + 1 / 3) * 255), Math.round(hk(h) * 255), Math.round(hk(h - 1 / 3) * 255)];
}
// Farbton drehen + Sättigung skalieren.
function shift([r, g, b], deg, satMul) {
  const [h, s, l] = rgbToHsl(r, g, b);
  return hslToRgb(h + deg, Math.max(0, Math.min(1, s * satMul)), l);
}

async function init() {
  let orb;
  try {
    orb = await waitForElement('#schattenlicht-orb');
  } catch {
    return;
  }

  const canvas = ensureLayers(orb);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  orb.classList.add('is-canvas-ready');

  const dpr = Math.min(window.devicePixelRatio || 1, IS_MOBILE ? 1.6 : 2);
  let size = 0;

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const css = Math.max(1, Math.round(rect.width || orb.clientWidth || 180));
    size = css;
    canvas.width = Math.round(css * dpr);
    canvas.height = Math.round(css * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();

  const ro = ('ResizeObserver' in window) ? new ResizeObserver(resize) : null;
  ro?.observe(canvas);
  window.addEventListener('resize', resize, { passive: true });

  const currentProfile = () => {
    const state = orb.dataset.state || 'ready';
    return STATE_PROFILE[state] || STATE_PROFILE.ready;
  };

  const getLevel = () => {
    const direct = orb._orbLevel;
    if (typeof direct === 'number' && !Number.isNaN(direct)) return direct;
    const css = parseFloat(getComputedStyle(orb).getPropertyValue('--orb-level'));
    return Number.isNaN(css) ? 0 : css;
  };

  let level = 0;   // geglätteter Audiopegel
  let rot = 0;     // Rotation der Iris-Bänder
  let phase = 0;   // Fluss der Iris-Bänder
  let hue = 0;     // aktueller Farbton-Offset (geglättet, Stimmung)
  let last = performance.now();

  // Stimmungs-/Ambient-Farbton: langsames Driften, per data-mood steuerbar.
  const getMood = (t) => {
    const key = orb.dataset.mood;
    const preset = key && MOODS[key] ? MOODS[key] : null;
    const ambient = Math.sin(t * 0.05) * 18 + Math.sin(t * 0.017) * 8; // ±~26°
    if (preset) return { hue: preset.hue + ambient * 0.35, sat: preset.sat };
    return { hue: ambient, sat: 1.0 };
  };

  const layers = IS_MOBILE ? 5 : 8;   // Anzahl wellenförmiger Membran-Schichten
  const steps = IS_MOBILE ? 84 : 128;  // Auflösung der Wellen-Pfade
  const LOBES = 6;                     // Grundzahl der organischen Lappen

  const render = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    const p = currentProfile();
    const target = getLevel();
    level = lerp(level, target, 0.18);
    phase += dt * p.band * (0.85 + level * 1.1);       // Fluss der Wellen
    rot += dt * (p.drift * 0.6 + 0.03) * (1 + level * 0.5); // langsame Rotation

    const t = now / 1000;
    const mood = getMood(t);
    hue = lerp(hue, mood.hue, 0.02);                   // sanfter Farbwechsel
    const sat = p.error ? 0.7 : mood.sat;
    const bright = p.bright * (0.9 + level * 0.35);
    const c = size / 2;
    const baseR = size * 0.22;                         // Grundradius des Energieblobs
    const react = 1 + level * 0.28;                    // audio-reaktives Aufblähen

    // Farbfamilie (mit Stimmung/Hue rotiert): innen pink -> violett -> außen blau
    const colInner = p.error ? [232, 120, 140] : shift([255, 140, 235], hue, sat);
    const colMid = p.error ? [180, 92, 140] : shift([190, 120, 255], hue, sat);
    const colOuter = p.error ? [128, 70, 120] : shift([110, 160, 255], hue, sat);
    const white = p.error ? [236, 200, 205] : shift([255, 236, 255], hue * 0.4, sat);
    const mix3 = (f) => {
      if (f < 0.5) { const k = f / 0.5; return [lerp(colInner[0], colMid[0], k), lerp(colInner[1], colMid[1], k), lerp(colInner[2], colMid[2], k)]; }
      const k = (f - 0.5) / 0.5; return [lerp(colMid[0], colOuter[0], k), lerp(colMid[1], colOuter[1], k), lerp(colMid[2], colOuter[2], k)];
    };

    ctx.clearRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'lighter';          // additiver Glow

    // 1) Leuchtender Kern (heller pink-weißer Mittelpunkt).
    const coreR = baseR * (1.15 + level * 0.5) * react;
    const core = ctx.createRadialGradient(c, c, 0, c, c, coreR);
    core.addColorStop(0, `rgba(${white[0]},${white[1]},${white[2]},${(0.92 * bright).toFixed(3)})`);
    core.addColorStop(0.32, `rgba(${colInner[0]},${colInner[1]},${colInner[2]},${(0.55 * bright).toFixed(3)})`);
    core.addColorStop(1, `rgba(${colInner[0]},${colInner[1]},${colInner[2]},0)`);
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(c, c, coreR, 0, Math.PI * 2);
    ctx.fill();

    // 2) Wellenförmige, leuchtende Membran-Schichten (organischer Stern-Blob).
    for (let i = 0; i < layers; i++) {
      const f = i / (layers - 1);                      // 0 innen .. 1 außen
      const rr = baseR * (0.72 + f * 1.12) * react;
      // Äußere Schichten weniger wellig -> saubere, weiche Bögen statt Fäden.
      const amp = rr * (0.13 + 0.035 * Math.sin(phase * 0.7 + i)) * (0.85 + level * 0.7) * (1 - f * 0.4);
      const pA = phase * (0.6 + i * 0.05) + i * 0.7;
      const pB = -phase * (0.4 + i * 0.04) + i * 1.3;
      const [cr, cg, cb] = mix3(f);
      const a = (0.1 + 0.16 * (1 - f)) * bright;        // innen kräftiger, außen zarter

      ctx.beginPath();
      for (let s = 0; s <= steps; s++) {
        const th = (s / steps) * Math.PI * 2 + rot + i * 0.15;
        const r = rr + amp * (Math.sin(LOBES * th + pA) + 0.4 * Math.sin((LOBES + 3) * th + pB));
        const x = c + Math.cos(th) * r;
        const y = c + Math.sin(th) * r;
        if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      // Drei Strokes statt shadowBlur (schneller, kein Renderer-Crash):
      // breiter Bloom + mittlerer Glow + schmale, helle Kernlinie – additiv.
      const rgb = `${cr | 0},${cg | 0},${cb | 0}`;
      ctx.lineJoin = 'round';
      ctx.lineWidth = 13 - f * 7;
      ctx.strokeStyle = `rgba(${rgb},${(a * 0.22).toFixed(3)})`;
      ctx.stroke();
      ctx.lineWidth = 6 - f * 3;
      ctx.strokeStyle = `rgba(${rgb},${(a * 0.5).toFixed(3)})`;
      ctx.stroke();
      ctx.lineWidth = Math.max(1, 2 - f);
      ctx.strokeStyle = `rgba(${rgb},${Math.min(1, a * 1.7).toFixed(3)})`;
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';

    if (running) rafId = requestAnimationFrame(render);
  };

  // Statischer Frame (reduzierte Bewegung / pausiert).
  const renderStatic = () => {
    last = performance.now();
    level = getLevel();
    render(performance.now());
  };

  let rafId = null;
  let running = false;

  const start = () => {
    if (running || REDUCED_MOTION) return;
    running = true;
    last = performance.now();
    rafId = requestAnimationFrame(render);
  };
  const stop = () => {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  };

  // Sichtbarkeit & Viewport: pausieren, wenn nicht sichtbar (Akku/CPU schonen).
  let onScreen = true;
  const evaluate = () => {
    if (REDUCED_MOTION) { renderStatic(); return; }
    if (onScreen && document.visibilityState === 'visible') start();
    else stop();
  };

  document.addEventListener('visibilitychange', evaluate);
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      onScreen = entries.some((e) => e.isIntersecting);
      evaluate();
    }, { threshold: 0.05 });
    io.observe(orb);
  }

  // Bei reduzierter Bewegung: statisch rendern und nur bei Zustandswechsel neu
  // zeichnen (nicht bei jeder Pegeländerung – sonst entstünde eine 60fps-Schleife).
  if (REDUCED_MOTION) {
    const mo = new MutationObserver(() => renderStatic());
    mo.observe(orb, { attributes: true, attributeFilter: ['data-state'] });
    renderStatic();
  } else {
    evaluate();
  }
}

init();
