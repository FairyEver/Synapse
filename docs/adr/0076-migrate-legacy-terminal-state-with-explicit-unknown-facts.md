# Migrate legacy Terminal state with explicit unknown facts

Unversioned `terminal-state.json` maps lifecycle explicitly: `running` becomes `lost` with `legacy_runtime_unrecoverable_after_restart`; `exited` becomes `ended` with `legacy_process_exit`; `killed` becomes `ended` with `legacy_killed_unclassified`; `failed` remains `failed` with `legacy_infrastructure_failure_unclassified`; and `lost` remains `lost` with `legacy_runtime_lost`.

Existing exit code, signal, and end time are preserved only when present. Missing time is represented by `endTimeUnknown`, never the migration time. Migration synthesizes no stop or force operation, actor, authorization, lease, attention, or idempotency record, and records `creationSource=legacy_unknown`.

New revisions start from a marked migration baseline. `inputRevision=0` is paired with facts saying it is a post-migration baseline and pre-migration input history is unknown; it never means no input previously occurred. Cwd, shell, and dimensions form `legacy_unversioned` launch facts, with unknown `launchRevisionApplied`.

Migration preserves only provable output sequence. Noncontiguous chunks, nonzero watermarks without bodies, and inconsistent last-sequence facts produce gap and accumulated-loss facts. Legacy JavaScript strings migrate as encrypted `legacy-js-string-utf8`; they do not claim arbitrary original byte fidelity. Content removed by legacy command-echo filtering is unrecoverable and is not synthesized.

A legacy `startupCommand` becomes one saved command marked with legacy provenance only when no command collection exists. If commands already exist, the old startup field remains a diagnosed shadowed fact and creates no new executable entry.

The target cuts over atomically only after encryption, references, and final schemas all validate. Any failure leaves the legacy source and exact-byte backup intact and does not switch.
