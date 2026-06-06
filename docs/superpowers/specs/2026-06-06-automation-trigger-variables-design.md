# Automation Trigger Variables Design

为自动化触发器提供可发现、可复制、可在四类执行器中运行时替换的变量能力。

## 背景

自动化当前由触发器和执行器组成。执行器包括 Agent、命令、脚本和 HTTP 请求。用户希望在执行器配置中引用触发器信息，例如事件来源、触发时间或事件 payload 字段，但不希望改动现有执行器配置面板。

工作流已有变量能力，但它属于 DAG 节点执行模型：`WorkflowEngine` 先解析工作流参数、上游节点输出和固定值，再由节点 executor 对 Prompt、HTTP、End 等字段做模板替换。自动化没有上游节点概念，因此不直接复用工作流变量绑定 UI。

## 目标

- 在自动化触发器面板提供变量发现入口。
- 用户点击变量后复制 `{{trigger.xxx}}` 到剪贴板，再自行粘贴到任意执行器字段。
- Agent、命令、脚本、HTTP 请求四种执行器都支持运行时模板替换。
- 变量能力由触发器声明，执行器只消费运行时变量表。
- 不侵入现有执行器配置面板 UI。

## 非目标

- 不把工作流的变量绑定编辑器搬到自动化。
- 不在执行器面板中增加变量选择器、变量按钮或说明区域。
- 不做全 config 深度替换。
- 不为变量值做 shell/URL/JSON 自动转义。模板替换是显式文本替换，安全责任与对应执行器原有风险一致。
- 不在本次设计中新增 event/webhook 触发器；只为未来事件触发器预留变量模型。

## 方案

采用“触发器侧发现 + action runtime 统一上下文 + 执行器白名单替换”。

### 变量发现

触发器 manifest 或 definition 增加变量声明：

```ts
type AutomationTriggerVariableDescriptor = {
  readonly key: string
  readonly label: string
  readonly description?: string
  readonly example?: string
  readonly dynamic?: boolean
}
```

自动化编辑器在选中触发器后，在触发器摘要附近显示 `变量` 按钮。点击后弹出变量列表。每一行展示变量 label、模板文本和可选示例。点击行或复制按钮，把完整模板复制到剪贴板，例如：

```text
{{trigger.triggeredAt}}
```

变量按钮只属于触发器面板。执行器面板保持原样。

### 计划触发器变量

Cron 和 Interval 先提供固定变量：

| key | 含义 |
|---|---|
| `trigger.type` | 触发器类型，例如 `builtin.cron` |
| `trigger.triggeredBy` | 运行来源：`trigger`、`manual`、`missed_run` |
| `trigger.triggeredAt` | 本次执行开始时间 |
| `trigger.scheduledAt` | 计划触发时间；手动运行时可等于 `triggeredAt` |
| `trigger.automationId` | 自动化 ID |
| `trigger.automationName` | 自动化名称 |

Cron 可额外声明：

| key | 含义 |
|---|---|
| `trigger.cron` | Cron 表达式 |
| `trigger.timezone` | 时区；未配置时为空字符串 |

Interval 可额外声明：

| key | 含义 |
|---|---|
| `trigger.everyMinutes` | 间隔分钟 |
| `trigger.anchor` | 间隔锚点 |

### 事件触发器变量

未来事件触发器使用同一套模型。事件对象字段来自 `AutomationTriggerEvent`：

| key | 含义 |
|---|---|
| `trigger.source` | 事件来源 |
| `trigger.eventType` | 事件类型 |
| `trigger.receivedAt` | 事件接收时间 |
| `trigger.payload.*` | flatten 后的 payload 字段 |

payload flatten 只输出 string/number/boolean/null 等简单叶子值。对象和数组继续向下展开，数组下标使用点路径，例如 `trigger.payload.items.0.title`。`null` 转为空字符串。

## 运行时数据流

1. 自动化触发器命中后，`AutomationService` 构造 `AutomationTriggerRuntimeContext`。
2. `AutomationExecutionService.runItem` 接收该上下文。
3. `ActionRuntimeContext` 增加可选 `templateVariables`。
4. 执行器运行前使用统一 helper 对白名单字段做模板替换。

`ActionRuntimeContext.triggeredBy` 继续保持 action runtime 现有语义：自动化的 `trigger` 会映射为 `schedule`，以兼容定时任务和现有执行器。变量表中的 `trigger.triggeredBy` 保留自动化原始语义：`trigger`、`manual` 或 `missed_run`。

