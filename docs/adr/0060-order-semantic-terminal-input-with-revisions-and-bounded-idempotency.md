# Order semantic Terminal input with revisions and bounded idempotency

`app.terminal.session_input.send` receives `sessionId`, `leaseId`, mandatory `expectedInputRevision`, a caller-scoped idempotency key, and bounded `actions`. Actions are either `text` or a fixed enumerated `key`. The service prevalidates every text action's UTF-8 byte length and rejects CR, LF, ESC, NUL, and the agreed control-character set before any write. Key encoding is entirely server-side. Limits apply to action count, each text byte length, and total request bytes; delay or sleep actions are unsupported.

`expectedInputRevision` must exactly equal the current revision. For concurrent requests under one lease, only one can claim that revision and all others conflict, independent of network arrival assumptions. After validation, actions are written continuously and in order without another automated input operation interleaving, but the write is not a transaction.

Accepting any byte advances `inputRevision`. Success or partial failure persists and returns `inputRevisionBefore`, `inputRevisionAfter`, `operationId`, `acceptedAt`, accepted action and byte counts, and, when applicable, `failedActionIndex` and a structured error. This result says only what the Terminal service accepted.

Within a documented retention window, the same caller-scoped idempotency key and canonical request returns the original persisted result and never writes again; reusing the key for another request conflicts. Idempotency safety has an explicit time boundary rather than an unlimited exactly-once promise. The contract states how long full results and/or duplicate-prevention tombstones remain. Callers use globally unique non-reused keys and, outside the safe window, inspect the latest `inputRevision` before deciding what to do rather than blindly replaying.

UI input first performs explicit user takeover, invalidating the automated lease, and cannot interleave with the accepted automated action sequence.
