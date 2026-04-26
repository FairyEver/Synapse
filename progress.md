# Stage 14 Feishu/Lark Runtime Migration Progress

## 2026-04-26

- 接收 Stage 14 任务：Synapse 外部平台仅保留 Feishu/Lark，并完整迁移 CC Connect Feishu/Lark runtime。
- 已读取技能约束：`shadcn`、`karpathy-guidelines`、`planning-with-files-zh`。
- 已读取项目 UI 规则：`.claude/rules/design.md`、`.claude/rules/ui-rules.md`。
- 已确认当前仓库路径为 `/Users/liyang/Documents/code/github/Synapse`，当前分支 `main`，相对 `origin/main` ahead 76。
- 已将规划文件切换为 Stage 14 当前任务。
- 已创建工作分支 `codex/stage14-feishu-lark-runtime`。
- 已阅读用户指定 CC Connect 源码中的 Feishu/Lark registration、config 写入、runtime Start、WebSocket、message receive、reply send、card action、bot menu、core Engine 和接口。
- 已阅读用户指定 Synapse 源码中的 connector registry、QR onboarding、IPC/preload、renderer connectors module、AgentSessionConnectService、BridgeService、ManagementApiService、bootstrap descriptors 和相关测试。
- 已新增 `14.0-feishu-lark-runtime-state.md` 与 `14.1-feishu-lark-source-trace.md`。
- B01：已将内置 descriptors、QR 平台类型、IPC schema 和添加平台 UI 裁剪为 Feishu/Lark。
- B01：非 Feishu/Lark manual save 现在拒绝写入；历史平台连接继续展示并标记“不支持”。
- B01 验证：`pnpm --filter @synapse/desktop exec vitest run tests/unit/connector-qr.test.ts tests/unit/connectors.test.ts` 通过，16 tests。
- 已新增 `14.2-platform-scope-prune-report.md`。
- 当前回合未继续 Stage 14 代码实现；用户在设计双 Codex 对话长任务运行系统。已建议采用 Controller/Worker 文件交接流，由 Controller 写入 `.ai-control/prompts/current-worker-prompt.md`，Worker 用固定短句读取并执行。
