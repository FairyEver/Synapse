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
