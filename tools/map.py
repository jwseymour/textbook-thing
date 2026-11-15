"""Course map tooling (decision 0003): units, map validation, exam weights and topic dossiers.

  tools/map <module> units              split the ingested sources into addressable units → sources/<m>/units.json
  tools/map <module> check              validate modules/<m>/map.yaml against the units → out/<m>/map-report.json
  tools/map <module> dossier <topic>    gather everything linked to a topic → out/<m>/dossiers/<topic>.md
  tools/map <module> find "<words>"     search unit text (to find units and evidence quotes while writing the map)

A unit is smaller than a source: a notes subsection, one slide, one sheet question, one exam part (with its marks),
one solution note, a few minutes of a lecture recording's captions ("talk" units, see `transcripts:` in sources.yaml;
machine captions mis-hear, so they may be linked as `explains` evidence but are never a citable source). The map (written by Claude, reviewed by the reader) lists learning points and links each to the units
that teach, exercise or examine it. Every link carries a short verbatim quote, and `check` confirms the quote
really is in that unit, so a link can't be invented.
"""
import json, os, re, sys, unicodedata

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROLES = ("teaches", "explains", "exercises", "examines", "answers")
RAW = os.path.join(ROOT, "sources", "raw")
TALK_SECONDS = 180


def load_index(m):
    return json.load(open(os.path.join(ROOT, "sources", m, "index.json")))


def slug(sid):
    return re.sub(r"[^a-z0-9]+", "_", sid.lower()).strip("_")


def page_text(src, n):
    f = os.path.join(ROOT, src["pages_dir"], f"{n:04d}.txt")
    return open(f, encoding="utf-8", errors="replace").read() if os.path.exists(f) else ""


def norm(s):
    """Whitespace-, ligature-, quote- and case-insensitive form used to match evidence quotes."""
    s = unicodedata.normalize("NFKC", s).replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = re.sub(r"-\s*\n\s*", "", s)              # words hyphenated across a line break
    return re.sub(r"\s+", " ", s).strip().lower()


# ---------------------------------------------------------------- units
def exam_parts(text):
    """Top-level parts of a Tripos question: [(label, marks, text)]. Marks = the [n marks] found inside the part."""
    lines = text.split("\n")
    starts = [(i, m.group(1)) for i, l in enumerate(lines) for m in [re.match(r"^\(([a-h])\)\s*", l.strip())] if m]
    # keep labels that run a, b, c… in order (sub-parts like (i) don't match; stray "(a)" in prose is dropped)
    seq, want = [], "a"
    for i, lab in starts:
        if lab == want:
            seq.append((i, lab)); want = chr(ord(want) + 1)
    parts = []
    for k, (i, lab) in enumerate(seq):
        end = seq[k + 1][0] if k + 1 < len(seq) else len(lines)
        body = "\n".join(lines[i:end]).strip()
        marks = sum(int(x) for x in re.findall(r"\[(\d+)\s*marks?\]", body))
        parts.append((lab, marks, body))
    stem = "\n".join(lines[: seq[0][0]]).strip() if seq else text.strip()
    return stem, parts


def cues(path):
    """[(start seconds, text)] from an .srt or .vtt caption file, with YouTube's rolling repeats removed."""
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
            l = re.sub(r"<[^>]+>", "", l).replace("&nbsp;", " ").replace("&amp;", "&").replace("&gt;", ">").replace("&lt;", "<").strip()
            if l and l != last and not last.endswith(l):
                out.append((t, l)); last = l
    return out


