# Separate Terminal discovery, state lists, and sensitive details

`app.terminal.session.list` requires `discover` and returns only minimum summaries such as `sessionId`, title, `groupId`, creation time, and source. It supports non-state filters such as group, creation interval, source, and title and reveals no lifecycle, attention, lease, or output facts.

`app.terminal.session_state.list` explicitly requires both `discover` and `state.read`. Its fixed item shape adds lifecycle, attention with freshness, redacted lease occupancy, `stateRevision`, and `throughOutputSeq`, supports lifecycle filtering, and contains no output body. The collection returns `generatedAt`; every attention item includes its own `detectedAt` and evidence watermark.

`app.terminal.group.list` requires `discover` and returns bounded `groupId`, name, necessary revisions, member count, and command count without sensitive launch settings or command bodies. `app.terminal.group_command.list` requires `discover`, is constrained by command resource scope, and returns only command identity, display name, command revision, and similar summaries.

Sensitive detail capabilities remain separate: `app.terminal.session_metadata.get` requires `metadata.read`, `app.terminal.group_launch.get` requires `metadata.read`, and `app.terminal.group_command.get` requires `command.read`.

Every collection has a fixed response shape, default and hard maximum limit, stable ordering, and an opaque cursor bound to sort, filters, and query. There are no `includeState`, `includeMetadata`, or `includeCommandBody` switches. Legacy get and list adapters map only through explicit permission combinations; insufficient permission returns an authorization error rather than silently deleting fields and claiming success.
