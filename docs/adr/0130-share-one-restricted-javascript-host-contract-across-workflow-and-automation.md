# Share one restricted JavaScript host contract across Workflow and Automation

Status: deprecated; replaced by accepted ADR-0204

Workflow nodes and Automation Actions use one versioned restricted JavaScript host contract for ECMAScript semantics, global APIs, input and output, limits, cancellation acceptance, and error classification. The two entry points may adapt configuration, lifecycle, and trusted execution context, but cannot change script semantics or host APIs; dynamic network effects are brokered and authorized per resolved target rather than covered by one pre-execution permission check.
