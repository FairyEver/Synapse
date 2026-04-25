# Stage 06 代码执行器规则

本文件定义 CC Connect 迁移到 3S 的 stage 06 代码执行系统。它的目标是让 Codex 在用户明确启动后，按批次持续实现 `5.1-development-plan.md`，并通过文件状态支持中断恢复。

## 1. 适用范围

本执行器只负责 stage 06 和 stage 07：

- stage 06：按批次实现 `1.2-feature-manifest.md` 中的正式 CC ID。
- stage 07：当所有正式 CC ID 都完成、合并、替代或用户确认丢弃后，执行最终收口审计。

本执行器不重新生成 stage 01 到 stage 05A 的产物。除非发现明确证据错误，否则不得重做前期分析。

## 2. 核心原则

1. 以 `5.1-development-plan.md` 为唯一总开发计划。
2. 以 `6.0-dev-batch-plan.md` 为 stage 06 的唯一批次清单。
3. 每次只执行一个小批次，但可以在一个会话中连续执行多个小批次。
4. 每个小批次都必须有实现、验证、证据回写和执行报告。
5. 任何重要状态都写入 artifacts，不依赖会话记忆。
6. 不启动 Electron 应用、dev server、浏览器、Playwright 或运行时预览，除非用户明确要求。
7. 不执行破坏性 git 操作，不推送、不重置。
8. 每个小批次验证通过后必须提交一次 git commit，提交信息必须能看出 stage、批次编号、批次名称和覆盖 CC ID。
9. 不新增依赖，除非某个批次无法完成且用户明确批准。已知例外见“已知暂停点和预授权处理”。
10. 不扩大当前批次范围。发现遗漏时先记录 candidate/open question，不顺手实现。
11. 写代码前必须读取对应 CC Connect 原源码和测试文件。计划文件只决定做什么，原源码和测试决定怎么做。
12. 迁移实现应尽可能用 TypeScript 还原 CC Connect 已跑通的函数逻辑、字段默认值、边界条件、错误处理和状态机，不允许只根据计划文件凭空重建相似功能。

## 3. 状态文件

stage 06 执行器必须维护以下文件：

```text
待办/cc-connect-migration/artifacts/6.0-dev-batch-plan.md
待办/cc-connect-migration/artifacts/6.0-code-runner-state.md
待办/cc-connect-migration/artifacts/6.0-code-runner-log.md
待办/cc-connect-migration/artifacts/6.0-code-runner-resume-prompt.md
```

每个小批次完成后生成：

```text
待办/cc-connect-migration/artifacts/6.x-execution-report-<batch-id>-<short-name>.md
```

如果小批次需要多次修复，生成：

```text
待办/cc-connect-migration/artifacts/6.x-validation-attempt-<n>.md
```

如果小批次 3 次失败仍无法通过，生成：

```text
待办/cc-connect-migration/artifacts/6.x-blocker.md
```

## 4. 状态格式

`6.0-code-runner-state.md` 必须包含：

```text
# Stage 06 代码执行状态

当前模式：
当前批次：
当前批次状态：
当前批次尝试次数：
最近结论：
阻塞问题：
需要用户确认：
已完成批次：
剩余批次：
已更新 CC ID：
最近验证命令：
最近修改文件：
最近读取的 CC Connect 源码：
最近提交：
下一步动作：
恢复提示文件：
最后更新时间：
```

批次状态只能使用：

```text
planned
in_progress
verification_failed
blocked
done
skipped_with_user_confirmation
```

## 5. 启动前检查

启动代码执行前必须检查：

1. 当前仓库路径是 `/Users/liyang/Documents/code/github/Synapse`。
2. `0.0-orchestrator-state.md` 显示 stage 01 到 stage 05A 已完成。
3. `5.2-development-plan-review.md` 结论为 pass。
4. `5.1-development-plan.md` 存在。
5. `1.2-feature-manifest.md`、`4.1-verification-ledger.md`、`5.3-decision-log.md`、`5.4-release-and-rollback-plan.md` 存在。
6. CC Connect 真实项目资产路径存在：`/Users/liyang/Desktop/code-guide/cc-connect-main`。
7. 运行 `git status --short`。
8. 如果存在 `desktop/` 下未记录在 `6.0-code-runner-state.md` 的脏改，必须暂停。
9. 如果只存在迁移提示词、orchestrator 或 artifacts 文档改动，可以继续，但必须写入 state。

## 5A. 已知暂停点和预授权处理

以下问题在历史执行中已经出现过，并已有明确处理方式。再次运行时按本节处理，不要重复暂停。

### 5A.1 CC Connect 项目资产路径

正式 CC Connect 项目资产路径固定为：

```text
/Users/liyang/Desktop/code-guide/cc-connect-main
```

如果该路径存在，并包含 README、go.mod、core、web、npm、daemon、config、tests 等项目资产，不要再因为“源码路径不明确”暂停。

如果该路径不存在，才暂停并要求用户确认路径。

### 5A.2 S06-B03 / CC-005 TOML parser 依赖

