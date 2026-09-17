# 手机端创建 Claude Code 对话 · 实施计划

日期：2026-09-17
设计依据：`docs/superpowers/specs/2026-09-17-mobile-claude-code-conversation-design.md`
原型：`docs/prototypes/2026-09-17-mobile-claude-code-conversation.html`

---

## 总览

| 阶段 | 内容 | 主要产物 | 可独立验收 |
|---|---|---|---|
| 0 | 协议与契约 | `shared` 新意图 + 摘要两个区块 | 是 |
| 1 | 桌面端创建逻辑抽成 service | 一份可复用实现 | 是 |
| 2 | 桌面端网关分支 | 意图可被执行 | 是 |
| 3 | 桌面端摘要下发目录 | 手机能看到项目与供应商 | 是 |
| 4 | iOS 协议镜像与服务层 | 能发意图、能记住上次 | 否 |
| 5 | iOS 界面 | 面板、分段、三行、主按钮 | 是 |
| 6 | 兼容收口与发版 | 升级顺序、真机验收 | 是 |

**阶段 0—3 全部完成前，阶段 5 无法端到端验收。** 建议 0—3 合并为一次桌面/服务端交付，5 单独一次 App 交付。

---

## 阶段 0 · 协议与契约（`@synapse/shared`）

### 产物

1. `MobileIntent` 增加 `createAgentConversation`：

```ts
| (MobileIntentEnvelope<"createAgentConversation"> & {
    readonly projectId: string
    readonly providerId?: string
    readonly modelTier?: ModelTier
    readonly cols?: number
    readonly rows?: number
    readonly deviceLabel?: string
  })
```

2. `isMobileIntent` 增加分支。**`switch` 的 `default: return false` 不能动**——那是未知 kind 的防线。
   - `projectId`：`boundedString(…, 120)`
   - `providerId` / `modelTier`：可选，给了就校验
   - 尺寸：复用已有的 `resizeShape(value.cols, value.rows)`（要么两个都给要么都不给）

3. `MobileSummaryPayload` 增加两个可选区块：

```ts
readonly agentGroups?: readonly MobileSummaryAgentGroup[]    // { projectId, name, isDefault }
readonly agentProviders?: readonly MobileSummaryAgentProvider[] // { id, name, isDefault, models: { default?, opus?, sonnet?, haiku? } }
```

4. `MOBILE_FRAME_LIMITS` 增加对应上限常量（命名与注释风格照 `maxSummaryGroupNameLength` 那一批）：
   `maxSummaryAgentGroups` / `maxSummaryAgentProviders` / `maxSummaryAgentNameLength` / `maxSummaryModelNameLength`。

### 关键约束

- **可选而非可空**。`agentGroups` / `agentProviders` 缺失时，序列化结果必须与改动前**逐字节一致**——沿用现有「Optional rather than nullable so the common payload stays byte-for-byte what it was before this field existed」的做法。这条要有测试钉住。
- 供应商区块**不含 `baseUrl`**，类型层面就不要给它留位置。

### 涉及文件

- `shared/src/mobile-live.ts`
- `shared/src/mobile-live.test.ts`
- `shared/src/live.ts`（只在类型联合需要时改）
- `shared/src/live.test.ts`

### 验证

```bash
pnpm --filter @synapse/shared run test
pnpm --filter @synapse/shared run build   # 桌面与服务端消费的是产物
```

### 完成标准

- 新 kind 的合法/非法载荷用例各有断言（缺 `projectId`、尺寸只给一半、`modelTier` 非法值、未知字段）。
- 不含新字段的摘要序列化字节数与改动前一致（用快照或定长断言钉住）。
- `pnpm --filter @synapse/desktop run test` 与 `pnpm --filter @synapse/server run test` 在 shared 改动后仍全绿。

---

## 阶段 1 · 桌面端：把创建逻辑抽成可复用 service

### 产物

从 `desktop/electron/modules/agent/ipc-claude-code-terminal.ts` 抽出：

```ts
createClaudeCodeTerminalSession(
  resolve,
  { projectId, providerId?, modelTier?, cols?, rows? },
): Promise<TerminalSession>
```

