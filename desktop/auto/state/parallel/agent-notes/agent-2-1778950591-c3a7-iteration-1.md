# agent-2-1778950591-c3a7 第 1 轮

- 时间：2026-05-17 19:00
- 方向：工作流 IPC
- 结果：修复
- 问题：WorkflowRunSnapshot 缺少 error 字段，运行失败信息在 snapshot 持久化后丢失（save sites 未传递 error）
- 修改文件：
  - desktop/electron/modules/workflow/ipc.ts — 5 个 snapshots.save() 调用补上 error 字段
  - desktop/electron/modules/workflow/ipc.ts — engineRejectionDiagnostic 移除 errorMessage（避免日志泄露 secrets）
  - desktop/electron/modules/workflow/ipc.ts — visibleEngineRejectionError 改为接受原始 error，加入 sk-token 脱敏
  - desktop/electron/modules/workflow/__tests__/ipc.test.ts — 更新测试匹配新行为
- 验证：3 tests passed, tsc --noEmit 无新增错误, check:hard-constraints 通过
