# 智能体云端数据设计

日期：2026-07-01

## 背景

现有“智能体”系统应用已经落地为 `desktop/app-capabilities/agent-personas/` 能力包。当前实现中，用户创建的智能体保存在桌面端 DataRepository namespace `app.agent-personas.items`，内置智能体的模型覆盖保存在本地 singleton `app.agent-personas.settings`。Agent 对话运行时会从该本地服务读取智能体列表，并把选中的 persona 映射为 Claude Agent SDK main-thread agent。

新的产品方向是：智能体设置必须成为云端账号数据，不再以用户本地数据为权威来源。桌面端可以保留最近一次同步的只读缓存，用于离线查看、选择和运行，但不能把本地缓存当作可编辑数据源。

## 已确认决策

- 智能体配置以云端为唯一权威。
- 桌面端只保留上次成功同步的只读缓存。
- 未登录时智能体页要求登录，不加载系统内置或我的智能体。
- 已登录但离线或服务端不可达时，可以查看、选择、运行缓存智能体，但不能新建、编辑、删除或保存内置偏好。
- 系统内置智能体也从云端下发，平台通过服务端 seed 管理。
- 用户对系统内置智能体的模型、工具等偏好保存到自己的云端账号。
- 旧本地“我的”智能体不迁移、不合并、不上传。云端化后，“我的”从当前账号云端数据开始。

## 目标

- 新增服务端 Agent Persona 一等资源，承载系统内置智能体、用户智能体和用户内置偏好。
- 桌面智能体 App 和 Agent 新建对话弹窗都改为消费云端列表服务。
- 保持现有 renderer bridge 语义尽量稳定，减少 Agent 对话运行时和 UI 改动面。
- 支持登录在线、登录离线、未登录、切换账号四类状态。
- 明确本地缓存的只读边界，避免离线编辑队列和本地权威数据重新出现。

## 非目标

- 不自动迁移旧本地智能体。
- 不提供“导入旧本地智能体”入口。
- 不做离线创建、离线编辑或恢复联网后同步队列。
- 不做团队共享、团队智能体权限或协作编辑。
- 不做管理员后台维护内置智能体。V1 内置数据由服务端 seed 管理。
- 不把完整 persona 数据复制进 conversation；conversation 仍只保存 persona id 和必要 snapshot。

## 产品行为

未登录：

```text
打开智能体 App
  -> 显示登录入口
  -> 不加载系统内置
  -> 不显示我的智能体

Agent 新建对话弹窗
  -> 不显示云端智能体项
  -> 保持普通对话
```

已登录在线：

```text
打开智能体 App
  -> GET /api/agent-personas
  -> 显示系统内置 / 我的
  -> 同步成功后覆盖本地只读缓存

创建、编辑、删除我的智能体
  -> 调服务端 API
  -> 成功后刷新列表并覆盖缓存

设置系统内置智能体
  -> 只保存当前用户偏好
  -> 不修改内置定义
```

已登录离线且有缓存：

```text
打开智能体 App
  -> 读取当前 userId 对应缓存
  -> 显示缓存列表
  -> 禁用新增、编辑、删除、保存设置

Agent 新建对话弹窗
  -> 可选择缓存智能体
  -> 可继续运行缓存智能体
```

已登录离线且无缓存：

```text
打开智能体 App
  -> 显示需要重新连接后加载
  -> 不显示旧本地 DataRepository 智能体
```

切换账号：

```text
账号 A 缓存只对账号 A 可见
账号 B 登录后不显示账号 A 缓存
账号 B 同步成功后写入自己的缓存快照
```

## 服务端数据模型

新增 `AgentPersona`：

```prisma
model AgentPersona {
  id                   String   @id @default(cuid())
  source               String   @db.VarChar(16)
  ownerUserId          String?
  owner                User?    @relation(fields: [ownerUserId], references: [id], onDelete: Cascade)
  stableKey            String?  @db.VarChar(120)
  name                 String   @db.VarChar(120)
  description          String   @db.VarChar(1000)
  systemPrompt         String
  defaultProviderModel Json?
  defaultToolPolicy    Json?
  status               String   @db.VarChar(16)
  version              Int      @default(1)
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  preferences AgentPersonaPreference[]

  @@unique([source, stableKey])
  @@index([ownerUserId, source, updatedAt])
  @@index([source, status, updatedAt])
}
```

