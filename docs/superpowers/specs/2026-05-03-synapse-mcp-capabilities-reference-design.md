# Synapse MCP Capabilities Reference Design

## Context

Synapse now exposes local agent-facing capabilities through a shared surface that covers MCP tools, CLI commands, HTTP actions, and service methods. Current capability naming has already been consolidated around canonical ids such as `database.table.list` and `scheduler.task.create`, and `docs/reference/capability-naming-matrix.md` records the current matrix.

The next documentation task is to turn that matrix into part of an internal authoritative reference. The reference should help maintainers understand what capabilities exist today, how public names are derived, and how future capabilities or domains should be added without creating another naming system.

## Goals

- Create an internal reference for Synapse MCP capabilities.
- Keep the reference focused on current canonical names only.
- Cover current Database and Scheduler capabilities.
- Define rules for adding capabilities inside an existing domain.
- Define generic rules for adding a future capability domain.
- Include practical examples for MCP tools, CLI commands, and HTTP actions.
- Record the intended long-term maintenance model: hand-written explanations plus generated or checked matrices.

## Non-Goals

- No end-user marketing or product overview.
- No migration guide or historical-name appendix.
- No concrete design for future domain resources.
- No implementation of matrix generation or validation in this design phase.
- No changes to desktop runtime, MCP behavior, CLI behavior, or service behavior.

## Audience

The primary reader is a Synapse maintainer who needs to modify, review, or extend local capabilities.

Secondary readers are contributors who need a compact map of how a capability moves across:

```text
capability manifest
  -> HTTP action
  -> MCP tool
  -> CLI command
  -> service method
```

## Documentation Structure

Use three reference surfaces.

### Capabilities Overview

Proposed file:

```text
docs/reference/synapse-mcp-capabilities.md
```

This is the entry point. It should explain:

- What a Synapse capability is.
- What surfaces expose a capability.
- The canonical id format: `<domain>.<resource>.<action>`.
- The relationship between canonical ids, MCP tool names, CLI command paths, and service methods.
- The currently supported domains: Database and Scheduler.
- The rule that future domains must define ownership, dispatch, public naming, and tests before exposure.

This page should link to the matrix and authoring guide instead of duplicating their details.

### Capability Matrix

Existing file:

```text
docs/reference/capability-naming-matrix.md
```

This remains the current capability table. It should list current canonical names only.

Required columns:

- Capability id
- MCP tool
- CLI command
- Service method

Optional future columns can be added if useful:

- Mutates
- Risk
- Domain
- Source manifest item

The matrix should not list historical names.

### Capability Authoring Guide

Proposed file:

```text
docs/reference/capability-authoring.md
```

This is the maintainer workflow page. It should cover:

- Adding a capability to an existing domain.
- Adding a future domain.
- Choosing resource and action names.
- Defining MCP input schemas.
- Deriving CLI paths and flags.
- Routing through the domain dispatcher.
- Keeping public JSON fields camelCase.
- Writing tests and updating the reference matrix.
- Reviewing whether the capability mutates data or executes high-risk work.

## Content Boundaries

The reference must stay factual and current.

- Describe only current Database and Scheduler capabilities in the matrix.
- Use only canonical public names.
- Keep examples small and representative.
- Do not list old names, aliases, or migration mappings.
- Do not promise future domains or future resources.
- Do not use the reference as a roadmap.

If implementation and documentation disagree, the code manifest is the source of truth and the documentation should be corrected.

## Example Strategy

Examples should be executable in spirit but compact. They should teach the naming pattern and data shape without becoming a full user tutorial.

Each current domain should get one or two examples.

Recommended examples:

- Database table listing through MCP, CLI, and HTTP action.
- Database row creation through MCP or CLI.
- Scheduler task listing through MCP, CLI, and HTTP action.
- Scheduler task enable or run-list through MCP or CLI.

Examples should show canonical names only, for example:

```text
database.table.list
database_table_list
synapse database table list
databaseTableList
```

```text
scheduler.task.list
scheduler_task_list
synapse scheduler task list
schedulerTaskList
```

The authoring guide can include fuller payload examples when they clarify schema rules, especially for filters, row data, schedule config, and action config.

## Naming Rules

Canonical capability ids use:

