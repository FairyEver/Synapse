# Graph Report - desktop/synapse-capabilities  (2026-05-28)

## Corpus Check
- Corpus is ~5,880 words - fits in a single context window. You may not need a graph.

## Summary
- 83 nodes · 162 edges · 6 communities
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_variable-domain.ts  types.ts|variable-domain.ts / types.ts]]
- [[_COMMUNITY_model-price-domain.ts  registry.ts|model-price-domain.ts / registry.ts]]
- [[_COMMUNITY_content-domain.ts|content-domain.ts]]
- [[_COMMUNITY_scheduler-domain.ts|scheduler-domain.ts]]
- [[_COMMUNITY_naming.ts|naming.ts]]
- [[_COMMUNITY_workflow-domain.ts  types.ts|workflow-domain.ts / types.ts]]

## God Nodes (most connected - your core abstractions)
1. `McpToolDefinition` - 8 edges
2. `CapabilityDomainDefinition` - 8 edges
3. `buildAllMcpTools()` - 7 edges
4. `CapabilityId` - 7 edges
5. `capabilityIdToMcpTool()` - 7 edges
6. `CapabilityDefinition` - 6 edges
7. `splitCapabilityId()` - 5 edges
8. `stringField()` - 5 edges
9. `buildModelPriceTools()` - 4 edges
10. `isCanonicalCapabilityId()` - 4 edges

## Surprising Connections (you probably didn't know these)
- `buildAllMcpTools()` --calls--> `buildModelPriceTools()`  [EXTRACTED]
  registry.ts → model-price-domain.ts
- `buildAllMcpTools()` --calls--> `buildWorkflowTools()`  [EXTRACTED]
  registry.ts → workflow-domain.ts
- `buildAllMcpTools()` --calls--> `buildRepositoryTools()`  [EXTRACTED]
  registry.ts → repository-domain.ts
- `buildAllMcpTools()` --calls--> `buildSchedulerTools()`  [EXTRACTED]
  registry.ts → scheduler-domain.ts
- `buildAllMcpTools()` --calls--> `buildContentTools()`  [EXTRACTED]
  registry.ts → content-domain.ts

## Communities (6 total, 0 thin omitted)

### Community 0 - "variable-domain.ts / types.ts"
Cohesion: 0.14
Nodes (17): CapabilityId, capabilityIdToMcpTool(), REPOSITORY_DOMAIN, REPOSITORY_MCP_TOOL_ACTIONS, repositoryCapabilities, CapabilityDefinition, DispatchContext, DispatchResult (+9 more)

### Community 1 - "model-price-domain.ts / registry.ts"
Cohesion: 0.18
Nodes (16): buildContentTools(), buildModelPriceTools(), MODEL_PRICE_DOMAIN, MODEL_PRICE_MCP_TOOL_ACTIONS, modelPriceCapabilities, priceProperty(), ruleIdProperty, buildAllMcpTools() (+8 more)

### Community 2 - "content-domain.ts"
Cohesion: 0.20
Nodes (12): baseCreateProperties, CONTENT_DOMAIN, CONTENT_MCP_TOOL_ACTIONS, contentCapabilities, ContentResourceType, createTool(), deleteTool(), getTool() (+4 more)

### Community 3 - "scheduler-domain.ts"
Cohesion: 0.17
Nodes (11): SCHEDULER_DOMAIN, SCHEDULER_MCP_TOOL_ACTIONS, schedulerCapabilities, SchedulerSchedule, SchedulerTaskCreateParams, SchedulerTaskIdParams, SchedulerTaskListParams, SchedulerTaskRunsListParams (+3 more)

### Community 4 - "naming.ts"
Cohesion: 0.29
Nodes (9): assertCanonicalCapabilityId(), CAPABILITY_ACTIONS, CapabilityAction, capabilityIdToServiceMethod(), getCapabilityAction(), getCapabilityDomain(), isCanonicalCapabilityId(), isKnownAction() (+1 more)

### Community 5 - "workflow-domain.ts / types.ts"
Cohesion: 0.25
Nodes (7): CapabilityDomainDefinition, modelTierSchema, variableBindingSchema, WORKFLOW_DOMAIN, WORKFLOW_MCP_TOOL_ACTIONS, workflowCapabilities, workflowDefinitionSchema

## Knowledge Gaps
- **33 isolated node(s):** `ruleIdProperty`, `modelPriceCapabilities`, `workflowCapabilities`, `modelTierSchema`, `variableBindingSchema` (+28 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `McpToolDefinition` connect `variable-domain.ts / types.ts` to `model-price-domain.ts / registry.ts`, `content-domain.ts`, `scheduler-domain.ts`, `workflow-domain.ts / types.ts`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Why does `CapabilityDomainDefinition` connect `workflow-domain.ts / types.ts` to `variable-domain.ts / types.ts`, `model-price-domain.ts / registry.ts`, `content-domain.ts`, `scheduler-domain.ts`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Why does `capabilityIdToMcpTool()` connect `variable-domain.ts / types.ts` to `model-price-domain.ts / registry.ts`, `content-domain.ts`, `scheduler-domain.ts`, `naming.ts`, `workflow-domain.ts / types.ts`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **What connects `ruleIdProperty`, `modelPriceCapabilities`, `workflowCapabilities` to the rest of the system?**
  _33 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `variable-domain.ts / types.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.1368421052631579 - nodes in this community are weakly interconnected._