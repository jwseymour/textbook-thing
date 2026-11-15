"""Everything the course has on each lecture (decision 0006): the evidence linker, the source audit and the dossier text.

  tools/lectures <module> evidence     link every unit of every source to the lecture(s) it belongs to → out/<m>/evidence.json
  tools/lectures <module> audit        what the harvest has that the module does not use yet → out/<m>/audit.json

A lecture's own slides and this year's recording come from lectures.yaml. Everything else (notes sections, handout,
lab and sheet pages, sheet questions, past-paper parts with their solution notes and examiners' comments, earlier
years' recordings) is linked here by comparing its text with the lecture's slides and what was said over them. Nothing
is linked by hand unless the comparison gets it wrong:

  lectures.yaml, per lecture:   extra: [source id or citation]   exam: [exam-part unit ids]    always linked ("pinned")
                                not_relevant: [unit or source id]                              never linked
  lectures.yaml, top level:     unlinked_ok: {unit or source id: why}                          known to belong to no lecture

A unit that fits no lecture is never dropped silently: it is listed as unlinked in the audit until it is pinned or
explained. Links are evidence for the writer, not proof: the dossier shows the score, and the writer reads the unit.
"""
import collections, json, math, os, re, sys

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "sources", "raw")
sys.path.insert(0, os.path.join(ROOT, "tools"))

FLOOR = 0.25            # a text match below this is not worth showing, even unconfirmed
SURE, CLEAR = 0.8, 0.6  # "auto": the lecture's slides have ≥ SURE of the unit's vocabulary and the runner-up ≤ CLEAR of that
SUPP_PER_LECTURE = 8    # earlier years' recordings: the best few 3-minute windows per lecture
STOP = set("the and for that this with are was you can have not from but its will which what when where there their then than "
           "they them one two all any has had were been does did how why who into out our your these those such also just "
           "like get got going know think thing things here well really very about because would could should might some more "
           "most over only other each use used using may let see say said yeah okay right now way want need something".split())


def toks(s):
    w = [x for x in re.findall(r"[a-z][a-z0-9+#_]{2,}", s.lower()) if x not in STOP]
    return w + [a + " " + b for a, b in zip(w, w[1:])]


def load_cfg(m):
    return yaml.safe_load(open(os.path.join(ROOT, "modules", m, "lectures.yaml"))) or {}


def matches(key, u):
    """Does a lectures.yaml entry (unit id, source id or citation like 'ES p3') name this unit?"""
    key = str(key).strip()
    if key in (u["id"], u["source"], u.get("cite")):
        return True
    if key.startswith(u["source"] + " "):
        pages = set()
        for a, b in re.findall(r"\b[spQ](\d+)(?:\s*[-–]\s*(\d+))?", key[len(u["source"]):]):
            pages.update(range(int(a), int(b or a) + 1))
        loc = [int(x) for x in re.findall(r"\d+", u["id"][len(u["source"]):])][:2]
        return bool(loc) and any(p in pages for p in range(loc[0], loc[-1] + 1))
    return False


def links_path(m):
    return os.path.join(ROOT, "modules", m, "links.yaml")


def load_links(m):
    f = links_path(m)
    return (yaml.safe_load(open(f)) or {}) if os.path.exists(f) else {}


def timeline_key(cfg):
    """Changes when a lecture gains slides: units placed as 'later in the course' are then asked about again."""
    return ",".join(str(L["n"]) for L in cfg.get("lectures", []) if L.get("slides"))


def lexical(m, cfg, idx, units):
    """scores(unit id) → [(score, lecture)] best first. The score is the share of the unit's distinctive vocabulary
    (weighted by how few lectures use each word) that the lecture's slides have, or its recording said at least twice."""
    import lectures as lec, map as mapmod
    own, docs = {}, {}
    for L in cfg.get("lectures", []):
        try:
            pages = lec.slide_pages(L.get("slides"), idx)
        except ValueError:
            pages = []
        for sid, p in pages:
            own[(sid, p)] = L["n"]
        cov = lec.load_coverage(m, L["n"])
        said = collections.Counter(toks(" ".join(r.get("said", "") for r in cov["slides"]))) if cov else {}
        docs[L["n"]] = (set(toks(" ".join(lec.page_text(idx, s, p) for s, p in pages))), {k for k, v in said.items() if v >= 2})
    df = collections.Counter(k for a, b in docs.values() for k in a | b)
    idf = {k: math.log((len(docs) + 1) / (v + 0.5)) for k, v in df.items()}

    def scores(uid):
        q = {k for k in toks(mapmod.unit_text(m, units[uid], idx)) if k in idf}
        den = sum(idf[k] for k in q) or 1
        return sorted(((sum(idf[k] * (1 if k in a else 0.6 if k in b else 0) for k in q) / den, n) for n, (a, b) in docs.items()), reverse=True)
    return scores, own


