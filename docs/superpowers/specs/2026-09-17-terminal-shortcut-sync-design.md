# 终端快捷指令同步 · 产品设计文档

日期：2026-09-17
状态：待评审
原型：`docs/prototypes/2026-09-17-terminal-shortcut-sync.html`
关联：`docs/superpowers/specs/2026-06-27-terminal-toolbar-actions-spike.md`、`docs/superpowers/specs/2026-09-17-mobile-claude-code-conversation-design.md`、`docs/adr/0072-exclude-terminal-bodies-from-ordinary-desktop-backup.md`

---

## 1. 要解决什么

桌面端的终端底部有一条快捷指令栏：工程师写死的几条内置命令排在前面，后面接用户自己新建的。手机端也有一条，但两边是**各写各的**——手机上是 10 个写死的按键，和桌面端毫无关系。

要的结果：**手机上看得到桌面的那一套，包括用户自己建的**。用户在电脑上攒的快捷指令，手机上直接能用；手机上只读，不能改、不能删、不能新建。

这句话听起来只差"多传一种数据"。实际上有两处必须先说清楚，否则做出来的东西不是想要的。

---

## 2. 现状：两条栏根本不是同一种东西

### 2.1 桌面端那条是「命令栏」

`desktop/app-capabilities/terminal/renderer/terminal-toolbar-actions.ts:32-69`，写死 4 条：

| 顺序 | label | 类型 | 点击后 |
|---|---|---|---|
| 1 | `Ctrl+C` | `terminal-sequence` | 往 PTY 写 `\x03` |
| 2 | `Clear` | `xterm-local` | **不写 PTY**，只清桌面端自己的 xterm 显示 |
| 3 | `/exit` | `shell-command` | 写 `/exit`，等 10ms 再写 `\r` |
| 4 | `/clear` | `shell-command` | 写 `/clear`，等 10ms 再写 `\r` |

自定义命令是另一套：`desktop/app-capabilities/terminal/shared/schema.ts:99-107`，字段 `label`（≤32 字符）、`content`（≤4096 字符，**禁止 `\r` `\n` 和控制字符**）、`pressEnter`（是否补回车）。最多 50 条，存在 DataRepository 的加密 namespace `app.terminal.toolbar-actions`（`desktop/electron/runtime/data-repo/schemas/terminal.ts:111-124`），**只在本机**。

点击行为在 `desktop/app-capabilities/terminal/renderer/index.tsx:1158-1194`：内置写常量字节或走 `shell-command` 补回车；自定义写 `content`，`pressEnter` 为真时等 10ms 再补一个 `\r`。

### 2.2 手机端那条是「按键行」

`SynapseMobile/SynapseMobile/Features/Terminal/TerminalScreen.swift:395-433`，10 个写死的按键，走 `keys` 意图：

```
return  tab  esc  ↑  ↓  ←  →  ⌫  ^C  ^D
```

它们是**手机的键盘替代品**——手机没有实体键盘，这 10 个键在别处没有任何入口。源码注释写得很直白（`TerminalScreen.swift:392-394`）：

> Exactly the keys the desktop can encode. Nothing here is aspirational: the terminal service rejects arbitrary control bytes, so a Ctrl modifier or a free-form key could not be delivered even if it were drawn.

### 2.3 两条栏的交集比想象中小

- 桌面的 `Ctrl+C` 写 `\x03`，手机已有的 `^C` 也是 `\x03`——**同一个字节**。
- 桌面的 `Clear` 是**桌面渲染层的本地清屏，连 PTY 都没碰**（`index.tsx:1160-1164`）。手机上把它画出来，点下去会在下一帧被桌面推进来的内容覆盖，等于骗用户。
- 真正算"新增到手机"的桌面内置命令，只有 `/exit` 和 `/clear`。

### 2.4 一条决定性的事实：控制字符发不出去

`desktop/app-capabilities/terminal/main/service.ts:3305-3330`：

