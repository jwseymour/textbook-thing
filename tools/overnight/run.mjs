// Unattended batch writer (2026-11-10): writes every lecture that is ready to write, one fresh headless Claude
// session per step, so no session ever holds more than one lecture and nothing is spent on orchestration.
//
// Per lecture (decision 0007):
//               register (module.yaml section, lectures.yaml chapter)  →  tools/describe (each slide image read once)
//            →  dossier  →  draft (Sonnet, high effort, within a page budget, from the dossier's text)
//            →  gates (checks, build, coverage gate; a repair session if they fail)
//            →  read (Opus reads the whole chapter as text and lists what is wrong; it edits nothing)
//            →  tools/verify + tools/omissions (the independent checkers, Sonnet)
//            →  fix (Opus: major issues and the reader's findings, no new pages)  →  gates  →  re-verify
//            →  tools/build <m> book
// One lecture at a time per module (a module's ledger, checks and errata are shared files); several modules at once.
// Everything is resumable: the real state is read from the repo (chapterState), out/overnight/state.json only
// remembers which steps are done. When Claude's usage limit is hit the runner waits and retries.
// It never releases, pushes, commits or deletes.
//
// Usage: tools/batch [--jobs 2] [--only progc:6,datasci:1] [--modules progc,datasci] [--dry-run]
//        [--effort high] [--fix-model opus]   (the defaults are the setting tested for decision 0007)
//        [--pause-at 0.9]   pause when the 5-hour usage window is this full; carry on after it resets
//        [--refit]   with --only: fit finished chapters to whole pages (decision 0008) without rewriting them
//        touch out/overnight/STOP   → finish the sessions in flight, start nothing new
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import YAML from 'yaml';
import { ROOT } from '../lib/cite.mjs';
import { loadLedger } from '../lib/verifyctx.mjs';
import { loadModule, loadTimeline, chapterState } from '../lib/book.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const JOBS = +opt('--jobs', 2), DRY = argv.includes('--dry-run');
const ONLY = opt('--only', '') ? opt('--only').split(',') : null;
const MODULES = (opt('--modules', 'progc,datasci,comparch,concdis,fgraphics,econlaw,unixtools')).split(',');
const OUT = path.join(ROOT, 'out', 'overnight');
fs.mkdirSync(path.join(OUT, 'reports'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'logs'), { recursive: true });
const EFFORT = opt('--effort', 'high');
const TAG = opt('--tag', '');   // a second runner on other modules keeps its own state and status files
const STATE_F = path.join(OUT, `state${TAG ? '-' + TAG : ''}.json`);
const state = fs.existsSync(STATE_F) ? JSON.parse(fs.readFileSync(STATE_F, 'utf8')) : {};
const save = () => { fs.writeFileSync(STATE_F, JSON.stringify(state, null, 1)); writeStatus(); };
const START = Date.now(), DEADLINE = START + 30 * 3600e3;
const LIMIT_RE = /hit your .{0,30}limit|\d-hour limit|weekly limit|· resets|usage limit|rate.?limit|hit your limit|limit reached|limit will reset|overloaded|quota|credit balance|resets? (at|in)|too many requests|\b(429|529)\b/i;
const WAIT_MIN = 5;
const MODEL = { draft: 'sonnet', read: 'opus', fix: opt('--fix-model', 'opus') };
const TIMEOUT_MIN = { draft: 180, read: 45, fix: 120, repair: 90, fit: 120 };
const REFIT = argv.includes('--refit');
const ts = () => new Date().toLocaleTimeString('en-GB', { hour12: false });
const say = s => console.log(`[${ts()}] ${s}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pad = n => String(n).padStart(2, '0');
const STOP_AFTER = opt('--stop-after', ''), IGNORE_STOP = argv.includes('--ignore-stop');
const stopping = () => (!IGNORE_STOP && fs.existsSync(path.join(OUT, 'STOP'))) || Date.now() > DEADLINE;
const childEnv = { ...process.env }; delete childEnv.CLAUDE_EFFORT;

function sh(cmd, args, log, { timeoutMin = 60, cwd = ROOT, onChild = null } = {}) {
  return new Promise(resolve => {
    const ch = spawn(cmd, args, { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    if (onChild) onChild(ch);
    let out = '';
    ch.stdout.on('data', d => (out += d)); ch.stderr.on('data', d => (out += d));
    const timer = setTimeout(() => ch.kill('SIGTERM'), timeoutMin * 60e3);
    ch.on('close', code => { clearTimeout(timer); if (log) fs.appendFileSync(log, `\n$ ${path.relative(ROOT, cmd)} ${args.join(' ')}  (exit ${code})\n${out}\n`); resolve({ code, out }); });
    ch.on('error', e => { clearTimeout(timer); resolve({ code: -1, out: String(e) }); });
  });
}
const tool = (name, args, log, o) => sh(path.join(ROOT, 'tools', name), args, log, o);

// ---------- usage gate (2026-11-11) ----------
// Pause when the 5-hour usage window is PAUSE_AT full, carry on when it resets. The level comes from the
// rate_limit_event that every headless session prints; a one-word Haiku session (about $0.0006) is the probe.
const PAUSE_AT = +opt('--pause-at', 0.9);
let usageAt = 0, usageLast = null;
async function usage() {   // { u: 0..1, reset: ms } or null when it cannot be read
  if (Date.now() - usageAt < 60e3) return usageLast;
  usageAt = Date.now();
  const r = await sh('claude', ['-p', 'Reply with the single word ok', '--model', 'haiku', '--output-format', 'stream-json', '--verbose', '--tools', '', '--strict-mcp-config', '--setting-sources', 'project', '--no-chrome'], null, { timeoutMin: 2, cwd: OUT });
  usageLast = null;
  for (const line of r.out.split('\n')) {
    let d; try { d = JSON.parse(line); } catch { continue; }
    if (d.type !== 'rate_limit_event' || !d.rate_limit_info) continue;
    const i = d.rate_limit_info, w = (i.unifiedWindows || {}).five_hour;
    if (w && typeof w.utilization === 'number') usageLast = { u: w.status === 'rejected' ? 1 : w.utilization, reset: w.resetsAt * 1000 };
    else if (i.rateLimitType === 'five_hour' && i.status === 'rejected') usageLast = { u: 1, reset: i.resetsAt * 1000 };
  }
  return usageLast;
}
async function usageGate(job) {
  for (;;) {
    const u = await usage();
    if (!u || u.u < PAUSE_AT) return;
    const until = Math.max(u.reset + 90e3, Date.now() + 5 * 60e3);
    const at = new Date(until).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    say(`${job.key}: 5-hour usage is at ${Math.round(u.u * 100)}%; paused until ${at}`);
    state[job.key].waiting = `paused: 5-hour usage at ${Math.round(u.u * 100)}%, carries on at ${at}`; save();
    await sleep(until - Date.now());
    delete state[job.key].waiting; usageAt = 0; save();
  }
}

// One headless Claude session in the repo root. Pauses at the usage gate; waits and retries if the limit is hit anyway.
async function session(job, kind, model, prompt) {
  const base = ['--output-format', 'json', '--model', model, '--effort', EFFORT,
    '--tools', 'Read,Glob,Grep,Bash,Write,Edit', '--allowedTools', 'Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash',
    '--disallowedTools', 'Bash(git:*)', 'Bash(tools/release:*)', 'Bash(curl:*)', 'Bash(wget:*)', 'Bash(sudo:*)',
    '--permission-mode', 'dontAsk', '--setting-sources', 'project', '--strict-mcp-config', '--no-chrome'];
  // A session cut off by the usage limit is resumed (its context is kept), not started again from nothing.
  // The open session's id is kept in the state file, so a runner that is stopped and started again resumes it too.
  const st0 = state[job.key], saved = st0.open && st0.open.kind === kind ? st0.open.sid : null;
  let sid = saved || randomUUID(), resume = !!saved, counted = 0;   // counted: cost already added for this session id (a resumed session reports its running total)
  const done = r => { delete state[job.key].open; save(); return r; };
  const CONT = 'Your session was cut off by a usage limit and has now been resumed. Check the state of the files you were working on, then continue from where you stopped and finish the whole job as originally instructed, ending with the same final line.';
  fs.writeFileSync(path.join(OUT, 'logs', `${job.key}-${kind}.prompt.md`), prompt);
  for (let fails = 0; ;) {
    if (Date.now() > DEADLINE) return { ok: false, why: 'deadline' };
    await usageGate(job);
    const t0 = Date.now();
    state[job.key].open = { kind, sid }; save();
    say(`${job.key}: ${kind} session (${model}) ${resume ? 'resumes' : 'starts'}`);
    const args = resume ? ['-p', CONT, '--resume', sid, ...base] : ['-p', prompt, '--session-id', sid, ...base];
    // While it runs, look at the usage level every 3 minutes; at the gate, stop the session (it is resumed after the reset).
    let child = null, gated = false;
    const watch = setInterval(async () => { const u = await usage(); if (u && u.u >= PAUSE_AT && child && !gated) { gated = true; child.kill('SIGTERM'); } }, 180e3);
    const r = await sh('claude', args, null, { timeoutMin: TIMEOUT_MIN[kind] || 120, onChild: c => (child = c) });
    clearInterval(watch);
    const mins = +((Date.now() - t0) / 60e3).toFixed(1);
    let res = null; try { res = JSON.parse(r.out.slice(r.out.indexOf('{'))); } catch { /* not JSON */ }
    const text = res ? String(res.result ?? '') : r.out;
    fs.appendFileSync(job.log, `\n===== ${kind} session (${model}), ${mins} min, exit ${r.code}, cost $${res?.total_cost_usd ?? '?'}, turns ${res?.num_turns ?? '?'} =====\n${text.slice(-6000)}\n`);
    const st = state[job.key];
    const spent = Math.max(0, (res?.total_cost_usd || 0) - counted); counted += spent;
    st.cost = +((st.cost || 0) + spent).toFixed(2);
    st.costs = st.costs || {}; st.costs[kind] = +((st.costs[kind] || 0) + spent).toFixed(2);
    st.mins = st.mins || {}; st.mins[kind] = +((st.mins[kind] || 0) + mins).toFixed(1);
    st.minutes = +((st.minutes || 0) + mins).toFixed(1);
    st.sessions = (st.sessions || 0) + 1; save();
    if (r.code === 0 && res && !res.is_error) { say(`${job.key}: ${kind} session done in ${mins} min — ${text.trim().split('\n').pop().slice(0, 160)}`); return done({ ok: true, text }); }
    if (gated) { say(`${job.key}: ${kind} session stopped at the usage gate after ${mins} min`); if (resume || mins >= 0.5) resume = true; else { sid = randomUUID(); counted = 0; } continue; }
    if (LIMIT_RE.test(text.slice(-2000)) || (mins < 2 && LIMIT_RE.test(r.out.slice(-2000)))) {
      say(`${job.key}: usage limit (${text.trim().slice(-120).replace(/\s+/g, ' ')}); waiting ${WAIT_MIN} min`);
      st.waiting = `usage limit since ${ts()}`; save();
      if (mins >= 2) resume = true; else if (!resume) { sid = randomUUID(); counted = 0; }   // a session refused at once still claims its id: start the next try under a new one
      await sleep(WAIT_MIN * 60e3); delete st.waiting; continue;
    }
    if (resume && mins < 2) { say(`${job.key}: could not resume the session; starting it again`); resume = false; sid = randomUUID(); counted = 0; continue;
    }
    if (!resume && /already in use/i.test(text)) { sid = randomUUID(); counted = 0; }
    fails++;
    say(`${job.key}: ${kind} session failed (exit ${r.code}, ${mins} min): ${text.trim().slice(-200).replace(/\s+/g, ' ')}`);
    if (fails >= 2) return done({ ok: false, why: `${kind} session failed twice` });
    await sleep(60e3);
  }
}

function fill(name, job, extra = {}) {
  const read = f => fs.readFileSync(path.join(ROOT, 'tools', 'overnight', f), 'utf8');
  const mod = loadModule(job.m);
  // Page budget: about one page per two slide groups the lecture covered (slides are often progressive builds), 6 to 12.
  const cov = JSON.parse(fs.readFileSync(path.join(ROOT, 'out', job.m, 'coverage', `L${pad(job.n)}.json`), 'utf8'));
  const groups = new Set(cov.slides.filter(s => s.status === 'covered').map(s => s.group)).size;
  // An earlier version of the chapter, archived when the pipeline changed: raw material, not a template.
  const prevDir = fs.readdirSync(path.join(ROOT, 'archive')).filter(d => /^chapters-/.test(d)).sort().reverse()
    .map(d => path.join('archive', d, 'modules', job.m)).find(d => fs.existsSync(path.join(ROOT, d, 'content', job.ch)));
  const PREV = prevDir ? `An earlier version of this chapter is in \`${prevDir}/\` (\`content/${job.ch}/\`, \`checks/\`, \`figures/\`, \`questions/\`). `
    + 'It was written under different rules: it is longer than your budget and it teaches past-paper material that was not lectured this year. '
    + 'Plan your topics from the dossier first. Then you may read the old pages (text only) and reuse what fits this year\'s lecture and your budget: a worked example, a model answer, a check, the code of a figure (copy it into your own files; do not import from the archive). Check anything you reuse against the dossier as if you had written it. Do not copy its structure, its length or its not-lectured sections.'
    : '(none: this lecture has not been written before)';
  const vars = { M: job.m, N: job.n, CH: job.ch, TITLE: job.title, DOSSIER: `L${pad(job.n)}.md`, NOTE: job.note || '(none)', SLIDES: groups, PAGES: Math.min(12, Math.max(6, Math.round(groups / 2))), PREV,
    NONEXAM: (mod.non_examinable || []).length ? JSON.stringify(mod.non_examinable) : '(nothing is marked non-examinable)', ...extra };
  let s = read(name).replace('{{COMMON}}', read('common.md')).replace('{{FITTING}}', read('fitting.md'));
  for (const [k, v] of Object.entries(vars)) s = s.split(`{{${k}}}`).join(String(v));
  return s;
}

