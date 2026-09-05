# Terminal backup and recovery

Synapse ordinary configuration backup preserves Terminal structure, not terminal bodies.
Excluded body namespaces are represented as empty backup entries without first materializing their on-disk contents, so large retained output cannot block or exhaust an ordinary configuration export.

Included data:

- groups, session identities, display metadata, and structural revisions;
- lifecycle and end facts;
- redacted launch facts and historical output watermarks;
- completed operations needed to interpret retained structure.

Excluded data:

- raw PTY output;
- emulator checkpoints and derived scrollback;
- saved-command bodies and recoverable environment values;
- user-defined toolbar action labels and input contents;
- active leases and pending observations;
- pending deletion intents and short-lived idempotency records.

An ordinary backup never exports a usable manifest that points to an excluded block. A restored session keeps its historical `nextOutputSeq` and cumulative loss facts, but its retained interval is empty and reports `gap`/`truncated` with `reason=backup_excluded`. A rendered view without reconstructable data is degraded. Sessions restored from `running` or `stopping` become `lost` with an explicit restore cause; pending or delivered termination operations are never replayed.

Terminal import validates schema versions, references, immutable ids, and conflicts before committing through a recoverable plan. Failure must not leave a partially valid Terminal domain. A future full-history export, if added, requires a separate encrypted format with size disclosure; it is not part of `synapse-backup-v1`.
