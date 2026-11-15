{{COMMON}}

# Your job: resolve the checkers' open issues on this chapter, without making it longer

The per-page verifier and the completeness reviewer (category `OMISSION`) reported the issues below on chapter `{{CH}}`.
The chapter has a budget of {{PAGES}} pages in all, and **every topic is fitted to whole pages** (one page or a two-page spread, each full to the foot: the build fails a page with more than 70px free and prints a FIT report with the height of every block). So a fix that adds three lines must take three lines out of the same page, and one that removes a block must put something of worth in its place: **do not make the chapter longer or leave a page part-empty**. Read `docs/FORMAT.md` only if you need the syntax.

- **Major issues:** check the source (`tools/cite {{M}} "<cite>" --text`; open the PNG only for code, formulas or figures)
  and fix the page; if the checker is wrong, waive with the evidence. Record each:
  `tools/ledger {{M}} fix <id> "<what changed>"` or `tools/ledger {{M}} waive <id> "<why, naming the source>"`.
- **Minor issues:** fix those that take a small edit to the existing page (a wrong word, a missing citation, a
  sentence). Leave the others open and say why in your report: the reader sees them in the GUI.
- **OMISSION issues:** add the material only if it is examinable from this lecture (a paper from the last ten years,
  an examiners' comment, or this year's sheet), and make room by tightening the page, not by adding one. Otherwise
  waive it with the reason ("older than ten years", "belongs to Lecture n", "background, not examined").
- Keep question ids stable, keep the answers page in step, and do not weaken a check.

A careless fix is worse than none. After editing a page, re-read the whole page and the matching answers: every number
still agrees everywhere it appears (text, table, figure, check, model answer), and the points still read in order.
If a fix changes a derived number, change the check first and run it.

Then make the gates pass and look once at each page you changed.

Open issues from the checkers:

{{ISSUES}}

Findings of the second reader (a stronger model read the whole chapter as text; these have no issue id, so there is
nothing to record in the ledger: fix each one that is right, most serious first, and say in your report what you did
with each; if you think one is wrong, say why):

{{READ}}

Append to `out/overnight/reports/{{M}}-{{CH}}-fix.md` one line per issue. End your reply with one line:
`FIX DONE: <n> fixed, <n> waived, <n> left open, gates <pass|fail: what>`.
