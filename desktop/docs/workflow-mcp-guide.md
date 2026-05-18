# Workflow MCP 工具参考

供 AI Agent 通过 Synapse MCP 操作工作流的参考文档。

## 1. 系统模型

- 工作流是有向无环图（DAG）
- 节点按拓扑序执行；无依赖关系的节点并行运行
- 每个工作流必须有且仅有一个 `end` 节点，不允许环
- 节点通过有向边连接（`from` → `to`）
- switch 节点的出边必须携带 `branch` 字段

## 2. 变量系统

节点通过 `variables` 列表绑定值，在 prompt 模板中用 `{{variableName}}` 引用。

### 绑定类型

| type | 说明 | 示例 |
|------|------|------|
| `param` | 绑定工作流参数 | `{ "type": "param", "param": "question" }` |
| `node_output` | 绑定上游节点输出 | `{ "type": "node_output", "node": "n1" }` |
| `static` | 硬编码值 | `{ "type": "static", "value": "你是一个翻译助手" }` |

变量在节点执行前解析完毕。变量名支持字母、数字、下划线和中文。

## 3. 图约束

- 必须有且仅有一个 end 节点
- 不允许环（A → B → A）
- switch 的所有分支必须最终到达 end 节点
- switch 节点的出边必须设置 `branch` 字段
- 不允许引用不存在的上游节点输出
- 不允许引用不存在的工作流参数

## 4. 节点类型

### prompt — AI 对话节点

配置字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `providerId` | string | 模型提供商 ID（使用 `"default"` 表示默认） |
| `modelTier` | `"default"` \| `"haiku"` \| `"sonnet"` \| `"opus"` | 模型等级 |
| `prompt` | string | 提示词模板，支持 `{{变量名}}` |
| `variables` | VariableBinding[] | 变量绑定列表 |

输出：AI 回复文本。

### switch — 条件分支节点

配置字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `providerId` | string | 模型提供商 ID |
| `modelTier` | `"default"` \| `"haiku"` \| `"sonnet"` \| `"opus"` | 模型等级 |
| `prompt` | string | 评估提示词，AI 根据此判断走哪个分支 |
| `branches` | `{ id: string, label: string }[]` | 分支列表（id 必须匹配 `/^[a-z][a-z0-9_]*/`） |
| `defaultBranch` | string? | 可选默认分支 ID |
| `variables` | VariableBinding[] | 变量绑定列表 |

输出：激活一个分支。出边必须设置 `branch` 字段对应分支 id。

### end — 终止节点

每个工作流有且仅有一个。

配置字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `outputType` | `"text"` | 输出类型（当前仅支持 text） |
| `template` | string | 输出模板，支持 `{{变量名}}` |
| `variables` | VariableBinding[] | 变量绑定列表 |

输出：工作流最终结果。

## 5. 完整工作流 JSON 示例

### 示例 1：线性链（prompt → end）

```json
{
  "id": "wf-example-1",
  "name": "简单问答",
  "version": "v_1",
  "createdAt": 1700000000000,
  "updatedAt": 1700000000000,
  "params": [
    { "name": "question", "type": "text", "default": null, "description": "用户问题" }
  ],
  "nodes": [
    {
      "id": "n1",
      "name": "AI 回答",
      "type": "prompt",
      "position": { "x": 200, "y": 200 },
      "config": {
        "providerId": "default",
        "modelTier": "default",
        "prompt": "请回答以下问题：{{question}}",
        "variables": [
          { "name": "question", "source": { "type": "param", "param": "question" } }
        ]
      }
    },
    {
      "id": "n2",
      "name": "结束",
      "type": "end",
      "position": { "x": 600, "y": 200 },
      "config": {
        "outputType": "text",
        "template": "{{answer}}",
        "variables": [
          { "name": "answer", "source": { "type": "node_output", "node": "n1" } }
        ]
      }
    }
  ],
  "edges": [
    { "id": "e1", "from": "n1", "to": "n2" }
  ]
}
```

### 示例 2：条件分支（prompt → switch → prompt/prompt → end）

对用户输入进行语言分类，根据语言走不同翻译分支。

