# 把链接推到用户手机（扩展账号通知）

日期：2026-10-15
状态：待评审

## 目标

让任意来源把一条链接推给用户的账号，落到手机通知中心，点一下直接打开。

触发者是谁调用方，不绑任何具体工具：AI 刚生成的分享链接、翻出来的旧分享、外部的 GitHub PR，一视同仁。用户说「把链接发我手机上」，AI 就有地方把它交出去。

## 非目标

- **不改终端嗅探。** `TerminalResource*`、资源栏、桌面 `wrapFlags` 协议字段全部不动。本设计不替换它，也不与它合并。
- **不绑链接创建。** 不在 `app_drive_share_create` / `app_drive_site_create` 里加任何自动上报。链接诞生时上报只覆盖 create，覆盖不到「让 AI 找一条已有的分享链接」，那条路径上链接早就存在。
- **不新增通知来源（`source`）。** 沿用 `system-notifier`。
- **不暴露 `level`。** 桌面写入路径继续不传，由服务端默认 `active`（`notification.service.ts` `create()`）。
- **不新建存储、不做迁移。** `UserNotification.url` 与 `.group` 两列都已存在。

## 背景

手机端今天靠**从终端画面读链接**：URL 被 TUI 自己折行后 wire flags 为 0，只能靠「填满整行 + 悬挂缩进」的形状去猜边界，猜错就把半条 URL 当真链接交给用户（`SynapseMobile/.../TerminalResources.swift:20-38` 记录了这套推断的全部前提）。这条路的不确定性来自渲染层，改不掉。

换到「链接在交给 AI 的那一刻就被截住」就没有渲染层参与：`drive` 的返回是结构化 DTO，URL 在已知字段里，不需要正则扫文本。

而投递链路几乎全部现成——`NotificationService.create()` 本来就接受 `url` 与 `group`，只是桌面的写入入口把它们挡住了。

## 设计

### 数据流

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

### 契约

`url` 与 `group` 的规则**沿用开放 API 那一套**（`server/src/open-api/open-api-contract.ts:31,34`），不另立一份：

| 字段 | 规则 | 出处 |
|---|---|---|
| `url` | `z.url().max(2048).regex(/^https:/u)` —— 只允许 https | `open-api-contract.ts:34` |
| `group` | `z.string().trim().min(1).max(64)` | `open-api-contract.ts:31` |

两个字段都可选。桌面侧按既有风格另写等价的 code-point 校验，不复用开放 API 的 zod schema（两侧本来就各有一份，见 `system-notifier/shared/schema.ts` 与 `notification.controller.ts`）。

### 改动清单

| 层 | 文件 | 改什么 |
|---|---|---|
| 服务端 | `server/src/notifications/notification.controller.ts:49-57` | `desktopWriteSchema` 加 `url`、`group` |
| 服务端 | `server/src/notifications/notification.service.ts` | **不动**——`create()` 已接受二者 |
| 主进程 | `desktop/app-capabilities/system-notifier/shared/schema.ts` | `SystemNotificationInput` 加可选 `url`/`group`；`SYSTEM_NOTIFICATION_INVALID_FIELDS` 加两项；`validateSystemNotificationInput` 加两条字段校验 |
| 主进程 | `desktop/app-capabilities/system-notifier/main/service.ts` | `sendToAccount` 透传两个字段 |
| 主进程 | `desktop/electron/services/account-service.ts` | `createInternalNotification` 入参加 `url`、`group` |
| MCP | `desktop/synapse-capabilities/shared/app-domain.ts` | trigger 工具 `inputSchema` 加两个可选字段；description 补「用户要一条链接到手机时用它」 |
| MCP | `desktop/electron/services/agent-runtime/synapse-tool-router-lexicon.ts` | 按需补中文口语词条 |
| Skill | `desktop/app-capabilities/synapse-skill/skill-package/app/index.md` | System Notifier 一节补推链接的场景；改掉「不要加平台特有字段」那条（见下） |
| Skill | `desktop/app-capabilities/synapse-skill/skill-package/app/api-reference.md` | trigger 工具参数表补两个字段 |
| 文档 | `docs/agents/capability-registry.md` | System Notifier 行的例外说明；**MCP 工具数不变（仍 1），三张表的数字都不动** |
| 文档 | `RELEASE_NOTES_PENDING.md` | 用户可感知变化 |
| 测试 | `system-notifier` 校验单测、`notification` controller 单测、`synapse-tool-router-search.test.ts` 的 `INTENT_CORPUS` | 配套 |

