import { useMemo, useState } from 'react';
import { LETTERS, faNum } from '../lib/letters';

const strip = (s: string) => s.replace(/[ً-ٰٟ‌]/g, '').replace(/ي/g, 'ی').replace(/ك/g, 'ک');

export function Library() {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const k = strip(q.trim());
    if (!k) return LETTERS;
    return LETTERS.filter((l) => strip(`${l.title} ${l.recipient ?? ''} ${l.text}`).includes(k));
  }, [q]);
  return (
    <main className="library">
      <h1 style={{ fontSize: 22, margin: '0 0 6px' }}>همهٔ نامه‌ها</h1>
      <p className="hint" style={{ marginTop: 0 }}>
        {faNum(LETTERS.length)} نامهٔ فارسی از منشآت قائم‌مقام فراهانی (درگذشتهٔ ۱۸۳۵ م)، از گنجور. هر نامه به خط دستی تازه نوشته می‌شود.
      </p>
      <input type="search" placeholder="جستجو در عنوان، گیرنده یا متن…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="جستجوی نامه‌ها" />
      <p className="hint">{faNum(list.length)} نامه</p>
      <ul className="lib-list">
        {list.map((l) => (
          <li key={l.id}>
            <a href={`#/letter/${l.id}`}>
              <div><strong>{faNum(l.number ?? '')}.</strong> {l.title}</div>
              <div className="meta">گیرنده: {l.recipient ?? 'نامعلوم'} · {faNum(l.chars)} نویسه{l.chars > 720 ? ' · گزیده نوشته می‌شود' : ''}</div>
              <div className="ex">{l.text.slice(0, 220)}</div>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
