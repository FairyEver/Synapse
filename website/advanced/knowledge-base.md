# Knowledge Base

<!-- Sources: AGENTS.md; docs/agent-guides/knowledge-base.md; desktop/electron/services/knowledge-base; desktop/src/modules/knowledge-base; desktop/src/modules/settings/components/project-list-editor.tsx -->

## 功能范围

Knowledge Base 是 Synapse 托管项目类型。用户在设置中创建知识库项目后，界面显示虚拟路径 `synapse-kb://<id>`，真实 backing directory 由 Synapse 放在 managed storage 中。

托管 runtime 包含知识库模板、Claude Code plugin、skills、commands、hooks、scripts、`CLAUDE.md`、wiki 目录和 `.raw` 原始资料目录。普通项目不加载 Knowledge Base runtime。

## 资料管理

Knowledge Base 资料管理窗口管理 `.raw` 文件。上传和拖拽上传会把用户选择的文件原样复制到当前 `.raw` 文件夹，不自动转换为 Markdown，也不生成额外 originals 目录。

资料摄入由知识库 runtime 的 native slash 或显式命令处理。Synapse 不在上传入口自动解析 PDF、Office、图片或音视频。

## Agent 行为

Knowledge Base Agent 会话解析到 backing directory，并把该目录作为 Claude Code SDK local plugin 加载。`/wiki-ingest`、`/save` 等命令作为 plugin native slash 透传给 Claude SDK。

Native slash passthrough 只记录命令名，不记录参数正文、路径列表或其他用户输入内容。

## 存储迁移

Knowledge Base storage root 可迁移。迁移过程需要阻止知识库写入和会话启动，并在复制、校验、切换和旧目录清理阶段保留恢复状态。

自定义 storage root 不可访问时，知识库创建、资料管理和 Agent 会话启动停止，只允许重新检测。
