// Write a reply on a fresh sheet. The pen writes each word once you finish it (Persian
// letters change shape as the word grows, so a word is the natural unit). Backspace on a
// written word crosses it out; pressing again crosses it out harder, then scribbles over it.
// Nothing written is ever erased.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Hand } from '../engine/hand';
import { compose, type Page } from '../engine/compose';
import { normalisePersian, type ShapedGlyph } from '../engine/shaper';
import { strikeStroke } from '../engine/marks';
import { InkPlayer } from '../lib/inkPlayer';
import { MARGIN, PAPERS, exportPNG, ruleYs, type PaperId } from '../lib/paper';

type Token = { kind: 'word'; text: string; strikes: number } | { kind: 'nl' };

type Props = { hand: Hand; paper: PaperId; width: number; shape: (t: string) => ShapedGlyph[]; replyTo: string | null };

const MIN_H = 520;

function tokensToText(tokens: Token[]) {
  let s = '';
  for (const t of tokens) {
    if (t.kind === 'nl') s += '\n';
    else s += (s && !s.endsWith('\n') ? ' ' : '') + t.text;
  }
  return s;
}

export function ReplySheet({ hand, paper, width, shape, replyTo }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const player = useRef<InkPlayer | null>(null);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [pending, setPending] = useState('');
  const [focused, setFocused] = useState(false);
  const pageRef = useRef<Page | null>(null);
  const tokensRef = useRef<Token[]>([]);
  tokensRef.current = tokens;
  const drawnWords = useRef(0);

  const opts = useMemo(() => ({ width, margin: MARGIN }), [width]);
  const page = useMemo(() => compose(normalisePersian(tokensToText(tokens)), hand, shape, opts), [tokens, hand, shape, opts]);
  const height = Math.max(MIN_H, page.height + hand.size * 2);

  // A new pen, writer or width keeps what you wrote: the reply is laid out again in the new hand,
  // with its crossings-out, and shown at once.
  useEffect(() => {
    if (!canvas.current) return;
    const ts = tokensRef.current;
    const pg = compose(normalisePersian(tokensToText(ts)), hand, shape, { width, margin: MARGIN });
    const p = new InkPlayer(canvas.current, hand, width, Math.max(MIN_H, pg.height + hand.size * 2));
    p.pace = 1.6;
    player.current = p;
    const strikes = [];
    let wi = -1;
    for (const t of ts) {
      if (t.kind !== 'word') continue;
      wi++;
      for (let level = 1; level <= t.strikes; level++) if (pg.words[wi]) strikes.push(strikeStroke(pg.words[wi], hand, level));
    }
    if (pg.strokes.length) { p.enqueue(pg.strokes); for (const s of strikes) p.enqueue([s]); p.finish(); }
    drawnWords.current = pg.words.length;
    pageRef.current = pg;
    return () => p.destroy();
  }, [hand, width, shape]);

  // new words go to the pen as soon as they are committed
  useEffect(() => {
    const p = player.current;
    if (!p) return;
    p.resize(width, height);
    const fresh = page.strokes.filter((s) => s.word >= drawnWords.current);
    if (fresh.length) p.enqueue(fresh, 80);
    drawnWords.current = page.words.length;
    pageRef.current = page;
  }, [page, width, height]);

  const commit = (word: string, then?: 'nl') => {
    const w = word.trim();
    setTokens((ts) => {
      const next = [...ts];
      if (w) for (const part of w.split(/\s+/)) next.push({ kind: 'word', text: part, strikes: 0 });
      if (then === 'nl') next.push({ kind: 'nl' });
      return next;
    });
    setPending('');
  };

  const crossOut = () => {
    const pg = pageRef.current;
    if (!pg) return;
    const ts = tokensRef.current;
    // the last word not yet scribbled over
    let wi = -1, ti = -1, count = -1;
    ts.forEach((t, i) => { if (t.kind === 'word') { count++; if (t.strikes < 3) { wi = count; ti = i; } } });
    if (ti < 0) return;
    const t = ts[ti] as Extract<Token, { kind: 'word' }>;
    const placed = pg.words[wi];
    if (placed) player.current?.enqueue([strikeStroke(placed, hand, t.strikes + 1)], 40);
    const next = ts.slice();
    next[ti] = { ...t, strikes: t.strikes + 1 };
    tokensRef.current = next;
    setTokens(next);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') { e.preventDefault(); commit(pending, 'nl'); }
    else if (e.key === ' ') { e.preventDefault(); commit(pending); }
    else if (e.key === 'Backspace' && pending === '') { e.preventDefault(); crossOut(); }
  };
  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    // phones often send the space as text rather than a key
    if (/[ \n]/.test(v)) {
      const parts = v.split(/([ \n])/);
      let acc = '';
      for (const p of parts) {
        if (p === ' ') { commit(acc); acc = ''; }
        else if (p === '\n') { commit(acc, 'nl'); acc = ''; }
        else acc += p;
      }
      setPending(acc);
    } else setPending(v);
  };

  const p = PAPERS.find((x) => x.id === paper)!;
  const em = hand.size;
  const cx = page.words.length ? page.cursor.x : width - MARGIN.right;
  const cy = page.words.length ? page.cursor.y : MARGIN.top + em * 1.1;
  const written = tokens.filter((t) => t.kind === 'word').length;

  return (
    <div>
      <div
        className={`sheet ${paper}`}
        style={{ width, height, cursor: 'text' }}
        onClick={() => input.current?.focus()}
        role="textbox"
        aria-label="پاسخ شما، به خط دست"
        aria-multiline
      >
        <div className="grain" />
        {p.ruled && ruleYs(hand, height).map((y) => <div key={y} className="rule" style={{ top: y }} />)}
        <canvas ref={canvas} style={{ opacity: hand.ink.alpha }} />
        {(focused || pending) && (
          <span className="ghost" style={{ right: width - cx, top: cy - em * 0.95, fontSize: Math.max(15, em * 0.55) }}>
            {pending || '‌'}
          </span>
        )}
        <textarea
          ref={input}
          className="reply-input"
          value={pending}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          dir="rtl"
          lang="fa"
          aria-label="بنویسید؛ با فاصله هر واژه نوشته می‌شود، پس‌بَر روی واژهٔ نوشته‌شده آن را خط می‌زند"
        />
        {!written && !focused && (
          <div className="hint" style={{ position: 'absolute', right: MARGIN.right, top: MARGIN.top, pointerEvents: 'none' }}>
            {replyTo ? `برای پاسخ به ${replyTo} اینجا کلیک کنید و بنویسید…` : 'اینجا کلیک کنید و بنویسید…'}
          </div>
        )}
      </div>
      <div className="btns" style={{ marginTop: 10, justifyContent: 'center' }}>
        <span className="hint">فاصله: نوشتن واژه · Enter: سطر تازه · پس‌بَر: خط زدن</span>
        <button className="btn" disabled={!written} onClick={() => exportPNG(player.current?.strokes ?? [], hand, width, height, paper, 'پاسخ، به خط دست')}>
          دانلود تصویر
        </button>
      </div>
    </div>
  );
}
