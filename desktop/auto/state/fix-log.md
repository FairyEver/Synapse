# Nightly Fix Log

---

## [2026-05-17 14:56] agent-1779000983-6307 第 1 轮

### 问题
- WorkflowList 刷新（删除工作流/外部更新）时 setLoading(true) 导致列表闪烁，用户先看到加载中再看到更新后的列表
- 类型：交互完整性
- 优先级：P3

### 修改
- `src/modules/workflow/hooks/use-workflow-list.ts`：remove setLoading(true) from refresh callback; initial loading=true handles first mount correctly

### 用户受益
- 删除工作流后不再出现加载中闪烁，列表立即反映删除结果（异步更新完成后替换）

### 验证
- eslint: 通过

### 风险
- 无已知风险

---

## [2026-05-17 15:17] agent-20260517-145615-k7m3 第 1 轮

### 问题
- useWorkflowRun hook 无人调用，只有测试文件引用，属于死代码
- 类型：死代码
- 优先级：P2

### 修改
- `src/modules/workflow/hooks/use-workflow-run.ts`：删除（无生产代码调用）
- `src/modules/workflow/hooks/__tests__/use-workflow-run.test.tsx`：删除（对应测试文件）

### 用户受益
- 减少维护负担，消除代码混淆

### 验证
- eslint: 通过
- vitest (hooks): 2 test files, 4 tests passed

### 风险
---

## [2026-05-17 22:26] agent-1779001446-3468 第 1 轮

### 问题
- refreshRepositoryStates 缺少 try-catch，bridge.getStates() IPC 拒绝时导致 unhandled rejection + UI 状态过时
- 类型：错误处理
- 优先级：P1

### 修改
- `src/app-shell/repository-manager.ts`：在 refreshRepositoryStates 中添加 try-catch，IPC 失败时保留现有状态

### 用户受益
- 仓库状态同步回调中 IPC 调用失败时不再产生未捕获的 Promise 拒绝，UI 保持已有状态而非闪白

### 验证
- eslint: 通过（无输出）

### 风险
- IPC 失败时仓库状态可能短暂过时，下次 onUpdated 回调会重试