def link(m, quiet=False):
    """Decide, for every unit that is not a lecture's own slide, which lecture(s) it belongs to.
    how = pinned (lectures.yaml) · placed (links.yaml: read and placed by tools/place) · auto (its text is this lecture's
    slides almost word for word) · unconfirmed (best text match, waiting for tools/place)."""
    import lectures as lec, map as mapmod
    cfg, idx, tr = lec.load(m)
    units = mapmod.load_units(m)
    supp = {t["id"] for t in tr.values() if t.get("supplementary")}
    lectures = cfg.get("lectures", [])
    known = {L["n"] for L in lectures}
    scores, own = lexical(m, cfg, idx, units)
    placed = load_links(m)
    decks = {sid for sid, _ in own}
    seen = timeline_key(cfg)
    placed = {k: v for k, v in placed.items() if not (v.get("status") == "later" and v.get("seen") != seen)}   # ask again: more has been lectured
    out = {str(L["n"]): [] for L in lectures}
    unlinked, pending, follow, unranged = [], [], [], []
    ok = {str(k): v for k, v in (cfg.get("unlinked_ok") or {}).items()}
    exam_home = collections.defaultdict(set)          # question source id → lectures any of its parts is linked to
    for u in units.values():
        k = u["kind"]
        if k == "web" or (k == "talk" and u["source"] not in supp):
            continue                                  # course pages go in every dossier; this year's talk comes with the slides
        if k == "slide" and (u["source"], u["pages"][0]) in own:
            continue                                  # a lecture's own slide
        if k in ("solution", "examiner-comment"):
            follow.append(u); continue
        why = next((v for key, v in ok.items() if matches(key, u)), None)
        if why:
            unlinked.append(dict(unit=u["id"], kind=k, title=u.get("title", "")[:70], nearest=None, score=0, ok=why)); continue
        if k == "slide" and u["source"] in decks:
            unranged.append(u["id"]); continue        # a slide of a lecture deck that no lecture has reached yet
        barred = {L["n"] for L in lectures if any(matches(x, u) for x in (L.get("not_relevant") or []))}
        sc = [(s, n) for s, n in scores(u["id"]) if n not in barred]
        by = dict((n, s) for s, n in sc)
        got = {L["n"]: "pinned" for L in lectures if any(matches(x, u) for x in (L.get("extra") or []) + (L.get("exam") or []))}
        if k == "talk":
            if sc and sc[0][0] >= FLOOR:
                got.setdefault(sc[0][1], "auto")
        elif u["id"] in placed:
            for n in placed[u["id"]].get("lectures") or []:
                if n in known and n not in barred:
                    got.setdefault(n, "placed")
        elif sc and sc[0][0] >= SURE and (len(sc) < 2 or sc[1][0] <= CLEAR * sc[0][0]):
            got.setdefault(sc[0][1], "auto")
        else:
            pending.append(u["id"])
            if sc and sc[0][0] >= FLOOR and not got:
                got[sc[0][1]] = "unconfirmed"
        for n, how in got.items():
            out[str(n)].append(dict(unit=u["id"], kind=k, score=round(by.get(n, 0), 3), how=how))
            if k == "exam-part":
                exam_home[u["source"]].add(n)
        if not got:
            why = (placed.get(u["id"]) or {}).get("why")
            if (placed.get(u["id"]) or {}).get("status") == "later":
                why = "later in the course: " + str(why)
            unlinked.append(dict(unit=u["id"], kind=k, title=u.get("title", "")[:70], nearest=sc[0][1] if sc else None, score=round(sc[0][0], 3) if sc else 0, ok=why))
    for u in follow:                                  # solution notes and examiners' comments go where their question went
        src = re.sub(r"^(Sol|Rep) ", "", u["source"])
        for n in sorted(exam_home.get(src, [])):
            out[str(n)].append(dict(unit=u["id"], kind=u["kind"], score=0, how="with its question"))
    for n, rows in out.items():
        talk = sorted((r for r in rows if r["kind"] == "talk"), key=lambda r: -r["score"])
        keep = {r["unit"] for r in talk[:SUPP_PER_LECTURE]}
        out[n] = sorted((r for r in rows if r["kind"] != "talk" or r["unit"] in keep), key=lambda r: (r["kind"], -(r["score"] or 0)))
    unlinked = [x for x in unlinked if x["kind"] != "talk"]       # an old recording that matches nothing is not a loss
    low = sorted(uid for uid, v in placed.items() if v.get("confidence") == "low" and uid in units)
    res = dict(module=m, lectures=out, unlinked=unlinked, pending=pending, low_confidence=low, unranged=unranged)
    d = os.path.join(ROOT, "out", m)
    os.makedirs(d, exist_ok=True)
    json.dump(res, open(os.path.join(d, "evidence.json"), "w"), indent=1, ensure_ascii=False)
    if not quiet:
        for L in lectures:
            c = collections.Counter(r["kind"] for r in out[str(L["n"])])
            print(f"  L{L['n']:<3} " + (", ".join(f"{v} {k}" for k, v in sorted(c.items())) or "nothing linked"))
        print(f"  {len(pending)} unit(s) not placed yet" + (f" → tools/place {m}" if pending else "") + f"; {len(unlinked)} belong to no lecture → tools/lectures {m} audit")
    return res


