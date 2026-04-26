# Stage 14 Feishu/Lark Runtime Migration Findings

## 约束

- 当前 UI 基线是 shadcn/ui `radix-nova`、neutral、Radix、lucide。
- UI 改动必须使用现有 shadcn 组件和 token，禁止自定义颜色、内联样式、渐变和卡片套卡片。
- 主进程必须遵守 Phase 0 hard constraints：IPC、webContents、网络端口、业务数据写入、敏感操作等都要走既有 runtime 基础设施。
- 用户要求严格对照 CC Connect 源码迁移，不允许凭计划或想象实现。

## 源码对照发现

- CC Connect 在 `platform/feishu/feishu.go` 同时注册 `feishu` 与 `lark`，两者共享实现但默认 domain 不同。
- CC Connect Feishu/Lark runtime 的主路径是 `Start(handler)` -> SDK event dispatcher -> WebSocket 长连接 -> `onMessage`/`onCardAction`/`onBotMenu` -> `core.Engine.handleMessage` -> `Reply/Send`。
- CC Connect registration 共用 Feishu accounts API，poll 识别 `tenant_brand=lark` 后切到 `https://accounts.larksuite.com`。
- Synapse Stage 13 只有 QR begin/poll/save 和 secretRef 保存，没有 Feishu/Lark runtime service，也没有保存后启动/重载连接。
- Synapse 已有 `AgentSessionConnectService` 可把 `SynapseInboundMessage` 接到 session/agent 链路，是 Stage 14 runtime 的首选接入点。

## B02 实现发现

- 官方 Node SDK `@larksuiteoapi/node-sdk` 提供 `WSClient`、`EventDispatcher`、`Client.im.v1.message.reply/create`，可覆盖当前 runtime 的最小真实长连接和回复链路。
- Node SDK 高层 `LarkChannel` 不暴露 `application.bot.menu_v6`，因此 Synapse runtime 使用底层 `WSClient + EventDispatcher`，显式注册 message/card action/bot menu。
- Synapse 当前 agent engine 仍是现有 session 事件链；Stage 14 runtime 已接入 `AgentSessionsStoreService.connectInbound()`，真实模型/CLI runtime 若未连接，会沿用现有错误事件。
- Feishu/Lark 群聊 mention 过滤依赖 bot open_id；runtime 会通过 `/open-apis/bot/v3/info` 获取，失败时按 CC Connect 行为让群过滤降级。
