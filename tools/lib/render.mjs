// Page source (Markdown + directives, docs/FORMAT.md) → HTML fragment, collecting lint problems as it goes.
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import remarkDirective from 'remark-directive';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import katex from 'katex';
import YAML from 'yaml';
import { resolveCitation } from './cite.mjs';

const parser = unified().use(remarkParse).use(remarkFrontmatter).use(remarkGfm).use(remarkDirective).use(remarkMath);

// ---------- vocabulary ----------
export const BOXES = {
  definition: { cls: '', label: 'Definition' },
  example: { cls: 'ex', label: 'Example' },
  warn: { cls: 'warn', label: 'Watch out' },
  check: { cls: 'check', label: 'Sanity check' },
  tip: { cls: 'tip', label: 'Tip' },
  exam: { cls: 'exam', label: 'Exam' },
  plain: { cls: 'plain', label: 'Note' },
  plugin: { cls: 'plug', label: 'Key principle' },
};
const CLASSES = new Set(['bottom', 'small', 'muted', 'center', 'cols2', 'blue', 'red', 'big', 'rv', 'cmp', 'keygrid', 'ans', 'grow', 'o', 'mistake', 'grey', 'left', 'twocol']);
const CONTAINERS = {
  intro: [], cols: ['split'], col: ['src', 'check'], row: ['align'], grow: [], side: ['w', 'align'], div: [],
  warmup: [], table: ['widths', 'colclass', 'src'], html: [],
  answers: ['from', 'to'], 'question-answers': ['section', 'cols'],
  // CGP theme (decision 0003)
  formula: ['src', 'check'], step: [], note: ['w', 'src', 'check'], figbox: ['name', 'w', 'src', 'check'],
  ...Object.fromEntries(Object.keys(BOXES).map(b => [b, ['label', 'src', 'check']])),
};
const LEAVES = { fig: ['name', 'w', 'h'], contents: [], summary: [], questions: ['section', 'answered'], errata: ['section'], pagebreak: [], examq: ['ids'], edition: [] };
const TEXTS = { src: [], hl: [], kw: [], kg: [], ko: [], hand: [], small: [], muted: [], pageref: [], check: [], fig: [], tick: [], u: [], sub: [], sup: [], lab: ['x', 'y', 'w'], fbox: [] };
export const FRONT = new Set(['id', 'title', 'subtitle', 'tab', 'ref', 'strip', 'summary', 'summary_group', 'kind', 'nav', 'short', 'contents', 'contents_ref', 'footer', 'mark', 'level', 'board', 'tagline', 'badge']);

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function parsePage(src, file) {
  const problems = [];
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(src)) {
    const i = src.search(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/);
    problems.push({ file, line: src.slice(0, i).split('\n').length, msg: `control character U+${src.charCodeAt(i).toString(16).padStart(4, '0')} in source (the pilot's \\theta → TAB bug)` });
  }
  const tree = parser.parse(src);
  let fm = {};
  if (tree.children[0] && tree.children[0].type === 'yaml') {
    try { fm = YAML.parse(tree.children[0].value) || {}; } catch (e) { problems.push({ file, line: 1, msg: 'front matter: ' + e.message }); }
    tree.children.shift();
  }
  for (const k of Object.keys(fm)) if (!FRONT.has(k)) problems.push({ file, line: 1, msg: `unknown front-matter key "${k}"` });
  if (!fm.id) problems.push({ file, line: 1, msg: 'front matter needs an id' });
  if (!fm.title) problems.push({ file, line: 1, msg: 'front matter needs a title' });
  return { fm, tree, problems };
}

