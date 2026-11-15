"""Make the dummy course materials for the demo module. Everything here is invented for this repository: a
two-lecture course, "Number Systems", at a university that does not exist. Nothing comes from a real course.

    .venv/bin/python modules/demo/dummy/make_sources.py      (tools/demo runs it for you)

Writes, under sources/raw/demo/ (gitignored, like every other source):
  demo-slides.pdf           10 slides: Lecture 1 is slides 1-7, Lecture 2 is slides 8-10
  demo-exercises.pdf        a one-page exercise sheet
  captions/L01_binary.vtt   "machine captions" of Lecture 1. The lecturer spends about two minutes on each of
                            slides 2-6 and never shows slide 7, so coverage should report slide 7 as skipped.
"""
import os

import pymupdf

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
OUT = os.path.join(ROOT, "sources", "raw", "demo")

# (title, bullets, what the lecturer says while the slide is up)
SLIDES = [
    ("Number Systems", ["Lecture 1: Binary and two's complement", "Example University (a made-up course for the demo module)"],
     []),
    ("Place value in base 2",
     ["In base 10 each column is worth ten times the column to its right.",
      "In base 2 each column is worth twice the column to its right: 8, 4, 2, 1.",
      "Example: 1011 in binary is 8 + 0 + 2 + 1 = 11 in decimal.",
      "An n-bit pattern can show 2^n different values: 0 up to 2^n - 1.",
      "So 4 bits count from 0 to 15, and 8 bits count from 0 to 255."],
     ["so place value is the whole idea in base ten each column is worth ten times the column to its right",
      "in base two each column is worth twice the column to its right so the columns are eight four two one",
      "take one zero one one in binary that is eight plus zero plus two plus one which is eleven in decimal",
      "an n bit pattern can show two to the n different values from zero up to two to the n minus one",
      "so four bits count from zero to fifteen and eight bits count from zero to two hundred and fifty five"]),
    ("Converting decimal to binary",
     ["Divide by 2 again and again, writing down each remainder.",
      "Stop when the quotient reaches 0.",
      "Read the remainders from the last one back to the first.",
      "Example: 13 -> 6 r 1, 6 -> 3 r 0, 3 -> 1 r 1, 1 -> 0 r 1, so 13 is 1101.",
      "Check by place value: 8 + 4 + 0 + 1 = 13."],
     ["converting decimal to binary you divide by two again and again writing down each remainder",
      "you stop when the quotient reaches zero and read the remainders from the last one back to the first",
      "example thirteen gives six remainder one six gives three remainder zero three gives one remainder one",
      "and one gives zero remainder one so thirteen is one one zero one",
      "always check by place value eight plus four plus zero plus one is thirteen"]),
    ("Adding in binary",
     ["Add column by column from the right, exactly as in decimal.",
      "0 + 0 = 0, 0 + 1 = 1, 1 + 1 = 10: write 0 and carry 1.",
      "1 + 1 + 1 = 11: write 1 and carry 1.",
      "Example: 0110 + 0111 = 1101, which is 6 + 7 = 13.",
      "A carry out of the top column does not fit in the word."],
     ["adding in binary you add column by column from the right exactly as in decimal",
      "zero plus zero is zero zero plus one is one one plus one is one zero so write zero and carry one",
      "one plus one plus one is one one so you write one and carry one",
      "example zero one one zero plus zero one one one is one one zero one which is six plus seven thirteen",
      "a carry out of the top column does not fit in the word remember that for later"]),
    ("Two's complement",
     ["Signed numbers: give the top bit a negative weight, -2^(n-1).",
      "With 4 bits the weights are -8, 4, 2, 1, so the range is -8 to 7.",
      "A pattern whose top bit is 1 is negative.",
      "To negate: invert every bit, then add 1.",
      "Example: 5 is 0101; invert to 1010; add 1 to get 1011, which is -8 + 2 + 1 = -5."],
     ["two's complement is how we store signed numbers we give the top bit a negative weight minus two to the n minus one",
      "with four bits the weights are minus eight four two one so the range is minus eight to seven",
      "a pattern whose top bit is one is negative",
      "to negate a number you invert every bit and then add one",
      "example five is zero one zero one invert to one zero one zero add one to get one zero one one",
      "which is minus eight plus two plus one equals minus five this is the important slide today"]),
    ("Overflow",
     ["Overflow: the true answer is outside the range the word can hold.",
      "Adding two numbers of the same sign and getting the other sign means overflow.",
      "Example: 0101 + 0100 = 1001, so 5 + 4 appears to be -7. Overflow.",
      "A carry out of the top bit is not the same thing as overflow.",
      "Example: 1111 + 0001 = 0000 with a carry out, and -1 + 1 = 0 is correct."],
     ["overflow means the true answer is outside the range the word can hold",
      "adding two numbers of the same sign and getting the other sign means overflow",
      "example zero one zero one plus zero one zero zero is one zero zero one so five plus four appears to be minus seven that is overflow",
      "a carry out of the top bit is not the same thing as overflow people mix these up in the exam",
      "example one one one one plus zero zero zero one is zero zero zero zero with a carry out and minus one plus one is zero which is correct"]),
    ("Aside: octal and hexadecimal",
     ["Group bits in threes to write octal, in fours to write hexadecimal.",
      "Hexadecimal digits: 0-9 then A-F for 10-15.",
      "Example: 1101 0110 is D6 in hexadecimal."],
     []),
    ("Number Systems", ["Lecture 2: Fixed and floating point"], []),
    ("Fixed point",
     ["Put a binary point at a fixed place in the word.",
      "Columns to the right of the point are worth 1/2, 1/4, 1/8.",
      "Example: 0110.1100 is 6.75."],
     []),
    ("Floating point",
     ["Store a sign, an exponent and a mantissa.",
      "The value is the mantissa times 2 to the power of the exponent.",
      "The point floats: big and small numbers get the same number of significant bits."],
     []),
]

