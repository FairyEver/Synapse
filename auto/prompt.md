---

你正在对一个 Electron + React 桌面应用（Synapse）的工作流编排子系统进行独立迭代。你的任务是：**纯粹从代码层面**找出该系统在真实使用时的可用性与体验缺陷——既包括逻辑走不通的断路问题，也包括**流程部分的 UI 不完善与交互方式不顺畅的问题**——自主完成从问题分析到代码修复的全流程。

**禁止事项**
- 不得启动任何开发服务器
- 不得运行任何脚本、测试或 shell / npm / pnpm 命令
- 所有分析和修复必须通过阅读和编写源代码完成
- 终端命令仅允许在最终阶段执行 `git add` / `git commit`（见 Step 6）

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

在阅读上述文件时，同时留意项目已有的统一日志工具（`StructuredLogger` 或同等机制）的使用方式，作为代码实施阶段的日志规范参考（详见第五节）。

---

## 三、任务执行流程

完成所有文件阅读后，严格按照以下步骤执行。

### Step 0：读取历史迭代记录

读取固定文件 `~/Desktop/synapse-workflow-fix-log.md`：

- 若文件不存在：标记本轮为**第 1 次迭代**，跳过本步剩余内容，直接进入 Step 1。
- 若文件存在：
  1. **提取索引**：列出此前所有迭代的"修复内容"中涉及的 `文件:行号` 与"发现的问题"中的问题主题。
  2. **回归抽样验证**：从历史修复中**抽取最近 3-5 项**，在当前代码中确认对应修复**仍然成立**（仅读代码，不运行）。判定标准：修复点对应的逻辑、判断、调用顺序与历史记录中"修复内容"描述一致。
  3. **输出固定格式两段**（在 Step 1 之前展示）：
     - **历史摘要**：曾覆盖的模块或文件范围（一句话级别）
     - **回归清单**：哪些历史修复在当前代码中已不再成立（含 `文件:行号` 和回归说明）；若无则写"无回归"

**回归优先级**：若回归清单非空，本轮 Step 1 必须把回归项作为候选缺陷之一，**优先级高于新发现的缺陷**。

### Step 1：缺陷发现（结构化静态审查）

从**真实可用性**角度，在代码层面发现 1 到 3 个最严重的缺陷。

**筛选优先级（按序）**：
1. Step 0 标记的回归项
2. 主流程（创建 → 编辑 → 保存 → 运行 → 查看结果）中的断路问题
3. Switch 节点分支逻辑中的语义错误
4. UI 状态与执行状态的不一致问题
5. 流程部分的 UI 完备性缺失（loading / empty / error / disabled / 无权限等关键状态缺失或信息不清；空画布、空历史、空结果等场景缺乏引导）
6. 流程部分的交互断路（关键操作无入口、缺少反馈、危险操作无确认、键鼠与快捷键行为不一致、焦点与选中态不清）

**审查维度参考（启发用，不必穷举）**：

1. **数据流断裂**：状态在 A 处更新，但 B 处使用旧版本，UI 或结果与用户预期不符
2. **代码内部矛盾**：同一概念在不同文件中的实现假设不一致（类型 vs 实际、IPC 契约 vs 调用侧、编辑器 vs 运行视图）
3. **运行时崩溃路径**：合法的用户操作序列导致未捕获错误或静默失败
4. **生命周期与服务绑定**：服务初始化时捕获了本该动态读取的状态
5. **跨组件状态不一致**：一处改了数据，另一处展示或逻辑没有跟上
6. **分支语义漏洞**：Switch 分支激活、可达性判断、变量解析在某些 DAG 结构下行为错误
7. **UI 完备性**：编辑器、运行视图、对话框在 loading / empty / error / disabled / 无权限等关键状态下是否有清晰可见的反馈；空画布、空历史、空结果、长耗时操作的进度是否成体系
8. **交互顺畅度**：按钮点击反馈、拖拽手柄可见性、右键菜单完整度、键盘快捷键（删除、撤销、复制粘贴、Esc 关闭、Enter 确认）、危险操作确认、错误信息可否直接定位到具体节点
9. **信息架构**：关键操作是否有明显入口、当前选中态与焦点态是否清晰、视图之间切换时上下文是否保留

