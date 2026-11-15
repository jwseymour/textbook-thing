"""Tiny registry for maths checks. Usage in modules/<m>/checks/*.py:

    from checklib import check

    @check("binom-mle", "Binomial mle p = x/n (Ex 1.3.1)")
    def _():
        ...
        return ok, "detail"
"""
REGISTRY = {}
CURRENT_FILE = None


def check(cid, desc=""):
    def deco(fn):
        if cid in REGISTRY:
            raise ValueError(f"duplicate check id {cid}")
        REGISTRY[cid] = (fn, desc, CURRENT_FILE)
        return fn
    return deco


def close(a, b, tol=1e-9):
    return abs(a - b) <= tol
