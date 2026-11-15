// Build a section: parse pages → lint → HTML (KaTeX, fonts, figures inlined) → Chromium: overflow check, screenshots, A4 PDF.
// Usage: tools/build <module> <section> [--no-pdf] [--no-shots] [--pages 3,5]
// `tools/build <module> book` builds the module's growing textbook (decision 0004): the front pages in content/book/,
// then every FINISHED chapter in lecture order (tools/lib/book.mjs decides: built, lint clean, coverage gate passed,
// every page verified), then the chapters' answers pages. The chapters are ordinary sections (one per lecture) that
// are built, linted and verified on their own. The finished PDF is then read back (tools/lib/bookcheck.py) to check
// the page numbers, the contents page and the edition page against what was laid out.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';
import { ROOT, loadIndex } from './lib/cite.mjs';
import { parsePage, renderTree, lintBlocks, renderInline, renderBlocks, math } from './lib/render.mjs';
import { printGuide } from './lib/print.mjs';
import { bookChapters } from './lib/book.mjs';

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const [module, section] = args.filter(a => !a.startsWith('--'));
const onlyIdx = args.indexOf('--pages');
const only = onlyIdx >= 0 ? args[onlyIdx + 1].split(',').map(Number) : null;
if (!module || !section) { console.error('usage: tools/build <module> <section> [--no-pdf] [--no-shots] [--pages 3,5]'); process.exit(2); }

const MOD = path.join(ROOT, 'modules', module);
const OUT = path.join(ROOT, 'out', module, section);
fs.mkdirSync(OUT, { recursive: true });
const mod = YAML.parse(fs.readFileSync(path.join(MOD, 'module.yaml'), 'utf8'));
const isBook = section === 'book';
const sec = isBook ? (mod.book ? { theme: 'cgp', tab: mod.title, ...mod.book } : null) : (mod.sections || {})[section];
if (!sec) { console.error(isBook ? 'module.yaml has no `book:` (title, tab, pdf_name)' : `module.yaml has no section ${section}`); process.exit(2); }
// The book's "about this edition" page reads the lecture timeline, so refresh it first.
if (isBook && fs.existsSync(path.join(MOD, 'lectures.yaml'))) execFileSync(path.join(ROOT, 'tools', 'lectures'), [module], { stdio: 'ignore' });
// A book holds every finished chapter, in lecture order; chapters that are written but not finished are held back.
const bk = isBook ? bookChapters(module, mod) : null;
const chapters = isBook ? bk.included.map(c => c.id) : [section];
if (isBook) {
  console.log(`book: ${chapters.length} finished chapter(s): ${chapters.join(', ') || 'none'}`);
  for (const c of bk.held) console.log(`book: ${c.id} is HELD BACK — ${c.why}`);
}
const lecturesFile = path.join(ROOT, 'out', module, 'lectures.json');
const timeline = fs.existsSync(lecturesFile) ? JSON.parse(fs.readFileSync(lecturesFile, 'utf8')) : null;
// The layout (decision 0008): 'pages' (the default: every topic is one or two whole sheets, ::pagebreak is obeyed and
// the writer fits the text to the sheet; a blank band at the foot of a sheet is a lint problem) or 'flow' (module.yaml
// `book.layout: flow`: topics follow one another down the sheets). A chapter builds the way its book does.
const layout = mod.book && mod.book.layout === 'flow' ? 'flow' : 'pages';
const theme = sec.theme || 'classic'; // 'cgp' = decision 0003 (fixed pages, statement headings, sources in the footer)
const index = loadIndex(module);
if (!index) console.warn('WARNING: no source index — citations cannot resolve. Run tools/ingest ' + module);

// ---------- figures ----------
const FIG_OUT = path.join(ROOT, 'out', module, 'figures');
fs.mkdirSync(FIG_OUT, { recursive: true });
const py = path.join(ROOT, '.venv', 'bin', 'python');
for (const f of fs.existsSync(path.join(MOD, 'figures')) ? fs.readdirSync(path.join(MOD, 'figures')).filter(f => f.endsWith('.py')).sort() : []) {
  const script = path.join(MOD, 'figures', f);
  const stamp = path.join(FIG_OUT, `.${f}.stamp`);
  if (!fs.existsSync(stamp) || fs.statSync(stamp).mtimeMs < fs.statSync(script).mtimeMs) {
    console.log(`figures: running ${f}`);
    execFileSync(py, [script, FIG_OUT], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, MPLBACKEND: 'svg', PYTHONWARNINGS: 'ignore' } });
    fs.writeFileSync(stamp, '');
  }
}
const figCache = {};
const figures = name => {
  if (name in figCache) return figCache[name];
  for (const f of [path.join(FIG_OUT, name + '.svg'), path.join(MOD, 'figures', 'static', name + '.svg')])
    if (fs.existsSync(f)) return (figCache[name] = fs.readFileSync(f, 'utf8').replace(/<\?xml[\s\S]*?\?>\s*/, '').replace(/<!DOCTYPE[\s\S]*?>\s*/, ''));
  return (figCache[name] = null);
};

