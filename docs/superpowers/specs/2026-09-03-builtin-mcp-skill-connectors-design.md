# 内置 MCP + Skill 连接器设计

日期：2026-09-03  
状态：已实施

## 目标

V1 将 Figma Desktop MCP 表达为客户端内置连接器：静态定义声明本机 MCP 和内置 Skill，Connectors System App 统一展示、启停与探测，Agent Runtime 在新对话中按快照注入两者。

新增或修改连接器仍需发布 Synapse 客户端。本阶段不建设云端 Connector Catalog，也不支持 OAuth、Token、多账号、多环境、远程 MCP、其它传输或 Skill 下载。

## 架构

```text
Builtin Connector Definition
            ↓
Connectors Service → Connector Driver Registry
            ↓
Agent Contribution（MCP Servers + Skill Package IDs）
            ↓
Agent Runtime
```

- 定义字段固定为稳定 `id`、名称、可选说明和文档地址、`skillPackageId`、`integration`。
- V1 的 `integration.kind` 只有 `mcp-streamable-http`，包含 endpoint 与可选 `requiredTools`。
- Driver 负责探测并生成 Agent Contribution；Service、IPC、UI 和 Agent Runtime 不得按连接器 ID 实现新业务分支。
- `id` 是状态和会话快照主键，发布后不得直接更改；更名时使用显式兼容解析。

## 启停与探测

启用顺序固定为：校验地址、权限检查、MCP initialize、initialized 通知、`tools/list`、必需工具校验、保存启用状态。任何一步失败都保持禁用，只保存时间、失败状态和稳定错误码。

停用只写入 `enabled=false`。探测状态不表示 MCP Server 长期在线，也不动态修改已有 Agent 对话。

V1 endpoint 只接受带显式端口的 `http://127.0.0.1:<port>/<path>`，拒绝 userinfo、非 HTTP、其它主机、fragment 和重定向。网络探测必须经过 `PermissionGuard`、`AuditSink` 和总超时；日志与审计不得记录 MCP 返回正文。

## 状态与兼容

```ts
type ConnectorStateStore = {
  schemaVersion: 1
  connectors: Record<string, {
    enabled: boolean
    lastProbe?: {
      at: string
      status: "success" | "failed"
      errorCode?: string
    }
  }>
}
```

静态名称、地址和 Skill 路径不写入状态。旧 Figma item 首次读取时归一化到新状态；只有当前本机、无认证且已连接的记录迁移为启用。新状态写入成功后清理旧 item，Credential 数据不在本次范围内。

## Agent 会话

新对话创建时保存当前已启用的 `connectorIds`。每次为该对话创建 live session 时，从注册表解析这些 ID，由 Driver 生成 MCP 配置和 Skill Package ID，再由 Agent Runtime 统一解析 Skill 的开发/正式包路径。

已有对话始终使用创建时快照，连接器后续启停只影响新对话。MCP 和 Skill 必须来自同一次 Contribution 解析；预期 MCP 缺失、连接失败、待授权或超时时记录诊断并降级该工具，用户 Prompt 和普通对话继续执行。历史 `figmaDesktopMcpEnabled` 与 `expectedMcpServerNames` 只保留读取兼容与诊断。
