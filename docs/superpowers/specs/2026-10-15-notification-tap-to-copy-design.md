# 通知点按复制（copyOnTap）设计

## 目的

让「AI 把一段文字交给用户」这条路走通：发送方可以在通知上声明「这条的正文是拿来用的」，用户点一下通知横幅就把正文拿到剪贴板，不必打开 App 手动选字。同时，任何一条通知在 App 消息中心打开详情后，都提供「复制正文」。

典型场景：AI 写好一段绕口令、一句口令、一条待粘贴的命令或一段文案，发一条通知说「写好了」。用户人在外面，点一下通知就拿到了那段文字。

## 本次改动的边界

**改**：给通知增加一个由发送方声明的可选属性 `copyOnTap`，贯穿「触发输入 → 落库 → 实时事件 → APNs payload → 手机点按」；桌面消息中心与 iOS 通知详情各自补一个「复制正文」。

**不改**：通知的路由语义（点按去哪由 `source` / `targetId` 决定，复制不参与），通知分级（`level`），限流、审计、诊断、fire-and-forget 成功语义，消息中心的数据归属与保留期。

## 非目标

- **不做 Bark 的完整复制能力**。只有「点按复制正文」一项；不做自动复制（`autoCopy`，无需点击）、不做复制标题、不做复制到指定位置、不做复制后自动打开某地址。
- **不给通知加动作按钮**。本轮只做「点横幅 → 打开 App → 复制」。原因是 iOS 对不带前台的 action 不给任何反馈，按了没反应，体验反而更差。
- **不引入 Notification Service Extension，不使用 `aps.mutable-content`**。复制发生在 App 前台路径里，不需要在投递途中改写内容。
- **不给桌面原生横幅加点击行为**。System Notifier V1 设计明确写了 adapter 不安装 `show` / `click` / `close` / `reply` / `action` 任何监听器，这条边界本轮不动；人在电脑前用消息中心详情复制即可。
- **不新建 renderer 剪贴板封装**。桌面 renderer 现有十几处裸调 `navigator.clipboard.writeText`，本次沿用同一模式，不顺手重构。

## 语义

`copyOnTap` 是可选布尔，默认 `false`。为真表示：**这条通知被点按时，把它的 `body` 写入剪贴板**。

- 复制内容只有 `body`，**不含 `title`**。`title` 是标签，`body` 才是用户要的正文。
- 复制**不改变路由**。点按仍然按既有规则决定去向（有 `targetId` 去会话/录音/站内信/待办，有 `url` 开链接，都没有则打开通知全文页）。`copyOnTap` 只是在默认点按发生时顺带写入剪贴板。
- 只有**默认点按**触发复制。由动作按钮、Widget、App 内列表点击进入都不复制。
- 与 `level` 正交。`passive` 通知本来就不推 APNs（服务端在 `level === "passive"` 时跳过推送），因此手机上没有横幅可点，`copyOnTap` 对它只意味着 App 内详情仍可复制。
- 字段缺省、旧客户端、旧服务端一律按 `false` 处理，行为与今天完全一致。

## 稳定身份与版本

`copyOnTap` 是既有能力的可选输入扩展，**不新增** App、capability、MCP 工具、Workflow 节点、Automation Action 或 Deep Link：

- App ID：`system-notifier`（不变）
- Capability：`app.system_notifier.notification.trigger@1.0.0`（**版本不 bump**）
- MCP 工具：`app_system_notifier_notification_trigger`（数量仍 1）
- Workflow 节点：`system_notifier_notification_trigger`（数量仍 1）

版本不 bump 的依据：2026-10-15 的 `url` / `group` 可选字段扩展也没有 bump，可选字段是向后兼容的加法，与既有做法保持一致。

## 对外契约

### MCP

`app_system_notifier_notification_trigger` 的 `inputSchema` 增加可选 `copyOnTap: boolean`。`additionalProperties: false` 保持不变，未知字段继续被拒（`INVALID_INPUT` / `field: "request"` / `reason: "unknown_field"`）。

