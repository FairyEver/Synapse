# 终端键盘面板改造 · 实施计划

> 权威设计见同目录 `产品设计文档.md`。**决策、协议、非目标、验收基线都以它为准**，本文件只回答"分几步做、每步改哪、怎么验"。
> 界面原型：`docs/prototypes/2026-09-17-terminal-full-keyboard.html`（仓库内路径）。

---

## 总览

| 阶段 | 内容 | 能不能单独上线 |
|---|---|---|
| 0 | 协议与契约：`MOBILE_KEYS` 23 → 38（五处同步） | 不能，必须先发 |
| 1 | 服务端：**代码 0 行**，重新部署 | 必须先发 |
| 2 | 桌面端：`KEY_BYTES` 补 15 项 | 必须第 2 个发 |
| 3 | iOS：`MobileKey` 枚举 + 发送路径 | 第 3 个发 |
| 4 | iOS：面板界面 | 跟阶段 3 一起发 |
| 5 | 真机验收与发版 | — |

**阶段 0—2 是协议，必须先进生产，顺序不能变**（见 §全局约束）。

每个阶段独立验证、独立提交。**不要攒到最后一次提交。**

---

## 阶段 0 · 协议与契约（`@synapse/shared` + 桌面 contract-schema）

### 产物

`MOBILE_KEYS` 从 23 项扩到 38 项：**原 23 项一个不动、顺序不变**，末尾追加 15 项。

追加的 15 项，顺序照下表（`Ctrl+` 组按字母序、`Shift+Tab` 收尾）：

```ts
// Ctrl 组（14 项，原有 10 项 Ctrl+A/C/D/E/U/K/W/L/R/Z 已在表里）
"Ctrl+B", "Ctrl+F", "Ctrl+G", "Ctrl+H", "Ctrl+J", "Ctrl+N", "Ctrl+O",
"Ctrl+P", "Ctrl+Q", "Ctrl+S", "Ctrl+T", "Ctrl+V", "Ctrl+X", "Ctrl+Y",
// 回退制表：Claude Code 切权限模式靠它
"Shift+Tab",
```

**同时要改的五处**（缺一处就是运行时才炸的错）：

| # | 文件 | 位置 | 改什么 |
|---|---|---|---|
| 1 | `shared/src/mobile-live.ts` | `MOBILE_KEYS` | 末尾追加 15 项 |
| 2 | `shared/src/mobile-live-constants.cjs` | `exports.MOBILE_KEYS` | 同上，逐项一致 |
| 3 | 同上文件 | 上面的 `@type {readonly [...]}` JSDoc | 类型列表补 15 项 |
| 4 | `desktop/app-capabilities/terminal/main/service.ts` | `KEY_BYTES` | 补 15 项键名 → 字节 |
| 5 | `desktop/app-capabilities/terminal/shared/contract-schema.ts` | `terminalSemanticKeySchema` 的 `z.enum` | 补 15 项 |

字节值（**照抄，别推**）：

```
Ctrl+B \x02   Ctrl+F \x06   Ctrl+G \x07   Ctrl+H \x08   Ctrl+J \x0a
Ctrl+N \x0e   Ctrl+O \x0f   Ctrl+P \x10   Ctrl+Q \x11   Ctrl+S \x13
Ctrl+T \x14   Ctrl+V \x16   Ctrl+X \x18   Ctrl+Y \x19
Shift+Tab \x1b[Z
```

### 关键约束

- **`MOBILE_KEYS` 只追加。** 不改序、不删除、不改已有项。每个键名都是手机、云端、桌面三方按字符串匹配的标识符，动一个等于改变已发布客户端发出去的东西。
- **不新增 `Ctrl+I` 和 `Ctrl+M`。** 它们分别是 `\x09`（=Tab）和 `\x0d`（=回车）的字节，加进去会让 `KEY_BYTES` 出现两个键名指向同一串字节，`reverseKeyBytes()` 的反查会静默取到靠后的那个。手机端改为发 `Tab` / `Enter`（阶段 4）。
- **38 项字节必须两两不同。** `\x08`（Ctrl+H）**不是** `\x7f`（⌫）；`\x0a`（Ctrl+J）**不是** `\x0d`（回车）。这两对是最容易抄错的。
- 不要顺手把 `Ctrl+A–Z` 之外的键（`Ctrl+\`、`Ctrl+Space`）也加进来——设计文档 §8 是明确的非目标。

### 涉及文件

- `shared/src/mobile-live.ts`
- `shared/src/mobile-live-constants.cjs`
- `desktop/app-capabilities/terminal/main/service.ts`
- `desktop/app-capabilities/terminal/shared/contract-schema.ts`
- `shared/src/mobile-live.test.ts`（改断言里的 23 与手抄清单）
- `desktop/app-capabilities/terminal/main/__tests__/mobile-toolbar.test.ts`（同上）

### 验证

```bash
pnpm --filter @synapse/shared run test
pnpm --filter @synapse/shared run build
pnpm --filter @synapse/desktop run test
```

要看到的三条既有断言变绿（不是被删掉）：

1. `shared/src/mobile-live.test.ts` 的 `keeps the toolbar's vocabulary to the keys the terminal service can encode`——长度 23 → 38，逐项清单补齐。
2. `mobile-live.test.ts` 的 `keeps the ESM constants identical to the CommonJS copy the desktop loads`——两份 `MOBILE_KEYS` 逐项相等（这条**不改断言语义**，它就该继续拦人）。
3. `mobile-toolbar.test.ts` 的 `means by each key name exactly the bytes the design says`——`KEY_BYTES` 与手抄的 `EXPECTED_KEY_BYTES` 相等、且与 `MOBILE_KEYS` 同集合、且字节无重复。

