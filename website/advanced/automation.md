# Automation

<!-- Sources: desktop/src/modules/automation/index.tsx; desktop/automation-trigger-packages/builtin/*; desktop/action-packages/builtin/*; desktop/synapse-capabilities/shared/automation-domain.ts -->

## 功能范围

Automation 是一个 trigger 加一个 executor 的运行配置。配置包含名称、启用状态、作用域、工作目录、触发器、执行器和运行策略。

内置 trigger 包括 cron、interval 和 webhook。内置 executor 包括命令、脚本、HTTP request、Agent 和 Workflow。

## 运行记录

Automation 页面展示条目列表、启停状态、手动运行入口、停止运行入口和运行历史。运行历史记录状态、时间、输出摘要和失败信息。

Webhook trigger 依赖账号侧 webhook 配置。Automation runtime 可通过 inspect 能力查看已注册计时器、正在运行的条目和运行状态摘要。

## MCP 能力

Automation MCP 提供条目列表、读取、创建、更新、删除、启用、停用、手动运行、停止运行、运行历史、runtime inspect、Webhook 列表、trigger 类型发现和 executor 类型发现。

创建或替换 trigger / executor 配置前，应先调用类型发现工具读取当前 schema。

## 注意事项

Automation 不在单个条目里编排多个执行器。需要多步骤、分支或并行时，先创建 Workflow，再由 Automation 触发该 Workflow。
