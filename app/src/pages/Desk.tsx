import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sheet, type SheetHandle } from '../components/Sheet';
import { ReplySheet } from '../components/ReplySheet';
import { compose } from '../engine/compose';
import { INKS, PENS, makeHand, type HandOverrides, type PenKind } from '../engine/hand';
import { newSeed, seedName } from '../engine/rng';
import { normalisePersian, type ShapedGlyph } from '../engine/shaper';
import { LETTERS, byId, excerpt, faNum, pickNext, rightsNote } from '../lib/letters';
import { MARGIN, PAPERS, exportPNG, type PaperId } from '../lib/paper';
import { navigate, type Route } from '../lib/route';

type Props = { route: Extract<Route, { name: 'letter' }>; shape: (t: string) => ShapedGlyph[] };

const PACES = [
  { v: 1, name: 'آرام' },
  { v: 3, name: 'تند' },
  { v: 10, name: 'خیلی تند' },
];

function useSheetWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(680);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.min(720, Math.max(300, Math.floor(el.clientWidth)))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function Desk({ route, shape }: Props) {
  const letter = byId(route.id) ?? LETTERS[0];
  const seed = route.params.w || 'baran-roshan-17';
  const paper = (route.params.paper as PaperId) || 'ivory';
  const overrides: HandOverrides = useMemo(() => ({
    pen: (route.params.pen as PenKind) || undefined,
    ink: route.params.ink || undefined,
    neatness: route.params.neat ? +route.params.neat : undefined,
    hurry: route.params.hurry ? +route.params.hurry : undefined,
  }), [route.params.pen, route.params.ink, route.params.neat, route.params.hurry]);
  const [pace, setPace] = useState(3);
  const [progress, setProgress] = useState(0);
  const [replying, setReplying] = useState(false);
  const [copied, setCopied] = useState(false);
  const sheet = useRef<SheetHandle>(null);
  const [wrapRef, width] = useSheetWidth();
  const replyRef = useRef<HTMLDivElement>(null);

  const hand = useMemo(() => {
    const h = makeHand(seed, overrides);
    return { ...h, size: h.size * Math.min(1, Math.max(0.62, width / 700)) };
  }, [seed, overrides, width]);

  const { text, cut } = useMemo(() => excerpt(letter.text), [letter]);
  const page = useMemo(() => compose(normalisePersian(text), hand, shape, { width, margin: MARGIN }), [text, hand, shape, width]);

  const set = useCallback((p: Record<string, string | undefined>, replace = false) => {
    const { id, ...rest } = p;
    navigate({ name: 'letter', id: id ?? letter.id, params: { ...route.params, ...rest } as Record<string, string> }, replace);
  }, [letter.id, route.params]);

  const another = useCallback(() => {
    const next = pickNext(letter.id, Math.floor(Math.random() * 1e6));
    setReplying(false);
    set({ id: next.id, w: newSeed(), pen: undefined, ink: undefined });
  }, [letter.id, set]);
  const otherWriter = useCallback(() => set({ w: newSeed(), pen: undefined, ink: undefined }), [set]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'Space' && (tag === 'BUTTON' || tag === 'A')) return; // let Space press the focused button
      if (e.code === 'KeyR') { e.preventDefault(); another(); }
      else if (e.code === 'KeyW') { e.preventDefault(); otherWriter(); }
      else if (e.code === 'Space') { e.preventDefault(); sheet.current?.finish(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [another, otherWriter]);

  useEffect(() => { if (replying) replyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [replying]);

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(location.href); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* clipboard blocked */ }
  };

  const label = `نامهٔ ${letter.author}${letter.recipient ? ' به ' + letter.recipient : ''}، به خط دست. متن: ${text}`;

  return (
    <main className="desk">
      <section ref={wrapRef} aria-label="میز تحریر">
        <div className="sheet-wrap">
          <Sheet ref={sheet} page={page} hand={hand} paper={paper} pace={pace} label={label}
            onProgress={(d, t) => setProgress(t ? d / t : 0)} />
        </div>
        <div className="progress" aria-hidden><div style={{ width: `${progress * 100}%` }} /></div>
        {replying && (
          <div ref={replyRef} style={{ marginTop: 28 }}>
            <h2 style={{ fontSize: 16, margin: '0 0 10px' }}>پاسخ شما</h2>
            <ReplySheet hand={hand} paper={paper} width={width} shape={shape} replyTo={letter.author} />
          </div>
        )}
      </section>

      <aside>
        <div className="panel">
          <div className="btns">
            <button className="btn primary" onClick={another}>نامهٔ دیگر <kbd>R</kbd></button>
            <button className="btn" onClick={otherWriter}>نویسندهٔ دیگر <kbd>W</kbd></button>
            {progress < 1
              ? <button className="btn" onClick={() => sheet.current?.finish()}>یکجا بنویس <kbd>Space</kbd></button>
              : <button className="btn" onClick={() => sheet.current?.replay()}>دوباره بنویس</button>}
          </div>
        </div>

        <div className="panel record">
          <h2>{letter.title}</h2>
          <dl>
            <dt>نویسنده</dt><dd>{letter.author}</dd>
            <dt>گیرنده</dt><dd>{letter.recipient ?? 'در منبع نیامده'}</dd>
            {letter.onBehalfOf && <><dt>یادداشت</dt><dd>{letter.onBehalfOf}</dd></>}
            {letter.summary && <><dt>دربارهٔ نامه</dt><dd>{letter.summary}</dd></>}
            {letter.people && letter.people.length > 0 && <><dt>افراد</dt><dd>{letter.people.join('، ')}</dd></>}
            <dt>زمان</dt><dd>{letter.period}</dd>
            <dt>منبع</dt><dd><a href={letter.source.url} target="_blank" rel="noreferrer">{letter.source.name}</a>{letter.source.edition && <> (به نقل از {letter.source.edition})</>}</dd>
          </dl>
          <p className="note">
            {cut ? <>این آغاز نامه است؛ <a href={`#/read/${letter.id}`}>متن کامل</a> را بخوانید. </> : <><a href={`#/read/${letter.id}`}>متن تایپی</a>. </>}
            {rightsNote(letter)} خطی که می‌بینید از نویسندهٔ نامه نیست: دست نویسنده‌ای است که هرگز نبوده.
          </p>
        </div>

        <div className="panel">
          <h3 style={{ marginTop: 0 }}>نویسنده: {seedName(seed)}</h3>
          <h3>قلم</h3>
          <div className="seg" role="group" aria-label="قلم">
            {PENS.map((p) => <button key={p.id} aria-pressed={hand.pen === p.id} onClick={() => set({ pen: p.id, ink: undefined })}>{p.name}</button>)}
          </div>
          <h3>مرکب</h3>
          <div className="seg" role="group" aria-label="مرکب">
            {INKS.map((i) => (
              <button key={i.id} aria-pressed={hand.ink.id === i.id} onClick={() => set({ ink: i.id })}>
                <span aria-hidden style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: i.color, marginInlineEnd: 6 }} />{i.name}
              </button>
            ))}
          </div>
          <h3>کاغذ</h3>
          <div className="seg" role="group" aria-label="کاغذ">
            {PAPERS.map((p) => <button key={p.id} aria-pressed={paper === p.id} onClick={() => set({ paper: p.id })}>{p.name}</button>)}
          </div>
          <h3>دست</h3>
          <label className="slider">نظم
            <input type="range" min={0} max={1} step={0.05} value={hand.neatness} onChange={(e) => set({ neat: e.target.value }, true)} />
          </label>
          <label className="slider">شتاب
            <input type="range" min={0} max={1} step={0.05} value={hand.hurry} onChange={(e) => set({ hurry: e.target.value }, true)} />
          </label>
          <h3>سرعت نوشتن</h3>
          <div className="seg" role="group" aria-label="سرعت نوشتن">
            {PACES.map((p) => <button key={p.v} aria-pressed={pace === p.v} onClick={() => setPace(p.v)}>{p.name}</button>)}
          </div>
        </div>

        <div className="panel">
          <div className="btns">
            <button className="btn" onClick={() => setReplying(true)}>پاسخ بنویسید</button>
            <button className="btn" onClick={() => exportPNG(page.strokes, hand, page.width, page.height, paper, `${letter.author} — ${letter.source.name}`)}>دانلود تصویر</button>
            <button className="btn" onClick={copyLink}>{copied ? 'پیوند رونوشت شد' : 'رونوشت پیوند'}</button>
          </div>
          <p className="hint" style={{ margin: '10px 0 0' }}>پیوند، همین نامه را با همین دست دوباره می‌نویسد. {faNum(LETTERS.length)} نامه در مجموعه.</p>
        </div>
      </aside>
    </main>
  );
}