```text
<domain>.<resource>.<action>
```

Rules:

- Use complete English words for domain and resource names.
- Use `database` for the Database domain.
- Use `scheduler` for the Scheduler domain.
- Use singular resource names unless plural form changes meaning.
- Use snake_case only inside a multi-word token.
- Use controlled action words where possible.
- Use `execute` only for capabilities that run SQL, commands, scripts, or similar high-risk work.

Derived public names:

```text
database.table.list
  -> database_table_list
  -> synapse database table list
  -> databaseTableList
```

```text
scheduler.runtime.inspect
  -> scheduler_runtime_inspect
  -> synapse scheduler runtime inspect
  -> schedulerRuntimeInspect
```

Public JSON fields should use camelCase. CLI flags should use kebab-case.

## Adding A Capability To An Existing Domain

The authoring guide should require maintainers to:

1. Add or update the domain manifest item.
2. Confirm the canonical id follows `<domain>.<resource>.<action>`.
3. Confirm derived MCP, CLI, and service names match the naming helpers or matrix.
4. Define the input schema and mutation/risk metadata.
5. Implement service and dispatcher handling inside the owning domain.
6. Expose the MCP tool through the shared capability surface.
7. Expose the CLI command path if the capability is meant to be public through CLI.
8. Add or update tests for manifest derivation, dispatcher routing, MCP schema, CLI parsing, and service behavior as appropriate.
9. Update or regenerate the reference matrix.

The guide should tell maintainers to keep Database behavior in the Database domain and Scheduler behavior in the Scheduler domain.

## Adding A Future Domain

The authoring guide should describe the generic checklist without inventing future domain-specific resources.

A future domain must define:

- Domain id.
- Domain manifest.
- Domain dispatcher.
- Service ownership.
- MCP tool generation or registration path.
- CLI command namespace if CLI exposure is required.
- HTTP action routing.
- Result normalization rules.
- Permission or audit requirements if the domain touches sensitive operations.
- Tests proving domain isolation and public name derivation.

The guide should make domain isolation explicit: one domain should not import another domain's business internals.

## Drift Prevention

The desired maintenance model is:

```text
hand-written explanations
  + generated or checked capability matrix
```

This design does not require implementing generation immediately. It records the intended direction so the implementation plan can choose the smallest practical first step.

Acceptable first implementation choices:

- Keep the matrix hand-written and audit it against the manifest.
- Add a script or test that compares the matrix to the manifest.
- Generate the matrix from the manifest and require generated output to be committed.

The final reference should state that the manifest is the source of truth and the matrix must not become a second independent authority.

## Validation

The implementation should verify:

- Reference pages contain only current canonical public names.
- Matrix rows match current Database and Scheduler capabilities.
- Examples use canonical capability ids, MCP tools, CLI commands, and service methods.
- No historical capability names appear in the new reference pages.
- The authoring guide covers existing-domain additions and future-domain additions.
- The documentation does not promise concrete future domains or resources.

## Source References

Use these files as the minimum source set during implementation:

- `docs/reference/capability-naming-matrix.md`
- `docs/superpowers/specs/2026-05-03-capability-naming-unification-design.md`
- `docs/superpowers/specs/2026-05-02-synapse-mcp-scheduler-tools-design.md`
- `docs/superpowers/specs/2026-05-02-scheduler-mcp-external-capabilities-design.md`
- `desktop/synapse-capabilities/shared/registry.ts`
- `desktop/synapse-capabilities/shared/naming.ts`
- `desktop/synapse-capabilities/shared/scheduler-domain.ts`
- `desktop/database/shared/capability-registry.ts`
- `desktop/database/shared/mcp-tools.ts`
- `desktop/database/cli/database.ts`
- `desktop/database/cli/scheduler.ts`
- `desktop/electron/capabilities/action-router.ts`
- `desktop/tests/unit/capability-naming.test.ts`
- `desktop/tests/unit/synapse-capabilities.test.ts`
- `desktop/tests/unit/database-capability-parity.test.ts`
- `desktop/tests/unit/database-mcp-tools.test.ts`
- `desktop/tests/unit/cli-database.test.ts`
- `desktop/tests/unit/cli-scheduler.test.ts`
