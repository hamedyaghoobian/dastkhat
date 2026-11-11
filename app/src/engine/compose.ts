// Text → a page of timed pen strokes, right to left.
//
// For each word: HarfBuzz picks the joined glyph forms; the skeleton library gives each
// glyph's centerlines and dots; the paths are grouped into the word's connected pieces
// (in Persian a word breaks after ا د ذ ر ز ژ و), each piece is written in one movement
// from its right end, and the dots, gāf bars and hamzas come after, as one dash or one
// caret when the writer is in a hurry. The whole word is then bent by one smooth field,
// so the joins stay joined however untidy the writer is.
import skeletons from './data/skeletons.json';
import type { Hand } from './hand';
import { noise1, noise2, rng } from './rng';
import type { ShapedGlyph } from './shaper';

type SkGlyph = { paths: { c: number; p: number[] }[]; dots: [number, number, number][]; w: number };
const SK = skeletons as unknown as { upem: number; glyphs: Record<string, SkGlyph> };

export type StrokeKind = 'body' | 'dot' | 'mark' | 'strike';
/** pts: flat [x, y, t(ms), pressure] per point, in page px */
export type Stroke = { pts: number[]; kind: StrokeKind; word: number };
export type PlacedWord = { index: number; text: string; line: number; x0: number; x1: number; y: number; t0: number; t1: number };
export type Page = {
  strokes: Stroke[];
  words: PlacedWord[];
  duration: number;
  width: number;
  height: number;
  lineYs: number[];
  /** where the next word would start (for typing) */
  cursor: { x: number; y: number; line: number };
};

export type PageOpts = { width: number; margin: { top: number; right: number; bottom: number; left: number }; startTime?: number };

type Pt = [number, number];
type Path = { pts: Pt[]; glyph: number; comp: number };

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function pointToPolyline(p: Pt, pl: Pt[]) {
  let best = Infinity;
  for (let i = 0; i < pl.length - 1; i++) {
    const [ax, ay] = pl[i], [bx, by] = pl[i + 1];
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L));
    best = Math.min(best, Math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy));
  }
  if (pl.length === 1) best = dist(p, pl[0]);
  return best;
}

const polyLen = (pl: Pt[]) => pl.reduce((s, p, i) => (i ? s + dist(p, pl[i - 1]) : 0), 0);

/** One word in font units, y up, x growing to the left edge of the word at 0. */
type WordGeom = {
  width: number;
  pieces: { paths: Path[]; maxX: number; small: boolean; dots: DotGroup[] }[];
};
type DotGroup = { dots: [number, number, number][]; cx: number; cy: number };

function groupDots(dots: [number, number, number][]): DotGroup[] {
  const groups: [number, number, number][][] = [];
  for (const d of dots) {
    const g = groups.find((gr) => gr.some((e) => Math.hypot(e[0] - d[0], e[1] - d[1]) < Math.max(e[2], d[2]) * 4.2));
    if (g) g.push(d); else groups.push([d]);
  }
  return groups.map((g) => ({ dots: g, cx: g.reduce((s, d) => s + d[0], 0) / g.length, cy: g.reduce((s, d) => s + d[1], 0) / g.length }));
}

const geomCache = new Map<string, WordGeom>();

