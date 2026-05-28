# Graph Report - desktop/action-packages  (2026-05-28)

## Corpus Check
- Corpus is ~8,751 words - fits in a single context window. You may not need a graph.

## Summary
- 130 nodes · 210 edges · 13 communities
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_builtin  http-request|builtin / http-request]]
- [[_COMMUNITY_builtin  agent|builtin / agent]]
- [[_COMMUNITY_builtin  http-request|builtin / http-request]]
- [[_COMMUNITY_types.ts  builtin|types.ts / builtin]]
- [[_COMMUNITY_builtin  script|builtin / script]]
- [[_COMMUNITY_builtin  config.renderer.tsx|builtin / config.renderer.tsx]]
- [[_COMMUNITY_builtin  command|builtin / command]]
- [[_COMMUNITY_builtin  agent|builtin / agent]]
- [[_COMMUNITY_shared  cost-currency.ts|shared / cost-currency.ts]]

## God Nodes (most connected - your core abstractions)
1. `HttpRequestActionConfig` - 7 edges
2. `stringifyRecordText()` - 6 edges
3. `AgentActionConfig` - 6 edges
4. `ScriptActionConfig` - 6 edges
5. `CommandActionConfig` - 6 edges
6. `ActionManifest` - 5 edges
7. `agentActionConfigSchema` - 5 edges
8. `parseRecordText()` - 4 edges
9. `resolveSynapseCostCny()` - 4 edges
10. `scriptActionConfigSchema` - 4 edges

## Surprising Connections (you probably didn't know these)
- `CommandConfigForm()` --calls--> `stringifyRecordText()`  [EXTRACTED]
  builtin/command/config.renderer.tsx → records.ts
- `ScriptConfigForm()` --calls--> `stringifyRecordText()`  [EXTRACTED]
  builtin/script/config.renderer.tsx → records.ts

## Communities (13 total, 0 thin omitted)

### Community 0 - "builtin / http-request"
Cohesion: 0.11
Nodes (15): AUTH_TYPE_OPTIONS, AuthConfig, AuthFields(), AuthFieldsProps, CodeJsonEditor(), CodeJsonEditorProps, useIsDarkMode(), BODY_TYPE_OPTIONS (+7 more)

### Community 1 - "builtin / agent"
Cohesion: 0.19
Nodes (10): TIER_LABELS, AgentActionConfig, agentActionConfigSchema, agentPermissionModeSet, modelTierSet, validateAgentStoredConfig(), agentTypeField, result (+2 more)

### Community 2 - "builtin / http-request"
Cohesion: 0.22
Nodes (6): action, request, createHttpRequestAction(), HttpRequestActionConfig, httpRequestActionConfigSchema, sendRequest

### Community 3 - "types.ts / builtin"
Cohesion: 0.17
Nodes (11): ActionConfig, ActionConfigFieldDescriptor, ActionConfigFieldKind, ActionPermissionName, ActionRunLog, ActionRunMetrics, ActionRunResult, ActionRunStatus (+3 more)

### Community 4 - "builtin / script"
Cohesion: 0.29
Nodes (7): ActionManifest, action, run, runShellAction(), createScriptAction(), ScriptActionConfig, scriptActionConfigSchema

### Community 5 - "builtin / config.renderer.tsx"
Cohesion: 0.29
Nodes (8): parseRecordText(), stringifyRecordText(), CommandConfigForm(), PATH_STRATEGY_OPTIONS, SHELL_OPTIONS, PATH_STRATEGY_OPTIONS, ScriptConfigForm(), SHELL_OPTIONS

### Community 6 - "builtin / command"
Cohesion: 0.33
Nodes (6): action, request, run, createCommandAction(), CommandActionConfig, commandActionConfigSchema

### Community 7 - "builtin / agent"
Cohesion: 0.25
Nodes (5): createAgentAction(), logger, action, controller, runtime

### Community 8 - "shared / cost-currency.ts"
Cohesion: 0.42
Nodes (7): costFormatter, formatSynapseCost(), normalizeCostCny(), resolveSynapseCostCny(), SYNAPSE_COST_CURRENCY, SynapseCostCurrency, usdToCny()

## Knowledge Gaps
- **43 isolated node(s):** `ActionRunStatus`, `ActionRunLog`, `ActionRunMetrics`, `ActionConfig`, `ActionStoredConfigIssue` (+38 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ActionManifest` connect `builtin / script` to `builtin / agent`, `builtin / http-request`, `types.ts / builtin`, `builtin / command`?**
  _High betweenness centrality (0.136) - this node is a cross-community bridge._
- **Why does `HttpRequestActionConfig` connect `builtin / http-request` to `builtin / http-request`?**
  _High betweenness centrality (0.132) - this node is a cross-community bridge._
- **Why does `CommandActionConfig` connect `builtin / command` to `builtin / config.renderer.tsx`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **What connects `ActionRunStatus`, `ActionRunLog`, `ActionRunMetrics` to the rest of the system?**
  _43 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `builtin / http-request` be split into smaller, more focused modules?**
  _Cohesion score 0.10507246376811594 - nodes in this community are weakly interconnected._