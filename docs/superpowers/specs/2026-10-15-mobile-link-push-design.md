# 把链接推到用户手机，并退役终端嗅探

日期：2026-10-15
状态：待评审

本设计是两件相互独立的事，因为它们可以由两个阶段分别落地：

- **A. 新增**：让任意来源把一条链接推给用户的账号，落到手机通知中心。
- **B. 退役**：删掉手机端从终端画面嗅探链接的整套机制，含它专用的协议字段。

B 是 A 的动机，但两者没有代码重叠（A 对手机端零改动，B 只动手机端与协议）。可以分两批发。

## 目标

用户说「把链接发我手机上」，AI 就有地方把链接交出去；手机收到一条通知，点一下直接打开。触发者是调用方，不绑任何具体工具：刚生成的分享链接、翻出来的旧分享、外部的 GitHub PR，一视同仁。

同时，终端不再猜链接。今天那条路的不确定性来自渲染层——URL 被 TUI 自己折行后 wire flags 为 0，只能靠「填满整行 + 悬挂缩进」的形状猜边界，猜错就把半条 URL 交给用户（`SynapseMobile/.../TerminalResources.swift:20-38` 记录了这套推断的全部前提）。这条不确定性改不掉，只能退役。

## 非目标

- **不绑链接创建。** 不在 `app_drive_share_create` / `app_drive_site_create` 里加自动上报。链接诞生时上报覆盖不到「让 AI 找一条已有的分享链接」——那条路径上链接早就存在。
- **不新增通知来源（`source`）。** 沿用 `system-notifier`。
- **不暴露 `level`。** 桌面写入路径继续不传，由服务端默认 `active`。
- **不新建存储、不做迁移。** `UserNotification.url` 与 `.group` 两列都已存在。
- **不删 `LinkBrowser`。** 它是全 App 共用的链接打开器（云盘、站内信、通知都在用），A 的落点也用它。B 只拆资源栏那条调用链。

---

# A. 链接推送

## 数据流

```
AI（Claude Code / Codex）
  └─ app_system_notifier_notification_trigger { title, body, url?, group? }
      └─ SystemNotifierService.trigger → sendToAccount
          └─ POST /api/notifications/desktop        Bearer 桌面登录态
              └─ NotificationService.create()       ← 已支持 url / group / level
                  ├─ publish()  live 广播 → 手机在线即到
                  └─ level = active → APNs 推送
                      └─ 手机点通知 → .externalURL → LinkBrowser
```

投递链路几乎全部现成：`NotificationService.create()` 本来就接受 `url` 与 `group`，只是桌面的写入入口把它们挡住了。

## 契约

`url` 与 `group` 的规则**沿用开放 API 那一套**（`server/src/open-api/open-api-contract.ts:31,34`），不另立一份：

| 字段 | 规则 | 出处 |
|---|---|---|
| `url` | `z.url().max(2048).regex(/^https:/u)` —— 只允许 https | `open-api-contract.ts:34` |
| `group` | `z.string().trim().min(1).max(64)` | `open-api-contract.ts:31` |

两个字段都可选。桌面侧按既有风格另写等价的校验，但**不是** code-point，而是 **UTF-16 码元**——与服务端 zod 的 `.max()` 同一把尺子。桌面因此不是更宽的那一侧：码元数是码点数的上界，按码点校验会放行服务端必拒的值（33 个 emoji 是 33 码点、66 码元），而调用方早已被告知成功，整条通知却在服务端丢掉。两侧本来就各有一份 zod schema，不强行合并。

## 改动清单

