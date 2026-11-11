// Ink as a density field, not flat paint.
//
// Ported and adapted from If This Finds You (engine/pen.js and engine/render-canvas.js, © Rafael Cespedes, MIT;
// see app/public/licenses/if-this-finds-you.txt). Their research and numbers; our strokes, pens and right-to-left hand.
//
// 1. Profile. Each stroke becomes a centreline with a width and an ink density at every point. Ink builds up where the
//    pen is slow (at turns, where it lands, where it stops), down strokes carry a little more than up strokes, a stop
//    leaves a small pool, a flick thins out. A reed is a dip pen: it is dipped every few pieces and runs dry
//    between dips. A fountain pen is wetter at the start of a word; a cold ballpoint skips.
// 2. Layers. A connected piece of a word is one pen-down, so its overlaps (junctions, joins) are merged with MAX: the
//    ink is laid once. Pieces that cross go to different layers, which are ADDED: crossings darken.
// 3. Resolve. Each layer becomes optical density with the pen's cross-section: liquid ink dries darker at the rim,
//    edges are a little rough, a ballpoint streaks and skips, graphite catches the paper's tooth, a dry reed breaks up.
// 4. Colour. Beer–Lambert per channel in linear light, T = F + (1 − F)·exp(−k·density), with paper grain showing
//    through thin ink. The output is transmittance on white; the page multiplies it over the paper below.
//
// WebGL2 + EXT_color_buffer_float, one shared offscreen context copied into each canvas with drawImage. Without it the
// old flat renderer (render.ts) is used. Deterministic: randomness comes from rng(), GPU noise from pixel positions.
import type { Hand, PenKind } from './hand';
import type { Stroke } from './compose';
import { kinematics } from './kinematics';
import { noise1, rng } from './rng';
import { drawBetween } from './render';

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (x: number) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

// ---------------------------------------------------------------------------------------------
// pens and inks
// ---------------------------------------------------------------------------------------------
// shader kinds (as in the original): 1 ballpoint, 3 fountain, 5 broad nib, 7 pencil
type Spec = { kind: number; nib: boolean; gamma: number; down: number; up: number; pool: number; blob: number; blunt: number; cv: number; goop: number; skip: number; drift: number; rough: number; ring: number; ringPool: number };
const SPECS: Record<PenKind, Spec> = {
  // a reed is cut like a broad nib and dipped like a dip pen: wet starts, pools at stops, runs dry
  reed: { kind: 5, nib: true, gamma: 0.32, down: 0.14, up: 0.08, pool: 0.34, blob: 0.16, blunt: 1, cv: 0.09, goop: 0, skip: 0, drift: 0.06, rough: 0.2, ring: 0.1, ringPool: 0.3 },
  // a fountain pen: a round tip, a little wider across the nib's slit
  fountain: { kind: 3, nib: false, gamma: 0.3, down: 0.2, up: 0.1, pool: 0.32, blob: 0.18, blunt: 1, cv: 0.1, goop: 0, skip: 0, drift: 0.06, rough: 0.18, ring: 0.14, ringPool: 0.4 },
  ballpoint: { kind: 1, nib: false, gamma: 0.14, down: 0.12, up: 0.06, pool: 0.12, blob: 0.04, blunt: 0.7, cv: 0.07, goop: 0.07, skip: 0.32, drift: 0.05, rough: 0.12, ring: 0, ringPool: 0 },
  pencil: { kind: 7, nib: false, gamma: 0.05, down: 0.32, up: 0.18, pool: 0, blob: 0, blunt: 0.6, cv: 0.1, goop: 0, skip: 0, drift: 0.1, rough: 0.3, ring: 0, ringPool: 0 },
};

const PAPER_REF = [246, 243, 236];
const INK_FLOOR = 0.006;
const srgbToLin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const hexRGB = (h: string) => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
// per-channel absorption so that density 1 on the reference paper gives the swatch colour
function absorption(rgb: number[]) {
  return [0, 1, 2].map((i) => {
    const e = (srgbToLin(rgb[i]) / Math.max(1e-4, srgbToLin(PAPER_REF[i])) - INK_FLOOR) / (1 - INK_FLOOR);
    return e >= 1 ? 0 : -Math.log(Math.max(1e-5, e));
  });
}
function inkModel(hand: Hand) {
  const k = absorption(hexRGB(hand.ink.color));
  // the ink's family: one end a little denser and cooler, the other lighter and warmer; a stroke sits between them
  return { k, kA: [k[0] * 1.08, k[1] * 1.1, k[2] * 1.12], kB: [k[0] * 0.86, k[1] * 0.9, k[2] * 0.93] };
}

// ---------------------------------------------------------------------------------------------
// 1. the stroke profile
// ---------------------------------------------------------------------------------------------
type Profile = { n: number; x: Float32Array; y: Float32Array; t: Float32Array; r: Float32Array; d: Float32Array; s: Float32Array; a: Float32Array; w0: number };

function bump(arr: Float32Array | Float64Array, s: Float32Array, n: number, s0: number, sig: number, amp: number) {
  if (!(sig > 0)) return;
  for (let i = 0; i < n; i++) { const q = (s[i] - s0) / sig; if (q > -3 && q < 3) arr[i] += amp * Math.exp(-0.5 * q * q); }
}

