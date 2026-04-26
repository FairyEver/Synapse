# 恢复规则

如果编排过程中出现上下文压缩、中断、换新对话或 Codex 崩溃，不要从头开始。

在新对话中发送：

```text
请读取并执行：待办/cc-connect-migration/artifacts/0.0-resume-prompt.md
```

如果 `0.0-resume-prompt.md` 不存在，则发送：

```text
请读取 待办/cc-connect-migration/artifacts/0.0-orchestrator-state.md 和 待办/cc-connect-migration/orchestrator/START_HERE.md，从 state 中的 next_action 恢复。
```

恢复时必须：

1. 读取 `0.0-orchestrator-state.md`。
2. 读取 `0.0-orchestrator-log.md`。
3. 读取当前阶段提示词。
4. 读取当前阶段已经生成的 artifacts。
5. 判断下一步是继续生成、验收、修复、裁决，还是等待用户确认。
6. 不要重复已经 pass 的阶段。
7. 如果恢复后仍处于等待用户确认、blocked、必须暂停或需要用户处理，先确认 state/log/resume 已更新，再按 `待办/cc-connect-migration/整体标准.md` 的“用户通知规则”发送 Bark 手机通知。