function wordGeometry(glyphs: ShapedGlyph[], key: string): WordGeom {
  const hit = geomCache.get(key);
  if (hit) return hit;
  const paths: Path[] = [];
  const dotsByGlyph: [number, number, number][][] = [];
  let x = 0;
  glyphs.forEach((g, gi) => {
    const sk = SK.glyphs[g.g];
    const ox = x + g.dx, oy = g.dy;
    dotsByGlyph[gi] = [];
    if (sk) {
      for (const p of sk.paths) {
        const pts: Pt[] = [];
        for (let k = 0; k < p.p.length; k += 2) pts.push([p.p[k] + ox, p.p[k + 1] + oy]);
        paths.push({ pts, glyph: gi, comp: p.c });
      }
      for (const [cx, cy, r] of sk.dots) dotsByGlyph[gi].push([cx + ox, cy + oy, r]);
    }
    x += g.ax;
  });
  // union paths into connected pieces
  const parent = paths.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => { parent[find(a)] = find(b); };
  const TOL = SK.upem * 0.03;
  for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) {
    const A = paths[i], B = paths[j];
    if (A.glyph === B.glyph) { if (A.comp === B.comp) union(i, j); continue; }
    const ends = [A.pts[0], A.pts[A.pts.length - 1]], endsB = [B.pts[0], B.pts[B.pts.length - 1]];
    if (ends.some((e) => pointToPolyline(e, B.pts) < TOL) || endsB.some((e) => pointToPolyline(e, A.pts) < TOL)) union(i, j);
  }
  const byRoot = new Map<number, Path[]>();
  paths.forEach((p, i) => { const r = find(i); if (!byRoot.has(r)) byRoot.set(r, []); byRoot.get(r)!.push(p); });
  const pieces = [...byRoot.values()].map((ps) => {
    const len = ps.reduce((s, p) => s + polyLen(p.pts), 0);
    let maxX = -Infinity;
    for (const p of ps) for (const q of p.pts) maxX = Math.max(maxX, q[0]);
    return { paths: ps, maxX, small: len < SK.upem * 0.28, dots: [] as DotGroup[], glyphs: new Set(ps.map((p) => p.glyph)) };
  });
  if (pieces.length && pieces.every((p) => p.small)) pieces.forEach((p) => (p.small = false));
  // each glyph's dots go with the main piece that glyph belongs to
  dotsByGlyph.forEach((ds, gi) => {
    if (!ds.length) return;
    const owner = pieces.find((p) => !p.small && p.glyphs.has(gi)) ?? pieces.find((p) => p.glyphs.has(gi)) ?? pieces[0];
    if (owner) owner.dots.push(...groupDots(ds));
    else pieces.push({ paths: [], maxX: ds[0][0], small: true, dots: groupDots(ds), glyphs: new Set([gi]) });
  });
  const geom: WordGeom = { width: x, pieces: pieces.map(({ paths, maxX, small, dots }) => ({ paths, maxX, small, dots })) };
  geomCache.set(key, geom);
  return geom;
}

/** Order a piece's paths into pen movements: start at the right (top first), then go to whatever is nearest. */
function orderPaths(paths: Path[], joinTol: number): Pt[][] {
  const left = paths.map((p) => p.pts.slice());
  const moves: Pt[][] = [];
  let cur: Pt | null = null;
  let move: Pt[] = [];
  while (left.length) {
    let bi = 0, flip = false, best = Infinity;
    left.forEach((pl, i) => {
      for (const f of [false, true]) {
        const s = f ? pl[pl.length - 1] : pl[0];
        const score = cur ? dist(cur, s) : -(s[0] + 0.6 * s[1]);
        if (score < best) { best = score; bi = i; flip = f; }
      }
    });
    const pl = left.splice(bi, 1)[0];
    if (flip) pl.reverse();
    if (cur && dist(cur, pl[0]) <= joinTol) move.push(...pl.slice(1));
    else { if (move.length) moves.push(move); move = pl; }
    cur = pl[pl.length - 1];
  }
  if (move.length) moves.push(move);
  return moves;
}

export type ComposeState = { page: Page };