**手机端零改动。** 依据：

- 路由：`NotificationDestination.resolve`（`SynapseMobile/.../NotificationDestination.swift:57-58`）对「无专属来源分支 + 有 https `url`」的通知返回 `.externalURL(url)`，`system-notifier` 正是这一类。
- 动作标签：同一文件 `:76` 对 `.externalURL` 已返回「打开链接」。
- 分组：`InboxView.swift:311-316` 已把 `group` 画在标题旁的小字位。
- 推送：`mobile-push.service.ts` 的 APNs payload 只带 `aps.alert.{title,body}` 与 `{notificationId, notificationLevel}`，不读 `url`。
- 桌面端同理：`use-message-center.ts` 对 https `url` 已走 `shell.openExternal`。

## 边界与判断

### 1. 三处校验必须同宽

`url` 要在**三个地方**都约束成 https-only + ≤2048：MCP 工具 schema、桌面校验、服务端 schema。这三处是授权边界，只在其中一层收紧等于没收紧——桌面校验挡不住绕过 MCP 直接打 HTTP 的调用方，工具 schema 更只是一份给模型看的说明。

同理，`desktopWriteSchema` 的 `.strict()` 必须保留：它挡的是桌面冒充服务端自有来源——`notification.controller.ts` 里 `createFromDesktop` 的文档注释写明 `/desktop` 这个路径名说的就是授权范围。

### 2. 锁屏与明文

Skill 现在有一条规则：title/body 里不得出现 Token、密码、验证码、私钥、完整本地路径等锁屏敏感内容，理由是消息在服务端明文存储且可能出现在锁屏上。

- **APNs payload 不含 `url`**（见上），所以带密码参数的分享链接不会直接上锁屏。
- 但 `url` 与其他通知字段一样**在服务端明文存储**，与开放 API 的 `url` 同级别。这是既有事实，不是本设计引入的。
- Skill 里那条规则要相应更新：把 `url` 纳入「不得携带凭据」的范围（例如不要把带 `?password=` / `token=` 的地址推进来），同时把原文「不要加平台特有字段、caller identity、notification id、幂等键、重试循环」里对**字段**的禁令收窄到它真正要挡的那几类。

### 3. `sourceKey` 不强制

`@@unique([userId, sourceKey])` 只在传了 `sourceKey` 时才生效。本设计**不给** trigger 工具暴露 `sourceKey`：不传就是每次一条新记录，语义正好是「用户又要了一次」。去重不是这里要解决的问题。

### 4. `source` 沿用 `system-notifier`

不新增来源。第一，用户在两个方案里选的是**扩展同一个工具**而不是新建类别；第二，新增 `source` 要动 `shared/src/notifications.ts` 的 `NOTIFICATION_SOURCES`、服务端 `source` 枚举校验、以及各处 label 映射，而收益只是 Inbox 里能筛得更细——`group` 已经能做这件事。

## 测试计划

- **桌面校验**：`url` 非 https 被拒；>2048 被拒；`group` 超 64 code point 被拒；未知字段仍被拒（回归）。
- **服务端 controller**：`/api/notifications/desktop` 接受带 `url`、`group` 的请求体；`http://` 的 `url` 返回 400；越权 `source` 仍返回 400（回归）。
- **检索**：若给 `LEXICON` 加了词条，`INTENT_CORPUS` 必须仍全绿（`desktop/tests/unit/synapse-tool-router-search.test.ts`）。
- 手机端**产品代码零改动**，因此不新增 UI 测试。若实现时发现 `NotificationDestination` 对 `system-notifier + url` 的判断没有被既有用例覆盖，补一条单测（那是测试缺口，不是产品改动）。

## 风险

| 风险 | 影响 | 处理 |
|---|---|---|
| AI 把带凭据的分享地址推进来 | 服务端明文留存 | Skill 明确禁止；锁屏不受影响（APNs 不带 url） |
| 工具 schema 与桌面校验、服务端校验漂移 | 宽度不一致的授权边界 | 三处同一次改完；测试各覆盖一层 |
| 与开放 API 的 `url` 规则分叉 | 同一件事两套规则 | 契约表钉死出处，实现时照抄 |

## 落地顺序

服务端 → 主进程能力 → MCP 定义 → Skill 文档 → 文档与发布说明。桌面能力改动会影响已发布构建的行为，验证放在服务端之后。
