// "Hyperspace" celebration: star streaks and dog heads fly out from the
// centre of the screen toward the viewer. Plays after a dose is logged.
// Draws on a full-screen canvas that ignores taps and removes itself.

const HEAD_SRC = 'images/dog-head.webp';
let headImg = null;

export function preloadHyperspace() {
  if (!headImg) {
    headImg = new Image();
    headImg.decoding = 'async';
    headImg.src = HEAD_SRC;
  }
  return headImg;
}

const rnd = (a, b) => a + Math.random() * (b - a);

export function hyperspace({ duration = 2400, heads = 34, stars = 180 } = {}) {
  const img = preloadHyperspace();
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const canvas = document.createElement('canvas');
  canvas.className = 'hyperspace';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let w = 0;
  let h = 0;
  function resize() {
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();

  // Reduce Motion: one head fades in and out in the middle, no flying.
  if (reduce) {
    return new Promise((resolve) => {
      const start = performance.now();
      function frame(now) {
        const t = (now - start) / 1200;
        if (t >= 1) { canvas.remove(); resolve(); return; }
        const a = Math.sin(Math.PI * t);
        ctx.clearRect(0, 0, w, h);
        ctx.globalAlpha = a;
        const size = Math.min(w, h) * 0.45;
        if (img.complete && img.naturalWidth) {
          const ratio = img.naturalWidth / img.naturalHeight;
          ctx.drawImage(img, w / 2 - (size * ratio) / 2, h / 2 - size / 2, size * ratio, size);
        }
        ctx.globalAlpha = 1;
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  }

  const starList = Array.from({ length: stars }, () => ({ x: rnd(-1, 1), y: rnd(-1, 1), z: rnd(0.05, 1), pz: 0 }));
  for (const s of starList) s.pz = s.z;
  // Heads start spread out in depth so they arrive one after another.
  const headList = Array.from({ length: heads }, (_, i) => ({
    x: rnd(-0.55, 0.55), y: rnd(-0.55, 0.55),
    z: 1 + (i / heads) * 1.6,
    rot: rnd(-0.6, 0.6), spin: rnd(-2.5, 2.5)
  }));

  return new Promise((resolve) => {
    const start = performance.now();
    let last = start;
    function frame(now) {
      const t = now - start;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (t >= duration) { canvas.remove(); resolve(); return; }

      // Jump to light speed: ease in, cruise, then fade out.
      const ramp = Math.min(1, t / 450);
      const speed = 0.25 + 1.6 * ramp * ramp;
      const fadeOut = Math.max(0, Math.min(1, (duration - t) / 450));
      const bg = Math.min(1, t / 250) * fadeOut;

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = `rgba(4, 7, 20, ${0.95 * bg})`;
      ctx.fillRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const scale = Math.min(w, h) * 0.5;

      // Star streaks.
      ctx.lineCap = 'round';
      for (const s of starList) {
        s.pz = s.z;
        s.z -= speed * dt;
        if (s.z <= 0.03) {
          s.x = rnd(-1, 1); s.y = rnd(-1, 1); s.z = 1; s.pz = 1;
          continue;
        }
        const x1 = cx + (s.x / s.pz) * scale;
        const y1 = cy + (s.y / s.pz) * scale;
        const x2 = cx + (s.x / s.z) * scale;
        const y2 = cy + (s.y / s.z) * scale;
        const near = 1 - s.z;
        ctx.strokeStyle = `rgba(210, 225, 255, ${(0.25 + 0.75 * near) * fadeOut})`;
        ctx.lineWidth = 0.6 + 2.2 * near;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      // Dog heads, farthest first so nearer ones draw on top.
      if (img.complete && img.naturalWidth) {
        const ratio = img.naturalWidth / img.naturalHeight;
        const base = Math.min(w, h) * 0.07;
        headList.sort((a, b) => b.z - a.z);
        for (const hd of headList) {
          hd.z -= speed * dt * 0.75;
          hd.rot += hd.spin * dt;
          if (hd.z <= 0.06) {
            // Keep the stream going until near the end.
            if (t < duration - 900) {
              hd.x = rnd(-0.55, 0.55); hd.y = rnd(-0.55, 0.55); hd.z = rnd(1, 1.4);
            }
            continue;
          }
          if (hd.z > 1) continue; // not visible yet
          const size = base / hd.z;
          const x = cx + (hd.x / hd.z) * scale;
          const y = cy + (hd.y / hd.z) * scale;
          const appear = Math.min(1, (1 - hd.z) * 4);
          ctx.globalAlpha = appear * fadeOut;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(hd.rot);
          ctx.drawImage(img, (-size * ratio) / 2, -size / 2, size * ratio, size);
          ctx.restore();
        }
        ctx.globalAlpha = 1;
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
}
