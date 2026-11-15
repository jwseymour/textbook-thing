# Content style guide

How guide content is written. These rules come from the pilot (which the reader liked), CGP's format, and the learning-science evidence in `BRIEF.md` §3.

## Length: as long as the topic needs, and no longer

(Chapters in the cgp theme: a topic is one whole page or a two-page spread, fitted by the writer; see decision 0008 and `docs/WRITING_A_CHAPTER.md`. The rest of this paragraph describes the old theme.) One file = one topic. Teach what matters for the exam and cut the rest; there is no sheet to fill or fit. Topics flow onto A4 sheets: the next topic starts part-way down the current sheet when its title and first block fit (under a divider), and a topic that runs onto a new sheet repeats its title with “(continued)”. About one sheet of material per topic is typical; if a topic grows past two, it is usually two topics.

## Topic anatomy

1. **Header strip:** section tab on the left (e.g. “Section 1 — Learning with probability models”), § reference on the right.
2. **Title:** big and bold, with the key part highlighted (e.g. “**Maximum Likelihood** Estimation”).
3. **Intro:** 1–2 sentences in a chatty voice. Why this topic matters.
4. **Body:** 2–4 numbered sub-heads and/or boxes. Mix prose, bullets, maths, a figure and a worked example. Use two-column layouts where they fit.
5. **Warm-Up Questions:** 3–5 recall questions at the bottom of every content page, answered at the back.
6. **Bottom strip:** a short bold headline plus a one-line summary (CGP's bottom tip). A mild pun is fine; jokes are not the point.

## Box types (what each is for)

| Box | Use for |
|-----|---------|
| `definition` | Definitions to learn word for word |
| `example` | Worked examples from the notes (“Ex 1.3.1”), fully worked |
| `check` | The lecturer's own “SANITY CHECK” boxes |
| `warn` | Common mistakes, traps, notation clashes, numpy gotchas |
| `exam` | What examiners reward; links to real past questions |
| `tip` | Rules of thumb, study advice |
| `plugin` / other named | Key principles (e.g. the plug-in principle) |
| `plain` | Neutral asides (“what counts as the observed data?”) |
| `hand` | Short handwritten-style notes, ideally the lecturer's own slide annotations, paraphrased faithfully |

## Voice and wording

- Friendly, direct, second person; short sentences; British spelling.
- **Paraphrase the notes in your own words.** Short quotes (under 15 words) only when the exact wording matters, e.g. a definition or what an examiner said.
- Define every term before using it. Use the course's notation exactly, e.g. $N(\mu,\sigma^2)$ with the variance, and $\Pr_X(x)$.
- Bold the 2–4 things on a page that matter most. Don't bold whole sentences.
- **No decorative jokes or cartoons** (seductive-details evidence). Diagrams must carry information.

## Accuracy rules

- **Every block ends with a citation:** `N p12` (notes, printed page), `L2 s7` (lecture 2, PDF slide 7), `ES1 Q3`, `Mock`, `T2023 Q6`, `Sol T2021 Q8`.
- Anything not from the course is labelled: `[derived]` for your own maths (which must have a check), `[outside course: numpy docs]`, `[study-skills research]`.
- **Formulas:** copy from a *rendered image* of the source page, never from text extraction — the extraction garbles maths (see `PILOT_LESSONS.md`).
- **Typos in the course materials:** use the corrected form in the guide, and add the typo to `errata.md` and to the errata box on the last answers page.
- **Never invent attributions** (“the examiners say…”) or generalise one example into a “typical” pattern. Both were caught by the verifier in the pilot.
- Examinability: leave out `*` material, or label it clearly.

## Questions

- **Warm-ups:** recall and quick application, answerable from that page. Each answer is short, correct and checked; numerical answers are checked by computer.
- **Exam questions:** real past Tripos parts, with paraphrased stems, marks and reference. Answers follow the examiners' solution notes where they exist (say so), otherwise “my answer, checked”, backed by tests. List partly relevant questions separately, marked “not answered here”.
- **Revision summary page:** about 40 numbered recall prompts covering the whole section, with tick boxes and page references.
- Include tick boxes, and the instruction to answer *before* reading (retrieval practice) and to come back after a few days, then a week (spacing).

## Figures

- Compute every plot from the actual formulas (Python → SVG), never hand-sketch maths.
- Labels sit next to the thing they label. Keep figures small; they are A4-page sized.
- Illustrative plots of simulated data must say so.

## Layout

- A4 portrait sheets, filled by flowing topics; whole blocks (boxes, column groups) move to the next sheet when they don't fit, and a block is never split. Covers and the revision summary get their own sheets; answer pages start a new sheet. The build fails only if a single block is taller than a sheet, or something is too wide or clipped. Never shrink text below the minimum to save space.
- Body text at least 12px on A4; source tags are tiny and grey.
- The palette must work on colour e-ink: distinguish by lightness as well as hue.
