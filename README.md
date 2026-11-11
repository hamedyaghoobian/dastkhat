# اگر این نامه به دستت رسید — Persian letters, written by hand

Real Persian letters, in their writers' own words, written out live, stroke by stroke and right to left, in the hand
of a writer who never existed. A Persian counterpart to [If This Finds You](https://github.com/rafaelcespedes/if-this-finds-you)
(the idea, not the code: Persian needs its own engine, and this one is written from scratch).

## Run it

```bash
cd app && npm install && npm run dev
```

`npm run build` makes a static site in `app/dist/` (hash routes, so any static host works).

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
| Single-line skeletons for every glyph Persian text can reach, from Vazirmatn Thin: rasterise → Zhang–Suen thinning → spur pruning → tracing; dots kept apart | `tools/skeletonize.mjs` → `app/src/engine/data/skeletons.json` |
| A seed becomes a writer, with correlated traits (hurry → untidier, more dashes for dots) | `app/src/engine/hand.ts` |
| Layout and stroke order: each connected piece of a word in one movement from the right, then dots, gāf bars and hamzas; two dots as a dash, three as a caret when hurried; one smooth bend per word so joins stay joined; words climbing to the left; last word squeezed into the margin | `app/src/engine/compose.ts` |
| Pens: a broad nib sweeps parallelograms (naskh's thick and thin; a reed's nuqta comes out as a rhombus); round pens and pencil | `app/src/engine/render.ts` |
| Crossing out | `app/src/engine/marks.ts` |

Determinism: the same seed, settings and text always give the same page (all randomness goes through `rng()`).

Rebuild the skeletons after changing the font or the tracer: `node tools/skeletonize.mjs app/public/fonts/Vazirmatn-Thin.ttf app/src/engine/data/skeletons.json`.
`node tools/preview-skeleton.mjs "متن" out.svg` draws the skeletons over the font outline for checking, and
`node tools/check-coverage.mjs` shapes every word of every letter and fails if any glyph has no strokes.

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

## Not done yet

- **Women's Worlds in Qajar Iran** (Harvard): letters by Qajar women. These are mostly page images without typed text, and
  their reuse terms aren't stated, so they need transcription and the project's permission (wwqi@fas.harvard.edu) before
  they can be added. The record format already has `source.collection` for a second collection.
- Nasta'liq and shekasteh, the hands most of these letters were really written in (sloped baselines, stacked letters).
- Hands built from real handwriting samples (e.g. public-domain copybooks) instead of a typeface's skeleton.
- Downloadable fonts per hand, video and GIF export, and a saved-letters drawer, all of which the original has.

## Credits and licences

- Vazirmatn, © The Vazirmatn Project Authors, SIL OFL 1.1 (`app/public/fonts/OFL.txt`).
- HarfBuzz / harfbuzzjs, MIT.
- Letters: Ganjoor, via Wikidorj. Public-domain texts.
- Idea: *If This Finds You* by Rafael Cespedes (MIT).
