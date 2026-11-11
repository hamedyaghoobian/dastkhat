import raw from '../../../content/letters.json';

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
  source: { name: string; url: string; edition: string | null; collection: string };
  rights: { basis: string };
  enabled: boolean;
};

export const LETTERS: Letter[] = (raw as Letter[]).filter((l) => l.enabled);

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
