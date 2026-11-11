// Turn every glyph of a (thin) Persian font into single-line pen strokes.
//
//   node tools/skeletonize.mjs app/public/fonts/Vazirmatn-Thin.ttf app/src/engine/data/skeletons.json
//
// For each glyph: flatten its outline, rasterise it, thin it to a one-pixel skeleton
// (Zhang–Suen), prune the little spurs thinning leaves at stroke ends, then trace the
// skeleton into polylines in font units. Small separate pieces (nuqta dots, the bar of
// gāf, hamza) are kept apart and flagged, so the pen can write them after the body,
// the way people do.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../app/package.json', import.meta.url));
const hbPromise = require('harfbuzzjs');

const [fontPath, outPath] = process.argv.slice(2);
if (!fontPath || !outPath) {
  console.error('usage: node tools/skeletonize.mjs <font.ttf> <out.json>');
  process.exit(1);
}

const UNITS_PER_PX = 6; // raster resolution: one pixel = 6 font units

// ---------- outline → polygons ----------
function flatten(cmds) {
  const polys = [];
  let cur = null, x = 0, y = 0;
  const STEPS = 10;
  for (const c of cmds) {
    const v = c.values;
    if (c.type === 'M') { cur = [[v[0], v[1]]]; polys.push(cur); x = v[0]; y = v[1]; }
    else if (c.type === 'L') { cur.push([v[0], v[1]]); x = v[0]; y = v[1]; }
    else if (c.type === 'Q') {
      for (let i = 1; i <= STEPS; i++) {
        const t = i / STEPS, mt = 1 - t;
        cur.push([mt * mt * x + 2 * mt * t * v[0] + t * t * v[2], mt * mt * y + 2 * mt * t * v[1] + t * t * v[3]]);
      }
      x = v[2]; y = v[3];
    } else if (c.type === 'C') {
      for (let i = 1; i <= STEPS; i++) {
        const t = i / STEPS, mt = 1 - t;
        cur.push([
          mt ** 3 * x + 3 * mt * mt * t * v[0] + 3 * mt * t * t * v[2] + t ** 3 * v[4],
          mt ** 3 * y + 3 * mt * mt * t * v[1] + 3 * mt * t * t * v[3] + t ** 3 * v[5],
        ]);
      }
      x = v[4]; y = v[5];
    }
  }
  return polys.filter((p) => p.length > 2);
}

// ---------- rasterise (non-zero winding, pixel centres) ----------
function rasterise(polys) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of polys) for (const [px, py] of p) {
    minX = Math.min(minX, px); maxX = Math.max(maxX, px);
    minY = Math.min(minY, py); maxY = Math.max(maxY, py);
  }
  const pad = 3;
  const ox = minX - pad * UNITS_PER_PX, oy = maxY + pad * UNITS_PER_PX; // y flips: row 0 = top
  const W = Math.ceil((maxX - minX) / UNITS_PER_PX) + pad * 2 + 1;
  const H = Math.ceil((maxY - minY) / UNITS_PER_PX) + pad * 2 + 1;
  const img = new Uint8Array(W * H);
  const edges = [];
  for (const p of polys) for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const ax = (a[0] - ox) / UNITS_PER_PX, ay = (oy - a[1]) / UNITS_PER_PX;
    const bx = (b[0] - ox) / UNITS_PER_PX, by = (oy - b[1]) / UNITS_PER_PX;
    if (ay !== by) edges.push([ax, ay, bx, by]);
  }
  for (let r = 0; r < H; r++) {
    const sy = r + 0.5;
    const xs = [];
    for (const [ax, ay, bx, by] of edges) {
      const up = ay < by;
      const y0 = up ? ay : by, y1 = up ? by : ay;
      if (sy < y0 || sy >= y1) continue;
      const t = (sy - ay) / (by - ay);
      xs.push([ax + t * (bx - ax), up ? 1 : -1]);
    }
    xs.sort((a, b) => a[0] - b[0]);
    let wind = 0;
    for (let i = 0; i < xs.length - 1; i++) {
      wind += xs[i][1];
      if (wind !== 0) {
        const c0 = Math.max(0, Math.ceil(xs[i][0] - 0.5)), c1 = Math.min(W - 1, Math.floor(xs[i + 1][0] - 0.5));
        for (let c = c0; c <= c1; c++) img[r * W + c] = 1;
      }
    }
  }
  return { img, W, H, ox, oy };
}

