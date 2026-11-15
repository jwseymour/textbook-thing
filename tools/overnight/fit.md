{{COMMON}}

# Your job: fit this chapter to whole pages, without changing what it teaches

The chapter `{{CH}}` is written, checked and accurate, but it was written to flow down the sheets, so its pages have
blank bands at the foot and its topics end part-way down a page. The reader wants it to look like the printed CGP book:
**every topic is one whole page or a two-page spread, and every page is full to the foot.**

Where it stands now ({{NOW}}):

```
{{FITREPORT}}
```

**Target: {{TARGET}} full topic pages** (the chapter holds about that much material). One more is acceptable only if
the alternative is cutting a worked example or an exam part; never more than it has now. The answers page is laid out
by the build: leave its layout alone.

## How
1. Read `docs/FORMAT.md` (syntax) and every file in `modules/{{M}}/content/{{CH}}/`. Read nothing else unless you need it.
2. Decide the page plan first: which topic gets one page and which two, adding up to the target. Two thin topics on
   neighbouring ideas become one two-page spread (merge the files: keep the first file's `id`, move the other's
   sections, citations, `::examq` and warm-up questions into it, delete the emptied file, and fix every reference to
   the removed id: `grep -rn "<old id>" modules/{{M}}`). A topic that is a page and a third either loses a third or
   gains two thirds.
3. Edit, build, read the FIT report, repeat until the build is clean.
4. Then look at each rendered page **once** (`out/{{M}}/{{CH}}/shots/*.png`): full to the foot, nothing clipped, figures
   beside the points that use them. Fix real faults, rebuild, and look again only at pages you changed.

## What must not change
- **The teaching.** Keep every worked example, every exam part and its model answer, every citation the coverage gate
  needs, every check. Cut repetition, background and the weakest warm-up questions first. If a number or a claim
  changes, it is a mistake: put it back.
- **Anything you add** follows the rules of the chapter: cited to this lecture's slides or notes
  (`tools/cite {{M}} "<citation>" --text` shows a source page; the dossier is `out/{{M}}/dossiers/{{DOSSIER}}`, read
  only the part you need), or `[derived]` with a check. Nothing that was not lectured this year.
- Question ids, the answers page and `questions/{{CH}}.yaml` stay in step with the pages.

{{FITTING}}

Write a short report to `out/overnight/reports/{{M}}-{{CH}}-fit.md`: the page plan, the free px of every page, what
you cut and what you added. End your reply with one line:
`FIT DONE: <n> topics, <n> pages, gates <pass|fail: what>`.