**再加一条新的**：把上面那两对易混字节钉住——

```ts
expect(DESKTOP_KEY_BYTES["Ctrl+H"]).toBe("\x08")   // 不是 \x7f
expect(DESKTOP_KEY_BYTES["Ctrl+J"]).toBe("\x0a")   // 不是 \x0d
```

### 完成标准

- 五处表全部是 38 项且逐项一致
- `shared` 与 `desktop` 的测试、`shared` 构建全绿
- 提交信息说清「白名单 23 → 38，新增 14 个 Ctrl 组合 + Shift+Tab」

---

## 阶段 1 · 服务端：重新部署

### 产物

**代码改动：0 行。**

服务端校验手机意图用的是 `shared` 里的 `isMobileIntent`（`server/src/mobile-live/mobile-live.controller.ts:24`），它读的就是阶段 0 改的那张表。所以服务端要做的只有一件事：**把带新 `shared` 的构建重新部署上去**。

### 关键约束

- **必须是第一个上线的。** 旧云端遇到不认识的新键名会**切断整条连接**，用户看到的是「设备莫名离线」、日志里只有一句校验失败。
- 部署前先 `df -h`（部署脚本不清镜像）。

### 验证

```bash
pnpm --filter @synapse/server run test
```

部署后拿一台**没有升级过的手机**连一次，确认老功能不受影响（旧手机发的还是那 23 个键名，新云端必须继续认）。

### 完成标准

- 生产环境跑的是带 38 项白名单的构建
- 未升级的客户端连接正常

---

## 阶段 2 · 桌面端：字节表

### 产物

`desktop/app-capabilities/terminal/main/service.ts` 的 `KEY_BYTES` 补齐 15 项。

`encodeSemanticAction` 是查表实现，补完表它自动就能发新键——**这个文件不需要别的改动**。

### 关键约束

- **不要顺手给内置工具栏加按钮。** `mobile-toolbar.ts` 的 `reverseKeyBytes()` 会把新字节反查成键名，但桌面内置动作里**没有任何一条序列是 `\x1b[Z` 或那 14 个控制字节**，所以手机工具栏**不会多出按钮**。这是预期行为。
- `KEY_BYTES` 同时是「字节表」和「合法键名表」（`encodeSemanticAction` 靠查表失败拒非法键），补表时别把它拆成两个来源——保持它就是唯一真相。

### 涉及文件

- `desktop/app-capabilities/terminal/main/service.ts`（`KEY_BYTES` + 上面那段说明注释）
- `desktop/app-capabilities/terminal/main/__tests__/mobile-toolbar.test.ts`

### 验证

```bash
pnpm --filter @synapse/desktop run test
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run check:hard-constraints
```

### 完成标准

- 桌面端测试全绿，三条既有断言未被削弱
- 提交信息说清「桌面端认识新增的 15 个键名」

---

## 阶段 3 · iOS：协议与发送

### 产物

1. `SynapseMobile/SynapseMobile/Core/Protocol/LiveProtocol.swift` 的 `MobileKey` 枚举补 15 个 case：

```swift
case controlB = "Ctrl+B"
case controlF = "Ctrl+F"
case controlG = "Ctrl+G"
case controlH = "Ctrl+H"
case controlJ = "Ctrl+J"
case controlN = "Ctrl+N"
case controlO = "Ctrl+O"
case controlP = "Ctrl+P"
case controlQ = "Ctrl+Q"
case controlS = "Ctrl+S"
case controlT = "Ctrl+T"
case controlV = "Ctrl+V"
case controlX = "Ctrl+X"
case controlY = "Ctrl+Y"
case shiftTab = "Shift+Tab"
```

