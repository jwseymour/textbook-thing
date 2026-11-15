"""Run a module's maths checks (modules/<m>/checks/*.py) and write out/<m>/checks.json.

Each check is a function decorated with @check("id") that returns None/True (pass), False (fail), or a
(ok, detail) tuple, or raises. Content links to a check with `check=<id>` on a block or `:check[<id>]` inline.
Usage: tools/checks <module> [id ...]
"""
import importlib.util, json, os, sys, time, traceback

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools", "lib"))
import checklib  # noqa: E402


def main():
    module = sys.argv[1]
    only = set(sys.argv[2:])
    d = os.path.join(ROOT, "modules", module, "checks")
    for f in sorted(os.listdir(d)):
        if f.endswith(".py") and not f.startswith("_"):
            spec = importlib.util.spec_from_file_location(f"checks_{module}_{f[:-3]}", os.path.join(d, f))
            m = importlib.util.module_from_spec(spec)
            checklib.CURRENT_FILE = f
            spec.loader.exec_module(m)
    results = {}
    for cid, (fn, desc, fname) in checklib.REGISTRY.items():
        if only and cid not in only:
            continue
        t = time.time()
        try:
            r = fn()
            ok, detail = (r if isinstance(r, tuple) else (r is not False, ""))
        except Exception as e:  # noqa: BLE001
            ok, detail = False, f"{type(e).__name__}: {e}\n{traceback.format_exc(limit=2)}"
        results[cid] = {"ok": bool(ok), "detail": str(detail), "desc": desc, "file": fname, "secs": round(time.time() - t, 2)}
        print(("PASS " if ok else "FAIL ") + cid + (f"  {detail}" if detail and not ok else ""))
    out = os.path.join(ROOT, "out", module)
    os.makedirs(out, exist_ok=True)
    path = os.path.join(out, "checks.json")
    prev = json.load(open(path))["results"] if (only and os.path.exists(path)) else {}
    prev.update(results)
    json.dump({"module": module, "ran": time.strftime("%Y-%m-%dT%H:%M:%S"), "results": prev}, open(path, "w"), indent=1)
    n_ok = sum(r["ok"] for r in results.values())
    print(f"\n{n_ok}/{len(results)} checks passed → {os.path.relpath(path, ROOT)}")
    sys.exit(0 if n_ok == len(results) else 1)


if __name__ == "__main__":
    main()