| 层 | 文件 | 改什么 |
|---|---|---|
| 服务端 | `server/src/notifications/notification.controller.ts:49-57` | `desktopWriteSchema` 加 `url`、`group` |
| 服务端 | `server/src/notifications/notification.service.ts` | **不动**——`create()` 已接受二者 |
| 主进程 | `desktop/app-capabilities/system-notifier/shared/schema.ts` | `SystemNotificationInput` 加可选 `url`/`group`；`SYSTEM_NOTIFICATION_INVALID_FIELDS` 加两项；`validateSystemNotificationInput` 加两条字段校验 |
| 主进程 | `desktop/app-capabilities/system-notifier/main/service.ts` | `sendToAccount` 透传两个字段 |
| 主进程 | `desktop/electron/services/account-service.ts` | `createInternalNotification` 入参加 `url`、`group` |
| MCP | `desktop/synapse-capabilities/shared/app-domain.ts` | trigger 工具 `inputSchema` 加两个可选字段；description 补「用户要一条链接到手机时用它」 |
| MCP | `desktop/electron/services/agent-runtime/synapse-tool-router-lexicon.ts` | 按需补中文口语词条 |
| Skill | `.../skill-package/app/index.md` | System Notifier 一节补推链接的场景；收窄「不要加平台特有字段」那条（见下） |
| Skill | `.../skill-package/app/api-reference.md` | trigger 工具参数表补两个字段 |
| 文档 | `docs/agents/capability-registry.md` | System Notifier 行的例外说明；**MCP 工具数不变（仍 1），三张表的数字都不动** |
| 文档 | `RELEASE_NOTES_PENDING.md` | 用户可感知变化 |
| 测试 | system-notifier 校验单测、notification controller 单测、`INTENT_CORPUS` | 配套 |

**就 A 而言，手机端与桌面端的界面代码零改动。**（B 会改手机端，见下。）依据：

- 路由：`NotificationDestination.resolve`（`SynapseMobile/.../NotificationDestination.swift:57-58`）对「无专属来源分支 + 有 https `url`」的通知返回 `.externalURL(url)`，`system-notifier` 正是这一类。
- 动作标签：同文件 `:76` 对 `.externalURL` 已返回「打开链接」。
- 分组：`InboxView.swift:311-316` 已把 `group` 画在标题旁的小字位。
- 推送：`mobile-push.service.ts` 的 APNs payload 只带 `aps.alert.{title,body}` 与 `{notificationId, notificationLevel}`，**不读 `url`**。
- 桌面端同理：`use-message-center.ts` 对 https `url` 已走 `shell.openExternal`。

## 边界与判断

### 1. 两层执行校验，工具 schema 声明约束

`url` 的 https-only + ≤2048 个 UTF-16 码元约束，必须由**桌面校验器与服务端 schema 两层执行**。桌面校验挡不住绕过 MCP 直接打 HTTP 的调用方，因此服务端不能省略校验。

MCP 工具的 `inputSchema` 只声明约束，不能算第三道运行时闸门：JSON Schema 的 `maxLength` 数的是 Unicode 码点，不能直接表达这里的码元上限；`pattern` 也不能保证调用方执行校验。本仓库将工具 schema 用于检索与工具描述，`invoke` 不按它校验业务参数，而是将参数交给实际能力执行。模型应遵守声明，最终拒绝非法输入仍由桌面与服务端负责。

同理 `desktopWriteSchema` 的 `.strict()` 必须保留：`notification.controller.ts` 里 `createFromDesktop` 的文档注释写明 `/desktop` 这个路径名说的就是授权范围，它挡的是桌面冒充服务端自有来源。

### 2. 锁屏与明文

Skill 现在有一条规则：title/body 不得出现 Token、密码、验证码、私钥、完整本地路径等锁屏敏感内容，理由是消息在服务端明文存储且可能出现在锁屏上。

- **APNs payload 不含 `url`**（见上），所以带密码参数的分享链接不会直接上锁屏。
- 但 `url` 与其他通知字段一样**在服务端明文存储**，与开放 API 的 `url` 同级别。这是既有事实，不是本设计引入的。
- 因此该规则要相应更新：把 `url` 纳入「不得携带凭据」的范围（例如不要把带 `?password=` / `token=` 的地址推进来），同时把原文里对**字段**的禁令（「不要加平台特有字段、caller identity、notification id、幂等键、重试循环」）收窄到它真正要挡的那几类，否则字面上会把新加的 `url`/`group` 一起挡掉。

