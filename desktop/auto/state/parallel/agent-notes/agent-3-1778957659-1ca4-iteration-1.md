# agent-3-1778957659-1ca4 第 1 轮

- 时间：2026-05-16 18:55
- 方向：工作流 UI（workflow-list.tsx）
- 结果：修复
- 问题：workflow-list.tsx 的 errorLogMeta 函数只返回 errorLength（字符数）而非 errorMessage，日志丢失错误详情
- 修改文件：desktop/src/modules/workflow/components/workflow-list.tsx
- 验证：eslint 通过、check:hard-constraints 通过、影响面无外部引用
