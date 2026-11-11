// The flat fallback when WebGL2 is missing (ink.ts is the real renderer). A reed nib is a short flat edge: sweeping it from one point
// to the next fills a parallelogram, which is where naskh's thick and thin come from, and
// why a reed's nuqta comes out as a small rhombus. Ballpoint and pencil are round.
import type { Hand } from './hand';
import type { Page, Stroke } from './compose';

export function nibHalf(hand: Hand) {
  const w = hand.nibWidth * hand.size * 0.5;
  // page y points down, so a nib held at α above the horizontal points up-right: (cos α, −sin α)
  return [Math.cos(hand.nibAngle) * w, -Math.sin(hand.nibAngle) * w] as const;
}

function segment(ctx: CanvasRenderingContext2D, hand: Hand, x0: number, y0: number, p0: number, x1: number, y1: number, p1: number) {
  const pr = Math.sqrt((p0 + p1) / 2);
  if (hand.pen === 'reed') {
    const [hx0, hy0] = nibHalf(hand);
    const k = pr * 1.05;
    const hx = hx0 * k, hy = hy0 * k;
    // a thin hairline so strokes along the nib never vanish
    const min = hand.size * (hand.pen === 'reed' ? 0.012 : 0.009);
    ctx.beginPath();
    ctx.moveTo(x0 - hx, y0 - hy);
    ctx.lineTo(x0 + hx, y0 + hy);
    ctx.lineTo(x1 + hx, y1 + hy);
    ctx.lineTo(x1 - hx, y1 - hy);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = min;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  } else {
    const w = hand.nibWidth * hand.size * (hand.pen === 'pencil' ? 0.9 + 0.2 * pr : 0.8 + 0.25 * pr);
    if (hand.pen === 'pencil') ctx.globalAlpha = 0.55 + 0.35 * Math.min(1, pr) * (0.7 + 0.3 * Math.abs(Math.sin(x1 * 1.7 + y1 * 2.3)));
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function setInk(ctx: CanvasRenderingContext2D, hand: Hand, color?: string) {
  ctx.fillStyle = color ?? hand.ink.color;
  ctx.strokeStyle = color ?? hand.ink.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

/** Draw every part of the strokes written between t0 (exclusive) and t1 (inclusive). */
export function drawBetween(ctx: CanvasRenderingContext2D, strokes: Stroke[], hand: Hand, t0: number, t1: number, color?: string) {
  setInk(ctx, hand, color);
  for (const s of strokes) {
    const p = s.pts;
    const n = p.length / 4;
    if (n < 2 || p[2] > t1 || p[(n - 1) * 4 + 2] <= t0) continue;
    for (let i = 1; i < n; i++) {
      const ta = p[(i - 1) * 4 + 2], tb = p[i * 4 + 2];
      if (tb <= t0 || ta > t1) continue;
      let xa = p[(i - 1) * 4], ya = p[(i - 1) * 4 + 1], pa = p[(i - 1) * 4 + 3];
      let xb = p[i * 4], yb = p[i * 4 + 1], pb = p[i * 4 + 3];
      const span = tb - ta || 1;
      if (ta < t0) { const u = (t0 - ta) / span; xa += (xb - xa) * u; ya += (yb - ya) * u; pa += (pb - pa) * u; }
      if (tb > t1) { const u = (t1 - ta) / span; xb = p[(i - 1) * 4] + (xb - p[(i - 1) * 4]) * u; yb = p[(i - 1) * 4 + 1] + (yb - p[(i - 1) * 4 + 1]) * u; pb = pa + (pb - pa) * u; }
      segment(ctx, hand, xa, ya, pa, xb, yb, pb);
    }
  }
}

/** Where the pen is at time t (for a nib cursor), or null between strokes. */
export function penAt(strokes: Stroke[], t: number): [number, number] | null {
  for (const s of strokes) {
    const p = s.pts, n = p.length / 4;
    if (p[2] > t || p[(n - 1) * 4 + 2] < t) continue;
    for (let i = 1; i < n; i++) {
      if (p[i * 4 + 2] >= t) {
        const ta = p[(i - 1) * 4 + 2], u = (t - ta) / (p[i * 4 + 2] - ta || 1);
        return [p[(i - 1) * 4] + (p[i * 4] - p[(i - 1) * 4]) * u, p[(i - 1) * 4 + 1] + (p[i * 4 + 1] - p[(i - 1) * 4 + 1]) * u];
      }
    }
  }
  return null;
}

export function sizeCanvas(canvas: HTMLCanvasElement, w: number, h: number) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/** Write a page out over time. Returns a controller. */
export function playPage(canvas: HTMLCanvasElement, page: Page, hand: Hand, opts: { pace?: number; from?: number; onFrame?: (t: number) => void; onDone?: () => void } = {}) {
  const ctx = sizeCanvas(canvas, page.width, page.height);
  let pace = opts.pace ?? 1;
  let tDone = opts.from ?? 0;
  if (tDone > 0) drawBetween(ctx, page.strokes, hand, -1, tDone);
  let last = performance.now();
  let raf = 0;
  let stopped = false;
  const frame = (now: number) => {
    if (stopped) return;
    const dt = Math.min(64, now - last);
    last = now;
    const next = Math.min(page.duration, tDone + dt * pace);
    drawBetween(ctx, page.strokes, hand, tDone, next);
    tDone = next;
    opts.onFrame?.(tDone);
    if (tDone >= page.duration) { opts.onDone?.(); return; }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return {
    stop() { stopped = true; cancelAnimationFrame(raf); },
    finish() { stopped = true; cancelAnimationFrame(raf); drawBetween(ctx, page.strokes, hand, tDone, page.duration); tDone = page.duration; opts.onFrame?.(tDone); opts.onDone?.(); },
    setPace(p: number) { pace = p; },
    get t() { return tDone; },
  };
}

export function drawAll(canvas: HTMLCanvasElement, page: Page, hand: Hand) {
  const ctx = sizeCanvas(canvas, page.width, page.height);
  drawBetween(ctx, page.strokes, hand, -1, page.duration);
  return ctx;
}