# ---------------------------------------------------------------- placing (a fresh Claude reads each unit)
PLACE_PROMPT = """You are sorting a university course's materials by lecture. Do not write anything about the content; only decide where each item belongs.

In this folder:
- `lectures.md` — this year's lectures in order: number, date, title, whether it has been given yet, and the title of every slide.
- `slides/L<nn>.txt` — the full text of each lecture's slides (text extraction garbles maths; that does not matter here).
- `batch.md` — the items to place: past exam question parts, sheet and supervision questions, sections of the printed notes, lab notes, pages of handouts. Each has an id.

For EVERY item in `batch.md`, decide which lecture or lectures teach what the item needs or covers. Read the slides files (use Grep for key terms) whenever the slide titles alone do not settle it: do not guess from one shared word.
- `status: placed` with `lectures: [n, ...]` — the lecture(s) whose slides teach the knowledge the item tests or presents. An exam part that needs two lectures gets both. Prefer the lecture that teaches the idea over one that only mentions it. Give at most three.
- `status: later` with `lectures: []` — the item is about material in this year's course that no lecture in `lectures.md` has slides for yet (see "Not yet lectured" at the end of `lectures.md`).
- `status: none` with `lectures: []` — the item is not about anything in this year's slides (an old syllabus topic, a contents page, administrative text).
`why` is one short phrase naming the topic that decided it (under 15 words). `confidence` is `low` when you could not settle it from the slides.

Return JSON matching the schema, one entry per item id in `batch.md`, ids copied exactly."""
PLACE_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["placements"], "properties": {"placements": {"type": "array", "items": {
    "type": "object", "additionalProperties": False, "required": ["unit", "status", "lectures", "why", "confidence"], "properties": {
        "unit": {"type": "string"}, "status": {"type": "string", "enum": ["placed", "later", "none"]}, "lectures": {"type": "array", "items": {"type": "integer"}},
        "why": {"type": "string"}, "confidence": {"type": "string", "enum": ["high", "low"]}}}}}}


