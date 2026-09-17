# 终端快捷指令同步 · 实施计划

日期：2026-09-17
设计依据：`docs/superpowers/specs/2026-09-17-terminal-shortcut-sync-design.md`
原型：`docs/prototypes/2026-09-17-terminal-shortcut-sync.html`

---

## 总览

| 阶段 | 内容 | 主要产物 | 可独立验收 |
|---|---|---|---|
| 0 | 协议与契约（`@synapse/shared`） | 按键白名单 10 → 23；新消息 `mobile.toolbar` 与校验器 | 是 |
| 1 | 服务端路由 | 云端认识新类型并转发 | 是 |
| 2 | 桌面端 · 终端能力 | 内置注册表搬家、新增「回车」、投影函数 | 是 |
| 3 | 桌面端 · 网关下发 | 新消息真的发得出去 | 是 |
| 4 | iOS · 协议与状态 | 能收、能存、能发 | 否 |
| 5 | iOS · 界面 | 快捷栏改造 + 键盘面板 | 是 |
| 6 | 兼容收口与发版 | 升级顺序、真机验收 | 是 |

**阶段 0—1 完成前，阶段 3 无法端到端验收**（新类型会被旧云端以 1003 切断）。**阶段 4—5 完成前，阶段 2—3 没有可见效果。**

建议：0—3 合并为一次「服务端 + 桌面端」交付，5 单独一次 App 交付。

---

## 阶段 0 · 协议与契约（`@synapse/shared`）

### 产物

1. **`MOBILE_KEYS` 从 10 个扩到 23 个**，新增的 13 个**追加在数组末尾**（既有 10 个的顺序一个都不要动）：

```ts
"Enter", "Tab", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
"Backspace", "Ctrl+C", "Ctrl+D",
// 本次新增
"Home", "End", "PageUp", "PageDown", "Delete",
"Ctrl+A", "Ctrl+E", "Ctrl+U", "Ctrl+K", "Ctrl+W", "Ctrl+L", "Ctrl+R", "Ctrl+Z",
```

2. **`mobile-live-constants.cjs` 的同名数组同步**。两份不一致会被测试直接拦下（`shared/src/mobile-live.test.ts:638`）。

3. **新增下行消息类型** `mobile.toolbar`，登记进 `shared/src/live.ts` 的 `LIVE_MESSAGE_TYPES`，并同时加进 `LiveDesktopClientMessage`（电脑上行）、`LiveMobileServerMessage`（手机下行）、`isLiveDesktopClientMessage`、`isLiveMobileServerMessage`。**四处缺一，整条连接会被云端以 1003 切断。**

4. **payload 与校验器**（`shared/src/mobile-live.ts`）：

```ts
export interface MobileToolbarPayload {
  readonly desktopClientInstanceId: string
  readonly revision: number
  readonly buttons: readonly MobileToolbarButton[]
}

export interface MobileToolbarButton {
  readonly id: string
  readonly label: string
  readonly group: "key" | "command" | "custom"
  readonly action: MobileToolbarAction
}

export type MobileToolbarAction =
  | { readonly type: "key"; readonly key: MobileKey }
  | { readonly type: "text"; readonly text: string; readonly pressEnter: boolean }
```

`isMobileToolbarPayload` 照 `isMobileSummaryPayload`（`mobile-live.ts:745-769`）的写法：必填字段 `boundedString` / `nonNegativeInteger`，数组 `boundedArray`，逐项过 `isMobileToolbarButton`。`action.type === "key"` 时 key 必须在 `MOBILE_KEYS` 内。

5. **新增限额**（`MOBILE_FRAME_LIMITS` 与 CJS 镜像都要）：

| 常量 | 值 |
|---|---|
| `maxToolbarButtons` | 64 |
| `maxToolbarButtonIdLength` | 64 |
| `maxToolbarLabelLength` | 32 |
| `maxToolbarTextLength` | 4096 |
| `maxToolbarBytes` | 64 * 1024 |

### 关键约束

