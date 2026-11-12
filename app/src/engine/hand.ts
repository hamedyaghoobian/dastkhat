// A seed becomes a writer. Traits are drawn together, not as independent dice: a hurried
// writer is also a little untidier, writes larger and joins dots into dashes more often.
import { rng } from './rng';
import type { Style } from './script';

export type PenKind = 'reed' | 'fountain' | 'ballpoint' | 'pencil';

export type Ink = { id: string; name: string; color: string; alpha: number };

export const INKS: Ink[] = [
  { id: 'black', name: 'مرکب سیاه', color: '#1d1a17', alpha: 0.92 },
  { id: 'gall', name: 'مازو', color: '#3b2a1c', alpha: 0.88 },
  { id: 'sepia', name: 'قهوه‌ای', color: '#5a3b22', alpha: 0.85 },
  { id: 'blue', name: 'آبی', color: '#1f3a7a', alpha: 0.9 },
  { id: 'blueblack', name: 'آبی‌سیاه', color: '#1b2540', alpha: 0.92 },
  { id: 'graphite', name: 'مداد', color: '#4a4a4f', alpha: 0.7 },
];

export const PENS: { id: PenKind; name: string }[] = [
  { id: 'reed', name: 'قلم نی' },
  { id: 'fountain', name: 'خودنویس' },
  { id: 'ballpoint', name: 'خودکار' },
  { id: 'pencil', name: 'مداد' },
];

export type Hand = {
  seed: string;
  size: number;        // px per em
  slant: number;       // shear; positive leans the tops to the left
  neatness: number;    // 0 untidy … 1 neat
  hurry: number;       // 0 slow … 1 hurried
  wordGap: number;     // in em
  lineGap: number;     // baseline-to-baseline, in em
  baselineDrift: number; // em of slow wander along a line
  wordTilt: number;    // words tend to climb to the left end (radians)
  stretch: number;     // horizontal scale
  wobble: number;      // shape bending, in em
  dotDash: number;     // chance two dots are written as one dash
  dotCaret: number;    // chance three dots are written as a caret
  dotsAfterWord: number; // chance the dots wait until the whole word is written
  pressure: number;    // 0.6 … 1.4
  pen: PenKind;
  /** the script the hand writes (letterforms); set from the loaded script */
  style: Style;
  /** a letter's body height in px (for ink: what counts as a sharp turn, how long a flick is) */
  xh: number;
  nibAngle: number;    // radians, for reed and fountain
  nibWidth: number;    // em
  ink: Ink;
  speed: number;       // px per ms at full pace
  /** How far a nasta'liq hand strays from the book hand toward a quick letter (shekasteh-leaning tahriri). */
  loose: Loose;
};

export type Loose = {
  cascade: number;  // each word drops toward its left end (beyond the font's own cascade), per px
  slant: number;    // extra lean of the uprights, top to the left
  rise: number;     // a line climbs toward its left end, per px
  compress: number; // letters squeezed sideways (×)
  round: number;    // stroke rounding, in em: small teeth (sīn, the bumps of ب ت ن) melt into the line
  dotDrop: number;  // chance a nuqta is left out
  scale: number;    // writing size (×): small and dense, or large and loose
  toothless: number; // chance a word's sīn is written as one flat line, without teeth
  joins: number;    // chance the pen is carried across a non-joining letter into the next (shekasteh)
};

export type HandOverrides = Partial<Pick<Hand, 'pen' | 'neatness' | 'hurry' | 'size' | 'slant' | 'pressure' | 'style'>> & { ink?: string; xh?: number };

export function makeHand(seed: string, o: HandOverrides = {}): Hand {
  const r = rng('hand:' + seed);
  const hurry = o.hurry ?? Math.min(1, Math.max(0, r.normal(0.45, 0.22)));
  const neatness = o.neatness ?? Math.min(1, Math.max(0, r.normal(0.72 - hurry * 0.35, 0.16)));
  const pen: PenKind = o.pen ?? r.pick(['reed', 'fountain', 'fountain', 'ballpoint', 'ballpoint', 'pencil'] as const);
  const untidy = 1 - neatness;
  const inkByPen: Record<PenKind, string[]> = {
    reed: ['black', 'gall', 'sepia'],
    fountain: ['blueblack', 'blue', 'black', 'gall'],
    ballpoint: ['blue', 'blue', 'black'],
    pencil: ['graphite'],
  };
  const inkId = o.ink ?? r.pick(inkByPen[pen]);
  const h: Hand = {
    seed,
    size: o.size ?? r.range(30, 40) * (1 + hurry * 0.1),
    slant: o.slant ?? r.normal(0.04, 0.07),
    neatness,
    hurry,
    wordGap: r.range(0.22, 0.42),
    lineGap: r.range(1.55, 1.95),
    baselineDrift: 0.02 + untidy * r.range(0.04, 0.1),
    wordTilt: r.normal(0.025, 0.02) + hurry * 0.02,
    stretch: r.range(0.9, 1.12),
    wobble: 0.004 + untidy * r.range(0.01, 0.025),
    dotDash: Math.min(0.97, 0.15 + hurry * 0.7 + r.range(0, 0.2)),
    dotCaret: Math.min(0.95, 0.1 + hurry * 0.6 + r.range(0, 0.25)),
    dotsAfterWord: r.range(0.2, 0.9),
    pressure: o.pressure ?? r.range(0.75, 1.25),
    pen,
    style: o.style ?? 'nastaliq',
    xh: 0,
    nibAngle: r.range(0.9, 1.25), // about 50°–70°, the way a reed is held for naskh
    // line widths as a share of the letter size: a reed's full width, a fountain or ballpoint's line, a pencil's
    nibWidth: pen === 'reed' ? r.range(0.085, 0.115) : pen === 'fountain' ? r.range(0.06, 0.085) : pen === 'pencil' ? r.range(0.05, 0.062) : r.range(0.045, 0.056),
    ink: INKS.find((i) => i.id === inkId) ?? INKS[0],
    speed: 0.5 + hurry * 0.7,
    loose: { cascade: 0, slant: 0, rise: 0, compress: 1, round: 0, dotDrop: 0, scale: 1, toothless: 0, joins: 0 },
  };
  // the loose hand: its own stream, so the traits above stay as they were for every seed
  const lr = rng('loose:' + seed);
  const loose: Loose = {
    cascade: 0.03 + 0.1 * hurry + lr.range(0, 0.07),
    slant: 0.05 + 0.09 * hurry + lr.range(-0.03, 0.07),
    rise: lr.range(0, 0.012) + 0.01 * hurry,
    compress: 1 - (0.04 + 0.2 * hurry) * lr.range(0.4, 1),
    round: 0.012 + 0.035 * hurry * lr.range(0.6, 1.2),
    dotDrop: Math.min(0.4, 0.02 + 0.3 * hurry * untidy + lr.range(0, 0.06)),
    scale: lr.range(0.74, 1.08),
    toothless: Math.min(0.95, 0.08 + 1.1 * hurry * lr.range(0.6, 1.2)),
    joins: Math.min(0.85, 0.04 + 0.85 * hurry * lr.range(0.5, 1.2)),
  };
  h.loose = loose;
  if (h.style === 'nastaliq' && o.size == null) {
    h.size *= loose.scale;
    h.wordGap *= 0.75 + 0.25 * loose.compress; // dense writers leave smaller gaps
  }
  h.xh = o.xh ?? h.size * 0.45;
  return h;
}
