# auto

本地 Codex 并行运行控制台。启动后打开一个网页，在页面里编辑 Prompt、并行 Agent 数、间隔、超时和 Codex 参数，然后按批次并行运行 `codex exec`。

## 前置条件

- 已安装 Codex CLI 并完成登录
- Node.js >= 18
- pnpm

## 运行

```bash
pnpm start
```

`start` 会启动本地 HTTP 服务并打开控制台页面。页面不会自动开始任务，需要点击 `Start`。

单次批处理：

```bash
pnpm once
```

`once` 使用最近保存的页面配置运行一批任务。

## 页面配置

提示词库会保存到：

```text
prompts/
  default.md
  <提示词名称>.md
```

第一次启动时，如果 `prompts/` 为空且旧的 `prompt.md` 有内容，会迁移为 `prompts/default.md`。迁移后运行以提示词库中的当前选中项为准。

运行参数会保存到：

```text
state/ui-config.json
```

运行参数包括：

- 工作目录
- 并行 Agent 数
- 批次间隔
- 单 worker 超时
- 日志保留数量
- Codex command / model / sandbox / approval policy / MCP 开关

## 并行行为

每一批会同时启动多个 `codex exec` 进程。所有 worker 使用同一个工作目录和当前选中的 Prompt。

每个 worker 的 Prompt 前会追加运行约束：

- worker 会知道自己是第几个并行进程
- 不要回滚或覆盖自己没有明确修改的内容
- 如果执行 `git commit`，只能 stage 和 commit 本轮亲自修改的文件
- 不要使用 `git add .`
- 提交前检查 `git diff` 和 `git status`

runner 不做文件锁、不建 worktree、不自动合并冲突，也不禁止提交。

## 停止

页面里的 `Stop after current` 会让当前批次继续跑完，然后不再启动下一批。

## 日志

日志按批次写入：

```text
logs/
  2026-05-13T12-00-00/
    summary.md
    worker-1.md
    worker-2.md
```

`summary.md` 记录批次结果；`worker-N.md` 记录对应 worker 的 stdout、stderr、Codex JSONL 事件和退出状态。

## 验证

```bash
pnpm test
pnpm typecheck
```
