"""Lecture timeline, coverage and lecture dossiers (decision 0004: the textbook grows one lecture at a time).

  tools/lectures <module>                    where every lecture stands and what to do next → out/<m>/lectures.json
  tools/lectures <module> coverage <n|all>   which slides the lecture really covered → out/<m>/coverage/L<nn>.json
  tools/lectures <module> dossier <n>        everything the writer needs for lecture n → out/<m>/dossiers/L<nn>.md
  tools/lectures <module> gate <n|all>       coverage gate: every covered slide is cited by the chapter (exit 1 if not);
                                             also lists which linked evidence the chapter cites and which it does not
  tools/lectures <module> evidence           link every other unit of the sources to its lecture(s) → out/<m>/evidence.json
  tools/lectures <module> place              a fresh Claude places the units the text match cannot (also tools/place <m>)
  tools/lectures <module> audit              what the harvest has that the module does not use → out/<m>/audit.json

The timeline is modules/<m>/lectures.yaml. Coverage compares the recording with the slides: video frames against the
slide images when the video file is in the harvest, otherwise the recording's OCR'd slide titles (Panopto) against
the slide titles. It is evidence, not proof: lectures.yaml `overrides:` wins.
"""
import datetime, difflib, json, os, re, subprocess, sys

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "sources", "raw")
COVERED_S, BRIEF_S = 20, 4          # seconds on screen for a slide group to count as covered / brief
FRAME_EVERY = 3                     # seconds between sampled video frames
MATCH_MIN = 0.80                    # frame-to-slide correlation needed to call the frame a slide of this deck
WINDOW, SIM_FLOOR = 20, 0.10         # captions-only alignment: window length (s); similarity a window needs to count
DIFF_MIN = 0.30                     # and, with the shared slide template removed, to say which slide it is


def load(m):
    f = os.path.join(ROOT, "modules", m, "lectures.yaml")
    if not os.path.exists(f):
        sys.exit(f"no modules/{m}/lectures.yaml yet (see docs/decisions/0004-lecture-by-lecture.md)")
    cfg = yaml.safe_load(open(f)) or {}
    idx = json.load(open(os.path.join(ROOT, "sources", m, "index.json")))
    src = yaml.safe_load(open(os.path.join(ROOT, "modules", m, "sources.yaml"))) or {}
    tr = {t["id"]: t for t in src.get("transcripts") or []}
    return cfg, idx, tr


def lecture(cfg, n):
    for L in cfg.get("lectures", []):
        if str(L["n"]) == str(n):
            return L
    sys.exit(f"no lecture {n} in lectures.yaml")


def slide_pages(spec, idx):
    """'N s112-144; L8ctd' → [(source id, pdf page)] in order. A bare source id means every page of it."""
    out = []
    for item in [x.strip() for x in str(spec or "").split(";") if x.strip()]:
        sid = next((s for s in sorted(idx["sources"], key=len, reverse=True) if item == s or item.startswith(s + " ")), None)
        if not sid:
            raise ValueError(f"slides: unknown source in {item!r}")
        rest = item[len(sid):].strip()
        if not rest:
            out += [(sid, p) for p in range(1, idx["sources"][sid].get("pages", 0) + 1)]
        for a, b in re.findall(r"[sp](\d+)(?:\s*[-–]\s*(\d+))?", rest):
            out += [(sid, p) for p in range(int(a), int(b or a) + 1)]
    return out


def cited_pages(text, sid):
    """PDF pages of source `sid` named in a citation string such as 'N s130, s164-166; Lab6 p1'."""
    pages = set()
    for item in str(text).split(";"):
        item = item.strip()
        if not (item == sid or item.startswith(sid + " ")):
            continue
        for a, b in re.findall(r"\b[sp](\d+)(?:\s*[-–]\s*(\d+))?", item[len(sid):]):
            pages.update(range(int(a), int(b or a) + 1))
    return pages


def page_file(idx, sid, p, ext):
    return os.path.join(idx["sources"][sid]["pages_dir"], f"{p:04d}.{ext}")


def page_text(idx, sid, p):
    f = os.path.join(ROOT, page_file(idx, sid, p, "txt"))
    return open(f, encoding="utf-8", errors="replace").read() if os.path.exists(f) else ""


def title_of(text):
    for l in text.split("\n"):
        l = l.strip()
        if len(l) > 3 and not re.fullmatch(r"[\d\s/]+", l) and not re.match(r"(Copyright|©)", l):
            return l[:80]
    return ""


