# auto

定时自动运行 Claude Agent 的轻量调度器。每隔固定时间读取一个 Prompt 文件，使用 `@anthropic-ai/claude-agent-sdk` 驱动 Agent 执行任务，并将运行日志保存到 `logs/` 目录。

## 前置条件

- 已安装 [Claude Code CLI](https://docs.anthropic.com/claude/claude-code) 并完成登录认证
- Node.js >= 18
- pnpm

## 安装

```bash
pnpm install
```

## 配置

编辑 `config.json`：

```json
{
  "intervalMinutes": 1,
  "workingDirectory": "/absolute/path/to/project",
  "promptFile": "./prompt.md",
  "maxLogs": 50
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `intervalMinutes` | number | 两次运行之间的间隔（分钟），最小为 `1`。计时从上一次运行**完成后**开始。 |
| `workingDirectory` | string | Agent 执行任务时的工作目录（即 Agent 可以读写文件的根路径）。支持绝对路径或相对于 `auto/` 的相对路径。 |
| `promptFile` | string | Prompt 文件路径，相对于 `auto/`。默认为 `./prompt.md`。 |
| `maxLogs` | number | `logs/` 目录中最多保留的日志文件数，超出后自动删除最旧的文件。 |

## 编写 Prompt

`prompt.md` 是每次传给 Agent 的任务描述，纯 Markdown 格式。Agent 会以 `workingDirectory` 为根目录执行其中描述的任务。

可以随时修改 `prompt.md`，下一次运行时自动生效，无需重启。

## 运行

**持续循环模式**（推荐用于长期自动化）：

```bash
pnpm start
```

启动后按 `Ctrl+C` 停止。每次运行完成后等待 `intervalMinutes` 分钟再执行下一次。

**单次执行模式**（测试 Prompt 时使用）：

```bash
pnpm once
```

执行一次后自动退出。

## 日志

每次运行会在 `logs/` 下生成一个以时间戳命名的 Markdown 文件，记录 Agent 的完整输出和工具调用。`logs/*.md` 已加入 `.gitignore`，不会提交到仓库。

达到 `maxLogs` 上限时，最旧的日志文件会被自动删除。