新增 `AgentPersonaPreference`：

```prisma
model AgentPersonaPreference {
  id            String       @id @default(cuid())
  userId        String
  user          User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  personaId     String
  persona       AgentPersona @relation(fields: [personaId], references: [id], onDelete: Cascade)
  providerModel Json?
  toolPolicy    Json?
  updatedAt     DateTime     @updatedAt

  @@unique([userId, personaId])
  @@index([userId, updatedAt])
}
```

约束：

- `source = "builtin"` 的记录 `ownerUserId` 为空，`stableKey` 必填。
- `source = "user"` 的记录 `ownerUserId` 必填，`stableKey` 为空。
- V1 内置记录通过服务端 seed 创建和更新。
- `status = "archived"` 的记录默认不返回给桌面列表。
- 用户智能体删除可采用硬删除或软删除；若要保留历史审计，优先软删除为 `archived`。

## 服务端 API

所有接口使用现有用户鉴权。

```text
GET    /api/agent-personas
POST   /api/agent-personas
PUT    /api/agent-personas/:id
DELETE /api/agent-personas/:id
PUT    /api/agent-personas/builtin/:id/preferences
```

`GET /api/agent-personas` 返回服务端合并后的视图：

```ts
type AgentPersonaDto = {
  id: string
  schemaVersion: 1
  name: string
  description: string
  systemPrompt: string
  providerModel: {
    providerId: string
    modelTier: "default" | "haiku" | "sonnet" | "opus"
  } | null
  toolPolicy: {
    mode: "all" | "disabled" | "allowlist"
    allowedTools?: string[]
  } | null
  source: "builtin" | "user"
  readonly: boolean
  version: number
  createdAt?: string
  updatedAt?: string
}
```

合并规则：

- 内置智能体返回内置定义加当前用户偏好。
- 用户智能体返回用户记录自身配置。
- 内置智能体 `readonly: true`。
- 用户智能体 `readonly: false`。

写入规则：

- `POST /api/agent-personas` 只能创建当前用户的 `source = "user"` 智能体。
- `PUT /api/agent-personas/:id` 只能更新当前用户自己的用户智能体。
- `DELETE /api/agent-personas/:id` 只能删除当前用户自己的用户智能体。
- `PUT /api/agent-personas/builtin/:id/preferences` 只能更新当前用户对内置智能体的偏好，不能修改内置定义。
- 对不存在、非本人、内置不可编辑等场景返回明确错误。

## 桌面架构

现有 `AgentPersonaService` 保留对 renderer 的主要方法，但内部拆为三层：

```text
AgentPersonaService
├─ RemoteAgentPersonaClient
│  └─ 使用 account authenticated fetch 调服务端 API
├─ AgentPersonaCache
│  └─ 保存当前 userId 的只读同步快照
└─ Account state resolver
   └─ 判断未登录、在线、离线和切换账号
```

服务方法建议返回带状态的结果：

```ts
type AgentPersonaListResult = {
  status: "unauthenticated" | "online" | "offline-cache" | "offline-empty"
  items: AgentPersona[]
  syncedAt?: string
}
```

为减少改动面，可以在 IPC 层继续暴露 `list/create/update/delete/updateBuiltinModel`，但 `list` 需要扩展状态返回。Agent 对话页如果只需要 items，可以通过兼容 helper 提取列表，同时保留未登录和离线状态给智能体 App 使用。

## 本地缓存模型

新增或替换为远端缓存 namespace：

```text
namespace: app.agent-personas.remote-cache
backend: json
```

缓存结构：

```ts
type AgentPersonaRemoteCacheEntryV1 = {
  schemaVersion: 1
  users: Record<string, {
    syncedAt: string
    items: AgentPersonaDto[]
  }>
}
```

规则：

- 缓存只由远端同步成功后覆盖写入。
- UI 的创建、编辑、删除和偏好保存不能写缓存。
- 离线状态只能读取缓存。
- 缓存按 `userId` 分桶。当前登录用户只能读取自己 `userId` 对应的缓存分桶。
- 旧 `app.agent-personas.items` 和 `app.agent-personas.settings` 不参与新列表，不自动上传，不自动合并。

## UI 行为

智能体 App：

