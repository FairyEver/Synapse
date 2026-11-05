# 自动化只保留 Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 自动化仅注册 Agent，并自动删除非 Agent 配置，工作流保持原能力。
**Architecture:** 静态注册表注销；后台 Worker 选择待清理 ID，主进程 DataRepository 串行复验与删除；恢复数据触发重扫。
**Tech Stack:** Electron / TypeScript / React / Vitest / DataRepository。
**Spec:** `docs/superpowers/specs/2026-11-05-automation-agent-only-design.md`

## Global Constraints
- 留在当前 main，不创建分支/worktree，不混入现有未提交改动，不启动应用，不推送。
- 只删除非 Agent 自动化配置；保留工作流、Agent 配置和运行历史。
- 用户已确认方案和直接实施；在当前会话连续执行。

## Review Focus
- 恢复旧配置后继续清理。
- 清理快照中的任务已改成 Agent 时不得删除。
- 清理写入失败不得误报成功，重启可重试。
- 无效 Agent 配置仍保留。
- 工作流共用 HTTP/Shell 和 JS/Node 能力仍注册。

### Task 1: 注销非 Agent 执行器
**Files:** 两侧 action-runtime/builtin-actions.ts、JS/Node shared/manifest.ts、bootstrap/descriptors.ts、相关注册测试。
**Interfaces:** `MainActionRegistry` / `RendererActionRegistry` 仍使用原 API，只注册 `builtin.agent`。
- [x] 修改注册/能力包测试，运行并确认失败。
- [x] 移除六种注册和自动化专用依赖注入；保留共用源码和工作流执行通道。
- [x] 验证主进程/界面发现、能力包和工作流节点测试。

### Task 2: 后台自动清理
**Files:** automation/retired-executor-cleanup.ts、retired-executor-cleanup-worker.ts、item-repository.ts、bootstrap 注册、package.json、清理测试。
**Interfaces:** 仓库 `deleteNonAgent(id): Promise<boolean>` 在写队列内复验；清理服务 `start/stop`；Worker 仅处理轻量元数据。
- [x] 写真实 JSON 仓库与清理回归测试，确认失败。
- [x] 主窗口后启动清理；订阅恢复/写入事件，分批处理；失败保留数据且可重试。
- [x] 验证 Agent 原样保留、并发变更、重启/恢复、失败和 Worker 生命周期。

### Task 3: 同步契约并验证提交
**Files:** 能力清单、模块边界、Automation/Workflow Skill、发布说明、受影响 UI 测试。
- [x] 更新文档和受影响测试，保留工作流共用组件。
- [x] 运行专项测试、typecheck、hard constraints 与打包边界检查。
- [x] 检查本次 diff，单独暂存本次改动，中文本地提交，不 push。

## 验证记录

- 注册、清理、JSON 并发保护、MCP、能力包和工作流 HTTP/Shell 节点专项：10 文件、100 测试通过。
- 自动化界面、系统 Skill 与 JSON 后端专项：6 文件、124 测试通过；独立最终只读审查无实际用户影响问题。
- `tsconfig.electron.json` 主进程类型检查通过；完整 `typecheck` 的 Renderer / Electron / preload 检查通过，在测试类型检查被范围外 `app-capabilities/mail/main/__tests__/automation-receipts.test.ts:54` 的 `originReceiptKey` 类型错误阻断。
- `check:hard-constraints` 通过；`git diff --check` 通过。
- 完整 `pnpm --filter @synapse/desktop test`：1128 文件通过、6 文件失败、2 文件跳过；11531 测试通过、10 失败、2 跳过。未更改下列范围外失败：
  - `tests/unit/synapse-tool-router-search.test.ts`：prioritizes filename search for Chinese and English file-finding requests（5 秒超时）。
  - `electron/services/__tests__/mobile-workspace-files-service.test.ts`：reads multiple baselines beside unrelated loose objects within independent budgets（limit_exceeded）；reports a real index type change and staged/unstaged tracked binary content with honest statistics、matches a native clean checkout and one-line edit when autocrlf is only global、respects XDG then home then local precedence without conflating bare and empty booleans（三项 20 秒超时）。
  - `electron/services/automation-mail-triggers/__tests__/recovery.test.ts`：labels a committed run as unknown after generic startup recovery has already finished it（期望「未自动重试」，实际为通用异常退出信息）。
  - `electron/services/git-client/__tests__/git-integration.test.ts`：previews and commits the complete selected file despite mixed index state、previews and commits the final content of a renamed and then edited file（两项 5 秒超时）。
  - `electron/services/terminal-git/__tests__/terminal-git-service.test.ts`：discards tracked changes on request but keeps untracked files while bringing out a remote branch（5 秒超时）。
  - `src/modules/drive/__tests__/drive-module.test.tsx`：previews search results and returns from their actual location without losing loaded pages（5 秒超时）。
- `check:packaged-asar` 已运行，但发布目录遍历被 `desktop/release/review-v1.0.80-acceptance/user-data-before/SingletonCookie` 的失效链接阻断；未构建或验证本次正式安装包。新增 Worker 已显式加入 asarUnpack。
- 未启动应用、未部署、未操作真实用户数据。配置清理在运行包含本改动的应用后生效，不是本轮已经删除用户数据。
