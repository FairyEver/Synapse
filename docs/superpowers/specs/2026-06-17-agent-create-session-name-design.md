# Agent 新建会话命名确认设计

> 状态：设计确认，等待用户审阅

## 背景

Agent 侧栏新建会话时会先打开共享的 `ProviderModelSelectDialog`，让用户选择供应商和模型。当前确认后直接创建会话，会话名由 renderer 创建逻辑固定生成为 `新会话 HH:mm`。用户希望在同一个确认区域里出现一个可编辑输入框，默认填入外部生成的名称，例如 `24日下午1:30`，确认后用该名称创建对话。

`ProviderModelSelectDialog` 不是 Agent 新建会话专用组件。它还被 Workflow 默认模型、Workflow 导入映射、设置页默认模型、供应商删除迁移等入口复用。因此新能力必须作为可选扩展，不改变默认弹窗行为。

## 目标

- 在 Agent 侧栏“新建会话”入口中，选择供应商和模型后允许用户编辑本次新会话名称。
- 默认名称由 Agent 入口在打开弹窗时生成，格式为 `D日上午/下午h:mm`，例如 `24日下午1:30`。
- 公共弹窗只负责展示和编辑外部传入的确认输入值，不生成默认名称，也不绑定“会话名”业务语义。
- 用户把输入框清空或只输入空白时，确认按钮禁用。
- 不影响 `ProviderModelSelectDialog` 的其它复用入口。

## 非目标

- 不重新设计供应商和模型选择表格。
- 不改变 Workflow、设置页、供应商迁移等入口的确认区域。
- 不新增会话重命名存储模型。创建时仍使用现有 session `name` 字段。
- 不改变现有会话列表重命名能力。

## 交互

默认情况下，`ProviderModelSelectDialog` footer 仍显示：

```text
[取消] [确认]
```

Agent 新建会话入口启用确认输入后，footer 显示：

```text
[取消] [24日下午1:30        ] [确认]
```

输入框初始值来自调用方。用户可以编辑。点击确认后，弹窗把供应商、模型和输入框最终值一起交给调用方。

输入框值提交前会 `trim`。`trim` 后为空时确认按钮禁用。创建中输入框、取消按钮和确认按钮都禁用，避免重复提交或修改提交中的名称。创建失败时弹窗保持打开，供应商、模型和用户输入的名称都保留。

键盘行为：

- 输入框聚焦时按 `Enter`，如果当前可确认，则提交。
- `Esc` 保持现有 Dialog 关闭行为。
- 供应商和模型选择的点击行为不变。

## 公共组件 API

`ProviderModelSelectDialog` 增加一个可选配置，命名保持通用：

```ts
type ProviderModelSelectDialogConfirmInput = {
  readonly initialValue: string
  readonly placeholder?: string
  readonly ariaLabel: string
}

type ProviderModelSelectDialogSelectMeta = {
  readonly confirmInputValue?: string
}
```

组件 props 调整为：

```ts
type ProviderModelSelectDialogProps = {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onSelect: (
    selection: ProviderModelSelection,
    meta?: ProviderModelSelectDialogSelectMeta,
  ) => void | Promise<void>
  readonly defaultSelection?: ProviderModelSelection
  readonly excludeProviderIds?: readonly string[]
  readonly confirmInput?: ProviderModelSelectDialogConfirmInput
}
```

设计约束：

- 不传 `confirmInput` 时，不渲染输入框，`onSelect(selection)` 兼容现有调用方式。
- 传入 `confirmInput` 时，组件内部维护当前输入值，并在确认时通过 `meta.confirmInputValue` 回传 `trim` 后的值。
- `confirmInput.initialValue` 只作为弹窗打开时的初始值。用户编辑后，不要求外部持续受控同步。
- 如果弹窗保持打开且调用方更新了 `initialValue`，不覆盖用户正在编辑的值；下一次重新打开弹窗时再使用新的初始值。
- 公共组件不记录“会话名”字样，不生成时间格式，不调用 Agent 创建逻辑。

## Agent 入口集成

`AgentSessionSidebar` 在用户点击项目下的新建会话按钮时，记录目标项目并生成本次默认名称。默认名称格式由 Agent 模块内的纯函数负责：

```ts
formatCreateSessionName(date: Date): string
```

输出规则：

- 日期使用本地日号，不补零。
- 小时使用 12 小时制，不补零。
- 分钟补零到两位。
- 0:00 到 11:59 使用 `上午`。
- 12:00 到 23:59 使用 `下午`，其中 12 点显示为 `12`，13 点显示为 `1`。

示例：

| 时间 | 输出 |
| --- | --- |
| 2026-06-24 13:30 | `24日下午1:30` |
| 2026-06-03 09:05 | `3日上午9:05` |
| 2026-06-24 12:00 | `24日下午12:00` |
| 2026-06-24 00:07 | `24日上午12:07` |

Agent 新建会话入口传入：

```ts
confirmInput={{
  initialValue: generatedName,
  ariaLabel: "会话名称",
}}
```

确认回调收到 `meta.confirmInputValue` 后，将其作为会话名称传给 `chat.createSession`。

## 创建会话链路

renderer 的 `chat.createSession` 增加可选 `name` 参数：

```ts
createSession(
  projectId: string,
  providerId?: string,
  mode?: SynapseAgentPermissionMode,
  modelTier?: string,
  name?: string,
): Promise<void>
```

`useChatConnection` 创建 session 时：

- 如果传入了非空 `name`，使用该名称。
- 如果未传入 `name`，继续使用旧默认值 `新会话 HH:mm`。

这样可以保持其它创建路径不变，例如长对话提醒中新建同模型会话、未来其它不带名称的创建入口，都不会被迫接入新命名规则。

## 错误处理

- Provider 列表加载失败、重试、保存失败沿用现有 `ProviderModelSelectDialog` 行为。
- 创建会话失败时，`onSelect` 抛错或 rejected，公共弹窗保持打开，`saving` 结束后允许用户再次确认。
- 输入框为空禁用确认，不额外显示提示文案，避免在弹窗里增加不必要说明。

## 测试

公共组件测试：

- 不传 `confirmInput` 时不显示输入框，确认仍只调用 `onSelect(selection)`。
- 传入 `confirmInput.initialValue` 时显示输入框，并填入初始值。
- 修改输入框后确认，`onSelect` 收到 `meta.confirmInputValue`。
- 输入框清空或只含空白时确认按钮禁用。
- 输入框聚焦时按 `Enter` 可提交。

Agent 测试：

- 点击新建会话打开弹窗时，输入框默认值符合 `D日上午/下午h:mm` 格式。
- 修改输入框后确认，`onCreateSession` 或 `chat.createSession` 收到该名称。
- 未传名称的 `chat.createSession` 路径仍生成 `新会话 HH:mm`。

## 发布说明

实现时需要更新 `RELEASE_NOTES_PENDING.md`，面向用户说明 Agent 新建会话时可以在选择模型前直接命名会话。
