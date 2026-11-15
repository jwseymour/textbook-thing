{{COMMON}}

# Your job: draft the chapter, within a page budget

**Budget: at most {{PAGES}} pages for the whole chapter** (plus the answers page). The lecture covered {{SLIDES}}
slide groups. If it does not fit, cut background and motivation to a sentence: do not add pages.

**Every topic is one whole page or a two-page spread, and every page is full**, as in the CGP book: a topic starts at
the top of a fresh page under its banner and ends at the foot of a page with its warm-up questions and tip strip. Plan
the chapter as **3 to 5 topics**, most of them two-page spreads; a small idea that stands alone gets one page; three
pages only for a long trace that cannot be cut. Fewer, fuller topics read better than many thin ones: put two small
related ideas in one spread instead of giving each its own banner.

**Depth before breadth.** Spend the pages on what a student has to be able to *do* in the exam. A chapter that reads
like a summary of the slides has failed. So:
- every topic explains **why** (the reason for the design, the consequence of getting it wrong), not only what;
- every topic has at least one **worked example with steps** (an encoding, a trace, a calculation, a piece of code run
  by a check), and procedures a student must carry out get a second, different one;
- every recent exam part and every one of this year's sheet/supervision questions linked to this lecture can be
  answered from the **body of the chapter**: teach the method on the page, then give the answer in the question file
  or a short answer table;
- background, history and motivation slides get a sentence or a small table each, however long they were on screen.

## Read (text only, once)
1. `docs/FORMAT.md` (page syntax, "CGP theme") and `docs/STYLE_GUIDE.md` (voice).
2. One reference topic for the form (copy the form, not the length), in `archive/chapters-2026-11-11/modules/progc/`:
   `content/l07/01_refcount.md`, the first 60 lines of `checks/l07.py` and of `figures/l07.py`, the first 40 lines of
   `questions/l06.yaml` (question format), and `content/l06/99_answers.md` (the answers page to copy). Also
   `tools/lib/figlib.py` and `tools/lib/checklib.py`. Do **not** open rendered images of other chapters.
3. If this module already has a finished chapter, skim one topic of it for notation, and refer back to earlier
   chapters instead of re-teaching them.
4. The dossier `out/{{M}}/dossiers/{{DOSSIER}}`, all of it. For every slide it gives the extracted text, a description
   of the slide's image (made once by a reader who looked at it), and what the lecturer said (machine captions: use them
   for emphasis, explanations and warnings; never quote or cite them).

## An earlier version
{{PREV}}

## Images
Work from the slide text and the image descriptions. Open a slide PNG **only** when (a) you will redraw its diagram or
reproduce its code, formula or table and need it exact, (b) its description says UNSURE or LOOKS WRONG, or (c) the text
and description disagree. Typically a handful per lecture.

## What goes in
- **Follow the lecture.** `COVERED` slides are taught; `BRIEF` slides get a sentence; `SKIPPED` slides are left out.
  Every covered slide group must be cited somewhere (`:src[S s83]`); the gate checks it. Weight the pages by what the exam and the sheet ask, then by time on screen.
- **Use the rest of the dossier to decide depth, not to add length.** Where a notes/handout page explains something
  better than the slide, use it and cite it. This year's sheet/supervision questions are practice (warm-ups or a short
  answer table).
- **This year's lecture decides what is taught.** The slides and what the lecturer said this year come first; the
  course changes from year to year. Material that is **not** in this year's lecture gets no topic, section or heading
  of its own, even when a past paper examined it.
- **Exam parts:** past-paper questions with worked model answers are wanted. Include the parts from **the last ten
  years** that this lecture's material answers: in the question file with a full answer set out as working (steps,
  then the result; `answer_source` says honestly whether it follows the solution notes or is your own), shown on the
  page with `::examq`. Turn examiners' comments on them into a COMMON MISTAKE note. If one part of a recent question needs something this year's lecture did not cover (or a later lecture), answer the
  parts this lecture covers and give that part one line in the answer, starting **Not lectured this year:** or
  **Needs Lecture n:** in bold, saying what it needs. Do not teach or work it. Never grey small print.
  An older part is included only if no recent one exists for that idea. A part that needs a later
  lecture belongs to that lecture.
- **Accuracy.** Mark as `[derived]` only what you worked out yourself, never something a slide states. Every fact is cited to a slide, notes page, sheet or paper. Anything you work out is `[derived]` and
  has a check in `modules/{{M}}/checks/{{CH}}.py`; code shown on a page is run by a check; figures are drawn from the
  same code. If a slide is wrong, teach the right thing, say so in one sentence, and record it in `errata.yaml`: if
  the file already has the entry (the dossier lists known errata), add `{{CH}}` to its `sections:` list; otherwise append it.
- **The CGP form:** statement headings with the heavy words bold;
  numbered full-sentence points that say why; a figure, code block or table in every topic; a worked example where there
  is a procedure or trace; one or two margin notes; 4–6 warm-up questions per topic; the bottom tip strip. British
  English, plain words, no filler.

## Do
1. Fix the topic list (files `NN_<slug>.md`, page ids `{{CH}}-<slug>`, `ref: Lecture {{N}}`). Write
   `modules/{{M}}/questions/{{CH}}.yaml` and `99_answers.md` (id `{{CH}}-answers`).
2. Write the checks, then the pages and figures.
3. Re-read each page top to bottom as a student would: the points are in a sensible order and numbered in sequence,
   each sits under the heading it belongs to, nothing is said twice, and every example obeys the rules the chapter teaches.
4. Run the gates and fit every page (below) until the build is clean.
5. Then look at each rendered page **once** (`out/{{M}}/{{CH}}/shots/*.png`): it should look like a finished page of a
   printed revision guide, full to the foot, figures beside the points that use them. Fix real faults only (clipped or
   overlapping text, a label in the wrong place, a lopsided page), rebuild, and look again only at pages you changed.

{{FITTING}}
Write a short report to `out/overnight/reports/{{M}}-{{CH}}-draft.md`: topics and pages; exam parts included and left
out (with the reason); the free px of every page; slide errata; anything you were unsure of. End your reply with one line:
`DRAFT DONE: <n> topics, <n> pages, gates <pass|fail: what>`.
