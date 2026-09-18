# 手机端终端工具栏改造 · 实施计划

> 设计（权威）：`docs/superpowers/specs/2026-09-18-mobile-terminal-toolbar-design.md`
> 原型（可点）：`docs/prototypes/2026-09-18-mobile-terminal-toolbar.html`
> **冲突时以设计文档为准。**

---

## 总览

| 阶段 | 做什么 | 涉及包 | 能否独立验证 |
|---|---|---|---|
| 0 | 协议：`mobile.quickPhrases` 的类型、校验、预算 | `shared` | 是（单测） |
| 1 | 服务端转发这一条消息 | `server` | 是（spec） |
| 2 | 桌面端把这包东西发出去 | `desktop` | 是（单测） |
| 3 | 手机端收下来并持有 | `SynapseMobile` | 是（单测） |
| 4 | 工具栏结构：左固定 · 中横滑 · 右固定，⌘ 换图标 | `SynapseMobile` | 是（UI 测试 + 手点） |
| 5 | 面板：分段器 + 两段内容 + 空态 | `SynapseMobile` | 是 |
| 6 | 预览：行右眼睛 + 只读浮层 | `SynapseMobile` | 是 |
| 7 | 真机验收与装机 | — | 是 |

三件事先说清楚：

1. **假数据不许进提交。** 阶段 4/5/6 在阶段 0–3 之前做也完全可以（先看到样子），但那时候列表只能用临时写死的数组；本阶段提交前必须换成真数据，否则提交里会留一份看起来像真的的假列表。
2. **阶段 0–2 是一个整体**：只做其中一段，谁也验不出东西来。三段的提交可以挨着，但别只提交一段就停手。
3. **每阶段独立验证、独立提交**，不要攒到最后一次。

---

## 阶段 0 · 协议

### 产物

`shared/src/mobile-live.ts` 新增：

- `MobileQuickPhrase`：`{ id: string; content: string }`。
- `MobileQuickPhrasesPayload`：`{ desktopClientInstanceId: string; revision: number; phrases: readonly MobileQuickPhrase[] }`。`revision` 与工具栏同义（每发一次加一，手机不按它去重，只用于排查）。
- `isMobileQuickPhrasesPayload` 校验，加进与 `isMobileToolbarPayload` 同一处。
- `MOBILE_FRAME_LIMITS` 新增三项：`maxQuickPhrases: 64`、`maxQuickPhraseLength: 4096`、`maxQuickPhrasesBytes: 64 * 1024`。

`shared/src/live.ts` 新增：

- `LIVE_MESSAGE_TYPES.mobileQuickPhrases = "mobile.quickPhrases"`。
- `LiveMobileServerMessage` 联合里的一条。
- 两处 `isLiveEnvelope` 分支（现在各有 `mobile.toolbar` 一条，跟着加）。

### 关键约束

- 校验只用文件里已有的 `boundedString` / `boundedArray` 那套，不引入新写法。
- 三条 limits 的注释要写明"为什么是这个数"：`maxQuickPhraseLength` 与工具栏的 `maxToolbarTextLength` 同值（一条短语和一条自定义命令是同一类东西）；`maxQuickPhrasesBytes` 与 `maxToolbarBytes` 同值（同一条 socket、同一个 256 KiB 的天花板之下）。
- **字段一旦定下来，阶段 3 只是镜像。** 如果阶段 3 才发现要改字段，回到这里改，连测试一起改，不要只改手机端那一份。

### 涉及文件

- `shared/src/mobile-live.ts`
- `shared/src/live.ts`
- `shared/src/mobile-live.test.ts`（合法包通过；单条超长被拒；数组超限被拒；缺字段被拒；`revision` 非数字被拒）

### 验证

```bash
pnpm --filter @synapse/shared run test
```

---

## 阶段 1 · 服务端转发

### 产物

- `server/src/mobile-live/mobile-live-relay.service.ts`：`handleQuickPhrases(userId, payload)`，fanout 给该账号所有在线手机。
- `server/src/live/live-desktop.gateway.ts`：relay 接口上声明 `handleQuickPhrases`，并在按 type 逐条 dispatch 的那串 `if` 里加一条分支。

### 关键约束

- **形状照抄 `handleToolbar`**：fanout、**不缓存**、靠 payload 自己带的 `desktopClientInstanceId` 让每台手机只留属于当前那台电脑的列表。理由同工具栏：一份属于一台已经不在的电脑的短语列表，看起来像那台电脑还在。
- **不接 `pendingIntents`、不回执、不做重试。** 这是一条推送，不是一次请求。
- dispatch 是逐条 `if` 而不是查表：漏一条分支的表现是消息被静默丢掉，而桌面端那边看起来是发成功了的。**这是本阶段唯一容易漏的地方。**

