// Every glyph the letters need must have strokes, in both scripts (nasta'liq and naskh). Shapes every distinct word of
// every letter exactly as the app does (same clean-up, rtl / Arab / fa) and fails on any glyph the font lacks
// (.notdef) or that has ink in the font but neither paths nor dots in the skeleton library.
//   node tools/check-coverage.mjs
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../app/package.json', import.meta.url));
const hb = await require('harfbuzzjs');

const SCRIPTS = [
  ['nastaliq', 'NotoNastaliqUrdu.ttf', 'skeletons-nastaliq.json'],
  ['naskh', 'Vazirmatn-Thin.ttf', 'skeletons.json'],
];
const letters = JSON.parse(readFileSync(new URL('../content/letters.json', import.meta.url), 'utf8'));
// plus any local-only letters (content/local/*.json, e.g. WWQI), which the app also loads when present
const localDir = new URL('../content/local/', import.meta.url);
if (existsSync(localDir)) for (const f of readdirSync(localDir).filter((f) => f.endsWith('.json'))) letters.push(...JSON.parse(readFileSync(new URL(f, localDir), 'utf8')));

// keep in step with normalisePersian() in app/src/engine/shaper.ts
const normalise = (s) => s
  .replace(/ي/g, 'ی').replace(/ى/g, 'ی').replace(/ك/g, 'ک')
  .replace(/[0-9]/g, (d) => String.fromCharCode(0x06f0 + +d))
  .replace(/[٠-٩]/g, (d) => String.fromCharCode(0x06f0 + d.charCodeAt(0) - 0x0660))
  .replace(/ـ+/g, '').replace(/[ \t]+/g, ' ');

const extra = 'یک دو سه ۰ ۱ ۲ ۳ ۴ ۵ ۶ ۷ ۸ ۹ . ، ؛ ؟ ! : « » ( ) …';
const words = new Set();
for (const text of [...letters.map((l) => l.text), extra]) for (const w of normalise(text).split(/\s+/)) if (w) words.add(w);
let failed = false;
for (const [name, file, skFile] of SCRIPTS) {
  const font = hb.createFont(hb.createFace(hb.createBlob(readFileSync(new URL('../app/public/fonts/' + file, import.meta.url))), 0));
  const sk = JSON.parse(readFileSync(new URL('../app/src/engine/data/' + skFile, import.meta.url), 'utf8'));
  const missing = new Map();
  for (const w of words) {
    const b = hb.createBuffer();
    b.addText(w); b.setDirection('rtl'); b.setScript('Arab'); b.setLanguage('fa');
    hb.shape(font, b);
    for (const g of b.json()) {
      const s = sk.glyphs[g.g];
      const hasInk = g.g === 0 || font.glyphToPath(g.g).length > 0;
      if (hasInk && (g.g === 0 || !s || (!s.paths.length && !s.dots.length))) {
        const gname = g.g === 0 ? '.notdef' : font.glyphName(g.g);
        if (!missing.has(gname)) missing.set(gname, w);
      }
    }
    b.destroy();
  }
  if (missing.size) {
    failed = true;
    console.error(`${name}: ${missing.size} glyphs with no strokes:`);
    for (const [g, w] of missing) console.error(`  ${g}  (e.g. «${w}»)`);
  } else console.log(`${name} ok: ${words.size} distinct words shaped, every glyph has strokes`);
}
if (failed) process.exit(1);
