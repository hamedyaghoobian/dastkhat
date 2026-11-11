import { byId, rightsNote } from '../lib/letters';

export function Read({ id }: { id: string }) {
  const l = byId(id);
  if (!l) return <main className="prose"><p>این نامه پیدا نشد. <a href="#/letters">همهٔ نامه‌ها</a></p></main>;
  const cite = `${l.author}، «${l.title}»، ${l.source.name}. ${l.source.url}`;
  return (
    <main className="prose">
      <p><a href="#/letters">← همهٔ نامه‌ها</a></p>
      <h1>{l.title}</h1>
      <p className="hint">{l.author} · گیرنده: {l.recipient ?? 'در منبع نیامده'} · {l.period}</p>
      <p><a className="btn primary" href={`#/letter/${l.id}`} style={{ textDecoration: 'none' }}>به خط دست بنویس</a></p>
      {l.summary && <p>{l.summary}</p>}
      {l.people && l.people.length > 0 && <p className="hint">افراد: {l.people.join('، ')}</p>}
      <div className="fulltext">{l.transcript ?? l.text}</div>
      {l.transcript && l.transcript !== l.text && <p className="hint">متن بالا همان است که آرشیو تایپ کرده، با افزوده‌های ویراستار در [ ]. دست، آنچه را نویسنده نوشته می‌نویسد: بی‌افزوده‌ها و بی‌تصحیح‌ها.</p>}
      <h2>منبع و حقوق</h2>
      <p><a href={l.source.url} target="_blank" rel="noreferrer">{l.source.name}</a>{l.source.edition && <>، به نقل از {l.source.edition}</>}.</p>
      <p>{rightsNote(l)}</p>
      <h2>ارجاع</h2>
      <p className="hint">{cite}</p>
    </main>
  );
}