def recording(L, tr):
    """Files of a lecture's recording: {'captions': path, 'video': path|None, 'meta': dict, 'transcript': id}."""
    r = L.get("recording")
    if not r:
        return None
    t = tr.get(r.get("transcript"))
    if not t:
        return None
    d = os.path.join(RAW, t["dir"])
    key = str(r.get("file") or r.get("date") or "")
    files = sorted(os.listdir(d)) if os.path.isdir(d) else []
    cap = next((f for f in files if f.startswith(key) and f.endswith((".srt", ".vtt"))), None) if key else None
    if not cap:
        return None
    stem = re.sub(r"\.(en[\w-]*\.)?(srt|vtt)$", "", cap)
    vid = os.path.join(d, stem + ".mp4")
    meta = os.path.join(d, stem + ".json")
    return dict(captions=os.path.join(d, cap), video=vid if os.path.exists(vid) else None, transcript=t["id"],
                meta=json.load(open(meta)) if os.path.exists(meta) else {}, supplementary=bool(t.get("supplementary")),
                machine=os.path.exists(os.path.join(d, stem + ".asr.json")) or True)


def cues(path):
    """[(start s, text)] from .srt/.vtt."""
    out, last = [], ""
    for block in re.split(r"\n\s*\n", open(path, encoding="utf-8", errors="replace").read().replace("\r", "")):
        lines = [l for l in block.split("\n") if l.strip()]
        k = next((i for i, l in enumerate(lines) if "-->" in l), None)
        if k is None:
            continue
        h = re.match(r"\s*(?:(\d+):)?(\d+):(\d+)[.,](\d+)", lines[k])
        if not h:
            continue
        t = int(h.group(1) or 0) * 3600 + int(h.group(2)) * 60 + int(h.group(3))
        for l in lines[k + 1:]:
            l = re.sub(r"<[^>]+>", "", l).strip()
            if l and l != last:
                out.append((t, l)); last = l
    return out


# ---------------------------------------------------------------- coverage
def frames_timeline(video, slides, idx):
    """Match sampled video frames to slide images. → [(t, slide index or None, score)]"""
    import numpy as np
    from PIL import Image, ImageFilter
    W, H = 320, 180
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", video, "-vf", f"fps=1/{FRAME_EVERY},scale={W}:{H},format=gray", "-f", "rawvideo", "-"],
                         check=True, capture_output=True).stdout
    fr = np.frombuffer(raw, dtype=np.uint8).reshape(-1, H, W).astype(np.float32)
    # The slide usually sits in a 4:3 box inside the 16:9 frame: find the box from columns that are ever bright.
    cols = np.where(np.median(fr.mean(axis=1), axis=0) > 12)[0]
    x0, x1 = (int(cols[0]), int(cols[-1]) + 1) if len(cols) else (0, W)
    SW, SH = 96, 72

    def small(a):
        # Blur before shrinking: thin text then survives the pixel or two by which a recording is offset from the PDF.
        im = Image.fromarray(a.astype(np.uint8)).resize((SW * 3, SH * 3), Image.BILINEAR).filter(ImageFilter.GaussianBlur(2.5)).resize((SW, SH), Image.BILINEAR)
        v = np.asarray(im, dtype=np.float32).ravel()
        v = v - v.mean()
        n = np.linalg.norm(v)
        return v / n if n > 1e-6 else v

    F = np.stack([small(f[:, x0:x1]) for f in fr])
    S = np.stack([small(np.asarray(Image.open(os.path.join(ROOT, page_file(idx, sid, p, "png"))).convert("L"))) for sid, p in slides])
    C = F @ S.T                                      # raw similarity: is this frame a slide of this deck at all?
    # Slides share a template (title bar, background), so pick *which* slide after removing what they have in common.
    tpl = S.mean(axis=0)
    unit = lambda M: (M - M.mean(axis=1, keepdims=True)) / np.maximum(np.linalg.norm(M - M.mean(axis=1, keepdims=True), axis=1, keepdims=True), 1e-6)
    D = unit(F - tpl) @ unit(S - tpl).T
    best = D.argmax(axis=1)
    ok = [C[i, best[i]] >= MATCH_MIN and D[i, best[i]] >= DIFF_MIN for i in range(len(F))]
    # Near-identical slides (Part 1 / Part 2 of the same code) can't be told apart reliably: count the runner-up's time too.
    amb = [0] * len(slides)
    for i in range(len(F)):
        if ok[i]:
            for j in np.where(D[i] >= D[i, best[i]] - 0.04)[0]:
                if j != best[i]:
                    amb[int(j)] += FRAME_EVERY
    return [(i * FRAME_EVERY, int(best[i]) if ok[i] else None, float(D[i, best[i]])) for i in range(len(F))], amb


