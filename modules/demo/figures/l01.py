"""Figures for the demo chapter. The numbers drawn are computed here the same way checks/l01.py computes them."""
import math, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "..", "tools", "lib"))
from figlib import plt, save, INK, PURPLE, RED, GREY, GREEN, ORANGE  # noqa: E402
from matplotlib.patches import Rectangle  # noqa: E402


def fig_columns():
    """1011 in its place-value columns."""
    bits = "1011"
    weights = [2 ** (len(bits) - 1 - i) for i in range(len(bits))]
    assert sum(w for w, b in zip(weights, bits) if b == "1") == 11
    fig, ax = plt.subplots(figsize=(2.9, 1.55))
    ax.axis("off"); ax.set_xlim(-0.1, 4.1); ax.set_ylim(-1.05, 2.0)
    for i, (w, b) in enumerate(zip(weights, bits)):
        ax.text(i + 0.5, 1.62, str(w), ha="center", va="center", fontsize=10, color=PURPLE, fontweight="bold")
        ax.add_patch(Rectangle((i + 0.06, 0.3), 0.88, 0.95, fc="#ece8f4" if b == "1" else "none", ec=INK, lw=0.9))
        ax.text(i + 0.5, 0.77, b, ha="center", va="center", fontsize=17, family="monospace", color=INK)
        ax.text(i + 0.5, -0.12, str(w) if b == "1" else "0", ha="center", va="center", fontsize=9.5, color=INK if b == "1" else GREY)
        if i:
            ax.text(i, -0.12, "+", ha="center", va="center", fontsize=9.5, color=GREY)
    ax.text(2, -0.75, "= 11", ha="center", va="center", fontsize=11, color=ORANGE, fontweight="bold")
    save(fig, "l01_columns")


def fig_wheel():
    """The sixteen 4-bit patterns round a circle with their two's complement values: 0111 sits next to 1000."""
    def tc(v):
        return v - 16 if v >= 8 else v
    assert [tc(v) for v in (7, 8, 15)] == [7, -8, -1]
    fig, ax = plt.subplots(figsize=(3.0, 3.0))
    ax.axis("off"); ax.set_aspect("equal"); ax.set_xlim(-1.5, 1.5); ax.set_ylim(-1.5, 1.5)
    for v in range(16):
        a = math.pi / 2 - v * 2 * math.pi / 16
        col = RED if v >= 8 else GREEN
        ax.text(1.2 * math.cos(a), 1.2 * math.sin(a), format(v, "04b"), ha="center", va="center", fontsize=7.6, family="monospace", color=INK)
        ax.text(0.82 * math.cos(a), 0.82 * math.sin(a), str(tc(v)).replace("-", "−"), ha="center", va="center", fontsize=9, color=col, fontweight="bold")
    # the join where +7 meets -8
    a = math.pi / 2 - 7.5 * 2 * math.pi / 16
    ax.plot([0.55 * math.cos(a), 1.42 * math.cos(a)], [0.55 * math.sin(a), 1.42 * math.sin(a)], color=ORANGE, lw=1.4, ls=(0, (3, 2)))
    ax.text(0, 0.1, "add 1:", ha="center", va="center", fontsize=8.5, color=INK)
    ax.text(0, -0.12, "one step clockwise", ha="center", va="center", fontsize=8.5, color=INK)
    save(fig, "l01_wheel")


fig_columns(); fig_wheel()