```json
{
  "id": "wf-example-2",
  "name": "智能翻译",
  "version": "v_1",
  "createdAt": 1700000000000,
  "updatedAt": 1700000000000,
  "params": [
    { "name": "text", "type": "text", "default": null, "description": "待翻译文本" }
  ],
  "nodes": [
    {
      "id": "n1",
      "name": "语言检测",
      "type": "switch",
      "position": { "x": 200, "y": 300 },
      "config": {
        "providerId": "default",
        "modelTier": "haiku",
        "prompt": "判断以下文本的语言，只回答分支 id：\n\n{{text}}",
        "branches": [
          { "id": "chinese", "label": "中文" },
          { "id": "english", "label": "英文" }
        ],
        "defaultBranch": "english",
        "variables": [
          { "name": "text", "source": { "type": "param", "param": "text" } }
        ]
      }
    },
    {
      "id": "n2",
      "name": "翻译为英文",
      "type": "prompt",
      "position": { "x": 500, "y": 200 },
      "config": {
        "providerId": "default",
        "modelTier": "sonnet",
        "prompt": "将以下中文翻译为英文，只输出译文：\n\n{{text}}",
        "variables": [
          { "name": "text", "source": { "type": "param", "param": "text" } }
        ]
      }
    },
    {
      "id": "n3",
      "name": "翻译为中文",
      "type": "prompt",
      "position": { "x": 500, "y": 400 },
      "config": {
        "providerId": "default",
        "modelTier": "sonnet",
        "prompt": "将以下英文翻译为中文，只输出译文：\n\n{{text}}",
        "variables": [
          { "name": "text", "source": { "type": "param", "param": "text" } }
        ]
      }
    },
    {
      "id": "n4",
      "name": "结束",
      "type": "end",
      "position": { "x": 800, "y": 300 },
      "config": {
        "outputType": "text",
        "template": "{{result}}",
        "variables": [
          { "name": "result", "source": { "type": "node_output", "node": "n2" } }
        ]
      }
    }
  ],
  "edges": [
    { "id": "e1", "from": "n1", "to": "n2", "branch": "chinese" },
    { "id": "e2", "from": "n1", "to": "n3", "branch": "english" },
    { "id": "e3", "from": "n2", "to": "n4" },
    { "id": "e4", "from": "n3", "to": "n4" }
  ]
}
```

注意：end 节点的 `node_output` 绑定只会取到实际执行的上游节点输出。未执行的分支节点输出为空。

## 6. 推荐 Agent 工作流程

```
1. workflow_node_type_list()                          → 了解系统模型 + 可用节点类型
2. workflow_node_type_describe({ nodeType: "prompt" }) → 获取节点配置 JSON Schema
3. workflow_definition_create({ name: "..." })         → 创建空工作流（自带 end 节点）
4. workflow_param_update({ workflowId, params })       → 定义工作流参数
5. workflow_node_create({ workflowId, node })           → 添加节点（position 可省略，自动布局）
6. workflow_edge_create({ workflowId, from, to })       → 连接节点
7. workflow_node_update({ workflowId, nodeId, patch })  → 配置节点（设置 prompt、variables 等）
8. workflow_layout_update({ workflowId })               → 自动排列节点位置（可选）
9. workflow_definition_inspect({ definition })          → 校验完整性
10. workflow_run_execute({ workflowId, params })         → 执行工作流
11. workflow_run_get({ runId })                          → 轮询运行结果
```

关键点：
- 步骤 3 创建的工作流已包含一个 end 节点，无需手动创建
- 步骤 5 中 position 可省略，dispatcher 自动计算布局
- 步骤 8 在批量添加节点后调用，自动整理为左右层级排列
- 步骤 9 可在任何修改后调用，提前发现问题
- 步骤 11 需轮询直到 status 变为 `completed` / `failed` / `cancelled`

## 7. 常见错误

| 错误 | 说明 | 修复 |
|------|------|------|
| 节点未连接到 end | 所有路径必须最终到达 end 节点 | 补充缺失的边 |
| switch 出边缺少 branch | switch 节点的每条出边必须设置 branch 字段 | `workflow_edge_create` 时传入 `branch` |
| 引用不存在的上游输出 | `node_output` 引用的节点不在当前节点的上游 | 检查 DAG 拓扑，确保被引用节点在上游 |
| 引用不存在的参数 | `param` 绑定的名称不在 `params` 列表中 | 先用 `workflow_param_update` 添加参数 |
| 创建环 | A → B → A 形成环路 | 重新设计边的方向，保持 DAG |
| 多个 end 节点 | 每个工作流只允许一个 end 节点 | 删除多余的 end 节点 |
| config 字段缺失 | 节点 config 不符合 schema | 调用 `workflow_node_type_describe` 查看必填字段 |
| branch id 格式错误 | switch 分支 id 必须匹配 `/^[a-z][a-z0-9_]*/` | 使用小写字母开头，仅含小写字母、数字、下划线 |
