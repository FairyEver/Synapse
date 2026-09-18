# ADR 0219: Lock the Terminal While a Phone Holds the Grid

## Status

Accepted.

## Context

ADR 0216 gave a phone a size claim over a terminal's grid, and ADR 0218 made the
pane's own release the only local act that ends it. That claim was read as a
statement about the *layout*: the desktop held its fit back and drew the terminal
at the phone's grid, while everything else on the desktop side stayed live. Typing
still reached the shell, so did the command bar under the pane, and so did a path
dropped from Finder onto the pane.

In use, the claim is not read as a layout fact. The pane says "正在被 iPhone 使用"
in as many words, and a reader who then types into that terminal — or presses 回车
in the bar below it — has to conclude either that the label is decorative or that
the two sides are fighting over the same prompt. The second reading is the
dangerous one: the bytes do reach the phone's shell.

## Decision

- **While a phone holds the grid, this desktop does not write to that session.**
  `disableStdin` is set for the duration of the claim — the same switch that
  already stops input into a terminal that is not running, and the one
  `writeTerminalInput`, the paste path and Shift+Enter all gate on. Nothing new
  intercepts keystrokes; the switch that means "input does not go anywhere" is
  simply given one more thing that means it. The pane is created with it set too,
  so a pane mounted while the claim already stands is locked from its first frame.
- **The command bar below the pane belongs to the session.** It is rendered by the
  app shell rather than by the pane, so it cannot inherit the pane's layer and has
  to check the claim itself — otherwise it stays a second way in, one button wide,
  writing into a terminal someone else is driving. Its buttons are disabled, the
  microphone entry goes with them, and the whole bar is covered by the same wash
  the pane uses.
- **A path dropped onto the pane is a write and is refused with the rest.** Moving
  panes around is not: it leaves the grid alone (ADR 0218) and is an act on the
  workspace rather than on the session.
- **The pane header stays uncovered and becomes inert.** The header is where the
  claim is legible — who holds the terminal, and the button that takes it back — so
  the layer no longer covers it. Its own controls (file tree, equalize, maximize,
  close, rename, drag) are disabled instead. A layer over the whole pane hides the
  one control the reader needs; leaving the header alone leaves it looking like a
  live surface, which is what it was until now.
- **An in-flight recording ends with the claim.** Voice is confirmed by writing
  into the PTY, and its transcript bar would replace the covered command bar with
  an uncovered one; cancelling is the act the 放弃 button already performs.
- **The lock is per session.** Other panes in the same workspace, the session list
  and the app's own top bar are untouched. What is locked is the terminal someone
  else is driving, not the app.

## Consequences

The claim now reads the same on both sides: the phone has the terminal, and the
desktop shows it held rather than merely reshaped. The trade is that a reader who
wants to type into a phone-driven terminal has to take the grid back with the badge
first — one click, and the click is the point.

Keyboard shortcuts that act on the pane (close, split, focus movement) are left
alone, on the same reasoning that keeps pane rearrangement local: they are
workspace acts, not writes into a session someone else is driving.
