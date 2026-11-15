# Page source format

One Markdown file per topic: `modules/<m>/content/<section>/NN_<slug>.md` (files are ordered by name). Topics flow onto A4 sheets: a topic starts on the current sheet if its title and first block fit, and whole top-level blocks move to the next sheet when they don't (a heading stays with the block after it; the title repeats with “(continued)”). Covers and summaries get their own sheets; answers start a new one. Page numbers (contents, summary, answers, `:pageref`) are filled in after pagination. CommonMark + GFM tables + [generic directives](https://talk.commonmark.org/t/generic-directives-plugins-syntax/444) (`remark-directive`) + `$…$` / `$$…$$` LaTeX maths (`remark-math`, KaTeX strict). Examples: every file in `modules/datasci/content/`.

## Directive syntax in one minute

```
:::name{key="value" .class key2=bare}     container (block), closed by :::
::::outer                                 nest by giving the OUTER fence MORE colons
:::inner
:::
::::
::name{key=value}                         leaf (one line, no body)
:name[text]{.class}                       inline (text)
```

Quote attribute values containing spaces or `;`. Put display maths `$$` on lines of its own.

## Front matter

| Key | Meaning |
|---|---|
| `id` | **Required.** Unique page id (used by `:pageref[…]`, answers ranges and the verifier ledger) |
| `title` | **Required.** `[…]` marks the highlighted part, e.g. `"[Maximum Likelihood] Estimation"`; may contain `$maths$` |
| `subtitle` | Second title line (cover pages). On a cgp cover it is the series name, `"First line | Second line"` |
| `mark`, `level`, `board`, `tagline`, `badge` | cgp cover only: the mark at the top left, the line above the title, the line below it, the underlined tag line, and the shield's text (`"line | line"`; a book's default is the lectures it holds). The page's own text is the small print at the foot |
| `kind` | `content` (default: needs a warm-up and a strip), `cover`, `front`, `exam`, `summary`, `answers` |
| `tab`, `ref` | Header strip: section tab (default from `module.yaml`) and § reference |
| `strip` | `{head, text}` — the bottom summary bar (required on content pages) |
| `short`, `nav` | Short name (answers headings, summary groups) and nav-bar label |
| `contents`, `contents_ref` | Row label / notes column in the generated contents table; `contents: false` merges the page into the previous row |
| `summary`, `summary_group` | Recall prompts for the generated revision summary, grouped under a heading |
| `footer` | Override the bottom-left footer |

## Blocks