// ---------- Zhang–Suen thinning ----------
function thin(img, W, H) {
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : img[y * W + x]);
  let changed = true;
  while (changed) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      const del = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (!img[y * W + x]) continue;
        const n = [at(x, y - 1), at(x + 1, y - 1), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1), at(x - 1, y + 1), at(x - 1, y), at(x - 1, y - 1)];
        const B = n.reduce((s, v) => s + v, 0);
        if (B < 2 || B > 6) continue;
        let A = 0;
        for (let i = 0; i < 8; i++) if (!n[i] && n[(i + 1) % 8]) A++;
        if (A !== 1) continue;
        if (pass === 0 ? (n[0] && n[2] && n[4]) || (n[2] && n[4] && n[6]) : (n[0] && n[2] && n[6]) || (n[0] && n[4] && n[6])) continue;
        del.push(y * W + x);
      }
      if (del.length) changed = true;
      for (const i of del) img[i] = 0;
    }
  }
  return img;
}

// ---------- skeleton graph → polylines ----------
const N8 = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];

function neighbours(sk, W, H, i) {
  const x = i % W, y = (i / W) | 0, out = [];
  for (const [dx, dy] of N8) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < W && ny < H && sk[ny * W + nx]) out.push(ny * W + nx);
  }
  return out;
}

// Crossing number: how many separate runs of ink surround a pixel. 1 = a stroke end,
// 2 = the middle of a stroke (even on a staircase), 3+ = a junction. Counting plain
// neighbours instead would call every staircase corner a junction.
function crossing(sk, W, H, i) {
  const x = i % W, y = (i / W) | 0;
  const v = N8.map(([dx, dy]) => {
    const nx = x + dx, ny = y + dy;
    return nx >= 0 && ny >= 0 && nx < W && ny < H ? sk[ny * W + nx] : 0;
  });
  let c = 0;
  for (let k = 0; k < 8; k++) if (!v[k] && v[(k + 1) % 8]) c++;
  return c;
}

function tracePaths(sk, W, H) {
  const isNode = (i) => { const c = crossing(sk, W, H, i); return c !== 2 || neighbours(sk, W, H, i).length === 1; };
  const node = new Uint8Array(sk.length);
  for (let i = 0; i < sk.length; i++) if (sk[i] && isNode(i)) node[i] = 1;
  const seen = new Uint8Array(sk.length);
  const paths = [];
  const is4 = (a, b) => Math.abs(a - b) === 1 || Math.abs(a - b) === W;
  const walk = (start, first) => {
    const path = [start, first];
    let prev = start, cur = first;
    while (!node[cur]) {
      seen[cur] = 1;
      const nb = neighbours(sk, W, H, cur).filter((n) => n !== prev && (node[n] ? n !== start || path.length > 3 : !seen[n]));
      if (!nb.length) break;
      nb.sort((a, b) => (node[b] - node[a]) || ((is4(cur, a) ? 0 : 1) - (is4(cur, b) ? 0 : 1)));
      prev = cur; cur = nb[0];
      path.push(cur);
    }
    return path;
  };
  for (let i = 0; i < sk.length; i++) {
    if (!node[i]) continue;
    seen[i] = 1;
    for (const n of neighbours(sk, W, H, i)) {
      if (node[n]) { if (n > i) paths.push([i, n]); continue; }
      if (!seen[n]) paths.push(walk(i, n));
    }
  }
  // closed loops with no node at all (the eye of ه or و can become one)
  for (let i = 0; i < sk.length; i++) {
    if (!sk[i] || seen[i]) continue;
    seen[i] = 1;
    const nb = neighbours(sk, W, H, i);
    if (!nb.length) { paths.push([i]); continue; }
    const p = walk(i, nb[0]);
    p.push(i);
    paths.push(p);
  }
  // merge chains of tiny node-to-node hops (junction clusters) away: drop 2-pixel links between adjacent nodes
  return paths.filter((p) => !(p.length === 2 && node[p[0]] && node[p[1]] && neighbours(sk, W, H, p[0]).length > 2));
}

