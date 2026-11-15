// Per-page independent verification: for each page (topic), a fresh headless Claude sees ONLY the page source, its
// rendered sheets, the source pages it cites (text + images) and its linked check results, and returns structured
// issues. Results go into modules/<m>/verify/ledger.json (open / fixed / waived). Pages whose context hasn't changed
// since their last verification are skipped.
//
// Two modes, chosen per page:
//   full     — never verified (or --full, or a cited source file / the prompt version changed): check everything.
//   recheck  — verified before and then edited: check only the diff since the verified snapshot, and whether the
//              issues marked fixed really are. Much cheaper, and stops each edit from triggering a full re-review.
//
// Usage: tools/verify <module> <section> [--pages id,id] [--full] [--force] [--model sonnet] [--jobs 3] [--dry-run]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT } from './lib/cite.mjs';
import { shotName } from './lib/print.mjs';
import { loadReport, loadLedger, saveLedger, pageContext, describeSource, fileStem, sha, promptTemplate, promptVersion, snapshotDir, saveSnapshot } from './lib/verifyctx.mjs';

const DEFAULT_MODEL = 'sonnet';
const argv = process.argv.slice(2);
const BOOL = ['--force', '--full', '--dry-run'];
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const [module, section] = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && !BOOL.includes(argv[i - 1])));
if (!module || !section) { console.error('usage: tools/verify <module> <section> [--pages id,id] [--full] [--force] [--model sonnet] [--jobs 3] [--dry-run]'); process.exit(2); }
const force = argv.includes('--force'), full = argv.includes('--full') || force, dry = argv.includes('--dry-run');
const model = opt('--model', DEFAULT_MODEL), jobs = +opt('--jobs', '3');
const onlyPages = opt('--pages', null) ? opt('--pages').split(',') : null;
const PY = path.join(ROOT, '.venv', 'bin', 'python');
const OUT = path.join(ROOT, 'out', module, section, 'verify');
fs.mkdirSync(OUT, { recursive: true });

const report = loadReport(module, section);
if (report.problems.length) { console.error(`build has ${report.problems.length} lint problem(s): fix them before verifying`); process.exit(1); }
const checksFile = path.join(ROOT, 'out', module, 'checks.json');
if (!fs.existsSync(checksFile)) { console.error(`no check results: run tools/checks ${module}`); process.exit(1); }

const schema = {
  type: 'object', additionalProperties: false, required: ['claims_checked', 'issues', 'verified_ok'],
  properties: {
    claims_checked: { type: 'integer', minimum: 0 },
    issues: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['category', 'severity', 'quote', 'source_says', 'fix'], properties: {
      category: { type: 'string', enum: ['ERROR', 'WRONG-CITATION', 'MISLEADING', 'UNVERIFIABLE', 'RENDERING'] },
      severity: { type: 'string', enum: ['major', 'minor'] },
      quote: { type: 'string' }, source_says: { type: 'string' }, fix: { type: 'string' } } } },
    verified_ok: { type: 'array', items: { type: 'string' } },
  },
};

function pageNote(p, src) {
  const notes = [];
  if (/:::answers/.test(src)) notes.push('NOTE: this is an answers page. Its warm-up answers are generated from the other pages and are verified there; on this page check only the text in `page.md` itself (and that `page.png` renders it properly).');
  if (/::summary/.test(src)) notes.push('NOTE: the numbered revision prompts on this page are generated from the other pages; check only the text in `page.md` and the rendering.');
  if (/::questions/.test(src)) notes.push('NOTE: the past-paper questions on this page come from `extra/questions.yaml` (stems only are shown here). For each: is the paraphrased stem faithful to the cited paper (meaning, symbols, numbers, marks), and is it a paraphrase rather than a verbatim copy? Are the "not answered here" lists accurate?');
  if (/:::question-answers/.test(src)) notes.push('NOTE: the worked answers on this page come from `extra/questions.yaml`. Check every answer against the question paper and, where `answer_source` says it follows the solution notes, against the cited `Sol` file. Solve each one yourself.');
  if (/::errata/.test(src)) notes.push('NOTE: the typo list comes from `extra/errata.yaml` (entries with `in_box: false` are not shown on the page but still check them). Confirm each typo against the source images.');
  notes.push('NOTE: topics flow onto shared A4 sheets, so the rendered images may also show the end of the previous topic or the start of the next one. Check only the content that comes from `page.md`.');
  if (/::edition/.test(src)) notes.push('NOTE: the lecture table is generated from the lecture timeline; check only the text in `page.md`.');
  if (/::contents/.test(src)) notes.push('NOTE: the contents table is generated from the other pages; ignore it.');
  return notes.join('\n\n');
}

