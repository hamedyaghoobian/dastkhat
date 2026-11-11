// Plays strokes onto a canvas on one clock. New strokes can be queued while it writes
// (a reply grows word by word), and the canvas can grow without losing what is written.
import type { Hand } from '../engine/hand';
import type { Stroke } from '../engine/compose';
import { InkCanvas } from '../engine/ink';
import { shiftStroke } from '../engine/marks';

export class InkPlayer {
  private all: Stroke[] = [];
  private clock = 0;
  private end = 0;
  private raf = 0;
  private last = 0;
  private ink: InkCanvas;
  pace = 1;
  onProgress?: (done: number, total: number) => void;
  onIdle?: () => void;

  private canvas: HTMLCanvasElement;
  private hand: Hand;
  private w: number;
  private h: number;

  constructor(canvas: HTMLCanvasElement, hand: Hand, w: number, h: number) {
    this.canvas = canvas; this.hand = hand; this.w = w; this.h = h;
    this.ink = new InkCanvas(canvas);
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    this.draw();
  }

  /** Ink is a density field (engine/ink.ts): every frame redraws the page up to the pen's time. */
  private draw() { this.ink.render(this.all, this.hand, this.clock, this.w, this.h); }

  setHand(hand: Hand) { this.hand = hand; }

  resize(w: number, h: number) {
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    this.draw();
  }

  reset() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.all = []; this.clock = 0; this.end = 0;
    this.draw();
  }

  /** Queue strokes. Their own times are kept relative to each other; the batch starts after what is queued. */
  enqueue(strokes: Stroke[], gap = 0) {
    if (!strokes.length) return;
    const start = Math.max(this.end, this.clock) + gap;
    const t0 = Math.min(...strokes.map((s) => s.pts[2]));
    for (const s of strokes) {
      const sh = shiftStroke(s, s.pts[2] - t0 + start);
      this.all.push(sh);
      this.end = Math.max(this.end, sh.pts[sh.pts.length - 2]);
    }
    this.start();
  }

  private start() {
    if (this.raf) return;
    this.last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(64, now - this.last);
      this.last = now;
      this.clock = Math.min(this.end, this.clock + dt * this.pace);
      this.draw();
      this.onProgress?.(this.clock, this.end);
      if (this.clock >= this.end) { this.raf = 0; this.onIdle?.(); return; }
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  finish() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.clock = this.end;
    this.draw();
    this.onProgress?.(this.clock, this.end);
    this.onIdle?.();
  }

  get busy() { return this.clock < this.end; }

  /** Every stroke written so far, on the player's clock (for export and share). */
  get strokes() { return this.all; }

  destroy() { cancelAnimationFrame(this.raf); }
}
