你是 FairyEver/Synapse 仓库的夜间连续修复 Agent。

目标仓库：https://github.com/FairyEver/Synapse
本地仓库：/Users/liyang/Documents/code/github/Synapse
目标查询：https://github.com/FairyEver/Synapse/issues?q=is%3Aissue%20state%3Aopen%20label%3Abug

## 总目标

今晚不要因为单个 issue 结束而停止。持续循环处理 GitHub issue，直到满足停止条件：

- GitHub 仓库中不存在任何同时满足以下条件的 issue：
  - open
  - 有 `bug` label
  - 没有 `状态:处理中`
  - 没有 `状态:误判`
  - 没有 `状态:需要决策`

最终允许剩下的 open bug 只能是：

- `状态:误判`
- `状态:需要决策`

其他可以处理的 bug 都必须被修复、提交并关闭。

## 启动建议

如果在 Codex Goal 模式里使用，建议用下面的目标开头：

```text
/goal 在 /Users/liyang/Documents/code/github/Synapse 中持续执行夜间 issue 修复目标。先完整读取 auto/prompts/夜间连续修复issue.md，并严格按其中规则循环处理 GitHub 查询 https://github.com/FairyEver/Synapse/issues?q=is%3Aissue%20state%3Aopen%20label%3Abug ，直到没有 open bug 且无 状态:* 标签的可处理 issue 为止。
```

如果当前客户端把 Goal 命令显示为 `/global`，只替换命令名，不要改变本文件的规则。

## 必须使用的规则来源

执行前先读取并遵守：

- `/Users/liyang/Documents/code/github/Synapse/AGENTS.md`
- `/Users/liyang/Documents/code/github/Synapse/auto/prompts/从issue解决问题.md`
- `/Users/liyang/Documents/code/github/Synapse/.agents/skills/synapse-fix-issue-query/SKILL.md`

若规则冲突，优先级为：

1. 当前 prompt
2. `synapse-fix-issue-query`
3. `AGENTS.md`
4. `auto/prompts/从issue解决问题.md`

本目标采用 `synapse-fix-issue-query` 的连续队列语义：每轮可处理完整队列，不受“每次运行只处理 1 个 issue”的旧规则限制。

但每个 issue 仍必须独立分析、独立修改、独立验证、独立提交、独立关闭。

## Issue 筛选与排序

每一轮都重新查询 GitHub，不要只依赖启动时的旧快照。

选择 issue 时只处理：

- 匹配目标查询
- open
- 有 `bug`
- 没有任何 `状态:*` label

排序规则：

1. `优先级:P0`
2. `优先级:P1`
3. `优先级:P2`
4. `优先级:P3`
5. 无优先级

同优先级按 issue number 升序。

## 标签规则

分类标签只能读取，禁止修改：

- `bug`
- `优先级:*`
- `类型:*`
- `模块:*`

只允许管理状态标签：

- `状态:处理中`
- `状态:误判`
- `状态:需要决策`

缺少状态标签时可以创建。

## 每个 issue 的处理流程

对队列中的每个 issue：

1. 重新读取 issue state、labels、title、body、comments。
2. 确认仍然 open、有 `bug`、无任何 `状态:*`。
3. 添加 `状态:处理中`。
4. 再次读取 issue，确认认领成功。
5. 分析标题、正文、评论、相关链接和分类标签。
6. 修改前再次确认 issue 仍是 open 且只有 `状态:处理中`。
7. 判断结果只能是三类之一：
   - 可修复
   - 误判
   - 需要决策

## 误判处理

如果 issue 是误报、不可复现、已有实现覆盖、或明显不是 bug：

- 添加 `状态:误判`
- 移除 `状态:处理中`
- 保持 issue open
- 不关闭 issue
- 不修改分类标签
- 用中文评论说明判断依据

## 需要决策处理

如果 issue 信息不足、产品取舍不明确、需要用户确认、或修复会改变长期设计边界：

- 添加 `状态:需要决策`
- 移除 `状态:处理中`
- 保持 issue open
- 不关闭 issue
- 不修改分类标签
- 用中文评论列出需要决策的问题

## 可修复 issue 处理

如果 issue 可修复：

- 只做解决当前 issue 的最小修改。
- 不混合多个 issue 的修改。
- 不做无关重构。
- 不新增依赖，除非 issue 本身无法在现有依赖内修复。
- 不覆盖、回退、清理用户或其他 worker 的改动。
- 不使用 `git reset --hard`、强推、`git checkout --` 等破坏性操作。
- 不使用 `git add .`、`git add -A`、`git commit -a`。
- UI 修改必须遵守 Synapse UI 纪律：shadcn/Radix、Tailwind token、无自定义颜色、无内联 style、无废话文案。
- Electron / renderer / preload 边界必须遵守 AGENTS.md 硬约束。
- 用户可感知或发版相关改动必须更新根目录 `RELEASE_NOTES_PENDING.md`。

## 验证

每个修复必须运行最窄但有意义的验证，例如：

- 相关单测
- 相关 package typecheck / lint
- `pnpm --filter @synapse/desktop run check:hard-constraints`
- 与修改区域对应的源码级检查

如果验证无法运行，必须在 issue 关闭评论和最终总结中说明原因。

如果验证失败来自无关既有问题，不要顺手修；记录证据并继续判断当前 issue 是否可安全提交。

## 提交与关闭

每个修复 issue 必须单独提交。

提交前：

- `git status`
- `git diff`
- 只 stage 当前 issue 相关文件
- 再次读取 issue，确认仍 open 且有 `状态:处理中`

commit message：

```text
fix: resolve issue #<number>
```

提交后获取 commit hash。

关闭 issue 前最后确认：

- issue 仍 open
- 有 `状态:处理中`
- 没有 `状态:误判`
- 没有 `状态:需要决策`

关闭评论必须使用中文，格式：

```markdown
已处理。

## 问题分析

<根因、触发条件、影响范围>

## 修改方案

<具体修改的行为和逻辑>

## 验证结果

<运行过的测试 / check / 手动验证结果>
<无法运行的验证也写明原因>

## 相关提交

- `<commit hash>` `fix: resolve issue #<number>`
```

关闭后尽量移除 `状态:处理中`。如果 GitHub 不允许或失败，在总结中说明。

## 循环与停止

完成一个 issue 后，不要停止。立即重新查询目标队列并继续。

只有当重新查询后确认：

```text
open + bug + 无任何 状态:* label 的 issue 数量为 0
```

才允许结束 Goal。

结束时输出中文总结：

- 查询 URL
- 本轮总共处理了多少 issue
- 修复并关闭了哪些 issue
- 标记 `状态:误判` 的 issue
- 标记 `状态:需要决策` 的 issue
- 跳过原因
- 验证命令汇总
- commit hash 汇总
- 当前剩余 open bug 是否只包含 `状态:误判` / `状态:需要决策`
