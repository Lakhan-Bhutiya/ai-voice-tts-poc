// Ember orb — ambient canvas animation that fills the empty space below the
// script box. Three states: idle (calm breathing), generating (fast, bright,
// particles streaming), and a ~1s eased settle back down to idle.

const PARTICLE_COUNT = 40;
const SETTLE_MS = 1000;

function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function createOrb(canvas) {
  const ctx = canvas.getContext("2d");
  const reduced = prefersReducedMotion();
  let state = "idle"; // idle | generating | settling
  let settleStart = 0;
  let rafId = null;
  let running = false;

  const particles = Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
    angle: (i / PARTICLE_COUNT) * Math.PI * 2 + Math.random() * 0.3,
    radius: 0.35 + Math.random() * 0.5,
    speed: 0.5 + Math.random() * 0.8,
    size: 1 + Math.random() * 1.8,
    phase: Math.random() * Math.PI * 2,
  }));

  function colors() {
    const s = getComputedStyle(document.documentElement);
    return {
      core: s.getPropertyValue("--orb-core").trim() || "#ff4a12",
      ring1: s.getPropertyValue("--orb-ring-1").trim() || "#ff7a3d",
      ring2: s.getPropertyValue("--orb-ring-2").trim() || "#ffb067",
      spark: s.getPropertyValue("--orb-spark").trim() || "#ffd9a8",
    };
  }

  function sizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    return { w, h };
  }

  function energyFor(t) {
    if (state === "generating") return 1;
    if (state === "settling") return Math.max(0, 1 - (t - settleStart) / SETTLE_MS);
    return 0;
  }

  function draw(t) {
    const { w, h } = sizeCanvas();
    const cx = w / 2;
    const cy = h / 2;
    const base = Math.min(w, h) / 2;
    const c = colors();
    const energy = energyFor(t);
    const breathe = 0.85 + Math.sin(t / 1400) * 0.15;
    const speedMul = 1 + energy * 3.2;
    const bright = 0.55 + energy * 0.45;

    ctx.clearRect(0, 0, w, h);

    // outer bloom
    const bloomR = base * (0.62 + energy * 0.18) * breathe;
    const bloom = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(bloomR, 1));
    bloom.addColorStop(0, hexToRgba(c.ring1, 0.35 * bright));
    bloom.addColorStop(1, hexToRgba(c.ring1, 0));
    ctx.fillStyle = bloom;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(bloomR, 1), 0, Math.PI * 2);
    ctx.fill();

    // two counter-rotating ring arcs
    [0, 1].forEach((i) => {
      const dir = i === 0 ? 1 : -1;
      const rr = base * (0.4 + i * 0.14);
      const rot = (t * 0.0006 * speedMul + i * 1.3) * dir;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.strokeStyle = i === 0 ? c.ring1 : c.ring2;
      ctx.lineWidth = Math.max(1.5, base * 0.02);
      ctx.globalAlpha = bright * (i === 0 ? 0.9 : 0.55);
      ctx.shadowColor = c.ring1;
      ctx.shadowBlur = 14 * bright;
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(rr, 1), 0.4, Math.PI * 1.5);
      ctx.stroke();
      ctx.restore();
    });

    // inner sphere
    const coreR = Math.max(base * 0.26 * breathe, 1);
    const sphere = ctx.createRadialGradient(cx - coreR * 0.3, cy - coreR * 0.3, 0, cx, cy, coreR);
    sphere.addColorStop(0, c.spark);
    sphere.addColorStop(0.5, c.core);
    sphere.addColorStop(1, hexToRgba(c.core, 0.7));
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 20 * bright;
    ctx.shadowColor = c.core;
    ctx.fillStyle = sphere;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // orbiting particles
    particles.forEach((p) => {
      const a = p.angle + t * 0.00035 * speedMul * p.speed;
      const wobble = Math.sin(t * 0.002 + p.phase) * 0.05;
      const r = base * (p.radius + wobble) * (0.7 + energy * 0.5);
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r * 0.9;
      ctx.globalAlpha = (0.3 + energy * 0.5) * bright;
      ctx.fillStyle = c.spark;
      ctx.beginPath();
      ctx.arc(x, y, p.size * (0.7 + energy * 0.6), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function loop(t) {
    draw(t);
    if (state === "settling" && t - settleStart > SETTLE_MS) state = "idle";
    if (running) rafId = requestAnimationFrame(loop);
  }

  function start() {
    if (running || reduced) return;
    running = true;
    rafId = requestAnimationFrame(loop);
  }
  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else start();
  });
  window.addEventListener("themechange", () => {
    if (reduced) draw(performance.now());
  });
  window.addEventListener("resize", () => {
    if (reduced) draw(performance.now());
  });

  if (reduced) draw(0);
  else start();

  return {
    setGenerating() {
      state = "generating";
      if (reduced) draw(performance.now());
    },
    setIdle() {
      if (reduced) {
        state = "idle";
        draw(performance.now());
        return;
      }
      if (state === "generating") {
        state = "settling";
        settleStart = performance.now();
      } else {
        state = "idle";
      }
    },
  };
}