// ---------- checks ----------
const checkIds = new Set();
const CHK = path.join(MOD, 'checks');
for (const f of fs.existsSync(CHK) ? fs.readdirSync(CHK).filter(f => f.endsWith('.py')) : [])
  for (const m of fs.readFileSync(path.join(CHK, f), 'utf8').matchAll(/@check\(\s*["']([\w.-]+)["']/g)) checkIds.add(m[1]);
const checkResultsFile = path.join(ROOT, 'out', module, 'checks.json');
const checkResults = fs.existsSync(checkResultsFile) ? JSON.parse(fs.readFileSync(checkResultsFile, 'utf8')).results : {};

// ---------- questions & errata ----------
const loadYaml = f => (fs.existsSync(f) ? YAML.parse(fs.readFileSync(f, 'utf8')) || [] : []);
const questions = fs.existsSync(path.join(MOD, 'questions'))
  ? fs.readdirSync(path.join(MOD, 'questions')).filter(f => f.endsWith('.yaml')).sort().flatMap(f => loadYaml(path.join(MOD, 'questions', f)).map(q => ({ ...q, _file: `modules/${module}/questions/${f}` })))
  : [];
const errata = loadYaml(path.join(MOD, 'errata.yaml'));

// ---------- pages ----------
const readDir = (dirName, chapter) => {
  const dir = path.join(MOD, 'content', dirName);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort().map(f => {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const rel = `modules/${module}/content/${dirName}/${f}`;
    return { file: rel, src, chapter, ...parsePage(src, rel) };
  });
};
let pages;
if (isBook) {
  const front = readDir('book', null), ch = chapters.flatMap(c => readDir(c, c));
  const isAns = p => p.fm.kind === 'answers';
  pages = [...front, ...ch.filter(p => !isAns(p)), ...ch.filter(isAns)]; // answers go to the back of the book
} else pages = readDir(section, section);
const problems = pages.flatMap(p => p.problems);
const chapterName = c => { const L = timeline && timeline.lectures.find(l => l.chapter === c); return L ? `Lecture ${L.n}` : ((mod.sections || {})[c] || {}).title || c; };
const inChapter = (q, c) => q._used && q._used.has(c);
// Front-matter lists must hold plain strings ("a: b" unquoted in YAML becomes an object and renders as [object Object]).
for (const p of pages) for (const k of ['summary']) for (const it of p.fm[k] || [])
  if (typeof it !== 'string') problems.push({ file: p.file, line: 1, msg: `${k} item is not a string (quote it if it contains ": "): ${JSON.stringify(it)}` });
const ids = new Map();
pages.forEach((p, i) => {
  p.num = i + 1;
  if (ids.has(p.fm.id)) problems.push({ file: p.file, line: 1, msg: `duplicate page id "${p.fm.id}" (also ${ids.get(p.fm.id).file})` });
  ids.set(p.fm.id, p);
});
const pageNum = id => (ids.get(id) || {}).num || null;
const macros = Object.fromEntries(Object.entries(mod.macros || {}).map(([k, v]) => [k, String(v)]));

const plainTitle = t => String(t || '').replace(/[[\]]/g, '').replace(/\$[^$]*\$/g, m => m);
// Page numbers are only known after pagination (a topic can take several sheets), so the HTML carries placeholders
// that tools/lib/print.mjs fills in: `fmt` 'p' → "p.5" / "p.5–6", 'bare' → "5" / "5–6". The fallback text assumes
// one sheet per topic.
const pn = (ids, fmt = 'p') => {
  const nums = ids.map(pageNum).filter(Boolean);
  const a = Math.min(...nums), b = Math.max(...nums);
  return `<span class="pn" data-pn="${ids.map(esc).join(' ')}" data-fmt="${fmt}">${fmt === 'p' ? 'p.' : ''}${a === b ? a : `${a}–${b}`}</span>`;
};

// What the contents and edition pages are meant to say, recorded while they are generated and compared with the
// printed PDF afterwards (book builds only).
const expectContents = [], expectEdition = [];
// Generators for the generated pages (contents, summary, answers, questions, errata).
function generators(page) {
  return {
    contents: () => {
      // One row per topic; a topic with `contents: false` extends the previous row's page range (e.g. 16–17).
      const rows = [];
      for (const p of pages) {
        if (p === page) continue;
        if (p.fm.contents === false) { if (rows.length && p.fm.kind !== 'cover' && p.fm.kind !== 'front') rows[rows.length - 1].ids.push(p.fm.id); continue; }
        const ref = p.fm.contents_ref != null ? p.fm.contents_ref : (p.fm.kind && p.fm.kind !== 'content' ? '—' : p.fm.ref || '');
        rows.push({ ids: [p.fm.id], label: p.fm.contents || plainTitle(p.fm.title), ref, p });
      }
      let h = `<table class="cmp toc"><tr><th>Page</th><th>Topic</th>${isBook ? '' : '<th>Notes</th>'}</tr>`;
      let lastCh = null, ansHead = false;
      // In a book each chapter is its own table, so a long contents list can run onto a second sheet between chapters.
      const head = t => { expectContents.push({ heading: t }); return `</table><table class="cmp toc cont"><tr class="chap"><td colspan="2">${esc(t)}</td></tr>`; };
      expectContents.length = 0;
      for (const r of rows) {
        // In a book, a heading row starts each chapter (and the answers at the back).
        if (isBook && r.p.fm.kind === 'answers' && !ansHead) { ansHead = true; h += head('Answers'); }
        else if (isBook && r.p.chapter && r.p.fm.kind !== 'answers' && r.p.chapter !== lastCh) {
          lastCh = r.p.chapter;
          h += head(`${chapterName(lastCh)}: ${((mod.sections || {})[lastCh] || {}).title || ''}`);
        }
        expectContents.push({ ids: r.ids, label: plainTitle(r.label) });
        h += rowHtml(r);
      }
      return h + '</table>';
      function rowHtml(r) { return `<tr><td>${pn(r.ids, 'bare')}</td><td>${renderInline(r.label, ctxFor(r.p, true))}</td>${isBook ? '' : `<td>${renderInline(String(r.ref), ctxFor(r.p, true))}</td>`}</tr>`; }
    },
    edition: (a, ctx) => {
      // "About this edition": every lecture of the course, and whether it is in this book yet (from tools/lectures).
      if (!timeline) { ctx.problems.push({ file: ctx.file, line: '?', msg: '::edition needs modules/<m>/lectures.yaml (run tools/lectures)' }); return ''; }
      let h = '<table class="cmp toc"><tr><th>Lecture</th><th>Title</th><th>In this edition?</th><th>What the lecture covered</th></tr>';
      expectEdition.length = 0;
      for (const L of timeline.lectures) {
        const ids = pages.filter(p => p.chapter && p.chapter === L.chapter && p.fm.kind !== 'answers').map(p => p.fm.id);
        const inBook = ids.length && chapters.includes(L.chapter);
        const c = L.coverage ? { ...L.coverage, covered: L.coverage.covered + (L.coverage.unclear || 0) } : null, skipped = c ? c.skipped + c['not seen'] : 0;
        const cov = L.given === false ? 'not lectured this year' : !c ? (L.happened && !L.recording ? 'no recording yet' : '') : c['not seen'] ? `${c.covered + c.brief} slides shown` : `${c.covered + c.brief} of ${c.covered + c.brief + skipped} slides shown` + (skipped ? ` (${skipped} skipped)` : '');
        if (inBook) expectEdition.push({ lecture: L.n, title: L.title, ids });
        const held = bk && bk.held.some(c => c.id === L.chapter);
        const st = inBook ? `<b>Yes</b>, ${pn(ids)}` : held ? 'Written, being checked' : !L.happened ? `Not yet given${L.date ? ' (' + esc(new Date(L.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })) + ')' : ''}` : L.examinable === false ? 'Not examinable' : 'Not written yet';
        h += `<tr class="${inBook ? 'in' : 'out'}"><td>${esc(L.n)}</td><td>${renderInline(L.title, ctx)}</td><td>${st}</td><td>${esc(cov)}</td></tr>`;
      }
      const d = new Date(timeline.generated);
      return h + `</table><p class="edition-date">Edition of ${esc(d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))}: ${timeline.lectures.filter(L => chapters.includes(L.chapter)).length} of ${timeline.lectures.length} lectures.</p>`;
    },
    summary: (a, ctx) => {
      const groups = [];
      for (const p of pages) {
        if (!p.fm.summary) continue;
        const g = p.fm.summary_group || p.fm.short || plainTitle(p.fm.title);
        const last = groups[groups.length - 1];
        if (last && last.name === g) { last.ids.push(p.fm.id); last.items.push(...p.fm.summary); }
        else groups.push({ name: g, ids: [p.fm.id], items: [...p.fm.summary] });
      }
      let n = 0, h = '<div class="sumflow">';
      for (const g of groups) {
        h += `<h3>${esc(g.name)} (${pn(g.ids)})</h3><ol start="${n + 1}">`;
        for (const it of g.items) { n++; h += `<li><span class="tick"></span>${renderInline(it, ctx)}</li>`; }
        h += '</ol>';
      }
      if (!n) ctx.problems.push({ file: ctx.file, line: '?', msg: '::summary found no summary: items in any page front matter' });
      return h + '</div>';
    },
    answers: (a, ctx, node, extra) => {
      // With no from/to: every topic of this page's chapter (the whole section in a section build).
      const from = a.from ? pageNum(a.from) : 1, to = a.to ? pageNum(a.to) : pages.length;
      if (!from || !to) { ctx.problems.push({ file: ctx.file, line: node.position.start.line, msg: `:::answers from/to must be page ids (got ${a.from}, ${a.to})` }); return ''; }
      let h = '<div class="ansflow ans">';
      for (const p of pages.slice(from - 1, to)) {
        if (!a.from && p.chapter !== page.chapter) continue;
        if (!p.warmups || !p.warmups.length) continue;
        h += `<div class="ans-group"><h3>${pn([p.fm.id])} ${esc(p.fm.short || plainTitle(p.fm.title))}</h3><ol>`;
        for (const w of p.warmups) h += `<li>${w.a}</li>`;
        h += '</ol></div>';
      }
      return h + extra + '</div>';
    },
    questions: (a, ctx) => {
      const qs = questions.filter(q => q.section === (a.section || section) && (a.answered === undefined || String(!!q.answered) === String(a.answered)));
      if (!qs.length) ctx.problems.push({ file: ctx.file, line: '?', msg: `::questions: no questions for section ${a.section || section}` });
      return qs.map(q => {
        q._page = page.num;
        const tag = renderSrc(q.src, ctx, q);
        return `<div class="q"><span class="tick"></span><span class="ref">${esc(q.ref)}</span><span class="marks">${esc(q.marks_label || (q.marks ? `[${q.marks} marks]` : ''))}</span><p>${renderInline(q.stem, ctx)} ${tag}</p></div>`;
      }).join('');
    },
    'question-answers': (a, ctx, node, extra) => {
      // With no section: the questions this page's chapter used in ::examq panels.
      const qs = a.section ? questions.filter(q => q.section === a.section && q.answered && !q.answer_page) : questions.filter(q => inChapter(q, page.chapter) && q.answered && q.answer);
      // cols=1: one full-width block per answer, so long (code) answers can flow onto the next sheet.
      const single = String(a.cols) === '1';
      let h = single ? '' : '<div class="ansflow ans">';
      for (const q of qs) {
        const before = ctx.checks.length;
        const body = renderBlocks(q.answer, ctx);
        const checks = ctx.checks.slice(before);
        q._answerChecks = checks;
        const one = `<div class="q"><span class="ref">${esc(q.ref)}</span> <span class="small muted">· ${esc(q.answer_source || '')}</span>${body}<p class="src blk">${renderSrc(q.answer_src || q.src, ctx, q, true)}</p></div>`;
        h += single ? `<div class="ans qa">${one}</div>` : one;
      }
      return single ? h + extra : h + extra + '</div>';
    },
    examq: (a, ctx, node) => {
      // Exam questions on a spread: real past-paper parts from questions/*.yaml, by id.
      const want = String(a.ids || '').split(/[\s,]+/).filter(Boolean);
      if (!want.length) ctx.problems.push({ file: ctx.file, line: node.position.start.line, msg: '::examq needs ids="q-id q-id"' });
      let h = `<div class="qh">Exam Question${want.length > 1 ? 's' : ''}</div><div class="exq">`;
      want.forEach((id, k) => {
        const q = questions.find(q => q.id === id);
        if (!q) { ctx.problems.push({ file: ctx.file, line: node.position.start.line, msg: `::examq: no question with id "${id}" in questions/*.yaml` }); return; }
        q._page = page.num;
        (q._used ||= new Set()).add(page.chapter);
        renderSrc(q.src, ctx, q); // cite it, so the verifier is given the paper
        const from = String(q.ref).replace(/^T(\d{4}) P(\d+) /, 'Tripos $1 Paper $2 ');
        const tag = ` <span class="from">${esc(from)}</span>`;
        let stem = renderBlocks(q.stem, ctx);
        // The paper reference follows a one-paragraph stem inline; under a list of parts it sits above the marks.
        const inline = /<\/p>$/.test(stem);
        if (inline) stem = stem.replace(/<\/p>$/, tag + '</p>');
        h += `<div class="q"><span class="num">Q${k + 1}</span><div class="t">${stem}</div><span class="mk">${inline ? '' : tag + '<br>'}${esc(q.marks_label || (q.marks ? `[${q.marks} marks]` : ''))}</span></div>`;
      });
      return h + '</div>';
    },
    errata: (a, ctx) => {
      // Cite every entry for this section (shown or not) so the verifier sees all of them.
      for (const e of errata.filter(e => (e.sections || []).includes(a.section || section))) renderSrc(e.src || e.where, ctx, e, true);
      const es = errata.filter(e => (e.sections || []).includes(a.section || section) && e.in_box !== false);
      return `<div class="box warn"><span class="lab">Likely typos in the course materials</span><ul class="small">${es.map(e => `<li><b>${esc(e.where.replace(/\bp(\d)/, 'p.$1'))}</b>: ${renderInline(e.text, ctx)}</li>`).join('')}</ul>${e_src(es, ctx)}${mod.errata_note ? `<p class="small" style="margin-top:2px">${renderInline(mod.errata_note.text, ctx)} ${renderSrc(mod.errata_note.src, ctx)}</p>` : ''}</div>`;
    },
  };
}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function e_src(es, ctx) { return ''; }
function renderSrc(src, ctx, owner, raw) {
  const h = renderInline(`:src[${src}]`, ctx);
  return raw ? h.replace(/^<span class="src">|<\/span>$/g, '') : h;
}

function ctxFor(page, quiet) {
  return {
    file: page.file, index, macros, figures, checkIds, checkResults, pageNum, theme,
    problems: quiet ? [] : page.problemsOut, blocks: [], citations: [], checks: [], figs: [], warmups: [], gen: generators(page),
  };
}

// The book's front cover (cgp theme), laid out like the cover of a printed revision guide: a mark and a badge above a
// white rule, the level, the title and the course on the dark panel, the series name and a tagline, a second rule,
// and the page's own text as the small print at the foot. Front matter: mark, level, title, board,
// subtitle ("First line | Second line"), tagline, badge ("line | line"; a book's default is the lectures it holds).
function coverHead(fm, titleHtml, ctx) {
  const inl = t => renderInline(String(t), ctx);
  const lines = t => String(t).split('|').map(x => x.trim()).filter(Boolean);
  let badge = fm.badge ? lines(fm.badge) : null;
  if (!badge && isBook && timeline) {
    const ns = timeline.lectures.filter(L => chapters.includes(L.chapter)).map(L => L.n);
    const run = ns.length > 1 && ns.every((n, i) => !i || n === ns[i - 1] + 1);
    if (ns.length) badge = ['This edition', ns.length === 1 ? `Lecture ${ns[0]}` : run ? `Lectures ${ns[0]}–${ns[ns.length - 1]}` : `${ns.length} lectures`, 'checked'];
  }
  const [s1, s2] = fm.subtitle ? lines(fm.subtitle) : [];
  return `<div class="cv-top">${fm.mark ? `<span class="cv-mark">${inl(fm.mark)}</span>` : ''}</div>
${badge ? `<div class="cv-badge"><svg viewBox="0 0 120 132" aria-hidden="true"><path d="M60 3 112 18v46c0 32-22 52-52 65C30 116 8 96 8 64V18z" fill="#f6c21c" stroke="#fff" stroke-width="5" stroke-linejoin="round"/><path d="M60 14 102 26v38c0 26-18 43-42 54-24-11-42-28-42-54V26z" fill="none" stroke="#2a1a5e" stroke-width="1.6"/></svg><div class="cv-badge-t">${badge.map((b, i) => `<span class="l${i}">${inl(b)}</span>`).join('')}</div></div>` : ''}
<div class="cv-main">${fm.level ? `<div class="cv-level">${inl(fm.level)}</div>` : ''}
<h1 class="t big${plainTitle(fm.title).length > 24 ? ' long' : ''}">${titleHtml}</h1>${fm.board ? `<div class="cv-board">${inl(fm.board)}</div>` : ''}</div>
<div class="cv-series">${s1 ? `<div class="s1">${inl(s1)}</div>` : ''}${s2 ? `<div class="s2">${inl(s2)}</div>` : ''}${fm.tagline ? `<div class="cv-tag">${inl(fm.tagline)}</div>` : ''}</div>`;
}

function renderPage(p) {
  p.problemsOut = [];
  const ctx = ctxFor(p);
  lintBlocks(p.tree, ctx);
  let body = renderTree(p.tree, ctx);
  const fm = p.fm;
  const tab = fm.tab || (isBook && p.chapter && ((mod.sections || {})[p.chapter] || {}).tab) || sec.tab;
  const title = String(fm.title || '').replace(/\[([^\]]+)\]/g, '\u0001$1\u0002');
  let titleHtml = renderInline(title, ctx).replaceAll('\u0001', '<span class="hlt">').replaceAll('\u0002', '</span>');
  let head = `<h1 class="t${fm.kind === 'cover' ? ' big' : ''}">${titleHtml}</h1>`;
  if (fm.subtitle) head += `<h1 class="t sub">${renderInline(fm.subtitle, ctx)}</h1>`;
  if (fm.kind === 'cover' && theme === 'cgp') head = coverHead(fm, titleHtml, ctx);
  const strip = fm.strip ? `<div class="strip"><b>${renderInline(fm.strip.head, ctx)}</b><span>${renderInline(fm.strip.text, ctx)}</span></div>` : '';
  if (!fm.strip && (fm.kind || 'content') === 'content') ctx.problems.push({ file: p.file, line: 1, msg: 'content page needs a strip: {head, text}' });
  if ((fm.kind || 'content') === 'content' && !ctx.warmups.length) ctx.problems.push({ file: p.file, line: 1, msg: 'content page has no :::warmup' });
  const footer = fm.footer || (theme === 'cgp' ? String(tab) : `${mod.title} · Section ${section.replace(/^s/, '')}`);
  p.html = `<section class="page${fm.kind === 'cover' ? ' cover' : ''}${theme === 'cgp' ? ' cgp' : ''}" data-tn="${p.num}" data-id="${esc(fm.id)}" data-kind="${esc(fm.kind || 'content')}" data-ch="${esc(p.chapter || '')}">
<div class="ph"><span class="tab">${renderInline(tab, ctx)}</span><span class="sec">${renderInline(fm.ref || '', ctx)}</span></div>
<div class="body">
${head}
${body}
</div>
${strip}<div class="pleft">${esc(footer)}</div><div class="pfoot">${p.num}</div>
</section>`;
  // Anatomy lint (cgp content topics): advisory checks that the spread has the parts a CGP spread has.
  p.anatomy = [];
  if (theme === 'cgp' && (fm.kind || 'content') === 'content') {
    const warn = msg => p.anatomy.push(msg);
    // Plain words only: each KaTeX formula (deeply nested spans) counts as one word.
    const noMath = h => {
      let out = '', i = 0;
      for (;;) {
        const k = h.indexOf('<span class="katex', i);
        if (k < 0) return out + h.slice(i);
        out += h.slice(i, k) + ' x ';
        let depth = 0, j = k;
        const re = /<(\/?)span\b[^>]*>/g; re.lastIndex = k;
        for (let m; (m = re.exec(h));) { depth += m[1] ? -1 : 1; j = re.lastIndex; if (!depth) break; }
        i = j;
      }
    };
    const text = h => noMath(h).replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&\w+;/g, ' ');
    const heads = [...body.matchAll(/<h2>([\s\S]*?)<\/h2>/g)].map(m => text(m[1]).trim());
    if (heads.length < 3) warn(`only ${heads.length} statement heading(s); a spread usually has 4–6`);
    for (const h of heads) {
      if (h.split(/\s+/).length < 4) warn(`heading "${h}" is a label, not a statement (write the takeaway as a sentence)`);
      if (!/<b>/.test(body.match(new RegExp('<h2>[\\s\\S]*?<\\/h2>', 'g')).find(x => text(x).trim() === h) || '<b>')) warn(`heading "${h}" has no **heavy** key words`);
    }
    if (!/class="figbox|class="fig"/.test(body)) warn('no figure anywhere in the topic');
    if (!/class="panel ex/.test(body)) warn('no worked example');
    if (!/class="exq"/.test(body)) warn('no exam question (::examq)');
    if (!/class="note/.test(body)) warn('no margin note');
    const bullets = (body.match(/<li>/g) || []).length, bold = (body.match(/<b>/g) || []).length;
    if (bullets && bold / bullets < 1) warn('few bolded key terms in the points');
  }
  p.warmups = ctx.warmups;
  p.report = { id: fm.id, num: p.num, file: p.file, chapter: p.chapter || undefined, title: plainTitle(fm.title), kind: fm.kind || 'content', anatomy: p.anatomy, blocks: ctx.blocks, citations: ctx.citations.map(c => c.raw), checks: ctx.checks, figs: ctx.figs, warmups: ctx.warmups.length, maths: ctx.mathCount || 0, rawHtml: ctx.rawBlocks || 0 };
  return ctx.problems;
}

// Two passes: the answers pages need every page's warm-ups.
pages.forEach(renderPage);
for (const p of pages) problems.push(...renderPage(p));

// Questions: every listed question needs an answer.
for (const q of questions.filter(q => q.section === section || (q._used && chapters.some(c => q._used.has(c))))) {
  if (q.answered && !q.answer && !q.answer_page) problems.push({ file: q._file, line: '?', msg: `question ${q.id} is marked answered but has no answer` });
  if (q.answer_page && !pageNum(q.answer_page)) problems.push({ file: q._file, line: '?', msg: `question ${q.id}: answer_page "${q.answer_page}" is not a page id` });
  for (const c of q.checks || []) if (!checkIds.has(c)) problems.push({ file: q._file, line: '?', msg: `question ${q.id}: check "${c}" has no test` });
}

// ---------- assemble ----------
const NM = path.join(ROOT, 'node_modules');
const b64 = f => fs.readFileSync(f).toString('base64');
const fontSpecs = [
  ['Baloo 2', 'baloo-2', [600, 700, 800], ['normal'], ['latin']],
  ['Source Sans 3', 'source-sans-3', [400, 600, 700], ['normal', 'italic'], ['latin', 'latin-ext', 'greek']],
  ['Caveat', 'caveat', [600, 700], ['normal'], ['latin']],
  ['JetBrains Mono', 'jetbrains-mono', [400, 700], ['normal'], ['latin', 'greek']],
];
const ranges = {
  latin: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
  'latin-ext': 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
  greek: 'U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF',
};
let fontCSS = '';
for (const [fam, pkg, weights, styles, subsets] of fontSpecs)
  for (const w of weights) for (const s of styles) for (const sub of subsets) {
    const f = path.join(NM, '@fontsource', pkg, 'files', `${pkg}-${sub}-${w}-${s}.woff2`);
    if (!fs.existsSync(f)) continue;
    fontCSS += `@font-face{font-family:'${fam}';font-style:${s};font-weight:${w};font-display:block;src:url(data:font/woff2;base64,${b64(f)}) format('woff2');unicode-range:${ranges[sub]}}\n`;
  }
let kcss = fs.readFileSync(path.join(NM, 'katex/dist/katex.min.css'), 'utf8');
kcss = kcss.replace(/src:url\(fonts\/([^)]+?\.woff2)\) format\("woff2"\)(,url\([^)]+\) format\("[^"]+"\))*/g,
  (m, f) => `src:url(data:font/woff2;base64,${b64(path.join(NM, 'katex/dist/fonts', f))}) format("woff2")`);
if (/url\(fonts\//.test(kcss)) problems.push({ file: 'theme', line: '?', msg: 'KaTeX CSS still references external fonts (inlining regex out of date)' });

const nav = pages.filter(p => p.fm.nav !== false).map(p => `<a href="#t-${esc(p.fm.id)}">${esc(p.fm.nav || p.fm.short || plainTitle(p.fm.title))}</a>`).join('');
const tpl = fs.readFileSync(path.join(ROOT, 'theme', 'template.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'theme', 'style.css'), 'utf8') + (theme === 'cgp' ? '\n' + fs.readFileSync(path.join(ROOT, 'theme', 'cgp.css'), 'utf8') : '');
const sname = isBook ? 'Textbook' : /^l\d+$/.test(section) ? `Lecture ${+section.slice(1)}` : `Section ${section.replace(/^s/, '')}`;
const html = tpl.replace('{{TITLE}}', esc(`${mod.title} — ${sname} Revision Guide`)).replace('{{BAR}}', esc(`${mod.title} · ${sname}`)).replace('{{NAV}}', nav)
  .replace('/*FONTS*/', () => fontCSS).replace('/*KATEX*/', () => kcss).replace('/*STYLE*/', () => css).replace('<!--PAGES-->', () => pages.map(p => p.html).join('\n')).replace('<body>', `<body class="theme-${theme}${layout === 'pages' ? ' layout-pages' : ''}">`);
const htmlPath = path.join(OUT, 'guide.html');
fs.writeFileSync(htmlPath, html);
console.log(`built ${pages.length} pages → ${path.relative(ROOT, htmlPath)} (${(html.length / 1048576).toFixed(2)} MB)`);

// ---------- render: overflow, screenshots, PDF ----------
const pdfPath = path.join(OUT, 'guide.pdf');
const { sheets, span } = await printGuide(htmlPath, { pdf: flags.has('--no-pdf') ? null : pdfPath, shotsDir: flags.has('--no-shots') ? null : path.join(OUT, 'shots'), only });
for (const p of pages) {
  const [a, b] = span[p.fm.id] || [];
  p.report.sheets = a ? Array.from({ length: b - a + 1 }, (_, k) => a + k) : [];
}
for (const r of sheets) {
  if (!r.overflow) continue;
  const p = pages.find(q => q.fm.id === r.topics[r.topics.length - 1]) || pages[0];
  problems.push({ file: p.file, line: '-', msg: `sheet ${r.sheet} OVERFLOWS by ${r.worst}px (a single block taller than an A4 sheet, or too wide) — culprit: ${r.culprit}` });
}

// A topic page must be full (decision 0008): the writer fits the text to the sheet. More than GAP_MAX px unused on a
// content sheet is a problem in a chapter build. (The book build only reports it: the chapter is where it is fixed.)
const GAP_MAX = 70;
const kindOf = id => ((pages.find(q => q.fm.id === id) || {}).fm || {}).kind || 'content';
const fit = [];
if (theme === 'cgp' && layout === 'pages') {
  const content = pages.filter(p => (p.fm.kind || 'content') === 'content' && p.report.sheets.length);
  for (const p of content) {
    const mine = p.report.sheets.map(k => sheets[k - 1]);
    const lines = [];
    mine.forEach((r, k) => {
      const lastOfTopic = k === mine.length - 1;
      let verdict = 'full';
      if (r.overflow) verdict = `OVERFLOWS by ${r.worst}px: cut that much`;
      else if (lastOfTopic && mine.length > 1 && r.free > 0.5 * r.height) verdict = `SPILL: only ${r.height - r.free}px of the topic is on this sheet. Cut ${r.height - r.free}px from the topic so it ends on the sheet before, or add ${r.free}px so this sheet is full`;
      else if (r.free > GAP_MAX) verdict = `GAP: ${r.free}px blank (about ${Math.round(r.free / 19)} lines of text). ${lastOfTopic ? 'Add that much to the topic' : 'The next block did not fit here: move a smaller block up, shorten the block that moved on, or put ::pagebreak earlier and fill both sheets'}`;
      lines.push(`  p.${r.sheet} (sheet ${k + 1} of ${mine.length}): free ${r.free}px of ${r.height}px — ${verdict}`);
      lines.push('      blocks: ' + r.blocks.map(b => `${b.what} ${b.h}px${b.float ? ' (beside the next block)' : ''}`).join(' | '));
      if (!isBook && !r.overflow && r.free > GAP_MAX) problems.push({ file: p.file, line: '-', msg: `sheet ${r.sheet} is not full: ${r.free}px blank at the foot (limit ${GAP_MAX}px). Fit the topic to whole pages (see the FIT report)` });
    });
    if (mine.length > 3) problems.push({ file: p.file, line: '-', msg: `topic takes ${mine.length} sheets: a topic is one or two pages (three at most). Split it into two topics or cut it` });
    fit.push(`${p.fm.id} — ${mine.length} sheet(s)\n${lines.join('\n')}`);
  }
}

// ---------- book integrity: structure, then the PDF read back ----------
let integrity;
if (isBook) {
  const checked = [], bad = [];
  const lec = c => bk.included.find(x => x.id === c).lecture;
  const body = pages.filter(p => p.chapter && p.fm.kind !== 'answers'), ans = pages.filter(p => p.fm.kind === 'answers');
  const inOrder = list => list.every((p, i) => i === 0 || lec(list[i - 1].chapter) <= lec(p.chapter));
  if (!inOrder(body)) bad.push('chapters are not in lecture order');
  if (!inOrder(ans)) bad.push('answers pages are not in lecture order');
  for (const c of chapters) if (!body.some(p => p.chapter === c)) bad.push(`chapter ${c} has no content pages`);
  for (const p of ans) if (!chapters.includes(p.chapter)) bad.push(`answers page ${p.fm.id} belongs to no chapter in the book`);
  const used = new Set(pages.flatMap(p => p.report.sheets));
  for (let k = 1; k <= sheets.length; k++) if (!used.has(k)) bad.push(`sheet ${k} belongs to no topic`);
  let prevEnd = 0;
  for (const p of pages) { const a = p.report.sheets[0]; if (a && a < prevEnd) bad.push(`${p.fm.id} starts on p.${a}, before the previous topic ends`); if (a) prevEnd = p.report.sheets[p.report.sheets.length - 1]; }
  checked.push(`${chapters.length} chapters in lecture order (${chapters.map(c => 'Lecture ' + lec(c)).join(', ')}), answers in the same order`);
  if (!flags.has('--no-pdf') && !only) {
    const range = ids => { const s = ids.flatMap(i => span[i] || []); const a = Math.min(...s), b = Math.max(...s); return a === b ? String(a) : `${a}–${b}`; };
    const sheetsOf = id => (pages.find(p => p.fm.id === id) || { report: { sheets: [] } }).report.sheets;
    const cPage = pages.find(p => /^::contents\s*$/m.test(p.src)), ePage = pages.find(p => /^::edition\s*$/m.test(p.src));
    const expect = {
      sheets: sheets.length,
      pages: pages.map(p => ({ id: p.fm.id, title: p.report.title, kind: p.report.kind, chapter: p.chapter, sheets: p.report.sheets })),
      contents: cPage ? { sheets: sheetsOf(cPage.fm.id), rows: expectContents.map(r => (r.heading ? r : { range: range(r.ids), label: r.label })) } : null,
      edition: ePage ? { sheets: sheetsOf(ePage.fm.id), rows: expectEdition.map(r => ({ lecture: r.lecture, title: r.title, range: range(r.ids) })) } : null,
    };
    if (!cPage) bad.push('the book has no contents page (::contents)');
    const ef = path.join(OUT, 'expect.json');
    fs.writeFileSync(ef, JSON.stringify(expect, null, 1));
    try {
      const r = JSON.parse(execFileSync(py, [path.join(ROOT, 'tools', 'lib', 'bookcheck.py'), pdfPath, ef], { encoding: 'utf8' }));
      checked.push(...r.checked); bad.push(...r.problems);
    } catch (e) { bad.push('could not read the PDF back: ' + String(e.message).split('\n')[0]); }
  }
  integrity = { checked, problems: bad, held: bk.held.map(c => ({ id: c.id, lecture: c.lecture, why: c.why })) };
  for (const b of bad) problems.push({ file: `out/${module}/book/guide.pdf`, line: '-', msg: 'BOOK CHECK: ' + b });
  console.log(`\nBOOK CHECK: ${bad.length ? bad.length + ' problem(s)' : 'ok'}\n` + checked.map(c => '  ✓ ' + c).join('\n'));
}

// ---------- report ----------
const report = {
  module, section, built: new Date().toISOString(), layout, sheets: sheets.map(r => ({ sheet: r.sheet, free: r.free, height: r.height, topics: r.topics })), chapters: isBook ? chapters : undefined, integrity, pages: pages.map(p => p.report),
  problems, errata_for: JSON.stringify(errata.filter(e => (e.sections || []).includes(section))), checks_known: [...checkIds], questions: questions.filter(q => q.section === section || (q._used && q._used.has(section))).map(q => ({ id: q.id, page: q._page, checks: [...new Set([...(q.checks || []), ...(q._answerChecks || [])])] })),
};
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
for (const r of sheets) console.log(`p.${String(r.sheet).padEnd(3)} ${r.overflow ? 'OVERFLOW' : 'ok      '} free ${String(r.free).padStart(4)}px  ${r.topics.join(', ')}`);
if (fit.length && !isBook) console.log(`\nFIT (every topic sheet must be full: at most ${GAP_MAX}px free; body text is about 19px a line, 13 words a line):\n` + fit.join('\n'));
const anat = pages.flatMap(p => (p.anatomy || []).map(w => `  ${p.file}  ${w}`));
if (anat.length) console.log(`\nANATOMY (advisory): ${anat.length} note(s)\n` + anat.join('\n'));
if (problems.length) {
  console.log(`\nLINT: ${problems.length} problem(s)`);
  for (const pr of problems) console.log(`  ${pr.file}:${pr.line}  ${pr.msg}`);
  process.exitCode = 1;
} else console.log('\nLINT: clean');
if (!flags.has('--no-pdf')) console.log(`PDF → ${path.relative(ROOT, pdfPath)}`);
