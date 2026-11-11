// A script is the letterforms a hand writes with: a font to shape the text, the single-line skeletons traced from it,
// and the few measures that differ between them.
//   nastaliq: the everyday nasta'liq / shekasteh-leaning hand of real Persian letters (Qajar letters, clerics' notes):
//             words slant down to the left as they cascade, long bowls, tall slanted alefs. From Noto Nastaliq Urdu.
//   naskh:    an upright, rounder hand, closer to print. From Vazirmatn Thin.
// Skeleton files are large, so each is loaded only when a hand needs it.
import { loadShaper, type ShapedGlyph } from './shaper';

export type Style = 'nastaliq' | 'naskh';
export const STYLES: { id: Style; name: string }[] = [
  { id: 'nastaliq', name: 'نستعلیق تحریری' },
  { id: 'naskh', name: 'نسخ' },
];

export type SkGlyph = { paths: { p: number[]; c?: number }[]; dots: [number, number, number][]; w: number };
export type SkSet = { upem: number; glyphs: Record<string, SkGlyph> };

export type Script = {
  style: Style;
  shape: (text: string) => ShapedGlyph[];
  sk: SkSet;
  /** glyph scale: px per font unit = hand.size · scale / upem */
  scale: number;
  /** a letter's body height as a share of the hand's size (sets what counts as a sharp turn, pools, flicks) */
  xh: number;
  /** extra line spacing for this script, × the hand's own */
  lineGap: number;
};

const FILES: Record<Style, { font: string; sk: () => Promise<{ default: unknown }>; scale: number; xh: number; lineGap: number }> = {
  nastaliq: { font: 'NotoNastaliqUrdu.ttf', sk: () => import('./data/skeletons-nastaliq.json'), scale: 1.05, xh: 0.32, lineGap: 1.18 },
  naskh: { font: 'Vazirmatn-Thin.ttf', sk: () => import('./data/skeletons.json'), scale: 1, xh: 0.45, lineGap: 1 },
};

const cache = new Map<Style, Promise<Script>>();
export function loadScript(style: Style): Promise<Script> {
  const hit = cache.get(style);
  if (hit) return hit;
  const f = FILES[style];
  const p = Promise.all([loadShaper(f.font), f.sk()]).then(([sh, mod]) => ({
    style, shape: sh.shape, sk: mod.default as SkSet, scale: f.scale, xh: f.xh, lineGap: f.lineGap,
  }));
  cache.set(style, p);
  return p;
}