// The mechanical gates. Returns '' when clean, otherwise the output to hand to a repair session.
async function gates(job) {
  const bad = [];
  const cdir = path.join(ROOT, 'modules', job.m, 'content', job.ch);
  if (!fs.existsSync(cdir) || !fs.readdirSync(cdir).some(f => /^\d+_.*\.md$/.test(f) && !f.startsWith('99'))) return 'The chapter has no topic pages yet.';
  if (!fs.readdirSync(cdir).some(f => f.startsWith('99'))) bad.push('The chapter has no answers page (99_answers.md).');
  const c = await tool('checks', [job.m], job.log);
  if (c.code !== 0) bad.push(`$ tools/checks ${job.m} (exit ${c.code})\n${c.out.slice(-5000)}`);
  const b = await tool('build', [job.m, job.ch], job.log);
  if (b.code !== 0) bad.push(`$ tools/build ${job.m} ${job.ch} (exit ${b.code})\n${b.out.slice(-7000)}`);
  await tool('lectures', [job.m], null);
  const g = await tool('lectures', [job.m, 'gate', String(job.n)], job.log);
  const st = cstate(job);
  if (st.gateMissing.length) bad.push(`$ tools/lectures ${job.m} gate ${job.n}\n${g.out.slice(-4000)}`);
  if (b.code === 0 && st.lint) bad.push(`The build reports ${st.lint} problem(s) (out/${job.m}/${job.ch}/report.json "problems").`);
  return bad.join('\n\n');
}
const cstate = job => chapterState(job.m, loadModule(job.m), job.ch, { ledger: loadLedger(job.m), timeline: loadTimeline(job.m) });
const openIssues = job => { const st = cstate(job); const ids = new Set(st.pages.map(p => p.id)); return loadLedger(job.m).issues.filter(i => i.status === 'open' && ids.has(i.page)); };

