# Pending Release Notes

## 新增功能

## 功能优化

- Agent 长会话恢复为 Claude Agent SDK 原生 Streaming Input、会话续接与自动整理机制，不再由 Synapse 预估请求容量、截断工具结果、自动交接任务或阻断最终回答；百炼与其它 Provider 使用一致的运行规则。
- Agent 与内置 Claude Code 终端仅透传 Provider 明确配置的上下文窗口环境变量，上下文状态只展示 SDK 返回的真实用量与整理阈值。

## 问题修复

- 修复本地上下文整理、输出结构替换和任务证据校验可能在供应商阈值前提前终止 Agent 对话的问题；真实 Provider 错误现在只结束当前轮，不再触发隐藏恢复流程。

## 技术调整
