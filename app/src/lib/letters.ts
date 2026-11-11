import raw from '../../../content/letters.json';

// Letters kept on this machine only (content/local/ is gitignored): the WWQI letters from tools/fetch-wwqi.mjs,
// which may not be redistributed without Harvard's permission. The glob is empty in a clean checkout and in CI,
// so the public build has the Ganjoor letters alone.
const local = import.meta.glob<Letter[]>('../../../content/local/*.json', { eager: true, import: 'default' });

export type Letter = {
  id: string;
  text: string;
  kind: string;
  lang: string;
  title: string;
  author: string;
  authorLatin?: string;
  recipient: string | null;
  onBehalfOf: string | null;
  year: number | null;
  period: string;
  number: number | null;
  chars: number;
  /** As the transcriber typed it, editorial brackets and all, when that differs from what the hand writes. */
  transcript?: string;
  /** The archive's own description of the letter. */
  summary?: string | null;
  people?: string[];
  source: { name: string; url: string; edition: string | null; collection: string; holder?: string | null; record?: string };
  rights: { basis: string; holderTerms?: string | null };
  enabled: boolean;
};

export const LETTERS: Letter[] = [...(raw as Letter[]), ...Object.values(local).flat()].filter((l) => l.enabled);

/** Where the words and the typed text come from, and on what terms (shown with every letter). */
export function rightsNote(l: Letter): string {
  if (l.source.collection === 'wwqi')
    return 'متن تایپی از آرشیو «دنیای زنان در عصر قاجار» (دانشگاه هاروارد) است و تنها برای پژوهش روی همین رایانه نمایش داده می‌شود؛ انتشار آن اجازهٔ هاروارد را می‌خواهد.'
      + (l.rights.holderTerms ? ` شرط صاحب سند: ${l.rights.holderTerms}` : '');
  return 'نویسنده در ۱۲۵۱ ق / ۱۸۳۵ م درگذشته و متن در مالکیت عمومی است. متن تایپی را داوطلبان گنجور فراهم کرده‌اند؛ یادداشت‌ها و بازنویسی‌های ماشینی گنجور به کار نرفته است.';
}

export const COLLECTIONS: Record<string, string> = { ganjoor: 'منشآت قائم‌مقام (گنجور)', wwqi: 'دنیای زنان در عصر قاجار' };

export const byId = (id: string) => LETTERS.find((l) => l.id === id);

/** The desk writes the opening of long letters, ending at a sentence, and says so. */
export function excerpt(text: string, max = 620): { text: string; cut: boolean } {
  if (text.length <= max * 1.15) return { text, cut: false };
  const paras = text.split('\n');
  let out = '';
  for (const p of paras) {
    if ((out + p).length > max) break;
    out += (out ? '\n' : '') + p;
  }
  if (out.length < max * 0.45) {
    const rest = text.slice(out.length ? out.length + 1 : 0);
    const chunk = rest.slice(0, max - out.length);
    const ends = [...chunk.matchAll(/[.!؟?؛](?=\s|$)/g)].map((m) => m.index! + 1);
    const commas = [...chunk.matchAll(/[،,](?=\s)/g)].map((m) => m.index! + 1);
    const at = ends.length && ends[ends.length - 1] > chunk.length * 0.4 ? ends[ends.length - 1] : commas.length ? commas[commas.length - 1] : chunk.lastIndexOf(' ');
    out += (out ? '\n' : '') + chunk.slice(0, at).trim();
  }
  return { text: out.trim() + ' …', cut: true };
}

/** Letters short enough to be written out whole come first when picking at random. */
export function pickNext(currentId: string | null, seed: number): Letter {
  const pool = LETTERS.filter((l) => l.id !== currentId);
  const short = pool.filter((l) => l.chars < 1600);
  const from = seed % 3 === 0 ? pool : short.length ? short : pool;
  return from[Math.floor((seed * 9301 + 49297) % 233280 / 233280 * from.length)];
}

export const faNum = (n: number | string) => String(n).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);
