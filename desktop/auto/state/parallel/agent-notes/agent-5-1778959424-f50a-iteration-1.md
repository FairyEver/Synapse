# agent-5-1778959424-f50a 第 1 轮

- 时间：2026-05-17 03:49
- 方向：工作流 UI（Runner 常量提取）
- 结果：修复
- 问题：STATUS_LABEL/STATUS_VARIANT/RUN_STATE_BADGE 在 4 个文件中重复定义，RUN_STATE_BADGE 标签不一致（"全部完成" vs "已完成"、"执行失败" vs "失败"）；execution-overlay.tsx 从死代码钩子导入 RunState 类型
- 修改文件：src/modules/workflow/lib/status-display.ts（新建）、src/modules/workflow/runner/timeline-view.tsx、src/modules/workflow/runner/node-result-panel.tsx、src/modules/workflow/editor/execution-overlay.tsx、src/modules/workflow/runner/runner-toolbar.tsx
- 验证：ESLint 通过、tsc 无新增错误、hard-constraints 通过、2 个测试通过
