# 自动化手动触发 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 新增 `builtin.manual`，复用现有手动运行入口，禁止自动调度和事件触发。

**Architecture:** 新触发器使用严格空配置和 `kind: "manual"`；注册表、主进程运行服务、Renderer 编辑器、MCP discovery 和 Automation Skill 保持同一契约。公共运行变量按 schedule/event/manual 三种模式统一生成。

**Spec:** `docs/superpowers/specs/2026-11-07-automation-manual-trigger-design.md`

## Tasks

### Task 1: 新增手动触发器包并接入双端注册表

新增 `desktop/automation-trigger-packages/builtin/manual/` 的严格空配置、主进程/Renderer 定义，注册到两套 trigger registry，并更新 registry tests。

### Task 2: 统一手动运行上下文和公共变量

按 `schedule/event/manual` 传递触发器类型，手动模式不生成 `trigger.scheduledAt` 和事件变量，补齐模板变量与执行服务测试。

### Task 3: 接入运行服务、MCP 手动运行和桌面编辑器

为停用项增加主进程手动运行保护，保留手动绕过 conditions 的行为，增加“按手动”编辑器分组、摘要和等待文案，并验证 MCP discovery/run。

### Task 4: 同步 Automation Skill、能力清单和发布说明

更新 Automation Skill、能力注册表、模块边界和 `RELEASE_NOTES_PENDING.md`，说明第六类触发器及 MCP 手动运行契约。

### Task 5: 全量验证与最终提交

运行 Automation 专项测试、desktop typecheck 和 `check:hard-constraints`，检查聚焦 diff 后提交。
