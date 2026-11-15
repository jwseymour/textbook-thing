// Bring a module's textbook up to date. Does every step that does not need Claude to write:
//   1. sources     tools/ingest (re-fetches the public files; Raven files and recordings need the harvest, which Claude drives)
//   2. lectures    which lectures have happened; coverage (which slides the lecture really showed) for new ones
//   3. evidence    every other unit of the sources is linked to its lecture (a fresh Claude places what the text match
//                  cannot); the source audit says what the harvest has that the module does not use; dossiers rewritten
//   4. chapters    maths checks, then build every written chapter
//   5. checking    the independent verifier on pages that are new or changed (uses Claude; only those pages), then the
//                  completeness review of each chapter against everything the course has on its lecture
//   6. book        merge every finished chapter in lecture order, then read the PDF back (page numbers, contents, edition page)
// and ends by saying what is in the book, what is held back and why, and which lectures are waiting to be written.
// Usage: tools/update <module> [--no-fetch] [--no-verify]. Writes out/<module>/update.json (the GUI shows it).
// It never releases: tools/release <module> book does that, after the reader has looked.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './lib/cite.mjs';
import { loadModule, loadTimeline, bookChapters, bookPages, changesSinceRelease, loadFeedback, lastRelease } from './lib/book.mjs';

const args = process.argv.slice(2);
const m = args.find(a => !a.startsWith('--'));
if (!m || !fs.existsSync(path.join(ROOT, 'modules', m, 'module.yaml'))) { console.error('usage: tools/update <module> [--no-fetch] [--no-verify]'); process.exit(2); }
const steps = [];
const say = s => console.log(`\n== ${s}`);
const run = (cmd, a) => {
  console.log(`$ tools/${cmd} ${a.join(' ')}`);
  const r = spawnSync(path.join(ROOT, 'tools', cmd), a, { cwd: ROOT, stdio: 'inherit' });
  return r.status === 0;
};
const step = (name, ok, detail) => { steps.push({ name, ok, detail }); console.log(`-- ${name}: ${ok ? 'ok' : 'PROBLEM'}${detail ? ' — ' + detail : ''}`); };
const list = ns => { // 6, 7, 8, 9 → "6–9"; chapter ids and other words are just joined
  if (!ns.every(n => typeof n === 'number')) return ns.join(', ');
  const out = []; let a = null, b = null;
  for (const n of [...ns].sort((x, y) => x - y)) { if (b !== null && n === b + 1) b = n; else { if (a !== null) out.push(a === b ? a : `${a}–${b}`); a = b = n; } }
  if (a !== null) out.push(a === b ? a : `${a}–${b}`);
  return out.join(', ');
};

say('1/6 Sources');
if (args.includes('--no-fetch')) step('Sources', true, 'not re-fetched (--no-fetch)');
else { const ok = run('ingest', [m]); step('Sources', ok, ok ? 'public files re-fetched and indexed' : 'ingest failed (offline?); carrying on with what is already here'); }

say('2/6 Lectures');
run('lectures', [m]);
let t = loadTimeline(m);
if (!t) { step('Lectures', false, 'no lecture timeline (modules/' + m + '/lectures.yaml)'); finish(); process.exit(1); }
const need = t.lectures.filter(L => L.state === 'materials in').map(L => L.n);
for (const n of need) run('lectures', [m, 'coverage', String(n)]);
if (need.length) { run('lectures', [m]); t = loadTimeline(m); }
step('Lectures', true, `${t.lectures.filter(L => L.happened).length} of ${t.lectures.length} have happened` + (need.length ? `; worked out coverage for ${list(need)}` : ''));

// Everything else the course has (notes, labs, sheets, past papers, examiners' comments, other recordings) is linked to
// its lecture, and anything the harvest holds that the module does not use is reported (decision 0006).
say('3/6 Everything the course has on each lecture');
run('map', [m, 'units']);
run('lectures', [m, 'evidence']);
let ev = readEvidence();
if (ev.pending.length && !args.includes('--no-verify')) { run('place', [m]); ev = readEvidence(); }
run('lectures', [m, 'audit']);
const audit = JSON.parse(fs.readFileSync(path.join(ROOT, 'out', m, 'audit.json'), 'utf8'));
run('lectures', [m]); t = loadTimeline(m);
const dossiers = t.lectures.filter(L => ['ready to write', 'drafted', 'built'].includes(L.state)).map(L => L.n);
for (const n of dossiers) run('lectures', [m, 'dossier', String(n)]); // always rewritten: they must carry the current evidence
{
  const bits = [];
  if (audit.files.length) bits.push(`${audit.files.length} harvested file(s) not used by any source`);
  if (audit.recordings.length) bits.push(`${audit.recordings.length} recording(s) attached to no lecture`);
  if (audit.lectures.length) bits.push(`${audit.lectures.length} lecture(s) given without slides or a recording`);
  if (audit.unlinked.length) bits.push(`${audit.unlinked.length} unit(s) fit no lecture and are not explained`);
  if (audit.pending.length) bits.push(`${audit.pending.length} unit(s) not placed in a lecture yet`);
  step('Evidence', !bits.length, bits.length ? bits.join('; ') + ` (tools/lectures ${m} audit)` : `every source is used and every unit is placed; dossiers rewritten for Lectures ${list(dossiers)}`);
}
function readEvidence() { return JSON.parse(fs.readFileSync(path.join(ROOT, 'out', m, 'evidence.json'), 'utf8')); }