function profile(st: Stroke, hand: Hand, ord: number): Profile | null {
  const P = st.pts, N0 = P.length / 4;
  if (N0 < 2) return null;
  const spec = SPECS[hand.pen];
  const em = hand.size, xh = hand.xh || em * 0.45;
  const W = hand.nibWidth * em;
  const c = clamp((hand.pressure - 0.6) / 0.8, 0, 1);
  const fluency = 1 - hand.neatness;
  const r = rng(`pen:${hand.seed}:${ord}`);
  const nz = noise1('inkcv:' + hand.seed);
  const dot = st.kind === 'dot';

  // keep points at least ~0.6 px apart (skeletons are dense; widths and inks vary slowly)
  const keep: number[] = [0];
  for (let i = 1; i < N0 - 1; i++) {
    const j = keep[keep.length - 1];
    if (Math.hypot(P[i * 4] - P[j * 4], P[i * 4 + 1] - P[j * 4 + 1]) >= 0.6) keep.push(i);
  }
  keep.push(N0 - 1);
  const n = keep.length;
  const x = new Float32Array(n), y = new Float32Array(n), t = new Float32Array(n), pr = new Float32Array(n);
  for (let k = 0; k < n; k++) { const i = keep[k]; x[k] = P[i * 4]; y[k] = P[i * 4 + 1]; t[k] = P[i * 4 + 2]; pr[k] = P[i * 4 + 3]; }
  const s = new Float32Array(n);
  for (let i = 1; i < n; i++) s[i] = s[i - 1] + Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]);
  const S = s[n - 1] || 1, T = (t[n - 1] - t[0]) || 1;
  const tx = new Float32Array(n), ty = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    const dx = x[b] - x[a], dy = y[b] - y[a], l = Math.hypot(dx, dy) || 1;
    tx[i] = dx / l; ty[i] = dy / l;
  }
  // slowness from the stroke's own timing: where the pen dwells, ink builds up
  const mean = S / T;
  const slow = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    const v = (s[b] - s[a]) / Math.max(1e-3, t[b] - t[a]);
    slow[i] = clamp(mean / Math.max(1e-4, v), 0.55, 2.2);
  }
  const pts2: [number, number][] = Array.from({ length: n }, (_, i) => [x[i], y[i]]);
  const splits = n > 4 ? kinematics(pts2, xh).splits : [];

  // how it starts and ends. Page y points down, and Persian strokes travel right to left: a flick goes up or to the left.
  let start = 'plain', end = 'soft';
  const mark = S < 0.3 * xh;
  if (dot) { start = end = 'dot'; }
  else {
    if (r() < spec.blob * (0.6 + fluency)) start = 'blob';
    const ex = tx[n - 1], ey = ty[n - 1];
    const up = ey < -0.25 || ex < -0.6, down = ey > 0.5;
    const pFly = up ? 0.7 + 0.2 * fluency : down ? 0.04 + 0.08 * fluency : 0.45 + 0.25 * fluency;
    const pBlunt = (down ? 0.18 : up ? 0 : 0.06) * spec.blunt;
    const v = r();
    end = v < pFly ? 'fly' : v < pFly + pBlunt ? 'blunt' : 'soft';
    if (mark) { start = 'plain'; end = 'soft'; }
  }

  const w = new Float32Array(n), d = new Float32Array(n), a = new Float32Array(n);
  // width: a nib's mark comes from the nib (the shader sweeps it); here only its scale (a) and the hairline radius.
  const hair = Math.max(0.4, 0.075 * W);
  const press = Math.sqrt(clamp(hand.pressure, 0.6, 1.4));
  for (let i = 0; i < n; i++) {
    const dn = clamp(ty[i], 0, 1), sl = slow[i] - 1;
    let f = 1;
    if (hand.pen === 'ballpoint') f = (1 + 0.06 * c * dn) * (1 - 0.03 * clamp(-sl, 0, 1));
    else if (hand.pen === 'pencil') f = 0.92 + 0.16 * c * dn;
    else if (hand.pen === 'fountain') f = (0.86 + 0.14 * Math.abs(ty[i] * Math.cos(hand.nibAngle) + tx[i] * Math.sin(hand.nibAngle))) * (1 + 0.04 * clamp(sl, 0, 1.2) + 0.08 * c * dn);
    else f = 1 + 0.05 * clamp(sl, 0, 1.2);
    const wv = spec.nib ? 0.35 : 0.15;
    f *= 1 + wv * 0.15 * nz(s[i] / (0.11 * em) + ord * 0.37);
    w[i] = spec.nib ? hair : W * f;
    a[i] = spec.nib ? press * f : 0;
  }
  // density: slowness, down vs up strokes, hand pressure (and its drift along the line), slow noise
  const base = hand.pen === 'pencil' ? 0.62 + 0.45 * c : 0.86 + 0.26 * c;
  const seedN = ord * 0.37 + 11.3;
  for (let i = 0; i < n; i++) {
    const dn = clamp(ty[i], 0, 1), upv = clamp(-ty[i], 0, 1);
    const pp = clamp(pr[i] / hand.pressure, 0.6, 1.3);
    d[i] = base * Math.pow(slow[i], spec.gamma) * (1 + spec.down * dn - spec.up * upv) * (1 + spec.cv * nz(s[i] / (0.5 * xh) + seedN)) * (0.88 + 0.12 * pp);
  }
  // ends
  const xhs = 0.06 * xh;
  for (let i = 0; i < n; i++) {
    const A = s[i], B = S - s[i];
    let fw = 1, fd = 1;
    if (start === 'plain') fw *= lerp(0.86, 1, smooth(A / xhs)); // the pen lands fuller than it lifts
    if (end === 'fly') {
      const L = Math.min(S * 0.45, (0.12 + 0.2 * fluency) * xh);
      const e = smooth(B / L);
      fw *= lerp(spec.nib ? 0.3 : 0.15, 1, e); fd *= lerp(0.55, 1, e);
    } else if (end === 'soft') fw *= lerp(0.7, 1, smooth(B / (0.07 * xh)));
    if (spec.nib) a[i] *= fw; else w[i] *= fw;
    d[i] *= fd;
  }
  // pools where the pen rests (a wet start, a stop, a sharp turn)
  if (spec.pool > 0) {
    const w0 = spec.nib ? W * 0.5 : w[0], w1 = spec.nib ? W * 0.5 : w[n - 1];
    if (start === 'blob') bump(d, s, n, 0, 0.55 * w0, spec.pool);
    if (start === 'plain') bump(d, s, n, 0, 0.5 * w0, spec.pool * 0.3);
    if (end === 'blunt') bump(d, s, n, S, 0.55 * w1, spec.pool * 0.75);
    else if (end === 'soft') bump(d, s, n, S, 0.5 * w1, spec.pool * 0.35);
    for (const k of splits) bump(d, s, n, s[k], 0.5 * (spec.nib ? W * 0.5 : w[k]), spec.pool * 0.35);
  }
  // ballpoint: a goop at some sharp turns, a skip on a fast light upstroke
  if (spec.goop > 0) {
    for (const k of splits) {
      if (r() >= spec.goop) continue;
      const g = new Float32Array(n);
      bump(g, s, n, s[k] + 0.25 * w[k], (0.3 + 0.2 * r()) * W, 1);
      const amp = 0.9 + 0.8 * r();
      for (let i = 0; i < n; i++) if (g[i]) { d[i] += amp * g[i]; w[i] *= 1 + 0.22 * g[i]; }
    }
  }
  if (spec.skip > 0 && !dot && r() < spec.skip * (1.15 - c)) {
    let best = -1, bv = 1.12;
    for (let i = 0; i < n; i++) { const vn = 1 / slow[i]; if (ty[i] < -0.15 && vn > bv && s[i] > 0.1 * S && s[i] < 0.9 * S) { bv = vn; best = i; } }
    if (best >= 0) {
      const len = (0.05 + 0.15 * r()) * xh, depth = 0.65 + 0.3 * r();
      for (let i = 0; i < n; i++) d[i] *= 1 - depth * (1 - smooth((Math.abs(s[i] - s[best]) / (len / 2) - 0.6) / 0.6));
    }
  }
  // dots: a quick dab, a little wetter
  if (dot) for (let i = 0; i < n; i++) { d[i] = base * (hand.pen === 'pencil' ? 1.1 : 1.25); if (spec.nib) a[i] = press; else w[i] = 1.1 * W; }
  const minW = Math.max(0.45, 0.12 * W);
  for (let i = 0; i < n; i++) { if (!spec.nib && w[i] < minW) w[i] = end === 'fly' && s[i] > S - 0.1 * xh ? Math.max(w[i], 0.35) : minW; if (d[i] < 0) d[i] = 0; }
  const rr = new Float32Array(n);
  for (let i = 0; i < n; i++) rr[i] = w[i] / 2;
  return { n, x, y, t, r: rr, d, s, a, w0: spec.nib ? W * 0.5 : w[0] };
}

