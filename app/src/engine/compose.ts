// Text → a page of timed pen strokes, right to left.
//
// For each word: HarfBuzz picks the joined glyph forms; the skeleton library gives each
// glyph's centerlines and dots; the paths are grouped into the word's connected pieces
// (in Persian a word breaks after ا د ذ ر ز ژ و), each piece is written in one movement
// from its right end, and the dots, gāf bars and hamzas come after, as one dash or one
// caret when the writer is in a hurry. The whole word is then bent by one smooth field,
// so the joins stay joined however untidy the writer is.
import type { Hand } from './hand';
import type { Script, SkSet } from './script';
import { noise1, noise2, rng } from './rng';
import { kinematics } from './kinematics';
import type { ShapedGlyph } from './shaper';

export type StrokeKind = 'body' | 'dot' | 'mark' | 'strike';
/** pts: flat [x, y, t(ms), pressure] per point, in page px. group: strokes of one connected piece share it, so the
 *  ink renderer lays their overlaps (junctions, retraced joins) once instead of twice. */
export type Stroke = { pts: number[]; kind: StrokeKind; word: number; group?: number };
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
/** sin: the path belongs to a س or ش (a quick hand writes its teeth as one flat line) */
type Path = { pts: Pt[]; glyph: number; comp?: number; sin?: boolean };

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

function wordGeometry(glyphs: ShapedGlyph[], key: string, SK: SkSet, text: string): WordGeom {
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
        paths.push({ pts, glyph: gi, comp: p.c, sin: text[g.cl] === 'س' || text[g.cl] === 'ش' });
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
    const owner = pieces.find((p) => !p.small && p.glyphs.has(gi)) ?? pieces.find((p) => p.glyphs.has(gi)) ?? nearestPiece(pieces, ds[0]);
    if (owner) owner.dots.push(...groupDots(ds));
    else pieces.push({ paths: [], maxX: ds[0][0], small: true, dots: groupDots(ds), glyphs: new Set([gi]) });
  });
  const geom: WordGeom = { width: x, pieces: pieces.map(({ paths, maxX, small, dots }) => ({ paths, maxX, small, dots })) };
  geomCache.set(key, geom);
  return geom;
}

/** A quick hand rounds what a careful one draws sharp: resample, then a gentle Gaussian along the stroke (ends kept). */
function roundOff(pts: Pt[], sigma: number, fade = 1): Pt[] {
  const total = polyLen(pts);
  if (total < sigma * 4 || pts.length < 3) return pts;
  const step = Math.max(0.5, sigma / 3);
  const res: Pt[] = [pts[0]];
  let acc = 0, need = step;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], d = dist(a, b);
    while (acc + d >= need) { const u = (need - acc) / (d || 1); res.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]); need += step; }
    acc += d;
  }
  res.push(pts[pts.length - 1]);
  const k = Math.ceil((sigma / step) * 2.5), w: number[] = [];
  for (let j = -k; j <= k; j++) w.push(Math.exp(-0.5 * ((j * step) / sigma) ** 2));
  const out: Pt[] = res.map((p, i) => {
    // fade the smoothing in from both ends so the stroke starts and ends where it did
    const edge = Math.min(i, res.length - 1 - i) / Math.max(1, k * fade);
    if (edge <= 0) return p;
    let sx = 0, sy = 0, sw = 0;
    for (let j = -k; j <= k; j++) { const q = res[Math.min(res.length - 1, Math.max(0, i + j))]; sx += q[0] * w[j + k]; sy += q[1] * w[j + k]; sw += w[j + k]; }
    const f = Math.min(1, edge);
    return [p[0] + (sx / sw - p[0]) * f, p[1] + (sy / sw - p[1]) * f];
  });
  return out;
}

/** The hairline a carried pen draws from the end of one piece into the start of the next: it leaves briefly along
 *  the stroke it was on, then swings up into the next letter from below and to the right, the way a pen travelling
 *  leftward enters a tooth or a stem (a cubic, sampled every ~1.5 px, ends excluded). */
