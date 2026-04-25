# Stage 06 代码执行器恢复提示词

如果 stage 06 代码执行器因为断网、任务取消、上下文压缩、Codex 崩溃或手动停止而中断，把下面整段发送给新的 Codex 对话。

```text
请在 `/Users/liyang/Documents/code/github/Synapse` 仓库中恢复 CC Connect 迁移 stage 06 代码执行器。

目标：
不要从头开始。请根据文件状态恢复到中断前的 stage 06 小批次，继续完成代码迁移、验证、状态回写和报告生成。

角色与职责：
你是 stage 06 代码执行恢复负责人。你的职责是先恢复上下文，再继续执行。你必须以磁盘状态为准，不依赖用户口述摘要，不重复已经 done 的批次。

先读取：

1. `AGENTS.md`
2. `待办/cc-connect-migration/orchestrator/STAGE06_CODE_RUNNER_RULES.md`
3. `待办/cc-connect-migration/artifacts/6.0-code-runner-state.md`
4. `待办/cc-connect-migration/artifacts/6.0-code-runner-log.md`
5. `待办/cc-connect-migration/artifacts/6.0-code-runner-resume-prompt.md`
6. `待办/cc-connect-migration/artifacts/6.0-dev-batch-plan.md`
7. `待办/cc-connect-migration/artifacts/1.2-feature-manifest.md`
8. `待办/cc-connect-migration/artifacts/4.1-verification-ledger.md`
9. `待办/cc-connect-migration/artifacts/5.1-development-plan.md`
10. `待办/cc-connect-migration/artifacts/5.3-decision-log.md`
11. `待办/cc-connect-migration/artifacts/5.4-release-and-rollback-plan.md`

恢复检查：

1. 运行 `git status --short`。
2. 对照 `6.0-code-runner-state.md` 的“最近修改文件”判断当前脏改是否属于当前批次。
3. 如果脏改属于当前批次，继续该批次。
4. 如果脏改不属于当前批次，暂停并列出未知文件，不要覆盖。
5. 如果 state 显示当前批次为 `in_progress`，继续实现或从最近验证失败点继续。
6. 如果 state 显示当前批次为 `verification_failed`，先读取最近失败日志或验证报告，再修复。
7. 如果 state 显示当前批次为 `done`，选择 `6.0-dev-batch-plan.md` 中下一个 planned 批次。
8. 如果 `6.0-code-runner-state.md` 不存在，不要猜测；读取 `STAGE06_START.md` 并执行启动前检查。

继续执行规则：

1. 严格遵守 `STAGE06_CODE_RUNNER_RULES.md`。
2. 不重复已经 done 的批次。
3. 不重新生成 `6.0-dev-batch-plan.md`，除非该文件不存在或明显损坏。
4. 每次继续前都更新 `6.0-code-runner-resume-prompt.md`。
5. 每完成一个批次，更新 manifest、verification ledger、manual acceptance、development plan、decision log、release/rollback plan 和执行报告。
6. 每个批次最多 3 次修复尝试，超过则暂停。

暂停条件：

如果需要用户确认、发现未知脏改、验证连续 3 次失败、需要新增依赖、需要真实账号/secret/扫码/系统服务操作，必须暂停，并更新 state/log/resume prompt。

开始恢复：

现在先读取上述文件并运行 `git status --short`。根据 state 判断当前批次和下一步动作，然后继续执行。
```