// ink supply along the page: shade, density drift, dip-pen reservoir, wet word starts, a cold ballpoint
type Supply = { mul: number; wet: number; starve: number; shade: number };
function supply(hand: Hand, st: Stroke, ord: number, piece: number, wordStart: boolean): Supply {
  const nz = noise1('inkdrift:' + hand.seed);
  const sr = rng(`shade:${hand.seed}:${ord}`);
  const vary = 0.4, spec = SPECS[hand.pen];
  const shade = clamp(0.5 + 0.5 * vary * (0.7 * nz(piece * 0.09 + 7.7) + 0.45 * (2 * sr() - 1)), 0, 1);
  let mul = (1 + spec.drift * (0.5 + vary) * nz(st.word * 0.23 + 50)) * (1 + 0.07 * vary * (2 * sr() - 1)), wet = 0, starve = 0;
  if (st.kind === 'strike') return { mul: mul * 1.05, wet: 0, starve: 0, shade };
  if (hand.pen === 'reed') {
    // dipped every 6–11 pieces; the nib empties as it goes (piece counts pen-downs on the page)
    const dip = dipAt(hand.seed, piece);
    const used = (piece - dip.from + 0.5) / dip.len;
    const reservoir = clamp(1 - used, 0, 1);
    if (piece === dip.from && wordStart) wet = 0.9;
    else if (piece === dip.from) wet = 0.6;
    mul *= 0.72 + 0.52 * Math.pow(reservoir, 0.6);
    starve = smooth((0.4 - reservoir) / 0.4) * 0.6;
  } else if (hand.pen === 'fountain') {
    if (wordStart) { wet = 0.35; mul *= 1.05; }
  } else if (hand.pen === 'ballpoint') {
    if (piece < 10) starve = 0.3; // a cold ball skips at first
  }
  return { mul, wet, starve, shade };
}
const DIPS = new Map<string, { r: () => number; starts: number[] }>();
function dipAt(seed: string, ci: number) {
  let st = DIPS.get(seed);
  if (!st) { st = { r: rng('dip:' + seed), starts: [0] }; DIPS.set(seed, st); if (DIPS.size > 64) DIPS.delete(DIPS.keys().next().value!); }
  const a = st.starts;
  while (a[a.length - 1] <= ci) a.push(a[a.length - 1] + 6 + Math.floor(6 * st.r()));
  let lo = 0, hi = a.length - 1;
  while (lo < hi - 1) { const m = (lo + hi) >> 1; if (a[m] <= ci) lo = m; else hi = m; }
  return { from: a[lo], len: a[lo + 1] - a[lo] };
}