（不要加 `Ctrl+I` / `Ctrl+M`，理由见阶段 0。）

2. `SynapseAppModel.swift` 的发送路径：现有 `sendKey(_:_:)` 只发单个动作，Alt 组合需要**一次 intent 发两个动作**。把单动作那层抽出来：

```swift
func sendKeys(_ sessionId: String, _ actions: [MobileKeyAction]) { … }
func sendKey(_ sessionId: String, _ key: MobileKey) { sendKeys(sessionId, [.key(key)]) }
```

Alt+字母调用 `sendKeys(sessionId, [.key(.escape), .text("b")])`。

**不需要新增 intent。** `keys` 意图本来就收数组，协议上限 128 个动作。

### 关键约束

- **`MobileKey` 的 rawValue 是三方按字符串匹配的标识符**，一个字都不能写错（`Ctrl+B` 不是 `Ctrl-B`）。
- 现有的 `dropsOnlyTheButtonsThisBuildCannotActOn` 行为不变：桌面端下发的键名这个版本不认识时，丢那**一个**按钮，不整条失败。
- `text` 动作的正文不能为空（协议校验要求非空）。

### 涉及文件

- `SynapseMobile/SynapseMobile/Core/Protocol/LiveProtocol.swift`
- `SynapseMobile/SynapseMobile/App/SynapseAppModel.swift`
- `SynapseMobile/SynapseMobileTests/TerminalToolbarTests.swift`（`decodesEveryKeyThePanelCanSend` 里的 23 → 38 与手抄清单）

### 验证

```bash
xcodebuild -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
```

并跑 `SynapseMobileTests`。

### 完成标准

- 枚举 15 个新 case 与云端表逐项对得上
- 单测里那条「面板能发的每个键这个名字都认识」跟着扩到 38 项
- Alt 组合能被组装成**一条** intent

---

## 阶段 4 · iOS：界面

### 产物

1. **`TerminalKeyboardPanel.swift`**
   - 分类改名 `控制 → 全键盘`；`KeyboardPanelCategory` 的 id `control` 一并改名。
   - 全键盘的布局模型：现有 `KeyboardPanelCell` 只有 `.key / .gap / .hole / .reference`，需要新增**修饰键**和**字母**两类 cell——它们不是固定的 `MobileKey`，要按当前锁存状态在按下时才算。
   - 锁存状态机：`@State` 存当前锁的修饰键（`.ctrl / .shift / .alt`）与是否处于锁定态。三个动作：点一下锁 / 双击锁定 / 发送后弹回。
   - **一次只锁一个**：换修饰键时清掉前一个。
   - 切换分类、收起面板时清空锁存。
   - 常用页新增 `⇧tab` 独立键（第一行三键两端对齐，esc 左、⌫ 右、⇧tab 居中）。
   - 读数条（只在全键盘页显示）。
   - `KeyboardPanelMetrics`：`gridHeight` 与 `restingHeight` 改成按分类取。

2. **`TerminalScreen.swift`**
   - `.presentationDetents([.height(...)])` 的高度跟着当前分类走。

3. **键位映射**（全键盘页按下时的解析规则）：

| 锁着的修饰键 | 按下 | 发出 |
|---|---|---|
| 无 | 字母 `x` | 文本 `x`（小写） |
| 无 | 数字 `3` | 文本 `3` |
| Ctrl | `A`/`C`/`D`/`E`/`U`/`K`/`W`/`L`/`R`/`Z` | 对应的 `Ctrl+X` |
| Ctrl | 阶段 0 新增的 14 个字母 | 对应的 `Ctrl+X` |
| Ctrl | **`I`** | **`Tab`** |
| Ctrl | **`M`** | **`Enter`** |
| Shift | 字母 `x` | 文本 `X`（大写） |
| Shift | 数字 | 对应的符号 `!@#$%^&*()` |
| Alt | 字母 `x` | 一次 intent 两个动作：`Escape` + 文本 `x` |

### 关键约束

- **照 `docs/prototypes/2026-09-17-terminal-full-keyboard.html` 做，别自己发挥。** 几何、间距、错位缩进、修饰键位置都以原型为准。
- **方向页与功能页一个字都不改。**
- **面板仍然没有增删改入口**：不长按弹菜单、没有铅笔、没有编辑态。面板是按键不是命令。
- 键的可点区域不小于 `Metrics.minimumTapTarget`（现有 `TerminalKeyPill` 已经处理，新键沿用同一个 modifier）。
- **锁住的修饰键要用反色**（浅底深字），和 iOS 系统键盘按住 shift 的表现一致——这不是装饰，是这套交互唯一的视觉反馈。
- **不要把它做成 `TextField`。** 面板是直接写 PTY 的，不走输入框，不走草稿。