- **`MOBILE_KEYS` 只追加，不改序、不删除。** 顺序变动会同时动到 CJS 镜像和下游的快照。
- **摘要一个字都不改。** `shared/src/mobile-live.test.ts:438`「最宽摘要必须落在声明预算内」这条测试必须**不改一行断言**继续通过——它继续绿，就是"没把工具栏塞进摘要"的证据。
- **不要顺手把 `mobile.presence` 补进 `MOBILE_MESSAGE_TYPES`**（`mobile-live.ts:189-196` 少它一项是既有事实，与本任务无关）。
- **新消息的预算 64 KiB 远低于桌面→云 socket 的 256 KiB**，`server/src/live/live-desktop.gateway.spec.ts:304-320` 那条 socket 尺寸断言**不需要改**，但实现后要跑一遍确认它仍然绿。

### 涉及文件

- `shared/src/mobile-live.ts`
- `shared/src/mobile-live-constants.cjs`
- `shared/src/live.ts`
- `shared/src/mobile-live.test.ts`
- `shared/src/live.test.ts`

### 验证

```bash
pnpm --filter @synapse/shared run test
pnpm --filter @synapse/shared run build   # 桌面与服务端消费的是产物
```

### 完成标准

- `MOBILE_KEYS` 23 项，ESM 与 CJS 两份逐字节一致（既有测试覆盖）。
- `mobile.toolbar` 的合法/非法载荷各有断言：缺 `desktopClientInstanceId`、`group` 非法值、`buttons` 超 64、`label` 超 32、`text` 超 4096、`action.type === "key"` 但 key 不在白名单、未知 `action.type`。
- **一条"不给老客户端增加一个字节"的黄金测试**：不含 `mobile.toolbar` 的既有消息，序列化结果与改动前逐字节一致（照 `mobile-live.test.ts:597` 的写法）。
- `shared/src/mobile-live.test.ts:438` 与 `:638` 均**未改动**且通过。

---

## 阶段 1 · 服务端：认识并转发新类型

### 产物

1. `server/src/live/live-desktop.gateway.ts`：`LiveMobileRelayHandler` 接口加 `handleToolbar`；`handleMobileRelayMessage`（`:569-604`）加一个 `if` 分支。该文件末尾有 `"Unhandled mobile relay message"` 兜底 warn（`:592-595`），新类型**必须**在它之前被接住。
2. `server/src/mobile-live/mobile-live-relay.service.ts`：加 `handleToolbar`，用 `fanout.sendToMobile` 按该账号的所有在线手机扇出（照 `handleSummary` 的写法，但**不写缓存**）；在 `onModuleInit`（`:72-80`）注册。

### 关键约束

- **不做云端缓存、不加 HTTP 兜底。** 快捷指令只在电脑在线时有意义，摘要有缓存是因为手机冷启动要先看到会话列表，这条不需要。
- **不改 `mobile-live.controller.ts`。**
- 云端**只路由不解释**：不要在这里解析 `buttons` 的内容，也不要按类型分支处理别的字段。

### 涉及文件

- `server/src/live/live-desktop.gateway.ts`
- `server/src/mobile-live/mobile-live-relay.service.ts`

### 验证

```bash
pnpm --filter @synapse/server run test
node server/test/mobile-relay-smoke.mjs    # 端到端冒烟，按需
```

### 完成标准

- 新类型能被 `handleMobileRelayMessage` 接住并扇出到该账号的在线手机；不在线的电脑不参与。
- 未识别类型仍然落到兜底 warn，不被误吞。
- 既有 gateway / relay 测试全绿。

---

## 阶段 2 · 桌面端 · 终端能力

### 产物

1. **把内置注册表搬到 `shared/`。** 新建 `desktop/app-capabilities/terminal/shared/toolbar-actions.ts`，把 `TERMINAL_TOOLBAR_ACTIONS` 与 `TerminalToolbarAction` 等类型从 `renderer/terminal-toolbar-actions.ts` 移过去。renderer 侧保留 `getTerminalToolbarActions` / `resolveTerminalToolbarPayload` / `isTerminalToolbarActionEnabled`，改为从 shared 导入注册表。

   理由：内置列表要在**主进程**里被投影成手机用的数据，而 `renderer/` 是渲染进程的代码。

2. **新增内置「回车」，放在数组第 0 位**：

