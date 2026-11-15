// Shared by tools/verify and tools/release: per-page verification context, its hash, and the ledger.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import YAML from 'yaml';
import { ROOT, loadIndex, resolveCitation, pageFiles } from './cite.mjs';

export const sha = s => crypto.createHash('sha256').update(s).digest('hex');

export function loadReport(module, section) {
  const f = path.join(ROOT, 'out', module, section, 'report.json');
  if (!fs.existsSync(f)) throw new Error(`no build report: run tools/build ${module} ${section} first`);
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

export function ledgerPath(module) { return path.join(ROOT, 'modules', module, 'verify', 'ledger.json'); }
export function loadLedger(module) {
  const f = ledgerPath(module);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { pages: {}, issues: [] };
}
export function saveLedger(module, ledger) {
  fs.mkdirSync(path.dirname(ledgerPath(module)), { recursive: true });
  ledger.issues.sort((a, b) => (a.page + a.id).localeCompare(b.page + b.id));
  fs.writeFileSync(ledgerPath(module), JSON.stringify(ledger, null, 1) + '\n');
}

// Everything the verifier sees for one page. `hash` changes whenever any of it changes.
export function pageContext(module, report, pageReport) {
  const index = loadIndex(module);
  const src = fs.readFileSync(path.join(ROOT, pageReport.file), 'utf8');
  const MOD = path.join(ROOT, 'modules', module);
  const extra = {};
  const usesQuestions = /::(questions|question-answers)|:::question-answers/.test(src);
  const usesErrata = /::errata/.test(src);
  if (usesQuestions) {
    const qs = [];
    for (const f of fs.readdirSync(path.join(MOD, 'questions')).filter(f => f.endsWith('.yaml')).sort())
      qs.push(...(YAML.parse(fs.readFileSync(path.join(MOD, 'questions', f), 'utf8')) || []).filter(q => q.section === report.section));
    extra['questions.yaml'] = YAML.stringify(qs);
  }
  if (usesErrata) {
    const es = (YAML.parse(fs.readFileSync(path.join(MOD, 'errata.yaml'), 'utf8')) || []).filter(e => (e.sections || []).includes(report.section));
    extra['errata.yaml'] = YAML.stringify(es);
  }
  // Cited source pages (deduplicated).
  const seen = new Map();
  for (const r of resolveCitation(pageReport.citations.join('; '), index)) {
    if (r.type !== 'source' || r.error) continue;
    for (const f of pageFiles(r, index)) {
      const key = `${r.id}|${f.page}`;
      if (!seen.has(key)) seen.set(key, { id: r.id, page: f.page, txt: f.txt, png: f.png, sha: index.sources[r.id].sha256 });
    }
  }
  const sources = [...seen.values()].sort((a, b) => (a.id + String(a.page).padStart(4, '0')).localeCompare(b.id + String(b.page).padStart(4, '0')));
  const checksFile = path.join(ROOT, 'out', module, 'checks.json');
  const checkRes = fs.existsSync(checksFile) ? JSON.parse(fs.readFileSync(checksFile, 'utf8')).results : {};
  const checks = [...new Set(pageReport.checks)].sort().map(id => ({ id, ok: !!(checkRes[id] && checkRes[id].ok), desc: (checkRes[id] || {}).desc || '' }));
  // The prompt counts through its version number (bumped when a prompt change should force re-verification) and
  // the module's citation legend, so wording tweaks don't invalidate every verified page.
  const prompt = `v${promptVersion()}|${citationLegend(module)}`;
  const hash = sha(JSON.stringify({ src, extra, sources: sources.map(s => [s.id, s.page, s.sha]), checks: checks.map(c => [c.id, c.ok]), prompt })).slice(0, 16);
  const basis = { prompt_version: promptVersion(), sources: sources.map(s => `${s.id}|${s.page}|${s.sha}`) };
  return { src, extra, sources, checks, hash, basis, index };
}

export function describeSource(index, id, page) {
  const s = index.sources[id];
  if (s.kind === 'notes') return `${id}: lecture notes, printed page ${page - (s.printed_offset || 0)} (PDF page ${page})`;
  if (s.kind === 'slides') return `${id}: lecture slides ${s.file}, slide ${page}`;
  return `${id}: ${s.title || s.file}, page ${page}`;
}

export function fileStem(id, page) { return `${id.replace(/[^A-Za-z0-9]+/g, '_')}_p${String(page).padStart(4, '0')}`; }

const PROMPT_FILE = path.join(ROOT, 'tools', 'verifier_prompt.md');
export function promptVersion() {
  const m = fs.readFileSync(PROMPT_FILE, 'utf8').match(/^<!-- version (\d+)/);
  if (!m) throw new Error('tools/verifier_prompt.md must start with "<!-- version N"');
  return +m[1];
}
function citationLegend(module) {
  const f = path.join(ROOT, 'modules', module, 'verify', 'citations.md');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim()
    : 'Citation codes: each tag is a source id from the course followed by a location (p = printed notes page, s = slide number, Q = question). `derived` = the author\'s own maths: check it mathematically. `outside: ...` = deliberately not from the course.';
}
// The verifier prompt with this module's citation legend filled in (modules/<m>/verify/citations.md).
export function promptTemplate(module) {
  return fs.readFileSync(PROMPT_FILE, 'utf8').replace(/^<!--[\s\S]*?-->\n*/, '').replace('{{CITATIONS}}', citationLegend(module));
}

// Snapshot of exactly what was verified (page.md + extra files), so a later edit can be re-checked from its diff.
export function snapshotDir(module, id) { return path.join(ROOT, 'modules', module, 'verify', 'snapshots', id); }
export function saveSnapshot(module, id, ctx) {
  const d = snapshotDir(module, id);
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'page.md'), ctx.src);
  for (const [k, v] of Object.entries(ctx.extra)) fs.writeFileSync(path.join(d, k), v);
}

// Open issues that block release. Issues from before severities existed count as major.
export const blocking = i => i.status === 'open' && i.severity !== 'minor';
