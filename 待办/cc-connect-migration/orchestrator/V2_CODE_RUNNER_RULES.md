# V2 代码执行器规则

本文件用于重新执行 CC Connect 融合到 3S 的 v2 代码迁移。v2 不继续旧 stage 06 的空壳式实现，必须以 `8.1` 到 `8.7` 的 Admin 实测、`9.0` 到 `9.3` 的 v2 规划为准。

## 1. 固定输入

执行前必须读取：

```text
AGENTS.md
.claude/rules/design.md
.claude/rules/ui-rules.md
待办/cc-connect-migration/整体标准.md
待办/cc-connect-migration/orchestrator/HANDOFF_PROTOCOL.md
待办/cc-connect-migration/orchestrator/V2_CODE_RUNNER_RULES.md
待办/cc-connect-migration/artifacts/0.0-latest-handoff.md
待办/cc-connect-migration/artifacts/8.1-cc-connect-admin-walkthrough.md
待办/cc-connect-migration/artifacts/8.2-cc-connect-admin-screen-map.md
待办/cc-connect-migration/artifacts/8.3-cc-connect-admin-interaction-ledger.md
待办/cc-connect-migration/artifacts/8.4-cc-connect-admin-to-3s-gap-list.md
待办/cc-connect-migration/artifacts/8.5-cc-connect-admin-layout-and-flow-map.md
待办/cc-connect-migration/artifacts/8.6-cc-connect-feature-implementation-gap-matrix.md
待办/cc-connect-migration/artifacts/8.7-product-scope-and-usability-analysis.md
待办/cc-connect-migration/artifacts/9.0-product-scope-decision-table.md
待办/cc-connect-migration/artifacts/9.1-v2-product-design.md
待办/cc-connect-migration/artifacts/9.2-v2-development-plan.md
待办/cc-connect-migration/artifacts/9.3-v2-acceptance-ledger.md
```

CC Connect 原项目固定路径：

```text
/Users/liyang/Desktop/code-guide/cc-connect-main
```

如果该路径不存在，必须更新状态文件、发送 Bark 通知并暂停。不得使用记忆或猜测替代源码。

## 2. 推荐对话拆分

推荐按 5 个代码对话 + 1 个独立审计对话执行：

| 对话 | 执行范围 | 目标 |
| --- | --- | --- |
| V2-RUN-01 | V2-B00 到 V2-B03 | 移除空壳，建立项目、详情、平台连接基础 |
| V2-RUN-02 | V2-B04 到 V2-B05 | Provider 全局管理和项目绑定 |
| V2-RUN-03 | V2-B06 到 V2-B08 | 会话列表、Chat 发送闭环、事件/权限/富消息 |
| V2-RUN-04 | V2-B09 到 V2-B12 | 命令面板、Cron、Heartbeat/Hooks、系统设置 |
| V2-RUN-05 | V2-B13 到 V2-B14 | Skills 项目扫描、Bridge/Webhook/API/诊断 |
| V2-AUDIT | V2-B15 | 最终反向覆盖审计 |

每个对话只执行自己的范围。完成本对话范围后必须停止、更新纸条、发送 Bark 通知，不得自动进入下一个对话范围。

## 3. 状态文件

v2 执行器维护：

```text
待办/cc-connect-migration/artifacts/9.0-v2-code-runner-state.md
待办/cc-connect-migration/artifacts/9.0-v2-code-runner-log.md
待办/cc-connect-migration/artifacts/9.0-v2-code-runner-resume-prompt.md
待办/cc-connect-migration/artifacts/9.0-v2-code-runner-summary.md
```

每批生成：

```text
待办/cc-connect-migration/artifacts/9.x-source-trace-<batch-id>-<short-name>.md
待办/cc-connect-migration/artifacts/9.x-execution-report-<batch-id>-<short-name>.md
```

阻塞时生成或更新：

```text
待办/cc-connect-migration/artifacts/9.x-v2-blocker.md
```

## 4. 源码证据硬规则

计划文件只决定“做什么”和“放哪里”。真正写代码前，必须先去 CC Connect 原项目找对应实现。

每个批次开始写代码前必须完成：

1. 从 `9.2-v2-development-plan.md` 找到本批次要求读取的 CC Connect 源码。
2. 在 `/Users/liyang/Desktop/code-guide/cc-connect-main` 中使用 `rg` 搜索页面名、函数名、字段名、命令名、API 路由、配置 key。
3. 读取实际存在的源码、测试、fixtures、配置示例或文档。
4. 写入本批 `9.x-source-trace-*`，记录：
   - 已读取的 CC Connect 文件路径。
   - 已确认的函数、字段、默认值、状态机、错误处理、边界条件。
   - 迁移到 3S 后对应的 TypeScript 文件或计划落点。
   - 无法确认的内容。

禁止：

