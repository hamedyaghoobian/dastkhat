// Debug view: shape a line, draw the font outline in grey and the skeleton strokes on top.
//   node tools/preview-skeleton.mjs "متن" out.svg
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../app/package.json', import.meta.url));
const hb = await require('harfbuzzjs');

const [text = 'قربانت گردم، نامهٔ شما رسید و خوشحال شدم.', out = 'preview.svg'] = process.argv.slice(2);
const sk = JSON.parse(readFileSync(new URL('../app/src/engine/data/skeletons.json', import.meta.url)));
const face = hb.createFace(hb.createBlob(readFileSync(new URL('../app/public/fonts/Vazirmatn-Thin.ttf', import.meta.url))), 0);
const font = hb.createFont(face);
const buf = hb.createBuffer();
buf.addText(text);
buf.setDirection("rtl"); buf.setScript("Arab"); buf.setLanguage("fa");
hb.shape(font, buf);
const glyphs = buf.json();
let x = 0;
const parts = [];
const colors = ['#c0392b', '#2471a3', '#1e8449', '#8e44ad', '#d35400'];
for (const g of glyphs) {
  const gx = x + g.dx, gy = g.dy;
  parts.push(`<path transform="translate(${gx},${gy})" d="${font.glyphToPath(g.g)}" fill="#ddd"/>`);
  const s = sk.glyphs[g.g];
  if (s) {
    s.paths.forEach((p, i) => {
      const pts = [];
      for (let k = 0; k < p.p.length; k += 2) pts.push(`${p.p[k] + gx},${p.p[k + 1] + gy}`);
      parts.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${colors[i % colors.length]}" stroke-width="22"/>`);
    });
    for (const [cx, cy, r] of s.dots) parts.push(`<circle cx="${cx + gx}" cy="${cy + gy}" r="${r}" fill="#000"/>`);
  }
  x += g.ax;
}
// glyph order from HarfBuzz for RTL is visual (left→right), so x grows; flip y for SVG
writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-100 -2600 ${x + 200} 3400" width="${(x + 200) / 4}" style="background:#fff"><g transform="scale(1,-1)">${parts.join('')}</g></svg>`);
console.log(`${glyphs.length} glyphs, width ${x}`);