// ---------------------------------------------------------------------------------------------
// a page's strokes, prepared once: segments (CSS px) with their times, chains and layers
// ---------------------------------------------------------------------------------------------
const FPI = 15; // floats per segment: x0 y0 x1 y1 | r0 r1 d0 d1 | s0 s1 a0 a1 | seed shade starve
type Prepared = {
  segs: Float32Array; // FPI per segment
  segT: Float32Array; // pen time at each segment's end
  segT0: Float32Array; // and at its start
  count: number;
  t0: number; t1: number;
  layer: number;
  bbox: [number, number, number, number];
};

const MAX_LAYERS = 10, CELL = 32;
type LayerCell = { b: number[]; chain: string };
class Packer {
  grids: Map<number, LayerCell[]>[] = [];
  conflict(i: number, b: number[], chain: string) {
    const g = this.grids[i];
    if (!g) return false;
    for (let cy = Math.floor(b[1] / CELL); cy <= Math.floor(b[3] / CELL); cy++) for (let cx = Math.floor(b[0] / CELL); cx <= Math.floor(b[2] / CELL); cx++) {
      const list = g.get(cx + cy * 65536);
      if (list) for (const e of list) if (e.chain !== chain && e.b[0] < b[2] && e.b[2] > b[0] && e.b[1] < b[3] && e.b[3] > b[1]) return true;
    }
    return false;
  }
  pick(b: number[], chain: string, prefer: number) {
    if (prefer >= 0 && !this.conflict(prefer, b, chain)) return prefer;
    for (let i = 0; i < MAX_LAYERS; i++) if (i !== prefer && !this.conflict(i, b, chain)) return i;
    return MAX_LAYERS - 1;
  }
  add(i: number, b: number[], chain: string) {
    const g = (this.grids[i] ??= new Map());
    const e = { b, chain };
    for (let cy = Math.floor(b[1] / CELL); cy <= Math.floor(b[3] / CELL); cy++) for (let cx = Math.floor(b[0] / CELL); cx <= Math.floor(b[2] / CELL); cx++) {
      const key = cx + cy * 65536, list = g.get(key);
      if (list) list.push(e); else g.set(key, [e]);
    }
  }
}

/** Prepared strokes for one hand. Strokes are only ever appended (a reply grows), so preparation is incremental. */
class Scene {
  hand: Hand;
  items: Prepared[] = [];
  src: Stroke[] = [];
  packer = new Packer();
  piece = -1;
  lastChain = '';
  lastLayer = -1;
  lastWord = -1;
  pieceOf = new Map<string, number>();
  constructor(hand: Hand) { this.hand = hand; }

  sync(strokes: Stroke[]) {
    // anything other than an append means start over
    let same = strokes.length >= this.src.length;
    if (same) for (let i = 0; i < this.src.length; i += Math.max(1, Math.floor(this.src.length / 16))) if (strokes[i] !== this.src[i]) { same = false; break; }
    if (same && this.src.length && strokes[this.src.length - 1] !== this.src[this.src.length - 1]) same = false;
    if (!same) { this.items = []; this.src = []; this.packer = new Packer(); this.piece = -1; this.lastChain = ''; this.lastLayer = -1; this.lastWord = -1; this.pieceOf.clear(); }
    for (let i = this.src.length; i < strokes.length; i++) this.add(strokes[i], i);
    this.src = strokes.slice();
  }

  private add(st: Stroke, ord: number) {
    const hand = this.hand;
    const chain = st.kind === 'strike' || st.group == null ? `s${ord}` : `${st.word}:${st.group}`;
    let piece = this.pieceOf.get(chain);
    const wordStart = st.word !== this.lastWord && st.kind !== 'strike';
    if (piece == null) { piece = ++this.piece; this.pieceOf.set(chain, piece); }
    if (st.kind !== 'strike') this.lastWord = st.word;
    const pr = profile(st, hand, ord);
    const empty: Prepared = { segs: new Float32Array(0), segT: new Float32Array(0), segT0: new Float32Array(0), count: 0, t0: st.pts[2], t1: st.pts[st.pts.length - 2], layer: 0, bbox: [0, 0, 0, 0] };
    if (!pr) { this.items.push(empty); return; }
    const sup = supply(hand, st, ord, piece, wordStart);
    const spec = SPECS[hand.pen];
    const poolAmp = spec.pool * 1.5;
    const seed = ((ord * 13) % 997) / 997 * 61.7;
    const n = pr.n;
    const segs = new Float32Array(Math.max(1, n - 1) * FPI), segT = new Float32Array(Math.max(1, n - 1)), segT0 = new Float32Array(Math.max(1, n - 1));
    const D = (i: number) => {
      let d = pr.d[i] * sup.mul;
      if (sup.wet && poolAmp) { const q = pr.s[i] / (0.6 * pr.w0); d += sup.wet * poolAmp * Math.exp(-q * q); }
      return d;
    };
    const pad = 1 + spec.rough + (spec.nib ? hand.nibWidth * hand.size * 0.5 : 0);
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity, c = 0;
    const put = (i: number, j: number) => {
      const o = c * FPI;
      segs[o] = pr.x[i]; segs[o + 1] = pr.y[i]; segs[o + 2] = pr.x[j]; segs[o + 3] = pr.y[j];
      segs[o + 4] = pr.r[i]; segs[o + 5] = pr.r[j]; segs[o + 6] = D(i); segs[o + 7] = D(j);
      segs[o + 8] = pr.s[i]; segs[o + 9] = pr.s[j]; segs[o + 10] = pr.a[i]; segs[o + 11] = pr.a[j];
      segs[o + 12] = seed; segs[o + 13] = sup.shade; segs[o + 14] = sup.starve;
      segT0[c] = pr.t[i]; segT[c] = pr.t[j];
      c++;
    };
    if (n === 1) put(0, 0);
    for (let i = 1; i < n; i++) put(i - 1, i);
    for (let i = 0; i < n; i++) {
      const R = pr.r[i] + pad;
      bx0 = Math.min(bx0, pr.x[i] - R); by0 = Math.min(by0, pr.y[i] - R); bx1 = Math.max(bx1, pr.x[i] + R); by1 = Math.max(by1, pr.y[i] + R);
    }
    const bbox: [number, number, number, number] = [bx0, by0, bx1, by1];
    const layer = this.packer.pick(bbox, chain, chain === this.lastChain ? this.lastLayer : -1);
    this.packer.add(layer, bbox, chain);
    this.lastChain = chain; this.lastLayer = layer;
    this.items.push({ segs, segT, segT0, count: c, t0: pr.t[0], t1: pr.t[n - 1], layer, bbox });
  }
}