async function gated(job, stage) {
  for (let i = 0; i < 3; i++) {
    const bad = await gates(job);
    if (!bad) return true;
    if (i === 2) { say(`${job.key}: gates still failing after ${stage} and 2 repairs`); return false; }
    say(`${job.key}: gates fail after ${stage}; repair ${i + 1}`);
    const r = await session(job, 'repair', stage === 'draft' ? MODEL.draft : MODEL.fix, fill('repair.md', job, { PROBLEMS: bad.slice(0, 20000) }));
    if (!r.ok) return false;
  }
}

// Run one of the existing checkers; wait and retry while it fails because of the usage limit.
async function checker(job, name, args) {
  for (let fails = 0; ;) {
    if (Date.now() > DEADLINE) return false;
    await usageGate(job);
    say(`${job.key}: tools/${name} ${args.join(' ')}`);
    const r = await tool(name, args, job.log, { timeoutMin: 240 });
    const failedLines = r.out.split('\n').filter(l => l.startsWith('✗'));
    if (r.code === 0 && !failedLines.length) return true;
    if (LIMIT_RE.test(failedLines.join('\n') || r.out.slice(-1500))) { say(`${job.key}: usage limit during ${name}; waiting ${WAIT_MIN} min`); state[job.key].waiting = `usage limit since ${ts()}`; save(); await sleep(WAIT_MIN * 60e3); delete state[job.key].waiting; continue; }
    if (++fails >= 3) { say(`${job.key}: tools/${name} did not finish: ${(failedLines[0] || r.out.slice(-200)).slice(0, 200)}`); return false; }
    await sleep(30e3);
  }
}

