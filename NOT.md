# 自动化审查保留说明

这个文件用于告诉审查 Agent：下面这些内容是有意保留的设计或实现，不要在自动化审查中误判为必须修改的问题。

## 内容图标颜色

`desktop/src/lib/content-appearance.ts` 中的 `SYNAPSE_CONTENT_COLOR_OPTIONS` 和 `SYNAPSE_LEGACY_CONTENT_COLOR_OPTIONS` 保留了彩色渐变背景，这是产品视觉设计的一部分。

不要把这些图标背景统一改成 `bg-muted`、`bg-secondary`、`bg-accent`、`bg-primary` 等单色主题 token，也不要因为 shadcn token 统一规则而移除 `bg-linear-to-br from-... to-...` 这组配色。

这些颜色用于 Rule、Skill、Prompt 的创建和展示图标。交互逻辑可以按需求调整，但这组彩色图标背景不应作为自动化审查的整改项。

## Prompt 发送并跳转时序

`desktop/src/modules/prompts/hooks/use-prompt-run.ts` 中 Prompt 的“发送并跳转”是有意设计成两阶段：

1. 先创建 Agent 会话。
2. 创建成功后立即跳转到 Agent 页。
3. 在后台把 Prompt 内容发送到刚创建的会话。

不要把这段逻辑改成 `await bridge.agent.send(...)` 完成后再 `requestOpenAgentSession(...)`。如果先等待发送完成，用户会一直停留在 Prompt 弹窗的 loading 状态，只能看到最终结果，无法在 Agent 页从头观看 thinking、tool、stream、phase 等中间过程。

也不要把完整 Prompt 内容重新放回 `requestOpenAgentSession({ ..., prompt })` 里依赖 Agent 页二次发送。这个 handoff 依赖刷新和切换会话的时序，容易出现已经跳到 Agent 页但没有选中新会话、没有发送到目标项目会话，或重复发送的问题。

审查这条链路时应保留以下行为：

- `发送并跳转` 只等待会话创建成功，不等待模型执行完成。
- 跳转 payload 只需要 `projectId` 和 `conversationId`，Prompt 内容由 Prompt 运行 hook 发送。
- 后台发送必须带上创建返回的 `session.sessionKey`、`session.id` 和用户选择的 `providerId`。
- 后台发送失败可以提示错误，但不要在跳转路径里删除已打开的会话。
- `后台发送` 按原语义可以等待发送完成，并在失败时做 best-effort 清理。

对应回归测试在 `desktop/src/modules/prompts/hooks/__tests__/use-prompt-run.test.tsx`，尤其要保留“send 未完成前已经触发跳转”的用例。自动化审查不要把 fire-and-forget 发送误判为必须改成同步等待；当前实现已经在异步函数内部捕获并记录发送失败。

## Agent SDK 读取 Claude Code 全局上下文

`desktop/electron/services/agent-runtime/claude-sdk-session.ts` 中 Claude Agent SDK 的 `settingSources` 保留为 `["user", "project", "local"]` 是有意设计。

Synapse 里的 Claude 需要复用本机 Claude Code 的全局和项目上下文，包括：

- `~/.claude/CLAUDE.md`
- `~/.claude/rules/*.md`
- `~/.claude/skills/*/SKILL.md`
- 项目内 `CLAUDE.md`、`.claude/rules/*.md`、`.claude/skills/*/SKILL.md`
- 本地 `CLAUDE.local.md` 和 `.claude/settings.local.json`

不要为了隔离 provider 鉴权而把 `settingSources` 简单改回 `[]`。这样会导致 Synapse Agent 读不到用户电脑上已有的 Claude Code skill、rule 和记忆，破坏当前产品预期。

当前隔离边界是：

- 保留 `settingSources: ["user", "project", "local"]`，让 SDK 发现全局/项目上下文。
- 保留 `skills: "all"`，让已发现的 skill 可用。
- 通过 `settings.env: options.env` 把 Synapse 当前 provider 的 `ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_API_KEY` 和模型环境变量放入更高优先级的 flag settings 层。
- `ProviderService.buildEnv()` 必须在两种 key 字段之间显式清空另一个字段：使用 `ANTHROPIC_AUTH_TOKEN` 时清空 `ANTHROPIC_API_KEY`，使用 `ANTHROPIC_API_KEY` 时清空 `ANTHROPIC_AUTH_TOKEN`，避免 `~/.claude/settings.json` 或进程环境中的旧凭证残留。
- `disableAllHooks: true` 继续保留，避免全局或项目 hook 在 Synapse 托管会话中执行。

审查时不要把 `settings.env: options.env` 误判为重复配置。它和顶层 `env: { ...process.env, ...options.env }` 不是同一层：顶层 `env` 传给 Claude Code 子进程，`settings.env` 用于覆盖从 `~/.claude/settings.json` / 项目 settings 读取到的同名 provider 鉴权配置。

## Agent 子进程 PATH 与 Node fallback

`desktop/electron/runtime/process/shell-environment.ts`、`desktop/electron/services/agent-runtime/claude-sdk-session.ts`、`desktop/electron/bootstrap/descriptors.ts` 和 `desktop/electron/services/diagnostics-service.ts` 中的 PATH 合并、login shell PATH 解析、Node fallback 与诊断展示是有意设计，用于修复 macOS GUI App 启动后 agent 子进程找不到 `node` 的问题。

典型场景是：用户终端里 `node -v` 正常，Node 位于 `/opt/homebrew/bin/node`，但 Synapse 从 Dock、访达或登录项启动时 App 进程只拿到 `/usr/bin:/bin:/usr/sbin:/sbin`，导致 agent 执行 `node ...` 报 `command not found: node`。

审查这条链路时应保留以下行为：

- Agent SDK 顶层 `env` 必须基于 host 环境构造，并合并 App PATH、login shell PATH 和 Synapse runtime fallback PATH；不要退回到简单的 `{ ...process.env, ...options.env }`。
- `settings.env: options.env` 继续只表达 provider 鉴权覆盖；它不能替代顶层子进程 `env`。
- login shell PATH 解析必须使用 `__SYNAPSE_PATH_BEGIN__` / `__SYNAPSE_PATH_END__` 标记读取，避免用户 `.zshrc`、`.zprofile` 或 shell framework 打印额外内容时污染 PATH。
- login shell 读取失败或超时时应降级，不应阻断启动；缓存和短时间失败重试控制是为了避免反复触发重型 shell 初始化。
- `core.process-environment` 启动服务创建 `node` / `synapse-node` shim 是 fallback，不是替代用户真实 Node。真实 Node 在 PATH 中存在时应优先命中，fallback 只用于避免直接 `node: command not found`。
- fallback shim 通过 `ELECTRON_RUN_AS_NODE=1` 调用 Electron 可执行文件，这是为了复用随 App 分发的 Node runtime。不要把它误判为误调用 App 主程序。
- Windows 上 `Path` / `PATH` 需要按平台大小写不敏感处理，不能只读取大写 `PATH`。
- 诊断页的 `system.node-visibility` 检查应保留，用于明确展示 `App PATH`、`Login Shell PATH`、最终 PATH、各层 node 可见性和 Synapse Node fallback 目录。

这组逻辑的目标是让用户无需手动改 `.zshrc` 或重新从终端启动 Synapse，就能让 Agent 子进程继承可用命令环境。自动化审查不要把 PATH 合并、全局 `process.env.PATH` 更新、runtime-bin shim 或诊断明细误判为多余改动。
