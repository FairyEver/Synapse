# 工作流节点类型扩展设计

## 背景

Synapse 工作流当前有三种节点：`prompt`（LLM 调用）、`switch`（LLM 分支判断）、`end`（输出模板）。需要扩展节点类型以支持 DevOps 自动化场景。

## 设计约束

- 执行环境：纯本地 Electron 主进程
- 输出模型：允许副作用，统一 string 输出（保持现有 `NodeExecutionResult.output: string`）
- 复用目标：与定时任务 Action Runtime 共享执行原语、config schema、配置表单组件

## 共享架构

### 三层结构

```
Layer 0: 执行原语（共享）
  action-packages/builtin/shell-process.main.ts
  electron/runtime/network.ts (sendOutboundHttpRequest)

Layer 1: 声明层（共享）
  action-packages/builtin/<type>/schema.ts         ← config schema
  action-packages/builtin/<type>/config.renderer.tsx ← 配置表单组件

Layer 2a: 定时任务编排（独立）
  action-packages/builtin/<type>/executor.main.ts  ← 权限检查 + 审计
  action-packages/builtin/<type>/manifest.ts       ← 调度器 manifest

Layer 2b: 工作流节点编排（独立）
  workflow-nodes/<type>/schema.ts                   ← extend 共享 schema + variables
  workflow-nodes/<type>/executor.main.ts            ← 变量插值 + 进度回调
  workflow-nodes/<type>/manifest.ts                 ← ports/card/icon
  workflow-nodes/<type>/panel.tsx                   ← 嵌入共享表单 + 编排 UI
  workflow-nodes/<type>/card.tsx
```

### 共享表单组件适配

现有 `config.renderer.tsx` 组件的 HTML id 前缀硬编码为 `task-action-*`。改为接收可选 `idPrefix` prop（默认保持现有值），工作流侧传入 `workflow-node-*` 前缀。

### 工作流节点 schema 模式

```typescript
// workflow-nodes/command/schema.ts
import { commandActionConfigSchema } from "../../action-packages/builtin/command/schema"
import { variableBindingSchema } from "../schemas/variable-binding"

export const commandNodeConfigSchema = commandActionConfigSchema.extend({
  variables: z.array(variableBindingSchema),
})
```

### 执行原语注入

工作流引擎需要访问 `ControlledProcessRunner` 和 `sendOutboundHttpRequest`。扩展 `NodeExecutionInput` 增加 `runtimeDeps` 字段：

```typescript
export interface NodeRuntimeDeps {
  processRunner: Pick<ControlledProcessRunner, "run">
  sendHttpRequest: (request: OutboundHttpRequest) => Promise<OutboundHttpResponse>
  platform: NodeJS.Platform
  defaultCwd: string
}

export interface NodeExecutionInput<TConfig> {
  config: TConfig
  resolvedVariables: Record<string, string>
  context: WorkflowRuntimeContext
  agentDeps: AgentSendDeps
  runtimeDeps: NodeRuntimeDeps      // 新增
  onProgress?: (phase: string, label: string) => void
}
```

`WorkflowEngine` 构造时注入 `NodeRuntimeDeps`，传递给所有节点。现有 prompt/switch/end 节点不使用此字段，无需改动。

## 节点优先级排序

### 第一梯队：架构零改动，解锁核心场景

#### 1. HTTP Request 节点

- 类型标识：`http_request`
- 复用：`action-packages/builtin/http-request/schema.ts` + `config.renderer.tsx` + `sendOutboundHttpRequest`
- 输出：response body 字符串
- 配置：method, url, query, headers, bodyType, body, timeoutMins + variables
- 场景：企业微信 webhook、API 调用、CI 触发、通知推送

#### 2. Script 节点

- 类型标识：`script`
- 复用：`action-packages/builtin/script/schema.ts` + `config.renderer.tsx` + `runShellAction`
- 输出：stdout 字符串
- 配置：script (多行文本), shell, env, pathStrategy, posixLogin, timeoutMins + variables
- 场景：git 操作、构建触发、部署脚本、复杂多步骤脚本
- 特殊：script 字段支持 `{{变量}}` 插值
- 说明：定时任务侧拆分了 command（单行）和 script（多行），工作流侧合并为一个 script 节点——单行命令本身就是一行脚本，Textarea 输入统一覆盖两种场景

#### 3. Condition 节点（非 LLM 分支）

- 类型标识：`condition`
- 不复用 action-packages（无对应 action）
- 输出：匹配的分支 ID
- 配置：
  - variables（输入绑定）
  - subject：要判断的变量名
  - rules：`Array<{ branch: string; op: "equals" | "contains" | "regex" | "gt" | "lt" | "empty"; value?: string }>`
  - defaultBranch：无匹配时的默认分支
- ports：动态输出端口（同 switch）
- 场景：检查 HTTP 状态码、命令退出码、字符串匹配——不需要 LLM，更快更可靠更便宜

### 第二梯队：补全流水线

#### 4. Template 节点

- 类型标识：`template`
- 不复用 action-packages
- 输出：渲染后的模板字符串
- 配置：template 字符串 + variables
- 与 end 节点区别：end 是终止节点（必须唯一），template 是中间处理节点
- 场景：拼接 API body、格式化通知消息、组装多步骤结果

#### 5. File Read 节点

- 类型标识：`file_read`
- 输出：文件内容字符串
- 配置：path（支持变量插值）、encoding（默认 utf-8）
- 安全：路径必须在项目目录或用户显式允许的目录内

#### 6. File Write 节点

- 类型标识：`file_write`
- 输出：写入的文件路径
- 配置：path、content（支持变量插值）、mode（overwrite | append）
- 安全：同 file_read

### 第三梯队：需要调度器改造

#### 7. Delay 节点

- 类型标识：`delay`
- 输出：空字符串（透传）
- 配置：delayMs 或 delaySeconds
- 影响：ReactiveScheduler 当前是"尽快执行"，需要在 executor 内 `setTimeout` + abort 处理
- 变通：可在 command 节点用 `sleep` 命令替代

#### 8. Loop 节点

- 类型标识：`loop`
- 需要调度器支持动态展开或重复执行
- 架构改动最大，暂不设计

### 第四梯队：锦上添花

- **Merge 节点**：显式合并多分支输出（当前变量绑定已覆盖大部分场景）
- **Sub-workflow 节点**：调用另一个工作流（需要组合基础设施）

## 注册机制

新节点遵循现有模式：

```typescript
// workflow-nodes/register.main.ts — 追加
import { commandNodeManifest, commandNodeExecutor } from "./command"
nodeTypeRegistry.register(commandNodeManifest, commandNodeExecutor)

// workflow-nodes/register.renderer.ts — 追加
import { commandNodeManifest } from "./command/manifest"
nodeTypeRegistry.registerManifest(commandNodeManifest)
```

## 实现顺序建议

1. 先做基础设施改动：`NodeExecutionInput` 增加 `runtimeDeps`，`WorkflowEngine` 注入依赖
2. 共享表单组件增加 `idPrefix` prop
3. 按优先级逐个实现节点：HTTP → Script → Condition → Template → File → Delay
4. 每个节点独立 PR，包含：schema + executor + manifest + panel + card + 测试