def norm_title(s):
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def ocr_anchors(meta, texts):
    """Panopto's OCR'd on-screen headings, each matched to a slide that has that line. → [(t, slide index, text)]"""
    toc = sorted({(c["t"], c["text"]) for c in meta.get("contents", []) if c.get("type") == "SmartOcrToc" and len(c["text"]) > 5})
    lines = [[norm_title(l) for l in t.split("\n") if len(l.strip()) > 5] for t in texts]
    out, last = [], 0
    for t, text in toc:
        q = norm_title(text)
        if len(q) < 6:
            continue
        cands = [i for i, ls in enumerate(lines) if q in ls] or \
                [i for i, ls in enumerate(lines) if any(difflib.SequenceMatcher(None, x, q).ratio() >= 0.85 or (len(q) > 14 and len(x) > 14 and (x.startswith(q) or q.startswith(x))) for x in ls)]
        if cands:                                   # several slides can share a line: prefer the next one in order
            hit = next((i for i in cands if i >= last), cands[-1])
            last = hit
            out.append((t, hit, text))
    return out


STOP = set("the and that this with for you are was have what which from they will can not but all one there their then than them when your how its our out had has just like get got going know now see say said think want well yeah okay right really thing things lot kind mean way very here some any could would should about into over also more most much many only other such because been being does doing done let lets make made need put take use used using two three first second new each".split())


def words(s):
    return [w for w in re.findall(r"[a-z][a-z0-9_]{2,}", s.lower()) if w not in STOP]


