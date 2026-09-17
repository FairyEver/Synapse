# ADR 0218: Take the Terminal Grid Back Only on an Explicit Release

## Status

Accepted. Supersedes part of ADR 0216.

## Context

ADR 0216 gave a phone a size claim over a terminal's grid, and made a local layout
change on the desktop clear it: "the desktop takes the grid back by using it". The
reasoning was that dragging a window is the same kind of act as typing into a
terminal the phone holds the write lease for — the person at the machine has acted
directly on the thing in question.

In use, the two are not the same act. A window is dragged for reasons that have
nothing to do with the terminal inside it: moved aside to read something behind it,
resized for another pane, split to work in two places at once. Each of those ended
the phone's mode, and neither reader could connect the two events — the phone's
layout simply stopped, with no local act that reads as the decision that ended it.

A second gap sits in the same place. The claim is desktop state, and the phone had
no way to learn it had been dropped. A display mode is a stored per-session choice
on the phone, so after a desktop release it went on saying "优先移动端" for a terminal
that was no longer its shape. It would not even re-claim: the phone deduplicates the
grid it reports, so the grid it had already asked for was never sent again.

## Decision

- **The pane's own release is the only local act that takes the grid back.** Dragging
  the window, re-splitting a pane and toggling the sidebar no longer clear the claim.
  The renderer's fit holds whenever a phone owns the grid — unconditionally, with no
  layout-driven exception left in it, which is why `decideTerminalGrid` and the pane
  measurement that fed it are gone rather than narrowed. The badge's release and the
  phone's own `releaseGrid` remain the two ways back.
- **Ownership is announced on the summary.** `MobileSummarySession` carries
  `gridOwnerId`, the claiming phone's client instance id, and the desktop gateway
  fills it from `sizeOwner`. It is the only channel that can: a desktop release is a
  local act and produces no intent, so the summary is where the phone learns who is
  deciding a terminal's size. Absent when the desktop's own layout decides, which
  keeps the common payload byte-for-byte what it was.
- **A phone that lost the grid says so.** A summary whose owner is another client, or
  none where this phone's used to be, puts the display mode back to `.desktopDriven`
  and drops the phone's record of the grid it asked for — without which a later
  switch back to the phone's layout would be deduplicated away and change nothing.
- **The unowned case needs a previous value.** A claim this phone has just made and
  the desktop has not adopted yet also reads as unowned — the debounce, the round
  trip and the summary's own interval all land inside that window — so a grid that
  was nobody's before and is nobody's now is left alone. Only ownership moving off
  this phone is a loss.
- **The summary's byte budget is raised from 224 KiB to 240 KiB.** The owner had to
  ride on every session rather than be sent separately, because a phone needs it per
  session and the summary is the one message a phone cannot reassemble. At 256
  sessions naming a 48-byte id apiece, the widest admissible summary is 234 KiB; the
  desktop hop's 256 KiB socket still clears it.

## Consequences

Everything else ADR 0216 decided stands: ownership is separate from the write lease,
only a phone's own resize claims it, ownership is runtime state that is never
persisted, a phone that detaches or goes quiet stops deciding, and a session created
by a phone may be born at its grid.

`applySessionResize` still clears ownership for any non-mobile source. That is now a
backstop rather than the ordinary path — it is what keeps an automated resize or a
creation from leaving a stale claim behind — and the renderer's fit no longer
reaches it while a phone owns the grid.

A phone that is offline when the desktop releases still re-claims on reconnect,
because `reassertGridClaims` cannot tell that release apart from the one the desktop
performs whenever a phone disconnects. The reader's stored mode is the phone's own
choice and re-asserting it is the honest reading of it; the alternative would need a
second signal and a way to age it.

A window dragged smaller than the phone's grid now leaves the terminal clipped by the
pane rather than snapping back to the desktop's shape. That is the trade this ADR
makes — the mode survives an act that was not about it — and the badge's release is
the way out when the reader wants the local layout back.
