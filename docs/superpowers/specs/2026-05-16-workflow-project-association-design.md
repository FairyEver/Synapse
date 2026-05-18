# Workflow Project Association

工作流 prompt 节点缺少项目（工作目录）关联，导致 agent 运行时无法确定在哪个目录下执行。本设计为工作流增加项目选择能力。

## 核心概念

"项目"在工作流语境下 = agent 的工作目录（working directory）。等效于用户在终端 `cd /path/to/project && claude`。

## 解析顺序

```
节点 projectId → 工作流 defaultProjectId → ~/（用户 home 目录）
```

三级 fallback，从具体到通用。

## 数据模型变更

### WorkflowDefinition

```typescript
export interface WorkflowDefinition {
  // ... existing fields
  defaultProjectId?: string  // 新增：工作流级别默认项目 UUID
}
```

### Prompt Node Config

```typescript
export const promptNodeConfigSchema = z.object({
  providerId: z.string().min(1),
  modelTier: z.enum(["default", "haiku", "sonnet", "opus"]),
  variables: z.array(variableBindingSchema),
  prompt: z.string(),
  projectId: z.string().optional(),  // 新增：节点级别项目 override
})
```

### Switch Node Config

同 prompt 节点，增加可选 `projectId` 字段（switch 节点也调用 agent）。

## 运行时解析

`workflow-engine.ts` 中，每个节点执行前解析实际 projectId：

```typescript
function resolveProjectId(
  nodeConfig: { projectId?: string },
  workflowDef: WorkflowDefinition,
): string | undefined {
  return nodeConfig.projectId ?? workflowDef.defaultProjectId ?? undefined
}
```

返回 `undefined` 时，engine 使用 `os.homedir()` 作为工作目录。

## UI 变更

### 工作流编辑器顶栏（toolbar.tsx）

在"描述"输入框右侧、参数按钮左侧，增加项目选择器：

- 组件：下拉选择器，数据源为 `RepositoryManager.getRepositories()`
- 占位文本："默认项目（可选）"
- 选中后显示项目名称
- 可清除（恢复为未选择状态）
- 变更时更新 `definition.defaultProjectId`，标记 dirty

### Prompt 节点配置面板

在现有 provider/model 配置区域下方，增加项目选择器：

- 组件：同顶栏的项目选择器
- 占位文本："继承默认" 或 "继承: {默认项目名}"（如果工作流有默认项目则显示其名称）
- 选中后显示项目名称
- 可清除（恢复为继承默认）

### Switch 节点配置面板

同 prompt 节点，增加相同的项目选择器。

## 项目选择器组件

复用或提取一个通用的 `ProjectSelect` 组件：

```typescript
interface ProjectSelectProps {
  value?: string                    // projectId UUID
  onChange: (id: string | undefined) => void
  placeholder?: string             // 默认 "选择项目"
  clearable?: boolean              // 是否可清除，默认 true
}
```

数据源：通过 IPC 获取仓库列表（`window.synapse.repository.list()` 或类似接口）。

## 存储兼容性

- `defaultProjectId` 是可选字段，旧工作流 JSON 无此字段时行为不变
- 节点 `projectId` 是可选字段，旧节点无此字段时继承工作流默认
- 无需迁移脚本

## 验证规则

- `defaultProjectId` 如果填写，必须是有效的仓库 UUID（运行时校验，仓库可能被删除）
- 节点 `projectId` 同上
- 运行时如果引用的项目不存在，报错提示"项目 {name} 不存在，请重新选择"

## 不做的事

- 不在项目上绑定 provider/model（已废弃）
- 不做项目间文件隔离（agent 可以访问任何目录）
- 不做工作流与项目的强绑定（工作流仍然是全局的，存储在当前 repo 下）
