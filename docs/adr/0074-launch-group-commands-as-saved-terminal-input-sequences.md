# Launch group commands as saved Terminal input sequences

The initial stored group command is a bounded UTF-8 sequence of logical terminal-input lines. Saving normalizes CRLF to LF, defines empty-line and trailing-newline semantics, and rejects ESC, NUL, and every other unapproved control character. It is not a script, `shell -c`, or a transaction.

`app.terminal.group_command.launch` creates an interactive shell and continuously submits each logical line as semantic text followed by Enter. The one-time initial delivery is authorized by `command.launch` itself and needs neither general session control nor a lease, while granting no later control.

Delivery advances the new session's ordinary `inputRevision` and has a distinct `commandDeliveryOperationId`. A zero-byte failure preserves the running session and marks delivery failed. Partial or unconfirmable delivery returns the traceable `sessionId`, known position, revisions, and `delivery_uncertain`, and never automatically retransmits. A caller-scoped idempotent retry returns the original session and delivery result without creating or writing again.

Initial delivery does not depend on attention or shell-ready detection. Packaged tests on macOS, Windows, and Linux must prove that input queued after PTY establishment is reliable; otherwise command launch is machine-discoverably unsupported on that platform.

Raw output preserves real shell echo. The existing command-echo filtering path is removed during implementation. API results do not proactively echo command text, but a caller with output-read access may see text that the actual terminal echoes; authorization UI and documentation make this explicit. Stored bodies remain encrypted and require `command.read` for direct retrieval. Future script execution, readiness-gated execution, or other modes receive distinct explicit contracts rather than changing this behavior.