```ts
{
  id: "enter",
  label: "回车",
  ariaLabel: "发送回车",
  platforms: ALL_PLATFORMS,
  availability: "running-session",
  kind: "terminal-sequence",
  sequence: "\r",
}
```

3. **`KEY_BYTES` 扩容到 23 项**（`desktop/app-capabilities/terminal/main/service.ts:236-247`）：

```
Home \x1b[H   End \x1b[F   PageUp \x1b[5~   PageDown \x1b[6~   Delete \x1b[3~
Ctrl+A \x01   Ctrl+E \x05   Ctrl+U \x15   Ctrl+K \x0b   Ctrl+W \x17
Ctrl+L \x0c   Ctrl+R \x12   Ctrl+Z \x1a
```

4. **投影函数**（新增 `desktop/app-capabilities/terminal/main/mobile-toolbar.ts`）：

| 内置的 kind | 投影结果 |
|---|---|
| `terminal-sequence`，其 sequence 能在 `KEY_BYTES` 里反查到某个 `MOBILE_KEYS` 键 | `{type:"key", key}`，`group: "key"` |
| `shell-command` | `{type:"text", text: command, pressEnter: true}`，`group: "command"` |
| `xterm-local` | **不投影**（手机上没有对应物） |
| 自定义 | `{type:"text", text: content, pressEnter}`，`group: "custom"` |

反查靠 `KEY_BYTES` 而不是写死映射：`\r` → `Enter`、`\x03` → `Ctrl+C`，这样内置换了 sequence 时投影自动跟着变。

5. **终端 service 暴露一个方法** `listMobileToolbarButtons()`，返回投影后的有序列表（内置在前、自定义在后，各自保持既有顺序）。网关通过 `ServiceRegistry` 拿到的 service 调用它，**不要让网关直接 import 终端能力的内部模块**。

### 关键约束

- **renderer 的既有行为一行都不能变。** 桌面上那 4 条内置按钮的渲染、启用条件、点击效果保持原样，只是多了一条「回车」排在最前。
- **`Clear` 必须留在桌面端注册表里**（电脑上它是有用的），只是**不参与投影**。不要在注册表里删它。
- **投影不做任何文本加工**：不 trim、不加引号、不改大小写。手机上要执行的必须与电脑上**逐字符相同**。
- **不新增 IPC、不新增 MCP capability。** 这个方法是给主进程内部网关用的，不进 capability catalog。按 CLAUDE.md 的要求核对 `docs/agents/capability-registry.md`，本次**不应**产生表格变化。

### 涉及文件

- `desktop/app-capabilities/terminal/shared/toolbar-actions.ts`（新建）
- `desktop/app-capabilities/terminal/renderer/terminal-toolbar-actions.ts`（改为从 shared 导入）
- `desktop/app-capabilities/terminal/main/mobile-toolbar.ts`（新建）
- `desktop/app-capabilities/terminal/main/service.ts`
- `desktop/app-capabilities/terminal/renderer/index.tsx`（仅在导入路径变化时）
- `desktop/app-capabilities/terminal/renderer/__tests__/terminal-module.test.tsx`（如受搬家影响）

### 验证

```bash
pnpm --filter @synapse/desktop run test
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run check:hard-constraints
```

### 完成标准

- 桌面端快捷栏渲染成：`回车` `Ctrl+C` `Clear` │ `/exit` `/clear` │ 自定义…，分隔线位置不变。
- **一条等价性测试**：投影出的每个按钮，与它在桌面端点击时写入 PTY 的内容**逐字节一致**——`key` 类比 `KEY_BYTES`，`text` 类比文本加回车语义。这条测试是"两端不分叉"的唯一守卫，必须有。
- 投影结果里**不含** `Clear`；`id: "enter"` 排第一。
- 终端模块既有测试全绿（尤其 `terminal-module.test.tsx:1516`、`:1541-1542`、`:1675` 固定的那些约定）。

---

## 阶段 3 · 桌面端 · 网关下发

### 产物

