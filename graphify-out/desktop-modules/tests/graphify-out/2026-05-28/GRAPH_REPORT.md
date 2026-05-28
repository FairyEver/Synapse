# Graph Report - desktop/tests  (2026-05-28)

## Corpus Check
- Corpus is ~7,466 words - fits in a single context window. You may not need a graph.

## Summary
- 156 nodes · 137 edges · 21 communities (17 shown, 4 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_unit  phase-0.2-integration.test.ts|unit / phase-0.2-integration.test.ts]]
- [[_COMMUNITY_unit  api-mcp-capability-surface.test.ts|unit / api-mcp-capability-surface.test.ts]]
- [[_COMMUNITY_unit  phase-0.6-integration.test.ts|unit / phase-0.6-integration.test.ts]]
- [[_COMMUNITY_unit  phase-0.3-integration.test.ts|unit / phase-0.3-integration.test.ts]]
- [[_COMMUNITY_unit  phase-0.4-integration.test.ts|unit / phase-0.4-integration.test.ts]]
- [[_COMMUNITY_unit  phase-0.1-integration.test.ts|unit / phase-0.1-integration.test.ts]]
- [[_COMMUNITY_unit  synapse-capabilities.test.ts|unit / synapse-capabilities.test.ts]]
- [[_COMMUNITY_unit  phase-0.5-integration.test.ts|unit / phase-0.5-integration.test.ts]]
- [[_COMMUNITY_fixtures  runtime.ts|fixtures / runtime.ts]]
- [[_COMMUNITY_unit  database-capability-parity.test.ts|unit / database-capability-parity.test.ts]]
- [[_COMMUNITY_unit  database-log-list.test.ts|unit / database-log-list.test.ts]]
- [[_COMMUNITY_unit  database-mcp-rpc.test.ts|unit / database-mcp-rpc.test.ts]]
- [[_COMMUNITY_unit  database-mcp-tools.test.ts|unit / database-mcp-tools.test.ts]]
- [[_COMMUNITY_unit  database-dry-run.test.ts|unit / database-dry-run.test.ts]]
- [[_COMMUNITY_unit  database-sql-read.test.ts|unit / database-sql-read.test.ts]]
- [[_COMMUNITY_unit  mcp-scheduler-tools.test.ts|unit / mcp-scheduler-tools.test.ts]]
- [[_COMMUNITY_unit  database-overview.test.ts|unit / database-overview.test.ts]]

## God Nodes (most connected - your core abstractions)
1. `getTool()` - 2 edges
2. `getPropertyDescription()` - 2 edges
3. `createRuntimeFixture()` - 2 edges
4. `electronMock` - 1 edges
5. `result` - 1 edges
6. `electronMock` - 1 edges
7. `preview` - 1 edges
8. `registryActions` - 1 edges
9. `toolNames` - 1 edges
10. `mappedToolNames` - 1 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Communities (21 total, 4 thin omitted)

### Community 0 - "unit / phase-0.2-integration.test.ts"
Cohesion: 0.09
Nodes (19): auditNs, auditNs2, configNs, configNs2, convNs, convNs2, db, db2 (+11 more)

### Community 1 - "unit / api-mcp-capability-surface.test.ts"
Cohesion: 0.11
Nodes (15): actionIds, dispatchers, docsMatrix, domain, expectedToolNames, mappedActionIds, mappedToolNames, offenders (+7 more)

### Community 2 - "unit / phase-0.6-integration.test.ts"
Cohesion: 0.14
Nodes (13): agentStarts, audit, breaker, diag, guard, health, limiter, logger (+5 more)

### Community 3 - "unit / phase-0.3-integration.test.ts"
Cohesion: 0.17
Nodes (9): a, b, ctx, electronDir, harness, manager, reg, sent (+1 more)

### Community 4 - "unit / phase-0.4-integration.test.ts"
Cohesion: 0.17
Nodes (9): a, b, broadcaster, bus, evt, manager, proj1Window, proj2Window (+1 more)

### Community 5 - "unit / phase-0.1-integration.test.ts"
Cohesion: 0.20
Nodes (6): afterStop, inspected, order, registry, stage, t0

### Community 6 - "unit / synapse-capabilities.test.ts"
Cohesion: 0.20
Nodes (8): actions, create, getTool, listTool, toolNames, tools, update, updateDefinition

### Community 7 - "unit / phase-0.5-integration.test.ts"
Cohesion: 0.22
Nodes (8): agentService, container, dataRepo, eventBus, reaper, registry, runtime, virtualNow

### Community 8 - "fixtures / runtime.ts"
Cohesion: 0.29
Nodes (6): createRuntimeFixture(), RuntimeFixture, testLogger, { eventBus }, fixture, seen

### Community 9 - "unit / database-capability-parity.test.ts"
Cohesion: 0.29
Nodes (5): mappedActions, mappedToolNames, registryActions, registryToolNames, toolNames

### Community 10 - "unit / database-log-list.test.ts"
Cohesion: 0.33
Nodes (3): auditSink, electronMock, permissionGuard

### Community 11 - "unit / database-mcp-rpc.test.ts"
Cohesion: 0.33
Nodes (4): folders, identity, status, summaries

### Community 12 - "unit / database-mcp-tools.test.ts"
Cohesion: 0.40
Nodes (5): getPropertyDescription(), getTool(), names, tableDescription, where

## Knowledge Gaps
- **114 isolated node(s):** `electronMock`, `result`, `electronMock`, `preview`, `registryActions` (+109 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What connects `electronMock`, `result`, `electronMock` to the rest of the system?**
  _114 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `unit / phase-0.2-integration.test.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._
- **Should `unit / api-mcp-capability-surface.test.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10526315789473684 - nodes in this community are weakly interconnected._
- **Should `unit / phase-0.6-integration.test.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._