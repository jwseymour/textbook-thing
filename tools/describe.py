#!/usr/bin/env python3
"""Describe each lecture slide's image once (decision pending, 2026-11-11), so that writers work from text and open an
image only when they need to. A fresh Sonnet session reads a batch of slide PNGs beside their extracted text and writes
what the text misses: diagrams, layout, code, formulas, tables. Kept in sources/<m>/desc/<source>/<page>.md, keyed by the
image's hash, and put into the lecture dossier by tools/lectures.

Usage: tools/describe <module> [<lecture n> ...] [--model sonnet] [--batch 6] [--jobs 3] [--force]
"""
import concurrent.futures, hashlib, json, os, re, subprocess, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import lectures as lec

PROMPT = """You are preparing notes for a textbook writer who will NOT look at these lecture slides: they will have only
each slide's extracted text (given below) and what you write. For each slide listed, open its image with the Read tool
and write a description of what the image carries that the extracted text does not:
- every diagram, graph or picture: what it shows, its parts and labels, what connects to what (arrows, order, nesting),
  axes and rough values, and the point it makes;
- code, formulas, tables and bit layouts exactly as shown (a code block or Markdown table), whenever the extracted text
  lost the layout, the symbols, the alignment or which label belongs to which thing;
- emphasis the layout gives (colour, a crossed-out item, a highlighted line, a "before/after").
Do not repeat plain bullet text that the extraction already has right. Do not add knowledge from outside the slide, and
do not correct the slide: if something on it looks wrong, describe it as it is and add "LOOKS WRONG: <why>".
If you cannot read something or cannot tell which label belongs where, write "UNSURE: <what>", so the writer knows to
open the image. If the extracted text already carries everything, the description is exactly "Text complete."
Keep each description under about 200 words unless code or a table needs more.

Slides:
"""
SCHEMA = {"type": "object", "required": ["slides"], "properties": {"slides": {"type": "array", "items": {
    "type": "object", "required": ["cite", "description"], "properties": {"cite": {"type": "string"}, "description": {"type": "string"}}}}}}

def desc_file(m, sid, p):
    return os.path.join(ROOT, "sources", m, "desc", re.sub(r"\W+", "_", sid), f"{p:04d}.md")

def sha(f):
    return hashlib.sha1(open(f, "rb").read()).hexdigest()[:16]

def read_desc(m, idx, sid, p):
    """The stored description of a slide, or None if there is none for the image as it is now."""
    f, png = desc_file(m, sid, p), os.path.join(ROOT, lec.page_file(idx, sid, p, "png"))
    if not (os.path.exists(f) and os.path.exists(png)):
        return None
    head, _, body = open(f, encoding="utf-8").read().partition("\n")
    return body.strip() if head.strip() == f"<!-- image {sha(png)} -->" else None

def run_batch(m, idx, batch, model):
    lines = []
    for sid, p in batch:
        lines.append(f"## `{sid} s{p}` — image `{lec.page_file(idx, sid, p, 'png')}`\nExtracted text:\n```\n{lec.page_text(idx, sid, p).strip()[:2500]}\n```\n")
    args = ["claude", "-p", PROMPT + "\n".join(lines), "--output-format", "json", "--json-schema", json.dumps(SCHEMA), "--model", model,
            "--tools", "Read", "--allowedTools", "Read", "--permission-mode", "dontAsk", "--setting-sources", "project",
            "--strict-mcp-config", "--no-session-persistence", "--no-chrome"]
    env = {k: v for k, v in os.environ.items() if k != "CLAUDE_EFFORT"}
    r = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, env=env, timeout=1200)
    try:
        res = json.loads(r.stdout[r.stdout.index("{"):])
        got = {s["cite"].strip("` "): s["description"].strip() for s in res["structured_output"]["slides"]}
    except Exception as e:
        return 0, 0.0, f"✗ {batch[0]}…: {e}: {(r.stderr or r.stdout)[-300:]}"
    n = 0
    for sid, p in batch:
        d = got.get(f"{sid} s{p}")
        if not d:
            continue
        f = desc_file(m, sid, p)
        os.makedirs(os.path.dirname(f), exist_ok=True)
        open(f, "w", encoding="utf-8").write(f"<!-- image {sha(os.path.join(ROOT, lec.page_file(idx, sid, p, 'png')))} -->\n{d}\n")
        n += 1
    return n, res.get("total_cost_usd") or 0.0, None if n == len(batch) else f"✗ {len(batch) - n} slide(s) of a batch came back without a description"

def main():
    a = sys.argv[1:]
    opt = lambda k, d: a[a.index(k) + 1] if k in a else d
    model, size, jobs, force = opt("--model", "sonnet"), int(opt("--batch", 6)), int(opt("--jobs", 3)), "--force" in a
    pos = [x for i, x in enumerate(a) if not x.startswith("--") and not (i and a[i - 1] in ("--model", "--batch", "--jobs"))]
    if not pos:
        sys.exit(__doc__)
    m, cfg_idx = pos[0], None
    cfg, idx, _ = lec.load(m)
    want = [L for L in cfg.get("lectures", []) if (str(L["n"]) in pos[1:] if pos[1:] else L.get("given", True) is not False or L.get("write"))]
    todo = []
    for L in want:
        for sid, p in lec.slide_pages(L.get("slides"), idx):
            if os.path.exists(os.path.join(ROOT, lec.page_file(idx, sid, p, "png"))) and (force or read_desc(m, idx, sid, p) is None) and (sid, p) not in todo:
                todo.append((sid, p))
    if not todo:
        print(f"{m}: every slide already has a description"); return
    batches = [todo[i:i + size] for i in range(0, len(todo), size)]
    print(f"{m}: describing {len(todo)} slide image(s) in {len(batches)} session(s) ({model})")
    done = cost = 0; bad = []
    with concurrent.futures.ThreadPoolExecutor(jobs) as ex:
        for n, c, err in ex.map(lambda b: run_batch(m, idx, b, model), batches):
            done += n; cost += c
            if err: bad.append(err); print(err)
    print(f"{m}: {done}/{len(todo)} described, ${cost:.2f}")
    sys.exit(1 if bad else 0)

if __name__ == "__main__":
    main()
