"""Shared matplotlib set-up for CGP-theme figures (decision 0003): Gill Sans labels as real SVG text, transparent
background, ids made unique per figure so several SVGs can be inlined in one page. Used by modules/*/figures/*.py:

    import sys, os; sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..", "tools", "lib"))
    from figlib import plt, save, INK, PURPLE, RED, GREY, BLUE, ORANGE, GREEN
"""
import logging, os, re, sys
import matplotlib
matplotlib.use("svg")
import matplotlib.pyplot as plt  # noqa: E402

logging.getLogger("matplotlib.font_manager").setLevel(logging.ERROR)
OUT = sys.argv[1] if len(sys.argv) > 1 else "fig"
os.makedirs(OUT, exist_ok=True)
INK, PURPLE, RED, GREY, BLUE, ORANGE, GREEN = "#222222", "#5b4390", "#b8322a", "#777777", "#2f6fb0", "#c9731a", "#4f7a22"
plt.rcParams.update({
    "svg.fonttype": "none", "font.family": "Gill Sans", "font.size": 8.5,
    "axes.edgecolor": INK, "axes.labelcolor": INK, "xtick.color": INK, "ytick.color": INK,
    "axes.spines.top": False, "axes.spines.right": False, "axes.linewidth": 0.8,
    "xtick.major.width": 0.7, "ytick.major.width": 0.7, "xtick.labelsize": 7.5, "ytick.labelsize": 7.5,
    "figure.facecolor": "none", "axes.facecolor": "none", "savefig.transparent": True,
})


def save(fig, name, pad=0.02):
    plt.rcParams["svg.hashsalt"] = name
    path = f"{OUT}/{name}.svg"
    fig.savefig(path, bbox_inches="tight", pad_inches=pad)
    plt.close(fig)
    s = open(path).read()
    s = re.sub(r"<\?xml.*?\?>\s*", "", s)
    s = re.sub(r"<!DOCTYPE.*?>\s*", "", s, flags=re.S)
    s = re.sub(r"<metadata>.*?</metadata>", "", s, flags=re.S)
    s = re.sub(r'id="([^"]+)"', lambda m: f'id="{name}-{m.group(1)}"', s)
    s = re.sub(r"url\(#([^)]+)\)", lambda m: f"url(#{name}-{m.group(1)})", s)
    s = re.sub(r'xlink:href="#([^"]+)"', lambda m: f'xlink:href="#{name}-{m.group(1)}"', s)
    s = s.replace("<svg ", '<svg role="img" aria-label="%s" ' % name.replace("_", " "), 1)
    open(path, "w").write(s)
