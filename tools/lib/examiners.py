"""Examiners' comments on past Tripos questions, from the department's yearly "Comments by assessors" PDFs in the
harvest mirror (sources/raw/www.cl.cam.ac.uk/teaching/exams/reports/comments<year>*.pdf).

comment(year, paper, q, title) → the text about that question, or None. The PDFs change layout from year to year, so a
block is only returned when its heading names the course (a word of `title`): a wrong block is worse than none.
"""
import functools, glob, os, re

import pymupdf

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REPORTS = os.path.join(ROOT, "sources", "raw", "www.cl.cam.ac.uk", "teaching", "exams", "reports")
STOP = {"and", "the", "of", "in", "to", "for", "introduction", "further", "systems", "computer", "science", "ib", "c"}


@functools.lru_cache(maxsize=None)
def _papers(year):
    """{paper number: [lines]} for one year's comments."""
    lines = []
    for f in sorted(glob.glob(os.path.join(REPORTS, f"comments{year}*.pdf"))):
        with pymupdf.open(f) as d:
            for p in d:
                lines += p.get_text().split("\n")
    # The running header names the exam year. A file whose header names another year is a mislabelled copy (the
    # department's comments2025.pdf is the 2024 comments again): trust none of it.
    named = {int(m.group(1)) for l in lines for m in [re.search(r"Tripos Examinations?\s+(\d{4})", l)] if m}
    if named and int(year) not in named:
        return {}
    lines = [l for l in lines if not re.search(r"Tripos Examinations?\s+\d{4}\s*$", l)]
    out, cur = {}, None
    for l in lines:
        m = re.match(r"^\s*(?:(?:I[AB]|1[AB]|II|Part\s+\w+)\s+)?PAPER\s+(\d+)\s*$", l.strip(), re.I)
        if m:
            cur = out.setdefault(int(m.group(1)), [])
        elif cur is not None:
            cur.append(l)
    return out


def _blocks(lines):
    """[(question number, [lines])]: headings are 'Question 5: Title', '5  Title' or a bare '5' above the title."""
    heads = []
    for i, l in enumerate(lines):
        s = l.strip()
        m = re.match(r"^Question\s+(\d{1,2})\b", s, re.I) or re.match(r"^(?:Q\.?\s*)?(\d{1,2})[.:)]?\s*$", s) or re.match(r"^(\d{1,2})[.:)]?\s+[A-Z]", s)
        if m and 1 <= int(m.group(1)) <= 16:
            heads.append((i, int(m.group(1))))
    seq = []
    for i, q in heads:                               # keep headings whose numbers rise: a stray number in prose rarely fits
        if not seq or q > seq[-1][1]:
            seq.append((i, q))
    return [(q, lines[i:(seq[k + 1][0] if k + 1 < len(seq) else len(lines))]) for k, (i, q) in enumerate(seq)]


def comment(year, paper, q, title):
    words = {w for w in re.findall(r"[a-z+]+", title.lower()) if w not in STOP and len(w) > 1}
    for num, block in _blocks(_papers(year).get(int(paper), [])):
        if num != int(q):
            continue
        head = " ".join(block[:3]).lower()
        if not any(w in head for w in words):
            return None
        text = re.sub(r"\n\s*\n+", "\n", "\n".join(l.rstrip() for l in block)).strip()
        return text if len(text) > 40 and "no comments provided" not in text.lower()[:200] else None
    return None


def years():
    return sorted({int(m.group(1)) for f in os.listdir(REPORTS) if os.path.isdir(REPORTS) for m in [re.match(r"comments(\d{4})", f)] if m}) if os.path.isdir(REPORTS) else []
