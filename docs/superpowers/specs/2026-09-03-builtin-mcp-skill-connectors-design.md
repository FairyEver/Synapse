# 内置 MCP + Skill 连接器设计

日期：2026-09-03  
状态：已实施

## 目标

V1 将 Figma Desktop MCP 表达为客户端内置连接器：静态定义声明本机 MCP 和内置 Skill，Connectors System App 统一展示、启停与探测，Agent Runtime 在新对话中按快照注入两者。

新增或修改连接器仍需发布 Synapse 客户端。原始 V1 不建设云端 Connector Catalog，也不支持 OAuth、Token、多账号、多环境、远程 MCP、其它传输或 Skill 下载。2026-09-22 的 Portal 扩展仅放开用户授权会话 token 与按 SY 账号/环境隔离；其余非目标不变，见文末。

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

## Portal 授权连接扩展（2026-09-22）

- 保留原 MCP probe/contribution 驱动，新增 `portal-session` lifecycle 驱动；`skillPackageId` 对仅连接型定义可省略，此类连接器不进入 Agent 快照。
- 当前只注册 Portal Headless Test。测试连接器永久保留，生产 Portal Headless 后续单独注册，绝不通过回调覆盖环境地址。
- 授权页由 Portal Web 另行实现。SY 一次性 state 与绑定代次只在内存保留五分钟，主进程真实读取用户/企业数据后才保存加密凭据；回调/网络失败不能模拟连接成功。
- `app.connectors.state` 兼容保留原 singleton，新增同 namespace 的账号/环境独立记录；`app.connectors.credentials` 复用 encrypted-json，加可选 Portal 绑定元数据。普通状态不保存 token，恢复必须重新验证。
- Deep Link 使用既有声明式路由的私有 `mainHandlerId`，不进入 ActionRouter/MCP/HTTP。Renderer 状态通过 EventBus `connector/item.changed` 发送，回调凭据不进入 IPC。
- 精确契约、生命周期和凭据字段来源见 `docs/integrations/portal-headless-test.md`；给 Web 的实施提示词见同目录 `portal-headless-test-web-prompt.md`。


## 2026-09-22：Portal 独立扩展补充

用户确认 Portal Headless 作为 `extend` 扩展，不升级为内置 App。连接器只负责本机授权和安全凭据管理；专用 MCP `extend_portal_headless_credential_get` 向用户自己的 AI 交付 Portal 凭证与短期 SY 授权，系统 Skill 引导 AI 直连 `/api/extend/portal-headless/*`，后端验证两类身份后调用固定版本 SDK。此交付是原“凭据不进入模型结果”约束的专用例外，不开放通用 Secrets、Renderer、业务转发 MCP 或任意 HTTP 代理。实现和部署边界见 `docs/integrations/portal-headless-extension.md`。
