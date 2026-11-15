// Local GUI: a bookshelf (one textbook per module), a book page (the lecture list as a live contents page) and a
// review page (what is new since the last release, notes on pages, release). Two buttons do work: Update
// (tools/update) and Release (tools/release <m> book). Everything else is read from the files the tools write.
// Usage: tools/gui [--port 4747] [--no-open]. Listens on 127.0.0.1 only.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn, execFile, execFileSync } from 'node:child_process';
import YAML from 'yaml';
import { ROOT } from './lib/cite.mjs';
import { loadLedger, pageContext, blocking } from './lib/verifyctx.mjs';
import { loadModule, loadTimeline, bookChapters, bookPages, changesSinceRelease, lastRelease, loadFeedback, saveFeedback } from './lib/book.mjs';

const args = process.argv.slice(2);
const PORT = +(args.includes('--port') ? args[args.indexOf('--port') + 1] : 4747);
const exists = f => fs.existsSync(f);
const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const readIf = f => (exists(f) ? read(f) : null);
const mtime = f => (exists(f) ? fs.statSync(f).mtimeMs : 0);
const pad = n => String(n).padStart(2, '0');

// The page (gui.html) is read from disk on every request, so a server started before a code change would serve a
// new page with old data. The server therefore exits with code 75 when its own code changes; tools/gui restarts it.
const CODE = ['tools/gui.mjs', 'tools/lib/book.mjs', 'tools/lib/verifyctx.mjs', 'tools/lib/cite.mjs'].map(f => path.join(ROOT, f));
const codeStamp = () => Math.max(...CODE.map(mtime));
const startedWith = codeStamp();

// ---------- status ----------
const lecAt = {};
function refreshTimeline(m) {
  if (!exists(path.join(ROOT, 'modules', m, 'lectures.yaml'))) return;
  if ((job && job.code === undefined) || Date.now() - (lecAt[m] || 0) < 60000) return;
  lecAt[m] = Date.now();
  try { execFileSync(path.join(ROOT, 'tools', 'lectures'), [m], { stdio: 'ignore', timeout: 30000 }); } catch { /* keep the last file */ }
}

const shotsOf = (m, p) => p.sheets.map((s, k) => ({ sheet: s, url: `/out/${m}/book/shots/p${pad(p.num)}${k ? '-' + (k + 1) : ''}.png` }));

function coverageOf(m, n) {
  const c = readIf(path.join(ROOT, 'out', m, 'coverage', `L${pad(n)}.json`));
  if (!c) return null;
  const pick = st => c.slides.filter(s => st.includes(s.status)).map(s => ({ cite: s.cite, title: s.title || '' }));
  const shown = c.slides.filter(s => ['covered', 'unclear', 'brief'].includes(s.status)).length;
  // Slides are progressive builds, so time is counted per slide group and the group's first title is shown.
  const groups = new Map();
  for (const s of c.slides) if (s.group_seconds && !groups.has(s.group)) groups.set(s.group, { title: s.title || s.cite, cite: s.cite, seconds: s.group_seconds });
  const longest = [...groups.values()].sort((a, b) => b.seconds - a.seconds).slice(0, 3);
  return { minutes: c.minutes, method: c.method, total: c.slides.length, shown, skipped: pick(['skipped', 'not seen']), brief: pick(['brief']), longest };
}

// The batch writer (tools/batch): which lectures it is writing right now, and at which step.
function batchState() {
  let alive = false;
  try { execFileSync('pgrep', ['-f', 'overnight/run.mjs'], { stdio: 'ignore' }); alive = true; } catch { /* not running */ }
  if (!alive) return {};
  const dir = path.join(ROOT, 'out', 'overnight');   // one state file per runner (state.json, state-<tag>.json)
  return Object.assign({}, ...fs.readdirSync(dir).filter(f => /^state(-[\w]+)?\.json$/.test(f)).map(f => readIf(path.join(dir, f)) || {}));
}