// Text edits, so the hand-written layout and comments of the two files survive; the result is parsed to make sure.
function register(job) {
  const mf = path.join(ROOT, 'modules', job.m, 'module.yaml');
  let src = fs.readFileSync(mf, 'utf8');
  if (!((YAML.parse(src).sections || {})[job.ch])) {
    const line = `  ${job.ch}: {title: ${JSON.stringify(job.title)}, tab: ${JSON.stringify(`Lecture ${job.n} — ${job.title}`)}, theme: cgp, lecture: ${job.n}}`;
    if (/^sections: \{\}[ \t]*$/m.test(src)) src = src.replace(/^sections: \{\}[ \t]*$/m, `sections:\n${line}`);
    else {
      const lines = src.split('\n'), i0 = lines.findIndex(l => /^sections:\s*$/.test(l));
      if (i0 < 0) throw new Error(`${job.m}/module.yaml: cannot find sections:`);
      let i = i0 + 1; while (i < lines.length && (/^\s+\S/.test(lines[i]) || /^\s*$/.test(lines[i]) && /^\s+\S/.test(lines[i + 1] || ''))) i++;
      lines.splice(i, 0, line); src = lines.join('\n');
    }
    const sec = (YAML.parse(src).sections || {})[job.ch];
    if (!sec || sec.lecture !== job.n) throw new Error(`${job.m}/module.yaml: could not add section ${job.ch}`);
    fs.writeFileSync(mf, src);
  }
  const lf = path.join(ROOT, 'modules', job.m, 'lectures.yaml');
  src = fs.readFileSync(lf, 'utf8');
  const has = s => (YAML.parse(s).lectures.find(x => +x.n === job.n) || {}).chapter === job.ch;
  if (!has(src)) {
    const flow = new RegExp(`^(\\s*- \\{n: ${job.n},)`, 'm'), block = new RegExp(`^(\\s*)- n: ${job.n}\\s*$`, 'm');
    if (flow.test(src)) src = src.replace(flow, `$1 chapter: ${job.ch},`);
    else if (block.test(src)) src = src.replace(block, (l, ind) => `${l}\n${ind}  chapter: ${job.ch}`);
    if (!has(src)) throw new Error(`${job.m}/lectures.yaml: could not set chapter for Lecture ${job.n}`);
    fs.writeFileSync(lf, src);
  }
}

