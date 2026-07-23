# Return errors before side effects and traceable outcomes afterward

Every Terminal tool returns a fixed envelope for the current development contract. A rejection before any side effect is a structured error with machine-stable code and category, retryability, optional safe `retryAfter`, `correlationId`, bounded redacted details, and an optional short human message that clients must not parse. The envelope does not carry a public v1/v2 `contractVersion` field.

Any request that may already have created, written, or delivered returns a result with a stable outcome such as `accepted`, `partial`, `delivery_uncertain`, `no_op`, or `failed_after_identity_created`, plus applicable `sessionId`, `operationId`, revisions, and acceptance summary. Partial and uncertain outcomes are never automatically retried. `retryable` means only that a caller can reevaluate under stated conditions, not that replay is safe.

Stable errors include common `validation_error`, `invalid_argument`, and `not_found`, plus caller-context and policy-denial, lease, lifecycle, revision and idempotency, cursor and watermark, capability support, quota, persistence, and `internal_error` categories. Permission evaluation precedes resource existence; a policy denial returns `permission_denied`, and `not_found` is possible only after the relevant permission check.

Errors, details, and messages contain no bodies, absolute paths, commands, output, credentials, stacks, plaintext `leaseId`, or other actor identity. Internal structured logs correlate through `correlationId`. MCP HTTP, stdio, and IPC map transport status onto the same domain code and outcome rather than creating separate semantics.

Removed development tools are not retained as legacy adapters; callers use the current catalog and schemas.
