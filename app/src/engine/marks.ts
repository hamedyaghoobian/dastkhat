// Crossing out. Ink never comes off the page: a deleted word is struck through, then
// struck again harder, then scribbled over.
import type { Hand } from './hand';
import type { PlacedWord, Stroke } from './compose';
import { rng } from './rng';

export function strikeStroke(w: PlacedWord, hand: Hand, level: number): Stroke {
  const r = rng(`strike:${hand.seed}:${w.index}:${level}`);
  const em = hand.size;
  const y = w.y - em * (0.18 + r.range(-0.04, 0.06));
  const pad = em * 0.08;
  const pts: number[] = [];
  let t = 0;
  const v = hand.speed * 1.6;
  const push = (x: number, yy: number) => {
    if (pts.length) t += Math.hypot(x - pts[pts.length - 4], yy - pts[pts.length - 3]) / v;
    pts.push(x, yy, t, hand.pressure * (1 + level * 0.15));
  };
  if (level < 3) {
    // first a firm line right to left, then a second one back across it, a little crooked
    {
      const yy = y + (level === 2 ? em * 0.09 : 0);
      const xs = level === 1 ? [w.x1 + pad, w.x0 - pad] : [w.x0 - pad, w.x1 + pad];
      const steps = 8;
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        push(xs[0] + (xs[1] - xs[0]) * u, yy + Math.sin(u * Math.PI) * em * r.range(-0.05, 0.05) + r.normal(0, em * 0.01));
      }
    }
  } else {
    // a scribble: tight loops across the whole word
    const loops = Math.max(4, Math.round((w.x1 - w.x0) / (em * 0.22)));
    for (let i = 0; i <= loops * 2; i++) {
      const u = i / (loops * 2);
      push(w.x1 + pad - (w.x1 - w.x0 + pad * 2) * u + r.normal(0, em * 0.03), y + (i % 2 ? -1 : 1) * em * r.range(0.16, 0.28));
    }
  }
  return { pts, kind: 'strike', word: w.index };
}

/** Shift a stroke's clock so it starts at t0. */
export function shiftStroke(s: Stroke, t0: number): Stroke {
  const base = s.pts[2];
  const pts = s.pts.slice();
  for (let i = 2; i < pts.length; i += 4) pts[i] = pts[i] - base + t0;
  return { ...s, pts };
}
