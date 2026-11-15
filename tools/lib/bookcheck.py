"""Read a built book PDF back and check it against what the build meant to print.

Usage: bookcheck.py <guide.pdf> <expect.json>   → prints {"checked": [...], "problems": [...]} as JSON.

expect.json (written by tools/build.mjs for `book` builds):
  sheets:   number of A4 sheets the build laid out
  pages:    [{id, title, kind, chapter, sheets: [n, …]}]  every topic, in book order
  contents: {sheets: [n, …], rows: [{heading: "…"} | {range: "4–5", label: "…"}]}  the contents page, in order
  edition:  {sheets: [n, …], rows: [{lecture: 6, title: "…", range: "4–11"}]}      chapters the edition page says are in

The point is independence: the contents page and the page numbers are generated, so this does not trust the
generator; it opens the PDF that would be released and reads the printed text.
"""
import json, re, sys

import pymupdf


def norm(s):
    """Lower-case letters and digits only, with any dash kept as '-' so 4–5 is not read as 45."""
    s = re.sub(r"\$[^$]*\$", " ", str(s))          # maths in a title prints as glyphs; compare the words around it
    s = re.sub(r"[‐-―−-]", "-", s.lower())
    return re.sub(r"[^a-z0-9-]+", "", s)


def main():
    pdf, expect = pymupdf.open(sys.argv[1]), json.load(open(sys.argv[2]))
    text = [p.get_text() for p in pdf]
    problems, checked = [], []

    # 1. Sheet count.
    if len(text) != expect["sheets"]:
        problems.append(f"the PDF has {len(text)} pages but the build laid out {expect['sheets']} sheets")
    checked.append(f"{len(text)} PDF pages")

    # 2. Every sheet prints its own number at the foot (the cover has none).
    bad = []
    for i, t in enumerate(text[1:], start=2):
        lines = [l.strip() for l in t.splitlines() if l.strip()]
        if not lines or lines[-1] != str(i):
            bad.append(f"sheet {i} prints “{lines[-1] if lines else ''}”")
    if bad:
        problems.append("printed page numbers do not match their position: " + "; ".join(bad[:6]))
    checked.append("printed page numbers run 2…%d with none missing or repeated" % len(text))

    # 3. Every topic's title is printed on the sheet the build says it starts on.
    n = 0
    for p in expect["pages"]:
        if p["kind"] == "cover" or not p["sheets"]:
            continue
        n += 1
        s = p["sheets"][0]
        if s > len(text) or norm(p["title"]) not in norm(text[s - 1]):
            problems.append(f"“{p['title']}” is not printed on page {s}, where the build placed it")
    checked.append(f"{n} topic titles are on the pages they were placed on")

    # 4. The contents page, read back in order: every heading and every "pages + topic" row.
    c = expect.get("contents")
    if c:
        body = norm(" ".join(text[s - 1] for s in c["sheets"] if s <= len(text)))
        pos = 0
        for r in c["rows"]:
            want = norm(r["heading"]) if "heading" in r else norm(r["range"]) + norm(r["label"])
            at = body.find(want, pos)
            if at < 0:
                what = f"heading “{r['heading']}”" if "heading" in r else f"“{r['label']}” on p.{r['range']}"
                problems.append(f"contents page: {what} is missing, out of order, or printed with a different page number")
            else:
                pos = at + len(want)
        checked.append(f"contents page lists {sum('range' in r for r in c['rows'])} topics with the right page numbers, in order")

    # 5. The "about this edition" page says the right page range for every chapter that is in.
    e = expect.get("edition")
    if e:
        body = norm(" ".join(text[s - 1] for s in e["sheets"] if s <= len(text)))
        for r in e["rows"]:
            if norm(r["title"]) + norm("Yes, p." + r["range"]) not in body:
                problems.append(f"edition page: Lecture {r['lecture']} should read “Yes, p.{r['range']}”")
        checked.append(f"edition page gives the right pages for {len(e['rows'])} lectures")

    print(json.dumps({"checked": checked, "problems": problems}, ensure_ascii=False))


if __name__ == "__main__":
    main()
