# Graph Report - desktop/database  (2026-05-28)

## Corpus Check
- Corpus is ~4,795 words - fits in a single context window. You may not need a graph.

## Summary
- 44 nodes · 69 edges · 7 communities (5 shown, 2 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_shared  mcp-rpc.ts|shared / mcp-rpc.ts]]
- [[_COMMUNITY_shared  mcp-tools.ts|shared / mcp-tools.ts]]
- [[_COMMUNITY_shared  resolve-user-data.ts|shared / resolve-user-data.ts]]
- [[_COMMUNITY_mcp  index.ts|mcp / index.ts]]
- [[_COMMUNITY_mcp  index.ts|mcp / index.ts]]
- [[_COMMUNITY_shared  capability-registry.ts|shared / capability-registry.ts]]
- [[_COMMUNITY_shared  server-identity.ts|shared / server-identity.ts]]

## God Nodes (most connected - your core abstractions)
1. `normalizeToolResult()` - 6 edges
2. `executeTool()` - 5 edges
3. `processMcpRequest()` - 5 edges
4. `getServerInfo()` - 4 edges
5. `isRecord()` - 4 edges
6. `readServerInfo()` - 4 edges
7. `writeResponse()` - 3 edges
8. `handleRequest()` - 3 edges
9. `idsFromData()` - 3 edges
10. `isDryRun()` - 3 edges

## Surprising Connections (you probably didn't know these)
- `processMcpRequest()` --calls--> `executeTool()`  [INFERRED]
  shared/mcp-rpc.ts → mcp/index.ts
- `getServerInfo()` --calls--> `isAppRunning()`  [EXTRACTED]
  mcp/index.ts → shared/resolve-user-data.ts
- `getServerInfo()` --calls--> `readServerInfo()`  [EXTRACTED]
  mcp/index.ts → shared/resolve-user-data.ts
- `executeTool()` --calls--> `apiCall()`  [EXTRACTED]
  mcp/index.ts → shared/resolve-user-data.ts
- `writeResponse()` --calls--> `serializeJsonRpcPayload()`  [EXTRACTED]
  mcp/index.ts → shared/mcp-rpc.ts

## Communities (7 total, 2 thin omitted)

### Community 0 - "shared / mcp-rpc.ts"
Cohesion: 0.29
Nodes (10): idsFromData(), isDryRun(), isRecord(), JsonRpcId, JsonRpcRequest, McpRpcResponse, McpServerIdentity, normalizeToolResult() (+2 more)

### Community 1 - "shared / mcp-tools.ts"
Cohesion: 0.22
Nodes (7): columnKindEnum, DATABASE_MCP_TOOL_ACTIONS, kindDescription, McpTool, tableNameProp, whereClauseSchema, whereConditionSchema

### Community 2 - "shared / resolve-user-data.ts"
Cohesion: 0.38
Nodes (6): getServerInfo(), DatabaseApiClientSource, getUserDataPath(), isAppRunning(), readServerInfo(), ServerInfo

### Community 3 - "mcp / index.ts"
Cohesion: 0.47
Nodes (5): clearServerInfoCache(), executeTool(), [major], rl, apiCall()

### Community 4 - "mcp / index.ts"
Cohesion: 0.50
Nodes (4): handleRequest(), writeResponse(), processMcpRequest(), serializeJsonRpcPayload()

## Knowledge Gaps
- **15 isolated node(s):** `[major]`, `rl`, `SYNAPSE_MCP_LEGACY_SERVER_NAMES`, `DATABASE_DOMAIN`, `JsonRpcId` (+10 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `processMcpRequest()` connect `mcp / index.ts` to `shared / mcp-rpc.ts`, `mcp / index.ts`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Why does `readServerInfo()` connect `shared / resolve-user-data.ts` to `mcp / index.ts`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Why does `normalizeToolResult()` connect `shared / mcp-rpc.ts` to `mcp / index.ts`?**
  _High betweenness centrality (0.007) - this node is a cross-community bridge._
- **What connects `[major]`, `rl`, `SYNAPSE_MCP_LEGACY_SERVER_NAMES` to the rest of the system?**
  _15 weakly-connected nodes found - possible documentation gaps or missing edges._