// How fast the pen moves along a stroke: fast on straights, slow at turns, from rest at the start, easing off at the end.
// Ported from If This Finds You (engine/kinematics.js, © Rafael Cespedes, MIT):
//  - speed follows curvature, v ∝ κ^(−1/3) (the "two-thirds power law" of handwriting);
//  - the pen dips in speed at sharp turns, which split a stroke into sub-strokes;
//  - each sub-stroke is lopsided: a quick rise and a long tail.
// Returns speed normalised to the stroke's mean (vn ≈ 1 on average; below 1 = slow = more ink).
type Pt = [number, number];

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const smoothstep = (x: number) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

/** pts in page px; xh: the hand's letter height in px (sets what counts as a "sharp" turn). */
export function kinematics(pts: Pt[], xh: number, beta = 0.33, dipDepth = 0.6) {
  const n = pts.length;
  const s = new Float64Array(n), kappa = new Float64Array(n), v = new Float64Array(n), vn = new Float64Array(n);
  if (n < 2) return { s, vn: vn.fill(1), splits: [] as number[] };
  for (let i = 1; i < n; i++) s[i] = s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);

  // discrete curvature: turning angle over local arclength, lightly smoothed
  const raw = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) {
    const ax = pts[i][0] - pts[i - 1][0], ay = pts[i][1] - pts[i - 1][1];
    const bx = pts[i + 1][0] - pts[i][0], by = pts[i + 1][1] - pts[i][1];
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la < 1e-9 || lb < 1e-9) continue;
    raw[i] = Math.acos(clamp((ax * bx + ay * by) / (la * lb), -1, 1)) / ((la + lb) / 2);
  }
  raw[0] = raw[Math.min(1, n - 1)]; raw[n - 1] = raw[Math.max(0, n - 2)];
  const kMin = 1 / (2 * xh), kMax = 1 / (0.04 * xh);
  for (let i = 0; i < n; i++) kappa[i] = clamp((raw[Math.max(0, i - 1)] + 2 * raw[i] + raw[Math.min(n - 1, i + 1)]) / 4, kMin, kMax);

  // sharp turns: curvature peaks above a threshold -> speed dips
  const kSplit = 1 / (0.12 * xh);
  const splits: number[] = [];
  for (let i = 2; i < n - 2; i++) {
    if (kappa[i] >= kSplit && kappa[i] >= kappa[i - 1] && kappa[i] > kappa[i + 1]) {
      if (!splits.length || s[i] - s[splits[splits.length - 1]] > 0.15 * xh) splits.push(i);
    }
  }

  for (let i = 0; i < n; i++) v[i] = Math.pow(kappa[i], -beta);
  const bounds = [0, ...splits, n - 1];
  for (let b = 0; b < bounds.length - 1; b++) {
    const i0 = bounds[b], i1 = bounds[b + 1];
    const s0 = s[i0], len = Math.max(1e-6, s[i1] - s0);
    const last = b === bounds.length - 2;
    const startFloor = b === 0 ? 0.12 : 1 - dipDepth; // the pen lands from rest; mid-stroke dips are partial
    const endFloor = last ? 0.18 : 1 - dipDepth;
    for (let i = i0; i < i1 + (last ? 1 : 0); i++) {
      const u = (s[i] - s0) / len;
      v[i] *= Math.min(startFloor + (1 - startFloor) * smoothstep(u / 0.22), endFloor + (1 - endFloor) * smoothstep((1 - u) / 0.45));
    }
  }
  // normalise to the time-weighted mean speed (total length / total time)
  let T = 0;
  for (let i = 1; i < n; i++) T += (s[i] - s[i - 1]) / Math.max(1e-6, (v[i] + v[i - 1]) / 2);
  const mean = s[n - 1] / Math.max(1e-6, T);
  for (let i = 0; i < n; i++) vn[i] = v[i] / (mean || 1);
  return { s, vn, splits };
}
