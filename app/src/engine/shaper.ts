// Persian shaping. HarfBuzz picks each letter's joining form (isolated, initial, medial,
// final), the lām-alef ligature and mark positions; we only ever ask it for glyph ids
// and positions, then draw our own strokes for those glyphs.
// @ts-expect-error: plain emscripten module, no types
import createHarfBuzz from 'harfbuzzjs/hb.js';
// @ts-expect-error: plain JS wrapper, no types
import hbjs from 'harfbuzzjs/hbjs.js';
import wasmUrl from 'harfbuzzjs/hb.wasm?url';
const fontUrl = `${import.meta.env.BASE_URL}fonts/Vazirmatn-Thin.ttf`;

export type ShapedGlyph = { g: number; cl: number; ax: number; dx: number; dy: number };

type Shaper = { shape(text: string): ShapedGlyph[]; upem: number };

let ready: Promise<Shaper> | null = null;

export function loadShaper(): Promise<Shaper> {
  if (ready) return ready;
  ready = (async () => {
    const [mod, fontBuf] = await Promise.all([
      createHarfBuzz({ locateFile: () => wasmUrl }),
      fetch(fontUrl).then((r) => r.arrayBuffer()),
    ]);
    const hb = hbjs(mod);
    const blob = hb.createBlob(fontBuf);
    const face = hb.createFace(blob, 0);
    const font = hb.createFont(face);
    const cache = new Map<string, ShapedGlyph[]>();
    return {
      upem: face.upem as number,
      shape(text: string) {
        const hit = cache.get(text);
        if (hit) return hit;
        const buf = hb.createBuffer();
        buf.addText(text);
        buf.setDirection('rtl');
        buf.setScript('Arab');
        buf.setLanguage('fa');
        hb.shape(font, buf);
        const out = (buf.json() as ShapedGlyph[]).map(({ g, cl, ax, dx, dy }) => ({ g, cl, ax, dx, dy }));
        buf.destroy();
        cache.set(text, out);
        return out;
      },
    };
  })();
  return ready;
}

/** Tidy text the way a Persian reader expects: Persian yeh and kaf, Persian digits, no stray tatweel. */
export function normalisePersian(s: string): string {
  return s
    .replace(/ي/g, 'ی')
    .replace(/ى/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[0-9]/g, (d) => String.fromCharCode(0x06f0 + +d))
    .replace(/[٠-٩]/g, (d) => String.fromCharCode(0x06f0 + d.charCodeAt(0) - 0x0660))
    .replace(/ـ+/g, '')
    .replace(/[ \t]+/g, ' ');
}
