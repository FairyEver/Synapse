// Synapse Data MCP server 的身份。这个名字既作为用户编辑器配置里
// mcpServers 的 key（Claude / Cursor / Codex），也作为 MCP initialize
// 握手返回的 serverInfo.name —— 两处必须一致。
//
// 改名流程：
//   1. 把 SYNAPSE_DATA_SERVER_NAME 改成新名字。
//   2. 把旧名字追加到 SYNAPSE_DATA_LEGACY_SERVER_NAMES。
//
// 用户下次启动时，autoRegisterMcp() 会先把三个编辑器配置里旧名字的条目
// 清掉，再用新名字注册，对用户无感。

export const SYNAPSE_DATA_SERVER_NAME = "synapse-data"

export const SYNAPSE_DATA_SERVER_IDENTITY = {
  name: SYNAPSE_DATA_SERVER_NAME,
  version: "1.0.0",
} as const

// 曾经用过的服务器名字。启动时会从用户编辑器配置里移除这些条目。
// 不要把当前名字放进来。
export const SYNAPSE_DATA_LEGACY_SERVER_NAMES: readonly string[] = []