// ---------- renderer ----------
// ctx: { file, index, macros, figures(name)->svg|null, checkIds:Set, checkResults:{id:{ok}}, pageNum(id)->n|null,
//        problems:[], blocks:[], gen:{...generators}, mathCount }
export function renderTree(tree, ctx) {
  ctx.h2 = 0;
  if (ctx.theme !== 'cgp') return renderChildren(tree.children, ctx, { tight: false });
  // cgp: each top-level block is followed by a hidden marker naming the sources it cites, so that after the blocks
  // have been flowed onto sheets each sheet's "Sources:" line lists what is cited on that sheet.
  return (tree.children || []).map(c => {
    const from = (ctx.srcShown || []).length;
    const h = render(c, ctx, { tight: false });
    const got = [...new Set((ctx.srcShown || []).slice(from))];
    return h + (got.length && h.trim() ? `<i class="srcs" hidden data-s="${esc(got.join(' · '))}"></i>` : '');
  }).join('');
}

function line(n) { return n && n.position ? n.position.start.line : '?'; }
function problem(ctx, node, msg) { ctx.problems.push({ file: ctx.file, line: line(node), msg }); }

function renderChildren(children, ctx, opt) {
  return (children || []).map(c => render(c, ctx, opt)).join('');
}

function attrsOf(node, allowed, ctx) {
  const a = { ...(node.attributes || {}) };
  const classes = (a.class || '').split(/\s+/).filter(Boolean);
  delete a.class;
  for (const k of Object.keys(a)) if (!allowed.includes(k)) problem(ctx, node, `unknown attribute "${k}" on ${node.name}`);
  for (const c of classes) if (!CLASSES.has(c)) problem(ctx, node, `unknown class ".${c}" on ${node.name}`);
  return { a, classes };
}

export function math(src, display, ctx, node) {
  ctx.mathCount = (ctx.mathCount || 0) + 1;
  try {
    return katex.renderToString(src, { displayMode: display, throwOnError: true, strict: 'error', macros: { ...ctx.macros }, output: 'html' });
  } catch (e) {
    problem(ctx, node, `maths: ${e.message.split('\n')[0]}  in  ${src.slice(0, 60)}`);
    return `<span style="color:red">[MATH ERROR]</span>`;
  }
}

function citeTag(srcText, ctx, node) {
  const items = resolveCitation(srcText, ctx.index);
  for (const r of items) if (r.error) problem(ctx, node, `citation "${r.raw}": ${r.error}`);
  ctx.citations.push(...items.filter(r => !r.error));
  const shown = String(srcText).replace(/\s*;\s*/g, ' · ').replace(/\bp(\d)/g, 'p.$1').replace(/(\d)-(\d)/g, '$1–$2')
    .replace(/\bderived\b/g, '[derived]').replace(/outside(?: course)?:\s*/gi, '');
  (ctx.srcShown ||= []).push(...shown.split(' · ').map(x => x.trim()).filter(Boolean));
  return { html: esc(shown), items };
}

function checkTag(idList, ctx, node) {
  const ids = String(idList).split(/[\s,]+/).filter(Boolean);
  let allOk = ids.length > 0;
  for (const id of ids) {
    if (!ctx.checkIds.has(id)) { problem(ctx, node, `check "${id}" has no matching test in checks/`); allOk = false; continue; }
    ctx.checks.push(id);
    const r = ctx.checkResults[id];
    if (!(r && r.ok)) allOk = false;
  }
  // Only claim "checked" when every linked check actually ran and passed.
  if (ctx.theme === 'cgp') return '';
  return allOk ? `<span class="chk" title="computer-checked: ${esc(ids.join(', '))}">✓ checked</span>` : '';
}

function textOf(node) {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value;
  if (node.type === 'inlineMath') return '$' + node.value + '$';
  return (node.children || []).map(textOf).join('');
}

