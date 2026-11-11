// Every glyph the letters need must have strokes. Shapes every word of every letter exactly as the
// app does (same clean-up, rtl / Arab / fa) and fails on any glyph that has ink in the font but
// neither paths nor dots in the skeleton library.
//   node tools/check-coverage.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../app/package.json', import.meta.url));
const hb = await require('harfbuzzjs');

const font = hb.createFont(hb.createFace(hb.createBlob(readFileSync(new URL('../app/public/fonts/Vazirmatn-Thin.ttf', import.meta.url))), 0));
const sk = JSON.parse(readFileSync(new URL('../app/src/engine/data/skeletons.json', import.meta.url), 'utf8'));
const letters = JSON.parse(readFileSync(new URL('../content/letters.json', import.meta.url), 'utf8'));

// keep in step with normalisePersian() in app/src/engine/shaper.ts
const normalise = (s) => s
  .replace(/ي/g, 'ی').replace(/ى/g, 'ی').replace(/ك/g, 'ک')
  .replace(/[0-9]/g, (d) => String.fromCharCode(0x06f0 + +d))
  .replace(/[٠-٩]/g, (d) => String.fromCharCode(0x06f0 + d.charCodeAt(0) - 0x0660))
  .replace(/ـ+/g, '').replace(/[ \t]+/g, ' ');

const missing = new Map();
let words = 0;
const extra = 'یک دو سه ۰ ۱ ۲ ۳ ۴ ۵ ۶ ۷ ۸ ۹ . ، ؛ ؟ ! : « » ( ) …';
for (const text of [...letters.map((l) => l.text), extra]) {
  for (const w of normalise(text).split(/\s+/).filter(Boolean)) {
    words++;
    const b = hb.createBuffer();
    b.addText(w); b.setDirection('rtl'); b.setScript('Arab'); b.setLanguage('fa');
    hb.shape(font, b);
    for (const g of b.json()) {
      const s = sk.glyphs[g.g];
      const hasInk = font.glyphToPath(g.g).length > 0;
      if (hasInk && (!s || (!s.paths.length && !s.dots.length))) {
        const name = font.glyphName(g.g);
        if (!missing.has(name)) missing.set(name, w);
      }
    }
    b.destroy();
  }
}
if (missing.size) {
  console.error(`${missing.size} glyphs with no strokes:`);
  for (const [name, w] of missing) console.error(`  ${name}  (e.g. «${w}»)`);
  process.exit(1);
}
console.log(`ok: ${words} words shaped, every glyph has strokes`);