1. `desktop/electron/services/mobile-gateway/transport.ts`：`MobileGatewayTransport` 加 `sendToolbar`。
2. `desktop/electron/services/live-connection-service.ts`：加 `sendMobileToolbar`（照 `sendMobileXxx` 既有形状）。
3. `desktop/electron/bootstrap/app-ready.ts`：接线 `sendToolbar` → `liveConnectionService.sendMobileToolbar`（照 `:134-142`）。
4. `desktop/electron/services/mobile-gateway-service.ts`：
   - 生产 payload：调 `terminal.listMobileToolbarButtons()`，加 `desktopClientInstanceId` 与自增 `revision`；
   - **按序列化指纹去重**，内容没变不发（照 `flushSummary` 的 `lastSummaryContent` 做法，另起一个 `lastToolbarContent`）；
   - **按 `maxToolbarBytes` 截断：按顺序追加，放不下的那一条起停止，不截断单条。**
5. `desktop/electron/services/mobile-gateway/intent-executor.ts`：`sync`（`:158-167`）与 `attach`（`:170-196`）两处各加一次 `pushToolbar()`。

### 下发时机（三条，全部搭现有触发点）

| 时机 | 说明 |
|---|---|
| `sync` | 手机连上后主动发，**确定性送达** |
| `attach` | 手机打开某个终端时刷新 |
| `flushSummary` 的同一次 tick | 顺带按指纹补发 |

### 关键约束

- **绝不新加 `terminal.events` 监听器。** `mobile-gateway-service.ts:210-217` 明写了监听器数量已经顶到 Node 默认上限 10（"this list should not grow"）。三条时机全部复用已有回调。
- **不做"每次会话事件都重发"**：必须有指纹去重，否则空闲电脑会变成持续发包。
- **发送失败只记结构化 warn，不抛**：手机上少一条栏不该影响终端本身。
- 已知不完美，写进代码注释：用户改完命令后，如果手机**既没重连、也没打开终端、也没有任何会话活动**，列表会陈旧到三个时机之一发生。这是为不突破监听器预算付的代价。

### 涉及文件

- `desktop/electron/services/mobile-gateway/transport.ts`
- `desktop/electron/services/mobile-gateway-service.ts`
- `desktop/electron/services/mobile-gateway/intent-executor.ts`
- `desktop/electron/services/live-connection-service.ts`
- `desktop/electron/bootstrap/app-ready.ts`
- `desktop/electron/services/__tests__/mobile-gateway-service.test.ts`
- `desktop/electron/services/__tests__/live-connection-service.test.ts`

### 验证

```bash
pnpm --filter @synapse/desktop run test
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run check:hard-constraints
```

### 完成标准

- `sync` 后必发一次，无论内容是否变化（`resendSummary` 同款语义）。
- 内容不变时，后续会话活动**不产生**额外发包（用指纹断言，别只看"发了"）。
- 在电脑上新建/改名/删除一条自定义命令，手机重连后看到的就是新列表。
- 网关测试里四条既有 send 通道的打桩范式照旧，新增第五条的断言。

---

## 阶段 4 · iOS · 协议与状态

### 产物

1. `Core/Protocol/LiveProtocol.swift`：
   - `MobileKey` 枚举加 13 个 case，**rawValue 必须与 `MOBILE_KEYS` 字符串逐字相同**；
   - `LiveMessageType` 加 `mobileToolbar = "mobile.toolbar"`；
   - `MobileToolbarPayload` / `MobileToolbarButton` / `MobileToolbarAction`，全部 `Decodable`。
2. `Core/Realtime/RealtimeClient.swift`：加 `var onToolbar` 回调、`dispatch` 加 `case`、连接健康判定的类型列表加它（`:293-296`）。
3. `App/SynapseAppModel.swift`：
   - 存 `toolbarButtons` 与它所属的 `desktopClientInstanceId`，**按电脑过滤**（手机可能同时连着多台，照 summary 的处理）；
   - **兜底**：从未收到过 `mobile.toolbar` 时用内置的 `回车` `Ctrl+C` `/exit` `/clear`；收到消息就整体替换，**空数组也算收到**；
   - 发送方法：`key` → `keys` intent；`text + pressEnter` → `command` intent；`text + 不回车` → `keys` intent 的 `{type:"text"}`。