async function runLecture(job) {
  const st = (state[job.key] = state[job.key] || { done: {} });
  st.mode = job.mode; st.done = st.done || {}; st.effort = EFFORT;
  Object.assign(st, { status: 'running', started: st.started || new Date().toISOString(), stage: st.stage || 'register' });
  delete st.why; save();
  const fail = why => { Object.assign(st, { status: 'held', why }); save(); say(`${job.key}: HELD — ${why}`); return false; };
  const stage = s => { st.stage = s; save(); };

  if (job.mode === 'write') {
    register(job);
    await tool('lectures', [job.m], null);
    await tool('describe', [job.m, String(job.n)], job.log, { timeoutMin: 60 });   // each slide image read once, kept as text
    await tool('lectures', [job.m, 'dossier', String(job.n)], job.log);
    if (!st.done.draft) {
      stage('draft');
      const r = await session(job, 'draft', MODEL.draft, fill('draft.md', job));
      if (!r.ok) return fail(r.why);
      if (!(await gated(job, 'draft'))) return fail('the draft does not pass the build, checks or coverage gate');
      st.done.draft = true; save();
    }
    if (STOP_AFTER === 'draft') { Object.assign(st, { status: 'paused', stage: 'drafted' }); save(); return true; }
  } else if (job.mode === 'fit') {
    // An existing chapter is fitted to whole pages (decision 0008): same teaching, no blank bands. Then it is
    // checked again like any edited chapter (the verifier rechecks only the pages that changed).
    if (!st.done.fit) {
      stage('fitting to whole pages');
      const b = await tool('build', [job.m, job.ch, '--no-pdf', '--no-shots'], job.log);
      const rep = JSON.parse(fs.readFileSync(path.join(ROOT, 'out', job.m, job.ch, 'report.json'), 'utf8'));
      const kinds = Object.fromEntries(rep.pages.map(p => [p.id, p.kind || 'content']));
      const cs = (rep.sheets || []).filter(x => x.topics.some(t => kinds[t] === 'content'));
      const used = cs.reduce((a, x) => a + (x.height - x.free) / x.height, 0);
      const fitRep = (b.out.split('\nFIT ')[1] || '').split('\nANATOMY')[0].split('\nLINT')[0].split('\n').filter(l => !/^\s+blocks:/.test(l) || l.length < 1500).join('\n');
      if (cs.some(x => x.free > 70)) {
        const r = await session(job, 'fit', MODEL.draft, fill('fit.md', job, { NOW: `${cs.length} topic pages, ${Math.round(100 * (1 - used / cs.length))}% of their height blank`, TARGET: Math.max(1, Math.round(used)), FITREPORT: 'FIT ' + fitRep.trim() }));
        if (!r.ok) return fail(r.why);
      }
      if (!(await gated(job, 'draft'))) return fail('after fitting, the chapter does not pass the build, checks or coverage gate');
      st.done.fit = true; save();
    }
  } else if (await gates(job)) { if (!(await gated(job, 'fix'))) return fail('the existing chapter does not pass the build, checks or coverage gate'); }

  // One text-only read of the whole chapter by a stronger model; its findings go to the first fix round.
  const readF = path.join(OUT, 'reports', `${job.m}-${job.ch}-read.md`);
  if (!st.done.read) {
    stage('whole-chapter read');
    const r = await session(job, 'read', MODEL.read, fill('read.md', job));
    if (!r.ok) return fail(r.why);
    fs.writeFileSync(readF, r.text); st.done.read = true; st.readPending = true; save();
  }
  // Independent checking, then fix rounds until no major issue is open (at most 4 rounds; minor leftovers are accepted after the first).
  for (let round = 1; round <= 4; round++) {
    stage(`checking (round ${round})`);
    if (cstate(job).unverified.length && !(await checker(job, 'verify', [job.m, job.ch, '--jobs', '2']))) return fail('the verifier did not finish');
    if (!cstate(job).complete && !(await checker(job, 'omissions', [job.m, job.ch]))) return fail('the completeness review did not finish');
    let open = openIssues(job), s = cstate(job);
    st.major = open.filter(i => (i.severity || 'major') === 'major').length; st.minor = open.length - st.major;
    if (!st.firstCheck) st.firstCheck = { major: st.major, minor: st.minor, pages: s.sheets, effort: EFFORT };
    save();
    const extra = st.readPending && fs.existsSync(readF) ? fs.readFileSync(readF, 'utf8') : '';
    if (!open.length && !extra) { if (!s.unverified.length && s.complete) break; continue; }
    if (round > 1 && !st.major && !extra) break;
    if (round === 4) break;
    stage(`fixing ${open.length} issue(s) (round ${round})`);
    const list = open.map(i => `- **${i.id}** — ${i.category} (${i.severity || 'major'}), page \`${i.page}\`\n  - quote: ${i.quote}\n  - source says: ${i.source_says}\n  - suggested fix: ${i.fix}`).join('\n');
    const r = await session(job, 'fix', MODEL.fix, fill('fix.md', job, { ISSUES: list || '(none)', READ: extra || '(none)' }));
    if (!r.ok) return fail(r.why);
    if (extra) { delete st.readPending; save(); }
    if (!(await gated(job, 'fix'))) return fail('after the fixes the chapter does not pass the build, checks or coverage gate');
  }
  await tool('lectures', [job.m], null);
  const s = cstate(job), open = openIssues(job);
  st.major = open.filter(i => (i.severity || 'major') === 'major').length; st.minor = open.length - st.major;
  st.pages = s.sheets; st.finishedAt = new Date().toISOString();
  if (!s.finished) return fail(s.why);
  Object.assign(st, { status: 'finished', stage: 'done' }); save();
  say(`${job.key}: FINISHED (${s.sheets} pages, ${st.minor} minor issue(s) left open, $${st.cost}, ${st.minutes} session-min)`);
  if (loadModule(job.m).book) await tool('build', [job.m, 'book'], job.log);
  return true;
}

