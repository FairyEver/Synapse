# ADR 0216: Coordinate Terminal Size Ownership Separately from Leases

## Status

Accepted

## Context

ADR 0063 established how a Terminal's grid changes: `sizeRevision` advances monotonically, automated resize requires a lease and an `expectedSizeRevision`, and a user or UI resize is allowed without one. It did not say *who decided* the current size, because until now the answer was always the same — the desktop's own layout, from the fit addon.

The mobile client changes that. Its "优先移动端" display mode has the phone report its own grid so the PTY adopts it, which makes the phone's screen rather than the desktop's pane the thing the terminal is shaped for. That is deliberate: a TUI drawn for a narrow grid fits a narrow screen, where one drawn for a wide grid is broken into wrapped fragments. The trade is that the desktop's terminal is now the wrong shape, and its own layout is actively fighting to take it back — the renderer recomputes the grid from its container on every layout change and resizes the PTY to match.

So a new fact has to be recorded and acted on: which side currently owns the grid. It is not the write lease. A phone typing into a terminal preempts the desktop's lease and says nothing about the size, and a phone setting the size types nothing. Treating them as one thing would make either action silently imply the other.

## Decision

- **Size ownership is a distinct dimension.** A session carries an optional `sizeOwner` naming the phone that set the grid, alongside the write lease and the input and size revisions. Ownership and the lease do not imply one another.
- **Only a phone's own resize claims ownership.** Every other resize releases it: the desktop's fit, an automated `app.terminal.session.resize`, and creation all arrive as non-mobile. Nothing needs to call release for ownership to return — any of those paths does it. An explicit release exists only for the desktop's badge button, which hands the grid back and then re-runs the fit itself so the size moves once rather than snapping to a placeholder and moving again.
- **Ownership is announced even when the grid does not move.** A phone adopting a terminal that already happens to be its shape changes no dimension and still advances `stateRevision` and emits `sessionChanged`, because the desktop has to learn who is deciding. It does not advance `sizeRevision`, which remains a statement about dimensions.
- **The desktop takes the grid back by using it.** Any local layout change — dragging the window, splitting a pane, toggling the sidebar — clears ownership and re-fits, on the same reasoning that lets typing preempt a lease: the person at the machine has acted directly on the thing in question. The badge also offers an explicit release for the case where no layout change is at hand.
- **A phone that is gone stops deciding.** Detaching releases ownership, and a separate, much shorter idle timeout removes it from a client that stopped responding — three missed keepalives rather than the full idle timeout. A desktop left claiming a phone chose its grid, while actually holding a shape the local user did not pick, is worse than releasing a claim early.
- **Ownership is runtime state and is never persisted.** A restart returns every terminal to the desktop rather than restoring a claim held by a phone that may never return.
- **A session created by a phone may be born at that phone's grid**, when the request carries dimensions. Resizing afterwards is too late: a shell prints its banner, prompt and first commands within the opening milliseconds, laid out for whatever width the PTY had then, and those lines stay in scrollback at that width. ADR 0063 already requires explicit initial dimensions to be authorized as both a creation and a resize.
- **Concurrent claims are not arbitrated.** A Terminal has one grid, so two phones asking for different ones is a race with no correct answer. The later request wins, and the badge names whichever device currently holds it.

## Consequences

The renderer suppresses its fit while a phone owns the grid, and lays the terminal out at the phone's dimensions inside the pane instead. ADR 0070 requires the renderer and the headless emulator to agree on dimensions, so the pane cannot simply keep drawing the desktop's grid — the grid really does become the phone's, which is why the desktop has to show it and offer to take it back.

Ownership can change with no dimension change, so consumers of `sessionChanged` must not assume a resize happened. `app.terminal.session.resize` and the mobile resize intent remain different contracts: the former is automated, requires a lease and an expected size revision, and releases ownership; the latter is a UI resize under ADR 0063, requires no lease, and claims it.
