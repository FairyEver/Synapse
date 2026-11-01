# 就近下注 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 高频金额在底栏选择，自定义就近展开，明确提交与全下确认不变。
**Architecture:** 复用 HumanControls 的金额状态、betPresets、Popover 和提交函数。自定义按钮作为真实锚点，主操作按钮读取同一金额状态；底栏预留新增工具栏空间。
**Tech Stack:** React 19、HeroUI 3.2.7、TypeScript、Vitest。
**Spec:** `docs/superpowers/specs/2026-11-01-poker-nearby-betting-design.md`

## Global Constraints

当前 main 原地修改，无新依赖、不启动浏览器或应用、不部署、不混入其他任务改动。游戏内容不进入发布说明。

## Review Focus

- 档位选择不能触发出牌，默认金额可直接明确提交。
- 全下及预设达到上限仍需二次确认。
- 自定义关闭保留金额，轮次变化重置金额。
- 无加注资格不显示档位；未知响应锁定新操作。
- 窄屏预留工具栏空间，面板锚定真实按钮，展开不改变画布。

### Task 1: 布局与回归

**Files:** `HumanControls.tsx`、`PokerControlPopover.tsx`、`responsive-controls.css`，既有 controls 单元测试及 browser 回归，游戏 UI 规则与指南。
**Interfaces:** 沿用 `betPresets(table)`、`useHumanControls`、`submit(action)`，不变更网络协议。

- [x] 修改回归并运行，观察旧实现无法满足常驻档位/直接确认。
- [x] 将档位移至底栏，简化自定义面板，使用真实按钮定位，固定预留高度。
- [x] 更新既有测试选择器及几何回归，运行 controls 单元测试、V2 typecheck、check:ui。
- [x] 同步当前交互规则，复核聚焦 diff 并本地提交；未执行的浏览器验收如实说明。

## 验证记录

- RED：修改后的 controls 回归在旧实现上 16 项失败，缺少常驻档位、自定义入口与直接确认按钮。
- GREEN：`pnpm --filter @synapse/dashboard-v2 test src/game-center/games/poker`，29 个文件、191 项通过；`check:ui` 通过；`git diff --check` 通过。
- `pnpm --filter @synapse/dashboard-v2 tsc` 未通过：未修改的 `src/game-center/lib/api.ts:20` 缺少新共享契约的 `roll` 属性（TS2741）。使用 TypeScript compiler host 只读替换 HumanControls 为 HEAD 原版后仍报告完全相同的单项错误，确认不是本次改动引入；未修改其他任务的 API 契约。
- 已更新 320/390/850/851/1280px 的浏览器几何回归，未启动浏览器或应用，未执行视觉验收。未部署、未 push、未操作业务库。
- 独立代码审查未发现确定性缺陷；未把静态尺寸分析当作视觉通过。后续实际几何验收还应覆盖 320px + 等待 AI 接入 + 倒计时的状态行高度。
