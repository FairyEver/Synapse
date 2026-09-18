# ADR 0220: Keep Mobile Diagnostic Logs On Device, and De-identify Identifiers Locally

## Status

Accepted.

## Context

The desktop has had a diagnostics story for a while: `log-store.ts` writes
structured records to `userData/logs`, the settings page exports them as a ZIP, and
`agent-runtime-security.md` spells out what may not be logged. The phone had none of
it — twelve `os.Logger` calls and nothing else. When a report arrived ("terminal
won't scroll on my iPhone"), there was no artefact to look at: the reproduction had
already happened and left no trace.

A phone is not a desktop. Two things differ in a way that decides the design.

**The log leaves through a different door.** On the desktop the file is exported to
a folder the user already controls. On the phone the obvious route out is the system
share sheet — which means WeChat, which means a third party, and it means the user
cannot take it back. A log that is *easy* to send has to be a log that is *safe* to
send.

**The identifiers are smaller.** Session ids and client-instance ids are UUID-shaped
but few. Hashing them would produce something that looks anonymous and is not: the
space is small enough to enumerate, and the same hash on both ends implies a
comparability that does not exist across files.

## Decision

**1. Logs live in `Library/Caches/SynapseLogs/`, not Documents.**

Documents is backed up, so a log left in it would leave the device through iCloud
without the user ever pressing share — a file containing session titles and device
names, uploaded on their behalf. Caches is excluded from backup and is reclaimed
under disk pressure, which also means the size cap is enforced twice.

The cost is accepted: a log can be reclaimed by the system if the phone sits idle
for a long time. A report that needs keeping is exported at the time it is produced.

**2. Real identifiers never appear; they become local aliases (`s1`, `d1`, `p1`).**

The mapping is per-process, in memory, never written down. It makes one file
internally comparable — `s1` is the same terminal throughout — while giving a
different reader of a different file nothing to correlate.

This is an explicit exception to ADR 0114's fixed placeholder set. ADR 0114 governs
problem feedback, a stricter and lossier channel where an identifier becomes
`<session>` and stays anonymous. A diagnostic log needs the file to be internally
coherent, which a single opaque placeholder would destroy.

**3. Terminal content is not recorded, and the type system is what enforces it.**

`DiagnosticValue` has no case that accepts an arbitrary string. Values arrive as
numbers, closed-enum labels, redacted messages, aliases, or the two names the user
agreed to (device name, session title). Writing `row.text` into a field does not
compile. This is deliberate: the failure mode being prevented is the *incidental*
one — someone adds an event during a later change and reaches for the nearest
string.

**4. The redaction rules mirror `log-store.ts`, including its `[redacted]` / `[key]`
markers.**

Not ADR 0114's `<secret>` / `<token>`. The two channels are different, and the
conformance that matters is between the two *log* implementations. The
`RedactionPlaceholder` enum keeps the `<...>` forms for the separate purpose of
naming a field's kind explicitly (`this field is a token`); it does not participate
in regular-expression replacement.

## Consequences

The share sheet becomes the only exit, which is what makes "safe to send" a design
requirement rather than a nice-to-have. In exchange, a user who reproduces a problem
can hand over evidence in two taps, and the evidence cannot carry their commands or
their tokens with it.

Deleting the logs must not stop future ones: the directory is rebuilt lazily on the
next write. Turning the switch off must not delete anything — the user pressed "stop
recording", not "forget what you have".

Aliases mean a log is readable on its own but not correlated with any other file.
That is the intended limit, and it is why the alias table is reset on sign-out:
a second person's terminals should not continue numbering from the first's.
