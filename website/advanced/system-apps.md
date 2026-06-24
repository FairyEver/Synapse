# 系统 Apps

<!-- Sources: desktop/src/modules/apps/definitions.ts; desktop/src/modules/apps/registry.ts; desktop/src/modules/apps/components/app-launcher-grid.tsx -->

## 固定列表

Synapse 当前内置以下系统 App：

| App | 职责 |
| --- | --- |
| 资源仓库 | 管理 Skill、Rule 和 Prompt。 |
| Git | 查看仓库状态、提交、同步和处理 Git 错误。 |
| 本地数据库 | 管理表、字段和数据记录。 |
| 模板生成文档 | 使用 `.docx` 模板和 JSON 数据生成文档。 |
| IDE 管理 | 扫描编辑器内容和安装状态。 |
| 用量监控 | 查看 Claude Code 和 Codex 用量。 |
| 价格管理 | 维护模型价格规则和预设。 |

## 能力包约定

同时提供 App UI、MCP 能力或 Workflow node 的系统 App 应按 capability package 组织代码。Document Template 是当前示例，目录位于 `desktop/app-capabilities/document-template/`。

能力包按职责拆分 shared、main、renderer 和 workflow-node。核心业务逻辑放在 main service 中，App UI、IPC、MCP dispatcher 和 Workflow node 只作为入口适配器。
