import { useMemo, useState } from 'react';
import { COLLECTIONS, LETTERS, faNum } from '../lib/letters';

const strip = (s: string) => s.replace(/[ً-ٰٟ‌]/g, '').replace(/ي/g, 'ی').replace(/ك/g, 'ک');

export function Library() {
  const [q, setQ] = useState('');
  const [from, setFrom] = useState<string | null>(null);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of LETTERS) c[l.source.collection] = (c[l.source.collection] ?? 0) + 1;
    return c;
  }, []);
  const list = useMemo(() => {
    const k = strip(q.trim());
    const pool = from ? LETTERS.filter((l) => l.source.collection === from) : LETTERS;
    if (!k) return pool;
    return pool.filter((l) => strip(`${l.title} ${l.author} ${l.recipient ?? ''} ${l.summary ?? ''} ${l.text}`).includes(k));
  }, [q, from]);
  return (
    <main className="library">
      <h1 style={{ fontSize: 22, margin: '0 0 6px' }}>همهٔ نامه‌ها</h1>
      <p className="hint" style={{ marginTop: 0 }}>
        {faNum(counts.ganjoor ?? 0)} نامهٔ فارسی از منشآت قائم‌مقام فراهانی (درگذشتهٔ ۱۸۳۵ م)، از گنجور
        {counts.wwqi ? <>، و {faNum(counts.wwqi)} نامه از آرشیو «دنیای زنان در عصر قاجار» (هاروارد) که تنها روی همین رایانه دیده می‌شوند</> : null}.
        {' '}هر نامه به خط دستی تازه نوشته می‌شود.
      </p>
      {Object.keys(counts).length > 1 && (
        <div className="seg" role="group" aria-label="مجموعه" style={{ marginBottom: 10 }}>
          <button aria-pressed={from === null} onClick={() => setFrom(null)}>همه</button>
          {Object.keys(counts).map((c) => <button key={c} aria-pressed={from === c} onClick={() => setFrom(c)}>{COLLECTIONS[c] ?? c}</button>)}
        </div>
      )}
      <input type="search" placeholder="جستجو در عنوان، گیرنده یا متن…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="جستجوی نامه‌ها" />
      <p className="hint">{faNum(list.length)} نامه</p>
      <ul className="lib-list">
        {list.map((l) => (
          <li key={l.id}>
            <a href={`#/letter/${l.id}`}>
              <div>{l.number != null && <strong>{faNum(l.number)}. </strong>}{l.title}</div>
              <div className="meta">{l.source.collection === 'wwqi' ? <>{l.author} · {l.period}</> : <>گیرنده: {l.recipient ?? 'نامعلوم'}</>} · {faNum(l.chars)} نویسه{l.chars > 720 ? ' · گزیده نوشته می‌شود' : ''}</div>
              <div className="ex">{l.text.slice(0, 220)}</div>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
