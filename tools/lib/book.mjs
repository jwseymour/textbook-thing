// The module textbook (decision 0004): which chapters are finished and so belong in the book, what the book's
// pages are, and what has changed since the last release. Shared by tools/build, tools/release, tools/update, tools/gui.
//
// There is no hand-kept chapter list. A chapter is a section `l<nn>` in module.yaml. It is in the book when it is
// FINISHED: built from its current content, lint clean, its lecture's coverage gate passed, every page verified at
// its current version and no open major verifier issue. Chapters go in lecture order.
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { ROOT } from './cite.mjs';
import { loadLedger, pageContext, blocking, sha } from './verifyctx.mjs';

const exists = f => fs.existsSync(f);
const readJson = f => (exists(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
const mtime = f => (exists(f) ? fs.statSync(f).mtimeMs : 0);
const newest = dir => (exists(dir) ? Math.max(0, ...fs.readdirSync(dir).map(f => mtime(path.join(dir, f)))) : 0);

export function loadModule(m) { return YAML.parse(fs.readFileSync(path.join(ROOT, 'modules', m, 'module.yaml'), 'utf8')); }
export function loadTimeline(m) { return readJson(path.join(ROOT, 'out', m, 'lectures.json')); }
export const lectureOf = (id, sec) => (sec && sec.lecture != null ? +sec.lecture : /^l\d+$/.test(id) ? +id.slice(1) : null);

// Every chapter section, in lecture order.
export function chapterSections(mod) {
  return Object.entries(mod.sections || {})
    .filter(([id, sec]) => /^l\d+$/.test(id) && !(sec && sec.prototype))
    .map(([id, sec]) => ({ id, lecture: lectureOf(id, sec), title: (sec && sec.title) || id }))
    .sort((a, b) => a.lecture - b.lecture);
}

// What a chapter's completeness review (tools/omissions) was run against: the units linked to its lecture and what the
// lecture covered. When this changes (a new paper, new notes, new coverage) the chapter is reviewed again.
export function omissionsBasis(m, n) {
  const ev = readJson(path.join(ROOT, 'out', m, 'evidence.json')) || { lectures: {} };
  const cov = readJson(path.join(ROOT, 'out', m, 'coverage', `L${String(n).padStart(2, '0')}.json`)) || { slides: [] };
  const v = (fs.readFileSync(path.join(ROOT, 'tools', 'omissions_prompt.md'), 'utf8').match(/^<!-- version (\d+)/) || [])[1];
  const units = (ev.lectures[String(n)] || []).filter(r => r.how !== 'unconfirmed' && r.kind !== 'talk').map(r => r.unit).sort();
  return sha(JSON.stringify({ v, units, cov: cov.slides.map(r => [r.cite, r.status]) })).slice(0, 16);
}

// Where one chapter stands. `why` is one plain sentence when it is not finished.
export function chapterState(m, mod, id, { ledger = loadLedger(m), timeline = loadTimeline(m) } = {}) {
  const MOD = path.join(ROOT, 'modules', m);
  const sec = (mod.sections || {})[id] || {};
  const st = { id, lecture: lectureOf(id, sec), title: sec.title || id, built: null, stale: false, lint: 0, topics: 0, sheets: 0, verified: 0, unverified: [], major: 0, minor: 0, gateMissing: [], pages: [], complete: false, finished: false, why: '' };
  const drafted = exists(path.join(MOD, 'content', id)) && fs.readdirSync(path.join(MOD, 'content', id)).some(f => f.endsWith('.md'));
  if (!drafted) { st.why = 'Not written yet.'; return st; }
  const r = readJson(path.join(ROOT, 'out', m, id, 'report.json'));
  if (!r) { st.why = 'Written but not built yet.'; return st; }
  st.built = r.built;
  // Stale = this chapter's own files changed since its build: its pages, its questions and figures file, and its own
  // entries in the shared errata list. (Another chapter of the module being written must not mark this one as edited.)
  const own = [newest(path.join(MOD, 'content', id)), mtime(path.join(MOD, 'questions', id + '.yaml')), mtime(path.join(MOD, 'figures', id + '.py')),
    ...(exists(path.join(MOD, 'figures', 'static')) ? fs.readdirSync(path.join(MOD, 'figures', 'static')).filter(f => f.startsWith(id + '_')).map(f => mtime(path.join(MOD, 'figures', 'static', f))) : [])];
  let errataChanged = false;
  if (r.errata_for !== undefined && mtime(path.join(MOD, 'errata.yaml')) > Date.parse(r.built)) {
    const es = (YAML.parse(fs.readFileSync(path.join(MOD, 'errata.yaml'), 'utf8')) || []).filter(e => (e.sections || []).includes(id));
    errataChanged = JSON.stringify(es) !== r.errata_for;
  }
  st.stale = Math.max(0, ...own) > Date.parse(r.built) || errataChanged;
  st.lint = r.problems.length;
  st.topics = r.pages.length;
  st.sheets = new Set(r.pages.flatMap(p => p.sheets || [])).size;
  for (const p of r.pages) {
    let hash = null;
    try { hash = pageContext(m, r, p).hash; } catch { /* page file or source index missing */ }
    const ok = !!(hash && ledger.pages[p.id] && ledger.pages[p.id].hash === hash);
    if (ok) st.verified++; else st.unverified.push(p.id);
    st.pages.push({ id: p.id, title: p.title, kind: p.kind, hash, verified: ok });
  }
  const mine = ledger.issues.filter(i => r.pages.some(p => p.id === i.page));
  st.major = mine.filter(blocking).length;
  st.minor = mine.filter(i => i.status === 'open').length - st.major;
  const L = timeline && timeline.lectures.find(l => l.chapter === id);
  st.gateMissing = (L && L.gate && L.gate.missing) || [];
  const om = (ledger.omissions || {})[id];
  st.complete = !!(L && om && om.basis === omissionsBasis(m, L.n));   // reviewed for completeness against the current evidence
  const n = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`;
  st.why = st.stale ? 'Edited since it was last built.'
    : st.lint ? `${n(st.lint, 'problem')} found by the build.`
    : st.gateMissing.length ? `${n(st.gateMissing.length, 'slide group')} the lecture covered ${st.gateMissing.length === 1 ? 'is' : 'are'} not in the chapter yet.`
    : st.major ? `${n(st.major, 'major issue')} from the checker still to fix.`
    : st.unverified.length ? `${n(st.unverified.length, 'page')} not checked yet at ${st.unverified.length === 1 ? 'its' : 'their'} current version.`
    : !st.complete ? (om ? 'The course material on this lecture has changed since the chapter was checked for gaps.' : 'Not yet checked for things the lecture covered that the chapter leaves out.')
    : '';
  st.finished = !st.why;
  return st;
}

// The chapters that go in the book (finished, lecture order) and the ones that are written but held back.
export function bookChapters(m, mod = loadModule(m)) {
  const ledger = loadLedger(m), timeline = loadTimeline(m);
  const all = chapterSections(mod).map(c => chapterState(m, mod, c.id, { ledger, timeline }));
  return { all, included: all.filter(c => c.finished), held: all.filter(c => !c.finished && c.why !== 'Not written yet.') };
}

// ---------- releases ----------
// modules/<m>/releases.json (committed): one record per release, with a version hash for every chapter page, so
// the GUI can show exactly which pages are new or changed since the edition that is on Drive.
export function releasesPath(m) { return path.join(ROOT, 'modules', m, 'releases.json'); }
export function loadReleases(m) { return readJson(releasesPath(m)) || []; }
export function lastRelease(m) { const r = loadReleases(m); return r.length ? r[r.length - 1] : null; }

// The built book: its pages with the sheets they are printed on and a version hash (chapter pages only).
export function bookPages(m, mod = loadModule(m)) {
  const r = readJson(path.join(ROOT, 'out', m, 'book', 'report.json'));
  if (!r) return null;
  const states = Object.fromEntries((r.chapters || []).map(c => [c, chapterState(m, mod, c)]));
  const pages = r.pages.map(p => {
    const cp = p.chapter && states[p.chapter] ? states[p.chapter].pages.find(x => x.id === p.id) : null;
    return { id: p.id, num: p.num, title: p.title, kind: p.kind, chapter: p.chapter || null, sheets: p.sheets || [], hash: cp ? cp.hash : null };
  });
  return { built: r.built, chapters: r.chapters || [], problems: r.problems, integrity: r.integrity || null, pages, sheets: new Set(pages.flatMap(p => p.sheets)).size };
}

// Chapter pages that are new or changed compared with the last release (all of them if never released).
export function changesSinceRelease(m, book = bookPages(m)) {
  if (!book) return [];
  const last = lastRelease(m);
  const out = [];
  for (const p of book.pages) {
    if (!p.chapter) continue;
    const was = last && last.pages[p.id];
    if (!was) out.push({ ...p, change: 'new' });
    else if (was !== p.hash) out.push({ ...p, change: 'changed' });
  }
  return out;
}

// ---------- feedback ----------
// modules/<m>/feedback.yaml: notes the reader leaves on pages in the GUI. Claude reads the open ones at the start of an update.
export function feedbackPath(m) { return path.join(ROOT, 'modules', m, 'feedback.yaml'); }
export function loadFeedback(m) { return exists(feedbackPath(m)) ? YAML.parse(fs.readFileSync(feedbackPath(m), 'utf8')) || [] : []; }
export function saveFeedback(m, notes) {
  fs.writeFileSync(feedbackPath(m), '# Notes left on pages in the GUI. `status: open` ones are waiting for Claude; set `done` (with `reply`) when dealt with.\n' + YAML.stringify(notes));
}
