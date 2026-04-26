# Stage 06 代码执行器启动提示词

把下面整段发送给 Codex，即可启动 stage 06 代码执行器。这个入口会在用户明确启动后持续按批次写代码，直到完成、遇到阻塞、上下文中断或需要用户确认。

````text
请在 `/Users/liyang/Documents/code/github/Synapse` 仓库中启动 CC Connect 迁移 stage 06 代码执行器。

目标：
按照 `待办/cc-connect-migration/artifacts/5.1-development-plan.md`，把 CC Connect 的正式功能全集分批迁移到 3S。你需要持续执行小批次，实现代码、补测试、运行验证、回写状态和生成报告，直到 stage 06 全部完成或遇到必须暂停的情况。

核心迁移方式：
计划文件决定本批做什么、放哪里、如何验收；CC Connect 原源码和测试决定具体行为、字段默认值、边界条件、错误处理和状态机；3S 当前代码决定如何落到 Electron/TypeScript 架构里。写任何新代码前，必须先读取本批对应的 CC Connect 原源码和测试文件，不允许只根据计划文件重建相似功能。

用户通知方式：
如果执行器遇到 blocked、needs-user-confirmation、必须暂停、等待用户授权/决定，或无人值守执行完成后需要用户检查，必须先更新 state/log/resume/overnight summary，再按 `待办/cc-connect-migration/整体标准.md` 的“用户通知规则”发送 Bark 手机通知。通知正文写清暂停原因、推荐先看哪个文件、下一步可直接回复什么。

跨对话交接方式：
如果需要用户把当前结果转给另一个 Codex 对话，或者执行器暂停/阻塞/完成，必须按 `待办/cc-connect-migration/orchestrator/HANDOFF_PROTOCOL.md` 更新 `待办/cc-connect-migration/artifacts/0.0-latest-handoff.md`。不要要求用户复制长篇状态。

CC Connect 原项目资产路径固定为：

```text
/Users/liyang/Desktop/code-guide/cc-connect-main
```

角色与职责：
你是 stage 06 代码执行负责人，具备 Electron、React、TypeScript、shadcn/Radix、桌面应用安全边界、迁移工程和测试验证经验。你的首要职责不是快，而是可恢复、可验收、可追踪。你必须使用文件状态作为长期记忆，不依赖当前会话记忆。

先读取：

1. `AGENTS.md`
2. `待办/cc-connect-migration/整体标准.md`
3. `待办/cc-connect-migration/orchestrator/STAGE06_CODE_RUNNER_RULES.md`
4. `待办/cc-connect-migration/artifacts/0.0-orchestrator-state.md`
5. `待办/cc-connect-migration/artifacts/0.0-orchestrator-log.md`
6. `待办/cc-connect-migration/artifacts/1.2-feature-manifest.md`
7. `待办/cc-connect-migration/artifacts/2.2-product-design.md`
8. `待办/cc-connect-migration/artifacts/3.1-migration-map.md`
9. `待办/cc-connect-migration/artifacts/3.2-data-compatibility-plan.md`
10. `待办/cc-connect-migration/artifacts/3.3-permission-and-security-map.md`
11. `待办/cc-connect-migration/artifacts/4.1-verification-ledger.md`
12. `待办/cc-connect-migration/artifacts/4.2-golden-test-cases.md`
13. `待办/cc-connect-migration/artifacts/4.3-manual-acceptance-script.md`
14. `待办/cc-connect-migration/artifacts/5.1-development-plan.md`
15. `待办/cc-connect-migration/artifacts/5.2-development-plan-review.md`
16. `待办/cc-connect-migration/artifacts/5.3-decision-log.md`
17. `待办/cc-connect-migration/artifacts/5.4-release-and-rollback-plan.md`

启动前检查：

1. 确认 `0.0-orchestrator-state.md` 显示 stage 01 到 stage 05A 已完成。
2. 确认 `5.2-development-plan-review.md` 结论为 pass。
3. 确认 CC Connect 真实项目资产路径存在：`/Users/liyang/Desktop/code-guide/cc-connect-main`。
4. 运行 `git status --short`。
5. 正式启动 stage 06 写代码前，`git status --short` 必须为空。
6. 如果存在任何未提交改动，暂停并要求用户先提交或清理。不要把启动前已有改动混入 `stage06(S06-B01)` 或后续批次 commit。
7. 只有在用户明确说“允许带着这些未提交改动继续”时，才可继续；继续前必须把这些改动写入 `6.0-code-runner-state.md` 的启动前脏改记录。

执行流程：

1. 如果 `待办/cc-connect-migration/artifacts/6.0-code-runner-state.md` 已存在，说明执行器可能已经启动过。请切换为恢复流程，读取 `STAGE06_RESUME.md`，不要重启。
2. 如果 `待办/cc-connect-migration/artifacts/6.0-dev-batch-plan.md` 不存在，先根据 `5.1-development-plan.md` 生成它。
   批次计划中的每个小批次必须包含：
   - 必须读取的 CC Connect 源码
   - 必须读取的 CC Connect 测试
   - 源码搜索关键词
   - 原逻辑还原重点
   - 本批 commit message 模板