def place(m, model="sonnet", jobs=3, batch=25, limit=None):
    """Ask a fresh Claude to place every unit the linker could not place from its text. → modules/<m>/links.yaml"""
    import concurrent.futures, subprocess, tempfile, lectures as lec, map as mapmod
    cfg, idx, tr = lec.load(m)
    units = mapmod.load_units(m)
    ev = link(m, quiet=True)
    todo = ev["pending"][: limit or None]
    if not todo:
        print(f"{m}: every unit is placed"); return 0
    d = tempfile.mkdtemp(prefix=f"revision-guides-place-{m}-")
    os.makedirs(os.path.join(d, "slides"))
    L_md = [f"# {m}: this year's lectures", ""]
    today = __import__("datetime").date.today()
    for L in cfg.get("lectures", []):
        try:
            pages = lec.slide_pages(L.get("slides"), idx)
        except ValueError:
            pages = []
        given = L.get("delivery") == "prerecorded" or (L.get("date") and str(L["date"]) <= str(today))
        L_md += [f"## Lecture {L['n']} — {L.get('title', '')}  ({L.get('date', 'no date')}, {'given' if given else 'not yet given'}{'' if pages else ', NO SLIDES YET'})"]
        titles = []
        for sid, p in pages:
            t = lec.title_of(lec.page_text(idx, sid, p))
            if t and (not titles or titles[-1] != t):
                titles.append(t)
        L_md += ["Slides: " + " · ".join(titles), ""]
        open(os.path.join(d, "slides", f"L{int(L['n']):02d}.txt"), "w").write("\n\n".join(f"--- {sid} s{p} ---\n" + lec.page_text(idx, sid, p) for sid, p in pages))
    if ev["unranged"]:
        L_md += ["## Not yet lectured", "Slides in the course's decks that no lecture above has reached (titles):", ""]
        seen_t = []
        for uid in ev["unranged"]:
            t = units[uid].get("title", "")
            if t and t not in seen_t:
                seen_t.append(t)
        L_md += [" · ".join(seen_t[:400]), ""]
    open(os.path.join(d, "lectures.md"), "w").write("\n".join(L_md))
    todo.sort(key=lambda uid: (units[uid]["source"], uid))
    batches = [todo[i:i + batch] for i in range(0, len(todo), batch)]
    print(f"{m}: placing {len(todo)} unit(s) with {model}, {len(batches)} batch(es), {jobs} at a time (context in {d})")

    def run(k):
        bd = os.path.join(d, f"b{k:02d}")
        os.makedirs(bd)
        for name in ("lectures.md", "slides"):
            os.symlink(os.path.join(d, name), os.path.join(bd, name))
        lines = []
        for uid in batches[k]:
            u = units[uid]
            lines += [f"## id: {uid}", f"({u['kind']}: {u.get('title', '')[:80]})", "", "```", mapmod.unit_text(m, u, idx).strip()[:3500], "```", ""]
        open(os.path.join(bd, "batch.md"), "w").write("\n".join(lines))
        r = subprocess.run(["claude", "-p", PLACE_PROMPT, "--output-format", "json", "--json-schema", json.dumps(PLACE_SCHEMA), "--model", model,
                            "--tools", "Read,Glob,Grep", "--allowedTools", "Read Glob Grep", "--permission-mode", "dontAsk", "--setting-sources", "project",
                            "--strict-mcp-config", "--no-session-persistence", "--no-chrome"], cwd=bd, capture_output=True, text=True, timeout=1800)
        try:
            res = json.loads(r.stdout)
            return k, res["structured_output"]["placements"], res.get("total_cost_usd", 0)
        except Exception:  # noqa: BLE001
            return k, None, (r.stderr or r.stdout)[:300]

    known = {L["n"] for L in cfg.get("lectures", [])}
    seen, done, cost = timeline_key(cfg), 0, 0.0
    with concurrent.futures.ThreadPoolExecutor(jobs) as ex:
        for k, res, extra in ex.map(run, range(len(batches))):
            if res is None:
                print(f"  ✗ batch {k + 1}: {extra}"); continue
            links = load_links(m)
            for x in res:
                if x["unit"] not in batches[k]:
                    continue
                ls = sorted({n for n in x["lectures"] if n in known})
                st = x["status"] if (x["status"] != "placed" or ls) else "none"
                links[x["unit"]] = dict(lectures=ls if st == "placed" else [], status=st, why=x["why"], confidence=x["confidence"], by=model, **({"seen": seen} if st == "later" else {}))
                done += 1
            cost += extra or 0
            head = ("# Where each unit of the course's sources belongs (decision 0006). Written by tools/place (a fresh Claude reads the unit against the\n"
                    "# lecture list); edit by hand to correct one (set `by: hand` or `by: opus`). status: placed | later (not lectured yet; asked again when the\n"
                    "# timeline grows) | none (not in this year's course).\n")
            open(links_path(m), "w").write(head + "".join(yaml.safe_dump({k: v}, allow_unicode=True, width=10000, default_flow_style=True).replace("{" + k, k, 1).rstrip()[:-1] + "\n"
                                                    if False else f"{json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)}\n" for k, v in sorted(links.items())))
            print(f"  ✓ batch {k + 1}/{len(batches)}: {len(res)} placed")
    print(f"{m}: {done}/{len(todo)} unit(s) placed" + (f" (${cost:.2f})" if cost else ""))
    link(m)
    return 0 if done == len(todo) else 1