内部顺序不变：`resolveProjectAgent` → `resolveBundledClaudeExecutable` → `providerService.buildEnv` → **解析缺省选型** → `resolveTierModelFromEnv` → 写临时 `settings.json`（`0600`）→ `createSessionWithEphemeralEnvironment`。

缺省选型沿用 `desktop/electron/modules/agent/conversation-creation.ts` 的既有做法：
`pickInitialProviderModelSelection(providers, explicit ?? config.agent.defaultProviderModel)`。**不要另写一套解析。**

### 关键约束

- **IPC 契约不动**。`ipc-claude-code-terminal.ts` 的 request schema 保持 `providerId` / `modelTier` 必填（渲染进程一直传），只是 handler 改为调用新 service。现有 `ipc-claude-code-terminal.test.ts` 必须**不改断言**地全绿。
- 临时目录的清理语义不变：成功时 `onEnded` 删，失败时立即删（现有 `try/catch` + `rm` 逻辑原样保留）。
- `resolveClaudeCodeTerminalPermissionMode` 行为不变。

### 涉及文件

- `desktop/electron/modules/agent/ipc-claude-code-terminal.ts`（改为薄 handler）
- 新 service（建议就近放在 `desktop/electron/modules/agent/` 下，与 `conversation-creation.ts` 并列）
- `desktop/electron/modules/agent/__tests__/ipc-claude-code-terminal.test.ts`（新增：缺省选型解析用例）

### 验证

```bash
pnpm --filter @synapse/desktop run test
pnpm --filter @synapse/desktop run typecheck
```

### 完成标准

- 现有 IPC 测试零改动通过。
- 新增用例覆盖：只传 `projectId` 时按全局默认解析；全局默认无效时回退到当前激活 Provider；再无效时回退到首个可用 Provider；都解析不出时报错且**不留下半成品会话和临时目录**。

---

## 阶段 2 · 桌面端：网关分支

### 产物

`desktop/electron/services/mobile-gateway/intent-executor.ts` 的 `switch (intent.kind)` 增加：

```ts
case "createAgentConversation": {
  await this.deps.authorize("terminal.session.create", `terminal.group:${projectId}`)
  // 带初始尺寸时 ADR 0063 要求同时授权 resize
  const session = await createClaudeCodeTerminalSession(...)
  await this.adoptCreatedSession(mobileClientInstanceId, session.id)
  return accepted(intent.intentId, { createdSessionId: session.id })
}
```

### 关键约束

- 授权与 `create` intent 对齐：`terminal.session.create`，带尺寸时再加 `terminal.session.resize`。
- 执行前过 `PermissionGuard`，写 `AuditSink`；`createdByClientId` 用 `mobile:<mobileClientInstanceId>`（对齐 `launchCommand`）。
- `default:` 分支的 `unsupported_intent` **保持不变**——那是老桌面面对新手机时的正确回答。
- 结果缓存与 `intentId` 幂等由 `execute()` 外层负责，本分支不要重复实现。

### 涉及文件

- `desktop/electron/services/mobile-gateway/intent-executor.ts`
- `desktop/electron/services/__tests__/mobile-gateway-service.test.ts`
- `desktop/electron/services/__tests__/mobile-gateway-permissions.test.ts`

### 验证

```bash
pnpm --filter @synapse/desktop run test
pnpm --filter @synapse/desktop run check:hard-constraints
```

### 完成标准

- 意图可用、返回 `createdSessionId`，手机侧能立刻 attach。
- 权限用例：无 `terminal.session.create` 时被拒且不创建任何会话。
- 重复投递同一 `intentId` 只创建一个会话（回放缓存生效）。

---

## 阶段 3 · 桌面端：摘要下发项目与供应商

### 产物

`desktop/electron/services/mobile-gateway-service.ts` 的 summary 生产者增加两块，数据来源：

- 项目：复用 `app.agent.group.list` 背后的 `groups()`（`desktop/app-capabilities/agent/main/control-service.ts:125`，返回 `{projectId, name, isDefault}`）。**直接复用，不要另建一套选项目录。**
- 供应商：非归档的 `SynapseAgentProviderSummary`，**只取 `id` / `display` 与四个档位模型名**，剔除 `baseUrl`。