// A "block" for citation lint: boxes, cols' columns, and each h2 section at page level.
function hasCitation(nodes) {
  let found = false;
  const walk = n => {
    if (found) return;
    if ((n.type === 'textDirective' && n.name === 'src') || (n.attributes && n.attributes.src)) found = true;
    (n.children || []).forEach(walk);
  };
  (Array.isArray(nodes) ? nodes : [nodes]).forEach(walk);
  return found;
}
function hasMath(nodes) {
  let found = false;
  const walk = n => { if (n.type === 'math' || n.type === 'inlineMath') found = true; (n.children || []).forEach(walk); };
  (Array.isArray(nodes) ? nodes : [nodes]).forEach(walk);
  return found;
}
function citesDerived(nodes) {
  let found = false;
  const walk = n => {
    if (n.type === 'textDirective' && n.name === 'src' && /\bderived\b/i.test(textOf(n))) found = true;
    if (n.attributes && n.attributes.src && /\bderived\b/i.test(n.attributes.src)) found = true;
    (n.children || []).forEach(walk);
  };
  (Array.isArray(nodes) ? nodes : [nodes]).forEach(walk);
  return found;
}
function hasCheck(nodes) {
  let found = false;
  const walk = n => { if ((n.type === 'textDirective' && n.name === 'check') || (n.attributes && n.attributes.check)) found = true; (n.children || []).forEach(walk); };
  (Array.isArray(nodes) ? nodes : [nodes]).forEach(walk);
  return found;
}

export function lintBlocks(tree, ctx) {
  // Page-level h2 sections and every box / col must carry a citation.
  const kids = tree.children;
  let i = 0;
  while (i < kids.length) {
    const n = kids[i];
    if (n.type === 'heading' && n.depth === 2) {
      // cgp theme: a section is everything up to the next ## (its panels and notes included) and needs one citation.
      let j = i + 1; while (j < kids.length && !(kids[j].type === 'heading' && kids[j].depth <= 2) && (ctx.theme === 'cgp' || kids[j].type !== 'containerDirective')) j++;
      const sect = kids.slice(i, j);
      if (sect.length > 1 && !hasCitation(sect)) problem(ctx, n, `section "${textOf(n)}" has no citation (:src[...] or [derived])`);
      i = j; continue;
    }
    if (n.type === 'paragraph' || n.type === 'list' || n.type === 'table') {
      if (!hasCitation(n) && textOf(n).trim().length > 60) problem(ctx, n, `top-level text "${textOf(n).slice(0, 40)}…" has no citation`);
    }
    i++;
  }
  const generatedOnly = n => (n.children || []).every(c => c.type === 'leafDirective' && ['contents', 'summary', 'questions', 'errata', 'edition'].includes(c.name) || (c.type === 'heading'));
  const walk = (n, citedAbove) => {
    const isBlock = n.type === 'containerDirective' && (BOXES[n.name] || n.name === 'col');
    const cited = n.attributes && n.attributes.src;
    if (isBlock && !citedAbove && !generatedOnly(n) && !hasCitation(n)) problem(ctx, n, `${n.name} "${(n.attributes || {}).label || textOf(n).slice(0, 30)}" has no citation`);
    if (isBlock && citesDerived(n) && hasMath(n) && !hasCheck(n)) problem(ctx, n, `${n.name} cites [derived] maths but links no check (check=<id>)`);
    (n.children || []).forEach(c => walk(c, citedAbove || (isBlock && !!cited)));
  };
  kids.forEach(n => walk(n, false));
}

function highlightPy(code) {
  return code.split('\n').map(l => {
    const ci = l.indexOf('#');
    let body = ci >= 0 ? l.slice(0, ci) : l;
    const com = ci >= 0 ? l.slice(ci) : '';
    body = esc(body).replace(/\b(def|return|lambda|for|in|import|from|if|else|elif|while|as|not|and|or)\b/g, '<span class="k">$1</span>');
    return body + (com ? `<span class="c">${esc(com)}</span>` : '');
  }).join('\n');
}