| Directive | Attributes | Renders as |
|---|---|---|
| `:::intro` | — | The 1–2 sentence intro under the title |
| `:::definition` `example` `warn` `check` `tip` `exam` `plain` `plugin` | `label`, `src`, `check`, classes | Tinted box with a tab label (`check` = the lecturer's red SANITY CHECK box). `src` is shown at the end of the last paragraph; `check` shows a green **✓ checked** badge only if every linked check passed |
| `::::cols` + `:::col` | `split=60/40` / `40/60` (default 50/50; three `col`s → three columns); `col` takes `src`, `check` | Grid columns |
| `::::row` + `:::grow` / `:::side` | `row{align=center\|end}`, `side{w=76mm}` | Flex row, e.g. text beside a figure |
| `:::div` | classes only | A plain wrapper (e.g. `{.small .cols2}`) |
| `::fig` | `name` (required), `w`, `h`, `.center` | SVG from `figures/<section>.py` (generated) or `figures/static/<name>.svg` |
| `:::table` | classes `.rv` / `.small`, `widths="21% 28% * 118px"`, `colclass=",,,pic"` | Wraps a GFM table (default style: `cmp`). Use `<br>` for line breaks in cells |
| `:::warmup` | — | Dashed warm-up box: a list of `Q:` / `A:` pairs (answer may continue with code blocks). Answers go to the answers page |
| `:::html` | — | **Escape hatch**: raw HTML. Keep rare (counted in the build report) |
| `## Heading` / `### Heading` | `## ★ Title` uses ★ (any symbol) as the badge | Numbered sub-head / small heading |
| code fences | `` ```py small `` / `` ```c tiny `` | Python and C/C++ (`c`, `cpp`) are highlighted; `small`/`tiny` shrink the font |

**Generated content** (only on generated pages): `::contents`, `::summary`, `:::answers{from=<page id> to=<page id>}` (extra boxes inside are appended), `::questions{section=s1}`, `:::question-answers{section=s1}`, `::errata{section=s1}`. Questions live in `questions/*.yaml`, typos in `errata.yaml`.

## Inline

| Directive | Meaning |
|---|---|
| `:src[N p12; L2 s7]` | Citation tag (tiny grey). Same grammar as `src=` |
| `:check[id id2]` | Links computer checks; shows ✓ checked when they all passed |
| `:hl[…]` / `:kw[…]` | Highlighter / keyword colour |
| `:hand[…]{.blue}` | Handwriting — **only** for the lecturer's own slide annotations (`.blue`, `.red`, `.big`) |
| `:small[…]`, `:muted[…]` | Small / grey text (a paragraph that is just `:small[…]` becomes a small paragraph) |
| `:pageref[page-id]` | Becomes “p.8” |
| `:fig[name]` | Inline figure (e.g. in table cells) |
| `:sub[…]`, `:sup[…]`, `:u[…]`, `:tick` | Sub/superscript, underline, tick box |

## Citations

`;`-separated items. Each is a source id from `sources.yaml` plus locators: notes `N p12`, `N p12-13`, `N p12 fn7` (printed pages); slides `L2 s7`, `L2 s10-11, s15` (PDF pages); sheets `ES1 Q3`, `ES1 Q1-2`; exams `Mock Q1`, `T2023 Q6(a)`, `Sol T2021 Q8`; data `Data iris`; web `Materials`. Special: `derived` (own maths — must link a check if the block has maths) and `outside: <what>` (not course content).

## Lint (the build fails on any of these)

Unknown directive, attribute, class or front-matter key · a box, column or `##` section with no citation · a citation that doesn't resolve to an existing page/slide/question · `derived` maths with no check · a `check` with no test · a missing figure · a `:pageref` to an unknown page · a warm-up item without `Q:`/`A:` · an answered question with no answer · KaTeX errors (strict) · control characters · raw HTML outside `:::html` · a content page with no warm-up or strip · **overflow: a single block taller than an A4 sheet, or content too wide / clipped inside a code block, box or table** (measured in Chrome).

## CGP theme (decision 0003)

Set `theme: cgp` on a section in `module.yaml`. **Every topic is one whole page or a two-page spread, full to the foot** (decision 0008, 2026-11-12): a topic starts a fresh sheet under its banner, `::pagebreak` starts its next sheet (the banner repeats), and a block that does not fit moves on (`flowFixed` in `tools/lib/print.mjs`). The writer fits the text to the page: the build prints a FIT report (free px per sheet and the height of every block on it) and a chapter build fails a topic sheet with more than 70px free, or a topic of more than three sheets. Spacing is never stretched. **The second layout**, chosen per book in the GUI ("Layout") and kept as `book.layout: flow` in `module.yaml`, lets topics follow one another down the sheets with planned breaks and slim “(continued)” heads (`flowPlanned`); a chapter builds the way its book does, and the fullness check applies only to the default layout. The overflow lint fails only for a block taller than a sheet or too wide. Citations and checks are still required and still feed the verifier, but the page shows only one small “Sources:” line in the footer, and no “✓ checked” badges. The front-matter `strip` becomes the bottom tip box. Reference page: `modules/datasci/content/s1n/06_mle.md`.

| Syntax | Renders as |
|---|---|
| `## A **Statement** Heading` | Green heading strip. Write a full sentence that states the takeaway; `**…**` marks the heavy words. Everything up to the next `##` is one section and needs at least one `:src[…]` |
| `1.` ordered lists | CGP's `1)` points. A list that resumes after a block (`5.`) keeps its number |
| `:::example{src check}` | Worked-example panel. The **first paragraph is the question** (shown in a pill); then `:::step[Label]` blocks, numbered automatically |
| `:::formula{.o src check}` | Boxed formula (first block, usually `$$…$$`) with the following paragraphs as handwritten “where…” text. `.o` = orange (results) |
| `:fbox[$…$]{.o}` | Inline boxed result |
| `:::note{w=170px .mistake .left}` | Spiky handwritten margin note. It floats right, so **write it before the text it sits beside**. `.mistake` = red |
| `:::figbox{name w src check}` + `:lab[text]{x= y= w= .red/.grey/.blue}` | Figure on a tinted panel (floats right) with handwritten labels positioned in px from the panel's top-left |
| `:kw[…]` `:kg[…]` `:ko[…]` | Purple / green / orange key-term runs |
| `:::warmup` | As before (`Q:`/`A:`), shown as a plain Q1… list |
| `::examq{ids="t2023-q6a t2022-q7a"}` | “Exam Questions” panel: stems, marks and paper reference from `questions/*.yaml` |

The card boxes (`definition`, `plain`, `tip`, `exam`, `cols`…) still parse but should not be used on cgp content pages.

## Chapters and the module book (decision 0004)

- A chapter is a section named `l<nn>` (`theme: cgp`, `lecture: <n>` in `module.yaml`). Each topic is one or two whole pages. Its last file is an answers page:

  ```
  ---
  id: l06-answers
  kind: answers
  title: "[Answers] — Lecture 6"
  ---
  :::answers
  :::
  ::::question-answers{cols=1}
  ::::
  ```

  With no `from`/`to`, `:::answers` lists the warm-up answers of every topic in the same chapter. With no `section`, `:::question-answers` gives the answers to the questions that chapter used in `::examq` panels.
- `module.yaml` `book: {title, tab, pdf_name}` defines the book; its chapters are every finished `l<nn>` section, in lecture order (decision 0005). `tools/build <m> book` puts the pages in `content/book/` first (cover, about this edition), then each chapter's topics, then every chapter's answers page.
- `::edition` (book front pages only) prints the lecture table from the timeline: which lectures are in this edition, which are still to come. `::contents` groups its rows by chapter in a book.
- Avoid page references (`:pageref`) from one chapter to another: a chapter is also built and verified on its own. Say "see Lecture 7" instead.
