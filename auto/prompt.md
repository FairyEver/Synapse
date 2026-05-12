---

你正在对一个 Electron + React 桌面应用（Synapse）的工作流编排子系统进行独立迭代。你的任务是：**纯粹从代码层面**找出该系统在真实使用时走不通的地方，自主完成从问题分析到代码修复的全流程。

**禁止事项**
- 不得启动任何开发服务器
- 不得运行任何脚本或测试
- 所有分析和修复必须通过阅读和编写源代码完成
- 终端命令仅允许在最终阶段执行 git commit（见 Step 8），其余阶段禁止使用任何 shell / npm / pnpm 命令

---

## 一、项目背景

这是一个 Electron + React + TypeScript monorepo，工作流编排是其中一个快速迭代中的模块。它允许用户在可视化画布上编排多步 Prompt Chain，支持变量绑定和条件分支（Switch 节点），在本地 Electron 主进程中串行执行。当前已有的能力包括：编辑器画布（节点拖拽、连线、右键菜单、复制粘贴）、独立的运行视图（DAG 视图 + 时间线视图 + 节点结果面板）、运行参数对话框、运行历史记录等。

> **重要：代码是唯一的事实来源。** `docs/` 和 `desktop/docs/` 下的设计文档仅反映某个历史时间点的设计意图，代码可能已经超越或偏离这些文档。分析时以实际代码行为为准，设计文档仅作为理解背景意图的辅助参考，不作为审查基准。

---

## 二、必读代码范围

在开始分析前，**完整阅读**以下所有文件（这些是本次任务的全部分析边界）：

**类型定义**
- `desktop/src/types/workflow.ts`
- `desktop/workflow-nodes/types.ts`
- `desktop/workflow-nodes/schemas/variable-binding.ts`

**节点类型插件**
- `desktop/workflow-nodes/registry.ts`
- `desktop/workflow-nodes/register.main.ts`
- `desktop/workflow-nodes/register.renderer.ts`
- `desktop/workflow-nodes/panel-registry.ts`
- `desktop/workflow-nodes/variable-binding-editor.tsx`
- `desktop/workflow-nodes/prompt/`（schema.ts, manifest.ts, executor.main.ts, panel.tsx, card.tsx, index.ts）
- `desktop/workflow-nodes/switch/`（schema.ts, manifest.ts, executor.main.ts, panel.tsx, card.tsx, constants.ts, index.ts）
- `desktop/workflow-nodes/end/`（schema.ts, manifest.ts, executor.main.ts, panel.tsx, card.tsx, index.ts）

**主进程服务层**
- `desktop/electron/services/workflow/workflow-service.ts`
- `desktop/electron/services/workflow/workflow-engine.ts`
- `desktop/electron/services/workflow/workflow-validator.ts`
- `desktop/electron/services/workflow/variable-resolver.ts`
- `desktop/electron/services/workflow/run-snapshot-service.ts`
- `desktop/electron/services/workflow/window-manager.ts`

**IPC 层 + 服务注册**
- `desktop/electron/modules/workflow/ipc.ts`
- `desktop/electron/bootstrap/descriptors.ts`（仅 workflow 相关部分）

**渲染层 — 编辑器**
- `desktop/src/modules/workflow/index.tsx`
- `desktop/src/modules/workflow/editor/editor-app.tsx`
- `desktop/src/modules/workflow/editor/canvas.tsx`
- `desktop/src/modules/workflow/editor/canvas-context.ts`
- `desktop/src/modules/workflow/editor/toolbar.tsx`
- `desktop/src/modules/workflow/editor/node-config-panel.tsx`
- `desktop/src/modules/workflow/editor/execution-overlay.tsx`
- `desktop/src/modules/workflow/editor/node-wrappers.tsx`
- `desktop/src/modules/workflow/editor/node-context-menu.tsx`
- `desktop/src/modules/workflow/editor/node-palette.tsx`
- `desktop/src/modules/workflow/editor/custom-edge.tsx`

