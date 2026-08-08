# ADR 0214: Layer Terminal Launch Configuration With Encrypted Values

## Status

Accepted

## Context

Terminal programs may need host-specific environment behavior, while users can start them through an ordinary session, a group, a saved command, or MCP. Requiring every user to prefix every command makes Synapse-specific terminal behavior fragile. Copying launch logic into each entry point would create inconsistent precedence and leak sensitive values through list APIs or structured storage.

## Decision

- One resolver composes safe OS bootstrap data, protected Synapse identity, global, group, saved-command, and one-time override layers in that order.
- Global settings belong to Terminal and are opened from the Terminal Header. System Settings does not own an alternate entry.
- Environment entries model inheritance by absence, explicit string assignment including an empty string, and explicit removal with `null`/`unset`.
- `TERM_PROGRAM` and `TERM_PROGRAM_VERSION` are protected built-ins supplied with the application version during bootstrap.
- Environment values, command bodies, and applied session environment snapshots are encrypted. Relational metadata contains only keys, actions/references, sources, and revisions.
- Configuration is snapshotted when a PTY is created. Later changes never mutate an existing process.
- Saved-command launch settings configure the whole new shell session; the command body is still delivered afterward as the sole saved input sequence.
- MCP may manage global settings through `settings.manage`, but reads and mutation responses never return environment values.

## Consequences

Any terminal program can receive the effective configuration regardless of how the user invokes it, without application-specific command rewriting. UI, IPC, MCP, and PTY creation share the same precedence and validation. Users must create a new terminal to apply changed settings. Because MCP cannot read values, sparse updates must preserve unmentioned entries and revision conflicts must be resolved from metadata rather than by round-tripping plaintext.
