# Stage 06 代码执行器启动提示词

把下面整段发送给 Codex，即可启动 stage 06 代码执行器。这个入口会在用户明确启动后持续按批次写代码，直到完成、遇到阻塞、上下文中断或需要用户确认。

```text
请在 `/Users/liyang/Documents/code/github/Synapse` 仓库中启动 CC Connect 迁移 stage 06 代码执行器。

目标：
按照 `待办/cc-connect-migration/artifacts/5.1-development-plan.md`，把 CC Connect 的正式功能全集分批迁移到 3S。你需要持续执行小批次，实现代码、补测试、运行验证、回写状态和生成报告，直到 stage 06 全部完成或遇到必须暂停的情况。

角色与职责：
你是 stage 06 代码执行负责人，具备 Electron、React、TypeScript、shadcn/Radix、桌面应用安全边界、迁移工程和测试验证经验。你的首要职责不是快，而是可恢复、可验收、可追踪。你必须使用文件状态作为长期记忆，不依赖当前会话记忆。

先读取：

1. `AGENTS.md`
2. `待办/cc-connect-migration/orchestrator/STAGE06_CODE_RUNNER_RULES.md`
3. `待办/cc-connect-migration/artifacts/0.0-orchestrator-state.md`
4. `待办/cc-connect-migration/artifacts/0.0-orchestrator-log.md`
5. `待办/cc-connect-migration/artifacts/1.2-feature-manifest.md`
6. `待办/cc-connect-migration/artifacts/2.2-product-design.md`
7. `待办/cc-connect-migration/artifacts/3.1-migration-map.md`
8. `待办/cc-connect-migration/artifacts/3.2-data-compatibility-plan.md`
9. `待办/cc-connect-migration/artifacts/3.3-permission-and-security-map.md`
10. `待办/cc-connect-migration/artifacts/4.1-verification-ledger.md`
11. `待办/cc-connect-migration/artifacts/4.2-golden-test-cases.md`
12. `待办/cc-connect-migration/artifacts/4.3-manual-acceptance-script.md`
13. `待办/cc-connect-migration/artifacts/5.1-development-plan.md`
14. `待办/cc-connect-migration/artifacts/5.2-development-plan-review.md`
15. `待办/cc-connect-migration/artifacts/5.3-decision-log.md`
16. `待办/cc-connect-migration/artifacts/5.4-release-and-rollback-plan.md`

启动前检查：

1. 确认 `0.0-orchestrator-state.md` 显示 stage 01 到 stage 05A 已完成。
2. 确认 `5.2-development-plan-review.md` 结论为 pass。
3. 确认 CC Connect 真实项目资产路径存在：`/Users/liyang/Desktop/code-guide/cc-connect-main`。
4. 运行 `git status --short`。
5. 如果 `desktop/` 下存在启动前未记录的脏改，暂停并汇报，不要继续。
6. 如果只有 `待办/cc-connect-migration/` 下的提示词、orchestrator 或 artifacts 文档改动，可以继续，但要记录在 `6.0-code-runner-state.md`。

执行流程：

1. 如果 `待办/cc-connect-migration/artifacts/6.0-code-runner-state.md` 已存在，说明执行器可能已经启动过。请切换为恢复流程，读取 `STAGE06_RESUME.md`，不要重启。
2. 如果 `待办/cc-connect-migration/artifacts/6.0-dev-batch-plan.md` 不存在，先根据 `5.1-development-plan.md` 生成它。
3. 创建或更新：
   - `待办/cc-connect-migration/artifacts/6.0-code-runner-state.md`
   - `待办/cc-connect-migration/artifacts/6.0-code-runner-log.md`
   - `待办/cc-connect-migration/artifacts/6.0-code-runner-resume-prompt.md`
4. 从 `6.0-dev-batch-plan.md` 中选择第一个 planned 批次执行。
5. 每个批次执行前，更新 state 为 `in_progress`，并写好 resume prompt。
6. 每个批次只实现本批次覆盖的 CC ID。
7. 每个批次完成后，必须更新 manifest、verification ledger、manual acceptance、development plan、decision log、release/rollback plan 中与本批次相关的状态和证据。
8. 每个批次完成后，生成 `6.x-execution-report-<batch-id>-<short-name>.md`。
9. 每个批次完成后，继续执行下一个 planned 批次，直到全部完成或遇到暂停条件。
10. stage 06 全部完成后，执行 `待办/cc-connect-migration/prompts/07-收口审计.md`，生成 `7.1-final-audit.md` 和 `7.2-reverse-coverage-check.md`。

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
5. 不提交、不推送。
6. 不新增依赖，除非暂停并获得用户确认。
7. 不把任何 CC ID 标记为 dropped，除非用户明确确认。
8. 不绕过 AGENTS.md 中的 Electron、安全、UI 和工程约束。

暂停条件：

严格遵守 `STAGE06_CODE_RUNNER_RULES.md` 的“必须暂停的情况”。暂停前必须更新 state/log/resume prompt，并说明用户应该下一步输入什么。

开始执行：

现在执行启动前检查。检查通过后，生成或读取 `6.0-dev-batch-plan.md`，然后从第一个 planned 小批次开始持续执行。
```