function pruneSpurs(sk, W, H, maxLen) {
  for (let round = 0; round < 3; round++) {
    const paths = tracePaths(sk, W, H);
    let removed = false;
    for (const p of paths) {
      const a = p[0], b = p[p.length - 1];
      const end = (i) => crossing(sk, W, H, i) === 1 || neighbours(sk, W, H, i).length === 1;
      const junction = (i) => crossing(sk, W, H, i) >= 3;
      const da = end(a) ? 1 : junction(a) ? 3 : 2, db = end(b) ? 1 : junction(b) ? 3 : 2;
      const spur = (da === 1 && db >= 3) || (db === 1 && da >= 3);
      if (spur && p.length <= maxLen) {
        const keepEnd = da >= 3 ? a : b;
        for (const i of p) if (i !== keepEnd) sk[i] = 0;
        removed = true;
      }
    }
    if (!removed) break;
  }
}

function components(img, W, H) {
  const lab = new Int32Array(W * H).fill(-1);
  const comps = [];
  for (let i = 0; i < img.length; i++) {
    if (!img[i] || lab[i] >= 0) continue;
    const id = comps.length, stack = [i], px = [];
    lab[i] = id;
    while (stack.length) {
      const c = stack.pop(); px.push(c);
      const x = c % W, y = (c / W) | 0;
      for (const [dx, dy] of N8) {
        const nx = x + dx, ny = y + dy, n = ny * W + nx;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && img[n] && lab[n] < 0) { lab[n] = id; stack.push(n); }
      }
    }
    comps.push(px);
  }
  return { lab, comps };
}

function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  const L = Math.hypot(bx - ax, by - ay);
  if (L < 1e-6) {
    // a closed loop: split it at the point farthest from the start and simplify each half
    let far = 1, fd = 0;
    for (let i = 1; i < pts.length - 1; i++) { const d = Math.hypot(pts[i][0] - ax, pts[i][1] - ay); if (d > fd) { fd = d; far = i; } }
    return rdp(pts.slice(0, far + 1), eps).slice(0, -1).concat(rdp(pts.slice(far), eps));
  }
  let idx = 0, best = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L;
    if (d > best) { best = d; idx = i; }
  }
  if (best <= eps) return [pts[0], pts[pts.length - 1]];
  return rdp(pts.slice(0, idx + 1), eps).slice(0, -1).concat(rdp(pts.slice(idx), eps));
}

function smooth(pts, n = 2) {
  let p = pts;
  for (let k = 0; k < n; k++) {
    if (p.length < 3) return p;
    const q = [p[0]];
    for (let i = 1; i < p.length - 1; i++) q.push([(p[i - 1][0] + 2 * p[i][0] + p[i + 1][0]) / 4, (p[i - 1][1] + 2 * p[i][1] + p[i + 1][1]) / 4]);
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}

function skeletonGlyph(cmds) {
  const polys = flatten(cmds);
  if (!polys.length) return null;
  const { img, W, H, ox, oy } = rasterise(polys);
  const filled = img.slice();
  const ink = filled.reduce((s, v) => s + v, 0);
  if (!ink) return null;
  const { lab, comps } = components(filled, W, H);
  const sk = thin(img, W, H);
  // estimate stroke width: filled area / skeleton length
  const skLen = sk.reduce((s, v) => s + v, 0) || 1;
  const strokePx = ink / skLen;
  pruneSpurs(sk, W, H, Math.max(3, Math.round(strokePx * 1.6)));
  const toUnits = (i) => [ox + ((i % W) + 0.5) * UNITS_PER_PX, oy - (((i / W) | 0) + 0.5) * UNITS_PER_PX];

  const bodyComps = [], dots = [];
  const big = Math.max(...comps.map((c) => c.length));
  comps.forEach((c, id) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const i of c) { const x = i % W, y = (i / W) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const ext = Math.max(x1 - x0, y1 - y0) + 1;
    // a nuqta is a compact blob only a few stroke widths across
    // a nuqta (or a full stop, or the Persian zero) is a compact blob: no longer than ~3 stroke
    // widths and mostly filled, never a stroke that merely happens to be short
    const fill = c.length / (ext * ext);
    if (ext <= strokePx * 3.2 && (c.length < big || fill > 0.45)) {
      const [cx, cy] = toUnits(Math.round((y0 + y1) / 2) * W + Math.round((x0 + x1) / 2));
      dots.push([Math.round(cx), Math.round(cy), Math.round((ext * UNITS_PER_PX) / 2)]);
    } else bodyComps.push(id);
  });

  const paths = [];
  for (const p of tracePaths(sk, W, H)) {
    const comp = lab[p[0]];
    if (!bodyComps.includes(comp)) continue;
    if (p.length < 2) continue;
    const pts = smooth(rdp(p.map(toUnits), UNITS_PER_PX * 0.6), 2).map(([x, y]) => [Math.round(x), Math.round(y)]);
    paths.push({ c: comp, p: pts.flat() });
  }
  // single isolated skeleton pixels (tiny marks) count as dots
  return { paths, dots, w: Math.round(strokePx * UNITS_PER_PX) };
}

