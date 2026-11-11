// Build content/local/wwqi-letters.json from Women's Worlds in Qajar Iran (WWQI, Harvard, qajarwomen.org):
// the letters (genre: correspondence) that have a typed Persian transcription.
//
//   node tools/fetch-wwqi.mjs            # fetch (resumable), cache raw HTML in content/raw/wwqi/, write the JSON
//   node tools/fetch-wwqi.mjs --offline  # rebuild from the cache only
//
// LOCAL ONLY. WWQI's terms allow teaching and individual research; "mounting on other systems, or other forms of
// redistribution, requires permission of Harvard University" (qajarwomen.org/en/permissions.html). So both the cache
// and the output are gitignored, and the public build never contains them. The app picks the file up when it is
// present (app/src/lib/letters.ts), so `npm run dev` shows these letters on this machine only.
//
// The archive is old and slow (HTTP only, occasional 503s and hangs), so every request has a timeout, retries and a
// pause, and everything fetched is cached: re-running picks up where it stopped.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('../content/', import.meta.url);
const RAW = new URL('raw/wwqi/', ROOT);
const OUT = new URL('local/wwqi-letters.json', ROOT);
mkdirSync(new URL('items/', RAW), { recursive: true });
mkdirSync(new URL('local/', ROOT), { recursive: true });
const offline = process.argv.includes('--offline');
const UA = { 'User-Agent': 'dastkhat/0.1 (digital humanities research; local build)' };
const SEARCH = 'http://search.qajarwomen.org/search?lang=en&filter=genres_en:correspondence%7Ctranscription:has-transcription';
const ITEM = (id) => `http://www.qajarwomen.org/fa/items/${id}.html`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cached(name, url, valid) {
  const f = new URL(name, RAW);
  if (existsSync(f)) return readFileSync(f, 'utf8');
  if (offline) return null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
      const t = await res.text();
      if (res.ok && valid(t)) {
        writeFileSync(f, t);
        await sleep(700); // one request at a time, with a pause: a small academic server
        return t;
      }
    } catch { /* timeout or reset: retry */ }
    await sleep(3000 * (attempt + 1));
  }
  console.warn('gave up on', url);
  return null;
}

// 1. The list of item record numbers, ten per search page.
const ids = [];
for (let page = 0; page < 200; page++) {
  const t = await cached(`search-${page}.html`, `${SEARCH}&page=${page}`, (t) => t.includes('Total results found'));
  if (t == null) { console.warn(`search page ${page} unavailable; carrying on with the ${ids.length} items listed so far (re-run later to list the rest)`); break; }
  const found = [...new Set([...t.matchAll(/\/en\/items\/([0-9A-Za-z]+)\.html/g)].map((m) => m[1]))];
  const fresh = found.filter((id) => !ids.includes(id));
  ids.push(...fresh);
  if (!fresh.length || !/class="next">\s*<a /.test(t)) break;
}
console.log('items listed:', ids.length);

// 2. Each item's Persian page: the typed text and the record.
const clean = (s) => s.replace(/<br\s*\/?>/g, '\n').replace(/<\/p>\s*<p>/g, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();
const field = (t, label) => {
  const m = t.match(new RegExp(`<span>${label}</span>([\\s\\S]*?)</li>`));
  return m ? clean(m[1]) || null : null;
};

// What the hand writes. The transcribers add square brackets: corrections after a misspelt word («خاسته [خواسته]»),
// letters they supply («نگا[ه]»), and notes on where a passage sits («[پشت صفحه:]», on the back). The hand writes what
// the writer wrote, so corrections and supplied letters are left out, and a placement note starts a new line.
// The library page shows the transcription exactly as typed, brackets and all.
const handText = (s) => s
  .replace(/\s*\[[^\]\n]*:\s*\]\s*/g, '\n')
  .replace(/\s*\[[^\]\n]*\]/g, '')
  .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();

const letters = [];
const skipped = { empty: 0, notPersian: 0, missing: 0 };
for (const id of ids) {
  const t = await cached(`items/${id}.html`, ITEM(id), (t) => t.includes('شماره سند'));
  if (t == null) { skipped.missing++; continue; }
  const body = t.match(/id="transcription-of-farsi"[\s\S]*?<div class="modal-body">([\s\S]*?)<\/div>/);
  const transcript = body ? clean(body[1]) : '';
  const text = handText(transcript);
  if (text.length < 40) { skipped.empty++; continue; }
  // A few «Persian transcriptions» are letters in English or French (e.g. the 14133 collection); the hand is Persian.
  const persian = (text.match(/[\u0600-\u06FF]/g) ?? []).length, latin = (text.match(/[A-Za-z\u00C0-\u024F]/g) ?? []).length;
  if (persian < 2 * latin) { skipped.notPersian++; continue; }
  // WWQI's «محدودیت» field: mostly «بدون محدودیت», otherwise the holder's conditions (cite the holding library,
  // ask before commercial use). None forbids research use, so every letter is kept and the condition travels with it.
  const restriction = field(t, 'محدودیت')?.replace(/\.$/, '') ?? null;
  const holderTerms = restriction && restriction !== 'بدون محدودیت' ? restriction : null;
  const h2 = t.match(/<div class="six columns">\s*<h2>([\s\S]*?)<\/h2>/);
  const desc = t.match(/<div class="description">([\s\S]*?)<\/div>/);
  const people = [...(t.match(/<span class="title people">[\s\S]*?<\/li>/)?.[0] ?? '').matchAll(/class="tag">([\s\S]*?)<\/a>/g)].map((m) => clean(m[1]));
  const author = field(t, 'آفریننده');
  const holder = field(t, 'متعلق به');
  letters.push({
    id: `wwqi-${id}`,
    text,
    transcript,
    kind: 'letter',
    lang: 'fa',
    title: h2 ? clean(h2[1]) : 'نامه',
    summary: desc ? clean(desc[1]) || null : null,
    author: author ?? 'نامعلوم',
    recipient: null, // WWQI names the people in a letter but not which of them it was sent to
    people,
    onBehalfOf: null,
    year: null,
    period: field(t, 'تاریخ') ?? 'دورهٔ قاجار',
    number: null,
    chars: text.length,
    paragraphs: text.split('\n').length,
    source: {
      name: `دنیای زنان در عصر قاجار، سند ${id}${holder ? '، ' + holder : ''}`,
      url: ITEM(id),
      edition: 'متن تایپی آرشیو',
      collection: 'wwqi',
      holder,
      record: id,
    },
    rights: {
      basis: 'Transcription by Women\'s Worlds in Qajar Iran (Harvard University), used locally for research. WWQI permits teaching and individual research; redistribution needs Harvard\'s permission, so this record is not published.',
      transcription: 'wwqi',
      holderTerms,
    },
    tags: [],
    enabled: true,
  });
}
writeFileSync(OUT, JSON.stringify(letters, null, 1) + '\n');
console.log(`wrote ${letters.length} letters to content/local/wwqi-letters.json`, skipped);