### 3. `sourceKey` 不暴露

`@@unique([userId, sourceKey])` 只在传了 `sourceKey` 时才生效。trigger 工具**不暴露** `sourceKey`：不传就是每次一条新记录，语义正好是「用户又要了一次」。去重不是这里要解决的问题。

### 4. 可靠性不是零风险

消掉的是「从渲染后的画面猜 URL」这条最不可控的路。但 URL 仍是**模型复制进工具参数**的，理论上还能抄错。

系统已经做过一次针对性加固：分享 ID 的字母表（`server/src/drive/drive-token.ts:8-15`）当初就是为了「经得起人的眼睛和模型的口述」才换成 Crockford Base32，把 `O/0`、`I/l` 这类混淆字符从字母表里删掉了。最容易错的那一类不存在。

如需再收紧，可在 Skill 里要求推之前先用 `app_drive_link_resolve` 核一遍——抄错当场发现，而不是等用户点开才发现 404。**本设计暂不加**，留作后续可选。

---

# B. 终端嗅探退役

## 拆除面

### 手机端：整文件删除

| 文件 | 行数 |
|---|---:|
| `SynapseMobile/.../Features/Terminal/TerminalResources.swift` | 350 |
| `.../TerminalResourcesSheet.swift` | 220 |
| `.../TerminalResourceReachability.swift` | 145 |
| `SynapseMobileTests/TerminalResourcesTests.swift` | 425 |
| `SynapseMobileTests/TerminalResourceReachabilityTests.swift` | — |

### 手机端：改

- `TerminalStore.swift` —— `resources`(:34)、`resourceCollector`(:35)、`collectResources(in:)`(:234-240)，以及 `reset()`(:126-127) 与 `apply()` 的两处调用点(:173、:226)。
- `TerminalScreen.swift` —— `resourcesPresented`(:57)、`pendingResourceURL`(:58)、`:330` 的条件、`.inspector`(:837-851)、`:965` 的 `resourceBar` 条件、`resourceBar`(:1353-1372)、`:59` 的 `openedResource` 与 `.linkBrowser` 一并回退。

> `:59` 的 `openedResource` / `.linkBrowser` 是为**资源栏**引入的，资源栏拆掉后它在本屏没有别的调用者，一并删。`LinkBrowser` 这个类型本身留着——全 App 共用。

### 协议：`wrapFlags` 整条链路删除

它**只有一个读者**，就是嗅探。手机端 `DisplayRow.isContinuation` 是从本地折行推出来的（`TerminalStore.swift:468`），不读它；桌面端也只有 mobile gateway 一串消费 `TerminalStyledLine`。

| 端 | 文件 | 删什么 |
|---|---|---|
| 手机 | `Core/Protocol/LiveProtocol.swift:356-382` | `wrapFlags`、`wrappedFromPrevious`、`wrappedToNext` 及解码分支 |
| shared | `shared/src/mobile-live.ts:396-404` | wire 类型里的第三项与它的注释 |
| 桌面 | `desktop/electron/services/mobile-gateway/frame-builder.ts:176-180` | 位打包，`toLineWire` 回到 `[text, runs]` |
| 桌面 | `desktop/app-capabilities/terminal/main/emulator.ts:40,42,379-385` | `TerminalStyledLine` 的两个可选字段与产者逻辑 |

`desktop/electron/services/mobile-gateway/line-window-tracker.ts` 的 `lineEquals` **不需要动**。设计时以为它会随字段调整，实作后核对：它逐项比较 `text` 与九个 run 字段，从不读这两个折行标记，删掉字段后它的比较语义逐位不变。（这条更正来自 Task 7 的审查。）

### 测试

