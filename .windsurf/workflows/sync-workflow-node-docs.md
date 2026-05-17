---
description: 审计并同步工作流节点类型的文档，确保 MCP 工具描述和内置 Skill 与代码中实际注册的节点类型保持一致
---

# 同步工作流节点类型文档

当工作流新增、修改或删除了节点类型后，运行此审计流程确保所有对外暴露的描述保持同步。

## 审计范围

需要检查以下四个位置是否与代码中实际注册的节点类型一致：

### 真实来源（Source of Truth）

1. **节点注册表** — `desktop/workflow-nodes/register.main.ts` 列出所有已注册的节点类型
2. **各节点 manifest** — `desktop/workflow-nodes/*/manifest.ts` 定义 type、title、ports、configFields
3. **各节点 schema** — `desktop/workflow-nodes/*/schema.ts` 和 `desktop/action-packages/builtin/*/schema.ts` 定义完整 config 结构

### 需要同步的目标

1. **MCP 工具静态描述** — `desktop/synapse-capabilities/shared/workflow-domain.ts`
   - `workflow_node_type_describe` 的 `nodeType` 参数 description 中列举的类型
   - `workflow_node_create` 的 `node.type` 参数 description 中列举的类型
   - 确认 `buildWorkflowTools()` 中所有 node type 枚举字符串都包含全部已注册类型

2. **Skill content.md** — `desktop/resources/templates/skills/synapse-workflow/content.md`
   - `## Node Types` 部分列出每种节点及说明
   - `## Provider / Model Configuration` 部分区分哪些需要 provider、哪些不需要
   - `## Variable Bindings` / `## Best Practices` 等部分如有节点特有的注意事项

3. **Skill api-reference.md** — `desktop/resources/templates/skills/synapse-workflow/files/api-reference.md`
   - `## Node Type Config Reference` 部分列出每种节点的 config 字段说明
   - 字段列表必须与对应 schema.ts 中的 zod 定义一致

4. **MCP 动态发现**（通常不需手动修改）
   - `workflow_node_type.list` handler 通过 `nodeTypeRegistry.listTypes()` 自动返回
   - `workflow_node_type.describe` handler 通过 `nodeTypeRegistry.getManifest()` 自动返回
   - 仅需确认 `register.main.ts` 中注册了新节点即可

## 执行步骤

1. 读取 `desktop/workflow-nodes/register.main.ts`，获取完整的已注册节点类型列表
2. 对比上述四个目标，逐一检查是否包含所有节点类型
3. 输出审计表格：检查项 | 状态（✅/❌/⚠️）| 说明
4. 对所有标记为 ❌ 或 ⚠️ 的项，直接进行修复
5. 修复后再次确认文件内容正确