```ts
function hasForbiddenTextControl(value: string, allowLf: boolean): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!
    if (codePoint === 0x7f) return true
    if (codePoint <= 0x08) return true
    if (codePoint === 0x09) continue
    if (codePoint === 0x0a) { if (!allowLf) return true; continue }
    if (codePoint >= 0x0b && codePoint <= 0x1f) return true
  }
  return false
}
```

除 Tab（`0x09`）以外，**`0x0b`–`0x1f` 全部被拒，包括 ESC（`0x1b`）**。也就是说：

- 方向键（`\x1b[A`）、Esc（`\x1b`）、Ctrl+任意字母、`⌫`（`\x7f`）**不可能**伪装成"文本"发出去；
- 它们只能走 `{type:"key", key}` 动作，而 key 必须落在白名单里——`shared/src/mobile-live.ts:176-187` 的 `MOBILE_KEYS`，**目前正好 10 个**，就是手机上那 10 个。

**这条决定了整个方案的形状**：手机上任何"新的按键"，都要先扩白名单，没有捷径。

---

## 3. 决策

### 3.1 手机快捷栏改成桌面快捷栏的镜像

手机那条按键行**整条去掉**，换成桌面端下发的内容：

```
[⌨] │ 回车  Ctrl+C │ /exit  /clear │ 部署  发版  …
 ↑              ↑                ↑
手机专属      桌面内置组        桌面自定义组
```

- `[⌨]` 是手机专属的入口，不在桌面端的列表里。
- 分隔线的位置由数据自带（见 §4 的 `group` 字段），不靠"第一条斜杠命令之前"这类位置规则推断。
- 渲染沿用手机端现在的胶囊样式（等宽字体、圆角、`minWidth 48 / minHeight 36`），只是数据来源变了。
- **`Clear` 不下发**（§2.3）。
- 列表为空时整条栏隐藏。

**这是本次最重要的一个取舍，代价要写在这里，不能当疏忽**：去掉那 10 个按键后，如果手机上没有别的入口，`↑ ↓ ← →`、`Tab`、`Esc`、`⌫`、`^D`、以及**回车**在手机上就彻底发不出去了。回车尤其致命——输入框的发送是"文本 + 回车"，空文本发不出去（协议层 `boundedString` 要求非空），所以去掉按键行等于**TUI 里什么都确认不了**，包括 Claude Code 的权限弹窗。

因此这个取舍成立的前提是下面两条同时做到：**回车由桌面端内置补位**（§3.2），**其余按键由键盘面板兜住**（§3.3）。

### 3.2 桌面端新增「回车」，放在第一位

往 `TERMINAL_TOOLBAR_ACTIONS` 的最前面插一条：

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

这样它同时出现在两端：电脑上是内置命令的第 1 个，手机通过下发自然拿到，不用为手机单开一条。

桌面端多一个回车按钮对电脑用户是冗余的（有物理键盘），这条**是为对齐付的成本**，接受。它带来的好处是"两端内置命令逐条一致"这件事从此有了确定的定义。

### 3.3 键盘面板：手机专属的按键入口

工具栏最左侧一个键盘图标（SF Symbol `keyboard`），点击从屏幕下方升起一个面板。面板顶部是分段选择器，下面是该分类的键位布局，**点即发送**。

**每一类照搬真键盘上的位置摆，不是等宽网格。** 手指记住的是位置，位置对了才不用看：

| 分类 | 照搬的键盘位置 | 键 |
|---|---|---|
| 常用 | 键盘外框的四角 | `esc`（左上） `⌫`（右上） / `tab`（左） `回车`（右，且更宽） |
| 方向 | 右侧方向键区的倒 T | `↑` 在上，`←` `↓` `→` 在下，整簇靠右 |
| 功能 | 右上角的六键簇，Insert 那一格留空 | `home` `end` `pgup` `pgdn` `del` |
| 控制 | **QWERTY 幽灵** | `^A` `^C` `^D` `^E` `^K` `^L` `^R` `^U` `^W` `^Z` |

「控制」这一栏是设计上的重点。Ctrl 组合在物理键盘上本来就是"按住 Ctrl 再按某个字母"，所以把它们放回字母自己的格子上——`^W` 落在 W 那一格、`^A` 落在 A 那一格，其余键压暗做参照、不可点。这样十个组合键的位置是可以靠肌肉记忆找的，而不是一串需要读的标签。

