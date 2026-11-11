import type { Hand } from '../engine/hand';
import type { Stroke } from '../engine/compose';
import { drawBetween } from '../engine/render';

export type PaperId = 'ivory' | 'khaki' | 'tinted' | 'white';
export const PAPERS: { id: PaperId; name: string; color: string; ruled: boolean }[] = [
  { id: 'ivory', name: 'شیری', color: '#fbf6ea', ruled: false },
  { id: 'khaki', name: 'کاهی', color: '#e9dcc0', ruled: false },
  { id: 'tinted', name: 'نخودی', color: '#f2e3cf', ruled: false },
  { id: 'white', name: 'خط‌دار', color: '#fdfcf8', ruled: true },
];

export const MARGIN = { top: 48, right: 56, bottom: 48, left: 48 };

/** Where the rules fall for this writer (they don't always keep to them). */
export function ruleYs(hand: Hand, height: number) {
  const ys: number[] = [];
  for (let y = MARGIN.top + hand.size * 1.1 + hand.size * 0.12; y < height - 10; y += hand.size * hand.lineGap) ys.push(y);
  return ys;
}

/** The page as the screen shows it: paper, then the ink drawn as one layer and laid on once. */
export function renderPage(strokes: Stroke[], hand: Hand, w: number, h: number, paper: PaperId, caption: string, scale = 2) {
  const c = document.createElement('canvas');
  c.width = w * scale; c.height = (h + 40) * scale;
  const ctx = c.getContext('2d')!;
  ctx.scale(scale, scale);
  const p = PAPERS.find((x) => x.id === paper)!;
  ctx.fillStyle = p.color;
  ctx.fillRect(0, 0, w, h + 40);
  if (p.ruled) {
    ctx.fillStyle = 'rgba(150,170,195,0.55)';
    for (const y of ruleYs(hand, h)) ctx.fillRect(0, y, w, 1);
  }
  // On screen the ink canvas is drawn opaque and shown at the ink's opacity, multiplied onto the
  // paper. Do the same here, so overlapping segments don't bead darker than they look on screen.
  const ink = document.createElement('canvas');
  ink.width = c.width; ink.height = c.height;
  const ictx = ink.getContext('2d')!;
  ictx.scale(scale, scale);
  drawBetween(ictx, strokes, hand, -Infinity, Infinity);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = hand.ink.alpha;
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(ink, 0, 0);
  ctx.restore();
  ctx.fillStyle = '#7a6a58';
  ctx.font = '12px Vazirmatn, sans-serif';
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.fillText(caption, w - MARGIN.right, h + 22);
  return c;
}

export async function exportPNG(strokes: Stroke[], hand: Hand, w: number, h: number, paper: PaperId, caption: string) {
  const c = renderPage(strokes, hand, w, h, paper, caption);
  const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b!), 'image/png'));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'nameh.png';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
