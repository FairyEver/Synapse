#!/usr/bin/env python3
"""Embed the tested sources/receipt and prepare a publishable Markdown file."""
from pathlib import Path

HERE = Path(__file__).resolve().parent
DOC = HERE.parents[2] / "docs/superpowers/specs/2026-11-13-codex-team-hook-design.md"
MARKER = "<!-- EMBEDDED_SOURCE -->"
PREFIX = "<!-- Sy public-asset UTF-8 prefix boundary compatibility"


def main():
    text = DOC.read_text(encoding="utf-8").split(MARKER)[0]
    if text.startswith(PREFIX):
        text = text.split("\n", 1)[1]
    text += MARKER + "\n"
    for filename, language in [("launcher.py", "python"), ("collector.py", "python"), ("pilot-receipt.json", "json")]:
        text += "\n### " + filename + "\n\n```" + language + "\n"
        text += (HERE / filename).read_text(encoding="utf-8") + "```\n"
    # Current server validates exactly the first 4096 bytes as complete UTF-8.
    # A 0-3 byte ASCII adjustment avoids splitting a multibyte character there.
    # This is a document publishing workaround, not a server bug fix.
    for padding in range(4):
        candidate = PREFIX + " " * padding + " -->\n" + text
        try:
            candidate.encode("utf-8")[:4096].decode("utf-8")
        except UnicodeDecodeError:
            continue
        DOC.write_text(candidate, encoding="utf-8")
        print(str(DOC) + " (" + str(len(candidate.encode("utf-8"))) + " bytes)")
        return
    raise ValueError("Cannot align the public asset prefix")


if __name__ == "__main__":
    main()
