# Split Terminal session creation by launch intent

Terminal MCP exposes three creation paths with distinct launch intent and authorization:

- `app.terminal.session.create` uses the same resolved snapshot as the UI's ordinary new-session action. Without `groupId` it resolves the shared default snapshot; with `groupId` it strictly inherits the snapshot identified by `expectedLaunchRevision`. It accepts no cwd, shell, environment, or other launch overrides. A title may be supplied only as display metadata.
- `app.terminal.session_override.create` accepts an explicit `overrides` object and override intent and requires override-create authorization. Cwd, shell, environment, and every other override are recorded individually in redacted launch facts and audit.
- `app.terminal.group_command.launch` accepts only `groupId`, `commandId`, `expectedLaunchRevision`, `expectedCommandRevision`, and an idempotency identity. It accepts neither command text nor launch overrides.

Columns and rows affect PTY and TUI behavior and are not harmless display fields. Ordinary creation uses a shared, explainable default size. Explicit initial dimensions are controlled launch overrides, are recorded in launch facts, and must be coordinated with the session-resize permission and policy.

Every creation request uses an idempotency key scoped by `clientId`, capability, and a canonical request digest, with an explicit bounded retention period. Retrying the same key and request returns the original `sessionId`; reusing the key for a different request is a conflict, and keys never collide across callers.

Authorization, expected revisions, snapshot resolution, and all predictable validation complete before a session identity is established. If PTY infrastructure fails after `sessionId` creation, Synapse preserves a `failed` session and its failure facts and returns that traceable `sessionId` in the error result. A successful creation response means the session was established and reached `running`; it does not mean the shell is ready, a command succeeded, or the foreground program awaits input.

Creation responses identify the contract or capability version, `sessionId`, creation source, applied revisions, redacted launch facts, lifecycle, and state and output watermarks.