### 关键约束

- 每个字段都按 §阶段 0 的上限常量**在生产端裁剪**（与现有 `clampSummaryText` 一批做法一致），保证永远不会因为超限而在验证层被丢。
- 并入现有的收缩路径（`mobile-gateway-service.ts:572` 的 summary 字节预算收缩），收缩时**不丢会话**这条不变量不能被破坏。
- 摘要的内容指纹：字段缺失时序列化结果与改动前一致，空闲零流量这条不能破。

### 涉及文件

- `desktop/electron/services/mobile-gateway-service.ts`
- `desktop/electron/services/__tests__/mobile-gateway-service.test.ts`

### 验证

```bash
pnpm --filter @synapse/desktop run test
```

### 完成标准

- 无项目 / 无供应商时区块为空数组（而不是报错或整条消息不发）。
- 摘要字节预算用例仍然通过；收缩后会话数量不减少。
- 项目重命名会触发一次摘要下发（内容指纹按预期变化）。

---

## 阶段 4 · iOS：协议镜像与服务层

### 产物

1. `SynapseMobile/SynapseMobile/Core/Protocol/LiveProtocol.swift` 镜像新意图与新摘要字段。**必须以 `shared/src/mobile-live.ts` 为准逐字段核对。**
2. `SynapseAppModel` 增加：

```swift
func createAgentConversation(
  projectId: String,
  providerId: String?,
  modelTier: String?,
  cols: Int?, rows: Int?, deviceLabel: String?
) async -> String?   // 返回 createdSessionId
```

放在现有 `createSession(groupId:title:)`（`SynapseAppModel.swift:745`）旁边，复用同一套 `performReturningSession` 与超时/重放策略。

3. 本地偏好：记住上次的项目 / 供应商 / 模型档。照 `Features/Terminal/TerminalDisplaySettings.swift` 的既有做法（`UserDefaults` + 按 key 清理），**不上传**。

### 关键约束

- `"no_result" / "delivery_failed" / "timeout"` **从不重放**这条既有规则（`SynapseAppModel.swift:754`、`:1246`）必须保持不变。
- 新增一个把 `timeout` 翻译成用户可读原因的映射（见阶段 6）。
- 创建成功后落回既有路径：进终端页并设为「优先移动端」，与 `createSession` 一致。

### 涉及文件

- `SynapseMobile/SynapseMobile/Core/Protocol/LiveProtocol.swift`
- `SynapseMobile/SynapseMobile/App/SynapseAppModel.swift`
- 新的偏好存储（与 `TerminalDisplaySettings.swift` 并列）
- `SynapseMobile/SynapseMobileTests/`（新增用例）

### 验证

```bash
xcodebuild -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
```

单测走 `SynapseMobileTests`（本地 xcodebuild，不要用裸 `npx`）。

### 完成标准

- 解码新摘要字段的用例：有字段 / 无字段两种情况都通过。
- 偏好读写用例：首次无值、写入后读回、项目消失后的兜底。

---

## 阶段 5 · iOS：界面

### 产物

`Features/Sessions/SessionListView.swift`：

1. `＋` 仍打开 `NewSessionSheet`（`:295`），但重做成：

```swift
.presentationDetents([.fraction(0.75), .large])
.presentationDragIndicator(.visible)
```

2. 顶部 `Picker(...).pickerStyle(.segmented)`，两项「对话」/「终端」，默认选中「对话」。
3. **对话段**：三行（项目 / 供应商 / 模型）+ 全宽主按钮「开始对话」。三行点进面板内的下一层（`NavigationStack` push，顶部换成返回 + 标题）。
4. **终端段**：保持现在的分组列表，点分组即建——**行为不变**。
5. 失败态：面板保持打开，错误就地显示在面板内（不是全局通知条），三行选择不丢。
6. 离线态：`＋` 保持现有禁用逻辑。

### 关键约束

- 视觉只用现有 `Theme` token 与 iOS 系统组件。`Theme.attention` 是唯一强调色且只表示「需要人」，创建失败用 `Theme.failure`。
- 文案遵守仓库 UI 文案底线：只留必要标题、label、操作和空/错/加载状态。
- 不引入任何第三方依赖（该工程当前零 SPM 依赖）。