def align_captions(cs, texts, anchors, duration):
    """Which slide was being talked about, window by window. Slides are assumed to be shown in order (a slide can be
    skipped, never revisited); a window that matches nothing is 'off'. → seconds per slide, [(t0, t1) off], window→slide"""
    import math
    n, m = len(texts), int(duration // WINDOW) + 1
    docs = [words(t) for t in texts]
    df = {}
    for d in docs:
        for w in set(d):
            df[w] = df.get(w, 0) + 1
    idf = {w: math.log(1 + n / c) for w, c in df.items()}

    def vec(ws):
        v = {}
        for w in ws:
            if w in idf:
                v[w] = v.get(w, 0) + idf[w]
        z = math.sqrt(sum(x * x for x in v.values())) or 1
        return {w: x / z for w, x in v.items()}

    sv = [vec(d) for d in docs]
    win = [[] for _ in range(m)]
    for t, line in cs:
        for k in (t // WINDOW - 1, t // WINDOW, t // WINDOW + 1):      # a little context either side
            if 0 <= k < m:
                win[int(k)] += words(line)
    sim = [[0.0] * n for _ in range(m)]
    for k in range(m):
        wv = vec(win[k])
        for i in range(n):
            a, b = (wv, sv[i]) if len(wv) < len(sv[i]) else (sv[i], wv)
            sim[k][i] = sum(x * b.get(w, 0) for w, x in a.items()) - SIM_FLOOR
    for t, i, _ in anchors:                           # a heading seen on screen is strong evidence for that slide
        for k in range(int(t // WINDOW), min(m, int(t // WINDOW) + 2)):
            sim[k][i] += 0.5
    NEG = -1e9
    best = [[NEG] * (n + 1) for _ in range(m + 1)]    # best[k][i]: windows < k placed, last slide used < i  (prefix max over i)
    choice = [[None] * n for _ in range(m)]
    best[0] = [0.0] * (n + 1)
    for k in range(m):
        run, row = NEG, [NEG] * (n + 1)
        row[0] = best[k][0]                           # nothing placed yet
        for i in range(n):
            stay = best[k][i + 1]                     # window k is 'off', or belongs to a slide ≤ i already counted
            take = best[k][i + 1] + sim[k][i]         # window k is slide i (earlier windows used slides ≤ i)
            choice[k][i] = take > stay
            run = max(run, max(stay, take))
            row[i + 1] = max(row[i], max(stay, take))
        best[k + 1] = row
    # walk back
    at, i = [None] * m, n - 1
    for k in range(m - 1, -1, -1):
        while i > 0 and best[k + 1][i + 1] == best[k + 1][i]:
            i -= 1
        if choice[k][i] and best[k + 1][i + 1] == best[k][i + 1] + sim[k][i]:
            at[k] = i
    secs = [0] * n
    for k, i in enumerate(at):
        if i is not None:
            secs[i] += WINDOW
    off, k = [], 0
    while k < m:
        if at[k] is None:
            j = k
            while j < m and at[j] is None:
                j += 1
            if (j - k) * WINDOW >= 120:
                off.append((k * WINDOW, j * WINDOW))
            k = j
        else:
            k += 1
    return secs, off, at


def coverage(m, n, cfg=None, idx=None, tr=None, quiet=False):
    if cfg is None:
        cfg, idx, tr = load(m)
    L = lecture(cfg, n)
    slides = slide_pages(L.get("slides"), idx)
    rec = recording(L, tr)
    if slides and L.get("given") is False and L.get("write"):
        # Not lectured this year but the chapter was asked for: there is no recording, so every slide counts as covered.
        texts = [page_text(idx, s, p) for s, p in slides]
        rows, gi = [], -1
        for i, (sid, p) in enumerate(slides):
            t = title_of(texts[i])
            if not (i and t and t == rows[-1]["title"] and sid == rows[-1]["source"]):
                gi += 1
            rows.append(dict(cite=f"{sid} s{p}", source=sid, page=p, title=t, group=gi, seconds=0, group_seconds=0, first_at=None,
                             status="covered", overridden=False, said=""))
        out = dict(module=m, lecture=L["n"], title=L.get("title"), method="not lectured this year: no recording, every slide counted as covered",
                   transcript=None, captions="(none)", this_year=True, minutes=0, slides=rows, other=[],
                   summary={"covered": gi + 1, "brief": 0, "skipped": 0, "not seen": 0, "unclear": 0},
                   computed=datetime.datetime.now().isoformat(timespec="seconds"))
        d = os.path.join(ROOT, "out", m, "coverage")
        os.makedirs(d, exist_ok=True)
        json.dump(out, open(os.path.join(d, f"L{int(L['n']):02d}.json"), "w"), indent=1, ensure_ascii=False)
        if not quiet:
            print(f"L{L['n']}: not lectured this year; {gi + 1} slide groups ({len(slides)} pages) all counted as covered")
        return out
    if not slides or not rec:
        if not quiet:
            print(f"L{n}: " + ("no slides listed" if not slides else "no recording in the harvest yet"))
        return None
    texts = [page_text(idx, s, p) for s, p in slides]
    titles = [title_of(t) for t in texts]
    cs = cues(rec["captions"])
    duration = max([t for t, _ in cs] + [rec["meta"].get("minutes", 0) * 60, 1])
    secs = [0] * len(slides)
    first = [None] * len(slides)
    said = [[] for _ in slides]
    amb = [0] * len(slides)
    other = []                                       # stretches of the recording that match no slide of this lecture
    if rec["video"]:
        method = "video frames matched to slide images"
        tl, amb = frames_timeline(rec["video"], slides, idx)
        at = {}
        for t, i, score in tl:
            if i is None:
                if other and other[-1][1] == t:
                    other[-1][1] = t + FRAME_EVERY
                else:
                    other.append([t, t + FRAME_EVERY, ""])
            else:
                secs[i] += FRAME_EVERY
                first[i] = t if first[i] is None else first[i]
            at[t // FRAME_EVERY] = i
        for t, line in cs:
            i = at.get(t // FRAME_EVERY)
            if i is not None:
                said[i].append(line)
        other = [o for o in other if o[1] - o[0] >= 15]
    else:
        method = "captions aligned to slide text, anchored by Panopto's on-screen headings (an estimate)"
        # One recording can hold several lectures (a two-hour session): align it against all of their slides together,
        # in lecture order, then keep this lecture's share. Time spent on the other lectures is theirs, not "off".
        sharing = [x for x in cfg.get("lectures", []) if (recording(x, tr) or {}).get("captions") == rec["captions"]]
        before = [sp for x in sharing if x is not L and sharing.index(x) < sharing.index(L) for sp in slide_pages(x.get("slides"), idx)]
        after = [sp for x in sharing if x is not L and sharing.index(x) > sharing.index(L) for sp in slide_pages(x.get("slides"), idx)]
        joint = [page_text(idx, s_, p_) for s_, p_ in before] + texts + [page_text(idx, s_, p_) for s_, p_ in after]
        secs_j, off, at_j = align_captions(cs, joint, ocr_anchors(rec["meta"], joint), duration)
        lo = len(before)
        secs = secs_j[lo:lo + len(slides)]
        at = [i - lo if i is not None and lo <= i < lo + len(slides) else None for i in at_j]
        if len(sharing) > 1:
            method += f"; the recording is shared by Lectures {', '.join(str(x['n']) for x in sharing)}"
            mine = [k for k, i in enumerate(at) if i is not None]
            span = (min(mine) * WINDOW, (max(mine) + 1) * WINDOW) if mine else (0, 0)
            off = [(a, b) for a, b in off if a >= span[0] and b <= span[1]]
        other = [[a, b, ""] for a, b in off]
        for k, i in enumerate(at):
            if i is not None and first[i] is None:
                first[i] = k * WINDOW
        for t, line in cs:
            i = at[min(len(at) - 1, int(t // WINDOW))]
            if i is not None:
                said[i].append(line)
    # Group overlay builds (consecutive pages with the same title): the group's time decides the status.
    groups, g = [], []
    for i in range(len(slides)):
        if g and titles[i] and titles[i] == titles[g[-1]] and slides[i][0] == slides[g[-1]][0]:
            g.append(i)
        else:
            if g:
                groups.append(g)
            g = [i]
    if g:
        groups.append(g)
    ov = {str(k): v for k, v in (L.get("overrides") or {}).items()}
    rows = []
    for gi, g in enumerate(groups):
        total = sum(secs[i] for i in g)
        if rec["video"]:
            status = "covered" if total >= COVERED_S else "brief" if total >= BRIEF_S else "skipped"
            if status == "skipped" and sum(amb[i] for i in g) >= 15:
                status = "unclear"                    # looked almost identical to a neighbouring slide that was shown
        else:                                         # captions-only estimate: one stray window is not coverage
            status = "covered" if total >= 2 * WINDOW else "brief" if total >= WINDOW else "not seen"
        for i in g:
            sid, p = slides[i]
            cite = f"{sid} s{p}"
            st = ov.get(cite, status)
            rows.append(dict(cite=cite, source=sid, page=p, title=titles[i], group=gi, seconds=secs[i], group_seconds=total, first_at=first[i],
                             status=st, overridden=cite in ov, said=" ".join(said[i])))
    out = dict(module=m, lecture=L["n"], title=L.get("title"), method=method, transcript=rec["transcript"], captions=os.path.relpath(rec["captions"], ROOT),
               this_year=not rec["supplementary"], minutes=round(duration / 60), slides=rows,
               other=[dict(start=a, end=b, text=t, said=" ".join(line for tt, line in cs if a <= tt < b)) for a, b, t in other],
               summary={k: len({r["group"] for r in rows if r["status"] == k}) for k in ("covered", "brief", "skipped", "not seen", "unclear")},
               computed=datetime.datetime.now().isoformat(timespec="seconds"))
    d = os.path.join(ROOT, "out", m, "coverage")
    os.makedirs(d, exist_ok=True)
    json.dump(out, open(os.path.join(d, f"L{int(L['n']):02d}.json"), "w"), indent=1, ensure_ascii=False)
    if not quiet:
        s = out["summary"]
        print(f"L{L['n']}: {len(groups)} slide groups ({len(slides)} pages), {out['minutes']} min — covered {s['covered']}, brief {s['brief']}, "
              f"skipped {s['skipped']}, not seen {s['not seen']}, unclear {s['unclear']}; {len(other)} stretch(es) off these slides  [{method}]")
        for r in rows:
            if r["status"] in ("skipped", "not seen", "brief", "unclear") and (r["group"] != rows[rows.index(r) - 1]["group"] or rows.index(r) == 0):
                print(f"     {r['status']:<8} {r['cite']:<10} {r['group_seconds']:>4}s  {r['title'][:60]}")
    return out


def load_coverage(m, n):
    f = os.path.join(ROOT, "out", m, "coverage", f"L{int(n):02d}.json")
    return json.load(open(f)) if os.path.exists(f) else None


# ---------------------------------------------------------------- status
def chapter_report(m, ch):
    f = os.path.join(ROOT, "out", m, ch, "report.json") if ch else None
    return json.load(open(f)) if f and os.path.exists(f) else None


def gate(m, n, cfg, idx):
    """Coverage gate for one lecture → (uncited covered slides, cited-but-skipped slides) or None if it can't run."""
    L = lecture(cfg, n)
    cov, rep = load_coverage(m, n), chapter_report(m, L.get("chapter"))
    if not cov or not rep:
        return None
    cited = {}
    for p in rep["pages"]:
        for c in p.get("citations", []):
            for sid in {r["source"] for r in cov["slides"]}:
                for pg in cited_pages(c, sid):
                    cited.setdefault((sid, pg), p["id"])
    groups = {}
    for r in cov["slides"]:
        groups.setdefault(r["group"], []).append(r)
    waived = {str(x) for x in (L.get("not_in_chapter") or [])}
    missing, extra = [], []
    for g in groups.values():
        hit = any((r["source"], r["page"]) in cited for r in g)
        label = g[0]["cite"] + (f"–{g[-1]['page']}" if len(g) > 1 else "")
        if g[0]["status"] in ("covered", "unclear") and not hit and not any(r["cite"] in waived for r in g):
            missing.append(dict(slides=label, title=g[0]["title"], seconds=g[0]["group_seconds"]))
        if g[0]["status"] in ("skipped",) and hit:
            extra.append(dict(slides=label, title=g[0]["title"]))
    return missing, extra


def evidence_use(m, L, rows_ev, rep):
    """Which of the units linked to a lecture its chapter cites. → {kind: {linked, cited, not_cited: [unit ids]}}"""
    import map as mapmod
    units = mapmod.load_units(m)
    cites = [c for p in rep["pages"] for c in p.get("citations", [])]
    out = {}
    for x in rows_ev:
        u = units.get(x["unit"])
        if not u or x["kind"] in ("talk", "solution") or x["how"] == "unconfirmed":
            continue
        src = u["source"]
        if u["kind"] == "exam-part":
            part = u["id"][len(src):]
            hit = any(c == src or c.startswith(src + part) for c in cites)       # the whole question, or this part
        elif u["kind"] == "examiner-comment":
            hit = any(c.startswith(src) for c in cites)
        else:
            hit = any(cited_pages(c, src) & set(u["pages"]) for c in cites) if u["kind"] != "sheet-question" else any(c.startswith(u["cite"]) for c in cites)
            if not hit and idx_offset(m, src):
                off = idx_offset(m, src)
                hit = any({p + off for p in cited_pages(c, src)} & set(u["pages"]) for c in cites)
        d = out.setdefault(x["kind"], dict(linked=0, cited=0, not_cited=[]))
        d["linked"] += 1
        d["cited"] += bool(hit)
        if not hit:
            d["not_cited"].append(u["cite"])
    return out


def idx_offset(m, sid):
    return json.load(open(os.path.join(ROOT, "sources", m, "index.json")))["sources"].get(sid, {}).get("printed_offset", 0)


def status(m, write=True):
    cfg, idx, tr = load(m)
    today = datetime.date.today()
    mod = yaml.safe_load(open(os.path.join(ROOT, "modules", m, "module.yaml")))
    rows = []
    ef = os.path.join(ROOT, "modules", m, "errata.yaml")
    errata = (yaml.safe_load(open(ef)) or []) if os.path.exists(ef) else []
    import evidence
    ev = evidence.load(m)
    for L in cfg.get("lectures", []):
        n = L["n"]
        date = L.get("date")
        date = datetime.date.fromisoformat(str(date)) if date else None
        r = dict(n=n, title=L.get("title", ""), date=str(date) if date else None, delivery=L.get("delivery", "live"), chapter=L.get("chapter"),
                 slides_spec=L.get("slides"), examinable=L.get("examinable", True), note=L.get("note"))
        r["happened"] = bool(date and date <= today) or L.get("delivery") == "prerecorded" or bool(L.get("given") is False and L.get("write"))
        try:
            sl = slide_pages(L.get("slides"), idx)
            r["slides"] = len(sl)
            r["slides_ok"] = bool(sl) and all(os.path.exists(os.path.join(ROOT, page_file(idx, s, p, "png"))) for s, p in sl)
        except ValueError as e:
            r["slides"], r["slides_ok"], r["problem"] = 0, False, str(e)
        r["given"] = L.get("given", True)
        rec = recording(L, tr)
        r["recording"] = bool(rec)
        r["recording_kind"] = None if not rec else ("video + captions" if rec["video"] else "captions")
        cov = load_coverage(m, n)
        r["coverage"] = cov["summary"] if cov else None
        ch = L.get("chapter")
        cdir = os.path.join(ROOT, "modules", m, "content", ch) if ch else None
        r["drafted"] = bool(cdir and os.path.isdir(cdir) and any(f.endswith(".md") for f in os.listdir(cdir)))
        rep = chapter_report(m, ch)
        r["built"] = bool(rep)
        r["lint"] = len(rep["problems"]) if rep else None
        r["pages"] = len({s for p in rep["pages"] for s in p.get("sheets", [])}) if rep else 0
        g = gate(m, n, cfg, idx) if rep and cov else None
        r["gate"] = None if g is None else dict(missing=g[0], extra=g[1])
        rows_ev = ev["lectures"].get(str(n), [])
        r["exam"] = sorted({x["unit"] for x in rows_ev if x["kind"] == "exam-part"} | set(L.get("exam") or []))
        r["extra"] = L.get("extra") or []
        r["evidence"] = {k: sum(1 for x in rows_ev if x["kind"] == k) for k in sorted({x["kind"] for x in rows_ev})}
        r["evidence_unconfirmed"] = sum(1 for x in rows_ev if x["how"] == "unconfirmed")
        r["evidence_use"] = evidence_use(m, L, rows_ev, rep) if rep else None
        try:
            mine = set(slide_pages(L.get("slides"), idx))
            r["errata"] = [dict(where=e.get("where"), text=e.get("text")) for e in errata
                           if any((sid, pg) in mine for sid in {s for s, _ in mine} for pg in cited_pages(str(e.get("src") or e.get("where", "")), sid))]
        except ValueError:
            r["errata"] = []
        if not L.get("examinable", True):
            r["state"], r["next"] = "not examinable", "Nothing to write."
        elif L.get("given") is False and not L.get("write"):
            r["happened"] = False
            r["state"], r["next"] = "not given", "Slides were posted but the lecture was not given this year. Ask before writing it."
        elif not r["happened"]:
            r["state"], r["next"] = "not yet", f"Lecture is on {date}." if date else "No date yet."
        elif not r["slides_ok"] or not (r["recording"] or (L.get("given") is False and L.get("write"))):
            miss = [x for x, ok in (("slides", r["slides_ok"]), ("recording", r["recording"])) if not ok]
            r["state"] = "waiting for materials"
            r["next"] = "Missing " + " and ".join(miss) + ": re-harvest (ask Claude to update this module)." + (" Can be written from slides alone, with coverage unknown." if r["slides_ok"] else "")
        elif not cov:
            r["state"], r["next"] = "materials in", f"tools/lectures {m} coverage {n}"
        elif not r["drafted"]:
            r["state"], r["next"] = "ready to write", f"tools/batch --only {m}:{n}"
        elif not r["built"] or r["lint"]:
            r["state"], r["next"] = "drafted", f"tools/build {m} {ch}" + (f" ({r['lint']} lint problems)" if r["lint"] else "")
        elif g and g[0]:
            r["state"], r["next"] = "built", f"Coverage gate: {len(g[0])} covered slide group(s) not in the chapter (tools/lectures {m} gate {n})."
        else:
            r["state"], r["next"] = "built", f"tools/verify {m} {ch}"       # the GUI refines this with the verifier ledger
        rows.append(r)
    out = dict(module=m, generated=datetime.datetime.now().isoformat(timespec="seconds"), today=str(today), lectures=rows,
               book=(mod.get("book") or None))
    if write:
        d = os.path.join(ROOT, "out", m)
        os.makedirs(d, exist_ok=True)
        json.dump(out, open(os.path.join(d, "lectures.json"), "w"), indent=1, ensure_ascii=False)
    return out


def print_status(m):
    out = status(m)
    print(f"{m}: {len(out['lectures'])} lectures (today {out['today']})")
    for r in out["lectures"]:
        cov = r["coverage"]
        c = f"cov {cov['covered'] + cov.get('unclear', 0)}/{cov['brief']}/{cov['skipped'] + cov['not seen']}" if cov else "cov —"
        print(f"  L{r['n']:<3} {str(r['date'] or ''):<10} {r['state']:<22} {r['slides']:>3} slides  {c:<14} {(r['chapter'] or '—'):<5} {r['title'][:38]:<38}  → {r['next']}")


# ---------------------------------------------------------------- dossier
def dossier(m, n):
    import describe
    cfg, idx, tr = load(m)
    L = lecture(cfg, n)
    cov = load_coverage(m, n) or coverage(m, n, cfg, idx, tr, quiet=True)
    out = [f"# Lecture dossier: {m} Lecture {L['n']} — {L.get('title', '')}", "",
           "Write the chapter from this. Rules (decision 0004): teach `covered` slides in full; `brief` ones get a sentence or a margin note; leave",
           "`skipped` ones out unless a past paper examined them (`unclear` = looked the same as a neighbouring slide that was shown: treat as covered). **Captions are machine-made: never quote or cite them.** They show what was stressed and",
           "how it was explained; every fact comes from a slide or another citable source. Each slide is given as its extracted text plus a description",
           "of its image made once by a reader (`tools/describe`). Open the PNG itself only when you will reproduce its diagram, code or formula exactly,",
           "when the description says UNSURE or LOOKS WRONG, or to settle a doubt.", ""]
    if L.get("note"):
        out += [f"Note: {L['note']}", ""]
    if cov:
        s = cov["summary"]
        out += [f"Recording: {cov['minutes']} min, `{cov['captions']}` ({cov['method']}). Slide groups: {s['covered']} covered, {s['brief']} brief, "
                f"{s['skipped']} skipped, {s['not seen']} not seen, {s.get('unclear', 0)} unclear.", ""]
        if cov["other"]:
            out += ["Stretches of the recording that match none of these slides (demos, other slides, chat): " +
                    "; ".join(f"{o['start'] // 60}:{o['start'] % 60:02d}–{o['end'] // 60}:{o['end'] % 60:02d}" + (f" “{o['text'][:40]}”" if o.get("text") else "") for o in cov["other"][:30]), ""]
            for o in cov["other"]:
                if o["end"] - o["start"] >= 60 and o.get("said"):
                    out += [f"Off-slide {o['start'] // 60}:{o['start'] % 60:02d}–{o['end'] // 60}:{o['end'] % 60:02d} (machine captions; may be a demo, a slide that is not in this year's notes, or an aside): " + o["said"][:3000], ""]
        out += ["## Slide by slide", ""]
        for r in cov["slides"]:
            when = "" if r["first_at"] is None else f", first at {int(r['first_at']) // 60}:{int(r['first_at']) % 60:02d}"
            out += [f"### `{r['cite']}` — {r['title'] or '(no title)'}  [{r['status'].upper()}{' (override)' if r['overridden'] else ''}: {r['seconds']}s on screen, group {r['group_seconds']}s{when}]",
                    f"Image: `{page_file(idx, r['source'], r['page'], 'png')}`", ""]
            txt = page_text(idx, r["source"], r["page"]).strip().replace("\x00", "")
            if txt:
                out += ["Slide text (extracted):", "```", txt[:2500], "```", ""]
            d = describe.read_desc(m, idx, r["source"], r["page"])
            out += ["From the image: " + (d or "(not described yet: run `tools/describe`, or open the image)"), ""]
            if r["said"]:
                out += ["Lecturer (machine captions): " + r["said"][:4000], ""]
    else:
        out += ["No recording in the harvest: coverage unknown. Slides:", ""]
        for sid, p in slide_pages(L.get("slides"), idx):
            out += [f"- `{sid} s{p}` — {title_of(page_text(idx, sid, p))}  (`{page_file(idx, sid, p, 'png')}`)"]
        out += [""]
    for x in L.get("more_recordings") or []:          # other recordings of this lecture this year (e.g. a live session beside a pre-recorded video)
        r2 = recording(dict(recording=x), tr)
        if r2:
            said = " ".join(line for _, line in cues(r2["captions"]))
            out += [f"## Another recording of this lecture: `{os.path.relpath(r2['captions'], ROOT)}`", "",
                    (x.get("note", "") + " " if x.get("note") else "") + "Machine captions, not aligned to the slides: evidence of what was said, never quoted or cited.", "", said[:15000] + (" …" if len(said) > 15000 else ""), ""]
    import evidence
    out += evidence.dossier_lines(m, L["n"], idx)
    ef = os.path.join(ROOT, "modules", m, "errata.yaml")
    errata = (yaml.safe_load(open(ef)) or []) if os.path.exists(ef) else []
    mine = {(r["source"], r["page"]) for r in (cov["slides"] if cov else [])}
    hits = [e for e in errata if any(pg in {p for s, p in mine if s == sid} for sid in {s for s, _ in mine} for pg in cited_pages(str(e.get("src") or e.get("where", "")), sid))]
    if hits:
        out += ["## Known errata on these slides", ""] + [f"- {e['where']}: {e['text']}" for e in hits] + [""]
    d = os.path.join(ROOT, "out", m, "dossiers")
    os.makedirs(d, exist_ok=True)
    f = os.path.join(d, f"L{int(L['n']):02d}.md")
    open(f, "w").write("\n".join(out).replace("\x00", ""))
    print(f"L{L['n']} dossier → {os.path.relpath(f, ROOT)} ({sum(len(x) for x in out) // 1000} kB)")


def main():
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    m = a[0]
    cmd = a[1] if len(a) > 1 else "status"
    if cmd == "status":
        return print_status(m)
    if cmd in ("evidence", "audit", "place"):
        import evidence
        if cmd == "place":
            opt = lambda k, d: a[a.index(k) + 1] if k in a else d
            sys.exit(evidence.place(m, model=opt("--model", "sonnet"), jobs=int(opt("--jobs", 3)), limit=int(opt("--limit", 0)) or None))
        print(f"{m}: evidence linked to each lecture") if cmd == "evidence" else None
        return evidence.link(m) if cmd == "evidence" else evidence.audit(m)
    cfg, idx, tr = load(m)
    ns = [L["n"] for L in cfg["lectures"]] if len(a) > 2 and a[2] == "all" else a[2:3]
    if not ns:
        sys.exit(__doc__)
    if cmd == "coverage":
        for n in ns:
            coverage(m, n, cfg, idx, tr)
        status(m)
    elif cmd == "dossier":
        for n in ns:
            dossier(m, n)
    elif cmd == "gate":
        bad = 0
        for n in ns:
            g = gate(m, n, cfg, idx)
            if g is None:
                print(f"L{n}: gate not run (needs coverage and a built chapter)"); continue
            missing, extra = g
            print(f"L{n}: " + ("coverage gate OK" if not missing else f"{len(missing)} covered slide group(s) not cited by the chapter"))
            for x in missing:
                print(f"     MISSING {x['slides']:<14} {x['seconds']:>4}s  {x['title'][:60]}")
            for x in extra:
                print(f"     note: cites {x['slides']} which the lecture skipped ({x['title'][:50]})")
            import evidence
            L = lecture(cfg, n)
            use = evidence_use(m, L, evidence.for_lecture(m, n), chapter_report(m, L.get("chapter")))
            for k, d in use.items():
                print(f"     evidence: {d['cited']}/{d['linked']} linked {k} unit(s) cited" + (": not cited " + ", ".join(d["not_cited"][:12]) + (" …" if len(d["not_cited"]) > 12 else "") if d["not_cited"] else ""))
            bad += len(missing)
        status(m)
        sys.exit(1 if bad else 0)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
