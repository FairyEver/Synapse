# Track Terminal termination as persistent asynchronous operations

`app.terminal.session.stop` requires `session.stop` and sends normal termination only for a `running` session without requiring an input lease. An existing same-level request returns its original `stopOperationId`. `app.terminal.session.force_stop` requires `session.forceStop` and may target `running` directly or explicitly upgrade `stopping`; an upgrade creates a new `forceOperationId` linked to the original stop operation.

Termination operation state is persisted separately from session lifecycle as `pending_delivery`, `delivered`, `delivery_uncertain`, `completed`, or `failed`. Only confirmed platform delivery moves the session to `stopping`. Actual transition to `ended`, `failed`, or `lost` completes the operation, and the completed result carries `finalLifecycle`, `finalCause`, and applicable termination facts rather than hiding their distinction.

Delivery uncertainty never causes automatic replay. A later normal stop returns the original uncertain operation; only an explicit force operation may take a stronger path. Calling either stop mode for an already `ended`, `failed`, or `lost` session returns `terminal_noop` with the existing final facts and creates no misleading new termination operation.

Operation changes advance `stateRevision` and appear through observation with their correlation identities. `app.terminal.operation.get` requires current `state.read` authorization over the original resource before object lookup and returns redacted operation state, timestamps, linked operations, error, and current lifecycle. An operation id alone cannot probe resource existence.

Crash and restart recovery has explicit rules for reconciling `pending_delivery` and `delivered` operations with `delivery_uncertain`, `completed`, and `lost`. Recovery never retransmits a platform termination action. Necessary operation records remain with session metadata. After deletion, query results and idempotency tombstones exist only for a documented bounded window. Revoking authorization does not cancel a request already sent; it affects later reads and operations.
