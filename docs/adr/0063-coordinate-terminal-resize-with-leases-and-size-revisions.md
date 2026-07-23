# Coordinate Terminal resize with leases and size revisions

Automated `app.terminal.session.resize` requires `session.resize`, `session.control`, and the authenticated owner's current valid lease. Its request carries `leaseId`, mandatory `expectedSizeRevision`, bounded `cols` and `rows`, and a caller-scoped idempotency key. Only a `running` session may resize; `stopping` and terminal lifecycle states reject it.

`sizeRevision` is monotonic within a session. Every actual UI or MCP dimension change advances both `sizeRevision` and `stateRevision`. Automated resize must exactly match the expected size revision so it cannot overwrite an intervening change. A same-size request returns an explicit no-op without advancing either revision, and an idempotent replay never applies the resize twice.

User or UI resize remains allowed and does not by itself constitute input takeover or silently revoke an automated lease. It is nevertheless observable and invalidates rendered views, attention evidence, and bracketed-paste mode evidence that depend on the previous dimensions according to explicit freshness rules. Resize does not advance `inputRevision`; output caused by resize advances the ordinary output watermark.

Success means only that the PTY accepted the new dimensions and returns operation identity, effective size, `sizeRevision`, `stateRevision`, and acceptance time. It does not claim that the foreground program completed redraw. Minimum and maximum dimensions and platform differences are validated explicitly, and a backend error cannot be swallowed as success.

Explicit initial dimensions in override creation require both `session.override.create` and `session.resize`. No lease exists yet, so creation does not require one, but the effective size is recorded in redacted launch facts.