SHEET = [
    "Number Systems: Exercise Sheet 1",
    "1. Convert 22 to binary, and convert 10110 back to decimal as a check.",
    "2. Work out 0011 + 0110 in 4-bit binary. What is the answer in decimal?",
    "3. Write -3 in 4-bit two's complement. Then add it to 0101 and say what the answer means.",
    "4. Which of these 4-bit two's complement additions overflow: 0111 + 0001, 1000 + 1111, 1100 + 0011?",
    "5. A 6-bit two's complement word: what are its smallest and largest values?",
]


def save(doc, path):
    """Byte-for-byte the same file on every run (fixed dates, no random document id), so the verifier's record of
    which version of the sources a page was checked against stays valid on another machine."""
    doc.set_metadata({"producer": "demo", "creator": "make_sources.py", "creationDate": "D:20261001000000Z", "modDate": "D:20261001000000Z"})
    doc.save(path, no_new_id=True, deflate=True)


def slides_pdf(path):
    doc = pymupdf.open()
    for n, (title, bullets, _) in enumerate(SLIDES, 1):
        pg = doc.new_page(width=720, height=405)
        pg.insert_text((40, 70), title, fontsize=30, fontname="hebo")
        y = 130
        for b in bullets:
            pg.insert_textbox(pymupdf.Rect(60, y - 18, 690, y + 40), "- " + b, fontsize=17, fontname="helv")
            y += 50
        pg.insert_text((40, 390), f"Number Systems (demo course)    slide {n}", fontsize=9, fontname="helv", color=(.4, .4, .4))
    save(doc, path)


def sheet_pdf(path):
    doc = pymupdf.open()
    pg = doc.new_page()  # A4
    pg.insert_text((60, 80), SHEET[0], fontsize=18, fontname="hebo")
    y = 130
    for line in SHEET[1:]:
        pg.insert_textbox(pymupdf.Rect(60, y - 14, 535, y + 40), line, fontsize=12, fontname="helv")
        y += 52
    save(doc, path)


def stamp(t):
    return f"{t // 3600:02d}:{t % 3600 // 60:02d}:{t % 60:02d}.000"


def captions(path):
    """One cue every 8 seconds. Each spoken line is said three times over in different order, so a slide stays up
    for about two minutes, as in a real lecture."""
    out, t = ["WEBVTT", ""], 0
    for cue in ["good morning everyone welcome to number systems", "today is binary and two's complement"]:
        out += [f"{stamp(t)} --> {stamp(t + 8)}", cue, ""]; t += 8
    for _, _, said in SLIDES:
        for rep in range(3):
            for line in (said if rep != 1 else said[::-1]):
                out += [f"{stamp(t)} --> {stamp(t + 8)}", line, ""]; t += 8
    out += [f"{stamp(t)} --> {stamp(t + 8)}", "we are out of time so we skip the octal and hexadecimal slide see you next week", ""]
    open(path, "w").write("\n".join(out))


if __name__ == "__main__":
    os.makedirs(os.path.join(OUT, "captions"), exist_ok=True)
    slides_pdf(os.path.join(OUT, "demo-slides.pdf"))
    sheet_pdf(os.path.join(OUT, "demo-exercises.pdf"))
    captions(os.path.join(OUT, "captions", "L01_binary.vtt"))
    print(f"dummy sources written to {os.path.relpath(OUT, ROOT)}/")