用户已确认允许为 CC-005 旧 `config.toml` 导入新增一个 TOML parser 依赖。

预授权依赖：

```text
smol-toml
```

处理方式：

1. 仅允许通过 `pnpm --filter @synapse/desktop add smol-toml` 添加到 `@synapse/desktop`。
2. 不修改根 `package.json`。
3. 不手写 `pnpm-lock.yaml`。
4. 仅用于解析旧 CC Connect `config.toml`。
5. 仍需在 S06-B03 报告和 commit message 中说明该依赖来自用户预授权。

除 `smol-toml` 之外的任何新增依赖仍必须暂停确认。

### 5A.3 连续执行模式

用户已确认需要连续执行。完成一个小批次后，如果验证通过且没有触发“必须暂停的情况”，不要因为批次完成而暂停，必须自动进入下一个 planned 批次。

### 5A.4 每批次提交

用户已要求每完成一个小批次提交一次代码。不要因为“需要 git commit”暂停。提交是本执行器的必需动作。

## 6. 批次计划

如果 `6.0-dev-batch-plan.md` 不存在，先生成它，然后可以继续执行第一个批次。

批次计划必须覆盖 Dev-P0 到 Dev-P4 的所有正式 CC ID。每个批次必须包含：

```text
批次编号：
批次名称：
覆盖 CC ID：
前置批次：
修改范围：
禁止范围：
实现目标：
验收项：
验证命令：
人工验收更新要求：
风险：
完成条件：
```

批次拆分原则：

1. 优先按数据基础、服务边界、UI 入口、验证证据拆小。
2. 单批次尽量控制在可独立 review 和回滚的范围内。
3. 不把多个高风险能力放在同一批次，例如 daemon、Management API、Webhook、Bridge、Terminal Observer。
4. UI 批次必须先读取 `.claude/rules/design.md` 和 `.claude/rules/ui-rules.md`。
5. 敏感操作批次必须先读取 `3.3-permission-and-security-map.md`。

## 7. 单批次执行循环

每个批次按以下顺序执行：

1. 读取本规则、`6.0-code-runner-state.md`、`6.0-dev-batch-plan.md`。
2. 读取本批次对应的 `1.2`、`2.2`、`3.1`、`3.2`、`3.3`、`4.1`、`4.2`、`4.3`、`5.1`、`5.3`、`5.4` 条目。
3. 从 `1.2-feature-manifest.md` 和 `4.2-golden-test-cases.md` 提取本批次 CC ID 对应的 CC Connect 源码和测试路径。
4. 在 `/Users/liyang/Desktop/code-guide/cc-connect-main` 中用 `rg` 搜索本批次关键词、函数名、配置字段、命令名和测试名，补充必须阅读的源码路径。
5. 写代码前读取本批次相关 CC Connect 源码和测试文件。至少要覆盖：
   - `1.2-feature-manifest.md` 中本批次 CC ID 的来源证据文件。
   - `4.2-golden-test-cases.md` 中本批次 CC ID 的 Go 测试或 fixture。
   - `config.example.toml` / docs / web 源码中与本批次字段、页面、API 相关的片段。
6. 在 `6.x-execution-report-*` 中新增“原源码对照”章节，列出已读取的 CC Connect 源码/测试路径，并说明迁移时复用了哪些行为、默认值、边界和错误处理。
7. 如果无法找到对应原源码或测试，必须暂停并写入 blocker，不得只按计划文件写代码。
8. 检查前置批次是否完成。
9. 更新 state：当前批次 `in_progress`，并记录“最近读取的 CC Connect 源码”。
10. 写入 resume prompt，确保中断后能回到当前批次。
11. 检查现有 3S 代码结构，复用已有模块、服务、hook、组件和 typed API。
12. 基于 CC Connect 原源码逻辑进行最小范围 TypeScript 迁移，不做盲目重建。
13. 增加或更新本批次必要测试，测试样本优先来自 CC Connect 原测试、fixtures 和源码边界条件。
14. 运行本批次验证命令。
15. 运行通用验证命令：
    - `pnpm desktop:typecheck`
    - `pnpm desktop:check:hard-constraints`
    - `pnpm desktop:check:ipc-codegen`
16. 如果验证失败，诊断并修复，最多 3 次。
17. 验证通过后更新：
    - `1.2-feature-manifest.md`
    - `4.1-verification-ledger.md`
    - `4.3-manual-acceptance-script.md`
    - `5.1-development-plan.md`
    - `5.3-decision-log.md`
    - `5.4-release-and-rollback-plan.md`
18. 生成 `6.x-execution-report-*`，报告必须包含“原源码对照”和“本批 commit message”。
19. 更新 state/log/resume prompt。
20. 运行 `git status --short`，确认只有当前批次相关文件发生变化；如出现未知无关变更，必须暂停。
21. 使用 `git add` 暂存当前批次的代码、测试、lockfile、artifacts 和状态文件。
22. 提交当前批次 commit。
23. 进入下一个 planned 批次。

## 7A. Git 提交规则

每个小批次验证通过并完成状态回写后，必须提交一次 commit。