def talk_units(m):
    """Units from lecture captions: one per TALK_SECONDS of each recording listed under `transcripts:` in sources.yaml."""
    cfg = yaml.safe_load(open(os.path.join(ROOT, "modules", m, "sources.yaml"))) or {}
    units = []
    for tr in cfg.get("transcripts") or []:
        d = os.path.join(RAW, tr["dir"])
        files = sorted(f for f in (os.listdir(d) if os.path.isdir(d) else []) if f.endswith((".srt", ".vtt")))
        if not files:
            print(f"  transcripts {tr['id']}: nothing in sources/raw/{tr['dir']} (run the harvest)")
        seen = set()
        for f in files:
            stem = re.sub(r"\.(en[\w-]*\.)?(srt|vtt)$", "", f)
            if stem in seen:                         # YouTube can give several English tracks for one video: keep the first
                continue
            seen.add(stem)
            n = len(seen)
            meta = os.path.join(d, stem + ".json")
            info = json.load(open(meta)) if os.path.exists(meta) else {}
            title = info.get("title") or re.sub(r"^\d+_[\w-]{11}_", "", stem)
            toc = [(c["t"], c["text"]) for c in info.get("contents", []) if c.get("type") == "SmartOcrToc"]
            chunks = {}
            for t, line in cues(os.path.join(d, f)):
                chunks.setdefault(t // TALK_SECONDS, []).append(line)
            for k, lines in sorted(chunks.items()):
                a = k * TALK_SECONDS
                on = [x for tt, x in toc if a <= tt < a + TALK_SECONDS][:3]
                units.append(dict(id=f"{tr['id']}.{n:02d}:t{a // 60}", source=tr["id"], kind="talk", pages=[], citable=False,
                                  title=f"{title} @{a // 60} min" + (" — " + "; ".join(on) if on else ""),
                                  cite=f"{tr['id']}.{n:02d} {a // 60}–{a // 60 + TALK_SECONDS // 60} min (captions, not citable)",
                                  asr=bool(tr.get("asr", True)), text=" ".join(lines)))
    return units


def build_units(m):
    idx = load_index(m)
    units = []
    for sid, s in idx["sources"].items():
        kind, n = s["kind"], s.get("pages", 0)
        if kind == "notes" and s.get("toc") and all(t["title"].strip() for t in s["toc"]):
            toc = [t for t in s["toc"] if t["pdf_page"] >= 1]
            deepest = max(t["level"] for t in toc)
            for k, t in enumerate(toc):
                nxt = toc[k + 1] if k + 1 < len(toc) else None
                if nxt and nxt["level"] > t["level"] and nxt["pdf_page"] == t["pdf_page"]:
                    continue                         # a heading that only introduces its first child
                a = t["pdf_page"]
                b = nxt["pdf_page"] if nxt else n    # the boundary page is shared with the next unit
                off = s.get("printed_offset", 0)
                pa, pb = a - off, b - off
                units.append(dict(id=f"{sid}:p{pa}" + (f"-{pb}" if pb != pa else ""), source=sid, kind="notes-section", title=t["title"],
                                  level=t["level"], pages=list(range(a, b + 1)), cite=f"{sid} p{pa}" + (f"-{pb}" if pb != pa else "")))
        elif kind in ("notes", "slides"):
            loc = "p" if kind == "notes" else "s"
            for p in range(1, n + 1):
                first = next((l.strip() for l in page_text(s, p).split("\n") if len(l.strip()) > 3), "")
                if s.get("title") and (n == 1 or s.get("members")):
                    first = s["title"] + (": " + s["members"][p - 1] if s.get("members") else "")
                units.append(dict(id=f"{sid}:{loc}{p}", source=sid, kind="page" if kind == "notes" else "slide", title=first[:70], pages=[p], cite=f"{sid} {loc}{p}"))
        elif kind == "sheet":
            for q, pages in (s.get("questions") or {}).items():
                units.append(dict(id=f"{sid}:Q{q}", source=sid, kind="sheet-question", title=f"{sid} question {q}", pages=pages, cite=f"{sid} Q{q}"))
        elif kind in ("tripos", "exam"):
            text = "\n".join(page_text(s, p) for p in range(1, n + 1))
            stem, parts = exam_parts(text)
            for lab, marks, body in parts:
                units.append(dict(id=f"{sid}({lab})", source=sid, kind="exam-part", title=f"{sid}({lab})", pages=list(range(1, n + 1)), cite=f"{sid}({lab})",
                                  marks=marks, year=s.get("year"), text=(stem + "\n" + body) if stem else body))
            if not parts:
                units.append(dict(id=sid, source=sid, kind="exam-part", title=sid, pages=list(range(1, n + 1)), cite=sid, marks=20 if kind == "tripos" else None, year=s.get("year")))
        elif kind == "solution":
            units.append(dict(id=sid, source=sid, kind="solution", title=f"Solution notes {sid[4:]}", pages=list(range(1, n + 1)), cite=sid))
        elif kind == "report":
            units.append(dict(id=sid, source=sid, kind="examiner-comment", title=s.get("title", sid), pages=[1], cite=sid, year=s.get("year")))
        elif kind == "web":
            units.append(dict(id=sid, source=sid, kind="web", title=s.get("title", sid), pages=[1], cite=sid))
    units += talk_units(m)
    out = os.path.join(ROOT, "sources", m, "units.json")
    json.dump(dict(module=m, units=units), open(out, "w"), indent=1, ensure_ascii=False)
    by = {}
    for u in units:
        by[u["kind"]] = by.get(u["kind"], 0) + 1
    print(f"{len(units)} units → {os.path.relpath(out, ROOT)}  " + ", ".join(f"{v} {k}" for k, v in sorted(by.items())))
    odd = [u["id"] for u in units if u["kind"] == "exam-part" and u.get("year") and not u.get("marks")]
    if odd:
        print("  exam parts with no marks found (check the text extraction):", ", ".join(odd))
    return units


def load_units(m):
    f = os.path.join(ROOT, "sources", m, "units.json")
    if not os.path.exists(f):
        build_units(m)
    return {u["id"]: u for u in json.load(open(f))["units"]}


def unit_text(m, u, idx):
    if "text" in u:
        return u["text"]
    s = idx["sources"][u["source"]]
    return "\n".join(page_text(s, p) for p in u["pages"])


# ---------------------------------------------------------------- map
def load_map(m):
    f = os.path.join(ROOT, "modules", m, "map.yaml")
    if not os.path.exists(f):
        sys.exit(f"no modules/{m}/map.yaml yet")
    return yaml.safe_load(open(f)) or {}


def check(m):
    idx, units, mp = load_index(m), load_units(m), load_map(m)
    errors, warnings = [], []
    topics = {t["id"]: t for t in mp.get("topics", [])}
    linked, weights = set(), {}
    for lp in mp.get("learning_points", []):
        lid = lp.get("id", "?")
        if not lp.get("can"):
            errors.append(f"{lid}: needs a `can:` statement")
        if lp.get("topic") not in topics:
            errors.append(f"{lid}: topic {lp.get('topic')!r} is not in topics")
        roles = set()
        w = dict(marks=0, parts=[], years={})
        for ln in lp.get("links", []):
            uid, role, quote = ln.get("unit"), ln.get("role"), ln.get("quote", "")
            if uid not in units:
                errors.append(f"{lid}: unknown unit {uid!r}"); continue
            if role not in ROLES:
                errors.append(f"{lid} → {uid}: role must be one of {ROLES}"); continue
            if not quote:
                errors.append(f"{lid} → {uid}: no evidence quote")
            elif len(quote.split()) < 3:
                errors.append(f"{lid} → {uid}: quote is under 3 words, too weak to prove the link: {quote!r}")
            elif len(quote.split()) > 15:
                errors.append(f"{lid} → {uid}: quote is over 15 words (copyright rule)")
            elif norm(quote) not in norm(unit_text(m, units[uid], idx)):
                errors.append(f"{lid} → {uid}: quote not found in that unit: {quote!r}")
            roles.add(role); linked.add(uid)
            u = units[uid]
            if (u["kind"] == "talk") != (role == "explains"):
                errors.append(f"{lid} → {uid}: lecture captions can only be linked as `explains`, and only captions can be")
            if role == "examines" and u["kind"] == "exam-part":
                w["marks"] += u.get("marks") or 0
                w["parts"].append(uid)
                if u.get("year"):
                    w["years"][str(u["year"])] = w["years"].get(str(u["year"]), 0) + (u.get("marks") or 0)
        if "teaches" not in roles:
            errors.append(f"{lid}: no unit teaches it")
        if lp.get("examinable", True) and "examines" not in roles and "exercises" not in roles:
            warnings.append(f"{lid}: nothing examines or exercises it yet")
        weights[lid] = w
    scope = mp.get("scope", {})                      # which units this (possibly partial) map claims to cover
    unmapped = {x["unit"]: x.get("why", "") for x in mp.get("unmapped", [])}
    in_scope = [u for u in units.values() if any(re.fullmatch(p, u["id"]) for p in scope.get("units", []))]
    for u in in_scope:
        if u["id"] not in linked and u["id"] not in unmapped:
            warnings.append(f"orphan unit in scope: {u['id']}  ({u['title'][:50]})")
    report = dict(module=m, learning_points=len(weights), links=sum(len(lp.get("links", [])) for lp in mp.get("learning_points", [])),
                  errors=errors, warnings=warnings, weights=weights)
    out = os.path.join(ROOT, "out", m)
    os.makedirs(out, exist_ok=True)
    json.dump(report, open(os.path.join(out, "map-report.json"), "w"), indent=1, ensure_ascii=False)
    print(f"{report['learning_points']} learning points, {report['links']} links, {len(in_scope)} units in scope")
    for lid, w in sorted(weights.items(), key=lambda kv: -kv[1]["marks"]):
        print(f"  {w['marks']:>3} marks  {len(w['parts'])} parts  {lid}  " + " ".join(f"{y}:{v}" for y, v in sorted(w["years"].items())))
    for e in errors:
        print("ERROR  ", e)
    for x in warnings:
        print("warning", x)
    print("map: " + ("OK" if not errors else f"{len(errors)} error(s)") + (f", {len(warnings)} warning(s)" if warnings else ""))
    return 1 if errors else 0


def dossier(m, topic):
    idx, units, mp = load_index(m), load_units(m), load_map(m)
    t = next((x for x in mp.get("topics", []) if x["id"] == topic), None)
    if not t:
        sys.exit(f"no topic {topic!r}; topics: " + ", ".join(x["id"] for x in mp.get("topics", [])))
    lps = [lp for lp in mp.get("learning_points", []) if lp.get("topic") == topic]
    L = [f"# Dossier: {t.get('title', topic)}  ({m} / {topic})", "",
         "Everything the course map links to this topic. Write the spread from this, not from a slide range.",
         "Formulas: read them from the page images, not from the text below.", ""]
    used = {}
    for lp in lps:
        marks = sum((units[l["unit"]].get("marks") or 0) for l in lp.get("links", []) if l["role"] == "examines" and l["unit"] in units)
        L.append(f"## {lp['id']} — {lp['can']}")
        L.append(f"Exam weight: {marks} marks across {sum(1 for l in lp.get('links', []) if l['role'] == 'examines')} past parts." + ("" if lp.get("examinable", True) else "  **Non-examinable.**"))
        for role in ROLES:
            for l in [x for x in lp.get("links", []) if x["role"] == role]:
                u = units.get(l["unit"])
                if not u:
                    continue
                used.setdefault(u["id"], u)
                L.append(f"- {role}: `{u['cite']}` — {u['title'][:60]}" + (f" [{u['marks']} marks]" if u.get("marks") else "") + f"  (evidence: “{l.get('quote', '')}”)")
        if lp.get("mistakes"):
            L += ["- flagged mistakes: " + "; ".join(lp["mistakes"])]
        L.append("")
    L += ["## Units in full", ""]
    for u in used.values():
        if u["kind"] == "talk":
            L += [f"### `{u['cite']}` — {u['title']}", "Machine captions: they mis-hear words and symbols. Use for emphasis, explanations and common mistakes; "
                  "confirm anything you use against the notes or slides and cite those.", "", "```", u["text"].strip()[:6000], "```", ""]
            continue
        s = idx["sources"][u["source"]]
        imgs = [os.path.join(s["pages_dir"], f"{p:04d}.png") for p in u["pages"]]
        L += [f"### `{u['cite']}` ({u['kind']})" + (f" — {u['marks']} marks" if u.get("marks") else ""), "Page images: " + ", ".join(imgs), "", "```", unit_text(m, u, idx).strip()[:6000], "```", ""]
        if u["kind"] == "exam-part":
            sol = "Sol " + u["source"]
            if sol in idx["sources"]:
                ss = idx["sources"][sol]
                L += [f"Solution notes: `{sol}` — " + ", ".join(os.path.join(ss["pages_dir"], f"{p:04d}.png") for p in range(1, ss["pages"] + 1)), ""]
    ef = os.path.join(ROOT, "modules", m, "errata.yaml")
    errata = yaml.safe_load(open(ef)) or [] if os.path.exists(ef) else []
    srcs = {u["source"] for u in used.values()}
    hits = [e for e in errata if any(str(e.get("where", "")).startswith(s + " ") for s in srcs)]
    if hits:
        L += ["## Known errata in these sources", ""] + [f"- {e['where']}: {e['text']}" for e in hits] + [""]
    out = os.path.join(ROOT, "out", m, "dossiers")
    os.makedirs(out, exist_ok=True)
    f = os.path.join(out, f"{topic}.md")
    open(f, "w").write("\n".join(L))
    print(f"{len(lps)} learning points, {len(used)} units → {os.path.relpath(f, ROOT)}")


def find(m, words):
    idx, units = load_index(m), load_units(m)
    w = norm(words)
    for u in units.values():
        t = norm(unit_text(m, u, idx))
        k = t.find(w)
        if k >= 0:
            print(f"{u['id']:<22} {u['kind']:<14} …{t[max(0, k - 50):k + len(w) + 50]}…")


if __name__ == "__main__":
    a = sys.argv[1:]
    if len(a) < 2 or a[1] not in ("units", "check", "dossier", "find"):
        sys.exit(__doc__)
    if a[1] == "units":
        build_units(a[0])
    elif a[1] == "check":
        sys.exit(check(a[0]))
    elif a[1] == "dossier":
        dossier(a[0], a[2])
    else:
        find(a[0], " ".join(a[2:]))
