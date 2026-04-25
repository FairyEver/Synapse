---
schema_version: 1
task_id: mcp-tools-docs
title: "更新 MCP Tools 文档"
project_root: /Users/liyang/Documents/code/github/Synapse

mode: unattended
language: zh-CN

git:
  base_branch: main
  work_branch: codex/unattended-mcp-tools-docs
  commit_policy: commit_per_task
  pre_run_snapshot: require_clean
  push_allowed: false

risk_budget:
  allow_dependency_install: false
  allow_schema_migration: false
  allow_destructive_file_ops: false
  allow_dev_server: false
  allow_gui_smoke_test: false
  allow_network_access: false
  allow_commit: true
  allow_push: false

limits:
  max_task_attempts: 3
  max_audit_rounds: 10
  heartbeat_interval_seconds: 60

gates:
  typecheck: "pnpm desktop:typecheck"
  test: null
  lint: null
  build: "pnpm desktop:build"
---

# MCP Tools 文档更新任务

## 1. 背景

Synapse Data Store 提供了 20 个 MCP (Model Context Protocol) 工具，允许 AI 编辑器直接操作 SQLite 数据库。当前文档需要更新以准确反映这些工具的实际能力和使用方式。

Data Store 的能力包括：
- 20 个标准化 MCP 工具（DDL、DML、结构变更）
- 四种访问接口：CLI / MCP / HTTP / IPC
- 自动注册到 Claude Code、Cursor、Codex、Windsurf 等编辑器
- 支持列类型：text, integer, decimal, boolean, date, timestamp, single_choice, multi_choice, json, binary

## 2. 目标

- 更新现有文档，准确描述 20 个 MCP 工具的功能和参数
- 补充 Data Store 的四种访问方式（CLI/MCP/HTTP/IPC）说明
- 完善列类型定义和约束规则文档
- 确保所有示例代码符合实际工具 schema
- 保持与 website-copy.md 文案规范一致

## 3. 非目标

- 不新增文档页面或导航项
- 不修改 MCP 工具的实现代码
- 不新增 Data Store 功能
- 不修改网站整体结构或样式

## 4. 输入文档

- 上游任务 Markdown: `null`
- SPEC: `desktop/data-store/shared/mcp-tools.ts` (工具定义源码)
- 项目约束: `.claude/rules/website-copy.md` (文案规范)
- 其他参考:
  - `desktop/data-store/shared/mcp-rpc.ts` (MCP 协议实现)
  - `desktop/electron/data-store/mcp-installer.ts` (MCP 自动注册逻辑)
  - `desktop/electron/data-store/cli-installer.ts` (CLI 安装逻辑)
  - `website/.vitepress/config.mts` (导航配置)

## 4.1 上游 Markdown 合并摘要

原始模板为通用任务模板，本次针对 MCP Tools 文档更新场景进行特化：
- 明确文档范围：仅更新现有章节，不新增页面
- 明确参考源码：mcp-tools.ts 为工具定义的唯一事实来源
- 明确约束：遵循 website-copy.md 的专业、克制文案风格

## 5. 允许修改范围

- `website/guide/features.md` - 补充 Data Store / MCP 功能描述
- `website/guide/concepts.md` - 补充 Data Store 概念说明（如适用）
- `website/guide/introduction.md` - 调整产品介绍中的功能边界描述
- `website/index.md` - 更新首页 features 中的 Data Store 相关描述

## 6. 禁止修改范围

- 不得新增 `.vitepress/config.mts` 中的导航项或侧边栏条目
- 不得新增独立的 markdown 文件
- 不得修改 `.claude/rules/` 下的规范文件
- 不得修改 `desktop/` 下的源码（仅作参考）

## 7. 任务拆分要求

按以下顺序执行：

**Phase 1: 核心概念补充**
- 在 concepts.md 中补充 Data Store 作为底层存储的概念说明
- 说明 CLI / MCP / HTTP / IPC 四种访问接口的关系

**Phase 2: 功能特性更新**
- 在 features.md 中补充 Data Store 功能章节
- 列出 20 个 MCP 工具的分类说明（DDL/DML/结构变更）
- 说明 MCP 自动注册到编辑器的机制

**Phase 3: 产品介绍校准**
- 在 introduction.md 中校准产品边界描述
- 确保不声称未实现的功能（如 AI 对话、RAG 等）

**Phase 4: 首页特性更新**
- 在 index.md 中更新 features 列表
- 确保 Data Store 相关描述准确

**Phase 5: 自检与审计**
- 对照 website-copy.md 规范检查所有修改
- 验证所有示例符合 mcp-tools.ts 中的实际 schema

## 8. 验收标准

- [ ] concepts.md 包含 Data Store 概念说明（如有必要）
- [ ] features.md 包含完整的 Data Store 功能描述，包括：
  - 四种访问接口（CLI / MCP / HTTP / IPC）
  - 20 个 MCP 工具的分类列表
  - 自动注册到编辑器的机制说明
- [ ] 所有列类型（10 种）及其约束在文档中有准确说明
- [ ] 无营销腔、口语化表达，符合 website-copy.md 规范
- [ ] 无产品未实现的功能描述
- [ ] 所有示例代码符合 mcp-tools.ts 中的实际 schema
- [ ] 文档站点可正常构建 (`pnpm website:build`)

## 9. 风险点

- **风险**: 文档与源码实现不一致
  - **缓解**: 所有工具描述必须以 `mcp-tools.ts` 为准，修改前需对照源码
- **风险**: 新增内容违反 website-copy.md 规范
  - **缓解**: Phase 5 专门进行文案规范审计
- **风险**: 误删现有有效内容
  - **缓解**: 采用增量修改，保留原有章节结构

## 10. Blocked 策略

单任务失败 3 次后标记 blocked，写入报告，继续后续任务。需要被禁用能力支持的任务应 deferred，不要硬做。

## 11. 最终产物

- `reports/COMPLETION-REPORT.md`
- `reports/SELF-AUDIT.md`
- `reports/FOLLOW-UP-PLAN.md`
- `state/PROGRESS.md`
