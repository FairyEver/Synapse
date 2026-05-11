# 流程模块全链路日志设计

**日期**：2026-05-11  
**状态**：已确认，待实现

## 背景

流程模块（工作流）目前处于开发阶段，测试时需要完整的操作记录和状态变化日志，以便在出现问题后可以直接将日志文件交给 AI 分析，重现完整的操作路径。

## 决策汇总

| 维度 | 决策 |
|------|------|
| 日志落地 | 仅主进程日志文件（`StructuredLogger` → `logStore`） |
| 内容粒度 | 全写，包括节点输入变量、插值后的 prompt、输出内容（截取前 500 字符） |
| 覆盖范围 | 主进程三层：IPC handler、WorkflowService、WorkflowEngine |
| Renderer | 不加日志，主进程已足够覆盖所有操作 |
| 日志模式 | 模块级 `const logger = createMainLogger(category)`，与现有 service 保持一致 |

## 架构

### 改动范围

**仅改动 3 个文件**，不改构造函数签名、不改 `descriptors.ts`、不改 renderer：

| 文件 | Logger 分类 |
|------|------------|
| `electron/services/workflow/workflow-service.ts` | `service.workflow` |
| `electron/services/workflow/workflow-engine.ts` | `service.workflow.engine` |
| `electron/modules/workflow/ipc.ts` | `workflow.ipc` |

### Logger 创建方式

```ts
import { createMainLogger } from "../../services/log-store"
const logger = createMainLogger("service.workflow")
```

每个文件顶部一行，与项目其他 service（`service.repository-git`、`service.content-download` 等）完全一致。

## 各层日志详细设计

### 1. IPC 层（`workflow/ipc.ts`）

职责：记录用户从 UI 发起的每次操作入口及结果，IPC 层是外部可观测的边界。

| 操作 | 入口（info） | 成功（info） | 失败（warn/error） |
|------|------------|------------|------------------|
| `list` | — | `listed N workflows` | — |
| `get` | `{id}` | `got workflow {name}` / `not found` | — |
| `create` | — | `created workflow {id}` | `create failed {errors}` |
| `save` | `{id, name, nodeCount}` | `saved workflow {versionHash}` | `save failed {errors}` |
| `delete` | `{id}` | `deleted workflow` | error |
| `validate` | `{id, nodeCount}` | `validation {valid}, errors={N}, warns={N}` | — |
| `run` | `{workflowId, paramKeys}` | `run started {runId}` | error |
| `cancel` | `{runId}` | `cancel signal sent` | — |
| `openEditor` | `{workflowId, runId?}` | — | — |

所有 catch 块使用 `logger.error(message, err)` 确保 stack trace 写入日志。

### 2. Service 层（`workflow-service.ts`）

职责：记录文件系统操作的结果，便于区分 IPC 正常到达但持久化失败的场景。

- `list()`：`debug` 记录读取到的工作流数量
- `get(id)`：`debug` 记录找到/未找到，以及读取的版本文件名
- `save(def)`：`info` 记录 `{id, name, versionHash}`；`mkdir`/`writeFile` 失败 `error`
- `create()`：`info` 记录新建的 `{id, name}`
- `delete(id)`：`info` 记录删除，`warn` 记录目录已不存在的情况

### 3. Engine 层（`workflow-engine.ts`）

职责：记录运行时最详细的状态变化，包括每个节点的输入输出，是调试的核心日志层。

#### 运行生命周期

```
[run start]    info  {runId, workflowId, nodeCount, reachableCount, params}
[run complete] info  {runId, status:"completed", durationMs, outputPreview}
[run failed]   error {runId, error, durationMs}
[run cancel]   warn  {runId, durationMs, phase:"mid-run"|"pre-start"}
```

#### 节点执行（每个节点）

```
[node:start]   debug {runId, nodeId, nodeType, nodeName,
                      inputVariables: {key: value}, prompt?: "...前200字..."}
[node:success] debug {runId, nodeId, durationMs,
                      outputPreview: "...前500字...", activeBranch?}
[node:failed]  warn  {runId, nodeId, error,
                      inputVariables, prompt?, durationMs}
[node:skipped] debug {runId, nodeId, reason: "overallFailed"|"not-reachable"}
[node:abort]   warn  {runId, nodeId, "aborted mid-execution"}
```

#### 边激活

```
[edge:activate] trace {runId, from, to, branch?}
```

#### 内容截取规则

- **prompt**：截取前 200 字符（prompt 通常较长，截短一些）
- **output**：截取前 500 字符
- 截取时附加 `...(truncated, full in snapshot)` 后缀
- 完整内容不变，仍通过 `RunSnapshotService` 持久化

## 日志格式示例

一次完整运行的日志（可读性示意）：

```
[IPC] workflow.ipc | run | workflowId=abc123 paramKeys=[]
[SVC] service.workflow | get | id=abc123 found version=v_1234_00000001_abcd1234.json
[ENG] service.workflow.engine | run start | runId=run-xyz workflowId=abc123 nodeCount=3 params={}
[ENG] service.workflow.engine | node start | runId=run-xyz nodeId=node-1 type=llm name="分析输入" inputVariables={} prompt="请分析以下内容...(前200字)"
[ENG] service.workflow.engine | node success | runId=run-xyz nodeId=node-1 durationMs=1240 outputPreview="根据你的输入...(前500字)"
[ENG] service.workflow.engine | edge activate | runId=run-xyz from=node-1 to=node-2
[ENG] service.workflow.engine | node start | runId=run-xyz nodeId=node-2 type=end name="结束" inputVariables={result:"根据..."}
[ENG] service.workflow.engine | node success | runId=run-xyz nodeId=node-2 durationMs=5
[ENG] service.workflow.engine | run complete | runId=run-xyz status=completed durationMs=1249
[IPC] workflow.ipc | run complete | runId=run-xyz
```

## 错误场景覆盖

| 场景 | 能从日志定位 |
|------|------------|
| 工作流不存在就运行 | IPC error: "Workflow not found" |
| 保存时文件系统权限不足 | service error: writeFile failed |
| 节点 LLM 调用超时/失败 | engine warn: node:failed + error message |
| 运行中被 abort | engine warn: aborted mid-execution + 哪个节点 |
| 校验失败阻止运行 | IPC warn: validation errors list |
| 变量解析异常 | engine warn: node:failed + 入口变量状态 |

## 不在范围内

- Renderer 侧日志（UI 操作不加，主进程日志已覆盖可观测边界）
- `workflow-validator.ts` 日志（纯同步逻辑，结果通过调用方 IPC 层记录）
- 变量解析器（`variable-resolver.ts`）内部日志（结果通过 node:start 的 inputVariables 体现）
- 运行历史查询（`runHistory`/`runSnapshot`/`runStatus`）的详细日志（只读，无副作用）
