# 跨对话交接协议

本文件用于解决多个 Codex 对话之间传递状态的问题。用户可能通过远程控制软件操作，不方便滚动、右键复制或转述长消息。因此后续迁移流程不得依赖用户在对话之间人工搬运长文本。

## 固定交接文件

所有对话都使用同一个最新交接文件：

```text
待办/cc-connect-migration/artifacts/0.0-latest-handoff.md
```

如果用户说“检查最新状态”“去看另一个对话的结果”“看纸条”“看交接”，当前对话必须优先读取这个文件，再按文件里列出的状态文件、报告文件、commit 和阻塞项继续检查。

## 什么时候必须写纸条

任何 Codex 对话在以下情况必须更新 `0.0-latest-handoff.md`：

1. 阶段完成。
2. 批次完成。
3. 任务暂停。
4. 任务阻塞。
5. 需要用户确认、授权、扫码、提供路径、提供账号、批准依赖或做范围取舍。
6. 无人值守任务完成，需要用户第二天检查。
7. 需要把当前结果交给另一个 Codex 对话继续。
8. 当前对话完成一次阶段性工作，需要用户回来查看。

写纸条必须发生在最终回复用户之前。

## 完成通知

用户已要求每一次完成都发送 Bark 手机通知。凡是写入 `0.0-latest-handoff.md` 并准备最终回复时，也必须发送 Bark 通知，提醒用户回来查看结果。通知只写简短结果，不包含 secret、token、Raw TOML、二维码或敏感配置。

## 纸条格式

`0.0-latest-handoff.md` 必须保持简短、可执行，不写长篇解释。

```text
# 最新跨对话交接

更新时间：
写入对话：
当前仓库：
当前任务：
当前阶段/批次：
当前状态：running / done / blocked / needs-user-confirmation / complete / incomplete
一句话结论：

已完成：
- 

生成或修改的关键文件：
- 

验证结果：
- 

Git 状态：
- 

阻塞或需要用户决定：
- 

下一步建议：
- 

给另一个 Codex 的短提示词：
```text
请在 `/Users/liyang/Documents/code/github/Synapse` 仓库中读取：
1. `待办/cc-connect-migration/orchestrator/HANDOFF_PROTOCOL.md`
2. `待办/cc-connect-migration/artifacts/0.0-latest-handoff.md`
然后按交接文件的“下一步建议”继续。不要要求用户粘贴长文本；所有结果继续写回 `0.0-latest-handoff.md`。
```

Bark 通知：
- 是否已发送：
- 通知内容摘要：

备注：
- 
```

## 与已有状态文件的关系

`0.0-latest-handoff.md` 不是替代正式状态文件，而是给跨对话、人类远程控制和快速恢复用的索引。

正式状态仍然写入：

```text
待办/cc-connect-migration/artifacts/0.0-orchestrator-state.md
待办/cc-connect-migration/artifacts/0.0-orchestrator-log.md
待办/cc-connect-migration/artifacts/0.0-resume-prompt.md
待办/cc-connect-migration/artifacts/6.0-code-runner-state.md
待办/cc-connect-migration/artifacts/6.0-code-runner-log.md
待办/cc-connect-migration/artifacts/6.0-code-runner-resume-prompt.md
待办/cc-connect-migration/artifacts/6.0-overnight-summary.md
```

`0.0-latest-handoff.md` 必须列出应该优先读取哪些正式状态文件。

## 最终回复规则

当已经写入 `0.0-latest-handoff.md` 后，给用户的最终回复应该短，只需要说明：

1. 纸条已经更新。
2. 纸条路径。
3. 是否已发送 Bark 通知。
4. 用户下一步只需要复制哪一小段提示词。

不要在聊天里重复纸条全文，除非用户明确要求。