### 涉及文件

- `server/src/mobile-live/mobile-live-relay.service.ts`
- `server/src/live/live-desktop.gateway.ts`
- `server/src/mobile-live/mobile-live-relay.service.spec.ts`（fanout 给该账号的在线手机、不跨账号、不缓存）
- `server/src/mobile-live/mobile-live.gateway.spec.ts`（消息类型的分发）

### 验证

```bash
pnpm --filter @synapse/server run test
```

---

## 阶段 2 · 桌面端发送

### 产物

- `desktop/electron/services/mobile-gateway/transport.ts`：`MobileQuickPhrasesDraft = Omit<MobileQuickPhrasesPayload, "desktopClientInstanceId">`；transport 类型上加 `sendQuickPhrases`。
- `desktop/electron/services/live-connection-service.ts`：`sendMobileQuickPhrases(draft)`，与 `sendMobileToolbar` 逐行同构（没有 `clientInstanceId` 就整条不发）。
- `desktop/electron/services/mobile-gateway-service.ts`：
  - deps 加一个只读的 `listQuickPhrases: () => Promise<readonly MobileQuickPhrase[]>`；
  - `flushQuickPhrases()`：指纹（`JSON.stringify` 比较）去重 → 字节预算丢尾 → 超长整条丢 → 发；
  - `resendQuickPhrases()`：清指纹后再 flush，给"刚连上、还什么都没发过"的调用方用。
- `desktop/electron/services/mobile-gateway/intent-executor.ts`：`sync` 与 `attach` 两个分支里，与 `this.deps.sendToolbar()` 一起发。
- `desktop/electron/bootstrap/app-ready.ts`：装配 transport 的同一处接上 `core.quick-input`：把 `() => quickInput.list()` 给 gateway，并订阅它的 `changed` 事件 → `resendQuickPhrases()`。

### 关键约束

- **指纹去重不能少**：空闲的电脑必须零流量，这是 `flushToolbar` 那条注释的全部意思，短语照办。
- **订阅 `changed` 只能接一次。** `app-capabilities/quick-input/main/ipc.ts` 里有一个 `quickInputEventWiredServices = new WeakSet<QuickInputService>()` 就是为这件事写的（那个 IPC 模块每次调用都会 resolve 一次服务）。照着写一个同形的守卫，别让一个服务被接上多次监听。
- **超长整条丢，不截断。** 一条被截短的短语，插进输入框以后和用户在电脑上写的那句不是同一句了，而他按下发送时以为它是。丢了要记一条 `warn`，不静默。
- **桌面端界面一个字不改。** 这一阶段只多一条出站的网络消息。
- `core.quick-input` 是 `criticality: "degraded"` 的既有服务，resolve 它不需要新权限。

### 涉及文件

- `desktop/electron/services/mobile-gateway/transport.ts`
- `desktop/electron/services/mobile-gateway/intent-executor.ts`
- `desktop/electron/services/mobile-gateway-service.ts`
- `desktop/electron/services/live-connection-service.ts`
- `desktop/electron/bootstrap/app-ready.ts`
- `desktop/electron/services/__tests__/mobile-gateway-service.test.ts`（指纹去重、字节丢尾、超长整条丢、`sync`/`attach` 各发一次、`changed` 后重推）
- `desktop/electron/services/__tests__/live-connection-service.test.ts`

### 验证

```bash
pnpm --filter @synapse/desktop run test
pnpm --filter @synapse/desktop run typecheck
```

---

## 阶段 3 · 手机端接收

### 产物

- `SynapseMobile/SynapseMobile/Core/Protocol/LiveProtocol.swift`：`LiveMessageType.mobileQuickPhrases` + `MobileQuickPhrasesPayload` / `MobileQuickPhrase`（镜像 `shared`，字段名逐个对齐）。
- `SynapseMobile/SynapseMobile/Core/Realtime/RealtimeClient.swift`：`onQuickPhrases` 回调 + 解码分支（与 `onToolbar` 同一处、同一个写法）。
- 新文件 `SynapseMobile/SynapseMobile/Features/Terminal/TerminalQuickPhrasesState.swift`：与 `TerminalToolbarState` 同构的持有者。
- `SynapseMobile/SynapseMobile/App/SynapseAppModel.swift`：`quickPhrases` 持有、`activeQuickPhrases` 读取口、`reset()` 挂到登出那条路径（与 `toolbar.reset()` 同一处）。

### 关键约束