4. **`MobileKey.label` 的处置**：快捷栏不再渲染按键，`label` 很可能变成死代码。先 grep 引用再决定删不删；**不要留两套文案**（面板的显示文案在新面板里定义）。

### 关键约束

- **不新增任何 intent。** 五种按钮全部映射到既有的 `keys` / `command`，这是本设计的核心前提，新增 intent 即偏离。
- **`action.text` 原样发送**，不做 trim、不加引号、不做任何转义。
- **`pressEnter: false` 走 `keys` 的 `text` 动作而不是 `command`**——`command` 会在电脑端自动补回车，语义就错了。
- 未知消息类型仍然静默忽略（`RealtimeClient` 现有 `default: break`），不要为新类型加报警逻辑。

### 涉及文件

- `SynapseMobile/SynapseMobile/Core/Protocol/LiveProtocol.swift`
- `SynapseMobile/SynapseMobile/Core/Realtime/RealtimeClient.swift`
- `SynapseMobile/SynapseMobile/App/SynapseAppModel.swift`
- `SynapseMobile/SynapseMobileTests/`（新增一个协议与兜底逻辑的单测文件）

### 验证

```bash
xcodebuild -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
```

### 完成标准

- 解码一条完整 `mobile.toolbar` 载荷，`buttons` 顺序与内容正确。
- 收到空数组 → 快捷栏为空（**不回退兜底**）；从未收到 → 显示兜底四键。两条都要有断言。
- 三种 action 各自发出的 intent 形状正确（用单测钉住，不要只靠手点）。
- `pressEnter: false` 那条发出的是 `keys` 而不是 `command`。

---

## 阶段 5 · iOS · 界面

### 产物

1. **快捷栏改造**（`Features/Terminal/TerminalScreen.swift:395-433`）：
   - 最左侧加键盘图标按钮（SF Symbol `keyboard`）；
   - 其余按钮改为遍历 `toolbarButtons`，按 `group` 分段画分隔线；
   - 沿用现有胶囊样式（等宽、圆角 10、`minWidth 48 / minHeight 36`）；
   - 会话非 `running` 时整条置灰；
   - 点「回车」时保留现有的**提交待投递附件**行为（`commitDeliveredAttachments`）。
2. **新增键盘面板** `Features/Terminal/TerminalKeyboardPanel.swift`：底部 sheet，分段选择器 + 四类键位布局，布局照 `docs/prototypes/2026-09-17-terminal-shortcut-sync.html`。键帽样式与快捷栏共用。
3. **无障碍标识**：快捷栏按钮 `toolbar-<id>`，面板按键 `panelkey-<key>`。
4. **更新既有 UI 测试**：
   - `SynapseMobileUITests/TerminalFlowUITests.swift:72-75` 现在断言快捷栏里有 `esc`、`^C` 且没有 `ctrl`——这两条都要重写（`esc` 已经不在栏上）；
   - `SynapseMobileUITests/TerminalFileRelayUITests.swift:122` 用的 `key-Enter` 已不存在，改用快捷栏的 `toolbar-enter`。

### 关键约束

- **面板点键后不收起**，且打开面板前先收起 iOS 键盘。
- **四类键区固定同高**，切分类时面板不跳动。
- **面板里只有 §3.4 的 23 个键**，一个都不多加。
- **不提供任何增删改入口**：快捷栏没有铅笔按钮，面板里也没有。
- **文案用「回车」，不用「Enter」**；控制键用 `^A` 这种紧凑写法，不用 `Ctrl+A`。
- 沿用现有颜色与组件，不引入自定义颜色、渐变或装饰效果。

### 涉及文件

- `SynapseMobile/SynapseMobile/Features/Terminal/TerminalScreen.swift`
- `SynapseMobile/SynapseMobile/Features/Terminal/TerminalKeyboardPanel.swift`（新建）
- `SynapseMobile/SynapseMobileUITests/TerminalFlowUITests.swift`
- `SynapseMobile/SynapseMobileUITests/TerminalFileRelayUITests.swift`

### 验证

```bash
xcodebuild -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build

# UI 测试需要一个「桌面端」作为终端来源；不打断正在使用的 Synapse 时用模拟桌面端
# （server/test/mock-desktop.mjs，用法见 SynapseMobile/README.md）
```

