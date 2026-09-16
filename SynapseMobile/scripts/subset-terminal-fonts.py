#!/usr/bin/env python3
"""Regenerate the bundled terminal fonts.

The app ships subsets of Maple Mono NF CN rather than the originals. The full
family is ~20 MB per weight, which is far more than a terminal needs; the
subsets keep the glyphs the terminal actually draws and drop the rest.

Two glyph groups matter and both are kept deliberately:

  * The private-use area, which is where Nerd Font puts the branch / folder /
    language markers a shell prompt draws. iOS has no font covering it, so
    without these the markers come out as replacement boxes.
  * Common Han characters. Their absence is invisible in ordinary prose —
    Chinese would still render, via the platform font — but the platform font's
    ideographs advance by 1.0 em where the grid allots 1.2 em (two 0.6 em
    cells). Every Han character therefore drifts a fifth of a cell out of
    alignment, which piles up across a line and breaks the box-drawing frames
    TUIs rely on. Carrying the real glyphs keeps the advance at exactly 1.2 em.

Latin, box drawing, punctuation, kana and fullwidth forms are kept whole; they
are small and a terminal meets them constantly.

Usage:
    python3 SynapseMobile/scripts/subset-terminal-fonts.py [SOURCE_DIR]

SOURCE_DIR defaults to ~/Library/Fonts and must contain the upstream
MapleMono-NF-CN-{Regular,Bold}.ttf. Requires fontTools (`pip install fonttools`).
"""

import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

# Blocks kept in full, as (first, last) inclusive. Han is handled separately.
FULL_BLOCKS = [
    (0x0020, 0x00FF),  # Basic Latin + Latin-1 Supplement
    (0x0100, 0x024F),  # Latin Extended-A/B
    (0x2000, 0x206F),  # General Punctuation
    (0x2190, 0x21FF),  # Arrows
    (0x2200, 0x22FF),  # Mathematical Operators
    (0x2460, 0x24FF),  # Enclosed Alphanumerics
    (0x2500, 0x259F),  # Box Drawing + Block Elements
    (0x25A0, 0x25FF),  # Geometric Shapes
    (0x2600, 0x27BF),  # Miscellaneous Symbols + Dingbats
    (0x3000, 0x303F),  # CJK Symbols and Punctuation
    (0x3040, 0x30FF),  # Hiragana + Katakana
    (0xFF00, 0xFFEF),  # Halfwidth and Fullwidth Forms
    (0xE000, 0xF8FF),  # Private Use Area (Nerd Font markers)
    (0xF0000, 0xFFFFD),  # Supplementary Private Use Area-A (Nerd Font, plane 15)
]

WEIGHTS = ["Regular", "Bold"]

# Metrics the terminal grid depends on. A subset that changes any of these would
# silently misalign every row, so the script refuses to write such a file.
EXPECTED = {"0": 600, "中": 1200, "，": 1200, "├": 600}


def gb2312_han(cmapping):
    """Han characters reachable through GB2312 — the common set, 6763 of them."""
    out = []
    for code in range(0x4E00, 0x9FFF + 1):
        try:
            encoded = chr(code).encode("gb2312")
        except UnicodeEncodeError:
            continue
        if encoded.decode("gb2312") == chr(code):
            out.append(code)
    return out


def build_keep_set(cmapping):
    keep = set()
    for first, last in FULL_BLOCKS:
        keep.update(c for c in range(first, last + 1) if c in cmapping)
    keep.update(gb2312_han(cmapping))
    return keep


def advance(font, char):
    glyph = font.getBestCmap().get(ord(char))
    return font["hmtx"][glyph][0] if glyph else None


def main():
    source_dir = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else "~/Library/Fonts")
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "SynapseMobile", "Fonts")
    out_dir = os.path.normpath(out_dir)

    for weight in WEIGHTS:
        name = f"MapleMono-NF-CN-{weight}"
        source = os.path.join(source_dir, f"{name}.ttf")
        if not os.path.exists(source):
            sys.exit(f"missing source font: {source}")

        reference = TTFont(source, lazy=True)
        keep = build_keep_set(reference.getBestCmap())

        tmp = os.path.join(out_dir, f".{name}.tmp.ttf")
        subset.main([
            source,
            f"--output-file={tmp}",
            "--text=" + "".join(chr(c) for c in sorted(keep)),
            "--layout-features=*",
            "--no-hinting",
            "--desubroutinize",
            "--drop-tables+=DSIG",
        ])

        result = TTFont(tmp)
        actual = {ch: advance(result, ch) for ch in EXPECTED}
        if actual != EXPECTED:
            os.remove(tmp)
            sys.exit(f"{weight}: subset changed the grid metrics — {actual} != {EXPECTED}")

        os.replace(tmp, os.path.join(out_dir, f"{name}.ttf"))
        size = os.path.getsize(os.path.join(out_dir, f"{name}.ttf")) / 1024 / 1024
        print(f"{name}.ttf  {len(keep)} chars  {size:.2f} MB  metrics ok")


if __name__ == "__main__":
    main()
