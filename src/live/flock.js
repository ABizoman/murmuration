// A starling murmuration on a 2D canvas.
//
// Each bird follows Reynolds' three rules (separation, alignment, cohesion), but like real starlings
// it only looks at its ~7 nearest neighbours, not everyone within a radius. That topological rule
// is what gives the flock its rippling waves. On top of that: a moving attractor (where the flock
// wants to be), a gentle wind field, soft screen bounds, impulses from the music (kick = shockwave),
// and a "form" mode where birds fly into the shape of a word and then let go.
//
// Pure canvas, no dependencies. Positions are in device pixels.

const NEIGHBOURS = 7;

export class Flock {
  constructor(count, width, height, scale = 1) {
    this.n = count;
    this.x = new Float32Array(count);
    this.y = new Float32Array(count);
    this.vx = new Float32Array(count);
    this.vy = new Float32Array(count);
    this.z = new Float32Array(count); // depth 0.45..1: size and darkness
    this.tx = new Float32Array(count).fill(NaN); // formation target
    this.ty = new Float32Array(count).fill(NaN);
    this.tint = new Int8Array(count).fill(-1); // role index while lit by a note
    this.tintUntil = new Float32Array(count);
    this.order = new Int32Array(count);
    this.cellOf = new Int32Array(count);
    this.t = 0;
    this.scale = scale;
    this.resize(width, height);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * Math.min(width, height) * 0.25;
      this.x[i] = width / 2 + Math.cos(a) * r;
      this.y[i] = height * 0.42 + Math.sin(a) * r * 0.5;
      this.vx[i] = (Math.random() - 0.5) * 80 * scale;
      this.vy[i] = (Math.random() - 0.5) * 80 * scale;
      this.z[i] = 0.45 + Math.random() * 0.55;
    }
  }

  resize(width, height) {
    this.w = width;
    this.h = height;
    this.R = 26 * this.scale; // neighbour search radius
    this.cols = Math.max(1, Math.ceil(width / this.R) + 2);
    this.rows = Math.max(1, Math.ceil(height / this.R) + 2);
    this.cellStart = new Int32Array(this.cols * this.rows + 1);
  }

  cell(x, y) {
    const c = Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.R) + 1));
    const r = Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.R) + 1));
    return r * this.cols + c;
  }

  // Counting sort of birds into grid cells, for O(n) neighbour lookups.
  bucket() {
    const { n, cellStart, cellOf, order } = this;
    cellStart.fill(0);
    for (let i = 0; i < n; i++) { const c = this.cell(this.x[i], this.y[i]); cellOf[i] = c; cellStart[c + 1]++; }
    for (let c = 1; c < cellStart.length; c++) cellStart[c] += cellStart[c - 1];
    const fill = cellStart.slice(0, -1);
    for (let i = 0; i < n; i++) order[fill[cellOf[i]]++] = i;
  }

  // opts: { ax, ay } attractor, energy 0..1 (speed), tight 0..1 (cohesion)
  step(dt, opts) {
    dt = Math.min(dt, 1 / 30);
    this.t += dt;
    const s = this.scale, t = this.t;
    const energy = opts.energy ?? 0.4, tight = opts.tight ?? 0.5;
    const vmax = (95 + 120 * energy) * s, vmin = 45 * s;
    const R = this.R, R2 = R * R, sep = R * 0.42, sep2 = sep * sep;
    const margin = Math.min(this.w, this.h) * 0.08;
    this.bucket();
    const { x, y, vx, vy, tx, ty, cellStart, order, cols } = this;

    for (let i = 0; i < this.n; i++) {
      const px = x[i], py = y[i];
      let fx = 0, fy = 0;

      if (!Number.isNaN(tx[i])) {
        // forming a word: arrive at the target, with a shimmer
        const dx = tx[i] - px + Math.sin(t * 3 + i) * 1.2 * s, dy = ty[i] - py + Math.cos(t * 2.6 + i * 1.7) * 1.2 * s;
        const k = Math.min(1, dt * 10);
        vx[i] += (dx * 8 - vx[i]) * k;
        vy[i] += (dy * 8 - vy[i]) * k;
        x[i] += vx[i] * dt;
        y[i] += vy[i] * dt;
        continue;
      }

      // the 7 nearest-ish neighbours from the 3x3 cells around this bird
      let cnt = 0, ax = 0, ay = 0, cx = 0, cy = 0, sx = 0, sy = 0;
      const c0 = this.cellOf[i];
      search:
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const c = c0 + dr * cols + dc;
          if (c < 0 || c >= cellStart.length - 1) continue;
          for (let k = cellStart[c]; k < cellStart[c + 1]; k++) {
            const j = order[k];
            if (j === i || !Number.isNaN(tx[j])) continue;
            const dx = x[j] - px, dy = y[j] - py, d2 = dx * dx + dy * dy;
            if (d2 > R2) continue;
            ax += vx[j]; ay += vy[j]; cx += dx; cy += dy;
            if (d2 < sep2 && d2 > 0.01) { const inv = 1 / d2; sx -= dx * inv; sy -= dy * inv; }
            if (++cnt >= NEIGHBOURS) break search;
          }
        }
      }
      if (cnt) {
        fx += (ax / cnt - vx[i]) * 1.6; // alignment
        fy += (ay / cnt - vy[i]) * 1.6;
        fx += (cx / cnt) * (0.9 + tight * 1.4); // cohesion
        fy += (cy / cnt) * (0.9 + tight * 1.4);
        fx += sx * 900 * s; // separation
        fy += sy * 900 * s;
      }

      // attractor: where the flock as a whole wants to be
      const adx = opts.ax - px, ady = opts.ay - py;
      const ad = Math.sqrt(adx * adx + ady * ady) + 1;
      const pull = (18 + 30 * tight) * s;
      fx += (adx / ad) * pull + adx * 0.04;
      fy += (ady / ad) * pull + ady * 0.04;

      // wind: a slowly turning field, so the flock folds and ripples
      const wa = Math.sin(px * 0.0035 / s + t * 0.35) * 1.4 + Math.cos(py * 0.0042 / s - t * 0.28) * 1.2 + t * 0.05;
      fx += Math.cos(wa) * 26 * s;
      fy += Math.sin(wa) * 26 * s;

      // soft walls
      if (px < margin) fx += (margin - px) * 3; else if (px > this.w - margin) fx -= (px - this.w + margin) * 3;
      if (py < margin) fy += (margin - py) * 3; else if (py > this.h - margin) fy -= (py - this.h + margin) * 3;

      let nvx = vx[i] + fx * dt, nvy = vy[i] + fy * dt;
      const sp = Math.sqrt(nvx * nvx + nvy * nvy) + 1e-6;
      const lim = sp > vmax ? vmax / sp : sp < vmin ? vmin / sp : 1;
      vx[i] = nvx * lim;
      vy[i] = nvy * lim;
      x[i] = px + vx[i] * dt;
      y[i] = py + vy[i] * dt;
    }
  }

  // A shockwave from (x, y): birds within radius are thrown outwards.
  impulse(x0, y0, strength, radius) {
    const r2 = radius * radius;
    for (let i = 0; i < this.n; i++) {
      if (!Number.isNaN(this.tx[i])) continue;
      const dx = this.x[i] - x0, dy = this.y[i] - y0, d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const d = Math.sqrt(d2) + 1, f = strength * (1 - d / radius);
      this.vx[i] += (dx / d) * f;
      this.vy[i] += (dy / d) * f;
    }
  }

  // A random jolt to a share of the flock.
  scatter(share, strength) {
    for (let i = 0; i < this.n; i++) {
      if (Math.random() > share || !Number.isNaN(this.tx[i])) continue;
      const a = Math.random() * Math.PI * 2;
      this.vx[i] += Math.cos(a) * strength;
      this.vy[i] += Math.sin(a) * strength;
    }
  }

  // Light up a share of the birds in a part's colour for a moment.
  light(role, share, ms, now) {
    for (let i = 0; i < this.n; i++) {
      if (Math.random() > share) continue;
      this.tint[i] = role;
      this.tintUntil[i] = now + ms * (0.6 + Math.random() * 0.8);
    }
  }

  // Fly into the shape given by points [[x, y], ...]. Returns how many birds were used.
  form(points) {
    this.release(0);
    const idx = Array.from({ length: this.n }, (_, i) => i).sort(() => Math.random() - 0.5);
    const m = Math.min(points.length, Math.floor(this.n * 0.85));
    for (let k = 0; k < m; k++) { const i = idx[k]; this.tx[i] = points[k][0]; this.ty[i] = points[k][1]; }
    return m;
  }

  // Let go of the formation, with an outward burst.
  release(burst = 0) {
    let mx = 0, my = 0, c = 0;
    for (let i = 0; i < this.n; i++) if (!Number.isNaN(this.tx[i])) { mx += this.x[i]; my += this.y[i]; c++; }
    if (c) { mx /= c; my /= c; }
    for (let i = 0; i < this.n; i++) {
      if (Number.isNaN(this.tx[i])) continue;
      this.tx[i] = NaN;
      this.ty[i] = NaN;
      if (burst) {
        const dx = this.x[i] - mx, dy = this.y[i] - my, d = Math.sqrt(dx * dx + dy * dy) + 1;
        this.vx[i] = (dx / d) * burst * (0.5 + Math.random()) + (Math.random() - 0.5) * burst * 0.4;
        this.vy[i] = (dy / d) * burst * (0.5 + Math.random()) + (Math.random() - 0.5) * burst * 0.4;
      }
    }
  }

  get forming() {
    for (let i = 0; i < this.n; i += 7) if (!Number.isNaN(this.tx[i])) return true;
    return false;
  }

  centroid() {
    let mx = 0, my = 0;
    for (let i = 0; i < this.n; i++) { mx += this.x[i]; my += this.y[i]; }
    return [mx / this.n, my / this.n];
  }

  // Birds as short ink strokes along their heading; lit birds in their part's colour.
  draw(g, ink, colors, now) {
    const s = this.scale;
    g.lineCap = 'round';
    for (const [lo, hi, width, alpha] of [[0, 0.72, 1.1, 0.55], [0.72, 1.01, 1.7, 0.9]]) {
      g.beginPath();
      for (let i = 0; i < this.n; i++) {
        const z = this.z[i];
        if (z < lo || z >= hi || (this.tint[i] >= 0 && this.tintUntil[i] > now) || !Number.isNaN(this.tx[i])) continue;
        const sp = Math.hypot(this.vx[i], this.vy[i]) + 1e-6;
        const len = (2.2 + 2.6 * z) * s;
        const ux = this.vx[i] / sp, uy = this.vy[i] / sp;
        // a tiny "v": two wings swept back from the head, flapping
        const flap = (0.55 + 0.35 * Math.sin(now * 0.02 + i)) * len;
        const hx = this.x[i] + ux * len * 0.5, hy = this.y[i] + uy * len * 0.5;
        g.moveTo(hx - ux * len - uy * flap, hy - uy * len + ux * flap);
        g.lineTo(hx, hy);
        g.lineTo(hx - ux * len + uy * flap, hy - uy * len - ux * flap);
      }
      g.strokeStyle = `rgba(${ink},${alpha})`;
      g.lineWidth = width * s;
      g.stroke();
    }
    // birds holding a word: small round dots, so the letters read cleanly
    g.beginPath();
    for (let i = 0; i < this.n; i++) {
      if (Number.isNaN(this.tx[i])) continue;
      const r = (1.15 + 0.5 * this.z[i]) * s;
      g.moveTo(this.x[i] + r, this.y[i]);
      g.arc(this.x[i], this.y[i], r, 0, Math.PI * 2);
    }
    g.fillStyle = `rgba(${ink},0.92)`;
    g.fill();
    // lit birds
    g.globalCompositeOperation = 'lighter';
    for (let r = 0; r < colors.length; r++) {
      g.beginPath();
      let any = false;
      for (let i = 0; i < this.n; i++) {
        if (this.tint[i] !== r || this.tintUntil[i] <= now) continue;
        any = true;
        g.moveTo(this.x[i] + 2.6 * s, this.y[i]);
        g.arc(this.x[i], this.y[i], 2.6 * s * this.z[i], 0, Math.PI * 2);
      }
      if (!any) continue;
      g.fillStyle = colors[r];
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  }
}

// Sample the dark pixels of a word set in the given font, centred in a box. Returns [[x, y], ...].
export function textPoints(text, font, box, maxPoints) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(box.w));
  c.height = Math.max(1, Math.round(box.h));
  const g = c.getContext('2d', { willReadFrequently: true });
  let size = box.h * 0.8;
  g.font = font(size);
  const w = g.measureText(text).width;
  if (w > box.w * 0.94) size *= (box.w * 0.94) / w;
  g.font = font(size);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#000';
  g.fillText(text, box.w / 2, box.h / 2);
  const data = g.getImageData(0, 0, c.width, c.height).data;
  const pts = [];
  const step = Math.max(1, Math.round(Math.sqrt((box.w * box.h) / (maxPoints * 6))));
  for (let y = 0; y < c.height; y += step) {
    for (let x = 0; x < c.width; x += step) {
      if (data[(y * c.width + x) * 4 + 3] > 128) pts.push([box.x + x + (Math.random() - 0.5) * step, box.y + y + (Math.random() - 0.5) * step]);
    }
  }
  for (let i = pts.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pts[i], pts[j]] = [pts[j], pts[i]]; }
  return pts.slice(0, maxPoints);
}