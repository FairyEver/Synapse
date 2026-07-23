# Prove Terminal termination modes per packaged platform

Terminal normal stop and force stop use a platform termination adapter with a machine-discoverable capability matrix. The matrix exposes `normalStopSupported`, `forceStopSupported`, managed-process scope, and limitations through capability or tool metadata or a diagnostic interface. An Agent can inspect support before selecting a flow.

Normal and force termination must be different-strength paths proven against the currently packaged node-pty and runtime. Renaming one `pty.kill()` implementation does not create two semantics. Unix PTY hangup and signal behavior and process-group scope, and Windows ConPTY, winpty, Job, and process-tree behavior, require integration tests on their target packaged platforms rather than inference from types or documentation. An unproven mode returns `normal_stop_unsupported` or `force_stop_unsupported` and never falls back to a more dangerous or equivalent path.

A session enters `stopping` only after the platform request is known to have been issued successfully. The actual exit event determines `ended`. A delivery failure preserves the previous lifecycle and records a failed operation. An unconfirmable delivery returns `delivery_uncertain`, retains an observable operation status and the real session lifecycle, and never marks the session ended early.

UI ordinary close uses normal stop. Force stop requires a user's explicit choice or a caller with the high-risk permission and never occurs as an automatic timeout escalation. Three-platform packaged-runtime integration tests are part of implementation acceptance.
