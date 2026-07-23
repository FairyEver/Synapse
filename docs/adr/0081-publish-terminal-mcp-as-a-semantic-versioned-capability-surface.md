# Publish Terminal MCP as a semantic versioned capability surface

The initial Terminal MCP surface is the complete capability inventory in `docs/superpowers/specs/2026-07-22-terminal-mcp-control-design.md`. Every identity has the exact form `app.terminal.<subdomain>.<action>`, and its MCP tool name is the capability id with dots replaced by underscores. Capability identity, tool name, schema, permissions, risk, contract and capability versions, support state, and deprecation metadata come from one source and are validated together.

The surface separates discovery, state, sensitive metadata, raw output, rendered views, control leases, semantic input, raw input, resize, creation, management, termination, operations, and deletion. It contains no generic `shell.exec`, `terminal.execute`, permission-crossing mode switch, automatic force escalation, MCP takeover of the user, session movement, or unbounded subscription.

`session_input.command` is only a single control-free text action followed by Enter and shares lease, expected-input-revision, idempotency, delivery-outcome, and audit semantics with semantic input. It rejects multiline content and is not a second shell execution model. Legacy tools use bounded adapters and a machine-negotiated contract version; absent or old version selection cannot silently opt an old client into new or broader semantics.

The consolidated design is the implementation and review baseline. It includes scope, gates, migration, backup, encryption, three-platform acceptance, documentation synchronization, and non-goals. No implementation begins until Li Yang or the explicitly authorized supervisor confirms that consensus and authorizes implementation.
