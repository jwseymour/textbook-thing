"""Compile-and-run helper for checks about C/C++ code. Usage in modules/<m>/checks/*.py:

    from checklib import check
    from ccheck import run_c

    @check("dag-double-free", "tree_free on a DAG frees the shared node twice (N s119-132)")
    def _():
        r = run_c(SRC)                      # compiled with -Wall -g -fsanitize=address,undefined
        return "double-free" in r.err, r.err[:200]

run_c(src, lang="c"|"c++", sanitize=True, flags=(), args=(), stdin=None, env=None, timeout=30) -> Result(code, out, err)
Sanitizers: AddressSanitizer + UndefinedBehaviorSanitizer (leak detection is unsupported on macOS, so count
malloc/free calls in the test program instead). Set sanitize=False to see what the plain program does.
"""
import os
import subprocess
import tempfile
from dataclasses import dataclass


@dataclass
class Result:
    code: int
    out: str
    err: str
    compile_err: str = ""

    @property
    def ok(self):
        return self.code == 0


def run_c(src, lang="c", sanitize=True, flags=(), args=(), stdin=None, env=None, timeout=30):
    with tempfile.TemporaryDirectory(prefix="ccheck-") as d:
        ext, cc, std = (".cpp", "c++", "-std=c++17") if lang == "c++" else (".c", "cc", "-std=c17")
        path, exe = os.path.join(d, "prog" + ext), os.path.join(d, "prog")
        with open(path, "w") as f:
            f.write(src)
        cmd = [cc, std, "-Wall", "-g", "-O0", *(["-fsanitize=address,undefined", "-fno-omit-frame-pointer"] if sanitize else []), *flags, path, "-o", exe]
        c = subprocess.run(cmd, capture_output=True, text=True)
        if c.returncode != 0:
            raise RuntimeError("compile failed:\n" + c.stderr[-2000:])
        e = {**os.environ, "ASAN_OPTIONS": "detect_leaks=0:abort_on_error=0", "UBSAN_OPTIONS": "print_stacktrace=1", **(env or {})}
        r = subprocess.run([exe, *args], input=stdin, capture_output=True, text=True, timeout=timeout, env=e)
        return Result(r.returncode, r.stdout, r.stderr, c.stderr)