### 完成标准

- 快捷栏顺序为 `[⌨]` │ `回车` `Ctrl+C` │ `/exit` `/clear` │ 自定义若干，分隔线位置与桌面端一致。
- 面板四类可切换，23 个键逐个点下去，电脑终端里的效果都正确（**逐个走一遍，这一条只能手动验**）。
- 会话停止时快捷栏与面板同时置灰。
- 切到旧版电脑时快捷栏只剩兜底四键，不空。

---

## 阶段 6 · 兼容收口与发版

### 升级顺序（硬约束）

**服务端 → 桌面端 → 手机端。**

两个独立原因都指向它：旧云端遇到不认识的 `mobile.toolbar` 会以 **1003 切断桌面端连接**；旧云端遇到新按键（`Home` 等）会以 **1003 切断手机连接**。两次的用户可见表现都是"设备莫名离线"，日志里只有一句校验失败。

**这两条要写进发版说明。**

### 兼容矩阵

| 云端 | 桌面端 | 手机端 | 结果 |
|---|---|---|---|
| 旧 | 旧 | 旧 | 现状，不受影响 |
| 新 | 旧 | 新 | 手机显示兜底四键，栏不空 ✅ |
| 新 | 新 | 旧 | 新消息无人消费，静默忽略 ✅ |
| **旧** | **新** | 新 | **电脑与手机轮流断连** ❌ 发版流程必须排除这个组合 |

### 收尾清单

- [ ] 更新 `RELEASE_NOTES_PENDING.md`：用户可感知的变化是"手机终端底部现在显示电脑上的那套快捷指令，并能打开一个键盘面板发送电脑键盘上的按键"。
- [ ] 核对 `docs/agents/capability-registry.md`（本次**不新增** capability，按 CLAUDE.md 要求核对一遍，确认表格无变化）。
- [ ] 把 `产品设计文档.md` 落进 `docs/superpowers/specs/`，本计划落进 `docs/superpowers/plans/`，只把指向桌面的相对路径改成仓库内路径。
- [ ] 每个阶段独立提交，提交信息用中文说清做了什么与关键行为变化。**只提交本阶段文件，不要 `git add -A`**——仓库可能有别的会话在同时修改。
- [ ] **最终验收必须装到李杨的 iPhone 上真机走一遍**，不能拿"测试通过"交差。用 `.claude/skills/ios-release/` 的流程；快速装机用 `pnpm mobile:install`。

---

## 全局验证清单

```bash
pnpm --filter @synapse/shared run test
pnpm --filter @synapse/shared run build
pnpm --filter @synapse/desktop run test
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/server run test

xcodebuild -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
```

**不要用裸 `npx vitest`**——它会解析到缓存副本、静默少跑文件，会得到假的"0 次失败"。

---

## 风险

| 风险 | 触发条件 | 处置 |
|---|---|---|
| 云端未先升级 | 发版顺序错 | 断连表现为"设备离线"，排查成本高。发版说明写死顺序，阶段 1 必须先于 3 上线 |
| 监听器超限 | 顺手给网关加了 `terminal.events.on` | Node 会打印 `MaxListenersExceededWarning`，且可能丢事件。三条下发时机**必须**全搭现有回调 |
| 投影与桌面分叉 | 反查改用写死映射，或文本被加工 | 阶段 2 的逐字节等价性测试就是为它写的，不能被绕过 |
| 摘要被顺手塞进工具栏 | 实现时觉得"反正都是下发数据" | `mobile-live.test.ts:438` 必须**不改断言**继续绿 |
| 面板按键值写错 | 13 个新键全靠手抄 | `DELETE`/`PageUp` 这类序列容易抄错。用原型右侧的「点按记录」逐个核，再写单测钉住 |
| `Ctrl+Z` 挂起进程 | 用户误触 | 已在设计文档开放项标记；真机验收时确认一下实际影响 |
| 附件 chip 行为丢失 | 改造快捷栏时只搬了按钮、忘了 `commitDeliveredAttachments` | 设计文档验收基线第 12 条专门钉这条 |
