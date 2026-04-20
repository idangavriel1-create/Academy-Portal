/**
 * Animated neon-blue particle background.
 * Lightweight: ~80 particles with connecting lines within ~120px.
 * Pauses itself when the page is hidden (saves CPU on tablets).
 */
(function () {
  const canvas = document.getElementById('bg-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d', { alpha: true });
  const PARTICLE_COUNT = 80;
  const LINK_DIST = 120;
  const LINK_DIST_SQ = LINK_DIST * LINK_DIST;

  let w = 0, h = 0, particles = [], running = true, rafId = null;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.width  = Math.floor(window.innerWidth  * dpr);
    h = canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width  = window.innerWidth  + 'px';
    canvas.style.height = window.innerHeight + 'px';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    w = window.innerWidth;
    h = window.innerHeight;
  }

  class Particle {
    constructor() { this.reset(true); }
    reset(randomPosition) {
      this.x = randomPosition ? Math.random() * w : (Math.random() < 0.5 ? 0 : w);
      this.y = randomPosition ? Math.random() * h : Math.random() * h;
      this.sx = (Math.random() - 0.5) * 0.8;
      this.sy = (Math.random() - 0.5) * 0.8;
    }
    step() {
      this.x += this.sx;
      this.y += this.sy;
      if (this.x > w || this.x < 0 || this.y > h || this.y < 0) this.reset(true);
    }
  }

  function init() {
    resize();
    particles = Array.from({ length: PARTICLE_COUNT }, () => new Particle());
  }

  function animate() {
    if (!running) return;
    ctx.clearRect(0, 0, w, h);

    // Draw particles
    ctx.fillStyle = 'rgba(0, 212, 255, 0.8)';
    for (const p of particles) {
      p.step();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw links
    for (let i = 0; i < particles.length; i++) {
      const a = particles[i];
      for (let j = i + 1; j < particles.length; j++) {
        const b = particles[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < LINK_DIST_SQ) {
          const alpha = 0.4 - Math.sqrt(d2) / 400;
          ctx.strokeStyle = `rgba(0, 212, 255, ${alpha})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    rafId = requestAnimationFrame(animate);
  }

  function start() {
    if (rafId) return;
    running = true;
    animate();
  }
  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  window.addEventListener('resize', () => { resize(); }, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop(); else start();
  });

  init();
  start();
})();