function moduleStatus(m, batch = {}) {
  const mod = loadModule(m);
  refreshTimeline(m);
  const t = loadTimeline(m);
  const ledger = loadLedger(m);
  const bk = bookChapters(m, mod);
  const book = mod.book ? bookPages(m, mod) : null;
  const pdf = exists(path.join(ROOT, 'out', m, 'book', 'guide.pdf'));
  const last = lastRelease(m);
  const changes = book ? changesSinceRelease(m, book) : [];
  const changeOf = Object.fromEntries(changes.map(c => [c.id, c.change]));
  const notes = loadFeedback(m);

  const lectures = (t ? t.lectures : []).map(L => {
    const ch = bk.all.find(c => c.id === L.chapter);
    const inBook = !!(ch && book && book.chapters.includes(ch.id));
    const pages = inBook ? book.pages.filter(p => p.chapter === ch.id) : [];
    const body = pages.filter(p => p.kind !== 'answers').flatMap(p => p.sheets);
    let status, label, why = '';
    const b = batch[`${m}-${L.chapter || 'l' + pad(L.n)}`];
    if (b && b.status === 'running') { status = 'writing'; label = 'Being written'; why = `Claude is writing this chapter now (step: ${b.waiting || b.stage}).`; }
    else if (inBook && ch.finished) { status = 'in'; label = 'In the book'; }
    else if (ch && ch.why !== 'Not written yet.') { status = 'held'; label = inBook ? 'Needs attention' : 'Written, held back'; why = ch.why; }
    else if (L.examinable === false) { status = 'skip'; label = 'Not examinable'; }
    else if (!L.happened) { status = 'upcoming'; label = 'Not given yet'; }
    else if (L.state === 'waiting for materials') { status = 'waiting'; label = 'Waiting for materials'; why = (L.next || '').replace(/: re-harvest.*$/, '.'); }
    else { status = 'ready'; label = 'Ready to write'; }
    const mine = ch ? ledger.issues.filter(i => ch.pages.some(p => p.id === i.page)) : [];
    return {
      n: L.n, title: L.title, date: L.date, delivery: L.delivery, note: L.note || null, status, label, why,
      range: body.length ? [Math.min(...body), Math.max(...body)] : null,
      topics: pages.map(p => ({ id: p.id, title: p.title, kind: p.kind, sheets: p.sheets, change: changeOf[p.id] || null })),
      coverage: coverageOf(m, L.n), exam: L.exam || [], extra: L.extra || [], errata: L.errata || [],
      checker: ch && ch.topics ? {
        pages: ch.topics, verified: ch.verified, found: mine.length, fixed: mine.filter(i => i.status === 'fixed').length, waived: mine.filter(i => i.status === 'waived').length,
        open: mine.filter(i => i.status === 'open').length,
        majors: mine.filter(i => i.severity !== 'minor').map(i => ({ quote: i.quote, says: i.source_says, done: i.resolution || null, status: i.status })),
      } : null,
    };
  });

  // Why the book cannot be released right now (tools/release checks all of this again, properly).
  const blockers = [];
  const checks = readIf(path.join(ROOT, 'out', m, 'checks.json'));
  if (!mod.book) blockers.push('This module has no book yet.');
  else if (!book || !pdf) blockers.push('The book has not been built yet: press Update.');
  else {
    const stale = bk.included.map(c => c.id).join() !== book.chapters.join() || bk.included.some(c => Date.parse(c.built) > Date.parse(book.built));
    if (stale) blockers.push('Chapters have changed since the book was built: press Update.');
    for (const p of book.problems) blockers.push(p.msg);
    const br = read(path.join(ROOT, 'out', m, 'book', 'report.json'));
    const front = br.pages.filter(p => !p.chapter).filter(p => { try { return !(ledger.pages[p.id] && ledger.pages[p.id].hash === pageContext(m, br, p).hash); } catch { return true; } });
    if (front.length) blockers.push(`The book's front pages (${front.map(p => p.title).join(', ')}) have not been checked at their current version: press Update.`);
    if (ledger.issues.some(i => blocking(i) && br.pages.some(p => p.id === i.page))) blockers.push('A major issue from the checker is still open.');
    for (const c of last ? last.chapters.filter(c => !book.chapters.includes(c)) : []) blockers.push(`Lecture ${+c.slice(1)} was in the last release but is held back now.`);
    if (checks && Object.values(checks.results).some(r => !r.ok)) blockers.push('Some maths or code checks are failing.');
    if (!blockers.length && last && !changes.length) blockers.push('Nothing has changed since the last release.');
  }

  const count = s => lectures.filter(L => L.status === s).length;
  return {
    id: m, title: mod.title, layout: mod.book && mod.book.layout === 'flow' ? 'flow' : 'pages', builtLayout: (readIf(path.join(ROOT, 'out', m, 'book', 'report.json')) || {}).layout || 'pages', bookTitle: (mod.book && mod.book.title) || mod.title.replace(/^IB\s+/, ''), year: mod.year || '',
    book: book && pdf ? { sheets: book.sheets, built: book.built, pdf: `/out/${m}/book/guide.pdf`, cover: exists(path.join(ROOT, 'out', m, 'book', 'shots', 'p01.png')) ? `/out/${m}/book/shots/p01.png` : null,
      checked: (book.integrity || {}).checked || [], problems: book.problems.map(p => p.msg) } : null,
    counts: { total: lectures.length, in: count('in'), held: count('held'), writing: count('writing'), ready: count('ready'), waiting: count('waiting'), upcoming: count('upcoming') },
    lectures,
    release: { last: last ? { released: last.released, sheets: last.sheets, chapters: last.chapters.length, dest: last.dest } : null, blockers, dest: `${mod.drive_folder || ''}/${(mod.book || {}).pdf_name || m + '_Textbook.pdf'}`,
      changes: changes.map(c => ({ id: c.id, title: c.title, change: c.change, kind: c.kind, lecture: +String(c.chapter).slice(1), shots: shotsOf(m, c) })) },
    notes, update: readIf(path.join(ROOT, 'out', m, 'update.json')),
  };
}

