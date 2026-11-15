// Side-by-side screenshots: a reference HTML guide (e.g. the pilot) vs the current build of a section.
// Usage: tools/compare <module> <section> <reference.html> [pages e.g. 1-18]
// Writes out/<module>/<section>/compare/pNN.png (reference left, new right).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { ROOT } from './lib/cite.mjs';

const [module, section, ref, range] = process.argv.slice(2);
if (!ref) { console.error('usage: tools/compare <module> <section> <reference.html> [1-18]'); process.exit(2); }
const OUT = path.join(ROOT, 'out', module, section, 'compare');
fs.mkdirSync(OUT, { recursive: true });

async function shots(html, prefix) {
  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const page = await browser.newPage({ viewport: { width: 1000, height: 1300 }, deviceScaleFactor: 1 });
  await page.goto('file://' + path.resolve(html));
  await page.evaluate(() => document.fonts.ready);
  await page.emulateMedia({ media: 'print' });
  const els = await page.$$('.page');
  for (let i = 0; i < els.length; i++) await els[i].screenshot({ path: path.join(OUT, `${prefix}${String(i + 1).padStart(2, '0')}.png`) });
  await browser.close();
  return els.length;
}
const nRef = await shots(ref, 'ref_');
const nNew = await shots(path.join(ROOT, 'out', module, section, 'guide.html'), 'new_');
let [a, b] = (range || `1-${Math.max(nRef, nNew)}`).split('-').map(Number); b = b || a;
const py = `
import sys
from PIL import Image, ImageDraw
out, a, b = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
for i in range(a, b + 1):
    ims = []
    for pre in ("ref_", "new_"):
        try: ims.append(Image.open(f"{out}/{pre}{i:02d}.png").convert("RGB"))
        except FileNotFoundError: ims.append(Image.new("RGB", (794, 1123), "#bbb"))
    W = sum(im.width for im in ims) + 12; H = max(im.height for im in ims) + 22
    m = Image.new("RGB", (W, H), "#777"); d = ImageDraw.Draw(m)
    x = 0
    for im, lab in zip(ims, ("pilot", "new build")):
        m.paste(im, (x, 22)); d.text((x + 6, 5), f"{lab} — page {i}", fill="white"); x += im.width + 12
    m.save(f"{out}/p{i:02d}.png")
`;
execFileSync(path.join(ROOT, '.venv/bin/python'), ['-c', py, OUT, String(a), String(b)], { stdio: 'inherit' });
console.log(`compare: ${nRef} reference pages, ${nNew} new pages → ${path.relative(ROOT, OUT)}/pNN.png`);
