// Completeness review of a chapter (decision 0006): a fresh headless Claude compares the chapter with EVERYTHING the
// course has on its lecture (the lecture dossier: slides with coverage, notes, labs, sheets, past papers, solution
// notes, examiners' comments) and reports what the chapter leaves out. Issues go into the verifier ledger as
// category OMISSION (major ones hold the chapter back, like any other major issue).
// A chapter is reviewed once per evidence set: it is reviewed again when the units linked to its lecture change
// (new paper, new notes, new coverage) or with --force. Fixes are recorded with tools/ledger fix as usual.
//
// Usage: tools/omissions <module> <chapter|all> [--model sonnet] [--force] [--dry-run]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import YAML from 'yaml';
import { ROOT } from './lib/cite.mjs';
import { loadLedger, saveLedger, sha, loadReport } from './lib/verifyctx.mjs';
import { loadModule, loadTimeline, chapterSections, omissionsBasis } from './lib/book.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const [module, which] = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1] === '--model'));
if (!module || !which) { console.error('usage: tools/omissions <module> <chapter|all> [--model sonnet] [--force] [--dry-run]'); process.exit(2); }
const model = opt('--model', 'sonnet'), force = argv.includes('--force'), dry = argv.includes('--dry-run');
const mod = loadModule(module);
const chapters = which === 'all' ? chapterSections(mod).map(c => c.id) : [which];
const PROMPT = fs.readFileSync(path.join(ROOT, 'tools', 'omissions_prompt.md'), 'utf8').replace(/^<!--[\s\S]*?-->\n*/, '');

function runClaude(dir, schema) {
  const args = ['-p', PROMPT, '--output-format', 'json', '--json-schema', JSON.stringify(schema), '--model', model,
    '--tools', 'Read,Glob,Grep', '--allowedTools', 'Read Glob Grep', '--permission-mode', 'dontAsk', '--setting-sources', 'project',
    '--strict-mcp-config', '--no-session-persistence', '--no-chrome'];
  return new Promise(resolve => {
    const ch = spawn('claude', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    ch.stdout.on('data', d => (out += d)); ch.stderr.on('data', d => (err += d));
    const timer = setTimeout(() => ch.kill('SIGTERM'), 40 * 60 * 1000);
    ch.on('close', code => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}

let failed = 0;
for (const ch of chapters) {
  const cdir = path.join(ROOT, 'modules', module, 'content', ch);
  if (!fs.existsSync(cdir)) { console.log(`${ch}: not written yet`); continue; }
  let report;
  try { report = loadReport(module, ch); } catch { console.log(`${ch}: not built yet (tools/build ${module} ${ch})`); continue; }
  const L = (loadTimeline(module) || { lectures: [] }).lectures.find(l => l.chapter === ch);
  if (!L) { console.log(`${ch}: no lecture in lectures.yaml has chapter: ${ch}`); failed++; continue; }
  spawnSync(path.join(ROOT, 'tools', 'lectures'), [module, 'dossier', String(L.n)], { cwd: ROOT, stdio: 'ignore' }); // always from the current evidence
  const basis = omissionsBasis(module, L.n);
  const ledger0 = loadLedger(module);
  const prev = (ledger0.omissions || {})[ch];
  if (!force && prev && prev.basis === basis) { console.log(`skip ${ch} (reviewed for completeness ${prev.reviewed} against the same evidence)`); continue; }
  const dossier = fs.readFileSync(path.join(ROOT, 'out', module, 'dossiers', `L${String(L.n).padStart(2, '0')}.md`), 'utf8');
  const dir = path.join(os.tmpdir(), 'revision-guides-omissions', `${module}-${ch}-${basis}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'chapter'), { recursive: true });
  for (const f of fs.readdirSync(cdir).filter(f => f.endsWith('.md')).sort()) fs.copyFileSync(path.join(cdir, f), path.join(dir, 'chapter', f));
  const qdir = path.join(ROOT, 'modules', module, 'questions');
  const qs = fs.existsSync(qdir) ? fs.readdirSync(qdir).filter(f => f.endsWith('.yaml')).flatMap(f => YAML.parse(fs.readFileSync(path.join(qdir, f), 'utf8')) || []) : [];
  const used = new Set((report.questions || []).map(q => q.id));
  if (used.size) fs.writeFileSync(path.join(dir, 'chapter', 'questions.yaml'), YAML.stringify(qs.filter(q => used.has(q.id))));
  fs.writeFileSync(path.join(dir, 'dossier.md'), dossier);
  let copied = 0;
  for (const rel of new Set(dossier.match(/sources\/[^`\s,)]+\.(png|txt)/g) || [])) {
    const src = path.join(ROOT, rel);
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.copyFileSync(src, path.join(dir, rel)); copied++;
  }
  const pageIds = report.pages.filter(p => p.kind !== 'answers').map(p => p.id);
  const schema = { type: 'object', additionalProperties: false, required: ['units_checked', 'issues', 'covered_ok'], properties: {
    units_checked: { type: 'integer', minimum: 0 },
    issues: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['page', 'category', 'severity', 'quote', 'source_says', 'fix'], properties: {
      page: { type: 'string', enum: pageIds }, category: { type: 'string', enum: ['OMISSION'] }, severity: { type: 'string', enum: ['major', 'minor'] },
      quote: { type: 'string' }, source_says: { type: 'string' }, fix: { type: 'string' } } } },
    covered_ok: { type: 'array', items: { type: 'string' } } } };
  if (dry) { console.log(`dry-run ${ch}: Lecture ${L.n}, dossier ${Math.round(dossier.length / 1000)} kB, ${copied} source files, context in ${dir}`); continue; }
  console.log(`→ ${ch}: Lecture ${L.n}, dossier ${Math.round(dossier.length / 1000)} kB, ${copied} source files, ${model}`);
  const t0 = Date.now();
  const r = await runClaude(dir, schema);
  const outDir = path.join(ROOT, 'out', module, ch, 'verify');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'omissions.raw.json'), r.out || r.err);
  let res; try { res = JSON.parse(r.out); } catch { console.log(`✗ ${ch}: could not parse claude output (exit ${r.code}): ${(r.err || r.out).slice(0, 300)}`); failed++; continue; }
  const so = res.structured_output;
  if (res.is_error || !so) { console.log(`✗ ${ch}: reviewer error: ${String(res.result).slice(0, 300)}`); failed++; continue; }
  fs.writeFileSync(path.join(outDir, 'omissions.json'), JSON.stringify(so, null, 1));
  const now = new Date().toISOString().slice(0, 16);
  const ledger = loadLedger(module);
  ledger.omissions = ledger.omissions || {};
  ledger.omissions[ch] = { basis, reviewed: now, model, units_checked: so.units_checked, issues_reported: so.issues.length, minutes: +((Date.now() - t0) / 60000).toFixed(1), cost_usd: res.total_cost_usd };
  for (const is of so.issues) {
    const id = `${is.page}#${sha(is.category + '|' + is.quote).slice(0, 6)}`;
    if (!ledger.issues.find(x => x.id === id)) ledger.issues.push({ id, page: is.page, status: 'open', found: now, ...is });
  }
  saveLedger(module, ledger);
  const maj = so.issues.filter(i => i.severity === 'major').length;
  console.log(`✓ ${ch}: ${so.units_checked} units compared, ${maj} major + ${so.issues.length - maj} minor omission(s) in ${((Date.now() - t0) / 60000).toFixed(1)} min. See: tools/ledger ${module} list --open`);
}
process.exit(failed ? 1 : 0);
