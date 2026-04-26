# Stage 14 Feishu/Lark Runtime Migration Findings

## 约束

- 当前 UI 基线是 shadcn/ui `radix-nova`、neutral、Radix、lucide。
- UI 改动必须使用现有 shadcn 组件和 token，禁止自定义颜色、内联样式、渐变和卡片套卡片。
- 主进程必须遵守 Phase 0 hard constraints：IPC、webContents、网络端口、业务数据写入、敏感操作等都要走既有 runtime 基础设施。
- 用户要求严格对照 CC Connect 源码迁移，不允许凭计划或想象实现。

## 初始状态

- 当前任务需要先读 CC Connect Feishu/Lark 源码和 Synapse connectors/session/bridge/bootstrap 相关源码。
- 真实扫码验收可能需要用户手机和飞书/Lark 后台权限；如遇不可绕过的账号或开放平台权限阻塞，需写 handoff 并 Bark 通知。

## 源码对照发现

- CC Connect 在 `platform/feishu/feishu.go` 同时注册 `feishu` 与 `lark`，两者共享实现但默认 domain 不同。
- CC Connect Feishu/Lark runtime 的主路径是 `Start(handler)` -> SDK event dispatcher -> WebSocket 长连接 -> `onMessage`/`onCardAction`/`onBotMenu` -> `core.Engine.handleMessage` -> `Reply/Send`。
- CC Connect registration 共用 Feishu accounts API，poll 识别 `tenant_brand=lark` 后切到 `https://accounts.larksuite.com`。
- Synapse 当前 Stage 13 只有 QR begin/poll/save 和 secretRef 保存，没有任何 Feishu/Lark runtime service，也没有保存后启动/重载连接。
- Synapse 已有 `AgentSessionConnectService` 可把 `SynapseInboundMessage` 接到 session/agent 链路，是 Stage 14 runtime 的首选接入点。
