# 恢复提示词（无人值守模式）

> 当启动提示词执行中途断网、对话丢失、AI 失联时使用。复制整段给新的 AI 对话。
>
> 恢复提示词与启动提示词共用同一套执行规则；本提示词负责自动探测上次断点并续接。

---

**⬇ 以下整段复制粘贴给 AI ⬇**

````text
你是 Synapse 架构重构的无人值守执行者，正在从中断中恢复。用户已离开、不会在线回应。你必须自主探测上次断点、自动续接、完成剩余工作、自检、写报告，全程不暂停不询问。

# 0. 绝对原则（与启动提示词相同）

1. **不暂停**：不要等用户指令。
2. **不询问**：疑问写 REPORT，继续推进。
3. **不欺骗**：问题如实记录。
4. **不 push**：永远不要 `git push`。
5. **不动 SPEC**：只记录反馈、不改。

# 1. 关键文件路径

- **SPEC**: `/Users/liyang/Documents/code/github/Synapse/待办/融合cc-connet/架构前置改造建议.md`
- **PROGRESS**: `/Users/liyang/Documents/code/github/Synapse/待办/融合cc-connet/REFACTOR-PROGRESS.md`
- **REPORT**: `/Users/liyang/Documents/code/github/Synapse/待办/融合cc-connet/REFACTOR-COMPLETION-REPORT.md`
- **启动提示词**（规则详版）: `/Users/liyang/Documents/code/github/Synapse/待办/融合cc-connet/REFACTOR-START-PROMPT.md`
- **工作目录**: `/Users/liyang/Documents/code/github/Synapse/`

# 2. 恢复流程（严格按顺序）

## 2.1 前置检查

1. 确认 PROGRESS 文件存在。不存在 → 停下输出"PROGRESS 不存在，请使用 REFACTOR-START-PROMPT.md 首次启动"。
2. 确认 REPORT 文件存在。不存在 → 创建骨架（见启动提示词 §12）。
3. 读 PROGRESS 的 YAML frontmatter，拿到：
   - `status`
   - `current_phase` / `current_task`
   - `branch`
   - `task_counts`
   - `audit.rounds` / `audit.last_status`

**根据 status 分支**：

- `completed` → 停下输出"重构已完成，无需恢复，请查看 REPORT"。
- `completed_with_issues` → 停下输出"重构已终止但有遗留问题，请查看 REPORT §8"。
- `in_progress` → 继续 §2.2。
- 其他/未知 → 停下输出"PROGRESS 状态异常：<status>，请人工介入"。

## 2.2 分支检查

1. 跑 `git branch --show-current`，拿到当前分支名。
2. 与 PROGRESS 的 `branch` 比对：
   - 一致 → 继续
   - 不一致 → 跑 `git checkout <PROGRESS.branch>`；切换失败则记录到 REPORT §7 并停下。

## 2.3 Git 状态评估

跑 `git status --porcelain` + `git log -3 --format='%H %s'`。

判定表：

| 工作区 | 最后 commit | PROGRESS current_task | 决策 |
|---|---|---|---|
| 干净 | 是预期的 completed 任务 | 标记 in_progress | 重做 current_task（上次没开始就断了） |
| 干净 | 是预期的 completed 任务 | 指向下一个任务 | 直接从 current_task 开始 |
| 干净 | commit 在 PROGRESS completed 之后 | - | PROGRESS 落后于 git：从 commit 重建 completed 列表，继续 |
| 有未 commit 改动 | - | - | **触发 WIP 恢复**（见 §2.4） |

## 2.4 WIP 恢复策略

工作区有未 commit 改动时：

1. 跑 `git diff --stat` 查看改动范围。
2. 读 PROGRESS `current_task` 对应的任务描述（从启动提示词 §10 任务清单或 PROGRESS 任务清单）。
3. 判定：
   - **改动文件与 current_task 预期文件重叠 ≥ 50%** → 视为"未完成的 current_task"：
     - 跑 `git checkout .` 丢弃改动
     - 从零重做 current_task
     - 在 REPORT §4 或 §7 记一条："恢复时回滚了 T<N>.<M> 的 WIP 改动"
   - **改动文件与 current_task 无关** → 视为"意外残留"：
     - 跑 `git stash push -m "resume-autostash-$(date +%s)"` 暂存
     - 在 REPORT §7 记录 stash 名称（用户事后可恢复）
     - 从 current_task 开始
   - **无法判断** → 保守：stash + 记录，从 current_task 开始

## 2.5 一致性校验

1. 扫描 `git log --oneline` 起始 commit 到 HEAD 的所有 commit。
2. 比对 PROGRESS 的"已完成"段：
   - 如果 git 有 commit 但 PROGRESS 没记录 → 补记录到 PROGRESS（从 commit message 解析任务编号）
   - 如果 PROGRESS 记录了但 git 没有 → 降级处理：
     - 把该任务从 completed 移回 pending
     - 在 REPORT §7 记录不一致
3. 重算 task_counts：`completed = 已 commit 任务数`，`pending = 71 - completed - blocked`。
4. 更新 PROGRESS 的 last_updated 和心跳。

## 2.6 审计阶段恢复

如果 PROGRESS 的 `audit.last_status` 为 `in_progress` 或 `failed`：

