// Build content/letters.json from Ganjoor: Qa'em-Maqam Farahani's Persian letters
// (منشآت › نامه‌های فارسی, ganjoor.net/ghaemmagham/monshaat/nameha).
//
//   node tools/fetch-ganjoor.mjs            # fetch, cache raw JSON in content/raw/ganjoor/, write content/letters.json
//   node tools/fetch-ganjoor.mjs --offline  # rebuild from the cache only
//
// Only the text is taken. Ganjoor also stores AI-written paraphrases (coupletSummary); they are not the letter, so
// they are never used. Nothing is invented: where a title does not name the recipient, the record says it is unknown.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('../content/', import.meta.url);
const RAW = new URL('raw/ganjoor/', ROOT);
mkdirSync(RAW, { recursive: true });
const offline = process.argv.includes('--offline');
const API = 'https://api.ganjoor.net/api/ganjoor';
const UA = { 'User-Agent': 'dastkhat/0.1 (digital humanities research; static site build)' };

async function cached(name, url) {
  const f = new URL(name, RAW);
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  if (offline) throw new Error('not cached: ' + name);
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: UA });
    if (res.ok) {
      const j = await res.json();
      writeFileSync(f, JSON.stringify(j));
      await new Promise((r) => setTimeout(r, 400)); // be gentle with a volunteer-run site
      return j;
    }
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw new Error('fetch failed: ' + url);
}

const fa = (n) => String(n).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
// Letter text: only Arabic yeh/kaf to their Persian forms and whitespace tidied. Nothing else is
// changed, so ta marbuta (ة), which this transcription uses in many places, stays as typed.
const norm = (s) =>
  s
    .replace(/ي/g, 'ی').replace(/ك/g, 'ک')
    .replace(/\s+/g, ' ')
    .trim();
// Headings are Ganjoor's editorial wording, not the letter. There «نامة» stands for «نامه», so a
// word-final ة becomes plain ه (never هٔ, which would add an ezafe the heading may not mean).
const normTitle = (s) => norm(s).replace(/ة(?=[\s،:]|$)/g, 'ه');

// "شمارهٔ  ۱۲ - خطاب به فاضل خان گروسی" → number 12, heading "خطاب به فاضل خان گروسی"
function parseTitle(t) {
  const m = t.match(/^شمارهٔ\s+([۰-۹]+)\s*-\s*(.*)$/);
  const num = m ? +m[1].replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)) : null;
  const heading = normTitle(m ? m[2] : t);
  return { num, heading };
}

// Who it was to, only when the heading says so plainly.
function recipientOf(h) {
  if (/معلوم نیست|نا ?معلوم|به (?:کی|که) /.test(h)) return null;
  const m = h.match(/(?:^|\s)به (.+)$/);
  if (!m) return null;
  let r = m[1];
  if (/^یکی از /.test(r)) return r.replace(/\s+(?:نوشته|نبشته).*$/, '').trim();
  const cut = r.search(/\s(?:نوشته|نبشته|از|که|در|بعد|قبل|مصحوب|با|است)(?:[\s:،]|$)/);
  if (cut > 0) r = r.slice(0, cut);
  r = r.replace(/^دوستی (.+) نام$/, '$1').replace(/^خاکپای /, '').replace(/^پسر خویش$/, 'پسرش');
  r = r.replace(/[،:.]$/, '').trim();
  return r || null;
}

// Read by hand against every heading (all 96 parsed): where the parse picked up a place, a pen or
// part of another name, the record says unknown rather than guess.
const RECIPIENT_FIX = {
  26: null,                          // «… که به قلم جلی نوشته»: drafts in a large hand, not an addressee
  59: null,                          // a salary decree (رقم) for Aqa Abd al-Razzaq Beg Donboli, not a letter to anyone
  72: 'یک دوست',                     // «به دوستی نوشته است»: to a friend
  76: null,                          // a summary of Fereydun Mirza's points sent to Khorasan
  82: 'یکی از منسوبانش در فراهان',
  84: null,                          // «از سرخس به مشهد»: a place
};

const onBehalf =(h) => (/از (?:قول|جانب) |^نامهٔ? (?:ولیعهد|خاقان|شاهنشاهی|سرکار|نواب)|^رقیمه پادشاه|^کاغذ نواب|^رونوشت|^رقم /.test(h) ? true : false);

const page = await cached('cat-2368.json', `${API}/page?url=/ghaemmagham/monshaat/nameha&catPoems=true`);
const cat = page.poetOrCat.cat;
const letters = [];
for (const p of cat.poems) {
  const poem = await cached(`poem-${p.id}.json`,
    `${API}/poem/${p.id}?verseDetails=true&catInfo=false&rhymes=false&recitations=false&images=false&songs=false&comments=false&navigation=false&relatedpoems=false`);
  const { num, heading } = parseTitle(poem.title);
  // paragraphs (versePosition −1) as they are; a couplet's two halves each on their own line
  const lines = [];
  for (const v of poem.verses.sort((a, b) => a.vOrder - b.vOrder)) {
    const t = norm(v.text);
    if (!t) continue;
    if (v.versePosition === -1 || v.versePosition === undefined) lines.push(t);
    else lines.push(t); // hemistich: own line, as it would be set out in a letter
  }
  const text = lines.join('\n');
  const recipient = num in RECIPIENT_FIX ? RECIPIENT_FIX[num] : recipientOf(heading);
  letters.push({
    id: `ghaem-maqam-${num ?? p.id}`,
    text,
    kind: 'letter',
    lang: 'fa',
    title: heading,
    author: 'میرزا ابوالقاسم قائم‌مقام فراهانی',
    authorLatin: "Mirza Abu'l-Qasim Qa'em-Maqam Farahani (1779–1835)",
    recipient,
    onBehalfOf: onBehalf(heading) ? 'نوشته از زبان دیگری (ولیعهد یا شاه)، به قلم قائم‌مقام' : null,
    year: null,
    period: 'دورهٔ قاجار، پیش از ۱۲۵۱ ق / ۱۸۳۵ م',
    yearLatest: 1835,
    number: num,
    chars: text.length,
    paragraphs: lines.length,
    source: {
      name: `منشآت قائم‌مقام فراهانی، نامه‌های فارسی، شمارهٔ ${fa(num ?? '')}، در گنجور`,
      url: `https://ganjoor.net${poem.fullUrl}`,
      edition: poem.sourceName || null,
      collection: 'ganjoor',
    },
    rights: {
      basis: "The author died in 1835, so his words are in the public domain. The typed text is Ganjoor's, which takes it from Wikidorj (Persian Wikisource); the printed edition behind that transcription is not named and has not been checked, and the headings are an editor's wording, not the author's. Ganjoor's notes and AI paraphrases are not used. Confirm the transcription's reuse terms before a public launch.",
      author: 'public-domain',
      transcription: 'ganjoor',
    },
    tags: [],
    enabled: true,
  });
}
letters.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
writeFileSync(new URL('letters.json', ROOT), JSON.stringify(letters, null, 1));
const withR = letters.filter((l) => l.recipient).length;
console.log(`${letters.length} letters, ${withR} with a named recipient, ${letters.filter((l) => l.chars < 1500).length} under 1500 characters`);
