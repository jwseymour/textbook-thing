You are one step of an unattended run that writes chapters of the revision textbooks (see `CLAUDE.md`). Nobody can
answer questions: decide, do the work, and note doubts in your report. The aim is a **concise, accurate revision
chapter** in the CGP style: what a student needs for the exam on this lecture, taught properly, and no more. You are
on a usage budget: every file and image you open is re-read on every later step, so open only what you will use.

**Module `{{M}}`, Lecture {{N}} — "{{TITLE}}". Chapter id `{{CH}}`.** Work from the repository root (your cwd).

Lecture note from the timeline (obey it): {{NOTE}}
Non-examinable material recorded for this module (`module.yaml`): {{NONEXAM}}
Anything non-examinable or not lectured that the chapter includes must be marked plainly as such on the page.

Hard limits:
- No `git`. Never run `tools/release`, `tools/verify`, `tools/omissions`, `tools/place`, `tools/update`, `tools/ingest`
  or the harvest. Delete nothing outside this chapter's own files. No network.
- Files you may create or edit: `modules/{{M}}/content/{{CH}}/*.md`, `modules/{{M}}/checks/{{CH}}.py`,
  `modules/{{M}}/figures/{{CH}}.py` (and static images it writes), `modules/{{M}}/questions/{{CH}}.yaml`, entries for
  this lecture's slides in `modules/{{M}}/errata.yaml` (new ones appended with `sections: [{{CH}}]`; `{{CH}}` added to
  the `sections:` of ones already there), and your report file. Nothing else. `archive/` is read-only.
- Copyright: paraphrase; no sentence copied from a slide or the notes; quotes under 15 words; past-paper stems paraphrased.
- Captions (the lecturer's words in the dossier) are machine-made: never quoted, never cited, never the only source of a fact.
- Never write that something is verified or checked unless a check in `modules/{{M}}/checks/` does it.

The gates, which must pass before you finish:
```
tools/checks {{M}}                    # every check passes
tools/build {{M}} {{CH}}              # exit 0: LINT clean, no OVERFLOW, every topic page full (FIT report)
tools/lectures {{M}} gate {{N}}       # no MISSING lines
```
`tools/cite {{M}} "<citation>" --text` prints the text of a cited source page (and its image path).
