# 夜间品质扫描报告

**扫描时间:** 2026-05-17
**扫描范围:** `desktop/src/` — 全套 455 个源文件
**技术栈:** React 19 + TypeScript 6 + shadcn/ui (radix-nova) + Tailwind CSS 4 + Electron 41 + Vite 8
**对比基线:** 现有 31 条 issue

---

## 综合优先级 (Top 15)

### [P1] 严重问题

1. **[P1][errorHandling] identity-gate 错误传播死路** — `identity-gate.tsx:105`
   generateNewId() 失败触发全屏错误页面替代恢复表单，唯一操作是 `window.location.reload()`，丢失用户全部上下文。
   **证据:** identity-context.tsx:118-121 设置全局 error，gate 的 `if (error)` 分支替换了 recovery 表单。

2. **[P1][crash] uncaughtException 不退出进程** — `electron/bootstrap/app-events.ts:27` *(已有 issue)*
   ```ts
   process.on('uncaughtException', (error) => { logger.error(...) })
   ```
   仅记录不退出，应用运行在未定义状态可能静默损坏数据。
   **状态:** 已有记录未修复。

### [P2] 重要问题

3. **[P2][errorHandling] row-editor Enter 保存静默吞错** — `modules/database/components/row-editor.tsx:149`
   ```tsx
   void handleSave().catch(() => {})
   ```
   数据保存失败完全无反馈，用户可能以为保存成功就切换页面。
   **影响范围:** 同一文件第 252 行相同模式。

4. **[P2][errorHandling] 数据表导入失败对话框卡死** — `modules/database/index.tsx:180`
   ```tsx
   catch (error) { logger.error(...) }
   // setPendingImport(null) ← 缺失!
   ```
   导入失败后 `setPendingImport` 未重置，替换表 AlertDialog 留在屏幕显示过期状态。

5. **[P2][errorHandling] 12+ 处直接调 sonner toast 绕过通知系统** — `data-table-view.tsx:330`, `content-browser-page.tsx:302` 等
   绕过 `useAppNotifications()` 导致通知无日志、无统一生命周期管理。

6. **[P2][codeStyle] renderer 从 electron/ 路径导入主进程模块** — `modules/workflow/runner/runner-app.tsx:16`
   ```tsx
   import { sanitizeError } from "../../../../electron/services/error-sanitize"
   ```
   renderer 包依赖主进程源文件，违反架构分层。

7. **[P2][codeStyle] workflow 模块 20+ 处 unchecked as 类型断言** — `modules/workflow/editor/node-wrappers.tsx:22` 等
   `data as { name?: string }`、`result.errors as { message?: string }[]` — 运行时形状变化静默产生 `undefined`。

8. **[P2][codeStyle] workflow 模块 IPC 访问模式不一致** — `modules/workflow/index.tsx:24`
   database 用 `requireSynapseBridge()` 立即报错，workflow 用 `window.synapse?.workflow.*` 静默吞没。bridge 断开时 database 用户看到明确错误，workflow 用户看到 "undefined"。

9. **[P2][errorHandling] 7 处 fire-and-forget IPC 调用无错误处理** — `modules/workflow/components/workflow-list.tsx:207`
   ```tsx
   void window.synapse?.workflow.openEditor(meta.id)
   ```
   打开编辑器/运行器失败时无日志、无用户反馈。

10. **[P2][design] 硬编码 hex 色值用于 provider 标识色** — `modules/token-usage/lib/colors.ts:2-8`
    ```ts
    const PROVIDER_COLORS: Record<string, string> = {
      anthropic: "#DA7756", openai: "#10B981", google: "#3B82F6", ...
    }
    ```
    通过 inline style 在 agents-view、models-view、overview-view、stacked-bar-chart 中使用，不响应主题切换。

11. **[P2][design] 多模块使用 text-[10px]/text-[11px] 任意字号** — `scan-item-card.tsx:53` 等 13+ 处
    包括 editor-scan、agent、workflow、settings 模块，脱离 `text-xs`/`text-sm` 主题字号体系。

12. **[P2][codeStyle] errorDiagnostic 工具函数 4 模块重复实现** — `modules/workflow/lib/error-utils.ts`
    use-agent-runtime-status.ts、task-scheduler、agent、workflow 各有一份近乎相同的 `errorDiagnostic()`。

### [P3] 体验与整洁

13. **[P3][codeStyle] 10 个结构完全相同的节点包装器组件** — `modules/workflow/editor/node-wrappers.tsx:19`
    编辑器 5 个 + runner 5 个，仅 NodeCard/ContextMenu 不同，~80% 代码重复。

14. **[P3][codeStyle] AppNotificationCenter 组件导出但从未引用** — `app-shell/app-notification-center.tsx`
    遗留废弃组件，可直接删除。

15. **[P3][design] 手写 pane 上下文菜单而非使用 shadcn ContextMenu** — `modules/workflow/editor/canvas.tsx:550`
    inline style 定位 + 手动样式按钮，复制 DropdownMenuItem 行为。

---

## 区域健康评估

| 区域 | 健康度 | 关键发现数 |
|------|--------|-----------|
| Gate (license/identity/repo) | 🟢 良好 | 2 P2 (错误传播) |
| App Shell + Tab Layout | 🟡 一般 | 2 P3 (dead code, hidden vs unmount) |
| Rules / Skills / Prompts | 🟢 良好 | 结构清晰，ErrorBoundary 覆盖 |
| Database | 🟢 良好 | 注意 2 个吞错 + 导入对话状态 |
| Agent | 🟢 良好 | hidden 模式需注释说明 |
| Task Scheduler | 🟢 良好 | 读写模式已验证 |
| Token Usage | 🟡 一般 | 3 处设计 token 违规 |
| **Workflow** | 🔴 **重点关注** | 7 个 P2 问题最集中的模块 |
| Settings | 🟢 良好 | 基本无问题 |
| Editor Scan | 🟢 良好 | UI token 小问题 |
| 全项目 | 🟡 一般 | 25 个新发现，workflow 模块为主要风险区 |

---

## 问题分布

```
P1 (严重):   2  (errorHandling/crash)
P2 (重要):   17 (errorHandling x7, design x3, codeStyle x6, logic x1)
P3 (体验):   6  (codeStyle x4, design x2)
```

---

## 已记录到 issues.jsonl

全部 25 个新问题已写入 `auto/state/issues.jsonl`（append-only），与现有 31 条记录共存，总计 56 条。

---

## 建议后续扫描方向

1. **Workflow 模块深度审计** — 本次 60% 的 P2 集中在 workflow，建议独立走查编辑器/运行器全部路径
2. **electron/ 主进程错误处理审计** — 检查所有 `throw new Error` 缺少 `cause` 链的模式（已有 3 条记录不完整）
3. **JSON.parse / Zod 边界** — 数据反序列化的类型安全性（已有 `z.any()` issue 需要评估）