**渲染层 — 运行视图**
- `desktop/src/modules/workflow/runner/runner-app.tsx`
- `desktop/src/modules/workflow/runner/runner-toolbar.tsx`
- `desktop/src/modules/workflow/runner/dag-view.tsx`
- `desktop/src/modules/workflow/runner/timeline-view.tsx`
- `desktop/src/modules/workflow/runner/node-result-panel.tsx`
- `desktop/src/modules/workflow/runner/runner-node-wrappers.tsx`

**渲染层 — 组件与 Hooks**
- `desktop/src/modules/workflow/components/workflow-list.tsx`
- `desktop/src/modules/workflow/components/workflow-card.tsx`
- `desktop/src/modules/workflow/components/run-params-dialog.tsx`
- `desktop/src/modules/workflow/components/run-history-dialog.tsx`
- `desktop/src/modules/workflow/components/params-editor-dialog.tsx`
- `desktop/src/modules/workflow/hooks/use-workflow-run.ts`
- `desktop/src/modules/workflow/hooks/use-workflow-events.ts`
- `desktop/src/modules/workflow/hooks/use-workflow-list.ts`
- `desktop/src/modules/workflow/hooks/use-upstream-nodes.ts`

在阅读上述文件时，同时留意项目已有的统一日志工具（`StructuredLogger` 或同等机制）的使用方式，作为后续代码实施阶段的日志规范参考。

---

## 三、任务执行流程

完成所有文件阅读后，严格按照以下步骤执行：

### Step 1：缺陷发现（静态代码审查）

从**真实可用性**的角度，在代码层面找出 1 到 3 个最严重的缺陷。每个缺陷必须满足：
- 有明确的代码路径支撑（引用具体文件+行号）
- 是用户在正常使用时会碰到的真实问题（不是理论风险）
- 是可以在不运行代码的情况下通过读代码确认的问题

**审查维度参考（但不限于此）：**

1. **数据流断裂**：某个状态在 A 处更新，但 B 处使用的是旧版本，导致 UI 或执行结果与用户预期不符
2. **代码内部矛盾**：同一概念在不同文件中的实现假设不一致（如类型定义 vs 实际使用、IPC 契约 vs 调用侧、编辑器 vs 运行视图对同一数据结构的处理差异）
3. **运行时崩溃路径**：某个合法的用户操作序列会导致未捕获错误或静默失败
4. **生命周期与服务绑定**：某个服务在初始化时捕获了应该动态读取的状态，导致后续操作错误
5. **跨组件状态不一致**：一个地方改了数据，另一个地方的展示或逻辑没有随之更新
6. **分支语义漏洞**：Switch 节点的分支激活逻辑、可达性判断、变量解析在某些 DAG 结构下行为错误

### Step 2：根因分析

对每个找到的缺陷，进行精确的根因定位：
- 完整描述缺陷的触发路径（用户操作 → 代码执行链 → 错误结果）
- 引用造成问题的具体代码段
- 说明为什么这是一个真实可用性问题而不是边缘情况

### Step 3：头脑风暴修复方案

对每个缺陷，列出 2-3 种可能的修复方向，评估各自的利弊（涵盖：实现复杂度、对现有架构的侵入程度、是否符合设计意图），最终选定最优方案并说明理由。

### Step 4：产品设计细化

对选定的修复方案，给出明确的产品行为描述：
- 修复后用户操作序列的预期结果是什么
- 是否需要改变 UI 展示逻辑
- 是否需要改变数据模型或 IPC 接口
- 是否存在 Breaking Change，如何兼容

### Step 5：代码实施

按照以下规则直接编写修复代码：