say('4/6 Chapters');
const mod = loadModule(m);
let bk = bookChapters(m, mod);
const written = bk.all.filter(c => c.why !== 'Not written yet.');
if (!written.length) step('Chapters', true, 'no chapters written yet');
else {
  const checksOk = run('checks', [m]);
  const lintBad = written.filter(c => !run('build', [m, c.id])).map(c => c.id);
  run('lectures', [m]); // refresh the coverage gate against the new builds
  step('Chapters', checksOk && !lintBad.length, `${written.length} built` + (checksOk ? '' : '; some maths checks FAIL') + (lintBad.length ? `; problems in ${list(lintBad)}` : ''));

  say('5/6 Checking new and changed pages');
  bk = bookChapters(m, mod);
  const toVerify = bk.all.filter(c => c.built && !c.stale && !c.lint && !c.gateMissing.length && c.unverified.length);
  const nPages = toVerify.reduce((n, c) => n + c.unverified.length, 0);
  if (!toVerify.length) step('Checking', true, 'every page is already checked at its current version');
  else if (args.includes('--no-verify')) step('Checking', true, `${nPages} page(s) in ${list(toVerify.map(c => c.id))} need checking (skipped: --no-verify)`);
  else {
    const bad = toVerify.filter(c => !run('verify', [m, c.id, '--jobs', '2'])).map(c => c.id);
    step('Checking', !bad.length, `${nPages} page(s) checked in ${list(toVerify.map(c => c.id))}` + (bad.length ? `; the checker did not finish for ${list(bad)}` : ''));
  }
  // Completeness: is anything the course has on the lecture missing from the chapter? (once per evidence set)
  bk = bookChapters(m, mod);
  const toReview = bk.all.filter(c => c.built && !c.stale && !c.lint && !c.complete);
  if (toReview.length && !args.includes('--no-verify')) {
    const bad = toReview.filter(c => !run('omissions', [m, c.id])).map(c => c.id);
    step('Completeness', !bad.length, `${list(toReview.map(c => c.id))} compared with everything the course has on ${toReview.length === 1 ? 'its lecture' : 'their lectures'}` + (bad.length ? `; the review did not finish for ${list(bad)}` : ''));
  } else if (toReview.length) step('Completeness', true, `${list(toReview.map(c => c.id))} not reviewed for gaps yet (skipped: --no-verify)`);
}

say('6/6 The book');
bk = bookChapters(m, mod);
if (!mod.book) step('Book', true, 'this module has no book yet (it gets one with its first chapter)');
else if (!bk.included.length) step('Book', true, 'no finished chapters yet');
else {
  let ok = run('build', [m, 'book']);
  // The book's own front pages (cover, edition, contents) are checked like any other page.
  if (ok && !args.includes('--no-verify')) {
    const out = spawnSync(path.join(ROOT, 'tools', 'verify'), [m, 'book', '--dry-run'], { cwd: ROOT, encoding: 'utf8' }).stdout || '';
    if (+((out.match(/(\d+) page\(s\) to verify/) || [])[1] || 0) > 0) ok = run('verify', [m, 'book', '--jobs', '2']) && ok;
  }
  const b = bookPages(m, mod);
  step('Book', ok, `${b.sheets} pages, Lectures ${list(bk.included.map(c => c.lecture))}` + (ok ? '; page numbers, contents and edition page read back from the PDF and correct' : '; the build or its read-back check found problems'));
}
finish();

function finish() {
  const tl = loadTimeline(m);
  const b = mod && mod.book ? bookPages(m) : null;
  const cur = bookChapters(m);
  const ready = tl ? tl.lectures.filter(L => ['ready to write', 'materials in'].includes(L.state)).map(L => L.n) : [];
  const waiting = tl ? tl.lectures.filter(L => L.state === 'waiting for materials').map(L => L.n) : [];
  const notes = loadFeedback(m).filter(n => n.status === 'open');
  const changes = b ? [...new Set(changesSinceRelease(m, b).flatMap(c => c.sheets))] : []; // printed pages, not topics
  const summary = {
    module: m, ran: new Date().toISOString(), ok: steps.every(s => s.ok), steps,
    in_book: cur.included.map(c => c.lecture), held: cur.held.map(c => ({ lecture: c.lecture, why: c.why })),
    ready, waiting, changes: changes.length, released: (lastRelease(m) || {}).released || null, open_notes: notes.length,
  };
  fs.mkdirSync(path.join(ROOT, 'out', m), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'out', m, 'update.json'), JSON.stringify(summary, null, 1));
  console.log(`\n================ ${mod.title} ================`);
  console.log(cur.included.length ? `In the book: Lectures ${list(summary.in_book)}${b ? ` (${b.sheets} pages)` : ''}.` : 'In the book: nothing yet.');
  for (const h of summary.held) console.log(`Held back: Lecture ${h.lecture} — ${h.why}`);
  if (changes.length) console.log(`${changes.length} page(s) ${summary.released ? "are new or changed since the release of " + summary.released.slice(0, 10) : "have not been released yet"}: look at them in the GUI, then release.`);
  if (ready.length) console.log(`Ready to write: Lectures ${list(ready)}. In Claude Code say: "write ${m} lectures ${list(ready)}".`);
  if (waiting.length) console.log(`Waiting for slides or a recording: Lectures ${list(waiting)} (needs a re-harvest: say "update ${m}" in Claude Code).`);
  if (notes.length) console.log(`${notes.length} reader note(s) are open in modules/${m}/feedback.yaml.`);
  for (const s of steps.filter(s => !s.ok)) console.log(`PROBLEM in ${s.name}: ${s.detail}`);
}
