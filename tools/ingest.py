"""Ingest a module's sources: fetch public files, import Raven/local files, split into per-page text + images, build an index.

Usage: tools/ingest <module> [--refresh] [--from DIR_OR_TAR] [--dpi 150]

Writes (all gitignored, under sources/<module>/):
  files/<file>            the source PDFs (old versions of re-fetched files kept in files/old/)
  pages/<slug>/NNNN.txt   text of PDF page NNNN (1-based)   — fine for prose, NOT for maths
  pages/<slug>/NNNN.png   page image at --dpi                — read formulas from these
  index.json              what citations resolve against (read by tools/build.mjs and tools/verify)
"""
import argparse, datetime, glob, hashlib, json, os, re, shutil, sys, tarfile, urllib.request, urllib.error, ssl
from html.parser import HTMLParser

import pymupdf
import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = "revision-guides-ingest/1.0"


def load_sources(module):
    with open(os.path.join(ROOT, "modules", module, "sources.yaml")) as f:
        cfg = yaml.safe_load(f)
    base = cfg.get("base_url", "")
    out = []
    for s in cfg.get("sources", []):
        s = dict(s)
        if s.get("url") and not s["url"].startswith("http"):
            s["url"] = base + s["url"]
        out.append(s)
    t = cfg.get("tripos")
    if t:
        # Which questions: the hand list `questions: {year: [q]}` (paper = `paper`), plus, when `topic:` names the
        # department's past-paper topic page (t-<topic>.html in the harvest mirror), every question listed there
        # (from `since:` on, if given). Solution notes and examiners' comments are taken wherever the mirror has them.
        qs = {(int(y), int(t["paper"]), int(q)) for y, lst in (t.get("questions") or {}).items() for q in lst}
        exams = os.path.join(ROOT, "sources", "raw", "www.cl.cam.ac.uk", "teaching", "exams")
        tp = os.path.join(exams, "pastpapers", f"t-{t['topic']}.html") if t.get("topic") else None
        if tp and os.path.exists(tp):
            for y, p, q in re.findall(r"y(\d{4})p(\d+)q(\d+)\.pdf", open(tp, encoding="utf-8", errors="replace").read()):
                if int(y) >= int(t.get("since", 0)):
                    qs.add((int(y), int(p), int(q)))
        elif tp:
            print(f"note: no topic page {os.path.relpath(tp, ROOT)} in the harvest mirror; using the listed questions only")
        sys.path.insert(0, os.path.join(ROOT, "tools", "lib"))
        import examiners
        clash = {(y, q) for y, p, q in qs if sum(1 for y2, p2, q2 in qs if (y2, q2) == (y, q)) > 1}
        last = {}
        for year, p, q in sorted(qs):
            fmt = dict(year=year, paper=p, q=q)
            tag = f"T{year} " + (f"P{p} " if (year, q) in clash else "") + f"Q{q}"
            out.append(dict(id=tag, kind="tripos", year=year, paper=p, q=q,
                            url=t["url"].format(**fmt), file=t["file"].format(**fmt), access="public"))
            sol_url = t["solution_url"].format(**fmt)
            if year in (t.get("solutions") or []) or os.path.exists(mirror_path(sol_url) or ""):
                out.append(dict(id=f"Sol {tag}", kind="solution", year=year, paper=p, q=q,
                                url=sol_url, file=t["solution_file"].format(**fmt), access="raven"))
            text = examiners.comment(year, p, q, t.get("title") or cfg.get("title") or module_title(module))
            if text and text in last.values():
                print(f"note: the examiners' comments filed under {year} for Q{q} repeat an earlier year's text: left out")
            elif text:
                out.append(dict(id=f"Rep {tag}", kind="report", year=year, paper=p, q=q, access="generated", text=text,
                                title=f"Examiners' comments on {year} Paper {p} Question {q}", file=f"rep_y{year}p{p}q{q}.txt",
                                url=f"https://www.cl.cam.ac.uk/teaching/exams/reports/comments{year}.pdf"))
            last[(year, p, q)] = text
    ids = [s["id"] for s in out]
    dup = {i for i in ids if ids.count(i) > 1}
    if dup:
        sys.exit(f"duplicate source ids: {dup}")
    return out