**方法论硬约束（不满足则该条作废，不得作为缺陷提交）**：

- **先路径后结论**：不先写出完整"用户操作 → 代码执行链 → 错误结果或体验缺陷"的触发路径，不得给出缺陷判断。对于 UI/交互类缺陷，"错误结果"可表述为"无反馈 / 无入口 / 状态不清 / 与心智预期不符"，但必须说明用户此刻期望看到什么、实际看到什么。
- **代码自证**：触发路径上的每一环必须引用具体 `文件:行号`，缺一环视为"证据不足，放弃此条"。
- **真实可用性论证**：必须说明为什么这是用户在正常使用时会碰到的问题，而不是理论风险或极端边缘情况。
- **空结果合法**：若严格筛选后所有候选都未通过上述约束，如实报告"本轮无可安全修复的问题"，直接跳到 Step 5（按"无修复"格式追加条目），**跳过 Step 6 提交**。

### Step 2：结构化分析与方案（每个缺陷一张卡片）

对 Step 1 通过筛选的每个缺陷，**严格按以下统一字段输出一张缺陷卡片**，不得用自由段落替代：

```
### 缺陷 N：<一句话定性>
- 触发路径：<用户操作 → 代码链 → 错误结果或体验缺陷，每一环可追踪到行号>
- 代码证据：
  - `文件路径:行号` —— <最小必要片段或一句话说明>
  - …（视复杂度列 2-5 条）
- 非边缘性论证：<为什么是真实可用性问题>
- 历史关联：<独立 / 延续第 X 轮 / 修复第 X 轮的回归 / 与第 X 轮同主题但位置不同>
- 根因：<一段，精确定位到行为或假设>
- 候选方案：
  - 方案 A：<做法> —— 利：…；弊：…
  - 方案 B：<做法> —— 利：…；弊：…
  - （可选 方案 C）
- 选定方案：<A/B/C> —— 理由：<对架构的侵入、是否符合设计意图、实施复杂度>
- 产品行为：<修复后用户操作序列的预期结果；是否改变 UI、数据模型、IPC>
- Breaking Change：<无 / 有 + 兼容策略>
```

**历史关联字段强制要求**：若新缺陷与某次历史修复在**同文件同主题**重叠，必须显式说明本次属于"覆盖、延续、还是独立"，禁止留空或仅写"无"。

### Step 3：代码实施

按以下规则直接编写修复代码：

- **行内编辑方式**（`edit` / `multi_edit` 工具），不输出代码块给用户，直接修改源文件
- 每次修改最小化：只改缺陷所在的最小代码范围
- 遵守现有代码风格、命名惯例、模块边界
- UI/交互相关修改必须遵循 `AGENTS.md` 与 `.claude/rules/design.md` 的设计指引：优先复用 `desktop/src/components/ui/` 的 shadcn/ui 组件与现有 Tailwind token，不得引入自定义色板、自定义阴影系统或新的视觉语言；新增状态（loading/empty/error）优先用既有原语组合
- 多文件修改按依赖顺序（先底层后上层）
- 不新增依赖，不新建不必要的文件
- 不修改与本次缺陷无关的任何代码
- 修改后**重新阅读被修改的文件**，确认修改正确且未引入新问题
- 所有新增或修改的代码必须遵循**第五节 · 日志规范**

### Step 4：回顾确认

完整描述：

- 修改了哪些文件的哪些行（精确到 `文件:行号`）
- 修改前行为 vs 修改后行为
- 本轮与历史的关系：独立修复 / 延续第 X 轮 / 修复第 X 轮的回归
- 本次修复使工作流系统在哪个使用维度上向"真正可用"迈进了一步

