# Delete Terminal sessions directly and nonempty groups through plans

`app.terminal.session.delete` targets one exact `sessionId` with a caller-scoped idempotency key. It rechecks `session.delete` and requires `ended`, `failed`, or `lost` at commit time. A transactional or equivalently recoverable operation removes identity, metadata, and retained output without partial completion and returns `deleteOperationId` plus a redacted actual-deletion summary.

`app.terminal.group.delete` deletes only an empty group and requires `expectedGroupRevision` plus a caller-scoped idempotency key. A nonempty group returns `group_not_empty`; it never cascades implicitly.

Nonempty groups use distinct `app.terminal.group_delete.preview` and `app.terminal.group_delete.commit` capabilities. Preview requires `group.delete` and returns a bounded redacted response. The server-side delete plan retains the complete session and command sets, group, membership, and command revisions, session lifecycle facts, expected deletion ranges, and expiry rather than saving only the response summary.

Commit receives the plan identity and a caller-scoped idempotency key and rechecks actor authorization, expiry, exact sets and revisions, and terminal lifecycle for every session. It atomically or recoverably removes sessions, retained output, commands, and group. Automatic output eviction that only reduces remaining bytes is a safe narrowing and the result reports actual ranges. Added output, members, or commands, lifecycle changes, or any unknown change expands or alters impact and invalidates the plan.

Preview, commit, and direct deletion use the shared bounded idempotency model. After deletion, queries and retries work only within a documented tombstone window; outside it they return a uniform result that does not reveal historical existence. Audit and results never contain command or output bodies.