注意 `^C`、`^D` 由此从「常用」移到了「控制」：它们在字母 C、D 的本位上，而 `Ctrl+C` 本来就已经在快捷栏上，不缺入口。

交互约定：

- **点键后面板不收起。** 连按方向键、或依次按几个键是常态；收起会逼用户反复点开。
- **每类键区固定同高**，切分类时面板不跳动。
- **打开面板前先收起 iOS 键盘。** 两层键盘叠着谁也点不到。
- **面板不高。** 用户按方向键时得看得见终端——面板只占屏幕下部约 280pt，默认停在最低档，可上拉。
- 键帽复用现有胶囊样式。面板是手机的键盘，标签用手机习惯的紧凑写法（`^A` 而不是 `Ctrl+A`）。
- 会话不是 `running` 时全部置灰，与快捷栏一致。
- 有附件待投递时，`↩` 同时提交那些 chip（沿用 `TerminalScreen.swift:399-411` 现有行为）。

### 3.4 按键白名单扩容：10 → 23

新增 13 个，追加在 `MOBILE_KEYS` 数组**末尾**（保持既有顺序不动）：

| 键 | PTY 字节 | 说明 |
|---|---|---|
| `Home` | `\x1b[H` | |
| `End` | `\x1b[F` | |
| `PageUp` | `\x1b[5~` | |
| `PageDown` | `\x1b[6~` | |
| `Delete` | `\x1b[3~` | 前向删除，与 `Backspace` 的 `\x7f` 不同 |
| `Ctrl+A` | `\x01` | 行首 |
| `Ctrl+E` | `\x05` | 行尾 |
| `Ctrl+U` | `\x15` | 删至行首 |
| `Ctrl+K` | `\x0b` | 删至行尾 |
| `Ctrl+W` | `\x17` | 删前一个词 |
| `Ctrl+L` | `\x0c` | **写 PTY 的清屏**（与桌面 `Clear` 的本地清屏不是一回事） |
| `Ctrl+R` | `\x12` | 反向搜索历史 |
| `Ctrl+Z` | `\x1a` | 挂起当前进程 |

三处必须同时改，缺一处就是运行时才炸的错：

1. `shared/src/mobile-live.ts` 的 `MOBILE_KEYS`；
2. `shared/src/mobile-live-constants.cjs` 的同名数组——它与 ESM 版有逐字节一致性测试（`shared/src/mobile-live.test.ts:638`）；
3. `desktop/app-capabilities/terminal/main/service.ts:236-247` 的 `KEY_BYTES`——`encodeSemanticAction` 查不到 key 会抛 `invalid_argument`。

iOS 侧 `Core/Protocol/LiveProtocol.swift:337-364` 的 `MobileKey` enum 同步加 13 个 case。

几条要留意：

- **方向键与新增的 `Home`/`End`/`PgUp`/`PgDn` 一律用 normal 模式的序列**，不区分 DECCKM 应用模式——这是既有 `KEY_BYTES` 的行为（`ArrowUp: "\x1b[A"`），新键跟随，不引入新规则。
- **`Ctrl+Z` 是双刃剑。** 它发 SIGTSTP 挂起前台进程，而手机上没有一个终端能把作业捞回前台（`fg` 得先有 shell 提示符）。保留它是因为用户明确要"全"，但它更可能让人把 Claude Code 挂死后一脸茫然。列入开放项观察。
- **`Ctrl+L` 与桌面的 `Clear` 不是一回事**，别在实现时合并：桌面 `Clear` 不写 PTY，`Ctrl+L` 写 `\x0c`。

### 3.5 走独立的 `mobile.toolbar` 消息，不挤摘要

本来最省事的做法是把快捷指令塞进 `mobile.summary`（`agentGroups`/`agentProviders` 就是这么加的，天然在连接建立时送达，还自带云端缓存）。**实测下来塞不进去**：

```
maxSummaryBytes  = 253,952 字节 = 248.0 KiB
最宽合法摘要      = 250,999 字节 = 245.12 KiB
余量             =   2,953 字节
```

