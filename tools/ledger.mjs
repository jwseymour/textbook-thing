// Inspect and resolve verifier issues. Usage:
//   tools/ledger <module> list [--open] [--page <id>]
//   tools/ledger <module> fix <issue-id> "<what was changed>"
//   tools/ledger <module> waive <issue-id> "<why it is not a problem>"
//   tools/ledger <module> reopen <issue-id>
import { loadLedger, saveLedger } from './lib/verifyctx.mjs';

const [module, cmd, id, ...rest] = process.argv.slice(2);
if (!module || !cmd) { console.error('usage: tools/ledger <module> list|fix|waive|reopen ...'); process.exit(2); }
const L = loadLedger(module);
const now = new Date().toISOString().slice(0, 16);
if (cmd === 'list') {
  const args = process.argv.slice(4);
  const page = args.includes('--page') ? args[args.indexOf('--page') + 1] : null;
  const rows = L.issues.filter(i => (!args.includes('--open') || i.status === 'open') && (!page || i.page === page));
  for (const i of rows) console.log(`[${i.status.toUpperCase()}] ${i.id}  ${i.category} (${i.severity || 'major'})\n   quote: ${i.quote}\n   source: ${i.source_says}\n   fix: ${i.fix}${i.resolution ? `\n   resolution: ${i.resolution}` : ''}\n`);
  const by = s => L.issues.filter(i => i.status === s).length;
  console.log(`${rows.length} shown · open ${by('open')} · fixed ${by('fixed')} · waived ${by('waived')} · pages verified ${Object.keys(L.pages).length}`);
} else if (['fix', 'waive', 'reopen'].includes(cmd)) {
  const it = L.issues.find(i => i.id === id);
  if (!it) { console.error(`no issue ${id}`); process.exit(1); }
  const note = rest.join(' ').trim();
  if (cmd !== 'reopen' && !note) { console.error(`${cmd} needs a note saying what was done / why`); process.exit(1); }
  it.status = cmd === 'fix' ? 'fixed' : cmd === 'waive' ? 'waived' : 'open';
  it.resolution = cmd === 'reopen' ? null : note;
  it.resolved = cmd === 'reopen' ? null : now;
  saveLedger(module, L);
  console.log(`${id} → ${it.status}`);
} else { console.error(`unknown command ${cmd}`); process.exit(2); }