// ---------------------------------------------------------------------------------------------
// shaders (from render-canvas.js; nib and pens adapted, dry-reed break-up added)
// ---------------------------------------------------------------------------------------------
const NOISE = `
uint hash2(uvec2 v){ v = v * 1664525u + 1013904223u; v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v ^= v >> 16u; v.x += v.y * 1664525u; v.y += v.x * 1664525u; v ^= v >> 16u; return v.x ^ v.y; }
float h21(vec2 p){ return float(hash2(uvec2(ivec2(floor(p)) + 65536))) * (1.0 / 4294967295.0); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y); }
float grain(vec2 p){ vec2 q = p * vec2(0.62, 0.9);
  return 0.5 * vnoise(q) + 0.3 * vnoise(q * 2.3 + 17.0) + 0.2 * vnoise(q * 5.1 + 41.0); }
`;

const SEG_VS = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aSeg;   // x0 y0 x1 y1 (CSS px, y down)
layout(location=2) in vec4 aRD;    // r0 r1 d0 d1
layout(location=3) in vec4 aSA;    // s0 s1 a0 a1
layout(location=4) in vec3 aSeed;  // noise seed, shade, starve
uniform vec2 uView; uniform float uPad; uniform int uShape; uniform vec2 uNib; uniform float uK;
out vec2 vP; flat out vec4 vSeg; flat out vec4 vRD; flat out vec4 vSA; flat out vec3 vSeed;
void main(){
  vec4 sg = aSeg * uK;
  vec2 a = sg.xy, b = sg.zw, ab = b - a; float L = length(ab);
  vec2 t = L > 1e-4 ? ab / L : vec2(1.0, 0.0), n = vec2(-t.y, t.x);
  vec4 rd = vec4(aRD.xy * uK, aRD.zw);
  float R = max(rd.x, rd.y) + uPad;
  vec2 pos;
  if (uShape == 0) pos = mix(a - t * R, b + t * R, aCorner.x * 0.5 + 0.5) + n * (aCorner.y * R);
  else { vec2 e = abs(uNib) * max(aSA.z, aSA.w); vec2 lo = min(a, b) - e - vec2(R), hi = max(a, b) + e + vec2(R); pos = mix(lo, hi, aCorner * 0.5 + 0.5); }
  vP = pos; vSeg = sg; vRD = rd; vSA = vec4(aSA.xy * uK, aSA.zw); vSeed = aSeed;
  vec2 c = pos / uView * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
}`;

const SEG_FS = `#version 300 es
precision highp float; precision highp int;
in vec2 vP; flat in vec4 vSeg; flat in vec4 vRD; flat in vec4 vSA; flat in vec3 vSeed;
uniform float uPad; uniform int uShape; uniform vec2 uNib; uniform int uKind;
layout(location=0) out vec4 o;
layout(location=1) out vec4 o2;
${NOISE}
float cross2(vec2 a, vec2 b){ return a.x * b.y - a.y * b.x; }
float sdSeg(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0); return length(pa - ba * h); }
float sdQuad(vec2 p, vec2 A, vec2 B, vec2 C, vec2 D){
  float d = min(min(sdSeg(p, A, B), sdSeg(p, B, C)), min(sdSeg(p, C, D), sdSeg(p, D, A)));
  float c1 = cross2(B - A, p - A), c2 = cross2(C - B, p - B), c3 = cross2(D - C, p - C), c4 = cross2(A - D, p - D);
  bool inside = (c1 >= 0.0 && c2 >= 0.0 && c3 >= 0.0 && c4 >= 0.0) || (c1 <= 0.0 && c2 <= 0.0 && c3 <= 0.0 && c4 <= 0.0);
  return inside ? -d : d;
}
void main(){
  vec2 a = vSeg.xy, b = vSeg.zw, ba = b - a; float L2 = max(dot(ba, ba), 1e-6);
  float hr = dot(vP - a, ba) / L2, h = clamp(hr, 0.0, 1.0);
  float r = mix(vRD.x, vRD.y, h), d = mix(vRD.z, vRD.w, h);
  float dist = length(vP - (a + ba * h));
  float sdf, hw;
  if (uShape == 0) { sdf = dist - r; hw = r; }
  else {
    // the nib's edge swept from a to b; its length scales with pressure and eases at lifts (aux at each end)
    vec2 ea = uNib * 0.5 * vSA.z, eb = uNib * 0.5 * vSA.w;
    sdf = sdQuad(vP, a - ea, b - eb, b + eb, a + ea) - r;
    vec2 tn = L2 > 1e-5 ? ba / sqrt(L2) : vec2(1.0, 0.0);
    hw = abs(cross2(tn, mix(ea, eb, h))) + r;
  }
  if (sdf > uPad) discard;
  float s = mix(vSA.x, vSA.y, h);
  float tex = -1.0;
  if ((uKind == 1 || uKind == 7) && hr > -0.02 && hr < 1.02) {
    float u = sign(cross2(ba, vP - a)) * dist / max(r, 0.35);
    float rr = max(r, 0.6), sd = vSeed.x;
    if (uKind == 1) tex = 0.6 * vnoise(vec2(u * 6.0 + sd * 7.31, s / (rr * 9.0) + sd * 3.1)) + 0.4 * vnoise(vec2(u * 13.0 + sd * 1.7, s / (rr * 4.0) + 11.0));
    else tex = vnoise(vec2(u * 4.0 + sd * 5.3, s / (rr * 1.6)));
  }
  o = vec4(max(hw, 0.05), d, -sdf, tex);
  o2 = vec4(vSeed.y, vSeed.z, 0.0, 1.0);
}`;

const FULL_VS = `#version 300 es
void main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