预算只剩 **2.9 KiB**。而自定义命令的 schema 上限是 50 条 × 4096 字符——就算按每条 36 字符的 uuid 加 32 字符标签算，50 条**内容为空**的按钮也要 6 KiB 以上，已经超了；更别说 `shared/src/mobile-live.test.ts:438` 那条"最宽摘要必须落在声明预算内"的测试要求把这一块**按上限**算进去。

提高预算也走不通：桌面→云那条 socket 是 256 KiB（`server/src/live/live-desktop.gateway.ts:101`），摘要预算已经贴着天花板，没有几 KiB 可让。

**所以新增一种下行消息 `mobile.toolbar`**，与摘要完全解耦：

- 不占摘要预算，不动那条边界测试；
- 自己的上限自己定，超了只影响自己；
- 语义也更对：摘要是"这台电脑有什么会话"，快捷指令是"这台电脑上有哪些命令按钮"，两者变化频率和大小都不是一回事。

代价是改动面比搭便车大（见 §5），且**服务端必须先发版**（§6）。

### 3.6 执行语义：一个新 intent 都不加

每种按钮都映射到**已有的** intent，这是本次能做到"只是多传一种数据"的关键：

| 按钮 | 手机发的 intent | 桌面端实际做的 | 与桌面端点击是否等价 |
|---|---|---|---|
| 回车 | `keys` + `{type:"key",key:"Enter"}` | 写 `\r` | 是（同一字节） |
| Ctrl+C | `keys` + `{type:"key",key:"Ctrl+C"}` | 写 `\x03` | 是（同一字节） |
| `/exit`、`/clear` | `command` + `text` | 写文本 → 等 10ms → 写 `\r` | 是（`deliverCommandWrites`，`main/service.ts:2294-2308`） |
| 自定义，`pressEnter: true` | `command` + `text` | 同上 | 是 |
| 自定义，`pressEnter: false` | `keys` + `{type:"text",text}` | 原样写文本，不补回车 | 是 |

长度也都在既有闸门内：`command.text` 与 `keys[].text` 上限 8 KiB（`shared/src/mobile-live.ts:127`），自定义命令最长 4096 字符且不含换行，天然满足"单行"要求。

### 3.7 只读

手机端**不提供**任何新增、编辑、删除、排序入口，也不做长按菜单。快捷栏没有铅笔按钮，面板里也没有。

删除和新建未来可能开放，但那要新增接口，本期明确不做。

### 3.8 旧电脑的兜底

手机端内置一份**兜底按钮**（`回车` `Ctrl+C` `/exit` `/clear`，与桌面内置一致），只在**从未收到过 `mobile.toolbar`** 时使用。

- 收到消息就整体替换，**即使是空数组**——沿用仓库既有约定："没有"和"这台电脑太老不会说"是两个答案（`shared/src/mobile-live.ts:437-456`）。
- 兜底必须包含回车，否则连接老电脑时手机连确认都做不到（§3.1）。
- 兜底里多一个老电脑没有的「回车」是**故意的**：它无害，且总比一个空栏强。

---

## 4. 协议

### 4.1 新增下行消息

信封沿用现有格式（`shared/src/live.ts:37-42`），类型加进 `LIVE_MESSAGE_TYPES`。

```ts
export interface MobileToolbarPayload {
  readonly desktopClientInstanceId: string
  readonly revision: number
  readonly buttons: readonly MobileToolbarButton[]
}

export interface MobileToolbarButton {
  readonly id: string                                  // 内置用稳定 id，自定义用其 uuid
  readonly label: string                               // 显示文案，原样渲染
  readonly group: "key" | "command" | "custom"         // 决定分隔线画在哪
  readonly action: MobileToolbarAction
}

export type MobileToolbarAction =
  | { readonly type: "key"; readonly key: MobileKey }
  | { readonly type: "text"; readonly text: string; readonly pressEnter: boolean }
```

说明：