1. 禁止凭记忆写旧逻辑。
2. 禁止引用没有实际读取过的路径、函数、字段或 API。
3. 禁止用“应该、可能、一般会”当作实现依据。
4. 禁止因为计划里写了功能目标，就直接凭空设计一个相似功能。
5. 禁止找不到源码时继续写代码。

找不到直接源码时，只能按以下顺序处理：

1. 继续用 `rg` 扩大关键词。
2. 查 Web Admin 页面源码、Go core、config、daemon、npm、README、测试和 fixtures。
3. 如果仍找不到，写入 `9.x-v2-blocker.md`，更新 handoff，发送 Bark 通知并暂停。

## 5. 单批执行循环

每个批次按以下顺序执行：

1. 读取固定输入、v2 state、handoff。
2. 确认当前批次属于本对话执行范围。
3. 检查 `git status --short`。如存在与本任务无关的业务代码脏改，必须暂停。
4. 读取本批在 `9.2`、`9.3` 中的目标和验收项。
5. 执行“源码证据硬规则”，先生成本批 source trace。
6. 检查 3S 现有代码结构，优先复用现有 service、IPC、hook、组件和类型。
7. 外科手术式实现本批功能，不扩大范围。
8. UI 必须遵守 shadcn/Radix/Tailwind token，不写自定义颜色、装饰渐变、界面废话或卡片套卡片。
9. 敏感信息必须使用 secretRef、脱敏日志、PermissionGuard/AuditSink，通知和报告不得包含 secret/token/API key/二维码内容。
10. 添加或更新本批必要测试，测试样本优先来自 CC Connect 原源码、测试、fixtures 和边界条件。
11. 运行本批验证命令。
12. 运行通用验证：
    - `pnpm desktop:typecheck`
    - `pnpm desktop:check:hard-constraints`
    - `pnpm desktop:check:ipc-codegen`
    - `git diff --check`
13. 失败最多修复 3 轮。第 3 轮仍失败时，写 blocker、更新 handoff、发送 Bark 通知并暂停。
14. 更新 `9.0`、`9.3` 和本批执行报告中的真实证据。
15. 更新 v2 state/log/resume/summary。
16. 更新 `0.0-latest-handoff.md`。
17. 创建本批 git commit。
18. 本批完成后发送 Bark 通知。
19. 如果还有本对话范围内的下一个批次，继续；否则停止并等待用户检查。

## 6. Commit 规则

每批验证通过后必须单独提交。commit message 必须能从日志里看出阶段、批次、功能和证据。

格式：

```text
stage09-v2(<batch-id>): <批次名称> [<F ID 范围>]

Source: <本批读取的 CC Connect 关键源码路径，最多 3 个；完整列表见 source trace>
Verify: <本批主要验证命令摘要>
Report: 待办/cc-connect-migration/artifacts/9.x-execution-report-<batch-id>-<short-name>.md
```

示例：

```text
stage09-v2(V2-B01): Project 数据和 UI 基础 [F-005..F-010]

Source: web/src/pages/Dashboard.tsx; web/src/pages/Projects/ProjectList.tsx; core/projectstate.go
Verify: pnpm desktop:typecheck; pnpm desktop:check:hard-constraints; pnpm desktop:check:ipc-codegen
Report: 待办/cc-connect-migration/artifacts/9.x-execution-report-V2-B01-project-foundation.md
```

## 7. 必须暂停并通知的情况

出现以下任一情况，必须先更新 state/log/resume/summary/handoff，再发送 Bark 通知，然后暂停：

1. 找不到 CC Connect 原项目路径。
2. 找不到本批对应源码证据。
3. 需要新增依赖且未在文档中预授权。
4. 需要用户提供 token、二维码、账号、真实 secret 或外部服务权限。
5. 发现 `9.0` 范围裁剪需要改变。
6. 第 3 次验证仍失败。
7. 出现与本批无关的业务代码脏改。
8. 需要启动 Electron、dev server、浏览器或 Playwright 才能继续，而用户尚未明确授权。
9. 本对话执行范围完成，需要用户检查后开下一段。

通知正文必须简短，只说阶段/批次、为什么停、先看哪个文件、建议回复什么。不得包含敏感内容。

## 8. 完成判定

每批只有同时满足以下条件才算完成：

1. 本批 source trace 已写入，且路径真实存在。
2. 本批实现能追溯到 CC Connect 原源码或明确的 v2 裁剪决策。
3. 用户可见入口不是空壳，按钮和表单有真实 handler 或明确禁用原因。
4. 自动验证通过。
5. 执行报告已写入。
6. `9.0` / `9.3` / state / log / resume / summary / handoff 已更新。
7. 本批有独立 git commit，且 commit body 包含 Source / Verify / Report。
8. Bark 完成通知已发送或通知失败已记录。

本对话范围全部完成后，必须在 `9.0-v2-code-runner-summary.md` 中写明：

1. 已完成哪些批次。
2. 每批 commit。
3. 每批 source trace 和 report。
4. 当前是否有 blocker。
5. 下一段应该启动哪个 V2-RUN。
6. 用户第一眼应该看什么。
