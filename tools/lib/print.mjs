// Chromium (via Playwright, using the installed Google Chrome): flow topics onto A4 sheets, number the sheets,
// measure overflow per sheet, screenshot sheets, save the paginated HTML and print the A4 PDF.
import fs from 'node:fs';
import { chromium } from 'playwright';

async function launch() {
  try { return await chromium.launch({ channel: 'chrome' }); }
  catch { return await chromium.launch(); } // falls back to Playwright's own Chromium if installed
}

// Runs in the page. Topics flow onto A4 sheets: a topic starts on the current sheet if its title and first block fit
// there, otherwise on a fresh one; whole top-level blocks move to the next sheet when they don't fit (blocks are never
// split; a heading stays with the block after it). A sheet that starts part-way through a topic repeats its title with
// "(continued)". Covers and summaries get their own sheets; answers start a fresh sheet. Then sheets are numbered and
// every page-number placeholder (.pn) is filled in. Returns { span: {topic id: [first, last] sheet}, tn: {id: n} }.
function paginate() {
  // Every theme flows. In the cgp theme a chapter's topics follow one another down the sheets (a topic may start
  // part-way down a sheet); an authored ::pagebreak is ignored. A new chapter starts a fresh sheet.
  const cgp = document.body.classList.contains('theme-cgp');
  // The book's other layout (module.yaml `book.layout: pages`, chosen in the GUI): every topic starts a fresh sheet
  // and an authored ::pagebreak is obeyed, as before 2026-11-11. Sheets are left part-empty where a topic ends.
  const fixed = cgp && document.body.classList.contains('layout-pages');
  // Content must clear the footer zone. The cgp theme prints the section name and sources line in the bottom 44px
  // (the overflow lint below uses the same figure); a cover has no footer and is laid out to the edge.
  let FOOT = 8;
  const container = document.querySelector('.sheets');
  const topics = [...container.querySelectorAll(':scope > .page')];
  const tn = Object.fromEntries(topics.map(t => [t.dataset.id, +t.dataset.tn]));
  const refOf = Object.fromEntries(topics.map(t => [t.dataset.id, (t.querySelector('.ph .sec') || {}).innerHTML || '']));
  const over = s => {
    const b = s.querySelector('.body'), bottom = s.getBoundingClientRect().bottom - FOOT;
    // cgp: the body is as tall as its content, and a float at its end hangs out of it, so only the blocks are measured.
    let worst = cgp ? 0 : b.scrollHeight - b.clientHeight - 1; // integer pixels: allow 1px of rounding
    for (const e of b.children) worst = Math.max(worst, e.getBoundingClientRect().bottom - bottom);
    return worst > 0.5;
  };
  const group = k => (k === 'content' || k === 'exam' ? 'body' : k);
  const sheets = [];
  let cur = null, prevGroup = null, prevCh = null;
  const newSheet = t => {
    const s = document.createElement('section');
    s.className = t.className;
    s.append(t.querySelector('.ph').cloneNode(true));
    const b = document.createElement('div');
    b.className = 'body';
    s.append(b);
    for (const f of t.querySelectorAll(':scope > .pleft, :scope > .pfoot')) s.append(f.cloneNode(true));
    container.append(s);
    sheets.push(s);
    cur = s;
  };
  const body = () => cur.querySelector('.body');
  // A block that must stay with the one after it: a heading, or a floated figure or note (its text wraps beside it).
  // (A list item or listing part made above is not in the document yet and reports no float.)
  const glued = e => /^H[23]$/.test(e.tagName) || e.matches('.qh') || ['left', 'right'].includes(getComputedStyle(e).float);
  const contTitles = (titles, id) => titles.map(h => { const c = h.cloneNode(true); c.classList.remove('topic-next'); c.classList.add('cont'); c.dataset.topic = id; return c; });
  // A topic's blocks, grouped into the units that are never separated.
  const prepare = t => {
    const id = t.dataset.id, kind = t.dataset.kind || 'content', ch = t.dataset.ch || '';
    const flow = cgp && kind === 'content' && !fixed;
    const kids = [];
    for (const k of [...t.querySelector('.body').children]) {
      if (k.matches('.pb') && !(fixed && kind === 'content')) continue; // an authored page break: ignored, the planner chooses the breaks
      if (k.matches('.srcs')) { const p = kids[kids.length - 1]; if (p) p.dataset.srcs = [p.dataset.srcs, k.dataset.s].filter(Boolean).join(' · '); continue; }
      // A list may break between items: each item becomes its own one-item list that carries on the numbering.
      if (flow && /^(OL|UL)$/.test(k.tagName) && !k.matches('.wq') && k.children.length > 1 && [...k.children].every(li => li.tagName === 'LI')) {
        const total = k.children.length;
        [...k.children].forEach((li, n) => {
          const piece = k.cloneNode(false);
          if (k.tagName === 'OL') { piece.style.counterReset = `n ${n}`; piece.setAttribute('start', n + 1); }
          piece.dataset.li = `${n + 1}/${total}`;
          piece.append(li);
          kids.push(piece);
        });
        continue;
      }
      // A long code listing may break at a blank line (between declarations), as a last resort: the parts sit flush,
      // so on one sheet they look like one listing.
      if (flow && k.tagName === 'PRE' && !k.querySelector(':scope > :not(span)')) {
        const raw = k.innerHTML.split(/\n[ \t]*\n/), parts = [];
        const balanced = h => (h.match(/<span\b/g) || []).length === (h.match(/<\/span>/g) || []).length;
        const lines = h => h.split('\n').length;
        for (const r of raw) { const l = parts[parts.length - 1]; if (parts.length && (!balanced(l) || lines(l) < 5)) parts[parts.length - 1] += '\n\n' + r; else parts.push(r); }
        if (parts.length > 1 && lines(parts[parts.length - 1]) < 5) { const l = parts.pop(); parts[parts.length - 1] += '\n\n' + l; }
        if (parts.length > 1 && lines(k.innerHTML) >= 16) {
          parts.forEach((h, n) => {
            const piece = k.cloneNode(false);
            piece.innerHTML = h;
            piece.dataset.pre = `${n + 1}/${parts.length}`;
            if (n) { piece.style.marginTop = '0'; piece.style.paddingTop = '1.36em'; delete piece.dataset.srcs; } // the padding is the blank line that was there
            if (n < parts.length - 1) piece.style.marginBottom = '0';
            kids.push(piece);
          });
          continue;
        }
      }
      kids.push(k);
    }
    const strip = t.querySelector(':scope > .strip');
    if (strip) kids.push(strip);
    kids.forEach(k => (k.dataset.topic = id));
    let i = 0;
    while (i < kids.length && kids[i].matches('h1.t, .intro')) i++;
    const titles = kids.slice(0, i).filter(k => k.matches('h1.t'));
    // Units: the title group plus the first block; then each block (a heading or a float with the block after it).
    // In a flowing topic the warm-up questions and the tip box that close it are one unit.
    const tailAt = j => flow && kids[j].matches('.qh') && kids[j + 1] && kids[j + 1].matches('ol.wq') && kids.length - j <= 4;
    let j = i;
    while (j < kids.length - 1 && glued(kids[j])) j++;
    const units = [kids.slice(0, j + 1)];
    for (j++; j < kids.length; j++) {
      if (tailAt(j)) { const u = kids.slice(j); u.tail = true; units.push(u); break; }
      const u = [kids[j]];
      while (glued(kids[j]) && j + 1 < kids.length) u.push(kids[++j]);
      units.push(u);
    }
    return { t, id, kind, ch, titles, units };
  };
  // Greedy flow (front pages, answers, old theme): a unit that does not fit moves to a fresh sheet.
  const flowGreedy = ({ t, id, kind, ch, titles, units }) => {
    FOOT = cgp && kind !== 'cover' ? 44 : 8;
    // In a book the chapters' answers follow one another at the back without starting a fresh sheet each (decision 0008).
    const fresh = !cur || group(kind) !== prevGroup || kind === 'cover' || kind === 'summary' || (ch !== prevCh && kind !== 'answers');
    if (fresh) newSheet(t);
    units.forEach((u, n) => {
      const hadContent = body().children.length > 0;
      if (n === 0 && hadContent) u[0].classList.add('topic-next'); // a topic starting part-way down a sheet
      body().append(...u);
      if (!over(cur) || !hadContent) return; // fits, or nothing more can be done (the overflow lint reports it)
      u.forEach(e => e.remove());
      u[0].classList.remove('topic-next');
      newSheet(t);
      if (n > 0) body().append(...contTitles(titles, id));
      body().append(...u);
    });
    prevGroup = group(kind); prevCh = ch;
  };
  // Fixed pages (the cgp theme's `pages` layout): a topic starts a fresh sheet, an authored ::pagebreak starts the
  // next one under the topic's banner, and a block that still does not fit moves on the same way.
  const flowFixed = ({ t, id, kind, ch, titles, units }) => {
    FOOT = 44;
    const banner = () => titles.map(h => { const c = h.cloneNode(true); c.classList.add('rep'); c.dataset.topic = id; return c; });
    newSheet(t);
    let placed = 0;
    for (const u of units) {
      const brk = u.find(e => e.matches('.pb'));
      if (brk) brk.remove();
      const rest = u.filter(e => e !== brk);
      if (brk && placed) { newSheet(t); body().append(...banner()); placed = 0; }
      if (!rest.length) continue;
      body().append(...rest);
      if (over(cur) && placed) { rest.forEach(e => e.remove()); newSheet(t); body().append(...banner(), ...rest); placed = 0; }
      placed++;
    }
    prevGroup = group(kind); prevCh = ch;
  };
  // Planned flow (a chapter's content topics in the cgp theme). The page breaks of the whole chapter are chosen
  // together, the way a typesetter does: every possible break has a price (none before a new heading, some inside a
  // list, a lot between a listing or figure and the points that explain it, or when it would strand one item), every
  // sheet pays for the room left at its foot (a little room is cheap, half a sheet is dear), and the cheapest set of
  // breaks wins. Spacing is never stretched to hide a gap: the rhythm is the same on every sheet.
  const flowPlanned = run => {
    FOOT = 44;
    const atoms = [];
    for (const r of run) r.units.forEach((u, n) => atoms.push({ els: u, r, start: n === 0, tail: !!u.tail, first: u[0], last: u[u.length - 1] }));
    // Measure every unit once, in one long column of the sheet's width.
    newSheet(run[0].t);
    const m = sheets.pop();
    const mb = m.querySelector('.body');
    atoms.forEach((a, k) => { if (a.start && k) a.first.classList.add('topic-next'); mb.append(...a.els); });
    const H = m.getBoundingClientRect().bottom - FOOT - mb.getBoundingClientRect().top;
    for (const a of atoms) {
      const rs = a.els.map(e => e.getBoundingClientRect());
      a.top = Math.min(...rs.map(r => r.top)); a.bottom = Math.max(...rs.map(r => r.bottom));
    }
    const CONT = 34; // the slim "continued" line that heads a sheet starting part-way through a topic
    const n = atoms.length;
    const li = e => (e.dataset.li ? e.dataset.li.split('/').map(Number) : null);
    const breakCost = k => { // the price of starting a sheet at unit k
      const a = atoms[k], prev = atoms[k - 1];
      if (a.start) return 0;
      if (a.first.tagName === 'H2') return 2;
      if (a.tail) return 30; // the closing questions and tip box away from their topic
      if (a.first.dataset.pre) return 38; // a listing cut between declarations
      const me = a.els.length === 1 ? li(a.first) : null;
      if (me) {
        if (!li(prev.last)) return 50; // points away from the listing, figure or table they explain
        if (me[0] === 2 || me[0] === me[1]) return 60; // one item stranded
        return 14;
      }
      return 12;
    };
    const best = Array(n + 1).fill(Infinity), from = Array(n + 1).fill(0);
    best[0] = 0;
    for (let i = 0; i < n; i++) {
      if (best[i] === Infinity) continue;
      let maxB = -Infinity, lastStart = -1;
      for (let j = i; j < n; j++) {
        maxB = Math.max(maxB, atoms[j].bottom);
        if (j > i && atoms[j].start) lastStart = j;
        const used = maxB - atoms[i].top + (atoms[i].start ? 0 : CONT);
        if (used > H && j > i) break;
        const lastSheet = j === n - 1;
        const g = Math.max(0, (H - used) / H);
        let c = 8 + (lastSheet ? 0 : 400 * g * g + 2500 * Math.max(0, g - 0.22) ** 2 + breakCost(j + 1)); // a small gap is cheap, a big one dear
        // a topic that starts near the foot of a sheet and shows little of itself there
        if (lastStart > 0 && !lastSheet && maxB - atoms[lastStart].top < 0.22 * H) c += 30;
        // a sheet that opens with only a scrap of the topic before
        if (!atoms[i].start) { let e = i; while (e < j && atoms[e + 1].r === atoms[i].r) e++; if (atoms[e].bottom - atoms[i].top < 0.12 * H && !lastSheet) c += 25; }
        if (best[i] + c < best[j + 1]) { best[j + 1] = best[i] + c; from[j + 1] = i; }
      }
    }
    const starts = [];
    for (let k = n; k > 0; k = from[k]) starts.unshift(from[k]);
    m.remove();
    // Lay the sheets out as planned; if a sheet turns out over-full in the real layout, its last units move on.
    const ends = [...starts.slice(1), n];
    for (let i = 0; i < n;) {
      let j = ends.find(x => x > i) - 1;
      const a0 = atoms[i];
      newSheet(a0.r.t);
      if (!a0.start) body().append(...contTitles(a0.r.titles, a0.r.id));
      if (a0.first.dataset.pre) { a0.first.style.paddingTop = ''; a0.first.style.marginTop = ''; } // a listing carried over starts clean
      for (let k = i; k <= j; k++) { atoms[k].first.classList.toggle('topic-next', atoms[k].start && k > i); body().append(...atoms[k].els); }
      while (j > i && over(cur)) { atoms[j].els.forEach(e => e.remove()); j--; }
      i = j + 1;
    }
    prevGroup = group('content'); prevCh = run[0].ch;
  };
  let run = [];
  const flush = () => { if (run.length) flowPlanned(run); run = []; };
  for (const t of topics) {
    const r = prepare(t);
    if (fixed && r.kind === 'content') { flush(); flowFixed(r); }
    else if (cgp && r.kind === 'content') { if (run.length && run[0].ch !== r.ch) flush(); run.push(r); }
    else { flush(); flowGreedy(r); }
  }
  flush();
  for (const t of topics) t.remove();
  if (cgp) for (const s of sheets) {
    const b = s.querySelector('.body');
    // One "Sources:" line per sheet, from the citations of the blocks that landed on it.
    const seen = new Set();
    for (const e of b.querySelectorAll(':scope > [data-srcs]')) for (const x of e.dataset.srcs.split(' · ')) if (x.trim()) seen.add(x.trim());
    if (seen.size && !s.classList.contains('cover')) {
      const d = document.createElement('div');
      d.className = 'srcline';
      d.append('Sources: ');
      [...seen].forEach((x, k) => { const sp = document.createElement('span'); sp.style.whiteSpace = 'nowrap'; sp.textContent = x; d.append(k ? ' · ' : '', sp); });
      b.after(d); // before the footer and page number, which the book's read-back check expects last
    }
  }
  // Number the sheets; header shows the § references of the topics on each sheet; fill in page-number placeholders.
  const span = {};
  sheets.forEach((s, i) => {
    s.dataset.pn = i + 1;
    s.classList.add(i % 2 ? 'left' : 'right'); // page 1 is a right-hand page, as in a book
    s.querySelector('.pfoot').textContent = i + 1;
    const ids = [...new Set([...s.querySelectorAll('.body > [data-topic]')].map(e => e.dataset.topic))];
    s.dataset.topics = ids.join(' ');
    for (const id of ids) (span[id] ||= [i + 1, i + 1])[1] = i + 1;
    const sec = s.querySelector('.ph .sec');
    if (sec) sec.innerHTML = [...new Set(ids.map(id => refOf[id]).filter(Boolean))].join(' · ');
  });
  for (const id of Object.keys(span)) { // nav anchors: where each topic starts
    const first = container.querySelector(`.body > [data-topic="${CSS.escape(id)}"]`);
    if (first && !first.id) first.id = 't-' + id;
  }
  for (const e of document.querySelectorAll('.pn')) {
    const rs = e.dataset.pn.split(' ').map(id => span[id]).filter(Boolean);
    if (!rs.length) continue;
    const a = Math.min(...rs.map(r => r[0])), b = Math.max(...rs.map(r => r[1]));
    e.textContent = (e.dataset.fmt === 'p' ? 'p.' : '') + (a === b ? a : `${a}–${b}`);
  }
  return { span, tn };
}