// C / C++: keywords and // or single-line /* */ comments (enough for short guide excerpts).
function highlightC(code) {
  const KW = /\b(int|char|double|float|long|short|unsigned|signed|void|bool|struct|union|enum|typedef|const|volatile|static|extern|return|if|else|for|while|do|switch|case|break|continue|sizeof|NULL|true|false|class|public|private|protected|virtual|template|typename|new|delete|nullptr|auto|size_t)\b/g;
  return code.split('\n').map(l => {
    const m = l.match(/\/\/|\/\*/);
    const ci = m ? m.index : -1;
    const body = ci >= 0 ? l.slice(0, ci) : l, com = ci >= 0 ? l.slice(ci) : '';
    return esc(body).replace(KW, '<span class="k">$1</span>').replace(/^(\s*)(#\s*\w+)/, '$1<span class="k">$2</span>') + (com ? `<span class="c">${esc(com)}</span>` : '');
  }).join('\n');
}

function renderTable(t, ctx, widths, colclass) {
  const cc = (colclass || '').split(',').map(s => s.trim());
  const w = widths ? widths.split(/\s+/) : [];
  const align = t.align || [];
  let h = '<table class="' + (ctx.tableClass || 'cmp') + '">';
  t.children.forEach((row, ri) => {
    h += '<tr>';
    row.children.forEach((cell, ci) => {
      const tag = ri === 0 ? 'th' : 'td';
      const st = [];
      if (ri === 0 && w[ci] && w[ci] !== '*') st.push(`width:${w[ci]}`);
      if (align[ci]) st.push(`text-align:${align[ci]}`);
      const cls = cc[ci] ? ` class="${esc(cc[ci])}"` : '';
      h += `<${tag}${cls}${st.length ? ` style="${st.join(';')}"` : ''}>${renderChildren(cell.children, ctx, {})}</${tag}>`;
    });
    h += '</tr>';
  });
  return h + '</table>';
}

// Split a warm-up list item into question / answer at the "A:" marker.
export function splitQA(item) {
  const blocks = item.children;
  const first = blocks[0];
  if (!first || first.type !== 'paragraph') return null;
  const kids = first.children;
  const q = [], a = [];
  let inA = false;
  for (const k of kids) {
    if (!inA && k.type === 'text' && /(^|\n)A:\s*/.test(k.value)) {
      const m = k.value.match(/(^|\n)A:\s*/);
      const before = k.value.slice(0, m.index), after = k.value.slice(m.index + m[0].length);
      if (before) q.push({ ...k, value: before });
      if (after) a.push({ ...k, value: after });
      inA = true; continue;
    }
    (inA ? a : q).push(k);
  }
  if (q[0] && q[0].type === 'text') q[0] = { ...q[0], value: q[0].value.replace(/^Q:\s*/, '') };
  const hadQ = first.children[0] && first.children[0].type === 'text' && /^Q:/.test(first.children[0].value);
  return { hadQ, question: q, answer: inA ? [{ type: 'paragraph', children: a, position: first.position }, ...blocks.slice(1)] : null };
}

function render(node, ctx, opt = {}) {
  switch (node.type) {
    case 'text': return esc(node.value);
    case 'paragraph': {
      // A paragraph that is just :small[...] / :muted[...] / :hand[...] becomes <p class="small"> etc., so the
      // line height follows the smaller font (as in the pilot).
      const real = node.children.filter(c => !(c.type === 'text' && !c.value.trim()));
      if (!opt.tight && real.length === 1 && real[0].type === 'textDirective' && ['small', 'muted', 'hand'].includes(real[0].name)) {
        const d = real[0];
        const { classes } = attrsOf(d, [], ctx);
        return `<p class="${[d.name, ...classes].join(' ')}">${renderChildren(d.children, ctx, opt)}</p>`;
      }
      const inner = renderChildren(node.children, ctx, opt);
      return opt.tight ? inner : `<p>${inner}</p>`;
    }
    case 'emphasis': return `<i>${renderChildren(node.children, ctx, opt)}</i>`;
    case 'strong': return `<b>${renderChildren(node.children, ctx, opt)}</b>`;
    case 'delete': return `<s>${renderChildren(node.children, ctx, opt)}</s>`;
    case 'inlineCode': return `<code>${esc(node.value)}</code>`;
    case 'break': return '<br>';
    case 'link': return `<a href="${esc(node.url)}">${renderChildren(node.children, ctx, opt)}</a>`;
    case 'thematicBreak': return '<hr>';
    case 'code': {
      const meta = `${node.lang || ''} ${node.meta || ''}`;
      const size = /\btiny\b/.test(meta) ? ' class="tiny"' : /\bsmall\b/.test(meta) ? ' class="small"' : '';
      const lang = node.lang || '';
      if (lang === 'pseudo') return `<pre class="pseudo${size ? ' ' + size.match(/"(\w+)"/)[1] : ''}">${esc(node.value).replace(/\b(on|do|end on|end if|end for|if|then|else|for each|for|send|deliver|return|function|end function|while|end while|and|or|not)\b/g, '<b>$1</b>').replace(/(▷.*)$/gm, '<span class="c">$1</span>')}</pre>`;
      const body = /^(py|python)\b/.test(lang) ? highlightPy(node.value) : /^(c|cpp|c\+\+|h)$/.test(lang) ? highlightC(node.value) : esc(node.value);
      return `<pre${size}>${body}</pre>`;
    }
    case 'math': return math(node.value, true, ctx, node);
    case 'inlineMath': return math(node.value, false, ctx, node);
    case 'html':
      if (ctx.rawOk || /^<br\s*\/?>$/i.test(node.value.trim())) return node.value;
      problem(ctx, node, `raw HTML outside :::html: ${node.value.slice(0, 40)}`);
      return '';
    case 'heading': {
      if (node.depth === 2) {
        if (ctx.theme === 'cgp') return `<h2>${renderChildren(node.children, ctx, opt)}</h2>`;
        const txt = [...node.children]; // copy: pages are rendered twice, so never mutate the tree
        let badge;
        const t0 = txt[0];
        const m = t0 && t0.type === 'text' && t0.value.match(/^([^\w\s$])\s+/u);
        if (m) { badge = m[1]; txt[0] = { ...t0, value: t0.value.slice(m[0].length) }; } else badge = String(++ctx.h2);
        return `<h2><span class="n">${esc(badge)}</span>${renderChildren(txt, ctx, opt)}</h2>`;
      }
      if (node.depth === 3) return `<h3>${renderChildren(node.children, ctx, opt)}</h3>`;
      problem(ctx, node, `heading level ${node.depth} not used (title comes from front matter; use ## and ###)`);
      return '';
    }
    case 'list': {
      const tag = node.ordered ? 'ol' : 'ul';
      const start = node.ordered && node.start !== 1 && node.start != null ? ` start="${node.start}" style="counter-reset:n ${node.start - 1}"` : '';
      const tight = !node.spread && node.children.every(li => !li.spread);
      return `<${tag}${start}>${node.children.map(li => `<li>${li.checked != null ? '<span class="tick"></span>' : ''}${renderChildren(li.children, ctx, { tight })}</li>`).join('')}</${tag}>`;
    }
    case 'table': return renderTable(node, ctx);
    case 'blockquote': return `<blockquote>${renderChildren(node.children, ctx, opt)}</blockquote>`;
    case 'textDirective': return renderText(node, ctx, opt);
    case 'leafDirective': return renderLeaf(node, ctx);
    case 'containerDirective': return renderContainer(node, ctx);
    case 'image': problem(ctx, node, 'use ::fig{name=…} instead of Markdown images'); return '';
    default:
      problem(ctx, node, `unsupported Markdown node "${node.type}"`);
      return '';
  }
}

function renderText(node, ctx, opt) {
  if (!(node.name in TEXTS)) { problem(ctx, node, `unknown inline directive :${node.name}`); return esc(textOf(node)); }
  const { classes } = attrsOf(node, TEXTS[node.name], ctx);
  const inner = () => renderChildren(node.children, ctx, opt);
  const cl = classes.length ? ' ' + classes.join(' ') : '';
  switch (node.name) {
    case 'src': { const t = citeTag(textOf(node), ctx, node).html; return ctx.theme === 'cgp' ? '' : `<span class="src">${t}</span>`; }
    case 'fbox': return `<span class="fbox${cl}">${inner()}</span>`;
    case 'kg': return `<span class="kg">${inner()}</span>`;
    case 'ko': return `<span class="ko">${inner()}</span>`;
    case 'lab': {
      const a = node.attributes || {};
      const px = v => (/^-?\d+(\.\d+)?$/.test(v || '') ? v + 'px' : null);
      if (!px(a.x) || !px(a.y)) problem(ctx, node, ':lab needs numeric x= and y= (px from the figure box corner)');
      return `<span class="lab${cl}" style="left:${px(a.x)};top:${px(a.y)}${px(a.w) ? `;width:${px(a.w)}` : ''}">${inner()}</span>`;
    }
    case 'hl': return `<span class="hl">${inner()}</span>`;
    case 'kw': return `<span class="kw">${inner()}</span>`;
    case 'hand': return `<span class="hand${cl}">${inner()}</span>`;
    case 'small': return `<span class="small${cl}">${inner()}</span>`;
    case 'muted': return `<span class="muted${cl}">${inner()}</span>`;
    case 'u': return `<u>${inner()}</u>`;
    case 'sub': return `<sub>${inner()}</sub>`;
    case 'sup': return `<sup>${inner()}</sup>`;
    case 'tick': return '<span class="tick"></span>';
    case 'check': return checkTag(textOf(node).trim(), ctx, node);
    case 'pageref': {
      const id = textOf(node).trim();
      const n = ctx.pageNum(id);
      if (!n) { problem(ctx, node, `:pageref to unknown page id "${id}"`); return '<b style="color:red">p.??</b>'; }
      return `<span class="pn" data-pn="${esc(id)}" data-fmt="p">p.${n}</span>`; // filled in after pagination
    }
    case 'fig': return figHtml(textOf(node).trim(), {}, ctx, node);
  }
  return '';
}

function figHtml(name, a, ctx, node) {
  const svg = ctx.figures(name);
  if (svg == null) { problem(ctx, node, `missing figure "${name}"`); return `<span style="color:red">[missing figure ${esc(name)}]</span>`; }
  ctx.figs.push(name);
  const st = [a.w ? `width:${a.w}` : '', a.h ? `height:${a.h}` : ''].filter(Boolean).join(';');
  return `<span class="fig"${st ? ` style="${st}"` : ''}>${svg}</span>`;
}

function renderLeaf(node, ctx) {
  if (!(node.name in LEAVES)) { problem(ctx, node, `unknown block directive ::${node.name}`); return ''; }
  const { a, classes } = attrsOf(node, LEAVES[node.name], ctx);
  if (node.name === 'fig') {
    const name = a.name || textOf(node).trim();
    if (!name) { problem(ctx, node, '::fig needs name='); return ''; }
    const f = figHtml(name, a, ctx, node);
    return classes.includes('center') ? `<div class="center">${f}</div>` : f;
  }
  if (node.name === 'pagebreak') { ctx.pageBreaks = (ctx.pageBreaks || 0) + 1; return (ctx.onPageBreak ? ctx.onPageBreak() : '') + '<div class="pb"></div>'; }
  const g = ctx.gen && ctx.gen[node.name];
  if (!g) { problem(ctx, node, `::${node.name} is only available on generated pages`); return ''; }
  return g(a, ctx, node);
}

function renderContainer(node, ctx) {
  const name = node.name;
  if (!(name in CONTAINERS)) { problem(ctx, node, `unknown container directive :::${name}`); return ''; }
  const { a, classes } = attrsOf(node, CONTAINERS[name], ctx);
  // The [label] form (:::name[label]) is parsed as a first paragraph flagged directiveLabel.
  let kids = node.children;
  let labelNodes = null;
  if (kids[0] && kids[0].data && kids[0].data.directiveLabel) { labelNodes = kids[0].children; kids = kids.slice(1); }
  const body = () => renderChildren(kids, ctx, {});
  const cl = classes.length ? ' ' + classes.join(' ') : '';
  // The block's citation goes at the end of its last paragraph/list item (floated right, like the pilot),
  // or on its own line if the block ends with something else (code, maths, table).
  const withSrc = (html, checkInline = true) => {
    let h = '';
    if (a.src) h += citeTag(a.src, ctx, node).html;
    if (a.check && checkInline) h += checkTag(a.check, ctx, node);
    if (!h || ctx.theme === 'cgp') return html;
    const tag = `<span class="src end">${h}</span>`;
    if (/<\/p>$/.test(html)) return html.replace(/<\/p>$/, ` ${tag}</p>`);
    if (/<\/li><\/(ul|ol)>$/.test(html)) return html.replace(/<\/li>(<\/(?:ul|ol)>)$/, ` ${tag}</li>$1`);
    return html + `<p class="src blk">${h}</p>`;
  };
  if (ctx.theme === 'cgp' && name === 'example') {
    // First paragraph = the question (shown in a pill); the rest = the working, usually :::step[Label] blocks.
    ctx.blocks.push({ kind: name, label: 'Example', line: line(node), src: a.src || null, check: a.check || null });
    withSrc('');
    const [q, ...rest] = kids;
    if (!q || q.type !== 'paragraph') problem(ctx, node, ':::example must start with a paragraph stating the question');
    const prev = ctx.stepN; ctx.stepN = 0;
    const h = `<div class="panel ex${cl}"><div class="ex-h"><span class="lab">Example:</span><span class="q">${q ? renderChildren(q.children, ctx, {}) : ''}</span></div>${renderChildren(rest, ctx, {})}</div>`;
    ctx.stepN = prev;
    return h;
  }
  if (['formula', 'step', 'note', 'figbox'].includes(name)) {
    if (ctx.theme !== 'cgp') { problem(ctx, node, `:::${name} needs the cgp theme (module.yaml sections.<s>.theme: cgp)`); return ''; }
    if (name !== 'step') { ctx.blocks.push({ kind: name, label: name, line: line(node), src: a.src || null, check: a.check || null }); withSrc(''); }
    switch (name) {
      case 'formula': {
        // First block (display maths or a paragraph) goes in the box; anything after it is the handwritten "where…" text.
        const [f, ...where] = kids;
        const fh = !f ? '' : f.type === 'math' ? math(f.value, false, ctx, f) : renderChildren(f.children || [], ctx, {});
        if (!f) problem(ctx, node, ':::formula is empty');
        return `<div class="fline${cl}"><span class="fbox${classes.includes('o') ? ' o' : ''}">${fh}</span>${where.length ? `<span class="hand">${where.map(w => renderChildren(w.children || [], ctx, {})).join('<br>')}</span>` : ''}</div>`;
      }
      case 'step': {
        if (!labelNodes) problem(ctx, node, ':::step needs a label, e.g. :::step[Take logs]');
        ctx.stepN = (ctx.stepN || 0) + 1;
        return `<div class="step"><span class="k">${ctx.stepN}) ${labelNodes ? renderChildren(labelNodes, ctx, { tight: true }) : ''}</span><div class="v">${body()}</div></div>`;
      }
      case 'note': return `<div class="note${cl}"${a.w ? ` style="width:${esc(a.w)}"` : ''}>${renderChildren(kids, ctx, { tight: kids.length === 1 })}</div>`;
      case 'figbox': {
        if (!a.name) { problem(ctx, node, ':::figbox needs name='); return ''; }
        const labs = kids.flatMap(k => (k.type === 'paragraph' ? k.children : [k])).filter(k => !(k.type === 'text' && !k.value.trim()));
        for (const l of labs) if (!(l.type === 'textDirective' && l.name === 'lab')) problem(ctx, l, ':::figbox may only contain :lab[text]{x= y= w=} labels');
        return `<div class="figbox${cl}"${a.w ? ` style="width:${esc(a.w)}"` : ''}>${figHtml(a.name, {}, ctx, node)}${renderChildren(labs, ctx, {})}</div>`;
      }
    }
  }
  if (BOXES[name]) {
    const label = labelNodes ? renderChildren(labelNodes, ctx, { tight: true }) : esc(a.label || BOXES[name].label);
    ctx.blocks.push({ kind: name, label: a.label || BOXES[name].label, line: line(node), src: a.src || null, check: a.check || null });
    // A box's own check shows as a badge on its top border (no extra height).
    const badge = a.check ? checkTag(a.check, ctx, node).replace('class="chk"', 'class="chk badge"') : '';
    return `<div class="box ${BOXES[name].cls}${cl}"><span class="lab">${label}</span>${badge}${withSrc(body(), false)}</div>`;
  }
  switch (name) {
    case 'intro': return `<div class="intro${cl}">${renderChildren(kids, ctx, { tight: kids.length === 1 })}</div>`;
    case 'cols': {
      const cols = kids.filter(k => k.type === 'containerDirective');
      if (cols.length !== kids.length) problem(ctx, node, '::::cols may only contain :::col (or box) children');
      let c = cols.length === 3 ? ' c3' : '';
      if (a.split === '60/40') c = ' w60'; else if (a.split === '40/60') c = ' w40'; else if (a.split && a.split !== '50/50') problem(ctx, node, `split must be 60/40, 40/60 or 50/50`);
      return `<div class="cols${c}${cl}">${body()}</div>`;
    }
    case 'col': return `<div class="${classes.join(' ')}">${withSrc(body())}</div>`;
    case 'row': return `<div class="row${cl}"${a.align ? ` style="align-items:${a.align === 'end' ? 'flex-end' : a.align}"` : ''}>${body()}</div>`;
    case 'grow': return `<div class="grow${cl}">${body()}</div>`;
    case 'side': return `<div class="${classes.join(' ')}" style="flex:none${a.w ? `;width:${a.w}` : ''}${a.align ? `;align-self:${a.align}` : ''}">${body()}</div>`;
    case 'div': return `<div class="${classes.join(' ')}">${body()}</div>`;
    case 'html': { const prev = ctx.rawOk; ctx.rawOk = true; ctx.rawBlocks = (ctx.rawBlocks || 0) + 1; const h = body(); ctx.rawOk = prev; return h; }
    case 'table': {
      const t = kids.find(k => k.type === 'table');
      if (!t) { problem(ctx, node, ':::table must contain a Markdown table'); return ''; }
      const prev = ctx.tableClass; ctx.tableClass = classes.includes('rv') ? 'rv' : 'cmp' + (classes.includes('small') ? ' small' : '');
      if (a.src) citeTag(a.src, ctx, node);
      const h = renderTable(t, ctx, a.widths, a.colclass);
      ctx.tableClass = prev;
      return h;
    }
    case 'warmup': {
      const list = kids.find(k => k.type === 'list');
      if (!list || kids.length !== 1) { problem(ctx, node, ':::warmup must contain exactly one list of Q:/A: items'); return ''; }
      const items = list.children.map((li, k) => {
        const qa = splitQA(li);
        if (!qa || !qa.hadQ) problem(ctx, li, `warm-up item ${k + 1} must start with "Q:"`);
        if (!qa || !qa.answer) problem(ctx, li, `warm-up item ${k + 1} has no "A:" answer`);
        const qHtml = qa ? renderChildren(qa.question, ctx, {}) : '';
        const before = ctx.checks.length;
        const aHtml = qa && qa.answer ? renderChildren(qa.answer, ctx, { tight: qa.answer.length === 1 }) : '';
        const checks = ctx.checks.slice(before);
        ctx.warmups.push({ q: qHtml, a: aHtml, checks, line: line(li) });
        return `<li>${qHtml}</li>`;
      });
      if (ctx.theme === 'cgp') return `<div class="qh">Warm-Up Questions</div><ol class="wq${cl}">${items.join('')}</ol>`;
      return `<div class="warm${cl}"><h3>Warm-Up Questions</h3><ol>${items.join('')}</ol></div>`;
    }
    case 'answers':
    case 'question-answers': {
      const g = ctx.gen && ctx.gen[name];
      if (!g) { problem(ctx, node, `:::${name} is only available on generated pages`); return ''; }
      return g(a, ctx, node, body());
    }
  }
  return '';
}

export function renderInline(md, ctx) {
  // Render a short Markdown string (title, strip text, question stem) without a <p> wrapper.
  const t = parser.parse(String(md));
  if (t.children.length === 1 && t.children[0].type === 'paragraph') return renderChildren(t.children[0].children, ctx, {});
  return renderChildren(t.children, ctx, {});
}

export function renderBlocks(md, ctx) {
  const t = parser.parse(String(md));
  return renderChildren(t.children, ctx, {});
}
