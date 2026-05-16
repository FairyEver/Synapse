# agent-1-1778952060-fd76 第 1 轮

- 时间：2026-05-17 01:30
- 方向：工作流引擎
- 结果：修复
- 问题：use-workflow-events.ts 中 errorLogMeta/workflowErrorLogMeta 只返回 errorLength（字符数）但不包含实际错误内容，日志无法用于调试
- 修改文件：desktop/src/modules/workflow/hooks/use-workflow-events.ts, desktop/src/modules/workflow/hooks/__tests__/use-workflow-events.test.tsx
- 验证：7/7 tests passed, check:hard-constraints passed
