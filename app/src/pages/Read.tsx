import { byId } from '../lib/letters';

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
      <div className="fulltext">{l.text}</div>
      <h2>منبع و حقوق</h2>
      <p><a href={l.source.url} target="_blank" rel="noreferrer">{l.source.name}</a>{l.source.edition && <>، به نقل از {l.source.edition}</>}.</p>
      <p>نویسنده در ۱۲۵۱ ق / ۱۸۳۵ م درگذشته است و متن نامه‌ها در مالکیت عمومی است. متن تایپی را داوطلبان گنجور فراهم کرده‌اند؛ یادداشت‌ها و بازنویسی‌های ماشینی گنجور به کار نرفته است.</p>
      <h2>ارجاع</h2>
      <p className="hint">{cite}</p>
    </main>
  );
}
