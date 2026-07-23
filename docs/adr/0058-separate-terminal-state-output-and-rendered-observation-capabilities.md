# Separate Terminal state, output, and rendered observation capabilities

Terminal MCP provides five explicit read and observation capabilities with fixed response shapes:

- `app.terminal.session_state.get` requires `state.read` and returns lifecycle, attention, the caller-visible lease summary, `stateRevision`, and `throughOutputSeq`. It never returns output bodies.
- `app.terminal.session.observe` requires `state.read` and waits for a bounded period for state or output-watermark change. It may return change types, output ranges, and gap metadata, but no output bytes.
- `app.terminal.session_output.read` requires `output.read` and performs a bounded non-waiting read of the retained raw-output interval, returning retention bounds, cursors, `hasMore`, and gap information.
- `app.terminal.session_output.observe` explicitly requires both `state.read` and `output.read` and returns a consistent state snapshot with a bounded output delta. Its response shape is fixed and does not change because the caller happens to hold additional permissions.
- `app.terminal.session_view.get` requires `output.read` and returns a bounded, traceable, potentially degraded rendered view rather than claiming to be raw output.

These tools do not expose `includeOutput`, `includeState`, or other switches that cross permission families. Missing either required permission produces an explicit authorization failure rather than silently removing fields.

Lease visibility is caller-relative. The current holder may receive details of its own lease. Other state observers see only whether automated control is occupied and the minimum status needed to make decisions; another caller's `clientId` is not disclosed by default.
