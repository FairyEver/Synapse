# Claude Code / Synapse Agent 百炼原生上下文 A/B

日期：2026-09-15

## 环境

- Claude Agent SDK：0.3.245
- SDK 捆绑 Claude Code runtime：2.1.245
- Provider：Synapse 当前激活的阿里云百炼 Anthropic 兼容配置
- 模型：`qwen3.8-max`
- 两条链路使用相同 Provider 环境、模型、临时工作目录和输入序列；Claude Code 按产品实现使用高优先级临时 settings 固定所选 Provider。
- 凭据由 Electron Safe Storage 解密后只存在于验收进程环境，没有写入仓库、命令参数或结果。

## 长会话结果

输入为四轮确定性大文本压力消息，随后五轮短消息。两条链路分别使用一个全新的持久 Streaming Input session。

| 观察项 | Claude Code | Synapse Agent |
|---|---:|---:|
| 输入轮数 | 9 | 9 |
| session 数 | 1 | 1 |
| 普通失败 | 第 2 轮一次 `Prompt is too long` | 第 2 轮一次普通 `execution_failed` |
| 原生 compact boundary | 3 | 3 |
| compact 后连续成功轮数 | 5 | 5 |
| 自动 handoff / recovery | 0 | 0 |

两条链路均在一次大输入失败后继续使用原 session；第 3 轮开始恢复成功并收到原生 compact boundary。Synapse 没有系统性早于 Claude Code 失败，也没有产生本地预算、整理、输出替换、交接或证据错误。

Claude Code 2.1.245 对该次大输入返回 `subtype=success`、`is_error=true` 和 `Prompt is too long`；Synapse 将同类终态统一投影为普通执行失败。这是展示层差异，不改变底层失败次数或 session 连续性。

## 大文本与图片补充

另用相同百炼配置要求 Claude Code 通过原生 Read 同时读取 512 KiB 文本和一张 PNG。Claude Code 基线在 180 秒内没有产生 result，因此该用例不能作为两条链路的有效 A/B，也不能宣称真实工具/视觉验收通过。Synapse 没有为追求通过而缩小材料或恢复已删除的外围机制。

Read、Bash、MCP `structuredContent`、数组与图片结果不被 Synapse 改写的边界由无网络契约测试覆盖；真实复杂工具任务仍应作为独立、长时限验收执行。