function linkCurve(from: Pt[], to: Pt[]): Pt[] {
  const a = from[from.length - 1], b = to[0];
  const pa = from[Math.max(0, from.length - 3)];
  const d = dist(a, b) || 1;
  const ua = dist(a, pa) || 1;
  const c1: Pt = [a[0] + ((a[0] - pa[0]) / ua) * d * 0.25, a[1] + ((a[1] - pa[1]) / ua) * d * 0.25];
  const c2: Pt = [b[0] + d * 0.18, b[1] + d * 0.42];
  const n = Math.max(2, Math.ceil(d / 1.5));
  const out: Pt[] = [];
  for (let i = 1; i < n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * u * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b[0], u * u * u * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b[1]]);
  }
  return out;
}

/** The main piece closest to a point (for nuqtas that come as glyphs of their own). */
function nearestPiece<T extends { paths: Path[]; small: boolean }>(pieces: T[], d: [number, number, number]): T | undefined {
  let best = pieces[0], bd = Infinity;
  for (const p of pieces) {
    if (p.small && pieces.some((q) => !q.small)) continue;
    for (const pa of p.paths) { const dd = pointToPolyline([d[0], d[1]], pa.pts); if (dd < bd) { bd = dd; best = p; } }
  }
  return best;
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
  script: Script,
  opts: PageOpts,
): Page {
  const SK = script.sk;
  // a nasta'liq hand writes like a letter, not a copybook (hand.loose); naskh stays upright
  const loose = script.style === 'nastaliq' ? hand.loose : { cascade: 0, slant: 0, rise: 0, compress: 1, round: 0, dotDrop: 0, scale: 1, toothless: 0, joins: 0 };
  const s = hand.size * script.scale / SK.upem;
  const em = hand.size;
  const xh = em * script.xh;
  const { width, margin } = opts;
  const right = width - margin.right, leftEdge = margin.left;
  const lineH = em * hand.lineGap * script.lineGap;
  const strokes: Stroke[] = [];
  let nextGroup = 1;
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
      const glyphs = script.shape(w);
      const geom = wordGeometry(glyphs, script.style + ':' + w, SK, w);
      // shekasteh habits, decided per word: sīn without teeth, and the pen carried across non-joining letters
      const toothless = wr.chance(loose.toothless);
      const joins = loose.joins > 0 && wr.chance(Math.min(1, loose.joins * 1.4));
      let sx = s * hand.stretch * loose.compress * (1 + wr.normal(0, 0.03 * (0.4 + untidy)));
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
      const wordY = y - (right - x) * loose.rise + drift(x / (em * 6) + line * 17) * em * hand.baselineDrift * 6 + wr.normal(0, em * 0.02 * (0.3 + untidy));
      const tilt = hand.wordTilt * (1 + wr.normal(0, 0.4)) + squeeze * (script.style === 'nastaliq' ? 0.18 : 0.35) - loose.cascade * (1 + wr.normal(0, 0.35));
      const lean = hand.slant + loose.slant * (1 + wr.normal(0, 0.15));
      const xRight = x;
      const bendAmp = hand.wobble * em * 10;
      const tf = (p: Pt): Pt => {
        // font units → page, y down; x measured from the word's right end
        const fx = (p[0] - geom.width) * sx, fy = -p[1] * sy;
        let px = xRight + fx - fy * lean;
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

      const writeMove = (pts: Pt[], kind: StrokeKind, pace = 1, group = nextGroup++) => {
        if (pts.length < 2) pts = [pts[0], [pts[0][0] - 0.5, pts[0][1] + 0.5]];
        if (kind === 'body' && loose.round > 0) pts = roundOff(pts, em * loose.round);
        const L = polyLen(pts) || 1;
        // speed along the stroke: slow at turns and at both ends (kinematics.ts); the ink follows it
        const kin = kinematics(pts, xh);
        const out: number[] = [];
        let acc = 0;
        for (let i = 0; i < pts.length; i++) {
          if (i) acc += dist(pts[i], pts[i - 1]);
          const u = acc / L;
          const v = speed * pace * 0.78 * Math.max(0.08, i ? (kin.vn[i] + kin.vn[i - 1]) / 2 : kin.vn[0]);
          if (i) t += dist(pts[i], pts[i - 1]) / Math.max(0.03, v);
          const pr = hand.pressure * (0.85 + 0.15 * pressN(t / 900)) * (0.75 + 0.25 * Math.sin(Math.PI * Math.min(1, u * 1.15)));
          out.push(pts[i][0], pts[i][1], t, pr);
        }
        strokes.push({ pts: out, kind, word: wordIndex, group });
      };
      // the pen in the air: quick hops inside a word, a little longer to the next piece
      const lift = (d: number) => { t += (d < em * 0.4 ? 15 : 40) + d / (hand.speed * 3) + r.range(0, 40) * (1 - hand.hurry); };

      const writeDots = (g: DotGroup, under?: Path[]) => {
        if (wr.chance(loose.dotDrop)) return; // a quick hand leaves some nuqtas out
        const [cx, cy] = tf([g.cx, g.cy]);
        const rr = (g.dots[0][2] * s) * 1.1;
        const jit = () => wr.normal(0, rr * 0.35 * (0.5 + untidy));
        // above or below its letter: compare with the stroke right under (or over) it, since nasta'liq words cascade
        let above = g.cy > SK.upem * 0.2;
        if (under?.length) {
          let bx = Infinity, by = 0;
          for (const pa of under) for (const q of pa.pts) { const d = Math.abs(q[0] - g.cx); if (d < bx) { bx = d; by = q[1]; } }
          if (bx < SK.upem * 0.4) above = g.cy > by;
        }
        const d = Math.max(rr * 1.2, em * 0.035);
        const broad = hand.pen === 'reed';
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
      // The last movement of a piece is held back: if the writer carries the pen on (shekasteh), it runs straight
      // into the next piece through a hairline instead of lifting after ا د ذ ر ز ژ و.
      let carry: { m: Pt[]; g: number } | null = null;
      const flush = () => {
        if (!carry) return;
        if (pen) lift(dist(pen, carry.m[0]));
        writeMove(carry.m, 'body', 1, carry.g);
        pen = carry.m[carry.m.length - 1];
        carry = null;
      };
      for (const piece of main) {
        const paths = toothless ? piece.paths.map((p) => (p.sin ? { ...p, pts: roundOff(p.pts, SK.upem * 0.045, 0.3) } : p)) : piece.paths;
        const moves = orderPaths(paths, joinTol).map((m) => m.map(tf));
        const g = nextGroup++;
        if (!moves.length) continue;
        let firstGroup = g;
        if (carry) {
          const c: { m: Pt[]; g: number } = carry;
          const a = c.m[c.m.length - 1], b = moves[0][0];
          // only a short hop that goes on leftward, the way the hand is already travelling
          if (joins && wr.chance(loose.joins) && dist(a, b) < em * 0.85 && b[0] < a[0] + em * 0.12 && a[1] - b[1] < em * 0.6) {
            moves[0] = [...c.m, ...linkCurve(c.m, moves[0]), ...moves[0]];
            firstGroup = c.g;
            carry = null;
          } else flush();
        }
        moves.forEach((m, i) => {
          if (i === moves.length - 1) { carry = { m, g: i === 0 ? firstGroup : g }; return; }
          if (i > 0 || !carry) { if (pen) lift(dist(pen, m[0])); }
          writeMove(m, 'body', 1, i === 0 ? firstGroup : g);
          pen = m[m.length - 1];
        });
        const marks = () => {
          for (const g of piece.dots) { if (pen) lift(dist(pen, tf([g.cx, g.cy]))); writeDots(g, piece.paths); pen = tf([g.cx, g.cy]); }
        };
        // a writer carrying the pen through the word dots it afterwards
        if (joins || wr.chance(hand.dotsAfterWord)) later.push(marks); else { flush(); marks(); }
      }
      flush();
      for (const piece of pieces.filter((p) => p.small)) {
        later.push(() => {
          const g = nextGroup++;
          // nasta'liq fonts draw a pair of nuqtas as one short dash, a mark of its own: a quick hand may skip it too
          const tiny = piece.paths.reduce((acc, p) => acc + polyLen(p.pts), 0) < SK.upem * 0.15;
          const paths = tiny && wr.chance(loose.dotDrop) ? [] : piece.paths;
          for (const m of orderPaths(paths, joinTol).map((mm) => mm.map(tf))) {
            if (pen) lift(dist(pen, m[0]));
            writeMove(m, 'mark', 0.8, g);
            pen = m[m.length - 1];
          }
          for (const g of piece.dots) { if (pen) lift(dist(pen, tf([g.cx, g.cy]))); writeDots(g, piece.paths); }
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