`frame-builder.test.ts`、`emulator.test.ts`（含 `referenceReadStyledLine` 这份镜像实现）、`TerminalFrameDecodingTests.swift`、`shared/src/mobile-live.test.ts`；`SynapseMobileUITests/WorkspaceFilesUITests.swift:648-661` 那个断言「会话资源」导航标题不存在的用例。

### 文档与指南

- `SynapseMobile/README.md:32-40` —— 整段在描述嗅探行为（含「已收到的链接……仍留在会话资源中」「桌面端在行帧中附带可选的软换行标记」等）。
- `desktop/app-capabilities/synapse-skill/skill-package/SKILL.md:54` —— 这条**改写而非删除**。原文要求把 Synapse 链接写成 URL 本身、独占一行或放在普通句子里、不要藏进 Markdown 链接文字、绝不放进表格单元格。其中「绝不放进表格」的理由（嗅探拆不开表格单元格）随嗅探消失；但「用户要能拿到这个地址」的理由还在，且现在直接指向 A——用户要在手机上打开，就让 AI 推过去，而不是指望用户从终端画面里抄。

## 版本错配

协议字段同批删除，因此存在一个窗口：**新桌面 + 旧手机**。旧手机仍会嗅探，但收不到软换行标记，跨物理行的长 URL 拼不回来——不是崩溃，是更容易猜错。

这是**接受的代价**：那条路径本来就是要删掉的东西，为一个正在消失的功能保留协议字段，等于让死代码长期留下；而两端更新节奏都在自己手里。

---

## 测试计划

**A**
- 桌面校验：`url` 非 https 被拒；>2048 被拒；`group` 65 码元被拒；`group` 为 33 个 emoji（33 码点 / 66 码元）同样被拒——后一条才区分得开两种尺子；未知字段仍被拒（回归）。
- 服务端 controller：`/api/notifications/desktop` 接受带 `url`、`group` 的请求体；`http://` 的 `url` 返回 400；越权 `source` 仍返回 400（回归）。
- 检索：若给 `LEXICON` 加了词条，`INTENT_CORPUS` 必须仍全绿（`desktop/tests/unit/synapse-tool-router-search.test.ts`）。

**B**
- 删掉的文件与用例一并移除，不留 `@Test` 空壳。
- 手机端**产品代码零改动**的说法不适用于 B。A 的部分不新增 UI 测试。

## 风险

| 风险 | 影响 | 处理 |
|---|---|---|
| AI 把带凭据的分享地址推进来 | 服务端明文留存 | Skill 明确禁止；锁屏不受影响（APNs 不带 url） |
| 执行校验与工具声明漂移 | 桌面与服务端接受范围不一致，或调用方误解限制 | 桌面与服务端各自测试执行约束；同步工具声明并明确码点与码元差异 |
| 与开放 API 的 `url` 规则分叉 | 同一件事两套规则 | 契约表钉死出处，实现时照抄 |
| 协议改动波及终端显示 | 手机终端本身出问题 | B 的协议改动不动渲染路径（`isContinuation` 本地推导）；跑手机端解码与桌面 gateway 测试 |

## 落地顺序

两阶段，可分别发布：

1. **B**（纯删除）—— 独立、风险集中在手机端与协议，先落可以先把死代码清掉。
2. **A**（新增）—— 服务端 → 主进程能力 → MCP 定义 → Skill 文档 → 文档与发布说明。

**A 内部必须服务端先落。** 新桌面 + 旧服务端的窗口里，带 `url`/`group` 的调用会撞上 `desktopWriteSchema` 的 `.strict()` 拿到 400：`createInternalNotification` 抛错，`sendToAccount` 把它吞成一条本地诊断，工具照样返回 `{success: true}`——用户要一条链接到手机，结果哪一端都没有，任何界面都不报错，是**静默失败**。不带 `url`/`group` 的调用不受影响。

顺序也可对调；两者没有共享改动。若 B 后发，注意 A 上线时用户会短暂看到「通知里有链接、终端页资源栏也有一条」的并存状态。