- `group` 让手机端的分组渲染变成纯函数，不用复刻桌面端"分隔线画在第一条斜杠命令之前"这种位置规则。
- `action` 的形状是既有 `MobileKeyAction` 的超集（多一个 `pressEnter`），两端都已有对应的编解码。
- `desktopClientInstanceId` 必填：手机可能同时连着多台电脑，必须按电脑过滤（与摘要同一套处理）。

### 4.2 新增限额

照现有命名风格加进 `MOBILE_FRAME_LIMITS`（ESM 与 CJS 两份都要）：

| 常量 | 值 | 理由 |
|---|---|---|
| `maxToolbarButtons` | 64 | 桌面端上限 50 + 4 条内置，留余量 |
| `maxToolbarButtonIdLength` | 64 | uuid 36 字符够用 |
| `maxToolbarLabelLength` | 32 | 与桌面 schema 一致 |
| `maxToolbarTextLength` | 4096 | 与桌面 schema 一致 |
| `maxToolbarBytes` | 64 * 1024 | 单条消息预算 |

**超预算时的行为：按顺序追加，放不下的那一条起停止，不截断。** 截断会让按钮在手机上执行一条**不同于桌面**的命令，比按钮不出现糟得多。这个上限在实践中碰不到——50 条真实命令通常总共 2 KB 上下。

### 4.3 校验器

新增 `isMobileToolbarPayload`，照 `isMobileSummaryPayload`（`shared/src/mobile-live.ts:745-769`）的写法：必填字段用 `boundedString` / `nonNegativeInteger`，数组用 `boundedArray`，每一项过 `isMobileToolbarButton`。

**沿用"可选而非可空"的既有约定，并且要有一条"不给老客户端增加一个字节"的黄金测试**——摘要那边有，新消息这边要同样钉住。

---

## 5. 下发时机

连接建立时**必须**发出，之后尽力保持最新。三条触发点，全部复用现有代码路径：

| 时机 | 挂在哪 | 覆盖什么 |
|---|---|---|
| 手机连上后发 `sync` | 与 `resendSummary()` 并列（`desktop/electron/services/mobile-gateway/intent-executor.ts:158-167`） | 连接建立，**确定性送达** |
| 手机打开某个终端（`attach`） | `intent-executor.ts:170-196` | 用户在电脑上改完命令、回到手机打开终端 |
| 任意会话活动触发摘要 flush | `mobile-gateway-service.ts` 的 `flushSummary` 同一次 tick，**各自独立指纹去重** | 顺手刷新 |

**不能新加事件监听器。** 桌面网关在 `desktop/electron/services/mobile-gateway-service.ts:210-217` 明写了监听器预算已经用满：

> Four listeners here plus the six the terminal IPC layer registers lands at Node's default cap of ten; that is the whole budget, so this list should not grow.

所以上面三条全部搭现有触发点，不挂新监听器。已知的不完美：如果用户改完命令后手机上**既没重连、也没打开终端、也没有任何会话活动**，列表会陈旧到下一次三个时机之一发生。这个窗口里用户本来也看不到这条栏，接受。

---

## 6. 上线顺序（硬约束）

**服务端 → 桌面端 → 手机端。**

两条独立的原因都指向同一个顺序：

1. **新消息类型**：旧云端收到不认识的 `mobile.toolbar`，`isLiveDesktopClientMessage` 判假 → 以 **1003 切断桌面端的整条连接**（`server/src/live/live-desktop.gateway.ts:316-321`）→ 用户看到的是"电脑离线"，列表空掉，没有任何错误提示。
2. **新按键**：手机发 `{key:"Home"}` 给旧云端，`isMobileIntent` 判假 → 同样 1003，这次断的是**手机**的连接。

也就是说，服务端不先升，两件事都会以"设备莫名离线"的形式炸掉，而日志里只有一句校验失败。发版说明必须写清这个顺序。

桌面端不先升则是安全的：手机拿不到消息，落到内置兜底（§3.8），栏不会空。

---

## 7. 失败与离线

