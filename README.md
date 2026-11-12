# Dastkhat (دست‌خط): Persian letters, written by hand

Real Persian letters, in their writers' own words, written out live, stroke by stroke and right to left, in the hand
of a writer who never existed. A Persian counterpart to [If This Finds You](https://github.com/rafaelcespedes/if-this-finds-you)
The Persian engine (shaping, skeletons, layout) is its own; the ink model is ported from If This Finds You (MIT, see Credits).

## Run it

```bash
cd app && npm install && npm run dev
```

`npm run build` makes a static site in `app/dist/` (hash routes, so any static host works). Every push to `main`
deploys it to GitHub Pages (`.github/workflows/pages.yml`, which also runs the coverage check), at
https://hamedyaghoobian.com/dastkhat/.

## What it does

- **The desk** (`#/letter/<id>?w=<writer>`): a letter written out live, with its record beside it (writer, recipient,
  period, source, rights). *نامهٔ دیگر* (R) brings another letter in a new hand, *نویسندهٔ دیگر* (W) keeps the letter
  and changes the hand, Space finishes the page. Pen (reed, fountain, ballpoint, pencil), ink, paper, neatness and hurry
  can be changed, and the link replays the same letter in the same hand. Long letters are written as an excerpt
  that ends at a sentence, with a link to the full text.
- **Replies**: type on a fresh sheet. Each word is written once you finish it (Persian letterforms change until the
  word is done). Ink never comes off: Backspace on a written word strikes it through, again harder, then scribbles it out.
- **The library** (`#/letters`): all 123 letters, searchable by title, recipient or text, each with a full-text page and a
  citation.
- **Export**: a PNG of the page with its source line.

## How the hand works

| Step | Where |
|---|---|
| Shaping: joining forms, lām-alef, mark positions (HarfBuzz, WASM) | `app/src/engine/shaper.ts` |
| Two scripts (`app/src/engine/script.ts`). **Nasta'liq** (the default), the hand real Persian letters were written in, from Noto Nastaliq Urdu; **naskh**, upright and rounder, from Vazirmatn Thin. Each is loaded only when a hand uses it | `app/src/engine/script.ts`, `shaper.ts` |
| Single-line skeletons for the glyphs: rasterise → Zhang–Suen thinning → spur pruning → tracing; dots kept apart. For nasta'liq, the solid heads of و ف ق م ه get a counter punched first so they trace as small loops, and a compact blob inside a letter is never a dot (the font keeps nuqtas as glyphs of their own) | `tools/skeletonize.mjs` → `app/src/engine/data/skeletons*.json` |
| A seed becomes a writer, with correlated traits (hurry → untidier, more dashes for dots). A nasta'liq writer also gets a *loose* hand: words that drop toward their left end, a lean, lines that climb to the left, letters squeezed sideways, teeth and bumps rounded off, some nuqtas left out, and a writing size from small and dense to large. Quicker writers also take up shekasteh habits, decided word by word: sīn and shīn written as one flat line without teeth, and the pen carried on after ا د ذ ر ز ژ و into the next letter through a hairline that swings up into it from below (dots then wait until the word is done). These are what separate a quick letter from a copybook | `app/src/engine/hand.ts` |
| Layout and stroke order: each connected piece of a word in one movement from the right, then dots, gāf bars and hamzas; two dots as a dash, three as a caret when hurried; one smooth bend per word so joins stay joined; words climbing to the left; last word squeezed into the margin | `app/src/engine/compose.ts` |
| Pen timing: speed follows curvature (the two-thirds power law), slow at turns and at both ends | `app/src/engine/kinematics.ts` |
| Ink as a density field (WebGL2): width and ink along each stroke follow the pen's speed, a stop pools, a flick thins; one pen-down is laid once and crossings darken; wet ink dries darker at the rim, edges are a little rough, and Beer–Lambert colour lets the paper's grain show through thin ink. The reed is a broad nib and a dip pen (it runs dry between dips); the fountain pen is round; a ballpoint streaks and skips; graphite catches the paper's tooth. Without WebGL2 a flat renderer is used | `app/src/engine/ink.ts` (`render.ts` is the fallback) |
| Crossing out | `app/src/engine/marks.ts` |

Determinism: the same seed, settings and text always give the same page (all randomness goes through `rng()`).

Rebuild the skeletons after changing a font or the tracer: `node tools/skeletonize.mjs app/public/fonts/Vazirmatn-Thin.ttf app/src/engine/data/skeletons.json` for naskh, and `ALL=1 UPP=3 PUNCH=1 NOBODYDOTS=1 node tools/skeletonize.mjs app/public/fonts/NotoNastaliqUrdu.ttf app/src/engine/data/skeletons-nastaliq.json` for nasta'liq.
`node tools/preview-skeleton.mjs "متن" out.svg` draws the skeletons over the font outline for checking, and
`node tools/check-coverage.mjs` shapes every word of every letter in both scripts and fails if any glyph is missing or has no strokes.

## The letters

`content/letters.json` is built by `node tools/fetch-ganjoor.mjs` (add `--offline` to rebuild from `content/raw/ganjoor/`).
It holds the 123 Persian letters in **Qa'em-Maqam Farahani's *Monsha'at*** (d. 1835) from
[Ganjoor](https://ganjoor.net/ghaemmagham/monshaat/nameha), whose text comes from Wikidorj (Persian Wikisource). Only the
letter text is used. Ganjoor's AI paraphrases and notes are not. A recipient is named only when Ganjoor's heading names one
(92 of 123; every parse was read by hand, with corrections in `RECIPIENT_FIX`). The letter text is kept as typed (only Arabic
yeh/kaf become Persian ones), so ta marbuta and the source's spellings stay. Letters written in someone else's name (the crown prince, the shah) are flagged. Dates are left empty because
the source gives none.

**Rights.** The author died in 1835, so his words are in the public domain. The typed transcription is Ganjoor's, taken
from Wikidorj. The printed edition behind it is not named and hasn't been checked, and the headings are an editor's
wording. Check the transcription's reuse terms before any public launch. `content/raw/` (the API cache, which includes
Ganjoor's AI paraphrases) is gitignored.

### Women's Worlds in Qajar Iran (local only)

`node tools/fetch-wwqi.mjs` imports the letters in [Women's Worlds in Qajar Iran](http://www.qajarwomen.org) (WWQI,
Harvard) that have a typed Persian transcription: 872 items listed. Two have no usable text and 36 are in English or French, which leaves 834 Persian letters. Each item's
«محدودیت» field is kept with the letter and shown beside it. Most say «بدون محدودیت»; the others are holders' conditions,
such as naming the holding library when publishing (the Majlis Library for 288 of them) or asking before commercial use. The importer is resumable: the archive's
search server is slow and sometimes down, so every request has a timeout, retries and a pause, and every page fetched
is cached in `content/raw/wwqi/`. Re-run the importer to pick up where it stopped.

**These letters are on your machine only.** WWQI allows teaching and individual research. Its
[permissions page](http://www.qajarwomen.org/en/permissions.html) says that "mounting on other systems, or other forms
of redistribution, requires permission of Harvard University". So the cache and the output
(`content/local/wwqi-letters.json`) are gitignored. The app loads `content/local/*.json` when the files are there
(`import.meta.glob`), so `npm run dev` shows the WWQI letters next to Ganjoor's, with a collection filter in the
library. A clean checkout, CI and the GitHub Pages site have Ganjoor's letters only. To publish them once Harvard
agrees, move the JSON into the tracked content and update `rightsNote()` in `app/src/lib/letters.ts`.

The transcribers add square brackets:

- corrections after a misspelt word, as in «خاسته [خواسته]»;
- letters they supply, as in «نگا[ه]»;
- notes on where a passage sits, as in «[پشت صفحه:]» ("on the back").

The hand writes what the writer wrote. It leaves out corrections and supplied letters, and starts a new line at a
placement note. The reading page shows the transcription exactly as typed. WWQI names the people in each letter but
not which of them is the recipient, so the recipient is left empty, and the archive's own description and people list
are shown instead. Every record keeps the WWQI record number, the holder of the original (which WWQI's terms ask users
to cite) and a link to the item.

## Not done yet

- Publishing the WWQI letters, once Harvard agrees (see above).
- Words stacked over each other, as shekasteh writers do at the end of a line, and joins from one word into the next.
- Hands built from real handwriting samples (e.g. public-domain copybooks) instead of a typeface's skeleton.
- Downloadable fonts per hand, video and GIF export, and a saved-letters drawer, all of which the original has.

## Credits and licences

- Vazirmatn, © The Vazirmatn Project Authors, SIL OFL 1.1 (`app/public/fonts/OFL.txt`).
- Noto Nastaliq Urdu, © The Noto Project Authors, SIL OFL 1.1 (`app/public/fonts/OFL-NotoNastaliqUrdu.txt`).
- HarfBuzz / harfbuzzjs, MIT.
- Letters: Ganjoor, via Wikidorj. Public-domain texts. Locally, Women's Worlds in Qajar Iran, Harvard University (not redistributed).
- Idea, and the ink model and pen kinematics (ported and adapted): *If This Finds You* by Rafael Cespedes, MIT (`app/public/licenses/if-this-finds-you.txt`).
