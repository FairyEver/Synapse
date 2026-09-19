# ADR 0221: Let the Phone Choose Its Computer, and Stay There

## Status

Accepted.

## Context

One account can be signed into several computers at once. The relay was built for
that from the start: a phone's socket is to the cloud rather than to a computer, every
intent carries a `desktopClientInstanceId`, and the cloud forwards it to whichever
computer owns that id. Two computers coexist in the registry without superseding each
other.

What was missing was the phone's half. It held a single `selectedDesktopClientInstanceId`
and no way to set it, so it resolved the question itself, twice over: on a list it took
`onlineDesktops.first`, and whenever the computer it was on dropped out it threw the
answer away and took the first one again.

Two things were wrong with that. The list the cloud returns is the registry's own, sorted
by `userId:clientInstanceId` — and a client id is a UUID, so "which computer am I looking
at" was decided by string order and nothing else. And because the same rule ran on every
reconnect, a reader who had been looking at one computer could find themselves, without
having touched anything, on another one with a different set of terminals.

The screens had the same gap from the other side. The settings list of connected
computers was inert, and its own comment conceded why it could not be better: the
presence push carries ids only, so the phone could not name a computer it was not
currently on.

## Decision

**1. Which computer the phone is on is the reader's answer, and it is remembered.**

`ViewedDesktopPreference.resolve(online:)` is the whole rule: the remembered computer,
or the first reachable one if nothing has ever been remembered. A remembered computer
that is not reachable is *kept* — it is not replaced by one that is. There are exactly
two ways the answer changes: nothing had been chosen, or the reader chose.

The choice is persisted locally and cleared on sign-out, along with the names of the
computers it has seen. A client id belongs to one account's machine; carrying it across
a sign-in would start the next user on a computer that is not theirs.

**2. A computer going away is its own connection state.**

`Connectivity` gains `viewedComputerOffline`, and only when at least one *other*
computer is reachable. With nothing else online the answer stays `noComputer`: there the
reader is being sent to a machine either way, which is what that case already says. The
distinction matters because the two send the reader to different places — the switch
that is already on the screen, or a computer that needs switching on — and collapsing
them is the defect `Connectivity` was created to fix in the first place.

**3. The list of computers is what the switch draws, and the name comes over HTTP.**

`GET /api/mobile/desktops` gains `desktops: [{ clientInstanceId, deviceName }]` beside
the `clientInstanceIds` every shipped build already reads. `mobile.presence` is left
alone: it is broadcast to every phone of the account and its payload is byte-budgeted,
and a phone that never opens the picker has no use for the names. The one cost is a
request per change of the set of reachable computers, which is a rare event.

**4. Leaving a computer means handing back what it was holding.**

`attach` acquires the phone's write lease on the desktop side, so the computer being
left holds one for every terminal the phone had open. A switch now sends `detach` for
each, as a quiet intent — the reader's action was "switch computer", and nothing on
screen has "the detach failed" as its subject. Everything else keyed by a session id is
dropped at the same time, because a session id is meaningful only to the computer that
issued it and anything resolved against the *current* selection would otherwise land on
the wrong machine.

Files follow the same rule: an attachment records the computer it was picked for, and is
only handed to that one. The reader can switch while its bytes are still going up.

## Consequences

The phone does not move on its own. A computer that goes away leaves the reader where
they were, with the screen saying so and one tap to somewhere else — which is worse than
a silent switch only if the reader wanted the switch and did not ask for it.

A fresh install still adopts whichever computer the cloud lists first, because there is
no choice to keep yet; from that moment on it is sticky. A reader with two computers may
therefore land on the "wrong" one once, and the fix is the visible picker rather than
another silent guess.

The names are as good as what a computer calls itself — `os.hostname()` on the desktop —
so a two-computer account with the same hostname on both would show two identical rows.
That is the same name the desktop already reports to the device list, and nothing here
invents a second one.