const RESOLVE_FS = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uLayer; uniform sampler2D uShade; uniform vec3 uKA, uKB;
uniform int uKind; uniform float uH, uDpr, uGrainPx, uRough, uPress, uRing, uRingPool;
layout(location=0) out vec4 o;
${NOISE}
void main(){
  vec4 L = texelFetch(uLayer, ivec2(gl_FragCoord.xy), 0);
  float depth = L.z;
  if (depth < -500.0) discard;
  float hw = max(L.x, 0.05), d = max(L.y, 0.0), tex = L.w;
  vec4 SH = texelFetch(uShade, ivec2(gl_FragCoord.xy), 0);
  float starveR = SH.g;
  vec2 pc = vec2(gl_FragCoord.x, uH - gl_FragCoord.y) / uDpr;
  vec2 pg = pc / uGrainPx;
  float rough = min(uRough * uDpr, 0.2 * hw);
  depth += rough * (vnoise(pg * 1.7 + 5.3) * 2.0 - 1.0);
  float cov = clamp(depth + 0.5, 0.0, 1.0);
  float e = clamp(1.0 - depth / hw, 0.0, 1.0);                // 0 centre .. 1 edge
  float k = 1.0;
  if (uKind == 3 || uKind == 5) {                              // liquid ink dries darker at the rim
    float ring = uRing + uRingPool * clamp(d - 1.0, 0.0, 1.0);
    k *= 1.0 + ring * smoothstep(0.5, 0.95, e);
    if (starveR > 0.0) {                                        // a dry reed: ink only on the paper's high points, edges first
      float g = grain(pg * 1.25 + 7.0);
      float thr = 0.18 + 0.5 * starveR + 0.18 * starveR * e;
      k *= mix(1.0, smoothstep(thr - 0.09, thr + 0.09, g), starveR);
    }
  }
  if (uKind == 1) {
    k *= 1.0 + 0.08 * smoothstep(0.65, 1.0, e);
    if (tex >= 0.0) {
      float thr = 0.36 - 0.22 * clamp(d, 0.0, 1.4) + 0.1 * (1.0 - uPress);
      k *= 1.0 - 0.5 * (1.0 - smoothstep(thr - 0.06, thr + 0.06, tex));
    }
    float starve = max(1.0 - smoothstep(0.3, 0.75, d), starveR * 0.6);
    if (starve > 0.0) {
      float g = grain(pg * 1.7 + 3.0);
      k *= mix(1.0, smoothstep(0.62 - 0.45 * d, 0.72 - 0.45 * d, g), starve);
      d = mix(d, 0.85, starve * 0.75);
    }
  }
  if (uKind == 7) {
    float g = grain(pg * 1.3);
    float lv = clamp(d, 0.0, 1.3);
    float dep = smoothstep(1.0 - lv - 0.3, 1.0 - lv + 0.15, g);
    k *= mix(0.3, 1.0, dep) * (0.86 + 0.28 * (tex >= 0.0 ? tex : 0.5));
    k *= 1.0 - 0.3 * smoothstep(0.55, 1.0, e);
  }
  o = vec4(cov * d * k * mix(uKA, uKB, SH.r), 0.0);
}`;

const FINAL_FS = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uAccum;
uniform ivec2 uOrigin; uniform float uH, uDpr, uGrainPx;
uniform vec3 uK; uniform float uFloor, uGrainInk; uniform int uKind;
layout(location=0) out vec4 o;
${NOISE}
vec3 toSrgb(vec3 v){ v = clamp(v, 0.0, 1.0); return mix(v * 12.92, 1.055 * pow(v, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, v)); }
void main(){
  ivec2 ip = ivec2(gl_FragCoord.xy) - uOrigin;
  vec3 OD = max(texelFetch(uAccum, ip, 0).rgb, vec3(0.0));
  float D = dot(OD, vec3(1.0)) / max(dot(uK, vec3(1.0)), 1e-4);
  vec2 pc = vec2(float(ip.x) + 0.5, uH - float(ip.y) - 0.5) / uDpr;
  float g = grain(pc / uGrainPx);
  float f = 1.0 - uGrainInk * (1.0 - g) * 2.0 * (1.0 - smoothstep(0.12, 0.9, D)); // the paper's tooth shows through thin ink
  if (uKind == 7) f *= D > 1e-4 ? 1.6 * (1.0 - exp(-D * f / 1.6)) / (D * f) : 1.0;
  vec3 T = uFloor + (1.0 - uFloor) * exp(-OD * f);
  vec3 c = toSrgb(T);                                          // transmittance on white: multiplied over the paper
  if (D > 0.002) c += (h21(gl_FragCoord.xy * 1.37 + 3.1) - 0.5) / 255.0;
  o = vec4(c, 1.0);
}`;