- **使用行内编辑方式**（edit / multi_edit 工具），不输出代码块给用户，直接修改源文件
- 每次修改必须最小化：只改缺陷所在的最小代码范围
- 遵守现有代码风格、命名惯例、模块边界
- 如果需要修改多个文件，按依赖顺序处理（先改底层，再改上层）
- 不新增依赖，不新建不必要的文件
- 不修改与本次缺陷无关的任何代码
- 修改后重新阅读被修改的文件，确认修改正确且没有引入新问题
- **日志要求（强制）**：该工作流模块目前处于开发阶段，为便于复盘问题，所有新增或修改的代码中必须使用项目统一的日志工具（`StructuredLogger` 或代码库中已有的等效机制）添加对应的日志记录。具体要求：
  - 主进程侧（executor、service、engine、validator 等）的关键执行路径（节点进入/退出、分支选择、变量解析、错误捕获）均需打日志，级别参照现有代码风格（`info` / `warn` / `error`）
  - 日志内容应包含足够的上下文（如 workflowId、runId、nodeId、相关变量值或错误详情），确保仅凭日志文件即可还原问题现场
  - 渲染侧不使用 `console.log`，若渲染侧有关键状态变更或 IPC 调用失败，同样通过已有的日志通道记录
  - 不得仅为满足日志要求而添加无意义的占位日志；日志必须对应真实的执行事件

### Step 6：回顾确认

修改完成后，完整描述：
- 修改了哪些文件的哪些行
- 修改前行为 vs 修改后行为
- 本次修复使工作流系统在哪个使用维度上向"真正可用"迈进了一步

### Step 7：追加运行记录

将本次迭代的摘要追加到固定文件 `~/Desktop/synapse-workflow-fix-log.md`。

**处理方式：**
- 先尝试读取该文件。若文件不存在，说明这是第一次运行，创建该文件并写入内容；若文件已存在，**只在文件末尾追加内容，不得修改文件中已有的任何内容**。
- 追加内容格式如下（严格使用此结构）：

```
---

## [YYYY-MM-DD HH:mm] 第 N 次迭代

### 发现的问题
- [问题1简述，含触发路径要点]
- [问题2简述，如有]

### 修复内容
- [文件路径:行号] 修改说明
- [文件路径:行号] 修改说明

### 日志补充
- [描述本次在哪些关键路径新增了日志覆盖]

### 本次进展
[一句话总结：工作流系统在哪个维度向可用迈进了一步]
```

- 时间使用当前实际时间（UTC+8）
- 第 N 次迭代的 N 值通过统计文件中已有 `## [` 开头的条目数量得出，若文件不存在则 N=1

### Step 8：提交代码

使用 `run_command` 工具在项目根目录（[/Users/liyang/Documents/code/github/Synapse](cci:9://file:///Users/liyang/Documents/code/github/Synapse:0:0-0:0)）依次执行以下命令：

1. `git add -A`（暂存所有本次修改的文件）
2. `git commit -m "fix(workflow): <本次修复的核心内容，不超过 60 字符的英文或中文简述>"`

**规则：**
- 只提交，不推送（不执行 `git push`）
- commit message 须准确反映本次实际修改内容，不得使用泛化描述如 "fix bugs" 或 "update code"
- 若 `git add -A` 后 `git status` 显示没有任何变更，说明本次未能完成任何代码修改，应在回顾中说明原因，跳过提交

---

## 四、工作质量要求

- 分析必须基于代码事实，不得依赖假设或推测
- 每个结论必须有代码引用支撑
- 不得修复你没有完全理解的问题
- 不得为了"看起来完整"而在代码中添加多余的注释、文档或无关改动
- 如果一个问题你无法通过读代码确认（例如需要运行才能观察），跳过它，寻找下一个
- 优先修复那些在常见操作路径下必然触发的问题，而不是极端边缘情况
- 所有代码改动必须同步补充相应的日志记录（见 Step 5 日志要求），不允许在没有任何日志覆盖的情况下提交修复

---

## 五、执行优先级

本次如果发现多个缺陷，按如下优先级处理：
1. 优先修复主流程（创建→编辑→保存→运行→查看结果）中的断路问题
2. 其次修复 Switch 节点分支逻辑中的语义错误
3. 最后修复 UI 状态与执行状态的不一致问题

每次执行本提示词，目标是：工作流模块的真实可用性向前推进至少一步。