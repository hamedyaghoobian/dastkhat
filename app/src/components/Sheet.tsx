import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { Hand } from '../engine/hand';
import type { Page } from '../engine/compose';
import { InkPlayer } from '../lib/inkPlayer';
import { PAPERS, ruleYs, type PaperId } from '../lib/paper';

export type SheetHandle = { finish(): void; replay(): void; player(): InkPlayer | null };

type Props = {
  page: Page | null;
  hand: Hand;
  paper: PaperId;
  pace: number;
  label: string;
  onProgress?: (done: number, total: number) => void;
};

/** A sheet of paper that writes out a page. */
export const Sheet = forwardRef<SheetHandle, Props>(function Sheet({ page, hand, paper, pace, label, onProgress }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const player = useRef<InkPlayer | null>(null);
  const progress = useRef(onProgress);
  progress.current = onProgress;

  useEffect(() => {
    if (!page || !canvas.current) return;
    if (!player.current) player.current = new InkPlayer(canvas.current, hand, page.width, page.height);
    const p = player.current;
    p.setHand(hand);
    p.resize(page.width, page.height);
    p.reset();
    p.pace = pace;
    p.onProgress = (d, t) => progress.current?.(d, t);
    p.enqueue(page.strokes);
  }, [page, hand]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (player.current) player.current.pace = pace; }, [pace]);
  useEffect(() => () => player.current?.destroy(), []);

  useImperativeHandle(ref, () => ({
    finish: () => player.current?.finish(),
    replay: () => { if (page && player.current) { player.current.reset(); player.current.enqueue(page.strokes); } },
    player: () => player.current,
  }), [page]);

  const p = PAPERS.find((x) => x.id === paper)!;
  const h = page?.height ?? 600, w = page?.width ?? 680;
  return (
    <div className={`sheet ${paper}`} style={{ width: w, height: h }} role="img" aria-label={label}>
      <div className="grain" />
      {p.ruled && ruleYs(hand, h).map((y) => <div key={y} className="rule" style={{ top: y }} />)}
      <canvas ref={canvas} />
    </div>
  );
});
