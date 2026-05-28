# Graph Report - desktop/workflow-nodes  (2026-05-28)

## Corpus Check
- Corpus is ~15,513 words - fits in a single context window. You may not need a graph.

## Summary
- 251 nodes · 557 edges · 10 communities
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_panel.tsx  file-conversion|panel.tsx / file-conversion]]
- [[_COMMUNITY_end  __tests__|end / __tests__]]
- [[_COMMUNITY_file-conversion  executor.main.ts|file-conversion / executor.main.ts]]
- [[_COMMUNITY_http-request  __tests__|http-request / __tests__]]
- [[_COMMUNITY_script  __tests__|script / __tests__]]
- [[_COMMUNITY_switch  __tests__|switch / __tests__]]
- [[_COMMUNITY_prompt  __tests__|prompt / __tests__]]
- [[_COMMUNITY_prompt-shortcuts.ts  prompt-editor.tsx|prompt-shortcuts.ts / prompt-editor.tsx]]
- [[_COMMUNITY___tests__  provider-settings-panel.test.ts|__tests__ / provider-settings-panel.test.ts]]
- [[_COMMUNITY_card.tsx  node-status-utils.ts|card.tsx / node-status-utils.ts]]

## God Nodes (most connected - your core abstractions)
1. `statusClass()` - 13 edges
2. `NodeManifest` - 12 edges
3. `NodeExecutor` - 11 edges
4. `NodeExecutionInput` - 10 edges
5. `useProviderLookup()` - 9 edges
6. `NodeTypeRegistry` - 9 edges
7. `variableBindingSchema` - 8 edges
8. `ScriptNodeConfig` - 8 edges
9. `EndNodeConfig` - 8 edges
10. `HttpRequestNodeConfig` - 8 edges

## Surprising Connections (you probably didn't know these)
- `EndNodeCard()` --calls--> `statusClass()`  [EXTRACTED]
  end/card.tsx → node-status-utils.ts
- `FileConversionNodeCard()` --calls--> `statusClass()`  [EXTRACTED]
  file-conversion/card.tsx → node-status-utils.ts
- `HttpRequestNodeCard()` --calls--> `statusClass()`  [EXTRACTED]
  http-request/card.tsx → node-status-utils.ts
- `PromptNodeCard()` --calls--> `statusClass()`  [EXTRACTED]
  prompt/card.tsx → node-status-utils.ts
- `ScriptNodeCard()` --calls--> `statusClass()`  [EXTRACTED]
  script/card.tsx → node-status-utils.ts

## Communities (10 total, 0 thin omitted)

### Community 0 - "panel.tsx / file-conversion"
Cohesion: 0.07
Nodes (29): EndNodePanel(), FileConversionNodePanel(), FileConversionNodePanelProps, logger, OUTPUT_LABELS, HttpRequestNodePanel(), PromptNodeCard(), PromptNodePanel() (+21 more)

### Community 1 - "end / __tests__"
Cohesion: 0.11
Nodes (20): endNodeExecutor, logger, endNodeManifest, EndNodePanelProps, EndNodeConfig, endNodeConfigSchema, logger, payload (+12 more)

### Community 2 - "file-conversion / executor.main.ts"
Cohesion: 0.13
Nodes (13): fileConversionNodeExecutor, logger, markdownFileName(), resolveMarkdownOutputPath(), WorkflowFileConversionFailureCode, fileConversionNodeManifest, isWorkflowFileConversionOutputPathAllowed(), WORKFLOW_FILE_CONVERSION_OUTPUT_ROOT (+5 more)

### Community 3 - "http-request / __tests__"
Cohesion: 0.14
Nodes (12): httpRequestNodeExecutor, logger, httpRequestNodeManifest, HttpRequestNodePanelProps, HttpRequestNodeConfig, httpRequestNodeConfigSchema, ctx, deps (+4 more)

### Community 4 - "script / __tests__"
Cohesion: 0.13
Nodes (15): variableSourceSchema, logger, PROTECTED_ENV_NAMES, scriptNodeExecutor, scriptNodeManifest, ScriptNodePanelProps, ScriptNodeConfig, scriptNodeConfigSchema (+7 more)

### Community 5 - "switch / __tests__"
Cohesion: 0.13
Nodes (17): logger, matchBranch(), normalizeResponse(), switchNodeExecutor, switchNodeManifest, SwitchNodePanelProps, SwitchBranch, switchBranchSchema (+9 more)

### Community 6 - "prompt / __tests__"
Cohesion: 0.15
Nodes (13): logger, promptNodeExecutor, promptNodeManifest, PromptNodePanelProps, PromptNodeConfig, promptNodeConfigSchema, ctx, logger (+5 more)

### Community 7 - "prompt-shortcuts.ts / prompt-editor.tsx"
Cohesion: 0.18
Nodes (16): VariableBinding, variableBindingSchema, options, scan, logger, PromptEditorProps, useClaudeCodeGlobalSkillNames(), buildPromptShortcutOptions() (+8 more)

### Community 8 - "__tests__ / provider-settings-panel.test.ts"
Cohesion: 0.12
Nodes (12): button, checkbox, container, keyInput, onChange, providerLookup, roots, textarea (+4 more)

### Community 9 - "card.tsx / node-status-utils.ts"
Cohesion: 0.40
Nodes (6): EndNodeCard(), FileConversionNodeCard(), HttpRequestNodeCard(), ScriptNodeCard(), NodeStatus, statusClass()

## Knowledge Gaps
- **73 isolated node(s):** `logger`, `defaultLookup`, `VariableBindingRowProps`, `VariableBindingEditorProps`, `NodePanelProps` (+68 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `NodeExecutionInput` connect `end / __tests__` to `file-conversion / executor.main.ts`, `http-request / __tests__`, `script / __tests__`, `switch / __tests__`, `prompt / __tests__`?**
  _High betweenness centrality (0.047) - this node is a cross-community bridge._
- **Why does `NodeExecutor` connect `end / __tests__` to `file-conversion / executor.main.ts`, `http-request / __tests__`, `script / __tests__`, `switch / __tests__`, `prompt / __tests__`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Why does `NodeManifest` connect `end / __tests__` to `file-conversion / executor.main.ts`, `http-request / __tests__`, `script / __tests__`, `switch / __tests__`, `prompt / __tests__`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **What connects `logger`, `defaultLookup`, `VariableBindingRowProps` to the rest of the system?**
  _73 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `panel.tsx / file-conversion` be split into smaller, more focused modules?**
  _Cohesion score 0.07474747474747474 - nodes in this community are weakly interconnected._
- **Should `end / __tests__` be split into smaller, more focused modules?**
  _Cohesion score 0.11092436974789915 - nodes in this community are weakly interconnected._
- **Should `file-conversion / executor.main.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.12666666666666668 - nodes in this community are weakly interconnected._