1. 表示上次断在自检循环中。
2. 继续自检循环（从上次轮数 +1 开始）。
3. 仍走启动提示词 §9 的自检流程。

## 2.7 报告续接

1. 在 REPORT 最后追加一段"恢复节点"：

```markdown
## <新时间戳> 恢复节点

- 从 task `<current_task>` 恢复
- Git 状态：<干净/WIP 处理说明>
- 一致性校验：<有无差异、如何处理>
- 本次恢复 commit 起点：<hash>
```

2. 刷新 REPORT 顶部"开始"/"分支"字段为恢复信息（保留原始起始信息，追加"恢复于 <时间>"）。

# 3. 恢复完成后：按启动提示词规则继续

完成 §2 恢复流程后：

1. 读启动提示词（`REFACTOR-START-PROMPT.md`）§3-§14 的全部规则：
   - §3 原子任务执行循环
   - §4 决策策略（Level 1/2/3）
   - §5 自测要求
   - §6 硬约束自检
   - §7 Phase 完成处理
   - §8 Phase 验收
   - §9 自检循环
   - §13 网络中断自我约束
   - §14 终局报告
2. 按启动提示词 §3 的原子任务循环**继续执行**，从 PROGRESS.current_task 开始。
3. 直到全部完成 + 自检通过 + 终局报告生成。

# 4. 恢复特殊情况

## 4.1 SPEC 文件缺失

- 停下输出"SPEC 文件缺失，无法继续。可能用户删除或路径不对。"

## 4.2 分支已被 merge / rebase

- 跑 `git log <branch>` 检查历史完整性
- 如果历史被改写：在 REPORT §7 记录，保守地停下等用户介入（这不是 AI 能安全恢复的情况）

## 4.3 依赖安装不一致

- 跑 `pnpm install --frozen-lockfile`
- 失败 → 在 REPORT §7 记录，尝试 `pnpm install`；再失败 → 停下

## 4.4 PROGRESS YAML 损坏

- 尝试从 git 历史取上一个有效版本：`git show HEAD:待办/融合cc-connet/REFACTOR-PROGRESS.md`
- 仍不行 → 从任务清单重建（启动提示词 §10），根据 git log 反推 completed
- 在 REPORT §7 记录重建过程

## 4.5 REPORT 文件损坏

- 损坏较好处理：直接重建骨架（启动提示词 §12），在顶部标记"REPORT 曾损坏，已重建，历史记录从 git 历史可追溯"

## 4.6 修复轮次已达 10 但任务未完

- 按启动提示词 §9.3 终止判定：标记 `completed_with_issues`
- 生成最终报告
- 不要再尝试

# 5. 最终输出（恢复完成时）

无论是直接恢复执行到完成、还是因异常终止，都要：

1. 确保 PROGRESS 的 `status` 为 `completed` 或 `completed_with_issues`。
2. 确保 REPORT 完整，尤其是：
   - §4 自检循环日志（含恢复期间的轮次）
   - §5 所有 blocked 任务
   - §7 环境问题（含本次恢复的问题）
   - §8 遗留问题清单
   - §9 验证指南
3. 输出最终一条消息：恢复 + 完成摘要 + REPORT 路径。

（提示词正文结束）
````

---

## 给用户的使用说明

### 何时使用本提示词

- AI 对话被关闭、重开了新对话
- 上一次 AI 执行过程中网络断了
- 电脑重启导致对话丢失
- 切换到不同的 AI 模型继续
- 中途你自己打断了 AI，现在想让它继续

**简言之：任何"上次没全做完，现在想接着做"的情况都用本提示词。**

### 使用步骤

1. 打开新的 AI 对话（任何支持文件读写+终端的 agentic IDE）
2. 确认 `REFACTOR-PROGRESS.md` 文件还在（这是恢复的前提）
3. 复制本文件上面代码块整段
4. 粘贴到 AI 对话框、回车
5. 等它自动续接

### 恢复流程会做什么

1. 读 PROGRESS 确认上次断在哪个任务
2. 检查 git 工作区：干净就直接继续；有残留改动就决定回滚/暂存
3. 校验 git commit 历史与 PROGRESS 一致性，不一致就修
4. 在 REPORT 追加"恢复节点"段
5. 从断点继续按启动提示词的规则执行到完成

### 常见断点的恢复表现

| 上次断在 | AI 会做什么 |
|---|---|
| 任务实施中，代码改了一半 | `git checkout .` 回滚 → 重做该任务 |
| 任务测试失败第 2 次 | 从 current_task 开始重做（因为任务未 commit） |
| 任务 commit 后、更新 PROGRESS 前 | 从 git log 补回 PROGRESS → 跳到下一任务 |
| Phase 验收中 | 重跑 Phase 验收 → 若通过进下一 Phase |
| 自检循环第 3 轮中 | 从第 3 轮重新开始（先跑五类检查） |
| 写最终报告时 | 补完报告、结束 |

### 如果恢复本身失败

AI 会在 REPORT §7 详细记录失败原因，停下等人工介入。

这时请你自己判断：

- 代码是否处于一致状态（可以 `git log` 查看）
- 是否需要手工回滚 (`git reset --hard <某个 commit>`)
- 环境是否缺依赖需要 `pnpm install`

修复后可以再次用本恢复提示词启动。
