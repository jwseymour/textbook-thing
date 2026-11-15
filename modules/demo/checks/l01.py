"""Checks for the demo chapter (Lecture 1: binary and two's complement). Every sum, conversion and range the pages
state is recomputed here, so a wrong digit on a page fails the build."""
from checklib import check


def tc(bits):
    """Value of a two's complement bit string."""
    n = len(bits)
    return int(bits, 2) - (1 << n if bits[0] == "1" else 0)


def by_division(x):
    """Repeated division by 2: [(quotient, remainder)] and the remainders read last to first."""
    steps = []
    while x:
        steps.append((x // 2, x % 2)); x //= 2
    return steps, "".join(str(r) for _, r in reversed(steps))


def add(a, b):
    """n-bit addition: (result bits, carry out of the top column, signed overflow?)."""
    n = len(a)
    total = int(a, 2) + int(b, 2)
    res = format(total % (1 << n), f"0{n}b")
    return res, total >> n, not -(1 << (n - 1)) <= tc(a) + tc(b) < (1 << (n - 1))


@check("l01-place-value", "1011 = 8+0+2+1 = 11; n bits show 2^n values, 0 to 2^n - 1 (4 bits: 0-15, 8 bits: 0-255)")
def _():
    return (int("1011", 2) == 8 + 0 + 2 + 1 == 11 and 2 ** 4 - 1 == 15 and 2 ** 8 - 1 == 255
            and all(len({format(v, f"0{n}b") for v in range(2 ** n)}) == 2 ** n for n in range(1, 9))
            and int("11111", 2) == 31 and 2 ** 5 == 32 and 2 ** 16 == 65536 and 2 ** 8 == 256)


@check("l01-convert", "13 -> 1101 and 22 -> 10110 by repeated division; 37 -> 100101; each checked back by place value")
def _():
    s13, b13 = by_division(13)
    s22, b22 = by_division(22)
    return (s13 == [(6, 1), (3, 0), (1, 1), (0, 1)] and b13 == "1101" and 8 + 4 + 0 + 1 == 13
            and s22 == [(11, 0), (5, 1), (2, 1), (1, 0), (0, 1)] and b22 == "10110" and 16 + 4 + 2 == 22
            and by_division(37)[1] == "100101" and 32 + 4 + 1 == 37 and by_division(6)[1] == "110")


@check("l01-add", "0110+0111 = 1101 (6+7 = 13) with carries into the 4s and 8s columns; 0011+0110 = 1001 (9); 1+1 = 10, 1+1+1 = 11")
def _():
    return (add("0110", "0111")[:2] == ("1101", 0) and 6 + 7 == 13 and add("0011", "0110")[:2] == ("1001", 0)
            and format(1 + 1, "b") == "10" and format(1 + 1 + 1, "b") == "11" and add("0101", "0011")[0] == "1000")


@check("l01-twos", "4-bit weights -8,4,2,1: range -8 to 7; 5 = 0101 -> 1010 -> 1011 = -5; -3 = 1101; 6-bit range -32 to 31")
def _():
    inv = lambda b: "".join("10"[int(c)] for c in b)
    neg = lambda b: format((int(inv(b), 2) + 1) % (1 << len(b)), f"0{len(b)}b")
    vals = sorted(tc(format(v, "04b")) for v in range(16))
    return (vals == list(range(-8, 8)) and inv("0101") == "1010" and neg("0101") == "1011" and tc("1011") == -8 + 2 + 1 == -5
            and neg("0011") == "1101" and tc("1101") == -3 and neg("1011") == "0101" and tc("1000") == -8 and neg("1000") == "1000"
            and tc("0111") == 7 and tc("1111") == -1 and tc("1001") == -7 and tc("1110") == -2 and neg("0110") == "1010"
            and (-(2 ** 5), 2 ** 5 - 1) == (-32, 31) and all(tc(neg(format(v, "04b"))) == -tc(format(v, "04b")) for v in range(16) if v != 8))


@check("l01-overflow", "0101+0100 = 1001 = -7 (overflow, no carry out); 1111+0001 = 0000 (carry out, no overflow); the sheet's Q3 and Q4")
def _():
    return (add("0101", "0100") == ("1001", 0, True) and tc("1001") == -7
            and add("1111", "0001") == ("0000", 1, False)
            and add("0101", "1101") == ("0010", 1, False)                       # 5 + (-3) = 2
            and add("0111", "0001") == ("1000", 0, True)                        # 7 + 1
            and add("1000", "1111") == ("0111", 1, True)                        # -8 + (-1)
            and add("1100", "0011") == ("1111", 0, False)                       # -4 + 3 = -1
            and add("0110", "0011") == ("1001", 0, True)                        # 6 + 3
            # the rule on the page: overflow exactly when the operands share a sign and the result has the other one
            and all(add(format(a, "04b"), format(b, "04b"))[2]
                    == (format(a, "04b")[0] == format(b, "04b")[0] != add(format(a, "04b"), format(b, "04b"))[0][0])
                    for a in range(16) for b in range(16)))