- **`nil` 和 `[]` 是两个不同的答案，这是本阶段最要紧的一条。**
  - 收到过这台电脑的包、里面是空数组 → 返回 `[]`：用户确实还没配 → 手机上显示空态。
  - 从没收到过这台电脑的包 → 返回 `nil`：这台电脑还不知道有这回事 → 手机上整条分段器不出现。
  - 判据照抄 `TerminalToolbarState.buttons(forSelected:)`：只有 `ownerDesktopClientInstanceId == 选中的电脑` 才算"收到过"。
- **不做兜底列表。** 短语没有"内置四条"这种东西——兜底的是命令，不是句子。
- 退出登录必须清空：那些是另一个账号的电脑上的句子。

### 涉及文件

- `SynapseMobile/SynapseMobile/Core/Protocol/LiveProtocol.swift`
- `SynapseMobile/SynapseMobile/Core/Realtime/RealtimeClient.swift`
- `SynapseMobile/SynapseMobile/App/SynapseAppModel.swift`
- `SynapseMobile/SynapseMobile/Features/Terminal/TerminalQuickPhrasesState.swift`（新）
- `SynapseMobile/SynapseMobileTests/TerminalQuickPhrasesTests.swift`（新：收到过空列表 → `[]`；从没收到过 → `nil`；另一台电脑的包不顶替；reset 后回到 `nil`）

### 验证

```bash
xcodebuild test -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:SynapseMobileTests -parallel-testing-enabled NO
```

另需在 `server/test/mock-desktop.mjs` 里补夹具（阶段 5/6 的 UI 测试要用）：

- `quickPhrases` 数组 + `sendQuickPhrases()`，与 `sendToolbar()` 放在同样的三个调用点（连上、`sync`、`attach`）。
- 控制路由 `/desktop/quick-phrases`（照 `/desktop/toolbar` 的样子），UI 测试可以随时改这一包。
- **`--no-toolbar` 也一并压掉这条**：那个开关的意思是"一台 `mobile.toolbar` 出现之前的电脑"，那种电脑当然也没见过这条新消息。这一个开关就覆盖了验收第 20 条。

---

## 阶段 4 · 工具栏结构

### 产物

`TerminalScreen.swift` 的 `accessoryBar` 重构成三块：`[⌘] ｜` + 横滑的指令区 + `｜ [⇧]`。⌘ 顶掉原来的 ⌨。

### 关键约束

- **标识符一个都不能改**：`toolbar-scroll` 留在中间那个 `ScrollView` 上（现有 UI 测试按 `app.scrollViews["toolbar-scroll"]` 找它），`toolbar-keyboard` 留在 ⌘ 上（现有测试按名字点它开面板）。新的 ⇧ 用 `toolbar-all`。
- **两侧不进 `ScrollView`。** 横滑区给一个最小宽度（约一条最宽胶囊 + 24），窗口更窄时优先压缩它，两侧永不压缩、永不隐藏。
- **键盘面板的开关行为一个字不改**：点的还是 `toggleKeyboardPanel()`，无障碍标签还是「打开键盘」，只是脸换了。
- **和键盘槽位那轮的 rebase。** 那份文档（`2026-09-18-terminal-keyboard-slot-design.md`）改的是同一个函数体，它写的是「工具栏最左边那颗 ⌨」。谁后落地谁手工合，别指望自动合得上。
- 现有一条 UI 断言会红：`TerminalFlowUITests` 里数 `identifier BEGINSWITH 'toolbar-'` 的按钮数 == 7。多了一颗真的多了一颗，**改数字**，不要改标识符去绕开它。

### 涉及文件

- `SynapseMobile/SynapseMobile/Features/Terminal/TerminalScreen.swift`
- `SynapseMobile/SynapseMobileUITests/TerminalFlowUITests.swift`（计数断言 7 → 8）

### 验证

模拟器手点：指令造 14 条，滑到底，两侧两颗键不动；⌘ 照旧开关键盘面板。

---

## 阶段 5 · 面板两段

### 产物

新文件 `SynapseMobile/SynapseMobile/Features/Terminal/TerminalShortcutPanel.swift`：系统拖条 + 分段器 + 命令段 + 短语段 + 空态。`TerminalScreen` 里用 `.sheet` 呈现（`.presentationDetents([.medium, .large])`、`.presentationDragIndicator(.visible)`）。

### 关键约束