export async function printGuide(htmlPath, { pdf, shotsDir, only } = {}) {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 1300 }, deviceScaleFactor: 1.6 });
  await page.goto('file://' + htmlPath);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  // Paginate and measure with print styles so both match the PDF.
  await page.emulateMedia({ media: 'print' });
  const { span, tn } = await page.evaluate(paginate);
  fs.writeFileSync(htmlPath, '<!DOCTYPE html>\n' + await page.evaluate(() => document.documentElement.outerHTML));
  const sheets = await page.evaluate(() => [...document.querySelectorAll('.sheets > .page')].map((s, i) => {
    // The cgp theme prints the section name and sources line in the bottom 11mm, so content must stop above them.
    const FOOTER = s.classList.contains('cgp') ? 44 : 8;
    // Unused height in the sheet's body: gaps between blocks beyond the normal spacing, plus space after the last block.
    const free = b => {
      const k = [...b.children].map(e => e.getBoundingClientRect());
      if (!k.length) return b.clientHeight;
      let f = s.getBoundingClientRect().bottom - FOOTER - Math.max(...k.map(r => r.bottom));
      for (let j = 1; j < k.length; j++) f += Math.max(0, k[j].top - k[j - 1].bottom - 20);
      return Math.max(0, f);
    };
    const body = s.querySelector('.body');
    const pr = s.getBoundingClientRect();
    let worst = 0, culprit = '';
    s.querySelectorAll('.body *').forEach(e => {
      if (e.closest('svg') && e.tagName.toLowerCase() !== 'svg') return;
      if (e.closest('.katex')) return;
      if (e.closest('.srcline, .pleft, .pfoot')) return; // the footer furniture itself // KaTeX struts can poke out invisibly; the parent box is measured instead
      const r = e.getBoundingClientRect();
      if (!r.width && !r.height) return;
      const over = r.bottom - (pr.bottom - FOOTER); // must clear the footer zone
      const overR = r.right - (pr.right - 6);
      const name = e.tagName + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ').join('.') : '') + ' "' + (e.textContent || '').trim().slice(0, 40) + '"';
      if (over > worst) { worst = over; culprit = name; }
      if (overR > 2 && overR > worst) { worst = overR; culprit = 'RIGHT EDGE ' + name; }
    });
    // Content clipped inside a block that hides its overflow (long code lines in <pre>, wide tables).
    s.querySelectorAll('pre, .box, table').forEach(e => {
      const clip = e.scrollWidth - e.clientWidth;
      if (clip > 2 && clip > worst) { worst = clip; culprit = 'CLIPPED ' + e.tagName + ' "' + (e.textContent || '').trim().slice(0, 40) + '"'; }
    });
    const bodyOverflow = body.scrollHeight - body.clientHeight;
    if (!s.classList.contains('cgp') && bodyOverflow > 1 && bodyOverflow > worst) { worst = bodyOverflow; culprit = culprit || 'body content'; }
    // A ruler for the writer: every block on the sheet with its height (and the gap above it), top to bottom.
    const kids = [...body.children];
    const blocks = kids.map((e, j) => {
      const r = e.getBoundingClientRect();
      const cls = typeof e.className === 'string' && e.className ? '.' + e.className.split(' ').filter(c => !/^(rep|cont|topic-next)$/.test(c))[0] : '';
      return { what: (e.tagName.toLowerCase() + (cls === '.undefined' ? '' : cls)) + ' "' + (e.querySelector('svg') ? 'figure' : (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28)) + '"', h: Math.round(r.height), float: ['left', 'right'].includes(getComputedStyle(e).float) };
    });
    return { sheet: i + 1, topics: (s.dataset.topics || '').split(' ').filter(Boolean), overflow: worst > 0.5, worst: Math.round(worst), culprit, free: Math.round(free(body)), blocks, height: Math.round(pr.bottom - FOOTER - body.getBoundingClientRect().top) };
  }));
  if (shotsDir) {
    fs.mkdirSync(shotsDir, { recursive: true });
    if (!only) for (const f of fs.readdirSync(shotsDir).filter(f => /^p\d+(-\d+)?\.png$/.test(f))) fs.unlinkSync(`${shotsDir}/${f}`);
    const els = await page.$$('.sheets > .page');
    for (let i = 0; i < els.length; i++) {
      for (const id of sheets[i].topics) {
        if (only && !only.includes(tn[id])) continue;
        await els[i].screenshot({ path: `${shotsDir}/${shotName(tn[id], i + 1 - span[id][0] + 1)}` });
      }
    }
  }
  if (pdf) await page.pdf({ path: pdf, format: 'A4', printBackground: true, margin: { top: '0', bottom: '0', left: '0', right: '0' }, preferCSSPageSize: true });
  await browser.close();
  return { sheets, span };
}

// Screenshot of the k-th sheet that topic number `tn` appears on: p05.png, then p05-2.png, p05-3.png…
export const shotName = (tn, part = 1) => `p${String(tn).padStart(2, '0')}${part > 1 ? '-' + part : ''}.png`;