校验规则：`copyOnTap` 若出现必须是布尔；缺省即为 `false`。它不参与「单行文本」「不得含控制字符」那套文本校验——它是一个开关，不是内容。

### Workflow

节点 `system_notifier_notification_trigger` 的 config 增加 `copyOnTap`（布尔，可选，默认 false）。插值路径不涉及它（它不是文本）。分享契约仍要求 `app.system_notifier.notification.trigger >= 1.0.0`。

### 开放 API

三个传参形状都要能表达这个开关：

| 形状 | 传法 |
|---|---|
| `POST /api/open/v1/notifications`（密钥在请求体 `key`） | 请求体可选 `copyOnTap: boolean` |
| `POST /api/open/v1/notifications/{key}` | 请求体可选 `copyOnTap: boolean` |
| `GET /api/open/v1/notifications/{key}/{title}/{body}` | 这个形状放不下 JSON 体，用可选 query `?copyOnTap=1` |

`?copyOnTap=1` 只认字面 `1` 为真；缺省或任何其它值按 `false` 处理，不报错——URL 形状以能粘贴即用为先，不为一个开关把整条链接判失败。

`/api/open/openapi.json` 与对外接口说明同步更新。

> **本次修订的是既有的明确非目标。** 《账号消息中心》设计第 35 行把「复制动作」与图片、铃声、重要警告、持续响铃、推送加密并列写为不支持。本次只放开「点按复制正文」这一项，其余各项继续不支持：仍不做图片、铃声、重要警告、持续响铃、推送加密、自定义 TTL、多服务器，接口仍不兼容 Bark URL。该行必须随之修订，不能让规则与实现脱节。

### 桌面 IPC

无新增通道。`createInternalNotification` 的入参在既有形状上多一个可选布尔，`POST /api/notifications/desktop` 的服务端 schema 同步加字段。

## 服务端

1. `UserNotification` 增加 `copyOnTap Boolean @default(false)`，配一条迁移。字段由创建方提供；服务端自有的内部来源（终端、站内信、待办提醒、录音转写、云盘互动）不传，恒为 false。
2. `desktopWriteSchema`（`.strict()`）与开放 API 契约 schema 各加 `copyOnTap: z.boolean().optional()`。
3. `notification.service.create` 落库时写入该列（缺省 false）。
4. `mobile-push.service.sendNotification` 的 `data` 增加 `copyOnTap`，放在 payload 根、与 `notificationId` 同级。**`aps` 字典一个字不改**：不加 `mutable-content`，不新增 `category`。
5. 列表与详情 DTO 带出该字段，桌面与 iOS 的 `SynapseNotification` 各加一个布尔，保持两端契约一致。
6. 实时事件（`notification.changed`）只需带消息 ID，不必带该字段——桌面不消费它。

迁移只有一列带默认值的布尔，在 PostgreSQL 上不重写表。若部署前的迁移风险扫描仍拦截，按既有流程核验生产库后放行，不要为绕过检查改迁移形状。

## 桌面端

消息中心详情的 `notificationActions` 增加 `{ id: "copy-body", label: "复制正文" }`，排在现有「复制 ID」之前。列表项的右键菜单与该数组共用，自动一起获得这一项。

复制内容取**详情页显示的那份正文**，不是原始 `item.body`：

- 站内信（`source === "mail"`）→ 原信正文已加载时用原信正文，未加载或读取失败时回退 `item.body`
- 云盘互动（`drive-discussion`）→ 详情页正文区展示的全部文字，按展示顺序、段落之间空一行拼接
- 其余来源 → `item.body`

理由是按钮叫「复制正文」，用户复制到的应当就是他看到的那一段。

实现沿用「复制 ID」那套 `navigator.clipboard.writeText` + toast，成功 toast 文案 `正文已复制`（与该处既有的 `ID 已复制` 同构）。写失败仍是 `复制失败`。

## iOS

### 点按复制

`AppDelegate.didReceive` 在判定为**默认点按**且 `userInfo["copyOnTap"]` 为真时，**同步**执行剪贴板写入，顺序必须在路由之前：