export function compose(
  text: string,
  hand: Hand,
  shape: (w: string) => ShapedGlyph[],
  opts: PageOpts,
): Page {
  const s = hand.size / SK.upem;
  const em = hand.size;
  const { width, margin } = opts;
  const right = width - margin.right, leftEdge = margin.left;
  const lineH = em * hand.lineGap;
  const strokes: Stroke[] = [];
  const words: PlacedWord[] = [];
  const lineYs: number[] = [];
  let t = opts.startTime ?? 0;
  const r = rng('page:' + hand.seed);
  const drift = noise1('drift:' + hand.seed);
  const pressN = noise1('press:' + hand.seed);
  const bend = noise2('bend:' + hand.seed);
  const untidy = 1 - hand.neatness;

  let line = 0;
  let y = margin.top + em * 1.1;
  let x = right;
  lineYs.push(y);
  const newLine = (extra = 0) => {
    line++;
    y += lineH * (1 + extra) + r.normal(0, em * 0.04 * untidy);
    x = right - Math.abs(r.normal(0, em * 0.12 * untidy));
    lineYs.push(y);
    t += 350 + r.range(0, 400) * (1 - hand.hurry);
  };

  const paragraphs = text.replace(/\r/g, '').split('\n');
  let wordIndex = 0;
  paragraphs.forEach((para, pi) => {
    if (pi > 0) newLine(para.trim() === '' ? 0.15 : 0);
    const ws = para.split(' ').filter(Boolean);
    for (const w of ws) {
      const wr = rng(`word:${hand.seed}:${wordIndex}:${w}`);
      const glyphs = shape(w);
      const geom = wordGeometry(glyphs, w);
      let sx = s * hand.stretch * (1 + wr.normal(0, 0.03 * (0.4 + untidy)));
      const sy = s * (1 + wr.normal(0, 0.035 * (0.4 + untidy)));
      let wpx = geom.width * sx;
      // Persian words sit close, but never touch: a word ending in a free letter (ا د ر و …) needs a visible gap
      const gap = em * Math.max(0.2, hand.wordGap * (1 + wr.normal(0, 0.22)));
      // the last word on a line: squeeze it in and let it climb, the way letters run into the margin
      let squeeze = 0;
      if (x - wpx < leftEdge && x < right - em) {
        const over = leftEdge - (x - wpx);
        if (over < wpx * 0.28 && wr.chance(0.35 + untidy * 0.5)) {
          squeeze = over / wpx;
          sx *= 1 - squeeze;
          wpx = geom.width * sx;
        } else newLine();
      }
      const wordY = y + drift(x / (em * 6) + line * 17) * em * hand.baselineDrift * 6 + wr.normal(0, em * 0.02 * (0.3 + untidy));
      const tilt = hand.wordTilt * (1 + wr.normal(0, 0.4)) + squeeze * 0.35;
      const xRight = x;
      const bendAmp = hand.wobble * em * 10;
      const tf = (p: Pt): Pt => {
        // font units → page, y down; x measured from the word's right end
        const fx = (p[0] - geom.width) * sx, fy = -p[1] * sy;
        let px = xRight + fx - fy * hand.slant;
        let py = wordY + fy + fx * tilt;
        const bx = bend(px / (em * 0.9), py / (em * 0.9)), by = bend(py / (em * 0.9) + 50, px / (em * 0.9) + 50);
        px += bx * bendAmp; py += by * bendAmp;
        return [px, py];
      };
      const t0 = t;
      const pieces = geom.pieces.slice().sort((a, b) => b.maxX - a.maxX);
      const main = pieces.filter((p) => !p.small);
      const later: (() => void)[] = [];
      const speed = hand.speed * (1 + wr.normal(0, 0.12));

      const writeMove = (pts: Pt[], kind: StrokeKind, pace = 1) => {
        if (pts.length < 2) pts = [pts[0], [pts[0][0] - 0.5, pts[0][1] + 0.5]];
        const L = polyLen(pts) || 1;
        const out: number[] = [];
        let acc = 0;
        for (let i = 0; i < pts.length; i++) {
          if (i) acc += dist(pts[i], pts[i - 1]);
          const u = acc / L;
          const v = speed * pace * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, Math.max(0, u))));
          if (i) t += dist(pts[i], pts[i - 1]) / Math.max(0.05, v);
          const pr = hand.pressure * (0.85 + 0.15 * pressN(t / 900)) * (0.75 + 0.25 * Math.sin(Math.PI * Math.min(1, u * 1.15)));
          out.push(pts[i][0], pts[i][1], t, pr);
        }
        strokes.push({ pts: out, kind, word: wordIndex });
      };
      // the pen in the air: quick hops inside a word, a little longer to the next piece
      const lift = (d: number) => { t += (d < em * 0.4 ? 15 : 40) + d / (hand.speed * 3) + r.range(0, 40) * (1 - hand.hurry); };

      const writeDots = (g: DotGroup) => {
        const [cx, cy] = tf([g.cx, g.cy]);
        const rr = (g.dots[0][2] * s) * 1.1;
        const jit = () => wr.normal(0, rr * 0.35 * (0.5 + untidy));
        const above = g.cy > 400;
        const d = Math.max(rr * 1.2, em * 0.035);
        const broad = hand.pen === 'reed' || hand.pen === 'fountain';
        const dab = (x0: number, y0: number) => {
          if (broad) {
            // a reed's nuqta: one short push across the nib's edge, which leaves a small rhombus
            const L = hand.nibWidth * em * (0.75 + wr.range(0, 0.25));
            const ux = Math.sin(hand.nibAngle), uy = Math.cos(hand.nibAngle);
            writeMove([[x0 - ux * L * 0.5, y0 - uy * L * 0.5], [x0 + ux * L * 0.5, y0 + uy * L * 0.5]], 'dot', 0.35);
          } else {
            // a ballpoint's dot is a tiny tick, often with a little tail
            const L = Math.max(em * 0.03, rr * 0.8) * (0.6 + untidy * 0.8);
            writeMove([[x0 + L * 0.5, y0 - L * 0.4 + jit() * 0.3], [x0 - L * 0.5, y0 + L * 0.4]], 'dot', 0.4);
          }
        };
        if (g.dots.length === 2 && wr.chance(hand.dotDash)) {
          const pts = g.dots.map((q) => tf([q[0], q[1]])).sort((a, b) => b[0] - a[0]);
          const vertical = Math.abs(pts[0][1] - pts[1][1]) > Math.abs(pts[0][0] - pts[1][0]);
          const half = Math.max(d * 1.2, (vertical ? Math.abs(pts[0][1] - pts[1][1]) : pts[0][0] - pts[1][0]) * 0.6);
          writeMove([[cx + half + jit(), cy + jit() * 0.5 + half * 0.15], [cx - half + jit(), cy - half * 0.1 + jit() * 0.5]], 'dot', 0.7);
        } else if (g.dots.length === 3 && wr.chance(hand.dotCaret)) {
          const h = Math.max(d * 1.6, rr * 2.4);
          const sgn = above ? 1 : -1;
          writeMove([[cx + h + jit(), cy + h * 0.45 * sgn], [cx + jit() * 0.5, cy - h * 0.55 * sgn], [cx - h + jit(), cy + h * 0.45 * sgn]], 'dot', 0.7);
        } else {
          const order = g.dots.map((q) => tf([q[0], q[1]])).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
          order.forEach((p, i) => { if (i) lift(dist(order[i - 1], p)); dab(p[0] + jit(), p[1] + jit()); });
        }
      };

      let pen: Pt | null = null;
      const joinTol = SK.upem * 0.025;
      for (const piece of main) {
        const moves = orderPaths(piece.paths, joinTol).map((m) => m.map(tf));
        for (const m of moves) {
          if (pen) lift(dist(pen, m[0]));
          writeMove(m, 'body');
          pen = m[m.length - 1];
        }
        const marks = () => {
          for (const g of piece.dots) { if (pen) lift(dist(pen, tf([g.cx, g.cy]))); writeDots(g); pen = tf([g.cx, g.cy]); }
        };
        if (wr.chance(hand.dotsAfterWord)) later.push(marks); else marks();
      }
      for (const piece of pieces.filter((p) => p.small)) {
        later.push(() => {
          for (const m of orderPaths(piece.paths, joinTol).map((mm) => mm.map(tf))) {
            if (pen) lift(dist(pen, m[0]));
            writeMove(m, 'mark', 0.8);
            pen = m[m.length - 1];
          }
          for (const g of piece.dots) { if (pen) lift(dist(pen, tf([g.cx, g.cy]))); writeDots(g); }
        });
      }
      later.forEach((f) => f());
      words.push({ index: wordIndex, text: w, line, x0: xRight - wpx, x1: xRight, y: wordY, t0, t1: t });
      x = xRight - wpx - gap;
      t += 60 + r.range(0, 160) * (1 - hand.hurry);
      wordIndex++;
    }
  });
  return {
    strokes,
    words,
    duration: t,
    width,
    height: y + lineH * 0.9 + margin.bottom,
    lineYs,
    cursor: { x, y, line },
  };
}