- **电脑离线**：手机侧保留最后一次收到的列表；接不上电脑时本来也发不出 intent，栏置灰即可。
- **协议校验失败**：`mobile.toolbar` 校验不过会断连（与现有 `mobile.*` 一致）。校验器必须写严，宁可拒收也不要让半截数据进 UI。
- **命令变更没来得及下发**：见 §5，最坏情况是列表陈旧到下次重连/打开终端，不存在"显示了错误命令"的路径——列表要么是旧的完整快照，要么是新的完整快照，没有中间态。
- **手机端不缓存到磁盘**：与摘要一致，进程重启后重新拉。没有"离线可用的快捷指令"这个需求。

---

## 8. 安全

- 下发的数据是**用户自己的命令文本**，不含凭据。它本来就是明文写在桌面本机的加密 namespace 里，这里只是多一条到用户自己手机的通道。
- 通道本身已鉴权：手机与电脑都先登录同一账号，云端按 userId 扇出。
- 校验器对每条 `text` 施加与桌面 schema **同样**的限制（长度、非空），不因为"是自家电脑发的"就放松。
- 手机端只读，不提供任何写回桌面配置的路径。

---

## 9. 非目标

- **不做手机端的增删改。** 没有编辑入口、没有排序、没有长按菜单。
- **不动 `Clear`。** 不下发、手机上不出现。
- **不动分组命令（group commands）。** 那是绑在终端分组上、启动新会话的东西（`main/service.ts:1762-1795`），和这条栏是两个功能。顺带说明：上行 `launchCommand` intent 在桌面端已经实现完整，手机端有发送方法但**没有任何调用点**——本次也不接。
- **不与「快捷输入」系统 App 合并。** 仓库里有一个同名但无关的功能（`desktop/app-capabilities/quick-input`，给 Agent 对话用的，有自己的 `config.global.quickInputs` 和导出备份路径）。名字像，东西不同，不要顺手统一。
- **不做双向同步。**
- **不扩到更多按键。** 面板就 23 键，超出 §3.4 的一张不加。
- **不做云端缓存 / 冷启动 HTTP 兜底。** 快捷指令只在电脑在线时有意义。

---

## 10. 验收基线

逐条走，哪条没过就直说：

1. 电脑上新建一条自定义命令，手机重连后快捷栏出现它，点击后电脑终端的表现与在电脑上点同一条**完全一致**（含 `pressEnter` 与否的区别）。
2. 电脑上删除一条，手机上相应消失。
3. 电脑上把某条改名，手机上文案跟着变。
4. 手机快捷栏顺序为：`[⌨]` │ 回车 `Ctrl+C` │ `/exit` `/clear` │ 自定义若干，分隔线位置与桌面端一致。
5. 手机上**看不到** `Clear`。
6. 手机快捷栏没有铅笔/编辑入口；长按不弹菜单。
7. 点键盘图标升起面板，四个分类可切换，每个键点下去在电脑终端里都产生正确效果（逐个走一遍 23 键）。
8. 面板点键后不收起；打开面板时 iOS 键盘已收起。
9. 桌面端旧版本（无本功能）连上时，手机仍显示兜底四键，栏不空。
10. 桌面端新版本 + 云端旧版本：**必须表现为明确故障而不是静默异常**——按 §6，此时会以"电脑离线"形式出现，发版流程必须保证这个组合不会流到用户手上。
11. 会话非 `running` 时，快捷栏与面板全部置灰。
12. 带附件待投递时，点回车会提交那些 chip。

---

## 11. 开放项

- **`Ctrl+Z` 是否该留在面板里**（§3.4）。手机上挂起一个进程几乎捞不回来，可能弊大于利。
- **面板分类的命名与切分**：`常用 / 方向 / 功能 / 控制` 是初稿。键位照着真键盘摆，但分类本身是按"哪块区域"切的，实际用起来可能想让「功能」和「方向」合并（它们在同一块键盘区域），或多切一个给别的键。
- **手机上开放新建/删除**：需要新接口，本期不做。
- **`maxToolbarBytes` 的兜底策略**：现在是"放不下就停"，如果将来真有人把命令写得很长，可能需要更明确的提示。
- **`Clear` 要不要以 `Ctrl+L` 的形式补回手机**：本期跳过（见 §2.3、§3.4），代价是手机上少一个清屏动作。