let cache = { at: 0, body: null };
function status() {
  if (Date.now() - cache.at < 2500 && cache.body) return { ...cache.body, job: jobInfo() };
  const modules = [], batch = batchState();
  for (const m of fs.readdirSync(path.join(ROOT, 'modules')).sort()) {
    if (!exists(path.join(ROOT, 'modules', m, 'module.yaml'))) continue;
    try { modules.push(moduleStatus(m, batch)); } catch (e) { modules.push({ id: m, title: m, error: e.message }); }
  }
  cache = { at: Date.now(), body: { modules } };
  return { modules, job: jobInfo() };
}

// ---------- one job at a time ----------
let job = null;
const ACTIONS = {
  update: m => ['update', [m]],
  release: m => ['release', [m, 'book']],
  layout: m => ['build', [m, 'book']],
};
// The book's layout, kept in module.yaml (`book.layout`); comments in the file are preserved.
function setLayout(m, layout) {
  const f = path.join(ROOT, 'modules', m, 'module.yaml');
  const doc = YAML.parseDocument(fs.readFileSync(f, 'utf8'));
  if (!doc.has('book')) throw new Error('this module has no book yet');
  doc.setIn(['book', 'layout'], layout);   // 'pages' is the default when the key is absent (decision 0008)
  fs.writeFileSync(f, doc.toString({ lineWidth: 0, flowCollectionPadding: false }));
}
function jobInfo(since = 0) {
  if (!job) return null;
  return { title: job.title, action: job.action, module: job.module, running: job.code === undefined, code: job.code, started: job.started, ended: job.ended, log: job.log.slice(since), size: job.log.length };
}
function startJob(action, m) {
  if (job && job.code === undefined) throw new Error('a job is already running');
  if (Object.entries(batchState()).some(([k, s]) => k.startsWith(m + '-') && s.status === 'running')) throw new Error('Claude is writing a chapter of this book right now: wait until it has finished');
  if (!/^[\w-]+$/.test(m || '') || !exists(path.join(ROOT, 'modules', m, 'module.yaml'))) throw new Error('bad module');
  const [cmd, a] = ACTIONS[action](m);
  job = { title: `tools/${cmd} ${a.join(' ')}`, action, module: m, log: '', started: new Date().toISOString(), code: undefined };
  const add = d => { job.log += d; if (job.log.length > 2e6) job.log = job.log.slice(-1e6); };
  const ch = spawn(path.join(ROOT, 'tools', cmd), a, { cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  job.child = ch;
  ch.stdout.on('data', add); ch.stderr.on('data', add);
  ch.on('close', code => { job.code = code ?? 'stopped'; job.ended = new Date().toISOString(); cache.at = 0; add(`\n[finished: ${code === 0 ? 'ok' : `exit ${code ?? 'stopped'}`}]\n`); });
}

// ---------- http ----------
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const server = http.createServer((req, res) => {
  // Only this machine, only this page: reject other Host names (DNS rebinding) and POSTs without our header (CSRF).
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host || '')) return send(res, 403, 'forbidden', 'text/plain');
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST') {
    if (req.headers['x-guide'] !== '1') return send(res, 403, 'forbidden', 'text/plain');
    let body = '';
    req.on('data', d => (body += d));
    req.on('end', () => {
      try {
        const b = JSON.parse(body || '{}');
        const okMod = () => { if (!/^[\w-]+$/.test(b.module || '') || !exists(path.join(ROOT, 'modules', b.module, 'module.yaml'))) throw new Error('bad module'); };
        if (url.pathname === '/api/run') { if (!ACTIONS[b.action]) throw new Error('unknown action'); startJob(b.action, b.module); return send(res, 200, { ok: true }); }
        if (url.pathname === '/api/layout') { // choose the book's layout, then rebuild the book (no chapter is rewritten or rechecked)
          okMod();
          if (!['flow', 'pages'].includes(b.layout)) throw new Error('unknown layout');
          if (job && job.code === undefined) throw new Error('a job is already running');
          const was = (loadModule(b.module).book || {}).layout === 'flow' ? 'flow' : 'pages';
          setLayout(b.module, b.layout);
          try { startJob('layout', b.module); } catch (e) { setLayout(b.module, was); throw e; }
          cache.at = 0;
          return send(res, 200, { ok: true });
        }
        if (url.pathname === '/api/stop') { if (job && job.code === undefined) process.kill(-job.child.pid, 'SIGTERM'); return send(res, 200, { ok: true }); }
        if (url.pathname === '/api/note') { // a note on a page, for Claude to read at the next update
          okMod();
          const text = String(b.text || '').trim().slice(0, 4000);
          if (!text) throw new Error('empty note');
          const notes = loadFeedback(b.module);
          notes.push({ id: 'n' + Date.now().toString(36), date: new Date().toISOString().slice(0, 10), page: /^[\w-]+$/.test(b.page || '') ? b.page : null, sheet: Number.isInteger(b.sheet) ? b.sheet : null, title: String(b.title || '').slice(0, 200), note: text, status: 'open' });
          saveFeedback(b.module, notes); cache.at = 0;
          return send(res, 200, { ok: true });
        }
        if (url.pathname === '/api/note-remove') { // only notes that are still open (nothing has been done about them)
          okMod();
          saveFeedback(b.module, loadFeedback(b.module).filter(n => !(n.id === b.id && n.status === 'open'))); cache.at = 0;
          return send(res, 200, { ok: true });
        }
        if (url.pathname === '/api/reveal') { // show the released PDF in Finder
          okMod();
          const last = lastRelease(b.module);
          if (last && exists(last.dest)) execFile('open', ['-R', last.dest]);
          return send(res, 200, { ok: true });
        }
        if (url.pathname === '/api/quit') { send(res, 200, { ok: true }); return setTimeout(() => process.exit(0), 50); } // a newer tools/gui is taking over the port
        send(res, 404, { error: 'not found' });
      } catch (e) { send(res, 400, { error: e.message }); }
    });
    return;
  }
  if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
  if (url.pathname === '/') return send(res, 200, fs.readFileSync(path.join(ROOT, 'tools', 'gui.html')), 'text/html; charset=utf-8');
  if (url.pathname === '/api/status') {
    if (codeStamp() !== startedWith && !(job && job.code === undefined)) { send(res, 503, { restarting: true }); return setTimeout(() => process.exit(75), 50); }
    try { return send(res, 200, status()); } catch (e) { return send(res, 500, { error: e.message }); }
  }
  if (url.pathname === '/api/job') return send(res, 200, jobInfo(+(url.searchParams.get('since') || 0)) || {});
  const f = url.pathname.match(/^\/out\/([\w-]+)\/book\/(guide\.pdf|shots\/p\d+(?:-\d+)?\.png)$/);
  if (f) {
    const file = path.join(ROOT, 'out', f[1], 'book', f[2]);
    if (!exists(file)) return send(res, 404, 'not built yet', 'text/plain');
    res.writeHead(200, { 'Content-Type': f[2].endsWith('pdf') ? 'application/pdf' : 'image/png', 'Cache-Control': 'no-store' });
    return fs.createReadStream(file).pipe(res);
  }
  send(res, 404, 'not found', 'text/plain');
});

let tries = 0;
server.on('error', async e => {
  if (e.code !== 'EADDRINUSE' || tries++ > 3) { console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is in use by something that is not this GUI. Try: tools/gui --port ${PORT + 1}` : e.message); process.exit(1); }
  // An older copy of this GUI has the port: ask it to quit, then take over.
  try { await fetch(`http://127.0.0.1:${PORT}/api/quit`, { method: 'POST', headers: { 'X-Guide': '1', 'Content-Type': 'application/json' }, body: '{}' }); } catch { /* not ours, or already gone */ }
  setTimeout(() => server.listen(PORT, '127.0.0.1'), 400);
});
server.on('listening', () => {
  const u = `http://127.0.0.1:${PORT}/`;
  console.log(`Textbooks GUI: ${u}  (Ctrl-C to stop)`);
  if (!args.includes('--no-open')) execFile('open', [u]);
});
server.listen(PORT, '127.0.0.1');
