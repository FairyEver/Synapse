# Add order-only, non-propagating dependency edges to ServiceRegistry

## Context

System Notifier must register its `core.system-notifier` facade independently so its MCP and Workflow fixed-success surface remains available when ordinary infrastructure fails. Its bootstrap integration should nevertheless give an available DataRepository and AuditSink a chance to start before it initializes that same facade. Making either port a hard dependency would skip the integration after a degraded port failure and could remove the initialized capability surface.

Service registration order cannot express this requirement. Registration is inventory construction; ServiceRegistry derives lifecycle order from its dependency graph.

## Decision

`ServiceDescriptor.startAfter` is a public order-only dependency edge. Both `dependsOn` and `startAfter` require the target service to be registered and place that target before the declaring service in the topological start order. They differ only in startup-failure propagation:

- `dependsOn` is a hard edge. If its target fails or is skipped, the declaring service is skipped under the existing degraded/fatal rules.
- `startAfter` is an order-only edge. If its target starts and is `running`, the declaring service may read it from the registry. If a target referenced only through `startAfter` has a degraded startup failure or was skipped, the declaring service still runs its own `create` and `start` hooks and must select its own degraded or fail-closed behavior.
- A fatal service failure still aborts global startup immediately. `startAfter` does not weaken that registry-wide rule.

The combined graph has these semantics:

- An unknown target in either edge type throws `UnknownDependencyError`.
- Hard and order-only edges participate in one topological sort, so a cycle composed of either or both edge types throws `CircularDependencyError`.
- If one target appears in both `dependsOn` and `startAfter`, the topological edge is deduplicated. The declared hard edge remains in `dependsOn`, so failure still propagates.
- `inspect()` exposes `dependsOn` and `startAfter` separately as declared public metadata.
- Shutdown uses the reverse of the combined topological order. A `startAfter` target therefore stops after the service that declared the edge, just like a hard-dependency target.

The authoritative implementation is in [`types.ts`](../../desktop/electron/runtime/service-registry/types.ts), [`topo.ts`](../../desktop/electron/runtime/service-registry/topo.ts), and [`registry.ts`](../../desktop/electron/runtime/service-registry/registry.ts).

## System Notifier application

`core.system-notifier.integration` has a hard `dependsOn` edge to the dependency-free `core.system-notifier` facade and order-only `startAfter` edges to `core.data-repository` and `core.audit-sink`. It attaches whichever ordinary ports are `running`, then initializes the same facade with missing ports represented as unavailable so the facade can degrade or fail closed without disappearing.

`core.database` and `core.workflow.engine` have hard `dependsOn` edges to `core.system-notifier.integration`. That integration service is the initialization barrier: Database cannot publish the MCP dispatcher and Workflow cannot expose the node executor before the facade has completed initialization.

## Boundaries

`startAfter` is not a readiness or health subscription, runtime reconnection, retry policy, optional service locator, dynamic dependency, concurrent-start primitive, or second-phase work queue. It creates one static lifecycle edge evaluated during graph validation, sequential startup, and reverse-topological shutdown. A service that needs later recovery or reattachment must define that behavior separately.

## Consequences and test obligations

ServiceRegistry now has two public dependency edge types and every new use must choose failure semantics explicitly. Registry coverage must verify order-only sorting, non-propagation after a degraded failed or skipped target, unknown-target rejection, mixed hard/order-only cycles, duplicate-edge hard-failure preservation, separate `inspect()` output, and reverse stop order. Fatal startup and hard-dependency propagation coverage remains mandatory.

System Notifier bootstrap coverage must keep the facade dependency-free, verify that integration starts after DataRepository and AuditSink, verify initialization with available and unavailable ordinary ports, and verify that Database and Workflow Engine hard-depend on the integration barrier. Current coverage is located in the ServiceRegistry [`registry tests`](../../desktop/electron/runtime/service-registry/__tests__/registry.test.ts), [`lifecycle tests`](../../desktop/electron/runtime/service-registry/__tests__/lifecycle.test.ts), and bootstrap [`descriptor tests`](../../desktop/electron/bootstrap/__tests__/descriptors.test.ts) and [`registry tests`](../../desktop/electron/bootstrap/__tests__/registry.test.ts).

## Rejected alternatives

- Depend on descriptor registration order: registration order is not the lifecycle contract and is invalidated by topological planning.
- Make DataRepository and AuditSink hard dependencies: a degraded ordinary-port failure would skip integration instead of initializing the stable facade in its own degraded state.
- Let Database, Workflow, MCP, IPC, or other consumers call `initialize` themselves: this duplicates lifecycle ownership, permits observation before initialization, and risks initializing different paths inconsistently.
- Poll, retry, or delay reattachment: V1 requires one deterministic startup barrier, not a background readiness protocol or deferred second phase.
