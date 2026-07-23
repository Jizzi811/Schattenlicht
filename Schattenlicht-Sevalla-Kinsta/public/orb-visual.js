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

/* Farbpaletten (r, g, b) – violett / magenta / pink-violette Highlights */
const PALETTE = [
  [190, 132, 255], // violett
  [236, 96, 205],  // magenta
  [255, 138, 210], // pink
  [138, 108, 255], // indigo-violett
  [120, 150, 255], // kühles blau-violett
];
const ERROR_PALETTE = [
  [190, 74, 108],
  [150, 60, 120],
  [110, 52, 118],
];
const CORE_COLOR = [255, 238, 252];

/* Pro-Zustand-Charakteristik der Animation */
const STATE_PROFILE = {
  ready:        { speed: 0.55, spin: 0.05, coreBase: 0.30, coreGain: 0.35, amp: 0.16, bright: 0.9,  error: false },
  connecting:   { speed: 1.25, spin: 0.10, coreBase: 0.42, coreGain: 0.30, amp: 0.30, bright: 1.05, error: false },
  initializing: { speed: 1.05, spin: 0.10, coreBase: 0.40, coreGain: 0.30, amp: 0.26, bright: 1.0,  error: false },
  idle:         { speed: 0.55, spin: 0.05, coreBase: 0.34, coreGain: 0.40, amp: 0.18, bright: 0.95, error: false },
  listening:    { speed: 0.75, spin: 0.06, coreBase: 0.46, coreGain: 0.55, amp: 0.24, bright: 1.08, error: false },
  thinking:     { speed: 0.7,  spin: 0.55, coreBase: 0.38, coreGain: 0.30, amp: 0.30, bright: 0.9,  error: false },
  speaking:     { speed: 1.05, spin: 0.16, coreBase: 0.34, coreGain: 0.5,  amp: 0.46, bright: 1.1,  error: false },
  audioBlocked: { speed: 0.6,  spin: 0.05, coreBase: 0.34, coreGain: 0.30, amp: 0.18, bright: 0.9,  error: false },
  disconnected: { speed: 0.4,  spin: 0.03, coreBase: 0.26, coreGain: 0.20, amp: 0.12, bright: 0.75, error: false },
  error:        { speed: 0.45, spin: 0.04, coreBase: 0.24, coreGain: 0.18, amp: 0.14, bright: 0.7,  error: true },
  microphoneDenied: { speed: 0.45, spin: 0.04, coreBase: 0.24, coreGain: 0.18, amp: 0.14, bright: 0.7, error: true },
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

function mixPalette(palette, phase) {
  // Weicher Farbverlauf durch die Palette.
  const n = palette.length;
  const scaled = ((phase % 1) + 1) % 1 * n;
  const i = Math.floor(scaled);
  const frac = scaled - i;
  const c0 = palette[i % n];
  const c1 = palette[(i + 1) % n];
  return [
    Math.round(lerp(c0[0], c1[0], frac)),
    Math.round(lerp(c0[1], c1[1], frac)),
    Math.round(lerp(c0[2], c1[2], frac)),
  ];
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
  const blobCount = IS_MOBILE ? 4 : 6;
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

  // Blob-Parameter (Bewegungspfade, Frequenzen, Farbphasen).
  const blobs = Array.from({ length: blobCount }, (_, i) => ({
    fx: 0.6 + Math.random() * 0.9,
    fy: 0.6 + Math.random() * 0.9,
    px: Math.random() * Math.PI * 2,
    py: Math.random() * Math.PI * 2,
    orbit: 0.16 + Math.random() * 0.2,
    baseR: 0.34 + Math.random() * 0.18,
    hue: i / blobCount,
  }));

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
  let rot = 0;     // Rotation für innere Bewegung / Thinking
  let phase = 0;   // Farbrotation
  let last = performance.now();

  const render = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    const p = currentProfile();
    const target = getLevel();
    level = lerp(level, target, 0.18);
    rot += dt * p.spin * (1 + level * 0.6);
    phase += dt * 0.05 * p.speed;

    const c = size / 2;
    const R = size / 2;
    const palette = p.error ? ERROR_PALETTE : PALETTE;
    const energy = p.amp + level * 0.5;
    const bright = p.bright * (0.85 + level * 0.3);

    ctx.clearRect(0, 0, size, size);

    // Dunkle Basis (Tiefe im Inneren).
    const base = ctx.createRadialGradient(c, c, 0, c, c, R);
    base.addColorStop(0, 'rgba(38, 18, 60, 0.55)');
    base.addColorStop(1, 'rgba(9, 5, 20, 0.96)');
    ctx.fillStyle = base;
    ctx.beginPath();
    ctx.arc(c, c, R, 0, Math.PI * 2);
    ctx.fill();

    // Plasma-Blobs additiv überlagern.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(c, c);
    ctx.rotate(rot);

    const t = now / 1000;
    for (const b of blobs) {
      const dx = Math.sin(t * p.speed * b.fx + b.px) * b.orbit * R * (1 + energy);
      const dy = Math.cos(t * p.speed * b.fy + b.py) * b.orbit * R * (1 + energy);
      const pulse = 0.85 + 0.15 * Math.sin(t * p.speed * 1.3 + b.px);
      const radius = b.baseR * R * pulse * (1 + energy * 0.5);
      const [r, g, bl] = mixPalette(palette, phase + b.hue);
      const alpha = (0.5 + level * 0.35) * bright;

      const grad = ctx.createRadialGradient(dx, dy, 0, dx, dy, radius);
      grad.addColorStop(0, `rgba(${r}, ${g}, ${bl}, ${Math.min(0.9, alpha).toFixed(3)})`);
      grad.addColorStop(0.55, `rgba(${r}, ${g}, ${bl}, ${(alpha * 0.35).toFixed(3)})`);
      grad.addColorStop(1, `rgba(${r}, ${g}, ${bl}, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(dx, dy, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Leuchtender Kern.
    const coreR = (p.coreBase + level * p.coreGain) * R * 0.9;
    const [cr, cg, cb] = CORE_COLOR;
    const [mr, mg, mb] = p.error ? ERROR_PALETTE[0] : PALETTE[1];
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(1, coreR));
    core.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, ${Math.min(0.82, 0.66 * bright).toFixed(3)})`);
    core.addColorStop(0.4, `rgba(${mr}, ${mg}, ${mb}, ${(0.5 * bright).toFixed(3)})`);
    core.addColorStop(1, `rgba(${mr}, ${mg}, ${mb}, 0)`);
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(1, coreR), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Auf einen Kreis maskieren: additive Blobs dürfen nicht in die Ecken
    // laufen (der CSS-Rundungs-Clip greift bei GPU-Layern nicht zuverlässig).
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.beginPath();
    ctx.arc(c, c, R * 0.995, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.restore();

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
