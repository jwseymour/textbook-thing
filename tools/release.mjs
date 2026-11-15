// Release a section: refuse unless it passes the release bar, then copy the PDF into the module's folder in the Google Drive sync folder
// (module.yaml drive_folder), replacing the copy from the last release wherever that was
// (the Boox reads it from Google Drive). Usage: tools/release <module> <section> [--dry-run]
// `tools/release <module> book` releases the module textbook (decision 0004). The book holds every finished chapter
// (tools/lib/book.mjs); the build's read-back check of the PDF must pass, the book's own front pages must be verified,
// and a chapter that was in the last release must not have dropped out. Each release is recorded in
// modules/<m>/releases.json with a version hash per page, so the GUI can show what is new next time.
// The bar: maths checks all pass · build + lint clean (incl. overflow) · every page verified at its current version ·
// no open major verifier issues (open minor issues are listed but don't block).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';
import { ROOT } from './lib/cite.mjs';
import { loadReport, loadLedger, pageContext, blocking } from './lib/verifyctx.mjs';
import { chapterSections, bookPages, lastRelease, loadReleases, releasesPath } from './lib/book.mjs';

const args = process.argv.slice(2);
const [module, section] = args.filter(a => !a.startsWith('--'));
const dry = args.includes('--dry-run');
if (!module || !section) { console.error('usage: tools/release <module> <section> [--dry-run]'); process.exit(2); }
const mod = YAML.parse(fs.readFileSync(path.join(ROOT, 'modules', module, 'module.yaml'), 'utf8'));
const fail = [];
// Prototype sections (module.yaml `prototype: true`) exist to try out a design; they are never released.
const isBook = section === 'book';
if (isBook && !mod.book) { console.error('module.yaml has no `book:`'); process.exit(1); }
let chapters = isBook ? chapterSections(mod).map(c => c.id) : [section];
if (((mod.sections || {})[section] || {}).prototype) { console.error(`${module} ${section} is marked prototype: true in module.yaml, so it is not released.`); process.exit(1); }
const run = (cmd, a) => { try { execFileSync(path.join(ROOT, 'tools', cmd), a, { stdio: ['ignore', 'pipe', 'pipe'] }); return true; } catch (e) { return String(e.stdout || '') + String(e.stderr || ''); } };

console.log('1/4 maths checks…');
const c = run('checks', [module]);
if (c !== true) fail.push('maths checks failed:\n' + c.split('\n').filter(l => l.startsWith('FAIL')).join('\n'));

console.log('2/4 build + lint + overflow…');
if (isBook) for (const s of chapters) run('build', [module, s]); // an unfinished chapter is held back by the book build, not a failure here
{
  const b = run('build', [module, section]);
  if (b !== true) fail.push(`build/lint failed (${section}):\n` + b.split('\n').filter(l => /^\s+(modules|out)|LINT|Error/.test(l)).join('\n'));
}
if (isBook) {
  // The book build decided which chapters are finished (lint clean, coverage gate passed, verified) and put those in.
  const rep = loadReport(module, 'book');
  chapters = rep.chapters || [];
  if (!chapters.length) fail.push('no finished chapters: there is nothing to release');
  for (const h of (rep.integrity || {}).held || []) console.log(`   note: Lecture ${h.lecture} is written but held back: ${h.why}`);
  const last = lastRelease(module);
  for (const c of last ? last.chapters.filter(c => !chapters.includes(c)) : [])
    fail.push(`${c} was in the last release (${last.released.slice(0, 10)}) but is not in this edition: ` + (((rep.integrity || {}).held || []).find(h => h.id === c) || { why: 'it is no longer a chapter' }).why);
}

console.log('3/4 verifier ledger…');
const report = loadReport(module, section);
const ledger = loadLedger(module);
// A book's chapter pages are verified in their own chapter builds; only its front pages are verified in the book build.
const toCheck = isBook ? [...chapters.map(c => [c, loadReport(module, c), () => true]), ['book', report, p => !p.chapter]] : [[section, report, () => true]];
const allPages = [];
for (const [s, rep, keep] of toCheck) for (const p of rep.pages.filter(keep)) {
  allPages.push(p);
  const h = pageContext(module, rep, p).hash;
  const v = ledger.pages[p.id];
  if (!v) fail.push(`${s} p${p.num} ${p.id} has never been verified (tools/verify ${module} ${s})`);
  else if (v.hash !== h) fail.push(`${s} p${p.num} ${p.id} changed since it was verified (${v.verified}) — re-run tools/verify ${module} ${s}`);
}
const mine = i => allPages.some(p => p.id === i.page);
const open = ledger.issues.filter(i => blocking(i) && mine(i));
if (open.length) fail.push(`${open.length} open major verifier issue(s): ${open.map(i => i.id).join(', ')} (tools/ledger ${module} list --open)`);
const minor = ledger.issues.filter(i => i.status === 'open' && !blocking(i) && mine(i));
if (minor.length) console.log(`   note: ${minor.length} minor issue(s) still open (not blocking): ${minor.map(i => i.id).join(', ')}`);

