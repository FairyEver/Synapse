# Use a low-frequency domain revision for Terminal structural events

`terminalDomainRevision` is a global monotonic persistent position for low-frequency Terminal structure: groups, commands, session identities and memberships, low-frequency metadata, and the queryable operation collection. It does not advance for each PTY output block. Output uses per-session `outputSeq`; lifecycle, attention, lease, size, and other session state use `stateRevision` and their dedicated revisions.

Authorization belongs to Synapse's shared security domain and is neither stored in Terminal data nor coupled to `terminalDomainRevision`. A shared security or authorization revision or revocation event triggers permission recomputation, lease invalidation, and observation cancellation. Terminal may publish resulting state changes but does not own the grant fact.

After structural state is durably committed, core publishes a body-free event containing `domainRevision`, event type, object identity and revision, occurrence time, source, and operation identity. Output and session-state notifications carry only `sessionId` plus watermarks or ranges; consumers retrieve bodies or snapshots through authorized interfaces.

UI, IPC, and MCP mutations call the same core service and produce the same event semantics. Initial collection snapshots return their corresponding `domainRevision`, closing the list-then-listen race. A Renderer applies consecutive events, idempotently merges its own operation response with the same-revision event, and performs bounded list/get resynchronization after a gap, reconnect, or recovery. Events are invalidation notifications rather than persisted authority.

Publication failure does not roll back committed data; a later revision or reconnect makes the gap discoverable. Initial MCP continues to use bounded observe, list, and get. A future domain subscription reuses these revision and watermark contracts and never becomes an unbounded body stream.
