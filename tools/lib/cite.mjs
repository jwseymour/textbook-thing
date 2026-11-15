// Citation parsing and resolution against sources/<module>/index.json (built by tools/ingest).
// Grammar (docs/FORMAT.md): items separated by ";" or "·". Each item is
//   <source id> [locators]   e.g. "N p12-13", "N p12 fn7", "L2 s10-11, s15", "ES1 Q3", "T2023 Q6(a)", "Sol T2021 Q8", "Mock Q1"
//   derived                  own maths (must have a linked check)
//   outside: <what>          not from the course (numpy docs, study-skills research, ...)
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');

export function loadIndex(module) {
  const f = path.join(ROOT, 'sources', module, 'index.json');
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

const norm = s => s.replace(/[–—]/g, '-').replace(/\bp\.\s*/g, 'p').replace(/\bfn\s+/g, 'fn').replace(/\s+/g, ' ').trim();

export function splitCitation(src) {
  return String(src).split(/\s*[;·]\s*/).map(s => s.trim()).filter(Boolean);
}

function range(a, b) { const out = []; for (let i = a; i <= b; i++) out.push(i); return out; }

// Parse one item → {raw, type: 'source'|'derived'|'outside', id, locators, pages (PDF pages), error}
export function resolveItem(raw, index) {
  const item = norm(raw);
  if (/^derived$/i.test(item)) return { raw, type: 'derived' };
  const out = item.match(/^outside(?: course)?\s*:\s*(.+)$/i);
  if (out) return { raw, type: 'outside', what: out[1] };
  if (!index) return { raw, type: 'source', error: 'no source index (run tools/ingest)' };
  const ids = Object.keys(index.sources).sort((a, b) => b.length - a.length);
  const id = ids.find(i => item === i || item.startsWith(i + ' ') || item.startsWith(i + '('));
  if (!id) return { raw, type: 'source', error: `unknown source "${item.split(' ')[0]}"` };
  const s = index.sources[id];
  const rest = item.slice(id.length).trim();
  const r = { raw, type: 'source', id, kind: s.kind, pages: [] };
  const toks = rest ? rest.split(/[,\s]+/).filter(Boolean) : [];
  const bad = t => { r.error = `bad locator "${t}" for ${s.kind} source ${id}`; return r; };
  for (const t of toks) {
    let m;
    if (s.kind === 'notes' && (m = t.match(/^p(\d+)(?:-p?(\d+))?$/))) {
      const off = s.printed_offset || 0;
      for (const p of range(+m[1], +(m[2] || m[1]))) r.pages.push(p + off);
    } else if (s.kind === 'notes' && /^fn\d+$/.test(t)) {
      // footnote marker: page already given
    } else if (s.kind === 'slides' && (m = t.match(/^s(\d+)(?:-s?(\d+))?$/))) {
      r.pages.push(...range(+m[1], +(m[2] || m[1])));
    } else if (s.kind === 'sheet' && (m = t.match(/^Q(\d+)(?:-Q?(\d+))?((?:\([a-z0-9]+\)(?:-\([a-z0-9]+\))?)*)$/))) {
      for (const q of range(+m[1], +(m[2] || m[1]))) {
        const pg = (s.questions || {})[String(q)];
        if (!pg) { r.error = `${id} has no Question ${q}`; return r; }
        r.pages.push(...pg);
      }
    } else if (['tripos', 'solution', 'exam', 'report'].includes(s.kind) && /^(\([a-z0-9]+\)(-\([a-z0-9]+\))?)+$/.test(t)) {
      // question part, e.g. (a)(i)-(ii): whole question file is used
    } else return bad(t);
  }
  if (!r.pages.length) {
    if (s.kind === 'notes' || s.kind === 'slides') { r.error = `${id} needs a page/slide locator`; return r; }
    r.pages = range(1, s.pages || 1);
  }
  const outOfRange = r.pages.filter(p => p < 1 || p > (s.pages || 1));
  if (outOfRange.length) r.error = `${id}: page(s) ${outOfRange.join(',')} out of range (1-${s.pages}${s.printed_offset ? `, printed offset ${s.printed_offset}` : ''})`;
  r.pages = [...new Set(r.pages)].sort((a, b) => a - b);
  return r;
}

export function resolveCitation(src, index) {
  return splitCitation(src).map(i => resolveItem(i, index));
}

// Files for a resolved item: [{txt, png}] per page.
export function pageFiles(r, index) {
  const s = index.sources[r.id];
  return r.pages.map(p => {
    const b = path.join(ROOT, s.pages_dir, String(p).padStart(4, '0'));
    return { page: p, txt: b + '.txt', png: fs.existsSync(b + '.png') ? b + '.png' : null };
  });
}
