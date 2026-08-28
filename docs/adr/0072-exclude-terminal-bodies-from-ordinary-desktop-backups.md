# Exclude Terminal bodies from ordinary desktop backups

The initial ordinary desktop backup restores Terminal structure and configuration but excludes Terminal bodies. It includes groups, session structure, revisions, lifecycle and termination facts, redacted launch facts, and necessary completed-operation facts. It excludes raw output, emulator checkpoints and derived scrollback, active leases, pending observations, and expired or short-lived idempotency records. No exported manifest claims an omitted block is available.

The projection preserves `nextOutputSeq`, accumulated discard facts, and other evidence that output previously existed. After restore, the retained interval is empty and reads report `gap`, `truncated`, and `reason=backup_excluded`; rendered views without reconstructible data are degraded. Restored `running` and `stopping` sessions become `lost` with an explicit restore cause. Pending or delivered operations are never replayed and recover as `delivery_uncertain` or complete consistently with the new lost fact.

Terminal restore uses a dedicated validated plan and atomic or recoverable commit, checking namespace schemas, references, and identity conflicts. Generic `importAll` must not leave a partially valid Terminal domain.

Stored command bodies are included by default only if the existing `synapse-backup-v1` contract explicitly permits user configuration of the same sensitivity and supplies adequate protection and warning. If the current backup is ordinary plaintext JSON without sufficient notice, the final design treats command bodies as a sensitive option or explicitly communicates the risk rather than silently expanding exposure. Backup results and documentation always list omitted Terminal output.

A future full-history backup is a separate format and flow with size disclosure and encryption. It is not inserted into ordinary configuration backups. Implementation updates backup documentation, the stable `AGENTS.md` boundary, and restore tests in the same task.

Ordinary backup export must omit Terminal body namespaces before reading their records, while still emitting empty namespace entries so restore clears incompatible local bodies. Post-export filtering is not sufficient because it materializes the excluded history and can exhaust the desktop process before a backup is written.