const RECHECK_NOTE = since => `## This is a RE-CHECK of an edited page, not a full check

This page was fully checked on ${since} and has been edited since. \`changes.diff\` shows exactly what changed (a unified diff of \`page.md\`, and of \`extra/\` files if they changed). \`previous_issues.md\` lists the problems found on this page before and how each was resolved.

Check ONLY:
1. Each issue in \`previous_issues.md\` marked FIXED: is it really fixed in the current \`page.md\`? If not, report it again.
2. Every added or changed line in \`changes.diff\`, with the same care as a full check: claims, formulas against the source images, citations, and how those lines render in \`page.png\`.
3. That the edits haven't made unchanged text wrong (e.g. a sentence that now contradicts an edited one).

Do not otherwise review unchanged text: it was already verified. Count only the claims you checked in \`claims_checked\`.`;

// Decide full vs recheck for a page that needs verifying.
function modeFor(prev, ctx, id) {
  if (full || !prev || !prev.basis) return 'full';
  if (prev.basis.prompt_version !== promptVersion()) return 'full';
  if (!fs.existsSync(path.join(snapshotDir(module, id), 'page.md'))) return 'full';
  // A cited source file that changed under unchanged text can only be caught by a full check.
  const was = new Map(prev.basis.sources.map(s => { const [i, pg, h] = s.split('|'); return [`${i}|${pg}`, h]; }));
  for (const s of ctx.sources) { const h = was.get(`${s.id}|${s.page}`); if (h && h !== s.sha) return 'full'; }
  return 'recheck';
}

function diffText(a, b, label) {
  const r = spawnSync('diff', ['-u', '--label', `${label} (verified)`, '--label', `${label} (now)`, a, b], { encoding: 'utf8' });
  return r.stdout || '';
}

function assemble(p, ctx, mode, prev) {
  const dir = path.join(os.tmpdir(), 'revision-guides-verify', `${module}-${section}-${p.id}-${ctx.hash}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'sources'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'page.md'), ctx.src);
  const shotsDir = path.join(ROOT, 'out', module, section, 'shots');
  const parts = (p.sheets && p.sheets.length ? p.sheets : [1]).map((_, k) => k + 1);
  for (const part of parts) {
    const shot = path.join(shotsDir, shotName(p.num, part));
    if (!fs.existsSync(shot)) throw new Error(`no screenshot ${shot}: run tools/build without --no-shots`);
    fs.copyFileSync(shot, path.join(dir, part > 1 ? `page-${part}.png` : 'page.png'));
  }
  const idx = ['# Source pages provided', ''];
  for (const s of ctx.sources) {
    const stem = fileStem(s.id, s.page);
    fs.copyFileSync(s.txt, path.join(dir, 'sources', stem + '.txt'));
    if (s.png) fs.copyFileSync(s.png, path.join(dir, 'sources', stem + '.png'));
    idx.push(`- \`${stem}\` — ${describeSource(ctx.index, s.id, s.page)}`);
  }
  if (!ctx.sources.length) idx.push('(none: this page cites no course sources)');
  fs.writeFileSync(path.join(dir, 'sources', 'INDEX.md'), idx.join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'checks.md'), ['# Computer checks linked from this page', '', ...(ctx.checks.length ? ctx.checks.map(c => `- \`${c.id}\` — ${c.ok ? 'PASSED' : 'NOT PASSED'} — ${c.desc}`) : ['(none)'])].join('\n') + '\n');
  if (Object.keys(ctx.extra).length) {
    fs.mkdirSync(path.join(dir, 'extra'));
    for (const [k, v] of Object.entries(ctx.extra)) fs.writeFileSync(path.join(dir, 'extra', k), v);
  }
  let note = pageNote(p, ctx.src);
  if (mode === 'recheck') {
    const snap = snapshotDir(module, p.id);
    let d = diffText(path.join(snap, 'page.md'), path.join(dir, 'page.md'), 'page.md');
    for (const k of Object.keys(ctx.extra)) {
      const old = path.join(snap, k);
      d += fs.existsSync(old) ? diffText(old, path.join(dir, 'extra', k), `extra/${k}`) : `(extra/${k} is new: check all of it)\n`;
    }
    fs.writeFileSync(path.join(dir, 'changes.diff'), d || '(no textual change: only the linked checks changed)\n');
    const issues = loadLedger(module).issues.filter(i => i.page === p.id);
    fs.writeFileSync(path.join(dir, 'previous_issues.md'), ['# Issues found on this page before', '',
      ...(issues.length ? issues.map(i => `- **${i.status.toUpperCase()}** [${i.category}] “${i.quote}”\n  - source says: ${i.source_says}\n  - suggested fix: ${i.fix}${i.resolution ? `\n  - resolution: ${i.resolution}` : ''}`) : ['(none)'])].join('\n') + '\n');
    note = [note, RECHECK_NOTE(prev.verified)].filter(Boolean).join('\n\n');
  }
  const prompt = promptTemplate(module).replace('{{PYTHON}}', PY).replace('{{PAGE_NOTE}}', note);
  fs.writeFileSync(path.join(dir, 'PROMPT.md'), prompt);
  return { dir, prompt };
}