if (fail.length) {
  console.log('\nNOT RELEASED — the release bar is not met:\n- ' + fail.join('\n- '));
  process.exit(1);
}

console.log('4/4 copy to Google Drive…');
const pdf = path.join(ROOT, 'out', module, section, 'guide.pdf');
let driveRoot = process.env.DRIVE_ROOT;
if (!driveRoot) {
  const cs = path.join(os.homedir(), 'Library', 'CloudStorage');
  const accounts = fs.existsSync(cs) ? fs.readdirSync(cs).filter(d => d.startsWith('GoogleDrive-')) : [];
  if (accounts.length !== 1) { console.log(`Found ${accounts.length} Google Drive accounts in ${cs}; set DRIVE_ROOT to the "My Drive" folder.`); process.exit(1); }
  driveRoot = path.join(cs, accounts[0], 'My Drive');
}
const n = section.replace(/^s/, '');
const name = isBook ? (mod.book.pdf_name || `${module}_Textbook.pdf`) : /^l\d+$/.test(section) ? `${module}_Lecture${+section.slice(1)}.pdf`
  : (mod.pdf_name || '{module}_Section{n}_RevisionGuide.pdf').replace('{n}', n).replace('{module}', module);
if (!mod.drive_folder || /(^|\/)TODO(\/|$)/.test(mod.drive_folder)) { console.log(`module.yaml drive_folder is "${mod.drive_folder || ''}": set it to the module's own folder on Drive (e.g. "Part IB/<Module>").`); process.exit(1); }
const destDir = path.join(driveRoot, mod.drive_folder);
const dest = path.join(destDir, name);
// One copy on Drive: the same name is overwritten in place; if the last release went somewhere else, that copy is removed.
const recPath = path.join(ROOT, 'out', module, section, 'release.json');
const prev = isBook ? (lastRelease(module) || {}).dest : fs.existsSync(recPath) ? JSON.parse(fs.readFileSync(recPath, 'utf8')).dest : null;
const stale = prev && path.resolve(prev) !== path.resolve(dest) && path.resolve(prev).startsWith(path.resolve(driveRoot) + path.sep) && fs.existsSync(prev) ? prev : null;
if (dry) { console.log(`dry run: would copy ${path.relative(ROOT, pdf)} → ${dest}` + (stale ? `\n         and remove the old copy ${stale}` : '')); process.exit(0); }
fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(pdf, dest);
if (stale) {
  fs.rmSync(stale);
  // Remove the folders the old copy leaves empty (a lone .DS_Store does not count), never above the Drive root.
  for (let d = path.dirname(stale); path.resolve(d).startsWith(path.resolve(driveRoot) + path.sep); d = path.dirname(d)) {
    if (fs.readdirSync(d).some(f => f !== '.DS_Store')) break;
    fs.rmSync(path.join(d, '.DS_Store'), { force: true });
    fs.rmdirSync(d);
  }
  console.log(`   removed the old copy: ${stale}`);
}
const rec = { module, section, released: new Date().toISOString(), dest, pages: report.pages.length, bytes: fs.statSync(dest).size };
fs.writeFileSync(recPath, JSON.stringify(rec, null, 1));
if (isBook) {
  const book = bookPages(module, mod);
  const all = loadReleases(module);
  all.push({ released: rec.released, dest, sheets: book.sheets, chapters, pages: Object.fromEntries(book.pages.filter(p => p.chapter).map(p => [p.id, p.hash])) });
  fs.writeFileSync(releasesPath(module), JSON.stringify(all, null, 1) + '\n');
}
console.log(`RELEASED ${report.pages.length} pages → ${dest}\nGoogle Drive will sync it; open it on the Boox from Google Drive.`);