function writeStatus() {
  const rows = queue.map(j => { const s = state[j.key] || {}; return `| ${j.m} | ${j.n} | ${j.title.slice(0, 44)} | ${s.status || 'queued'} | ${s.waiting || s.stage || ''} | ${s.pages ?? ''} | ${s.major ?? ''}/${s.minor ?? ''} | ${s.cost ?? ''} | ${s.why || ''} |`; });
  const n = k => queue.filter(j => (state[j.key] || {}).status === k).length;
  fs.writeFileSync(path.join(OUT, `STATUS${TAG ? '-' + TAG : ''}.md`), `# Batch writer — ${new Date().toLocaleString('en-GB')}\n\n${n('finished')} finished, ${n('held')} held back, ${n('running')} running, ${queue.length - n('finished') - n('held') - n('running')} queued. `
    + `Total session cost reported: $${Object.values(state).reduce((a, s) => a + (s.cost || 0), 0).toFixed(2)}.\n\n| Module | L | Title | Status | Stage | Pages | Open major/minor | $ | Why held |\n|---|---|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`);
}

// ---------- the queue ----------
const queue = [];
for (const m of MODULES) {
  await tool('lectures', [m], null);
  const t = loadTimeline(m), mod = loadModule(m);
  if (!t) continue;
  const jobs = [];
  for (const L of t.lectures) {
    const ch = L.chapter || `l${pad(L.n)}`;
    const key = `${m}-${ch}`;
    const base = { m, n: L.n, ch, key, title: L.title + (L.given === false ? ' (not lectured in 2026–27: not examinable this year)' : ''), note: L.note || '', slides: +L.slides || 0, log: path.join(OUT, 'logs', `${key}.log`) };
    if (REFIT && ONLY && ONLY.includes(`${m}:${L.n}`) && L.chapter && state[key]) {
      if (state[key].status === 'finished') { state[key].status = 'queued'; delete state[key].done.fit; delete state[key].stage; }
      jobs.push({ ...base, mode: 'fit' }); continue;
    }
    if ((state[key] || {}).status === 'finished') { queue.push({ ...base, mode: 'done' }); continue; }
    const ps = state[key];
    const was = ps && (ps.mode || ((ps.done && ps.done.draft) || ['register', 'draft'].includes(ps.stage) ? 'write' : 'fix'));
    if (ps && L.chapter && !['not yet', 'not given', 'not examinable'].includes(L.state)) jobs.push({ ...base, mode: was });
    else if (L.state === 'ready to write') jobs.push({ ...base, mode: 'write' });
    else if (L.chapter && (mod.sections || {})[L.chapter] && ['built', 'drafted'].includes(L.state) && !state[key]) {
      const s = chapterState(m, mod, L.chapter);
      if (!s.finished) jobs.push({ ...base, mode: 'fix' });
    }
  }
  jobs.sort((a, b) => (a.mode === 'fix' ? 0 : 1) - (b.mode === 'fix' ? 0 : 1) || a.n - b.n); // existing chapters first, then lecture order
  queue.push(...jobs);
}
let todo = queue.filter(j => j.mode !== 'done' && (!ONLY || ONLY.includes(`${j.m}:${j.n}`)));
say(`${todo.length} lecture(s) to do: ` + MODULES.map(m => `${m} ${todo.filter(j => j.m === m).map(j => j.n + (j.mode === 'fix' ? '*' : '')).join(',') || '—'}`).join(' · ') + '  (* = fix an existing chapter)');
if (DRY) { for (const j of todo.slice(0, 2)) { console.log(`\n--- ${j.key} draft prompt ---\n` + fill('draft.md', j)); } process.exit(0); }
save();