- 用 `response.notification.request.content.body`，不走网络。这样冷启动、无网络、回查失败都能复制成功，且复制到的就是用户在锁屏上看到的那一段。
- 开关只接受布尔真值（APNs JSON 的 `true`）。字符串一律按假处理，避免 `"false"` 被当成真。
- 写剪贴板复用 `DesignSystem/Clipboard.swift`，连触感一起走现成实现。

路由逻辑完全不动：有 `notificationId` 照旧 `.message(id:)`，`meetingId`、终端会话照旧。

### 复制提示

`didReceive` 在无 scene 时也会执行，那里拿不到 `SynapseAppModel`，因此**不直接在 AppDelegate 弹提示**。做法是在 `NotificationRouter` 上增加一个与 `pending` 同级的一次性标记，`RootView.handleRoute` 消费路由后读取该标记，调用 `model.notice("已复制正文", tone: .success)` 并清空。文案与该页既有的 `已复制引用` / `已复制全文` 同构。

### 详情页复制入口

通知详情页（`NotificationFullTextView`）增加「复制正文」入口，复用 `Clipboard.copy(_, saying: "已复制正文", on: model)` 与 `NoticeBar`，不新造实现。云盘互动类的快照正文与普通通知的 `MarkdownContent` 正文都适用。

入口的形制（工具栏按钮还是底部按钮、图标与文案）**不在本 spec 锁定**，实现阶段按 `apple-design` 引导阅读对应 Apple 官方原文后确定，并同时核对 iPhone 与 iPadOS。

## 技能与文档

**发送侧**（让 AI 知道什么时候该设这个开关）：

- `desktop/app-capabilities/synapse-skill/skill-package/app/index.md` 的 System Notifier 段
- `desktop/app-capabilities/synapse-skill/skill-package/app/api-reference.md` 的入参表
- `desktop/app-capabilities/synapse-skill/skill-package/SKILL.md`
- `desktop/app-capabilities/synapse-skill/skill-package/workflow/index.md`、`workflow/api-reference.md`
- `desktop/docs/workflow-mcp-guide.md` 的节点说明

技能要写的核心判断是：**当用户要的东西本质是「把一段文字拿到手机上」（绕口令、口令、一条命令、一段文案），就把那段文字放进 `body` 并设 `copyOnTap: true`，用户点通知即得。** 同时说明 `title` 只作标签不会被复制，`body` 长度上限 256 个 Unicode 码点（服务端 512 码元），放不下就改发链接。

**读取侧**（任何通知详情都能复制正文）：

- `skill-package/notifications/index.md` 与 `notifications/api-reference.md` 各一句，说明详情页可复制正文，并与既有的「复制 `synapse:notification:<id>` 引用」区分开。

**规则与设计**：

- `docs/superpowers/specs/2026-09-23-account-notification-center-design.md` 第 35 行的不支持清单
- `docs/agents/module-boundaries.md` 的开放 API 段
- `docs/agents/capability-registry.md` 的 System Notifier 条目与例外说明（工具数与节点数不变）
- `RELEASE_NOTES_PENDING.md` 面向用户记一条：通知现在点一下就能复制正文

## 上线顺序与验证

**顺序：服务端 → 桌面端 → iOS，不能乱。** `desktopWriteSchema` 是 `.strict()`，旧服务端收到带 `copyOnTap` 的桌面请求会直接 400，所以服务端必须先上。反方向是安全的：旧 iOS 客户端读到多出的 payload 字段只是忽略。

验证：

- 服务端：新字段的落库、DTO 带出、推送 payload 结构、开放 API 三个形状（含 `?copyOnTap=1`）各一条测试。
- 桌面端：`check:hard-constraints`、通知相关测试、详情页「复制正文」在三种来源（站内信 / 云盘互动 / 普通）下的手验。
- iOS：单测覆盖「默认点按且开关为真时写入剪贴板」「开关为假时不写入」「一次性提示消费后被清空」；模拟器验收点横幅后剪贴板内容与提示条；最后装到真机用真实横幅验一次。
- 回归：确认通知列表与详情对旧数据（`copyOnTap` 为 false）行为无变化，点按路由与既有一致。