function runClaude(dir, prompt) {
  const args = ['-p', prompt, '--output-format', 'json', '--json-schema', JSON.stringify(schema), '--model', model,
    '--tools', 'Read,Glob,Grep,Bash,Write', '--allowedTools', `Read Glob Grep Write Bash(${PY} *)`,
    '--permission-mode', 'dontAsk', '--setting-sources', 'project', '--strict-mcp-config', '--no-session-persistence', '--no-chrome'];
  return new Promise(resolve => {
    const ch = spawn('claude', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    ch.stdout.on('data', d => (out += d)); ch.stderr.on('data', d => (err += d));
    const timer = setTimeout(() => ch.kill('SIGTERM'), 30 * 60 * 1000);
    ch.on('close', code => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}

const ledger0 = loadLedger(module);
const todo = [];
for (const p of report.pages) {
  if (onlyPages && !onlyPages.includes(p.id) && !onlyPages.includes(String(p.num))) continue;
  if (section === 'book' && p.chapter) continue; // chapter pages are verified in their own chapter build
  const ctx = pageContext(module, report, p);
  const prev = ledger0.pages[p.id];
  if (!force && prev && prev.hash === ctx.hash) { console.log(`skip p${p.num} ${p.id} (verified at this version ${prev.verified})`); continue; }
  todo.push({ p, ctx, prev, mode: modeFor(prev, ctx, p.id) });
}
const n = m => todo.filter(t => t.mode === m).length;
console.log(`${todo.length} page(s) to verify with ${model} (${n('full')} full, ${n('recheck')} recheck), ${jobs} at a time`);

async function verifyOne({ p, ctx, prev, mode }) {
  const { dir, prompt } = assemble(p, ctx, mode, prev);
  if (dry) { console.log(`dry-run p${p.num} ${p.id}: ${mode}, ${ctx.sources.length} source pages, context in ${dir}`); return; }
  const t0 = Date.now();
  console.log(`→ p${p.num} ${p.id}: ${mode}, ${ctx.sources.length} source pages`);
  const r = await runClaude(dir, prompt);
  fs.writeFileSync(path.join(OUT, `${p.id}.raw.json`), r.out || r.err);
  let res;
  try { res = JSON.parse(r.out); } catch { console.log(`✗ p${p.num} ${p.id}: could not parse claude output (exit ${r.code}): ${(r.err || r.out).slice(0, 300)}`); return; }
  const so = res.structured_output;
  if (res.is_error || !so) { console.log(`✗ p${p.num} ${p.id}: verifier error: ${String(res.result).slice(0, 300)}`); return; }
  fs.writeFileSync(path.join(OUT, `${p.id}.json`), JSON.stringify(so, null, 1));
  const now = new Date().toISOString().slice(0, 16);
  // Re-read the ledger from disk so fixes recorded meanwhile (tools/ledger) aren't overwritten.
  const ledger = loadLedger(module);
  ledger.pages[p.id] = { hash: ctx.hash, verified: now, mode, model, claims_checked: so.claims_checked, issues_reported: so.issues.length, source_pages: ctx.sources.length, minutes: +((Date.now() - t0) / 60000).toFixed(1), cost_usd: res.total_cost_usd ?? null, basis: ctx.basis };
  for (const is of so.issues) {
    const id = `${p.id}#${sha(is.category + '|' + is.quote).slice(0, 6)}`;
    const ex = ledger.issues.find(x => x.id === id);
    if (!ex) ledger.issues.push({ id, page: p.id, status: 'open', found: now, ...is });
    else if (ex.status === 'fixed') { ex.status = 'open'; ex.severity = is.severity; ex.reopened = now; ex.history = [...(ex.history || []), `re-reported ${now} after fix: ${ex.resolution}`]; }
  }
  saveLedger(module, ledger);
  saveSnapshot(module, p.id, ctx);
  const maj = so.issues.filter(i => i.severity === 'major').length;
  console.log(`✓ p${p.num} ${p.id}: ${mode}, ${so.claims_checked} claims, ${maj} major + ${so.issues.length - maj} minor issue(s) in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}

const queue = [...todo];
await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => { while (queue.length) await verifyOne(queue.shift()); }));
if (!dry) {
  const open = loadLedger(module).issues.filter(i => i.status === 'open' && report.pages.some(p => p.id === i.page));
  const minor = open.filter(i => i.severity === 'minor').length;
  console.log(`\nledger: ${open.length - minor} major + ${minor} minor open issue(s) in ${section} (only major ones block release). See: tools/ledger ${module} list --open`);
}