### 涉及文件

- `SynapseMobile/SynapseMobile/Features/Terminal/TerminalKeyboardPanel.swift`
- `SynapseMobile/SynapseMobile/Features/Terminal/TerminalScreen.swift`
- `SynapseMobile/SynapseMobileUITests/TerminalFlowUITests.swift`（第 547 行的分类数组现在按「控制」找 `panelkey-Ctrl+A`）

### 验证

UI 测试需要一个「桌面端」当终端来源。不想打断正在使用的 Synapse 时，用仓库里的模拟桌面端（`server/test/mock-desktop.mjs`，用法见 `SynapseMobile/README.md`）。

```bash
xcodebuild -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test
```

**逐个键核对字节。** 新增的 15 个键里有 4 个是经典易错点：

| 键 | 正确 | 容易写成 |
|---|---|---|
| `Ctrl+H` | `\x08` | `\x7f`（那是 ⌫） |
| `Ctrl+J` | `\x0a` | `\x0d`（那是回车） |
| `Ctrl+S` | `\x13` | `\x11`（那是 Ctrl+Q） |
| `Shift+Tab` | `\x1b[Z` | `\x1b[I` |

模拟桌面端会把收到的键名回显出来，用它逐条对照。

### 完成标准

- 产品设计文档 §9 的验收基线 14 条逐条通过
- UI 走查测试更新后仍能一条龙跑完，并在「全键盘」页留下截图
- 真机上手感确认：修饰键够得着、字母行不挤

---

## 阶段 5 · 真机验收与发版

### 升级顺序（硬约束）

**服务端 → 桌面端 → 手机端。** 顺序写进发版说明。

理由：新键名要被三端同时认识；旧云端遇到不认识的新键名会切断整条连接，用户看到的是「设备莫名离线」，日志里只有一句校验失败，极难回溯。

### 兼容矩阵

| 手机 | 桌面端 | 云端 | 结果 |
|---|---|---|---|
| 旧 | 旧 | 旧 | 正常（本次改造前的状态） |
| 旧 | 新 | 新 | 正常。旧手机不认识新键名，面板上根本画不出来 |
| 新 | 旧 | 新 | 按新键会失败一次。**顺序错才会有这个状态** |
| 新 | 新 | **旧** | **走不通**，连接被切断 |

### 收尾清单

- 更新 `RELEASE_NOTES_PENDING.md`（用户可感知的新功能：全键盘面板、新增十余个组合键、`⇧tab`）
- 核对 `docs/agents/capability-registry.md`（本次**不新增 capability**，按 CLAUDE.md 要求核对一遍确认表格无变化）
- 把产品设计文档落进仓库：`docs/superpowers/specs/2026-09-17-terminal-full-keyboard-design.md`
- 把本计划落进仓库：`docs/superpowers/plans/2026-09-17-terminal-full-keyboard.md`
- **装到李杨的 iPhone 上真机走一遍**，不能拿"测试通过"交差。快速装机：`pnpm mobile:install`；完整发版见 `.claude/skills/ios-release/`

---

## 全局验证清单

```bash
pnpm --filter @synapse/shared run test
pnpm --filter @synapse/shared run build
pnpm --filter @synapse/desktop run test
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/server run test
```

iOS：

```bash
xcodebuild -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
```

**不要用裸 `npx vitest`**——它会解析到缓存副本、静默少跑文件，你会得到假的"0 次失败"。

---

## 风险

| 风险 | 表现 | 怎么防 |
|---|---|---|
| 五处表漏改一处 | 云端放行、电脑端抛异常 → 用户看到「按了没反应」 | 阶段 0 的完成标准逐处核对；两个包各有一组一致性断言 |
| 顺手把 `Ctrl+I` / `Ctrl+M` 加进表 | `KEY_BYTES` 字节重复，投影静默取错键 | 注入性断言会变红；设计文档 §4.2 写死了原因 |
| 字节抄错 | 按下去发出的是别的键，**不会报错** | 4 对易混字节单测钉住；模拟桌面端逐条回显核对 |
| 升级顺序做错 | 手机莫名离线，日志只有一句校验失败 | 发版说明里写死顺序；阶段 1 完成标准要求旧手机回归一次 |
| 修饰键叠锁 | 整块键盘全暗，用户以为坏了 | 设计上不给这个状态（§3.4）；验收基线第 7 条钉它 |
| 面板变高后挤掉终端 | 按着键看不到输出 | 验收基线第 13 条钉它 |