3. 创建或更新：
   - `待办/cc-connect-migration/artifacts/6.0-code-runner-state.md`
   - `待办/cc-connect-migration/artifacts/6.0-code-runner-log.md`
   - `待办/cc-connect-migration/artifacts/6.0-code-runner-resume-prompt.md`
   - `待办/cc-connect-migration/artifacts/6.0-overnight-summary.md`
   - `待办/cc-connect-migration/artifacts/0.0-latest-handoff.md`
4. 启动后立即创建或更新 `6.0-overnight-summary.md`。
5. 从 `6.0-dev-batch-plan.md` 中选择第一个 planned 批次执行。
6. 每个批次执行前，从 `1.2-feature-manifest.md` 和 `4.2-golden-test-cases.md` 提取本批 CC ID 对应的 CC Connect 源码/测试路径，并用 `rg` 在 `/Users/liyang/Desktop/code-guide/cc-connect-main` 中补充相关源码。
7. 每个批次写代码前，必须读取本批相关 CC Connect 源码和测试文件，并把已读取路径记录到 state、log、overnight summary 和执行报告。
8. 每个批次执行前，更新 state 为 `in_progress`，并写好 resume prompt。
9. 每个批次只实现本批次覆盖的 CC ID。
10. 每个批次完成后，必须更新 manifest、verification ledger、manual acceptance、development plan、decision log、release/rollback plan 中与本批次相关的状态和证据。
11. 每个批次完成后，生成 `6.x-execution-report-<batch-id>-<short-name>.md`，报告必须包含“原源码对照”章节。
12. 每个批次完成后，必须更新 `6.0-overnight-summary.md`。
13. 每个批次验证通过后，必须创建一个 git commit，commit message 必须使用 `stage06(<批次编号>): <批次名称> [<CC ID 列表>]` 格式。
14. 每个批次 commit 后，如果没有触发暂停条件，继续执行下一个 planned 批次，直到全部完成。
15. stage 06 全部完成后，执行 `待办/cc-connect-migration/prompts/07-收口审计.md`，生成 `7.1-final-audit.md` 和 `7.2-reverse-coverage-check.md`，并更新 `6.0-overnight-summary.md`。

验证要求：

每个批次至少运行本批次计划中的验证命令。除非规则文件明确暂停，否则每个批次完成前还要运行：

```text
pnpm desktop:typecheck
pnpm desktop:check:hard-constraints
pnpm desktop:check:ipc-codegen
```

禁止事项：

1. 不启动 dev server。
2. 不启动 Electron 应用。
3. 不打开浏览器或 Playwright。
4. 不执行 destructive git 操作。
5. 不推送。
6. 不跳过每批 commit。
7. 不新增依赖，除非暂停并获得用户确认；已知例外：S06-B03 / CC-005 允许通过 `pnpm --filter @synapse/desktop add smol-toml` 添加 `smol-toml`，仅用于旧 `config.toml` 导入。
8. 不把任何 CC ID 标记为 dropped，除非用户明确确认。
9. 不绕过 AGENTS.md 中的 Electron、安全、UI 和工程约束。

已知处理方式：

1. 不要因为 CC Connect 源码路径不明确暂停；正式路径就是 `/Users/liyang/Desktop/code-guide/cc-connect-main`，除非该路径不存在。
2. 不要在 S06-B03 因为 TOML parser 暂停；用户已预授权 `smol-toml`。
3. 不要因为完成一个批次而暂停；用户要求连续执行。
4. 不要因为需要创建 git commit 暂停；每批 commit 是必需动作。

暂停条件：

严格遵守 `STAGE06_CODE_RUNNER_RULES.md` 的“必须暂停的情况”。暂停前必须更新 state/log/resume prompt，并说明用户应该下一步输入什么。
暂停时还必须按“用户通知方式”发送 Bark 手机通知，并把通知结果写入 log/state/overnight summary。

夜间无人值守要求：

1. 如果遇到必须用户决定的问题，停止前必须更新 `6.0-overnight-summary.md`，写清楚“需要用户决定什么、选项、推荐选择、影响、明早第一步”。
2. 如果全部完成，必须在 `6.0-overnight-summary.md` 写清楚完成批次、commit 范围、最终审计结论和是否还需要人工检查。
3. 用户明早只看 `6.0-overnight-summary.md` 就应该知道当前状态和下一步该回复什么。
4. 如果无人值守结束后需要用户处理或检查，必须发送 Bark 手机通知。
5. 如果无人值守结束、阻塞或需要转交给另一个对话，必须更新 `0.0-latest-handoff.md`。

开始执行：

现在执行启动前检查。检查通过后，生成或读取 `6.0-dev-batch-plan.md`，然后从第一个 planned 小批次开始持续执行。
````
