## Fitting the text to the page (this is what makes it look like a printed book)
The build lays every topic out on whole A4 pages and prints a **FIT report**: for each page, the free height in px and
every block on it with its height. A page with more than 70px free at its foot fails the build, and so does a block
that overflows. Nothing stretches: you make it fit, the way a book's editor does.
- **Plan in pages.** A page holds about 1020px under the banner: body text is about 19px a line and 13 words a line; a
  statement heading is 28px; the warm-up questions and tip strip that close a topic take about 180px.
- **A two-page topic turns the page where you say**: write `::pagebreak` on its own line between two sections, never
  between a listing or figure and the points that explain it. The second page repeats the banner. Without
  `::pagebreak` the block that does not fit moves on by itself and leaves a hole above it.
- **Read the FIT report after every build and act on the numbers.** GAP: that many px are blank at the foot of the
  page. SPILL: a little of the topic ran onto an extra page. OVERFLOW: a block is taller than what is left.
- **Fill a gap with something worth a mark, never with padding:** another step in a worked example, a second short
  example, a COMMON MISTAKE or exam-tip margin note, a small comparison table, one more numbered point that says *why*,
  one more warm-up question. **Close an overflow by tightening:** cut a repeated sentence, merge two points, drop the
  weakest warm-up question, shorten a listing to the lines the points discuss, make a figure smaller (`h=`), move a
  section across the `::pagebreak`.
- A few lines out? Change the wording of two or three points. Hundreds of px out? Move or add a whole block.
- Expect three to six builds for the chapter to fit. `tools/lint {{M}} {{CH}}` is the same build without the PDF.
