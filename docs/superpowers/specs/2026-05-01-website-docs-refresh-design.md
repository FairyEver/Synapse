# Synapse 文档站完善设计

## 背景

当前 `website/` 是 VitePress 文档站，已有首页、产品介绍、核心概念、功能特性、下载与 FAQ。现有内容更接近早期产品介绍，尚未形成面向普通使用者、团队协作者和开发者的完整任务型文档。

本次目标是将文档站补齐到可发布状态，但只写当前仓库和应用中已经实现、可以从代码或现有文档确认的功能。

## 目标

- 建立任务路径优先的信息架构。
- 覆盖普通使用者、团队管理员、开发者三类读者，其中普通使用者优先。
- 将成熟主线功能放在主要阅读路径中。
- 将高级功能放在独立分区中克制说明，不抢占新用户路径。
- 内容达到可发布状态，避免占位页、路线图承诺和未实现功能描述。

## 非目标

- 不实现或修改桌面端功能。
- 不根据愿景补写尚未实现的能力。
- 不新增设计系统或改造 VitePress 主题视觉。
- 不重写仓库中与文档站无关的内容。
- 不处理 `desktop/` 当前未提交改动。

## 硬性内容约束

每一部分文档在编写前必须先读懂对应代码或现有权威文档，不能猜测功能。

执行时需要为每个文档分区建立最小证据来源：

- 普通使用者主线：读取 `website/` 现有文档、`desktop/src/modules/rules/`、`desktop/src/modules/skills/`、`desktop/src/modules/settings/`、相关 Electron content/editor 服务。
- 团队协作：读取内容创建、提交、仓库结构、Git 服务相关代码，例如 `desktop/electron/services/content-*`、`repository-*`、`pending-pushes-service.ts`。
- 高级功能：逐页读取对应 renderer 模块与 Electron IPC/service，例如 Agent、Prompts、Data Store、Task Scheduler、Editor Scan、Diagnostics。
- 开发者文档：读取根目录 `README.md`、`desktop/README.md`、`package.json`、`desktop/package.json`、Electron runtime/bootstrap 结构。

如果某个功能无法从代码或现有文档确认，应降级为“入口和用途说明”或暂不写入；不得编造流程、限制、字段、支持范围或状态。

## 信息架构

采用“任务路径优先”的结构：

- `首页`：一句话定位、核心入口、当前支持范围、下载入口。
- `快速开始`：下载与安装、首次配置仓库、安装第一个 Rule/Skill。
- `用户指南`：Rules、Skills、仓库、项目、编辑器安装范围、搜索与同步。
- `团队协作`：推荐仓库结构、内容编写规范、创建与分享、Git 审核流程。
- `高级功能`：Agent、Prompts、Data Store、Task Scheduler、Editor Scan、Diagnostics 等当前可见模块。
- `开发者`：本地开发、仓库结构、常用脚本、构建打包、发布入口。
- `参考`：FAQ、排障、版本与下载、术语表。

## 页面清单

### 首页

- `index.md`：产品入口页，保留 VitePress home，文案聚焦“跨编辑器 Rules & Skills 管理”。

### 快速开始

- `start/install.md`：下载、macOS/Windows 安装、首次启动。
- `start/repository.md`：配置内容仓库、本地目录与 Git 仓库区别。
- `start/first-install.md`：安装第一个 Rule/Skill 到 Claude Code、Cursor、Codex。

### 用户指南

- `guide/rules.md`：Rule 的用途、字段、浏览、搜索、下载、安装。
- `guide/skills.md`：Skill 的用途、附件、浏览、下载、安装。
- `guide/editors.md`：支持的编辑器、全局/项目级安装范围、限制。
- `guide/settings.md`：仓库、项目、用户信息、更新等设置项。

### 团队协作

- `team/repository-structure.md`：推荐目录结构和命名方式。
- `team/content-authoring.md`：Rule/Skill 编写规范。
- `team/share-review.md`：创建、提交、审核、同步的团队流程。

### 高级功能

- `advanced/index.md`：高级功能总览。
- `advanced/agent.md`
- `advanced/prompts.md`
- `advanced/data-store.md`
- `advanced/task-scheduler.md`
- `advanced/editor-scan.md`
- `advanced/diagnostics.md`

### 开发者

- `developer/index.md`：贡献者入口。
- `developer/local-development.md`
- `developer/project-structure.md`
- `developer/build-release.md`

### 参考

- `reference/faq.md`
- `reference/troubleshooting.md`
- `reference/glossary.md`
- `reference/downloads.md`

## 内容策略

- 普通使用者页面写成任务步骤，重点是完成下载、配置和安装。
- 团队页面写成规范和流程，重点是团队如何维护内容资产。
- 高级功能页面按“能做什么 / 怎么启用 / 注意事项”组织，只写当前可确认能力。
- 开发者页面以当前 monorepo 脚本、目录和构建方式为准。
- FAQ 和排障内容只保留用户完成操作所需信息。
- 界面文案和文档文案都保持克制，不写营销废话、路线图承诺、AI 助手自称或装饰性内容。

## 实现边界

实现仅限 `website/`：

- 更新 `website/.vitepress/config.mts` 的 nav 和 sidebar。
- 重写或迁移现有 `website/*.md` 与 `website/guide/*.md`。
- 新增 `start/`、`team/`、`advanced/`、`developer/`、`reference/` 页面。
- 尽量不改 `website/.vitepress/theme/custom.css`；如必须修改，只做 VitePress 级别的小范围排版修正。

## 验证

- 运行 `pnpm --filter @synapse/website run build`。
- 检查 VitePress nav、sidebar 和 Markdown 内链。
- 自审所有页面，确认没有未实现承诺、未来规划混入、猜测功能、过度营销或无效废话。
- 对每个新增或重写分区，记录已阅读的代码或文档来源，确保内容可追溯。
