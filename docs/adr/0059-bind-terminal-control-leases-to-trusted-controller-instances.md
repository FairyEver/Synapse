# Bind Terminal control leases to trusted controller instances

Terminal MCP exposes immediate `app.terminal.session_control.acquire`, explicit `renew`, and idempotent `release`, without an MCP takeover or implicit acquisition queue. A lease owner is the tuple `sessionId + clientId + controllerInstanceId`, because one MCP installation may run several Agent tasks concurrently. The controller instance comes from trusted call context or a server-bound handle and cannot be impersonated through an arbitrary tool parameter.

Acquire applies only to a `running` session. An idempotent retry by the same owner returns its existing valid lease; another controller instance under the same `clientId` is still a different automated controller and receives a redacted `control_busy` result. Callers wait through observation and bounded retry rather than a hidden fairness queue. Only an explicit UI or local-user path may perform user takeover.

`leaseId` is globally unique and never reused. It is an operation handle rather than an authentication credential and is redacted in ordinary logs and audit. The server applies documented minimum and maximum lease durations to a requested duration and returns the effective `acquiredAt`, `expiresAt`, `leaseRevision`, `stateRevision`, and current `inputRevision`. Renew returns the same revision facts so the owner can construct the next ordered input without a separate state read.

Input does not implicitly renew a lease. Renew succeeds only for the transport-assigned original controller while the old lease remains valid; an expired or invalidated lease cannot be revived. Release is idempotent and checks both owner and `leaseId`; a late release cannot affect a newer `leaseRevision`.

Transition to `stopping` or a terminal lifecycle state, local policy revocation, timeout, or user takeover immediately invalidates the lease and advances `stateRevision`. Every input operation rechecks the transport-assigned owner identity, `session.control`, and the current lease. Audit redacts `leaseId`.
