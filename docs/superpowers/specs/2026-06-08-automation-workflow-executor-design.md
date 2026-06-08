# Automation Workflow Executor Design

> 日期：2026-06-08
> 状态：设计确认，等待用户审阅

## 背景

当前 Automation 编辑器右侧动作支持 `命令`、`脚本`、`HTTP 请求` 和 `Agent`。用户指出右侧动作缺少 `工作流`。已有 Automation 设计把产品模型定义为：

```text
Automation = one Trigger + one Executor
```

这个模型仍然成立。本设计只新增一个右侧执行器，让触发器可以启动已保存工作流；不新增工作流触发器，也不把 Automation 改成多动作编排器。

早期 Automation 文档中的 “No Workflow executor in this phase” 是当时阶段边界。本设计确认进入下一阶段：允许新增 Workflow executor，但不改变 Automation Core 的一触发器一执行器边界。

## 目标

- 在 Automation 右侧动作列表新增 `工作流` 执行器。
- 让用户选择一个已保存工作流，并配置该工作流运行参数。
- Automation 触发后无人值守运行目标工作流，不在运行中弹窗补参数。
- 工作流运行结果映射为 Automation run result。
- Automation 运行历史能定位到对应 workflow run，便于查看详情。
- 复用现有 Workflow 运行、校验、快照和 Runner 能力。
- 继续使用现有 shadcn/Radix UI 基线，不新增自定义视觉系统。

## 非目标

- 不新增左侧工作流触发器。
- 不支持一个 Automation 配置多个工作流或多个执行器。
- 不在 Automation 内做工作流编排、分支、并行或循环。
- 不自动打开 Workflow Runner 窗口。
- 不锁定工作流版本；每次运行读取目标工作流当前保存版本。
- 不支持运行中让用户填写缺失参数。
- 不扩展 Workflow 参数类型；第一版沿用 `text` 和 `number`。
- 不记录参数值、Webhook body、prompt、headers、Authorization、token 或其它 secret 到日志、审计或运行摘要。

## 产品模型

新增执行器：

```text
builtin.workflow
```

它和现有 `builtin.command`、`builtin.script`、`builtin.http-request`、`builtin.agent` 同级注册到 Action Runtime。

用户心智：

```text
当一个触发器发生时，运行一个已保存工作流。
```

如果用户需要多个步骤、分支或并行，应先在 Workflow 模块中把这些步骤编排成工作流，再由 Automation 触发该工作流。

## 配置模型

```ts
interface WorkflowActionConfig {
  readonly workflowId: string
  readonly paramTemplates: Record<string, string>
}
```

字段含义：

- `workflowId`：目标工作流 ID。
- `paramTemplates`：目标工作流参数模板。key 是工作流参数名，value 是模板文本，支持现有 Automation template variables，例如 `{{trigger.triggeredAt}}`、`{{trigger.request.body.title}}`。

版本语义：

- 配置只保存 `workflowId` 和参数模板。
- 不保存 workflow definition snapshot。
- 目标工作流修改并保存后，Automation 下次运行使用新版。
- 当次实际运行的 workflow version 仍由 Workflow run snapshot 保存，方便排查。

## 编辑器交互

右侧 `就执行以下操作` 的未选中列表新增一行：

```text
工作流                         选择
运行已保存的工作流
```

保持现有选择列表样式：

- 普通行无背景、无分割线。
- hover 使用 `bg-muted/50`。
- 不加图标、不加装饰色。
- 文案只保留名称、短摘要和 `选择`。

选中 `工作流` 后，右侧切换为执行器配置面板：

1. 已选摘要行
   - 标题：`工作流`
   - 摘要：已选择时显示目标工作流名称；未选择时显示 `选择工作流`
   - 右侧保留 `重新选择`

2. 选择工作流
   - 使用现有 shadcn Select/Combobox 模式，列出已保存工作流。
   - 列表项显示工作流名称，必要时显示节点数或更新时间作为轻量元信息。
   - 不允许选择已删除或无法加载的工作流。

3. 参数
   - 选择工作流后读取目标工作流当前 `params`。
   - 每个参数一行。
   - label 优先使用参数 `description`，没有则使用参数名。
   - `text` 参数使用 `Input` 或 `Textarea`，具体跟随现有表单组件可用性。
   - `number` 参数也用文本模板输入保存，运行前渲染并校验为数字。
   - 参数没有默认值且模板为空时，保存期或运行前提示必填缺失。
   - 如果目标工作流没有参数，显示短状态：`无需参数`。

模板输入不新增复杂变量选择器。第一版允许用户直接输入现有 Automation 变量名。Webhook 变量可以使用现有形态，例如：

```text
{{trigger.request.body.title}}
{{trigger.request.query.id}}
{{trigger.triggeredAt}}
```

## 默认与同步行为

选择工作流时初始化 `paramTemplates`：

- 如果目标参数有默认值，模板初始为空，运行时使用默认值。
- 如果目标参数没有默认值，模板初始为空，并在保存校验中提示补充。
- 如果用户切换目标工作流，重新按新工作流参数生成模板，但保留同名参数已有输入。

目标工作流参数变化后的行为：

- 已保存 Automation 打开编辑器时，读取目标工作流当前参数。
- 新增参数显示为空模板，按必填规则校验。
- 删除参数对应的旧模板不再显示，运行时忽略。
- 参数类型从 `text` 改为 `number` 后，运行前按数字规则校验。

## 运行语义

Automation 触发后执行 `builtin.workflow`：

1. 读取目标工作流当前保存版本。
2. 校验目标工作流存在。
3. 使用现有 `validateWorkflow` 校验目标工作流。
4. 使用 Automation execution context 的 `templateVariables` 渲染 `paramTemplates`。
5. 根据目标工作流 `params` 补默认值并校验必填值。
6. 数字参数渲染结果必须是有效数字。
7. 通过窄接口启动 Workflow run。
8. 等待 Workflow run 终态。
9. 将 Workflow 终态映射为 Automation run result。