// ---------- main ----------
const hb = await hbPromise;
const data = readFileSync(fontPath);
const blob = hb.createBlob(data);
const face = hb.createFace(blob, 0);
const font = hb.createFont(face);
const maxp = face.reference_table('maxp');
const numGlyphs = (maxp[4] << 8) | maxp[5];
// Which glyphs can Persian text reach? Shape every character we support in all four
// joining positions (between tatweels) and collect the glyph ids HarfBuzz picks.
const chars = [];
const addRange = (a, b) => { for (let c = a; c <= b; c++) chars.push(String.fromCodePoint(c)); };
addRange(0x0020, 0x007e);           // basic Latin (names, dates, numbers in sources)
addRange(0x060c, 0x061f);           // Arabic punctuation
addRange(0x0621, 0x065f);           // Arabic letters + harakat
addRange(0x066a, 0x06d5);           // extended letters (پ چ ژ گ ک ی ...), Persian forms
addRange(0x06f0, 0x06f9);           // Persian digits
chars.push('«', '»', '…', '–', '—', '‌', '‍');
const reach = new Set();
const normaliseLikeRuntime = (x) => x
  .replace(/\u064A/g, '\u06CC').replace(/\u0649/g, '\u06CC').replace(/\u0643/g, '\u06A9')
  .replace(/[0-9]/g, (d) => String.fromCharCode(0x06f0 + +d))
  .replace(/[\u0660-\u0669]/g, (d) => String.fromCharCode(0x06f0 + d.charCodeAt(0) - 0x0660));
  // (the runtime also drops tatweel; it is kept here only to reach joining forms)
const shapeIds = (t) => {
  const b = hb.createBuffer();
  // the same settings and text clean-up the app uses at runtime (shaper.ts)
  b.addText(normaliseLikeRuntime(t)); b.setDirection('rtl'); b.setScript('Arab'); b.setLanguage('fa'); hb.shape(font, b);
  for (const g of b.json()) reach.add(g.g);
  b.destroy();
};
const T = 'ـ';
for (const ch of chars) for (const t of [ch, T + ch, ch + T, T + ch + T, 'ب' + ch + 'ب', ch + 'ب', 'ب' + ch]) shapeIds(t);
for (const a of ['ا', 'أ', 'إ', 'آ']) for (const t of ['ل' + a, 'بل' + a]) shapeIds(t);
shapeIds('الله');
// contextual alternates (Vazirmatn's ".long" teeth and the like) only appear next to certain
// letters, so shape every three-letter sequence, and every word in the collection
const LET = [...'اآأإءؤئبپتثجچحخدذرزژسشصضطظعغفقکگلمنوهیةي'];
for (const a of LET) for (const b of LET) { shapeIds(a + b); for (const c of LET) shapeIds(a + b + c); }
try {
  const letters = JSON.parse(readFileSync(new URL('../content/letters.json', import.meta.url), 'utf8'));
  const words = new Set(letters.flatMap((l) => l.text.split(/\s+/)));
  for (const w of words) shapeIds(w);
} catch { /* collection not built yet */ }

const glyphs = {};
let n = 0;
for (let g = 0; g < numGlyphs; g++) {
  if (!reach.has(g)) continue;
  const sk = skeletonGlyph(font.glyphToJson(g));
  if (!sk) continue;
  glyphs[g] = sk;
  n++;
}
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ upem: face.upem, source: fontPath.split('/').pop(), unitsPerPx: UNITS_PER_PX, glyphs }));
console.log(`upem ${face.upem}, ${numGlyphs} glyphs, ${n} skeletonised → ${outPath}`);
