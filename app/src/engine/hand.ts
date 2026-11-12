// Two hands, each tuned against a real letter rather than rolled from dice:
//   qajar — a munshi's reed (qalam) in gall ink, as in the Qajar letters of WWQI: heavy, short, wide-spaced lines,
//           thick horizontals and hairline uprights, about seven words to a line.
//   note  — a cleric's note in a fine pen, as in the handwritten letters of the 1980s: small, flat, quick,
//           level lines far apart, a dozen or more words to a line.
// The seed only varies the small things (which word wavers, where the pen runs dry); the hand stays the same.
import type { Style } from './script';

export type PenKind = 'reed' | 'fountain' | 'ballpoint' | 'pencil';

export type Ink = { id: string; name: string; color: string; alpha: number };

export const INKS: Ink[] = [
  { id: 'black', name: 'مرکب سیاه', color: '#1d1a17', alpha: 0.92 },
  { id: 'gall', name: 'مازو', color: '#2e2219', alpha: 0.9 },
  { id: 'blueblack', name: 'آبی‌سیاه', color: '#1b2540', alpha: 0.92 },
];

export type Hand = {
  id: HandId;
  seed: string;
  size: number;        // px per em
  slant: number;       // shear; positive leans the tops to the left
  neatness: number;    // 0 untidy … 1 neat
  hurry: number;       // 0 slow … 1 hurried
  wordGap: number;     // in em
  lineGap: number;     // baseline-to-baseline, in em (before the script's own factor)
  baselineDrift: number; // em of slow wander along a line
  wordTilt: number;    // words tend to climb to the left end (radians)
  stretch: number;     // horizontal scale
  wobble: number;      // shape bending, in em
  dotDash: number;     // chance two dots are written as one dash
  dotCaret: number;    // chance three dots are written as a caret
  dotsAfterWord: number; // chance the dots wait until the whole word is written
  pressure: number;    // 0.6 … 1.4
  pen: PenKind;
  /** the script the hand writes (letterforms) */
  style: Style;
  /** a letter's body height in px (for ink: what counts as a sharp turn, how long a flick is) */
  xh: number;
  nibAngle: number;    // radians, for reed and fountain
  nibWidth: number;    // em
  ink: Ink;
  speed: number;       // px per ms at full pace
  loose: Loose;
};

export type Loose = {
  cascade: number;  // each word drops toward its left end (beyond the font's own cascade), per px
  slant: number;    // extra lean of the uprights, top to the left
  rise: number;     // a line climbs toward its left end, per px
  compress: number; // letters squeezed sideways (×)
  round: number;    // stroke rounding, in em: small teeth (sīn, the bumps of ب ت ن) melt into the line
  dotDrop: number;  // chance a nuqta is left out
  scale: number;    // unused by the tuned hands (kept for the layout code)
  toothless: number; // chance a word's sīn is written as one flat line, without teeth
  joins: number;    // chance the pen is carried across a non-joining letter into the next (shekasteh)
};

export type HandId = 'qajar' | 'note';

type Preset = Omit<Hand, 'seed' | 'xh' | 'size' | 'ink' | 'id'> & {
  name: string;
  about: string;
  ink: string;
  /** em in px for a 576 px line (the sheet at its widest); scaled with the sheet */
  em: number;
};

export const HANDS: Record<HandId, Preset> = {
  qajar: {
    name: 'قلم نی، قاجاری',
    about: 'دست منشی با قلم نی و مرکب مازو، به شیوهٔ نامه‌های دورهٔ قاجار.',
    em: 35,             // the scan is a narrow slip (7 words a line); on a full sheet the same hand fits about 9
    style: 'nastaliq',
    pen: 'reed',
    ink: 'gall',
    nibAngle: 1.2,      // a reed held steep for nasta'liq: thick across, hairline down
    nibWidth: 0.11,
    pressure: 1.1,
    slant: 0,
    neatness: 0.6,
    hurry: 0.45,
    wordGap: 0.16,
    lineGap: 1.4,
    baselineDrift: 0.03,
    wordTilt: 0.02,
    stretch: 1,
    wobble: 0.006,
    dotDash: 0.75,
    dotCaret: 0.7,
    dotsAfterWord: 0.5,
    speed: 0.6,
    loose: { cascade: 0.07, slant: 0.03, rise: 0.0015, compress: 0.7, round: 0.02, dotDrop: 0.06, scale: 1, toothless: 0.4, joins: 0.25 },
  },
  note: {
    name: 'خودنویس، یادداشت',
    about: 'دستی ریز و تند با خودنویس نوک‌باریک، به شیوهٔ یادداشت‌های دست‌نویس سدهٔ چهاردهم.',
    em: 14,
    style: 'nastaliq',
    pen: 'fountain',
    ink: 'blueblack',
    nibAngle: 1.2,
    nibWidth: 0.07,
    pressure: 0.95,
    slant: 0,
    neatness: 0.7,
    hurry: 0.7,
    wordGap: 0.28,
    lineGap: 2.8,
    baselineDrift: 0.02,
    wordTilt: 0.01,
    stretch: 1.1,       // flat and drawn out
    wobble: 0.004,
    dotDash: 0.9,
    dotCaret: 0.85,
    dotsAfterWord: 0.7,
    speed: 0.9,
    loose: { cascade: 0.012, slant: 0.02, rise: 0.0012, compress: 1, round: 0.035, dotDrop: 0.12, scale: 1, toothless: 0.75, joins: 0.4 },
  },
};

export const HAND_IDS = Object.keys(HANDS) as HandId[];

export function isHandId(x: string | undefined): x is HandId {
  return !!x && x in HANDS;
}

/** lineWidth: the sheet's writing width in px (the hand keeps its words per line on any screen) */
export function makeHand(id: HandId, seed: string, lineWidth = 576, xhShare = 0.32): Hand {
  const { name: _n, about: _a, em, ink, loose, ...p } = HANDS[id];
  const size = em * Math.max(0.6, Math.min(1.25, lineWidth / 576));
  return {
    ...p,
    id,
    seed,
    size,
    xh: size * xhShare,
    ink: INKS.find((i) => i.id === ink) ?? INKS[0],
    loose: { ...loose },
  };
}