### 涉及文件

- `SynapseMobile/SynapseMobile/Features/Sessions/SessionListView.swift`（拆出新面板视图，参考现有 `NewSessionSheet` 的拆法）
- `SynapseMobile/SynapseMobileTests/`（分段与默认值的选择逻辑抽成可测的纯函数）
- `SynapseMobile/SynapseMobileUITests/`（走查：打开面板 → 切段 → 选项目 → 开始）

### 验证

```bash
xcodebuild -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build

# 端到端需要一台「桌面端」来源；不打断正在使用的 Synapse 时用模拟桌面端
node server/test/mock-desktop.mjs <email> <password> http://127.0.0.1:3001
```

### 完成标准

- 两条主路径可走通：默认路径（`＋` → 开始对话）、换项目路径（`＋` → 项目 → 选 → 开始对话）。
- 终端段的行为与改动前逐项一致。
- 面板在 3/4 与拉满两档下都无内容截断或按钮被键盘/安全区遮挡。

---

## 阶段 6 · 兼容收口与发版

### 升级顺序（硬约束）

因为 `isMobileIntent` 是 `switch` + `default: false`，未知 kind 会被**静默丢在边缘**：

**服务端 → 桌面端 → 手机端。**

- 服务端不先升：云端校验层丢弃，手机等到本地 10 秒超时。
- 桌面端不先升：云端 8 秒后以 `code: "timeout"` 回（`INTENT_RESULT_TIMEOUT_MS = 8_000`）。

### 兼容矩阵

| 组合 | 表现 | 要求 |
|---|---|---|
| 新手机 + 旧服务端 | 手机等 10 秒超时 | 提示「请在电脑端/服务端升级」 |
| 新手机 + 旧桌面端 | 云端 8 秒后 `timeout` | 同上，且**不重放**、不产生半成品 |
| 旧手机 + 新桌面端 | 不发送新意图 | 摘要多出的区块被忽略，渲染无变化 |
| 新手机 + 新桌面端 | 正常 | — |

### 收尾清单

- [ ] `RELEASE_NOTES_PENDING.md` 记录本次功能（面向用户说「得到什么」，不写代码路径）
- [ ] 桌面端按钮文案「创建终端cc对话」→「创建 Claude Code 对话」
- [ ] 按 CLAUDE.md 核对 `docs/agents/capability-registry.md`（本次不新增 capability，但消费了 `app.agent.group.list`）
- [ ] 真机验收：`pnpm mobile:release` 走 TestFlight，装到 iPhone 上按验收基线逐条走
- [ ] 正式包检查：桌面端涉及打包边界时跑 `pnpm --filter @synapse/desktop run check:packaged-asar`

---

## 全局验证清单

每个阶段结束都跑：

```bash
pnpm --filter @synapse/shared run test
pnpm --filter @synapse/desktop run test
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/server run test
```

**不要用裸 `npx vitest`**：它会解析到缓存副本并静默少跑文件，得到「0 次失败」的假绿。一律走 workspace 脚本。

---

## 风险

| 风险 | 影响 | 应对 |
|---|---|---|
| 新 kind 在某一端被静默丢弃 | 用户看到无限转圈，无任何可读原因 | 严守升级顺序；手机端把 `timeout` 翻译成可照做的提示；在阶段 0 就加用例钉住「未知 kind 返回 false」这个既有行为 |
| 忘记在 `shared` 加校验分支就改桌面端 | 同上，且极难定位 | 阶段 0 先行并单独验收 |
| 摘要塞入目录后触发收缩逻辑 | 极端情况下挤掉会话 | 目录块也参与生产端裁剪；保留「收缩不丢会话」的既有测试断言 |
| 桌面端 IPC 测试被顺手改动 | 掩盖回归 | 阶段 1 明确要求 `ipc-claude-code-terminal.test.ts` **零改动**通过，否则视为抽取出错 |
| 「终端」段与「对话」段交互不一致被质疑 | 使用中发现问题 | 已在设计文档 §9 列为开放项，按实际反馈再统一 |