def module_title(module):
    return (yaml.safe_load(open(os.path.join(ROOT, "modules", module, "module.yaml"))) or {}).get("title", "")


def slug(sid):
    return re.sub(r"[^a-z0-9]+", "_", sid.lower()).strip("_")


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def ssl_context():
    try:
        import certifi  # noqa
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        pass
    ctx = ssl.create_default_context()
    if not ctx.get_ca_certs():  # python.org macOS builds ship without CA certs: fall back to the system bundle
        for ca in ("/etc/ssl/cert.pem", "/usr/local/etc/openssl/cert.pem"):
            if os.path.exists(ca):
                ctx.load_verify_locations(ca)
                break
    return ctx


def download(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, context=ssl_context(), timeout=60) as r:
        data = r.read()
        final = r.geturl()
    if "raven" in final or "login" in final.lower():
        raise urllib.error.HTTPError(url, 401, "redirected to login", None, None)
    tmp = dest + ".part"
    with open(tmp, "wb") as f:
        f.write(data)
    return tmp


def mirror_path(url):
    """Where the browser harvest would have saved this URL (sources/raw/<host>/<path>), or None."""
    if not url:
        return None
    u = urllib.parse.urlsplit(url)
    if u.hostname != "www.cl.cam.ac.uk":
        return None
    path = urllib.parse.unquote(u.path)
    if path.endswith("/"):
        path += "index.html"
    return os.path.join(ROOT, "sources", "raw", u.hostname, *[p for p in path.split("/") if p not in ("", ".", "..")])


def import_from(src_spec, wanted):
    """Copy files whose basename is in `wanted` from a directory or tar into files/. Returns names imported."""
    got = []
    spec = os.path.expanduser(src_spec)
    if os.path.isdir(spec):
        for dirpath, _, names in os.walk(spec):
            for n in names:
                if n in wanted and n not in got:
                    shutil.copy2(os.path.join(dirpath, n), wanted[n]); got.append(n)
    elif tarfile.is_tarfile(spec):
        with tarfile.open(spec) as tf:
            for m in tf.getmembers():
                n = os.path.basename(m.name)
                if m.isfile() and n in wanted and n not in got:
                    with tf.extractfile(m) as fsrc, open(wanted[n], "wb") as fdst:
                        shutil.copyfileobj(fsrc, fdst)
                    got.append(n)
    else:
        sys.exit(f"--from: not a directory or tar: {spec}")
    return got


class _Text(HTMLParser):
    def __init__(self):
        super().__init__(); self.parts = []; self.skip = 0
    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"): self.skip += 1
        if tag in ("p", "li", "br", "h1", "h2", "h3", "h4", "tr", "div"): self.parts.append("\n")
    def handle_endtag(self, tag):
        if tag in ("script", "style"): self.skip -= 1
    def handle_data(self, d):
        if not self.skip: self.parts.append(d)


def split_pdf(path, outdir, dpi):
    os.makedirs(outdir, exist_ok=True)
    doc = pymupdf.open(path)
    for i, page in enumerate(doc, start=1):
        with open(os.path.join(outdir, f"{i:04d}.txt"), "w") as f:
            f.write(page.get_text())
        page.get_pixmap(dpi=dpi).save(os.path.join(outdir, f"{i:04d}.png"))
    n = doc.page_count
    toc = doc.get_toc()
    texts = [doc[i].get_text() for i in range(n)]
    doc.close()
    return n, toc, texts


def question_pages(texts):
    """Map question number → PDF pages where a 'Question N' heading appears (first = the question, later = hints)."""
    qs = {}
    for i, t in enumerate(texts, start=1):
        for m in re.finditer(r"^Question\s+(\d+)\b", t, flags=re.M):
            qs.setdefault(m.group(1), [])
            if i not in qs[m.group(1)]:
                qs[m.group(1)].append(i)
    return qs


