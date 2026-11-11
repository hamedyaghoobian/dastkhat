// Seeded randomness. Everything the engine varies goes through here, never Math.random(),
// so the same seed, settings and text always give the same page.

function hashString(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export type Rng = {
  (): number;
  range(a: number, b: number): number;
  normal(mean?: number, sd?: number): number;
  pick<T>(xs: readonly T[]): T;
  chance(p: number): boolean;
};

export function rng(seed: string): Rng {
  let a = hashString(seed);
  const next = (() => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rng;
  next.range = (lo, hi) => lo + (hi - lo) * next();
  next.normal = (mean = 0, sd = 1) => {
    const u = 1 - next(), v = next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  next.pick = (xs) => xs[Math.floor(next() * xs.length)];
  next.chance = (p) => next() < p;
  return next;
}

/** Smooth 1-D value noise in [-1, 1]: a writer's slow drift (baseline, size, pressure). */
export function noise1(seed: string) {
  const r = rng(seed);
  const table = Array.from({ length: 256 }, () => r() * 2 - 1);
  return (x: number) => {
    const i = Math.floor(x), f = x - i;
    const u = f * f * (3 - 2 * f);
    const a = table[i & 255], b = table[(i + 1) & 255];
    return a + (b - a) * u;
  };
}

/** Smooth 2-D noise in [-1, 1], used to bend a whole word at once so its joins stay joined. */
export function noise2(seed: string) {
  const r = rng(seed);
  const perm = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  const vals = Array.from({ length: 256 }, () => r() * 2 - 1);
  const v = (x: number, y: number) => vals[perm[(perm[x & 255] + y) & 255]];
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
    const a = v(xi, yi), b = v(xi + 1, yi), c = v(xi, yi + 1), d = v(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
  };
}

const ADJ = ['آرام', 'روشن', 'خاموش', 'دور', 'نازک', 'تند', 'کهنه', 'سبز', 'تنها', 'گرم', 'ساده', 'پنهان'];
const NOUN = ['باران', 'سرو', 'آینه', 'کاروان', 'نسیم', 'چراغ', 'دریا', 'انار', 'کبوتر', 'ماه', 'نیلوفر', 'کوچه'];
const ADJ_LAT = ['aram', 'roshan', 'khamush', 'dur', 'nazok', 'tond', 'kohne', 'sabz', 'tanha', 'garm', 'sade', 'penhan'];
const NOUN_LAT = ['baran', 'sarv', 'ayene', 'karevan', 'nasim', 'cheragh', 'darya', 'anar', 'kabutar', 'mah', 'niloufar', 'kuche'];

/** A fresh writer seed, readable in a share link: "baran-roshan-17". */
export function newSeed(): string {
  const r = rng(String(Date.now()) + ':' + performance.now());
  const i = Math.floor(r() * NOUN_LAT.length), j = Math.floor(r() * ADJ_LAT.length);
  return `${NOUN_LAT[i]}-${ADJ_LAT[j]}-${Math.floor(r() * 90) + 10}`;
}

/** The Persian name of a seed's writer, for the record ("نویسنده: بارانِ روشن"). */
export function seedName(seed: string): string {
  const [n, a] = seed.split('-');
  const i = NOUN_LAT.indexOf(n), j = ADJ_LAT.indexOf(a);
  if (i < 0 || j < 0) return seed;
  return `${NOUN[i]}ِ ${ADJ[j]}`;
}
