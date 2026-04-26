# Stage 14 Feishu/Lark Runtime Migration Progress

## 2026-04-26

- 接收 Stage 14 任务：Synapse 外部平台仅保留 Feishu/Lark，并完整迁移 CC Connect Feishu/Lark runtime。
- 已读取技能约束：`shadcn`、`karpathy-guidelines`、`planning-with-files-zh`。
- 已读取项目 UI 规则：`.claude/rules/design.md`、`.claude/rules/ui-rules.md`。
- 已创建工作分支 `codex/stage14-feishu-lark-runtime`。
- 已阅读用户指定 CC Connect 源码中的 Feishu/Lark registration、config 写入、runtime Start、WebSocket、message receive、reply send、card action、bot menu、core Engine 和接口。
- 已阅读用户指定 Synapse 源码中的 connector registry、QR onboarding、IPC/preload、renderer connectors module、AgentSessionConnectService、BridgeService、ManagementApiService、bootstrap descriptors 和相关测试。
- B01：已新增 `14.0-feishu-lark-runtime-state.md`、`14.1-feishu-lark-source-trace.md`、`14.2-platform-scope-prune-report.md`。
- B01：已将内置 descriptors、QR 平台类型、IPC schema 和添加平台 UI 裁剪为 Feishu/Lark；非 Feishu/Lark manual save 现在拒绝写入，历史平台连接继续展示并标记“不支持”。
- B01 验证：`pnpm --filter @synapse/desktop exec vitest run tests/unit/connector-qr.test.ts tests/unit/connectors.test.ts` 通过，16 tests；`pnpm desktop:typecheck` 通过；`git diff --check` 通过。
- B01 提交：`6d7a4dc stage14(S14-B01): 仅保留 Feishu Lark 平台入口`。
- B02：已新增官方最小依赖 `@larksuiteoapi/node-sdk`，用于 Feishu/Lark WebSocket 长连接、事件 dispatcher、消息 reply/create API。
- B02：已新增 `FeishuLarkRuntimeService`，启动已配置 Feishu/Lark 连接，保存 QR 后触发项目连接 reload，事件接入 `AgentSessionsStoreService.connectInbound()`，agent outbound 调用 Feishu/Lark send。
- B02：已新增 secret read 审计能力，runtime 从 main 侧 secret store 读取 app_secret，不返回 renderer。
- B02：已补 runtime 单测，覆盖 Feishu/Lark start、inbound session、outbound send、card action、bot menu。
- B02 当前验证：`pnpm --filter @synapse/desktop exec vitest run tests/unit/feishu-lark-runtime.test.ts` 通过，5 tests；`pnpm --filter @synapse/desktop exec vitest run tests/unit/connector-qr.test.ts tests/unit/connectors.test.ts` 通过，16 tests；`pnpm desktop:typecheck`、`pnpm desktop:check:hard-constraints`、`pnpm desktop:check:ipc-codegen`、`git diff --check` 通过。
