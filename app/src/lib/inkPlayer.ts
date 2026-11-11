// Plays strokes onto a canvas on one clock. New strokes can be queued while it writes
// (a reply grows word by word), and the canvas can grow without losing what is written.
import type { Hand } from '../engine/hand';
import type { Stroke } from '../engine/compose';
import { drawBetween, sizeCanvas } from '../engine/render';
import { shiftStroke } from '../engine/marks';

export class InkPlayer {
  private all: Stroke[] = [];
  private clock = 0;
  private end = 0;
  private raf = 0;
  private last = 0;
  private ctx: CanvasRenderingContext2D;
  pace = 1;
  onProgress?: (done: number, total: number) => void;
  onIdle?: () => void;

  private canvas: HTMLCanvasElement;
  private hand: Hand;
  private w: number;
  private h: number;

  constructor(canvas: HTMLCanvasElement, hand: Hand, w: number, h: number) {
    this.canvas = canvas; this.hand = hand; this.w = w; this.h = h;
    this.ctx = sizeCanvas(canvas, w, h);
  }

  setHand(hand: Hand) { this.hand = hand; }

  resize(w: number, h: number) {
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.ctx = sizeCanvas(this.canvas, w, h);
    drawBetween(this.ctx, this.all, this.hand, -Infinity, this.clock);
  }

  reset() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.all = []; this.clock = 0; this.end = 0;
    this.ctx.clearRect(0, 0, this.w, this.h);
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
      const next = Math.min(this.end, this.clock + dt * this.pace);
      drawBetween(this.ctx, this.all, this.hand, this.clock, next);
      this.clock = next;
      this.onProgress?.(this.clock, this.end);
      if (this.clock >= this.end) { this.raf = 0; this.onIdle?.(); return; }
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  finish() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    drawBetween(this.ctx, this.all, this.hand, this.clock, this.end);
    this.clock = this.end;
    this.onProgress?.(this.clock, this.end);
    this.onIdle?.();
  }

  get busy() { return this.clock < this.end; }

  /** Every stroke written so far, on the player's clock (for export and share). */
  get strokes() { return this.all; }

  destroy() { cancelAnimationFrame(this.raf); }
}