- 未登录：显示登录入口。
- 已登录在线：显示 `系统内置` 和 `我的` 两个 tab。
- 已登录离线且有缓存：显示缓存列表，禁用新增、编辑、删除和保存设置。
- 已登录离线且无缓存：显示重新连接后加载。
- 不展示旧本地智能体，不提供迁移提示。

系统内置 tab：

- 列表来自服务端内置定义。
- 设置入口只编辑当前用户偏好。
- 不允许编辑名称、简介、系统提示词。

我的 tab：

- 列表来自当前用户云端数据。
- 新建、编辑、删除只在在线状态可用。
- 表单保存后走服务端 API，成功后刷新列表。

文案边界：

- 需要让用户知道自定义智能体的系统提示词会同步到账号。
- 不写冗余功能介绍，不写营销文案。
- 离线状态只说明当前操作限制。

## Agent 对话运行时

- 新建对话智能体选择器消费同一个 `AgentPersonaService`。
- 在线时使用最新云端列表。
- 离线时允许使用当前用户缓存列表选择和运行。
- 会话仍保存 `activeMainThreadPersonaId` 和 `activeMainThreadPersonaSnapshot`。
- 如果 conversation 保存的 persona id 在当前云端或缓存列表中不存在，保留历史但禁止继续发送，并引导新建对话。
- 历史消息中的 snapshot 继续用于导出和旧消息显示。
- SDK agent definitions 仍由当前列表即时派生，不把完整云端数据复制进 conversation。

运行时缺失场景：

```text
conversation.activeMainThreadPersonaId = "persona-1"
当前列表没有 persona-1
  -> 阻止启动 SDK turn
  -> UI 显示智能体不可用并禁用发送
  -> 不删除 conversation 中保存的旧 snapshot
```

## 错误处理

- 未登录写操作返回登录要求，不访问本地旧数据。
- 在线请求失败且有缓存时，列表降级为 `offline-cache`。
- 在线请求失败且无缓存时，列表降级为 `offline-empty`。
- 写操作失败不修改缓存。
- 认证失效时清理当前在线状态，但不删除缓存；缓存只有同一 `userId` 再次登录时可读。
- 服务端错误日志不得记录完整 systemPrompt，也不得记录 token、密钥、认证头等敏感凭据；桌面日志按现有 redaction 规则处理。

## 测试范围

服务端：

- 列表返回内置智能体和当前用户智能体。
- 用户只能创建、编辑、删除自己的智能体。
- 用户不能编辑或删除内置智能体定义。
- 用户只能更新自己对内置智能体的偏好。
- 内置偏好能正确覆盖返回列表中的 providerModel 和 toolPolicy。
- 归档或删除的智能体不出现在默认列表中。

桌面主进程：

- 未登录时 `list` 返回 unauthenticated。
- 已登录在线时读取远端并覆盖缓存。
- 远端失败且有当前 userId 缓存时返回 offline-cache。
- 远端失败且无缓存时返回 offline-empty。
- 切换账号时不显示上一个账号的缓存。
- 创建、编辑、删除、内置偏好更新失败时不写缓存。
- 旧 `app.agent-personas.items/settings` 不迁移、不合并、不上传。

Renderer：

- 未登录显示登录入口。
- 在线状态显示系统内置和我的 tab。
- 离线缓存状态禁用所有写操作。
- 离线无缓存显示重新连接后加载。
- Agent 新建对话弹窗能使用缓存智能体。
- 缺失 persona id 保留历史、禁用发送且不回退普通模式。

## 实施顺序建议

1. 服务端 schema、seed、DTO 和 API 测试。
2. 桌面 remote client 和只读缓存 schema。
3. 改造 `AgentPersonaService` 的状态分流。
4. 改造智能体 App UI 的登录、在线、离线状态。
5. 改造 Agent 新建对话 persona 列表消费和缺失阻断。
6. 删除或隔离旧本地 DataRepository 来源，保留必要兼容测试证明它不会参与新列表。

## 发布说明要点

该改动完成后需要更新 `RELEASE_NOTES_PENDING.md`：

- 智能体配置改为跟随账号云端同步。
- 未登录时需要登录后使用智能体。
- 离线时可继续使用上次同步的智能体，但不能编辑。
- 旧本地智能体不会自动迁移到云端。