结果映射：

- Workflow `completed` -> Automation `success`
- Workflow `failed` -> Automation `failed`
- Workflow `cancelled` -> Automation `cancelled`
- Automation stop 时取消对应 Workflow run，并返回 `cancelled`

Action result 输出：

```ts
interface WorkflowActionOutputs {
  readonly workflowId: string
  readonly workflowName: string
  readonly workflowRunId: string
  readonly workflowStatus: "completed" | "failed" | "cancelled"
  readonly output?: string
}
```

Automation run `summary` 使用短句：

```text
工作流完成：每日汇总
工作流失败：每日汇总
工作流已停止：每日汇总
```

## 运行接口边界

不要让 action package 直接依赖 WorkflowService、Electron IPC 或 renderer bridge。主进程注册 `builtin.workflow` 时注入窄依赖：

```ts
interface WorkflowActionRuntimeDeps {
  readonly listWorkflows: () => Promise<readonly WorkflowMeta[]>
  readonly getWorkflowDefinition: (workflowId: string) => Promise<WorkflowDefinition | null>
  readonly runWorkflowAndWait: (input: {
    readonly workflowId: string
    readonly params: Record<string, unknown>
    readonly abortSignal: AbortSignal
    readonly triggerSource: "automation"
    readonly automationId: string
    readonly automationRunId: string
  }) => Promise<{
    readonly runId: string
    readonly definition: WorkflowDefinition
    readonly result: WorkflowRunResult
  }>
}
```

Renderer 配置表单只能通过 preload 暴露的窄 workflow list/get 能力读取元数据，不直接访问 Electron 或数据仓库。

现有 `createRunWorkflowHandler` 可作为实现参考，但需要抽出可等待终态、可传入外部 abort signal、可标记 triggerSource 的共享能力，避免复制一套 Workflow runner。

## Runner 与历史

Automation 执行工作流时不自动打开 Workflow Runner 窗口。

Automation 运行历史中，如果 result outputs 包含 `workflowRunId`：

- 显示工作流名称和终态。
- 提供 `打开运行记录` 操作。
- 点击后调用现有 `workflow.openRunner(workflowId, workflowRunId)`。

行内操作必须阻止冒泡，不能触发 Automation 行主操作。

## 权限、审计和日志

Workflow action 的权限声明建议使用：

```text
workflow.run
```

权限请求资源包含 workflow id 和 workflow name。权限检查通过后才启动 Workflow run。

审计记录只包含：

- automationId
- automationRunId
- workflowId
- workflowName
- workflowRunId
- paramKeys
- status

日志和审计不得记录：

- 参数值
- 渲染后的参数对象
- Webhook request body/query/header 值
- Agent prompt
- HTTP body
- Authorization、Bearer、Cookie、token、apiKey、env secret

## 错误提示

配置期错误：

```text
选择工作流
工作流不存在
参数「topic」不能为空
参数「limit」必须是数字
未知变量：trigger.request.body.title
```

运行期错误：

```text
工作流不存在
工作流校验失败：节点「生成摘要」缺少模型配置
参数「topic」不能为空
参数「limit」必须是数字
工作流已有运行中的实例
```

错误文案保持短句，只指向用户可修复对象。

## UI 规则

- 使用现有 `TriggerExecutorBuilder`、`rendererActionRegistry` 和 shadcn/Radix 组件组合。
- 不新增自定义颜色、hex/rgb/hsl、Tailwind 任意色、渐变、glow、装饰 icon 或营销文案。
- 不使用卡片套卡片。
- 不在普通场景添加内联 `style`。
- 参数表单沿用现有 `Field`、`Label`、`Input`、`Textarea`、`Button` 等组件。
- 右栏保持当前两列 builder 的密度和对齐。

## 测试

Renderer：

- 动作选择列表出现 `工作流`。
- 选择 `工作流` 后显示工作流选择器。
- 选择目标工作流后显示其参数。
- 无参数工作流显示 `无需参数`。
- 切换工作流时保留同名参数输入。
- `重新选择` 只清空右侧执行器，不影响左侧触发器。
- 保存时校验未选 workflow、必填参数和数字参数。
- 运行历史中有 workflow outputs 时显示并打开对应 Runner。

主进程/运行时：

- `builtin.workflow` 注册到 MainActionRegistry。
- 权限拒绝时不启动 Workflow run。
- 参数模板使用 Automation template variables 渲染。
- 缺失变量、缺失必填参数、非法数字参数返回失败。
- 目标工作流不存在返回失败。
- 目标工作流 validate 失败返回失败。
- Workflow completed 映射为 Automation success。
- Workflow failed 映射为 Automation failed。
- Workflow cancelled 或 Automation stop 映射为 Automation cancelled。
- Automation stop 传递 abort signal 并取消 Workflow run。
- result outputs 包含 workflowId、workflowName、workflowRunId、workflowStatus 和 output。

回归：

- 现有命令、脚本、HTTP 请求、Agent 执行器列表和配置不变。
- Automation 仍只能保存一个触发器和一个执行器。
- 旧 Task Scheduler 不受影响。
- Workflow 列表运行、编辑器运行、Runner hydrate、运行快照行为不变。
- 脱敏测试覆盖参数值、Webhook body、Authorization、Bearer、Cookie、token、apiKey 和 env secret。

## Release Note

实现时需要记录到 `RELEASE_NOTES_PENDING.md`：自动化动作新增“工作流”，用户可以用 Cron、固定间隔或 Webhook 触发已保存工作流，并把触发数据传入工作流参数。