def check_offset(texts, offset):
    """Return pages where the printed page number on the page disagrees with PDF page - offset."""
    bad = []
    for i, t in enumerate(texts, start=1):
        lines = [l.strip() for l in t.splitlines() if l.strip()]
        if not lines:
            continue
        nums = [l for l in (lines[0], lines[1] if len(lines) > 1 else "", lines[-1]) if l.isdigit()]
        if nums and str(i - offset) not in nums:
            bad.append((i, nums))
    return bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("module")
    ap.add_argument("--refresh", action="store_true", help="re-download public files (keeps old versions in files/old/)")
    ap.add_argument("--from", dest="src", help="directory or tar to import missing files from (e.g. a Raven download bundle)")
    ap.add_argument("--dpi", type=int, default=150)
    a = ap.parse_args()

    base = os.path.join(ROOT, "sources", a.module)
    files = os.path.join(base, "files")
    os.makedirs(os.path.join(files, "old"), exist_ok=True)
    idx_path = os.path.join(base, "index.json")
    old_index = json.load(open(idx_path)) if os.path.exists(idx_path) else {"sources": {}}
    sources = load_sources(a.module)
    log, missing = [], []

    if a.src:
        wanted = {s["file"]: os.path.join(files, s["file"]) for s in sources if not os.path.exists(os.path.join(files, s["file"]))}
        got = import_from(a.src, wanted)
        log.append(f"imported {len(got)} file(s) from {a.src}")

    # The browser harvest (tools/harvest, decision 0003) mirrors the course site, Raven files included, under
    # sources/raw/<host>/<path>. Anything found there is used first, so Raven sources need no manual download.
    for s in sources:
        if s["access"] == "generated":               # text worked out at ingest (examiners' comments)
            dest = os.path.join(files, s["file"])
            if not os.path.exists(dest) or open(dest, encoding="utf-8").read() != s["text"]:
                open(dest, "w", encoding="utf-8").write(s["text"])
    for s in sources:
        m = mirror_path(s.get("url")) if s["access"] != "generated" else None
        dest = os.path.join(files, s["file"])
        if not m or not os.path.exists(m) or (os.path.exists(dest) and sha(m) == sha(dest)):
            continue
        if os.path.exists(dest):
            stamp = datetime.date.today().strftime("%Y%m%d")
            keep = os.path.join(files, "old", f"{os.path.splitext(s['file'])[0]}@{stamp}-{sha(dest)[:8]}{os.path.splitext(s['file'])[1]}")
            shutil.move(dest, keep)
            log.append(f"UPDATED {s['id']} from the harvest mirror: previous version kept as {os.path.relpath(keep, ROOT)}")
        else:
            log.append(f"copied {s['id']} from the harvest mirror")
        shutil.copy2(m, dest)

    for s in sources:
        dest = os.path.join(files, s["file"])
        if s["access"] == "public" and (a.refresh or not os.path.exists(dest)):
            try:
                tmp = download(s["url"], dest)
            except Exception as e:  # noqa: BLE001
                log.append(f"FETCH FAILED {s['id']}: {s['url']} ({e})")
                continue
            if os.path.exists(dest):
                if sha(tmp) == sha(dest):
                    os.remove(tmp)
                    continue
                stamp = datetime.date.today().strftime("%Y%m%d")
                keep = os.path.join(files, "old", f"{os.path.splitext(s['file'])[0]}@{stamp}-{sha(dest)[:8]}{os.path.splitext(s['file'])[1]}")
                shutil.move(dest, keep)
                log.append(f"UPDATED {s['id']}: previous version kept as {os.path.relpath(keep, ROOT)}")
            else:
                log.append(f"fetched {s['id']}")
            os.replace(tmp, dest)
        elif s["access"] == "local":
            hits = sorted(glob.glob(os.path.expanduser(s["local"])))
            if hits and (not os.path.exists(dest) or sha(hits[0]) != sha(dest)):
                shutil.copy2(hits[0], dest)
                log.append(f"copied {s['id']} from {hits[0]}")
        if not os.path.exists(dest):
            missing.append(s)

    index = {"module": a.module, "generated": datetime.datetime.now().isoformat(timespec="seconds"), "sources": {}}
    for s in sources:
        dest = os.path.join(files, s["file"])
        if not os.path.exists(dest):
            continue
        h = sha(dest)
        prev = old_index["sources"].get(s["id"])
        outdir = os.path.join(base, "pages", slug(s["id"]))
        entry = {k: v for k, v in s.items() if k not in ("local", "text")}
        entry.update(sha256=h, path=os.path.relpath(dest, ROOT), pages_dir=os.path.relpath(outdir, ROOT))
        if prev and prev.get("sha256") == h and prev.get("dpi") == a.dpi and os.path.isdir(outdir):
            entry.update({k: prev[k] for k in ("pages", "toc", "questions", "dpi", "members") if k in prev})
            index["sources"][s["id"]] = entry
            continue
        if dest.endswith(".csv"):
            os.makedirs(outdir, exist_ok=True)
            with open(dest, encoding="utf-8", errors="replace") as fsrc:
                head = [next(fsrc, "") for _ in range(40)]
            open(os.path.join(outdir, "0001.txt"), "w").write("".join(head))
            entry.update(pages=1, dpi=a.dpi)
        elif dest.endswith((".tar.gz", ".tgz", ".tar")):
            # A code archive (e.g. lab starter files): one text "page" per text file in it, headed by the file's name.
            shutil.rmtree(outdir, ignore_errors=True)
            os.makedirs(outdir, exist_ok=True)
            n, names = 0, []
            with tarfile.open(dest) as tf:
                for mem in sorted((x for x in tf.getmembers() if x.isfile() and x.size < 200_000), key=lambda x: x.name):
                    raw = tf.extractfile(mem).read()
                    if b"\0" in raw[:4000] or mem.name.lower().endswith((".pdf", ".png", ".jpg", ".o", ".a")):
                        continue
                    n += 1
                    names.append(mem.name)
                    open(os.path.join(outdir, f"{n:04d}.txt"), "w", encoding="utf-8").write(f"FILE: {mem.name}\n\n" + raw.decode("utf-8", errors="replace"))
            entry.update(pages=n, dpi=a.dpi, members=names)
            log.append(f"unpacked {s['id']}: {n} text file(s)")
        elif dest.endswith(".txt"):
            os.makedirs(outdir, exist_ok=True)
            shutil.copy2(dest, os.path.join(outdir, "0001.txt"))
            entry.update(pages=1, dpi=a.dpi)
        elif dest.endswith(".html"):
            p = _Text(); p.feed(open(dest, encoding="utf-8", errors="replace").read())
            os.makedirs(outdir, exist_ok=True)
            text = re.sub(r"\n\s*\n+", "\n\n", "".join(p.parts))
            open(os.path.join(outdir, "0001.txt"), "w").write(text)
            entry.update(pages=1, dpi=a.dpi)
        else:
            shutil.rmtree(outdir, ignore_errors=True)
            n, toc, texts = split_pdf(dest, outdir, a.dpi)
            entry.update(pages=n, dpi=a.dpi)
            if s["kind"] in ("sheet",):
                entry["questions"] = question_pages(texts)
            if s["kind"] == "notes":
                off = s.get("printed_offset", 0)
                entry["toc"] = [{"level": l, "title": t, "pdf_page": p, "printed_page": p - off} for l, t, p in toc]
                bad = check_offset(texts, off)
                if len(bad) > n // 10:
                    log.append(f"WARNING {s['id']}: printed_offset={off} disagrees with {len(bad)} page numbers, e.g. {bad[:3]}")
            log.append(f"split {s['id']}: {n} pages")
        index["sources"][s["id"]] = entry

    with open(idx_path, "w") as f:
        json.dump(index, f, indent=1, ensure_ascii=False)

    for line in log:
        print(line)
    print(f"\nindexed {len(index['sources'])}/{len(sources)} sources → {os.path.relpath(idx_path, ROOT)}")
    if missing:
        print("\nMISSING — please download these (Raven login needed for 'raven') and save them into "
              f"{os.path.relpath(files, ROOT)}/ with the name shown, then re-run:")
        for s in missing:
            print(f"  [{s['access']}] {s['id']:<14} {s.get('url') or s.get('local')}  →  {s['file']}")
        print("  (or put them in one folder / tar and run: tools/ingest %s --from <that folder or tar>)" % a.module)


if __name__ == "__main__":
    main()