// ---------------------------------------------------------------------------------------------
// the shared GL context
// ---------------------------------------------------------------------------------------------
type Prog = { pr: WebGLProgram; u: Record<string, WebGLUniformLocation> };
type GPU = {
  gl: WebGL2RenderingContext; canvas: HTMLCanvasElement; texW: number; texH: number; maxTex: number;
  seg: Prog; resolve: Prog; final: Prog; vao: WebGLVertexArrayObject; emptyVao: WebGLVertexArrayObject; ibuf: WebGLBuffer;
  layerTex: WebGLTexture; shadeTex: WebGLTexture; accumTex: WebGLTexture; layerFbo: WebGLFramebuffer; accumFbo: WebGLFramebuffer;
  inst: Float32Array;
};
let G: GPU | null = null;
let FAILED = false;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): Prog {
  const mk = (type: number, src: string) => {
    const sh = gl.createShader(type)!; gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(sh));
    return sh;
  };
  const pr = gl.createProgram()!;
  gl.attachShader(pr, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(pr));
  const u: Record<string, WebGLUniformLocation> = {};
  const n = gl.getProgramParameter(pr, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(pr, i)!; u[info.name] = gl.getUniformLocation(pr, info.name)!; }
  return { pr, u };
}

function gpu(): GPU | null {
  if (G) return G;
  if (FAILED || typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 2; canvas.height = 2;
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl || !gl.getExtension('EXT_color_buffer_float')) { FAILED = true; return null; }
    gl.getExtension('EXT_float_blend');
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const corner = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, corner);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const ibuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, ibuf);
    for (let l = 1; l <= 4; l++) { gl.enableVertexAttribArray(l); gl.vertexAttribDivisor(l, 1); }
    const emptyVao = gl.createVertexArray()!;
    gl.bindVertexArray(null);
    const g: GPU = {
      gl, canvas, texW: 0, texH: 0, maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      seg: compile(gl, SEG_VS, SEG_FS), resolve: compile(gl, FULL_VS, RESOLVE_FS), final: compile(gl, FULL_VS, FINAL_FS),
      vao, emptyVao, ibuf,
      layerTex: gl.createTexture()!, shadeTex: gl.createTexture()!, accumTex: gl.createTexture()!,
      layerFbo: gl.createFramebuffer()!, accumFbo: gl.createFramebuffer()!,
      inst: new Float32Array(FPI * 8192),
    };
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); G = null; });
    G = g;
    return g;
  } catch (e) {
    console.warn('[dastkhat] WebGL2 ink renderer unavailable, using flat strokes:', (e as Error).message);
    FAILED = true;
    return null;
  }
}

