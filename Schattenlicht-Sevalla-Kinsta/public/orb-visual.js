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

/* Basis-Farbverlauf der Sphäre (irisierende Seifenblase, r,g,b) */
const BASE_STOPS = [
  [0.00, 70, 120, 235],  // beleuchtete blaue Seite (oben-links)
  [0.42, 82, 64, 214],   // blau-violett
  [0.72, 128, 50, 196],  // violett
  [1.00, 118, 34, 118],  // magenta-dunkel (Terminator unten-rechts)
];
const ERROR_STOPS = [
  [0.00, 150, 70, 96],
  [0.5, 110, 48, 96],
  [1.00, 70, 28, 74],
];

/* Pro-Zustand-Charakteristik: band = Fluss der Iris-Bänder, drift = Rotation */
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

  const render = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    const p = currentProfile();
    const target = getLevel();
    level = lerp(level, target, 0.18);
    phase += dt * p.band * (0.7 + level * 0.9);
    rot += dt * p.drift * (1 + level * 0.5);

    const t = now / 1000;
    const mood = getMood(t);
    hue = lerp(hue, mood.hue, 0.02); // sanfter Farbwechsel
    const sat = p.error ? 0.85 : mood.sat;
    const bright = p.bright * (0.85 + level * 0.3);
    const c = size / 2;
    const R = size / 2;

    ctx.clearRect(0, 0, size, size);

    // 1) Basis-Sphäre – diagonaler Farbverlauf, per Hue-Shift eingefärbt.
    const stops = p.error ? ERROR_STOPS : BASE_STOPS;
    const lg = ctx.createLinearGradient(c - R * 0.66, c - R * 0.72, c + R * 0.6, c + R * 0.86);
    for (const [pos, r, g, b] of stops) {
      const [sr, sg, sb] = p.error ? [r, g, b] : shift([r, g, b], hue, sat);
      lg.addColorStop(pos, `rgb(${sr},${sg},${sb})`);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, size, size);

    // 2) Sphärische Schattierung – dunkler Terminator unten-rechts.
    const term = ctx.createRadialGradient(c - R * 0.34, c - R * 0.4, R * 0.15, c + R * 0.16, c + R * 0.22, R * 1.25);
    term.addColorStop(0, 'rgba(0,0,0,0)');
    term.addColorStop(0.62, 'rgba(8,4,24,0.16)');
    term.addColorStop(1, 'rgba(4,2,14,0.78)');
    ctx.fillStyle = term;
    ctx.fillRect(0, 0, size, size);

    // 3) Irisierende Thin-Film-Bänder – additiv, rotierend/fließend.
    const ir = (rgb, alpha) => {
      const [r, g, b] = p.error ? rgb : shift(rgb, hue, sat);
      return `rgba(${r},${g},${b},${alpha})`;
    };
    const wrap = (x) => -1.25 + (((x % 2.5) + 2.5) % 2.5);
    const band = (angle, m, colA, colB, colC, a) => {
      ctx.save();
      ctx.rotate(angle);
      const cl = (x) => Math.max(0, Math.min(1, x));
      const pos = cl((m + 1) / 2);
      const w = 0.17;
      const g = ctx.createLinearGradient(-R, 0, R, 0);
      g.addColorStop(cl(pos - w), 'rgba(0,0,0,0)');
      g.addColorStop(cl(pos - w * 0.45), colA);
      g.addColorStop(cl(pos), colB);
      g.addColorStop(cl(pos + w * 0.45), colC);
      g.addColorStop(cl(pos + w), 'rgba(0,0,0,0)');
      ctx.globalAlpha = a * bright;
      ctx.fillStyle = g;
      ctx.fillRect(-R, -R, 2 * R, 2 * R);
      ctx.restore();
    };
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.translate(c, c);
    ctx.rotate(rot);
    band(0.55, wrap(phase), ir([90, 210, 255], 0.9), ir([220, 232, 255], 0.85), ir([240, 96, 220], 0.9), 0.30);
    band(0.55, wrap(phase * 0.7 + 1.1), ir([120, 230, 180], 0.8), ir([210, 225, 255], 0.7), ir([120, 140, 255], 0.8), 0.20);
    band(-0.35, wrap(phase * 1.25 + 1.9), ir([240, 110, 220], 0.8), ir([230, 235, 255], 0.7), ir([90, 200, 255], 0.8), 0.18);
    ctx.restore();
    ctx.globalAlpha = 1;

    // 4) Fresnel-Rand (heller Umriss).
    ctx.globalCompositeOperation = 'screen';
    const [rr, rg, rb] = p.error ? [220, 120, 140] : shift([120, 180, 255], hue, sat);
    const rim = ctx.createRadialGradient(c, c, R * 0.6, c, c, R);
    rim.addColorStop(0, 'rgba(0,0,0,0)');
    rim.addColorStop(0.82, 'rgba(60,120,220,0)');
    rim.addColorStop(0.93, `rgba(${rr},${rg},${rb},${(0.5 * bright).toFixed(3)})`);
    rim.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rim;
    ctx.fillRect(0, 0, size, size);

    // 5) Heller Halbmond + Glanzpunkt oben-links (Glossy-Look).
    const hx = c - R * 0.46, hy = c - R * 0.52;
    const [cr, cg, cb] = p.error ? [230, 180, 190] : shift([170, 205, 255], hue * 0.5, sat);
    const cres = ctx.createRadialGradient(hx, hy, 0, hx, hy, R * 0.6);
    cres.addColorStop(0, `rgba(${cr},${cg},${cb},${(0.42 * bright).toFixed(3)})`);
    cres.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = cres;
    ctx.fillRect(0, 0, size, size);

    const sp = ctx.createRadialGradient(hx, hy, 0, hx, hy, R * 0.2);
    sp.addColorStop(0, `rgba(255,255,255,${(0.45 * bright).toFixed(3)})`);
    sp.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sp;
    ctx.fillRect(0, 0, size, size);

    // 6) Auf einen Kreis maskieren (Ecken sauber halten, GPU-Clip unzuverlässig).
    ctx.globalCompositeOperation = 'destination-in';
    ctx.beginPath();
    ctx.arc(c, c, R * 0.995, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
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