禁止：

1. 禁止跳过 commit 进入下一批次。
2. 禁止把多个批次合并到一个 commit。
3. 禁止提交与当前批次无关的文件。
4. 禁止 push。
5. 禁止 amend 已完成批次的 commit，除非当前批次 commit 失败且尚未进入下一批次。

提交前必须运行：

```text
git status --short
```

如果出现不属于当前批次的未知改动，必须暂停。

commit message 格式：

```text
stage06(<批次编号>): <批次名称> [<CC ID 列表>]
```

示例：

```text
stage06(S06-B03): 配置导入与 Provider 数据模型 [CC-005 CC-014]
stage06(S06-B05): Connector 注册、能力矩阵与入站模型 [CC-002 CC-008]
```

commit body 必须包含：

```text
Source: <本批读取的 CC Connect 源码/测试路径摘要>
Verify: <本批验证命令摘要>
Report: <6.x-execution-report 文件路径>
```

提交后必须确认：

```text
git status --short
```

如果提交后仍有未提交改动，必须暂停，不得进入下一批次。

## 8. 三次失败协议

同一批次同一类失败最多修复 3 次：

1. 第 1 次失败：读完整错误，定位根因，做最小修复。
2. 第 2 次失败：换一种修复策略，不重复同样失败路径。
3. 第 3 次失败：重新检查本批次假设、前置条件和代码边界。

3 次后必须暂停，写入 `6.x-blocker.md`，并在 state 中标记：

```text
当前批次状态：blocked
需要用户确认：是
```

## 9. 必须暂停的情况

遇到以下情况必须暂停，不得无人值守继续：

1. 需要真实第三方账号、token、secret、二维码扫码或人工授权。
2. 需要安装/卸载系统服务、写入系统目录、修改 shell profile 或启动真实 daemon。
3. 需要新增依赖，但 `smol-toml` 用于 S06-B03 / CC-005 旧 TOML 导入除外。
4. 需要修改 stage 01 到 stage 05A 的正式范围定义。
5. 需要把正式 CC ID 标记为 dropped。
6. 发现 CC Connect 源码证据与已生成 manifest 明显冲突。
7. `git status --short` 出现不属于当前批次的未知源码改动。
8. 验证连续 3 次失败。
9. 类型检查、hard constraints 或 IPC codegen 出现无法归因到当前批次的失败。
10. 上下文不足以判断安全边界。
11. 本批次找不到对应 CC Connect 原源码或测试证据。
12. commit 前后存在无法归属于当前批次的未提交改动。

## 10. 允许无人值守继续的情况

以下情况可以继续，不需要用户确认：

1. 当前批次内的普通 TypeScript 编译错误。
2. 当前批次测试失败且根因明确。
3. 需要补充当前批次的单元测试、golden 测试或 mock。
4. 需要更新当前批次对应的状态、验收和报告文件。
5. 需要拆分当前批次内部函数或文件，但不改变对外范围。
6. S06-B03 为 CC-005 导入使用已预授权的 `smol-toml`。
7. 当前批次完成后按规则创建 git commit。

## 11. 中断恢复规则

恢复时必须：

1. 读取 `STAGE06_CODE_RUNNER_RULES.md`。
2. 读取 `6.0-code-runner-state.md`。
3. 读取 `6.0-code-runner-log.md`。
4. 读取 `6.0-code-runner-resume-prompt.md`。
5. 运行 `git status --short`。
6. 如果当前批次是 `in_progress`，读取最近修改文件和最近验证结果，继续该批次。
7. 如果当前批次是 `verification_failed`，从失败验证开始继续。
8. 如果当前批次是 `done`，选择下一个 planned 批次。
9. 不重复已经 done 的批次。
10. 不重新生成 `6.0-dev-batch-plan.md`，除非文件不存在或明确损坏。

## 12. 完成定义

stage 06 完成必须同时满足：

1. `1.2-feature-manifest.md` 中所有正式 CC ID 均为 `done`、`merged`、`replaced`，或用户确认的 `dropped`。
2. `4.1-verification-ledger.md` 中所有正式 CC ID 验收项均为 `pass`，或有用户确认豁免。
3. 每个批次都有 `6.x-execution-report-*`。
4. 每个批次执行报告都列出本批读取的 CC Connect 原源码和测试路径。
5. 每个批次都有独立 git commit，commit message 能看出 stage、批次编号、批次名称和 CC ID。
6. `pnpm desktop:typecheck` 通过。
7. `pnpm desktop:check:hard-constraints` 通过。
8. `pnpm desktop:check:ipc-codegen` 通过。
9. 没有 orphan UI/API/service。
10. 执行 stage 07，生成 `7.1-final-audit.md` 和 `7.2-reverse-coverage-check.md`。

## 13. 汇报格式

无人值守执行期间，每完成一个批次只简短汇报：

```text
当前批次：
覆盖 CC ID：
读取 CC Connect 源码：
修改文件：
验证结果：
提交：
状态更新：
下一批次：
是否需要用户确认：
```

不要输出长篇解释。详细内容写入 artifacts。
