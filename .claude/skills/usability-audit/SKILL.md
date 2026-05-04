---
name: usability-audit
description: Synapse 桌面应用可用性审计。按用户旅程走查所有功能阶段，从代码层面发现功能缺陷、逻辑死胡同和错误处理盲区，直接修复并验证。
---

# Usability Audit — 可用性审计与修复

## 目标

模拟真实用户的操作路径，通过代码分析发现功能缺陷、逻辑死胡同和错误处理盲区，直接修复并验证构建。

## 核心原则

1. **用户视角驱动**：从用户操作路径出发，不是从代码结构出发。先想"用户在这一步会遇到什么"，再去代码中验证。
2. **发现即修复**：不只输出报告，直接改代码。每个问题都要有对应的代码变更。
3. **构建验证**：每轮修复后运行 `npx tsc --noEmit`（在 `desktop/` 目录下）确认无编译错误。

## Synapse 架构速查

审计时的快速参考，避免反复探索：

**功能模块**（8 个，Tab 切换，非路由）：

| 模块 | 入口 | 核心文件 |
|------|------|----------|
| Rule | `src/modules/rules/` | `index.tsx` |
| Skill | `src/modules/skills/` | `index.tsx` |
| Prompt | `src/modules/prompts/` | `index.tsx` |
| Agent | `src/modules/agent/` | `index.tsx` |
| Database | `src/modules/database/` | `index.tsx` |
| Task Scheduler | `src/modules/task-scheduler/` | `index.tsx` |
| Editor Scan | `src/modules/editor-scan/` | `index.tsx` |
| Settings | `src/modules/settings/` | `index.tsx` |

**Gate 组件层级**（用户进入应用前必经）：

```
LicenseGate → MainApp → IdentityGate → RepoOnboardingDialog → AppShellLayout
```

- `LicenseGate`：`src/app-shell/components/license-gate.tsx`
- `IdentityGate`：`src/app-shell/components/identity-gate.tsx`
- `RepoOnboardingDialog`：`src/app-shell/components/repo-onboarding-dialog.tsx`

**通知系统**：

```ts
const { promise, success, error, warning } = useAppNotifications()
```

**IPC 模式**：`window.synapse.<domain>.<method>()`，通过 preload bridge 封装。

**状态管理**：React Context（全局：Config / Repository / Identity / Notifications）+ 组件 local state（模块内）。

## 执行流程

### Phase 1：确定审计范围

- 用户指定了模块 → 只审计该模块
- 用户未指定 → 通过 `git diff --name-only HEAD~10` 找最近变更集中的模块，优先审计
- 用户要求全量 → 按用户旅程顺序走查所有阶段

### Phase 2：用户旅程走查

按以下 5 个阶段走查，每个阶段读取相关代码，逐项检查：

**阶段 1：首次启动**
- Gate 组件链：LicenseGate → IdentityGate → RepoOnboardingDialog
- 重点：每个 Gate 的错误状态是否有出口

**阶段 2：仓库配置**
- 添加/切换/移除仓库
- 重点：只有一个仓库时的边界、配置失败后的恢复路径

**阶段 3：日常操作**
- 各模块的 CRUD 操作、导入导出、安装内容
- 重点：异步操作的 loading/error 反馈、对话框提交中的防护

**阶段 4：错误恢复**
- 网络断开、文件被删、IPC 失败
- 重点：错误信息是否具体、是否有重试机制

**阶段 5：设置管理**
- 配置读写、数据库设置、MCP 设置
- 重点：配置加载失败的处理、保存失败的反馈

### 每个阶段的检查清单

对走查到的每个交互点，逐项检查：

1. **错误出口**：错误状态是否有重试或回退按钮？（不能是死胡同）
2. **加载反馈**：异步操作是否有 loading 指示？（spinner / 文字 / 禁用按钮）
3. **空状态引导**：列表为空时是否有操作引导？（不能是空白页面）
4. **提交失败恢复**：表单/对话框提交失败后能否重试？（不能自动关闭丢失输入）
5. **错误捕获**：网络/IO 操作是否有 try/catch + 用户可见的错误提示？（不能静默失败）
6. **流程安全**：长流程中途取消/失败是否能回到安全状态？（不能卡在中间态）
7. **错误信息**：错误提示是否具体？（不能只说"操作失败"，要说明什么失败了）

### Phase 3：问题分级与记录

按严重程度分级：

| 级别 | 定义 | 示例 |
|------|------|------|
| P0 阻断 | 用户卡死，无法继续使用，必须重启 | Gate 错误无重试按钮、流程死循环 |
| P1 严重 | 功能不可用但不阻断整体，或可能白屏 | 模块加载失败无反馈、未捕获异常导致崩溃 |
| P2 体验 | 信息缺失、反馈不足、错误信息模糊 | 静默吞错、泛化错误提示、缺少 loading |

每个问题记录：

```
## 问题 #{n}：[简短标题]

**严重程度**：P0/P1/P2
**文件**：[file:line]
**问题**：[用户会遇到什么]
**修复方向**：[一句话]
```

### Phase 4：逐个修复

按 P0 → P1 → P2 顺序修复。

**修复原则**：

- 使用现有组件：`Button`、`Alert`、`AlertDescription`、`Badge`、`LoaderCircle`
- 使用现有 hook：`useAppNotifications()` 的 `promise()` / `success()` / `error()` / `warning()`
- 使用现有日志：`createRendererLogger()` 的 `logger.info()` / `logger.error()` / `logger.warn()`
- 遵循项目 UI 规则：shadcn/ui 组件 + token 颜色 + 短 className
- 错误文案：简短、可操作、面向用户（参考 `.claude/rules/ui-rules.md` 第 9 节）
- 不引入新依赖或新抽象
- 每个修复后在 `desktop/` 目录运行 `npx tsc --noEmit` 验证

### Phase 5：汇总输出

修复完成后输出：

1. 发现的所有问题及修复状态
2. 未修复项及原因（需要主进程改动、需要产品决策等）
3. 建议后续关注的区域

## 常见修复模式

从历次审计中提炼的可复用模式：

| 模式 | 适用场景 | 实现要点 |
|------|----------|----------|
| 错误状态 + 重试按钮 | 数据加载失败的死胡同 | `<Button variant="outline" size="sm" onClick={refresh}>重试</Button>` |
| try/catch + showError | 异步操作静默失败 | catch 中 `showError(error.message)` + `logger.error()` |
| loading 状态反馈 | 异步操作无进度指示 | `<LoaderCircle className="h-4 w-4 animate-spin" />` + 文字 |
| 对话框防误关 | 提交中用户关闭对话框 | `onEscapeKeyDown` / `onInteractOutside` 中 `event.preventDefault()` |
| 逃生出口 | 流程卡死无法回退 | 提供"移除"/"跳过"/"取消"按钮 |
| 具体化错误信息 | 泛化的"不合法"/"失败" | 拆分 catch/throw 分支，给出字段名 + 原因 |
| ErrorBoundary | React 渲染异常导致白屏 | class component + `getDerivedStateFromError` + 重试/重载按钮 |

## 范围控制

- 每次聚焦用户指定的模块或最近变更的模块
- 不审计纯样式问题（那是 design review）
- 不审计性能问题（除非有明显的 UI 阻塞）
- 不审计边界情况竞争条件（那是 `edge-case-audit` skill 的职责）
- 输出直接在对话中，不生成文件（除非用户要求）
