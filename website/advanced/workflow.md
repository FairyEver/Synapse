# Workflow

<!-- Sources: desktop/src/modules/workflow/index.tsx; desktop/workflow-nodes/*; desktop/electron/services/workflow; desktop/synapse-capabilities/shared/workflow-domain.ts -->

## 功能范围

Workflow 使用有向无环图定义自动化流程。每个 Workflow 包含参数、节点、边、默认项目、默认 provider、默认模型档位和运行快照。

当前节点类型包括 prompt、switch、HTTP request、script、workflow call、Codex、Claude Code 和 end。Workflow 必须包含一个 end 节点，节点之间通过有向边连接，switch 分支通过边上的 branch 字段表达。

## 运行与记录

Workflow 可从界面运行，也可通过 MCP 执行。运行结果按节点记录状态、耗时、输入输出、错误和 token 用量。运行窗口支持查看 DAG、时间线、节点结果和运行报告。

文件和目录参数使用 resource reference 表达，例如本地路径引用，不直接把文件内容写入 Workflow 定义。

## MCP 能力

Workflow MCP 提供节点类型发现、定义查询、定义校验、定义创建、整体更新、节点与边的原子修改、参数更新、运行、取消、运行历史和自动布局。

修改 Workflow 时应先读取现有定义，再按受控路径变更并校验。校验失败不得保存。

## 注意事项

Workflow 保持 DAG 约束，不支持循环边。需要循环行为时，应使用产品约定的 loop 子图能力，而不是在配置里写隐藏表达式。