def load(m, fresh=False):
    f = os.path.join(ROOT, "out", m, "evidence.json")
    if fresh or not os.path.exists(f):
        return link(m, quiet=True)
    deps = [f"modules/{m}/lectures.yaml", f"sources/{m}/units.json", "tools/evidence.py"] + ([f"modules/{m}/links.yaml"] if os.path.exists(links_path(m)) else [])
    newest = max(os.path.getmtime(os.path.join(ROOT, p)) for p in deps)
    return json.load(open(f)) if os.path.getmtime(f) >= newest else link(m, quiet=True)


def for_lecture(m, n):
    return load(m)["lectures"].get(str(n), [])


# ---------------------------------------------------------------- dossier text
GROUPS = [("Notes, handout, lab and sheet pages", ("notes-section", "page", "slide")),
          ("Sheet and supervision questions", ("sheet-question",)),
          ("Past-paper parts", ("exam-part",)),
          ("Earlier years' and public recordings: clarification only", ("talk",))]


def dossier_lines(m, n, idx):
    """The 'everything else on this lecture' part of a lecture dossier."""
    import map as mapmod
    units = mapmod.load_units(m)
    rows = [r for r in for_lecture(m, n) if r["unit"] in units]
    by = collections.defaultdict(list)
    for r in rows:
        by[r["kind"]].append(r)
    imgs = lambda u: ", ".join(f"`{os.path.join(idx['sources'][u['source']]['pages_dir'], f'{p:04d}.png')}`" for p in u["pages"]
                               if os.path.exists(os.path.join(ROOT, idx["sources"][u["source"]]["pages_dir"], f"{p:04d}.png")))
    why = load_links(m)
    tag = lambda r: "closest match to this lecture's slides" if r["kind"] == "talk" else {"pinned": "pinned", "auto": "same text as the slides", "with its question": "", "unconfirmed": f"UNCONFIRMED text match {r['score']:.2f}: check it is about this lecture",
                     "placed": "placed: " + str((why.get(r["unit"]) or {}).get("why", ""))}[r["how"]]
    out = ["## Everything else the course has on this lecture", "",
           "Every other unit of the course's sources that belongs to this lecture: placed by reading it against the lecture list (`tools/place`),",
           "or matched by its text (`tools/lectures " + m + " evidence`). It tells you how deep to go and what the exam asks; it does not add topics",
           "the lecture did not cover. If a unit is not about this lecture after all, say so in your report.", "",
           "| group | linked |", "|---|---|"] + [f"| {name} | {sum(len(by[k]) for k in kinds)} |" for name, kinds in GROUPS] + [""]
    # How much of each unit's text goes in (the images are always listed). Exam parts first: they are short and say
    # what matters; then sheet questions, earlier years' clips, and the notes with what is left of the budget.
    CAP = {"exam-part": 3000, "sheet-question": 1800, "talk": 2000, "notes-section": 7000, "page": 5000, "slide": 1500}
    budget, allow = 110000, {}
    for kinds in (("exam-part",), ("sheet-question",), ("talk",), ("notes-section", "page", "slide")):
        for r in sorted((r for k in kinds for r in by[k]), key=lambda r: (r["how"] == "unconfirmed", -(r["score"] or 0))):
            n_ = min(CAP[r["kind"]], len(mapmod.unit_text(m, units[r["unit"]], idx).strip()), max(budget, 0))
            allow[r["unit"]] = n_
            budget -= n_
    for name, kinds in GROUPS:
        mine = [r for k in kinds for r in by[k]]
        if not mine:
            continue
        out += [f"### {name}", ""]
        if kinds == ("talk",):
            out += ["Not this year's lectures. They may clarify something this year's lecture covered; they never add a topic, and they are", "machine captions: never quote or cite them.", ""]
        if kinds == ("exam-part",):
            mine.sort(key=lambda r: (r["how"] != "pinned", -(units[r["unit"]].get("year") or 0), r["unit"]))
        for r in mine:
            u = units[r["unit"]]
            head = f"#### `{u['cite']}` — {u.get('title', '')[:70]}" + (f" — {u['marks']} marks" if u.get("marks") else "") + f"  [{tag(r)}]"
            body = mapmod.unit_text(m, u, idx).strip().replace("\x00", "")
            cap = allow.get(r["unit"], 0)
            out += [head] + ([f"Images: {imgs(u)}"] if u["pages"] and imgs(u) else [])
            if r["how"] == "auto" and r["kind"] in ("page", "slide", "notes-section"):
                out += ["(repeats this lecture's slides, which are given in full above: citable, text not repeated)"]
            elif cap >= 200:
                out += ["", "```", body[:cap] + (" … (cut: read the rest from the images)" if len(body) > cap else ""), "```"]
            else:
                out += ["(text left out to keep the dossier readable: read the images)"]
            if r["kind"] == "exam-part":
                for pre, label in (("Sol ", "Solution notes"), ("Rep ", "Examiners' comments")):
                    sid = pre + u["source"]
                    if sid in idx["sources"]:
                        s = idx["sources"][sid]
                        files = ", ".join(f"`{os.path.join(s['pages_dir'], f'{p:04d}.' + ('png' if pre == 'Sol ' else 'txt'))}`" for p in range(1, s["pages"] + 1))
                        out += [f"{label} (`{sid}`): {files}"]
                        if pre == "Rep ":
                            out += ["", "```", open(os.path.join(ROOT, s["pages_dir"], "0001.txt"), encoding="utf-8").read().strip()[:3000], "```"]
                    elif pre == "Sol ":
                        out += ["Solution notes: not released (an answer would be ours; back any code or maths with a check)."]
            out += [""]
    web = [s for s in idx["sources"].values() if s["kind"] == "web"]
    if web:
        out += ["### Course pages", ""] + [f"- `{s['id']}` — {s.get('title', s['id'])}: `{os.path.join(s['pages_dir'], '0001.txt')}`" for s in web] + [""]
    return out