- **分段器只在"收到过"时出现**（阶段 3 的 `nil` / `[]` 判据）。没收到过就是今天的单段面板，不做空态。
- **命令段的分组横线靠"每个分组一个 grid"实现**：`LazyVGrid(columns: [GridItem(.adaptive(minimum: 88))])`，分组切换时另起一个 grid，两个 grid 之间放一根 `Divider()`。这样横线天然通栏、天然换行，不用去凑 `gridCellColumns`。
- **短语段用 `List` + `.listStyle(.insetGrouped)`**，行 `lineLimit(1)` + 尾部省略；行高、圆角、分隔线内缩全部吃系统默认，不手写数值（设计文档 §6.6）。面板底色跟着 `.insetGrouped` 自己的灰底走。
- **默认段用 `@AppStorage` 记住**，跨启动。**不因为那段是空的就跳回命令段**（设计文档 §3.8）。
- **切段不改变面板高度**：detents 挂在 sheet 上，与内容无关，天然满足——不要为了"内容自适应"再去算高度。
- 命令段点胶囊：`runToolbarButton` → 发送 → 面板收起（既有行为，不改）。短语段点行：写进 `draft` → 面板收起 → **不发送、不聚焦输入框**（不聚焦就不会弹系统键盘）。

### 涉及文件

- `SynapseMobile/SynapseMobile/Features/Terminal/TerminalShortcutPanel.swift`（新）
- `SynapseMobile/SynapseMobile/Features/Terminal/TerminalScreen.swift`
- `SynapseMobile/SynapseMobileUITests/TerminalFlowUITests.swift`（面板：开 ⇧ → 两段在 → 点一条短语 → 输入框里有字且 mock 没收到任何 intent）

### 验证

模拟器手点两条路径；再跑一次 UI 测试。

---

## 阶段 6 · 预览

### 产物

短语行右侧一颗 `eye`；点开一个只读浮层显示全文，文字可选可复制，没有「填入」按钮。

### 关键约束

- **整行不是 `Button`。** 行用 `.contentShape(Rectangle())` + `.onTapGesture { 填入 }`，预览键是独立的 `Button`——`Button` 会先吃掉自己那一格的点击，不会再传给行的 `onTapGesture`。行本身若是 `Button`，里面再嵌一个 `Button` 在 SwiftUI 里是没定义的。
- **预览用第二个 `.sheet`**（`[.medium, .large]`），拿到系统的拖条、下拉关闭、深色适配。**不要手搓一张左右留白的浮动卡片**——那是原型里的近似画法，不是系统语义（与 §6.6 同一条理由）。
- 浮层里只有文字：`.textSelection(.enabled)`，可滚动，**没有按钮**。
- 关掉预览回到面板，**面板保持打开、原段原位**（预览是浮在面板之上的第二层，不是替换）。

### 涉及文件

- `SynapseMobile/SynapseMobile/Features/Terminal/TerminalShortcutPanel.swift`
- `SynapseMobile/SynapseMobileUITests/TerminalFlowUITests.swift`（点眼睛 → 全文出现 → 关掉 → 面板还在、还在原段）

### 验证

模拟器：点眼睛看全文、长按选中一段文字、下拉关掉；点行仍然只填入。

---

## 阶段 7 · 真机验收与装机

### 产物

- 设计文档 §8 的 26 条逐条验过。
- 真机上必须亲手验的（模拟器验不了或验不准）：
  - 第 13 条：点短语**不弹系统键盘**（模拟器软键盘行为与真机不同）。
  - 第 16 条：预览里长按勾选文字、复制到剪贴板。
  - 第 26 条：深色模式。
- `RELEASE_NOTES_PENDING.md` 更新：这是用户可感知的变化（工具栏换了样、多了一个指令面板、手机上能用电脑配的快捷输入），按「得到什么、什么变了」写。
- 装机：`pnpm mobile:install`（手机连数据线并解锁）。装的是开发包，收不到推送是已知且接受的代价，不要为此动推送网关。

### 验证

装机后按设计文档 §8 走一遍，把装机输出里的版本号与构建号记进提交信息。

---

## 完成标准

- 设计文档 §8 的 26 条逐条成立（不是"测试全绿"，是逐条走过）。
- 新增/修改的测试都能在**坏的时候变红**（至少对着空列表/超长/换电脑这三条各反证一次）。
- `pnpm --filter @synapse/shared run test`、`pnpm --filter @synapse/server run test`、`pnpm --filter @synapse/desktop run test`、desktop `typecheck` 全绿。
- `RELEASE_NOTES_PENDING.md` 已更新。
- 装到李杨的 iPhone 上（`pnpm mobile:install`），版本号与构建号在提交信息里。

## 提交切分

| 提交 | 内容 |
|---|---|
| 1 | 阶段 0：`shared` 的协议 |
| 2 | 阶段 1：服务端转发 |
| 3 | 阶段 2：桌面端发送 |
| 4 | 阶段 3：手机端接收与持有（含 mock 夹具） |
| 5 | 阶段 4：工具栏结构 |
| 6 | 阶段 5：面板两段 |
| 7 | 阶段 6：预览 |
| 8 | 阶段 7：发布说明（+ 装机记录，如有代码改动一并） |

提交信息用中文说清做了什么与关键行为变化。只提交本阶段的文件，不要 `git add -A`。
