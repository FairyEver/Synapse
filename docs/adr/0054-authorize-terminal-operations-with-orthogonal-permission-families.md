# Authorize Terminal operations with orthogonal permission families

Terminal authorization is the explicit product of a permission family, resource scope, and validity period. Permission families do not imply one another merely because they address the same object or appear lower risk. In particular, creating a session does not grant control; control does not grant output reading, stopping, or deletion; and output reading does not grant command-body or sensitive-metadata access.

The permission families are:

- `discover`: discover objects and their minimum bounded summaries.
- `state.read`: read lifecycle, attention, lease visibility, revisions, and watermarks, and observe changes without output bodies.
- `metadata.read`: read sensitive metadata such as cwd, shell, and redacted launch facts.
- `output.read`: read retained raw output, rendered views, and output deltas returned by observation.
- `command.read`: read stored group-command bodies.
- `command.launch`: independently create a session from an authorized stored command without requiring general `session.create` and without granting command-body access. It accepts only an authorized `commandId` plus expected launch and command revisions; callers cannot override cwd, shell, environment, or command text.
- `session.create` and `session.override.create`: create normally resolved sessions or sessions with explicit cwd, shell, environment, or other launch overrides.
- `session.control`, `session.rawInput`, and `session.resize`: acquire, renew, or release a write lease and submit semantic input; use the separately authorized raw escape hatch; or change PTY dimensions.
- `session.stop` and `session.forceStop`: request normal or explicit forced termination.
- `metadata.manage`: rename sessions and authorize any future session-to-group move explicitly.
- `group.manage` and `command.manage`: manage group metadata and launch settings, or stored group commands.
- `session.delete` and `group.delete`: perform their respective high-risk deletion operations.

`state.read` is deliberately separate from `output.read`, so an Agent can determine whether a terminal needs attention without receiving terminal output. Observation applies the same split: state-only observation excludes output bodies, while output deltas require `output.read`.

Resource scope may cover selected sessions, selected groups, or all terminals. A group-scoped grant must state independently whether it covers current member sessions, future member sessions, and group commands; shared membership never causes automatic authorization inheritance. Authorization UI may offer presets such as observer, operator, or administrator, but every preset expands to visible and independently revocable permission families and scopes. A preset never introduces a hidden super-permission.

`command.launch` authorization normally pins the `commandRevision` approved by the user and the required `launchRevision` scope. A changed command body or launch semantic is new executable content and is not authorized by the old grant. Only an explicit, visible, revocable, and auditable follow-latest choice may advance an authorization with later revisions. Request fields such as `expectedCommandRevision` and `expectedLaunchRevision` provide optimistic concurrency protection; they never widen the grant, so discovering and submitting a newer revision cannot bypass authorization pinning.

Successful command launch returns the new `sessionId`, `launchRevisionApplied`, `commandRevisionApplied`, and other launch facts without echoing command text. The permission grants no state, output, control, stop, or delete access to the created session. If the caller should receive permissions over sessions created through a particular grant, that grant must explicitly declare a derived-session scope and its concrete permission families; creation provenance alone never creates ownership or implicit inheritance.
