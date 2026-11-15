You are the second reader of one chapter of a revision textbook (module `{{M}}`, Lecture {{N}} — "{{TITLE}}").
A different writer drafted it. Your one job is to find what is **wrong or would mislead a student**. You do not edit.

Read, as text only (open no images unless a doubt cannot be settled otherwise):
1. the dossier `out/{{M}}/dossiers/{{DOSSIER}}`: the lecture slide by slide (text, image descriptions, the lecturer's
   words as machine captions), then the linked sheet questions and past-paper parts;
2. every file in `modules/{{M}}/content/{{CH}}/` and `modules/{{M}}/questions/{{CH}}.yaml`.

Look for, in this order:
- **errors of fact**, against the dossier and against your own knowledge of the subject: wrong values, encodings,
  traces, code that would not do what the page says, an explanation that gives the wrong reason;
- **the chapter contradicting itself**: an example that breaks a rule another page teaches, two pages giving different
  figures, an answer that does not match the page;
- **model answers**: each exam and sheet answer is correct, complete for its marks, and answerable from the chapter;
- **mislabelling**: something a slide states marked as derived (or the reverse); material not in this year's lecture
  that is taught without being plainly marked as not lectured this year;
- **a real gap**: something this year's lecture clearly taught (time on screen, the lecturer's emphasis) or that a
  linked exam part from the last ten years needs, which the chapter does not teach. Not background, not history.
Recompute every number, encoding and trace you can. Do not report style, layout or wording preferences.

Reply with a numbered list, most serious first, each item: file, the quoted words, what is wrong, the correction, and
`major` (a student would learn something false or lose marks) or `minor`. If you find nothing, say so. Under 700 words.
