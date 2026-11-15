# Writing a chapter (one lecture) of a module textbook

Chapters are written by `tools/batch` (decision 0007), one fresh headless session per step. This page explains the
rules those sessions work to; the prompts themselves are `tools/overnight/{common,draft,read,fix,repair}.md`. Change
the rules there and here together. Decision 0004 explains why the book grows one lecture at a time, decision 0003 the
CGP page design, decision 0006 how the course's material is linked to lectures.

## The steps

| Step | Who | What |
|---|---|---|
| describe | Sonnet, once per slide | `tools/describe`: each slide image is read once and kept as text in `sources/<m>/desc/` |
| dossier | tool | `out/<m>/dossiers/L<nn>.md`: every slide as extracted text + image description + the lecturer's captions, then the linked sheet questions, notes pages and past-paper parts (with solution notes and examiners' comments) |
| draft | Sonnet, high effort | the chapter, its checks, figures and questions, within the page budget; gates must pass |
| read | Opus, text only | reads the whole chapter against the dossier and lists what is wrong; edits nothing |
| verify, omissions | Sonnet | the per-page verifier and the gap review write issues to the ledger |
| fix | Opus | major issues and the reader's findings; minor ones when a small edit; no new pages |

About $6 and 25 minutes a lecture. Lectures of one module are written in turn (they share a ledger, checks and
errata); `--jobs 2` writes two modules at once. The usage limit is shared with everything else, so keep it at 2.

## The rules

1. **This year's lecture decides what is taught.** `COVERED` slides are taught; `BRIEF` slides get a sentence;
   `SKIPPED` slides are left out. Material not in this year's lecture gets no topic, section or heading, even when a
   past paper examined it. Earlier years' recordings never add a topic.
2. **A page budget, and depth before breadth.** About one page per two slide groups covered (6 to 12), in 4 to 7
   topics. Every topic says why, and has a worked example with steps; a procedure gets a second one. Background,
   history and motivation get a sentence. The rest of the dossier decides depth and emphasis; it does not add length.
3. **Past-paper parts from the last ten years, with worked model answers.** Shown on the page with `::examq`, answered
   on the answers page as working, with `answer_source` saying honestly whether it follows the solution notes.
   Examiners' comments become COMMON MISTAKE notes. A part that needs something not lectured this year, or a later
   lecture, gets one bold line in the answer ("**Not lectured this year:** …", "**Needs Lecture n:** …"). It is not
   taught, and never set in grey small print.
4. **Accuracy.** Every fact is cited to a slide, notes page, sheet or paper (`:src[N s130]`). Anything worked out is
   `[derived]` and has a check in `modules/<m>/checks/l<nn>.py`; code on a page is compiled and run by a check;
   figures are drawn from the same code. A slide error is corrected on the page in one sentence and recorded in
   `errata.yaml`.
5. **Captions are evidence, never a source.** They show emphasis, explanations and warnings. Never quoted, never
   cited, never the only source of a fact: they mis-hear.
6. **Images are opened only when needed**: to reproduce a diagram, code, formula or table exactly, or where the
   description says UNSURE or LOOKS WRONG. Rendered pages are looked at once.
7. **Paraphrase.** No sentence copied from a slide; quotes under 15 words; past-paper stems paraphrased.
8. **An earlier version of the chapter** (in `archive/chapters-*/`) is raw material: plan from the dossier first, then
   reuse a worked example, model answer, check or figure that fits, checking it like new text.

## What a page looks like (the CGP form)

- **A topic is one whole page or a two-page spread, and every page is full to the foot** (decision 0008,
  2026-11-12), as in the CGP book. 3 to 5 topics a chapter; `::pagebreak` says where a spread turns and the banner
  repeats on the second page. The writer fits the text to the page: the build prints a FIT report (free px per page,
  the height of every block) and fails a topic page with more than 70px free. Gaps are filled with something worth a
  mark (a further worked step, a common mistake, a small table), never with padding, and nothing is stretched. The
  rules the writers get are `tools/overnight/fitting.md`. The page budget is for the whole chapter.
- A purple title; an italic one- or two-sentence intro that says why the topic matters.
- **Statement headings** (`## Free Each Block **Exactly Once**`): a full sentence that states the takeaway, with the
  heavy words in bold.
- Under each heading, **numbered full-sentence points** that teach: say why, not only what.
- **A figure, code block or table on every page**, beside the text it explains (`modules/<m>/figures/l<nn>.py`,
  `tools/lib/figlib.py`).
- **Worked examples** with steps (`::::example` + `:::step[…]`).
- **Margin notes** (`:::note`) for a tip, a mnemonic or a COMMON MISTAKE (`.mistake`). One or two per page.
- Each topic ends with **Warm-Up Questions** (`:::warmup`, 4–6) and, where a recent paper examined it, **Exam
  Questions** (`::examq{ids="…"}`; the stem is set in a serif face, as in the CGP book), then the bottom tip strip.
- British English. Plain words. No filler, no hedging.

## The gates

```
tools/checks <m>                 # every check passes
tools/build <m> l<nn>            # LINT clean, no OVERFLOW, every topic page full
tools/lectures <m> gate <n>      # every covered slide group is cited
```

A chapter goes into the book when it is built, lint clean, through the gate, every page verified at its current
version, no major issue open, and reviewed for gaps. Otherwise it is held back with the reason (GUI and
`out/overnight/STATUS.md`).