示意类型：

```ts
type AutomationTriggerRuntimeContext = {
  readonly triggeredBy: "trigger" | "manual" | "missed_run"
  readonly triggeredAt: string
  readonly scheduledAt: string
  readonly automationId: string
  readonly automationName: string
  readonly event?: AutomationTriggerEvent
}

type ActionRuntimeContext = {
  readonly taskId: string
  readonly taskName?: string
  readonly runId: string
  readonly triggeredBy: "schedule" | "manual" | "missed_run"
  readonly cwd: string
  readonly actor: ActorIdentity
  readonly abortSignal: AbortSignal
  readonly configVersion?: number
  readonly templateVariables?: Record<string, string>
}
```

`templateVariables` 只传入执行器，不持久化完整事件 payload。运行记录可以保留替换后的结果摘要和执行器原有输出，但必须继续走现有脱敏链路。

## 模板语法

复用工作流的模板风格：

```text
{{trigger.triggeredAt}}
{{$trigger.triggeredAt}}
```

变量名支持字母、数字、中文、下划线、点和短横线。未知变量在执行时失败，并返回明确错误：

```text
未知变量：trigger.payload.issue.title
```

## 执行器覆盖字段

执行器只能替换明确白名单字段。

### Agent

- `prompt`

### 命令

- `command`
- `env` value

### 脚本

- `script`
- `env` value

### HTTP 请求

- `url`
- `query` key/value
- `headers` key/value
- `body`
- Bearer token
- Basic username/password

HTTP auth 字段支持变量替换，但权限摘要、日志、运行记录和错误信息必须保持脱敏。替换后的真实 Authorization、Bearer token、Basic password 不得出现在 renderer、main 日志、run result、audit metadata 或导出文本中。

## UI 细节

触发器面板选中状态下：

- 摘要行继续显示触发器标题、摘要和 `重新选择`。
- 同一区域增加 `变量` 按钮。
- 无变量声明时不显示按钮。
- 弹层内容按分组展示：
  - `触发信息`
  - `触发器配置`
  - `事件内容`（未来事件触发器）
- 点击变量行复制模板并给出短反馈，例如 `已复制`。

文案保持克制，不写功能介绍段落。变量弹层只展示变量名、必要 label 和复制状态。

## 安全与日志

- 模板替换不绕过现有 PermissionGuard 和 AuditSink。
- Permission request 应使用替换后的 URL、header key、auth 类型等可审计信息，但不能记录敏感值。
- HTTP auth 变量替换后仍按现有 Authorization/Bearer/Cookie/token 脱敏规则处理。
- Shell 类执行器不自动转义变量值。用户把变量粘贴到命令或脚本中，等价于手写对应文本。
- 模板变量解析失败时，不执行对应动作。

## 错误处理

- 未知变量：动作失败，错误提示变量名。
- 变量循环不支持，也不会出现，因为变量表只来自触发上下文。
- payload 过深或过大时，flatten helper 应设置深度和数量上限，超过部分跳过并记录结构化 warn，不把原始 payload 写入日志。
- 剪贴板写入失败时，UI 显示复制失败，不影响自动化配置。

## 测试

单元测试：

- 触发器变量声明能被 renderer 读取并显示。
- 变量按钮只在选中且存在变量时出现。
- 点击变量复制 `{{key}}`。
- 自动化事件 payload 能进入 action runtime 的 `templateVariables`。
- Cron/Interval 能生成固定触发变量。
- Agent `prompt` 替换成功，未知变量失败。
- 命令 `command` 和 `env` value 替换成功。
- 脚本 `script` 和 `env` value 替换成功。
- HTTP `url`、`query` key/value、`headers` key/value、`body`、Bearer、Basic 字段替换成功。
- HTTP auth 替换后的真实 token/password 不出现在日志、权限摘要、运行记录或错误信息中。

回归测试：

- 未使用变量的现有自动化行为不变。
- 定时任务的 action runtime 行为不受影响。
- 工作流变量解析不受影响。

## 实施顺序

1. 增加自动化触发器变量描述类型和 Cron/Interval 声明。
2. 在自动化触发器面板增加变量按钮和复制弹层。
3. 增加自动化触发上下文构造和 `ActionRuntimeContext.templateVariables`。
4. 增加 action template helper。
5. 分别接入 Agent、命令、脚本和 HTTP 执行器白名单字段。
6. 补测试与脱敏回归。
