# 智能体管理应用设计

日期：2026-06-30

## 背景

Synapse 现有“对话”系统应用负责 Agent 会话、消息、工具事件和运行态交互。本设计新增一个独立系统应用“智能体”，只管理人格配置，不改变现有“对话”应用，也不接入 Agent runtime。

本设计参考用户提供的豆包智能体列表与创建界面，但只吸收信息结构，不照搬消费级视觉风格。Synapse 内部应用继续保持克制、可扫描、工程化的管理界面。

## 目标

- 新增独立系统应用“智能体”。
- 管理固定系统内置智能体和用户创建的智能体。
- V1 只保存基础人格配置：名称、简介、系统提示词、模型。
- 模型选择复用现有公共模型选择组件。
- 用户智能体数据使用 DataRepository 存储。
- 系统内置智能体固定在代码中，只读、不可删除、不可复制。

## 非目标

- 不做发现页、市场页或公共智能体列表。
- 不做头像。
- 不做启用状态。
- 不做排序。
- 不做复制。
- 不做分类标签。
- 不做对话入口。
- 不做运行时人格选择或切换。
- 不修改现有“对话”应用行为。
- 不提前保存 Claude SDK 暂未使用或 V1 不需要的字段，如 tools、skills、mcpServers、permissionMode、memory、effort、initialPrompt。

## 产品结构

```text
Synapse
├─ 对话        现有应用，暂不改
└─ 智能体      新应用，只做配置管理
```

应用显示名为“智能体”。内部能力包目录使用 `agent-personas`，避免和现有 `agent` 对话模块、Agent runtime 命名混淆。

```text
desktop/app-capabilities/agent-personas/
├─ shared/
│  ├─ capability.ts
│  ├─ schema.ts
│  └─ defaults.ts
├─ main/
│  ├─ service.ts
│  └─ ipc.ts
└─ renderer/
   ├─ app-definition.ts
   ├─ app-manifest.ts
   └─ index.tsx
```

## 内置智能体

V1 固定内置一个“中英翻译”智能体。

```text
名称：中英翻译

简介：在中文和英文之间互译，保留原意、语气和格式。

系统提示词：
你是中英翻译智能体。用户输入中文时翻译成英文，输入英文时翻译成中文。
保持原意、语气、格式和段落结构，不添加解释，不扩写内容。
遇到术语、代码、路径、命令、变量名、品牌名时保持准确；无法确定专有名词时保留原文。

模型：未指定
```

规则：

- 可查看。
- 不可编辑。
- 不可删除。
- 不提供复制。
- 不写入用户数据表。

## 数据模型

用户创建的智能体使用 DataRepository 保存。

```text
namespace: app.agent-personas.items
backend: sqlite
```

用户记录：

```ts
type UserAgentPersona = {
  id: string
  schemaVersion: 1
  name: string
  description: string
  systemPrompt: string
  providerModel: {
    providerId: string
    modelTier: ModelTier
  } | null
  source: "user"
  createdAt: string
  updatedAt: string
}
```

内置记录由 `shared/defaults.ts` 固定提供：

```ts
type BuiltinAgentPersona = {
  id: "builtin-zh-en-translator"
  schemaVersion: 1
  name: "中英翻译"
  description: string
  systemPrompt: string
  providerModel: null
  source: "builtin"
  readonly: true
}
```

服务层 `list()` 返回合并结果：

```text
list()
├─ builtins from defaults
└─ user items from DataRepository
```

更新和删除只允许用户记录。传入内置 ID 时，service 必须拒绝。

## 表单与校验

创建和编辑用户智能体使用同一表单。

```text
名称        必填
简介        必填
系统提示词  必填
模型        可空
```

模型字段复用现有 `ProviderModelSelectDialog`，保存值为 `{ providerId, modelTier } | null`。模型非必填；未指定时后续运行时可使用全局默认模型或会话模型，但 V1 不实现运行时接入。

## UI 行为

页面结构：

```text
智能体                                      [新增]

系统内置
┌────────────────────────────────────────────┐
│ 中英翻译                                   │
│ 在中文和英文之间互译，保留原意、语气和格式。 │
│ 模型：未指定                              │
│ [查看]                                    │
└────────────────────────────────────────────┘

我创建的
┌────────────────────────────────────────────┐
│ 名称           简介           模型   操作   │
│ ...            ...            ...    编辑 删除│
└────────────────────────────────────────────┘
```

行为：

- 列表先显示系统内置，再显示用户创建的智能体。
- 用户列表可以按创建时间展示；V1 不提供拖拽排序。
- 内置详情只读，不显示保存、删除、复制。
- 新增用户智能体时打开表单，保存后刷新列表。
- 编辑用户智能体时打开同一表单，保存后刷新列表。
- 删除用户智能体时先弹确认框，删除后刷新列表。
- 用户列表为空时仍显示系统内置区域，并在“我创建的”区域显示空状态和新增按钮。

UI 约束：

- 使用现有 shadcn 组件和 Tailwind token。
- 不写自定义颜色、hex/rgb/hsl 字面色或 Tailwind 任意颜色值。
- 不使用内联样式，除非是运行时动态值。
- 不做营销文案、功能介绍段落或装饰性视觉。
- 不做卡片套卡片。

## IPC 与服务

Renderer 通过 preload bridge 调用 IPC，不直接读写 DataRepository。

IPC：

```text
synapse:agent-personas:list
synapse:agent-personas:create
synapse:agent-personas:update
synapse:agent-personas:delete
synapse:agent-personas:changed
```

Service：

```text
createAgentPersonaService()
├─ list()
├─ create(input)
├─ update(input)
└─ delete(input)
```

服务职责：

- 统一校验必填字段。
- 统一生成 ID 和时间戳。
- 只保存用户智能体。
- 合并内置智能体和用户智能体。
- 拒绝更新或删除内置智能体。
- 保存后发出 changed 事件。

## 错误处理

- 加载失败：显示错误状态和重试按钮。
- 保存失败：表单内显示错误，并显示 toast。
- 删除失败：显示 toast。
- 更新或删除内置项：service 拒绝，renderer 展示失败提示。
- 模型引用失效：列表显示模型 ID 或“模型不可用”，不阻断编辑。

## 测试

Service 测试：

- 合并内置和用户智能体。
- 创建时校验名称、简介、系统提示词。
- 创建用户智能体。
- 编辑用户智能体。
- 删除用户智能体。
- 拒绝编辑内置智能体。
- 拒绝删除内置智能体。

IPC 测试：

- 注册 list/create/update/delete/changed channel。
- handler 调用 `core.agent-personas` service。

Renderer 测试：

- 加载列表。
- 用户列表为空时仍显示内置智能体。
- 新增用户智能体。
- 编辑用户智能体。
- 删除用户智能体。
- 内置详情只读。
- 必填校验。
- 模型选择复用 `ProviderModelSelectDialog`。

## 后续扩展边界

V1 不接入运行时，但数据设计保留后续接入空间。

后续可接入 Claude SDK agent：

```text
name / description / systemPrompt / model
→ 可映射到 Claude Agent SDK AgentDefinition 的 description、prompt、model 等字段
```

`providerModel` 是 Synapse 的供应商模型选择结构，后续运行时需要解析成实际 Claude SDK `model` 字符串。

后续可接入对话：

```text
新建会话时选择智能体
conversation agentConfig 保存 personaId + snapshot
不复用 agentType 表示人格
```

后续如果新增高级配置，必须先确认 Claude Agent SDK 当前真实支持字段，再进入 UI 和数据模型。不要添加无法映射到 SDK 或运行时的架空配置。
