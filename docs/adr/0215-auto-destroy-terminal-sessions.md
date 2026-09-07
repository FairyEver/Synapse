# ADR 0215: Auto-Destroy Terminal Sessions

## Status

Accepted

## Context

Synapse previously persisted Terminal sessions after their PTY became unavailable. Restarting the application converted interrupted runtimes to `lost`, so the sidebar could show a terminal that retained output but could no longer accept input. This made a historical record look like a usable terminal and kept session-scoped data after its runtime had no continuation path.

## Decision

- A Terminal session is retained only while its PTY is `running` or a termination delivery is `stopping`.
- When a PTY reaches `ended`, session creation reaches `failed`, or a runtime is determined `lost`, Synapse immediately removes its pane. Removing the last pane also removes its workspace from the sidebar.
- Destruction removes the session identity, retained output, emulator checkpoint, launch body, leases, operations, delete plans, and session-scoped idempotency records. The immutable `sessionId` is never reused, and later reads return `not_found`.
- An already-pending observer may receive the final lifecycle and end facts before destruction so accepted termination can still be confirmed. Terminal lifecycle is not retained as browsable history.
- Application shutdown disposes and terminates every PTY, destroys all session-scoped state, and persists the empty session/workspace set. Startup also purges any session/workspace and related records left by an older version, crash, or incomplete shutdown; it never reconstructs the PTY or converts the record to `lost`.
- Global launch settings, groups, saved commands, and custom toolbar actions remain persistent because they are configuration rather than runtime history.
- `app.terminal.session.delete` remains in the current MCP contract for compatibility with a narrow race in which a terminal-state response is still observable, but normal callers do not need a separate delete after termination.

## Consequences

The Terminal sidebar represents usable or currently stopping runtimes rather than history. Closing Synapse ends all terminal sessions, so users must create a new session after reopening. Agents must treat `not_found` after a terminal transition or application restart as successful cleanup, not as evidence that termination failed. This decision supersedes the retained-session, shutdown recovery, backup, and explicit terminal-state deletion semantics in ADRs 0042, 0046, 0047, 0049, 0051, 0065, 0066, 0072, and 0076 and in the original Terminal MCP control design.
