// A seed becomes a writer. Traits are drawn together, not as independent dice: a hurried
// writer is also a little untidier, writes larger and joins dots into dashes more often.
import { rng } from './rng';

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
  nibAngle: number;    // radians, for reed and fountain
  nibWidth: number;    // em
  ink: Ink;
  speed: number;       // px per ms at full pace
};

export type HandOverrides = Partial<Pick<Hand, 'pen' | 'neatness' | 'hurry' | 'size' | 'slant' | 'pressure'>> & { ink?: string };

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
  return {
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
    nibAngle: r.range(0.9, 1.25), // about 50°–70°, the way a reed is held for naskh
    nibWidth: pen === 'reed' ? r.range(0.07, 0.1) : pen === 'fountain' ? r.range(0.04, 0.06) : pen === 'pencil' ? r.range(0.03, 0.04) : r.range(0.028, 0.036),
    ink: INKS.find((i) => i.id === inkId) ?? INKS[0],
    speed: 0.5 + hurry * 0.7,
  };
}