### Step 5：追加运行记录

将本轮迭代摘要追加到固定文件 `~/Desktop/synapse-workflow-fix-log.md`。

**写入规则：**
- 若文件不存在：创建并写入；本轮编号 **N = 1**。
- 若文件存在：**仅在文件末尾追加**，不得修改任何已有内容。
- N 的计数：统计文件全文中以 `## [` 开头的行数，本轮 N = 已有数 + 1。
- 时间使用当前实际时间（UTC+8）。
- 若本轮为"无修复"（Step 1 空结果），仍按下面格式追加，无对应内容的字段填"无"。

**追加内容格式（严格遵循此结构）：**

```
---

## [YYYY-MM-DD HH:mm] 第 N 次迭代

### 发现的问题
- [问题1简述，含触发路径要点]
- [问题2简述，如有]

### 修复内容
- [文件路径:行号] 修改说明
- [文件路径:行号] 修改说明

### 与历史的关系
- [独立 / 延续第 X 轮 / 修复第 X 轮的回归 / 无修复]

### 日志补充
- [描述本次在哪些关键路径新增了日志覆盖]

### 本次进展
[一句话总结：工作流系统在哪个维度向可用迈进了一步]
```

### Step 6：提交代码

**前置条件：**
- 若本轮为"无修复"（Step 1 空结果或全部候选未通过方法论硬约束），**跳过本步**。
- 否则按下面执行。

使用 `run_command` 工具在项目根目录 `/Users/liyang/Documents/code/github/Synapse` 依次执行：

1. `git add -A`
2. `git commit -m "<message>"`

**Commit message 规则：**
- 普通修复：`fix(workflow): <本次修复的核心内容，不超过 60 字符，中英文皆可>`
- 修复历史回归：`fix(workflow): regress <历史问题简述>`
- UI 完备性或交互优化：`feat(workflow): polish <UI/交互优化简述>`
- 必须准确反映本次实际修改内容，禁止 `fix bugs` / `update code` 等泛化描述
- 只提交，不推送（不执行 `git push`）
- 若 `git add -A` 后 `git status` 无任何变更，跳过本步，在 Step 4 回顾中说明原因

---

## 四、工作质量要求

- 分析必须基于代码事实，不依赖假设或推测
- 每个结论必须有代码引用支撑（`文件:行号`）
- 不修复你没有完全理解的问题
- 不为"看起来完整"而添加多余注释、文档或无关改动
- 若一个问题需要运行才能确认，跳过它，寻找下一个
- 优先修复常见操作路径下必然触发的问题，而非极端边缘情况

---

## 五、日志规范

工作流模块目前处于开发阶段，为便于复盘问题，**所有新增或修改的代码必须使用项目统一日志工具**（`StructuredLogger` 或代码库中等效机制）补充日志。

- **主进程侧**（executor / service / engine / validator 等）的关键执行路径必须打日志：节点进入与退出、分支选择、变量解析、错误捕获
- **级别**：参照现有代码风格，使用 `info` / `warn` / `error`
- **上下文**：日志内容须包含足够上下文（如 `workflowId` / `runId` / `nodeId` / 关键变量值或错误详情），保证仅凭日志文件即可还原现场
- **渲染侧**：不使用 `console.log`；关键状态变更或 IPC 调用失败通过已有日志通道记录
- **禁止占位**：不得仅为满足规范而添加无意义日志，日志必须对应真实执行事件
- **纯 UI 优化例外**：若本轮修改仅为视觉呈现或交互反馈调整（不改变数据流、执行路径或 IPC 契约），无需强行补充日志；Step 5 的"日志补充"字段如实填"无（纯 UI 优化）"

每次执行本提示词，目标是：工作流模块的真实可用性向前推进至少一步。