# Document Template

<!-- Sources: desktop/app-capabilities/document-template; desktop/synapse-capabilities/shared/app-domain.ts -->

## 功能范围

Document Template 是系统 App capability package。它从本地 `.docx` 模板和 JSON object 数据生成本地 `.docx` 文件。

该能力同时提供 App UI、IPC、MCP tool 和 Workflow node。核心生成逻辑位于 capability package 的 main service，入口适配器不复制业务逻辑。

## 输入输出

生成时需要提供模板路径、输出路径，以及 `dataPath` 或 inline `data`。`dataPath` 和 `data` 只能提供一个。

当输出文件已存在时，默认拒绝覆盖；显式传入 overwrite 后才替换目标文件。

## MCP 与 Workflow

MCP tool 名为 `app_document_template_docx_generate`，能力 ID 为 `app.document_template.docx.generate`。

Workflow node 类型为 `document_template_docx_generate`，用于在 Workflow 中调用同一份生成能力。