const busy = new Set(), attempts = {}, failures = {}, paused = new Set();
async function worker() {
  for (;;) {
    if (stopping()) return;
    // The free module with the fewest lectures attempted so far goes next, so every module gets its pilot first.
    const cand = MODULES.filter(m => !busy.has(m) && !paused.has(m) && todo.some(j => j.m === m)).sort((a, b) => (attempts[a] || 0) - (attempts[b] || 0));
    if (!cand.length) { if (!busy.size || !todo.some(j => !paused.has(j.m))) return; await sleep(20e3); continue; }
    const m = cand[0], job = todo.find(j => j.m === m);
    todo = todo.filter(j => j !== job); busy.add(m); attempts[m] = (attempts[m] || 0) + 1;
    let ok = false;
    try { ok = await runLecture(job); } catch (e) { say(`${job.key}: runner error ${e.stack || e}`); Object.assign(state[job.key] || (state[job.key] = {}), { status: 'held', why: `runner error: ${e.message}` }); save(); }
    if (!ok) { failures[m] = (failures[m] || 0) + 1; if (failures[m] >= 2 && failures[m] === attempts[m]) { paused.add(m); say(`${m}: the first two lectures were both held back; pausing this module`); } }
    busy.delete(m);
    if (!ONLY && (!todo.some(j => j.m === m) || paused.has(m))) { say(`${m}: bringing the module up to date (tools/update ${m} --no-fetch)`); await tool('update', [m, '--no-fetch'], path.join(OUT, 'logs', `${m}-update.log`), { timeoutMin: 240 }); }
  }
}
await Promise.all(Array.from({ length: JOBS }, (_, i) => sleep(i * 5000).then(worker)));
save();
say(`batch over: ${queue.filter(j => (state[j.key] || {}).status === 'finished').length} finished, ${queue.filter(j => (state[j.key] || {}).status === 'held').length} held back. See out/overnight/STATUS.md`);