function ensureTargets(g: GPU, w: number, h: number) {
  const gl = g.gl;
  if (g.canvas.width < w || g.canvas.height < h) { g.canvas.width = Math.max(g.canvas.width, w); g.canvas.height = Math.max(g.canvas.height, h); }
  if (g.texW >= w && g.texH >= h) return;
  g.texW = Math.max(g.texW, w); g.texH = Math.max(g.texH, h);
  const setup = (tex: WebGLTexture, internal: number, type: number) => {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, g.texW, g.texH, 0, gl.RGBA, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };
  setup(g.layerTex, gl.RGBA16F, gl.HALF_FLOAT);
  setup(g.accumTex, gl.RGBA16F, gl.HALF_FLOAT);
  setup(g.shadeTex, gl.RGBA8, gl.UNSIGNED_BYTE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, g.accumFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, g.accumTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, g.layerFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, g.layerTex, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, g.shadeTex, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// ---------------------------------------------------------------------------------------------
// public
// ---------------------------------------------------------------------------------------------
export const inkGL = () => !!gpu();

/**
 * Draws strokes up to pen time `tEnd` into a canvas, whole (every call is a full redraw from prepared geometry).
 * The canvas shows transmittance on white: lay it over the paper with multiply. `scene` caches preparation between
 * calls (keep one per canvas). Returns false when WebGL2 isn't there and the flat renderer was used.
 */
export class InkCanvas {
  private scene: Scene | null = null;
  private canvas: HTMLCanvasElement;
  constructor(canvas: HTMLCanvasElement) { this.canvas = canvas; }

  render(strokes: Stroke[], hand: Hand, tEnd: number, w: number, h: number, dprIn?: number) {
    const canvas = this.canvas;
    const g = gpu();
    let dpr = dprIn ?? Math.min(2, window.devicePixelRatio || 1);
    if (g) dpr = Math.min(dpr, g.maxTex / Math.max(w, h));
    const pw = Math.max(1, Math.round(w * dpr)), ph = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;
    const ctx = canvas.getContext('2d')!;
    if (!g) {
      // flat fallback: the old renderer, opaque, shown at the ink's opacity
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, pw, ph);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawBetween(ctx, strokes, hand, -Infinity, tEnd);
      canvas.style.opacity = String(hand.ink.alpha);
      return false;
    }
    canvas.style.opacity = '';
    if (!this.scene || this.scene.hand !== hand) this.scene = new Scene(hand);
    const scene = this.scene;
    scene.sync(strokes);

    // gather the segments written by tEnd, layer by layer
    const perLayer: number[][] = [];
    let total = 0;
    scene.items.forEach((it, idx) => { if (it.count && it.t0 <= tEnd) { (perLayer[it.layer] ??= []).push(idx); total += it.count; } });
    if (g.inst.length < (total + 1) * FPI) g.inst = new Float32Array(Math.max((total + 1) * FPI, g.inst.length * 2));
    const inst = g.inst;
    const layers: { start: number; n: number; b: number[] }[] = [];
    let off = 0;
    for (let li = 0; li < perLayer.length; li++) {
      const list = perLayer[li];
      if (!list) continue;
      const start = off;
      const b = [Infinity, Infinity, -Infinity, -Infinity];
      for (const idx of list) {
        const it = scene.items[idx];
        let cnt = it.count;
        if (it.t1 > tEnd) { cnt = 0; while (cnt < it.count && it.segT[cnt] <= tEnd) cnt++; }
        inst.set(it.segs.subarray(0, cnt * FPI), off * FPI);
        off += cnt;
        if (cnt < it.count && it.segT0[cnt] < tEnd) {
          // the segment the pen is on: cut it where the pen is
          const o = off * FPI, src = cnt * FPI, u = clamp((tEnd - it.segT0[cnt]) / Math.max(1e-6, it.segT[cnt] - it.segT0[cnt]), 0, 1);
          inst.set(it.segs.subarray(src, src + FPI), o);
          inst[o + 2] = lerp(inst[o], inst[o + 2], u); inst[o + 3] = lerp(inst[o + 1], inst[o + 3], u);
          inst[o + 5] = lerp(inst[o + 4], inst[o + 5], u); inst[o + 7] = lerp(inst[o + 6], inst[o + 7], u);
          inst[o + 9] = lerp(inst[o + 8], inst[o + 9], u); inst[o + 11] = lerp(inst[o + 10], inst[o + 11], u);
          off++;
        }
        b[0] = Math.min(b[0], it.bbox[0]); b[1] = Math.min(b[1], it.bbox[1]); b[2] = Math.max(b[2], it.bbox[2]); b[3] = Math.max(b[3], it.bbox[3]);
      }
      if (off > start) layers.push({ start, n: off - start, b });
    }

    const gl = g.gl;
    const spec = SPECS[hand.pen];
    const ink = inkModel(hand);
    ensureTargets(g, pw, ph);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.ibuf);
    gl.bufferData(gl.ARRAY_BUFFER, inst.subarray(0, Math.max(FPI, off * FPI)), gl.DYNAMIC_DRAW);
    const rough = spec.rough;
    const pad = 0.75 + rough * dpr;
    const grainPx = clamp(hand.size / 58, 0.75, 2.5);
    gl.bindFramebuffer(gl.FRAMEBUFFER, g.accumFbo);
    gl.viewport(0, 0, pw, ph);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    gl.enable(gl.BLEND);
    const nibW = hand.nibWidth * hand.size * dpr;
    for (const l of layers) {
      const sx = Math.max(0, Math.floor(l.b[0] * dpr) - 2), sy = Math.max(0, Math.floor(l.b[1] * dpr) - 2);
      const ex = Math.min(pw, Math.ceil(l.b[2] * dpr) + 2), ey = Math.min(ph, Math.ceil(l.b[3] * dpr) + 2);
      if (ex <= sx || ey <= sy) continue;
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(sx, ph - ey, ex - sx, ey - sy);
      // 1. segments -> layer, MAX: one pen-down lays its ink once
      gl.bindFramebuffer(gl.FRAMEBUFFER, g.layerFbo);
      gl.clearBufferfv(gl.COLOR, 0, [0, 0, -1000, -1]);
      gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
      gl.blendEquation(gl.MAX);
      gl.useProgram(g.seg.pr);
      const u = g.seg.u;
      gl.uniform2f(u.uView, pw, ph);
      gl.uniform1f(u.uPad, pad);
      gl.uniform1f(u.uK, dpr);
      gl.uniform1i(u.uShape, spec.nib ? 1 : 0);
      gl.uniform2f(u.uNib, Math.cos(hand.nibAngle) * nibW, -Math.sin(hand.nibAngle) * nibW);
      gl.uniform1i(u.uKind, spec.kind);
      gl.bindVertexArray(g.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, g.ibuf);
      const stride = FPI * 4, base = l.start * stride;
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, base);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, base + 16);
      gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, base + 32);
      gl.vertexAttribPointer(4, 3, gl.FLOAT, false, stride, base + 48);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, l.n);
      // 2. layer -> optical density, added: crossings darken
      gl.bindFramebuffer(gl.FRAMEBUFFER, g.accumFbo);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(g.resolve.pr);
      const r = g.resolve.u;
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, g.shadeTex);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, g.layerTex);
      gl.uniform1i(r.uLayer, 0); gl.uniform1i(r.uShade, 1);
      gl.uniform3fv(r.uKA, ink.kA); gl.uniform3fv(r.uKB, ink.kB);
      gl.uniform1i(r.uKind, spec.kind);
      gl.uniform1f(r.uH, ph); gl.uniform1f(r.uDpr, dpr); gl.uniform1f(r.uGrainPx, grainPx);
      gl.uniform1f(r.uRough, rough);
      gl.uniform1f(r.uPress, clamp((hand.pressure - 0.6) / 0.8, 0, 1));
      gl.uniform1f(r.uRing, spec.ring); gl.uniform1f(r.uRingPool, spec.ringPool);
      gl.bindVertexArray(g.emptyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    // 3. density -> colour (Beer–Lambert), as transmittance on white
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const oy = g.canvas.height - ph;
    gl.viewport(0, oy, pw, ph);
    gl.useProgram(g.final.pr);
    const f = g.final.u;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, g.accumTex);
    gl.uniform1i(f.uAccum, 0);
    gl.uniform2i(f.uOrigin, 0, oy);
    gl.uniform1f(f.uH, ph); gl.uniform1f(f.uDpr, dpr); gl.uniform1f(f.uGrainPx, grainPx);
    gl.uniform3fv(f.uK, ink.k);
    gl.uniform1f(f.uFloor, INK_FLOOR);
    gl.uniform1f(f.uGrainInk, 0.1);
    gl.uniform1i(f.uKind, spec.kind);
    gl.bindVertexArray(g.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(g.canvas, 0, 0, pw, ph, 0, 0, pw, ph);
    ctx.restore();
    return true;
  }
}