# ---------------------------------------------------------------- audit
def _ranges(ids):
    """['CS:s209', 'CS:s210', 'DS:s101'] → 'CS s209-210, DS s101'"""
    by = collections.defaultdict(list)
    for x in ids:
        sid, _, loc = x.rpartition(":")
        by[sid].append(int(loc[1:]))
    out = []
    for sid, ps in by.items():
        ps, a = sorted(ps), None
        for i, p in enumerate(ps):
            a = p if a is None else a
            if i + 1 == len(ps) or ps[i + 1] != p + 1:
                out.append(f"{sid} s{a}" + (f"-{p}" if p != a else "")); a = None
    return ", ".join(out)


MEDIA = (".mp4", ".srt", ".vtt", ".json", ".m4a", ".mp3", ".webm")


def audit(m, quiet=False):
    """What the harvest holds for this course that the module does not use: files, papers, recordings, unlinked units."""
    import lectures as lec
    cfg, idx, tr = lec.load(m)
    src = yaml.safe_load(open(os.path.join(ROOT, "modules", m, "sources.yaml"))) or {}
    ignore = [str(x) for x in src.get("ignore") or []]
    used = {os.path.basename(s.get("url") or "") for s in idx["sources"].values()} | {s.get("file") for s in idx["sources"].values()}
    out = dict(module=m, files=[], recordings=[], lectures=[], unlinked=[])
    # 1. Files in the mirror of the course site (and any Moodle folders named in sources.yaml) that no source uses.
    base = re.sub(r"^https?://", "", src.get("base_url", "")).rstrip("/")
    dirs = ([os.path.join(RAW, base)] if base else []) + [os.path.join(RAW, d) for d in src.get("also") or []]
    for d in dirs:
        for dp, _, names in os.walk(d):
            for f in sorted(names):
                rel = os.path.relpath(os.path.join(dp, f), RAW)
                if f.lower().endswith(MEDIA) or f in used or f == "index.html" and "video" in dp:
                    continue
                if any(re.search(p, rel) for p in ignore):
                    continue
                out["files"].append(rel)
    # 2. Recordings in this module's caption folders that no lecture uses.
    taken = {os.path.basename(r["captions"]) for L in cfg.get("lectures", []) for x in [L.get("recording")] + (L.get("more_recordings") or []) if x
             for r in [lec.recording(dict(recording=x), tr)] if r}
    for t in tr.values():
        if t.get("supplementary"):
            continue
        d = os.path.join(RAW, t["dir"])
        for f in sorted(os.listdir(d)) if os.path.isdir(d) else []:
            if f.endswith((".srt", ".vtt")) and f not in taken and not any(re.search(p, f) for p in ignore):
                out["recordings"].append(f"{t['id']}: {f}")
    # 3. Lectures that have happened but lack slides or a recording.
    st = lec.status(m, write=False)
    for r in st["lectures"]:
        if r["happened"] and r["examinable"] and (not r["slides_ok"] or not r["recording"]):
            out["lectures"].append(f"Lecture {r['n']} ({r['date']}): no " + " and no ".join(x for x, ok in (("slides", r["slides_ok"]), ("recording", r["recording"])) if not ok))
    # 4. Units linked to no lecture.
    ev = load(m, fresh=True)
    pend = set(ev["pending"])
    out["pending"] = sorted(pend)
    out["unlinked"] = [x for x in ev["unlinked"] if not x["ok"] and x["unit"] not in pend]
    out["explained"] = [x for x in ev["unlinked"] if x["ok"] and x["unit"] not in pend]
    out["low_confidence"] = ev["low_confidence"]
    out["unranged"] = ev["unranged"]
    json.dump(out, open(os.path.join(ROOT, "out", m, "audit.json"), "w"), indent=1, ensure_ascii=False)
    if not quiet:
        print(f"{m}: source audit")
        for key, label, hint in (("files", "file(s) in the harvest that no source uses", "add to sources.yaml, or to its `ignore:` list (a regex on the path) with a comment saying why"),
                                 ("recordings", "recording(s) attached to no lecture", "give a lecture its `recording:` in lectures.yaml, or add to `ignore:`"),
                                 ("lectures", "lecture(s) given without slides or a recording here", "re-harvest"),
                                 ("unlinked", "unit(s) that fit no lecture", "pin with `extra:`/`exam:` on a lecture, or explain under `unlinked_ok:` in lectures.yaml")):
            print(f"  {len(out[key])} {label}" + (f"  → {hint}" if out[key] else ""))
            for x in out[key][:40]:
                print("     " + (x if isinstance(x, str) else f"{x['unit']:<22} {x['kind']:<16} nearest L{x['nearest']} ({x['score']:.2f})  {x['title'][:50]}"))
            if len(out[key]) > 40:
                print(f"     … and {len(out[key]) - 40} more (out/{m}/audit.json)")
        print(f"  {len(out['pending'])} unit(s) not placed in a lecture yet" + (f"  → tools/place {m}" if out["pending"] else ""))
        print(f"  {len(out['low_confidence'])} placement(s) the placer was unsure of" + ("  → check them in modules/" + m + "/links.yaml: " + ", ".join(out["low_confidence"][:15]) + (" …" if len(out["low_confidence"]) > 15 else "") if out["low_confidence"] else ""))
        by = collections.Counter(re.sub(r"^(later in the course): .*", r"\1", str(x["ok"])) if str(x["ok"]).startswith("later") else "not in this year's course (or explained)" for x in out["explained"])
        print(f"  {len(out['explained'])} unit(s) deliberately in no lecture" + (": " + "; ".join(f"{v} {k}" for k, v in by.items()) if by else "") + (f"  (out/{m}/audit.json has each one's reason)" if out["explained"] else ""))
        if out["unranged"]:
            print(f"  {len(out['unranged'])} slide(s) of the lecture decks are in no lecture's range yet (later lectures, or a gap in lectures.yaml): " + _ranges(out["unranged"]))
    out["problems"] = len(out["files"]) + len(out["recordings"]) + len(out["lectures"]) + len(out["unlinked"]) + len(out["pending"])
    json.dump(out, open(os.path.join(ROOT, "out", m, "audit.json"), "w"), indent=1, ensure_ascii=False)
    return out
