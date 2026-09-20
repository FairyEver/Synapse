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

**3. Terminal content is recorded only behind an explicit switch, and one type is
the only way in.**
*(Revised 2026-09-20. Originally: terminal content was not recorded at all, and
`DiagnosticValue` had no case that could accept an arbitrary string. Users asked for
the content to be in the exported archive so a report can be checked against it, so
that line moved — what replaced it is recorded here.)*

`DiagnosticValue` has exactly one case that carries un-redacted user content:
`.captured(CapturedText)`. Its only construction sites are `DiagnosticLog.captureScreen`
and `DiagnosticLog.captureInput`; a source-level test walks the app target and fails
if `CapturedText(` appears anywhere else. The remaining properties:

- **A user-visible switch**, separate from the log's own. Off means the screen's rows
  are not even built — the call sites pass a closure, and the gate runs before it.
- **At most one record per second per direction**, gated at the call site.
- **Three bounds**: 12 rows, 256 bytes per row, 2 KiB total.
- **Redacted first.** The same rules as everything else; note that they recognise
  `key=value` shapes and known token prefixes, so a password typed at a prompt does
  not match anything. The export asks for confirmation and the archive states whether
  it contains content, because that is the only place the user can still consent.

The failure mode the old rule prevented was the *incidental* one — someone adds an
event during a later change and reaches for the nearest string. That is now caught by
the source-level test rather than by the compiler, which is weaker; it was accepted
because the construction sites are two functions and the test names the file.

**3b. The log is split into one file per domain, and the export is a ZIP.**

`app/ term/ net/ env/ crash/ log/` under `Library/Caches/SynapseLogs/`, one rotation
budget each, the total bounded by their sum. Terminal output is loud enough that a
single file buries the network and lifecycle lines; the domain comes from the event
name's prefix, so it cannot drift.

The archive holds that structure plus `README.txt` and `manifest.json`, and the
trimming happens before compression so the size bound is computable rather than
hopeful. Nothing about "local-only, user-initiated, no automatic upload" changes.

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
